// Tauri Rust backend — OBS Church Studio
//
// Commands:
//   save_bg_image      — persist background image to disk (for OBS image_source)
//   save_upload_file   — persist uploaded logo to disk
//   load_app_data      — read app_data.json (or return "{}" if missing)
//   save_app_data      — write app_data.json
//   get_overlay_port   — return the port of the local overlay HTTP server
//   load_dock_data     — read dock-shared JSON from the uploads directory
//
// On startup, a lightweight HTTP server is spawned on a localhost port
// to serve overlay HTML files (Bible, Worship, Lower Third) so that OBS
// browser sources can access them. Tauri's internal protocol (tauri:// or
// https://tauri.localhost) is NOT reachable by OBS/CEF, so we need a real
// localhost server.

mod local_llm;

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Component, Path};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

/// The port the overlay server is running on (set at startup).
static OVERLAY_PORT: AtomicU16 = AtomicU16::new(0);
const VOICE_BIBLE_MODEL_FILE: &str = "ggml-large-v3.bin";
const VOICE_BIBLE_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin";
const VOICE_BIBLE_MODEL_NAME: &str = "large-v3";
static VOICE_BIBLE_CONTEXT: OnceLock<Mutex<Option<Arc<WhisperContext>>>> = OnceLock::new();
static VOICE_BIBLE_STATE: OnceLock<Mutex<Option<WhisperState>>> = OnceLock::new();
const LIVE_CHUNK_SILENCE_THRESHOLD: f32 = 0.0065;
const LIVE_CHUNK_MIN_ACTIVE_SAMPLES: usize = 16_000 / 12;
const LIVE_CHUNK_EDGE_PADDING_SAMPLES: usize = 16_000 / 10;
const LIVE_CHUNK_MAX_DURATION_MS: i32 = 2_200;
const COMMON_LIVE_HALLUCINATIONS: &[&str] = &[
    "thank you",
    "thank you.",
    "thanks for watching",
    "thanks for watching.",
    "thank you for watching",
    "thank you for watching.",
];
const ONLINE_LYRICS_RESULT_LIMIT: usize = 18;
const ONLINE_LYRICS_USER_AGENT: &str =
    "OBSChurchStudio/1.0 (+https://localhost; worship-online-lyrics)";

/// True if the directory contains the overlay HTML entrypoint(s).
fn has_overlay_assets(dir: &std::path::Path) -> bool {
    dir.join("bible-overlay-fullscreen.html").is_file()
}

/// Resolve where bundled overlay HTML files were placed.
///
/// Depending on platform/packaging mode, Tauri may place resources in different
/// locations relative to resource_dir():
///   - resource_dir/                   ← flat resources
///   - resource_dir/_up_/dist/         ← array-style resources with ../ prefix
///   - exe_dir/                        ← Windows NSIS: alongside the exe
fn resolve_bundled_overlay_dir(resource_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    // Also try the directory containing the executable itself, which on
    // Windows NSIS is the install root and may hold resources directly.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let mut candidates = vec![
        resource_dir.to_path_buf(),
        resource_dir.join("dist"),
        resource_dir.join("_up_"),
        resource_dir.join("_up_").join("dist"),
        resource_dir.join("resources"),
    ];

    if let Some(ref exe) = exe_dir {
        if exe != resource_dir {
            candidates.push(exe.clone());
            candidates.push(exe.join("dist"));
            candidates.push(exe.join("_up_"));
            candidates.push(exe.join("_up_").join("dist"));
            candidates.push(exe.join("resources"));
        }
    }

    for dir in &candidates {
        let found = has_overlay_assets(dir);
        println!(
            "[Overlay Resolve] {:?} → {}",
            dir,
            if found { "FOUND" } else { "miss" }
        );
    }

    candidates.into_iter().find(|dir| has_overlay_assets(dir))
}

/// Dev fallback: locate `<project>/public` from the running executable.
fn resolve_dev_public_dir() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // exe is typically: <project>/src-tauri/target/{debug|release}/<binary>
    let project_root = exe
        .parent() // .../target/{debug|release}
        .and_then(|p| p.parent()) // .../target
        .and_then(|p| p.parent()) // .../src-tauri
        .and_then(|p| p.parent()); // .../<project>

    if let Some(root) = project_root {
        let public_dir = root.join("public");
        if has_overlay_assets(&public_dir) {
            return Some(public_dir);
        }
    }

    // Last-resort paths during local development.
    let cwd_public = std::path::PathBuf::from("public");
    if has_overlay_assets(&cwd_public) {
        return Some(cwd_public);
    }
    let parent_public = std::path::PathBuf::from("../public");
    if has_overlay_assets(&parent_public) {
        return Some(parent_public);
    }

    None
}

/// Base directory: ~/Documents/OBSChurchStudio/
fn app_dir() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let dir = home.join("Documents").join("OBSChurchStudio");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app directory: {}", e))?;
    Ok(dir)
}

/// Convert a user-provided filename into a safe basename for local storage.
/// Rejects empty names and strips any path components.
fn sanitize_filename_for_storage(file_name: &str) -> Result<String, String> {
    let base = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid file name")?;

    let safe = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    let trimmed = safe.trim_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Invalid file name".to_string());
    }

    Ok(trimmed.to_string())
}

/// Returns true when a relative path is safe to join under a known base directory.
fn is_safe_relative_path(path: &Path) -> bool {
    !path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

/// Save a background image to ~/Documents/OBSChurchStudio/backgrounds/
/// Accepts raw image bytes and a hash-based filename.
/// Returns the absolute path to the saved file.
#[tauri::command]
fn save_bg_image(file_name: String, file_data: Vec<u8>) -> Result<String, String> {
    let bg_dir = app_dir()?.join("backgrounds");
    fs::create_dir_all(&bg_dir)
        .map_err(|e| format!("Failed to create backgrounds directory: {}", e))?;

    let safe_file_name = sanitize_filename_for_storage(&file_name)?;
    let file_path = bg_dir.join(&safe_file_name);

    // Skip write if the file already exists (content-addressed by hash name)
    if file_path.exists() {
        let abs_path = file_path
            .to_str()
            .ok_or("File path contains invalid UTF-8")?
            .to_string();
        println!("[Tauri] BG image already exists: {}", abs_path);
        return Ok(abs_path);
    }

    fs::write(&file_path, &file_data)
        .map_err(|e| format!("Failed to write bg image '{}': {}", safe_file_name, e))?;

    let abs_path = file_path
        .to_str()
        .ok_or("File path contains invalid UTF-8")?
        .to_string();

    println!(
        "[Tauri] Saved BG image: {} ({} bytes)",
        abs_path,
        file_data.len()
    );
    Ok(abs_path)
}

/// Save an uploaded file to ~/Documents/OBSChurchStudio/uploads/
/// Returns the absolute path to the saved file.
#[tauri::command]
fn save_upload_file(file_name: String, file_data: Vec<u8>) -> Result<String, String> {
    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|e| format!("Failed to create uploads directory: {}", e))?;

    let safe_file_name = sanitize_filename_for_storage(&file_name)?;
    let file_path = uploads_dir.join(&safe_file_name);
    fs::write(&file_path, &file_data)
        .map_err(|e| format!("Failed to write file '{}': {}", safe_file_name, e))?;

    let abs_path = file_path
        .to_str()
        .ok_or("File path contains invalid UTF-8")?
        .to_string();

    println!(
        "[Tauri] Saved upload: {} ({} bytes)",
        abs_path,
        file_data.len()
    );
    Ok(abs_path)
}

/// Load app_data.json — returns file contents or "{}" if it doesn't exist.
#[tauri::command]
fn load_app_data() -> Result<String, String> {
    let path = app_dir()?.join("app_data.json");

    if !path.exists() {
        println!("[Tauri] app_data.json not found — returning empty object");
        return Ok("{}".to_string());
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read app_data.json: {}", e))?;

    println!("[Tauri] Loaded app_data.json ({} bytes)", contents.len());
    Ok(contents)
}

/// Save app_data.json — writes the JSON string to disk.
#[tauri::command]
fn save_app_data(data: String) -> Result<(), String> {
    let path = app_dir()?.join("app_data.json");

    fs::write(&path, &data).map_err(|e| format!("Failed to write app_data.json: {}", e))?;

    println!("[Tauri] Saved app_data.json ({} bytes)", data.len());
    Ok(())
}

/// Return the overlay server port so the frontend can build URLs.
#[tauri::command]
fn get_overlay_port() -> u16 {
    OVERLAY_PORT.load(Ordering::Relaxed)
}

fn resolve_dock_data_path(name: &str) -> Result<(String, std::path::PathBuf), String> {
    let safe = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if safe.is_empty() {
        return Err("Invalid data name".to_string());
    }

    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir).map_err(|e| format!("Failed to create uploads dir: {}", e))?;
    Ok((safe.clone(), uploads_dir.join(format!("{}.json", safe))))
}

fn write_dock_data(name: &str, data: &str) -> Result<(), String> {
    let (safe, path) = resolve_dock_data_path(name)?;
    fs::write(&path, data).map_err(|e| format!("Failed to write dock data: {}", e))?;
    println!("[Tauri] Saved dock data '{}' ({} bytes)", safe, data.len());
    Ok(())
}

/// Save dock-shared data to a JSON file in the uploads directory.
/// The overlay server can then serve it to the dock page.
/// `name` is the filename (e.g. "worship-songs"), `.json` is appended.
#[tauri::command]
fn save_dock_data(name: String, data: String) -> Result<(), String> {
    write_dock_data(&name, &data)
}

/// Load dock-shared data from the uploads directory.
/// Returns an empty string when the file has not been written yet.
#[tauri::command]
fn load_dock_data(name: String) -> Result<String, String> {
    let (safe, path) = resolve_dock_data_path(&name)?;
    if !path.exists() {
        return Ok(String::new());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read dock data '{}': {}", safe, e))?;
    if !safe.starts_with("dock-voice-bible-") && !safe.starts_with("dock-worship-song-save") {
        println!(
            "[Tauri] Loaded dock data '{}' ({} bytes)",
            safe,
            contents.len()
        );
    }
    Ok(contents)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OnlineLyricsSearchResult {
    id: String,
    source_id: String,
    source_name: String,
    title: String,
    artist: String,
    url: String,
    preview: String,
    lyrics: String,
    thumbnail_url: Option<String>,
    #[serde(skip_serializing)]
    score: i32,
}

#[derive(Deserialize)]
struct WpRenderedField {
    rendered: String,
}

#[derive(Deserialize)]
struct WpPost {
    link: String,
    title: WpRenderedField,
    content: WpRenderedField,
    #[serde(default)]
    jetpack_featured_media_url: Option<String>,
}

#[derive(Deserialize)]
struct BloggerFeedResponse {
    feed: BloggerFeed,
}

#[derive(Deserialize)]
struct BloggerFeed {
    #[serde(default)]
    entry: Vec<BloggerEntry>,
}

#[derive(Deserialize)]
struct BloggerTextValue {
    #[serde(rename = "$t")]
    value: String,
}

#[derive(Deserialize)]
struct BloggerLink {
    rel: String,
    href: String,
}

#[derive(Deserialize)]
struct BloggerThumbnail {
    url: String,
}

#[derive(Deserialize)]
struct BloggerEntry {
    title: BloggerTextValue,
    content: BloggerTextValue,
    #[serde(default)]
    link: Vec<BloggerLink>,
    #[serde(rename = "media$thumbnail")]
    thumbnail: Option<BloggerThumbnail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibTrack {
    id: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    track_name: Option<String>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
}

fn build_online_lyrics_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(ONLINE_LYRICS_USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to create lyrics search client: {}", err))
}

fn parse_selector(selector: &str) -> Result<Selector, String> {
    Selector::parse(selector).map_err(|err| format!("Invalid selector '{}': {:?}", selector, err))
}

fn clean_inline_text(text: &str) -> String {
    text.replace('\u{00a0}', " ")
        .replace("&nbsp;", " ")
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace('\u{201c}', "\"")
        .replace('\u{201d}', "\"")
        .replace('\u{2013}', "-")
        .replace('\u{2014}', "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_text_block(text: &str) -> String {
    let mut lines = Vec::new();
    let mut last_blank = false;

    for raw_line in text.lines() {
        let cleaned = clean_inline_text(raw_line);
        if cleaned.is_empty() {
            if !last_blank && !lines.is_empty() {
                lines.push(String::new());
            }
            last_blank = true;
            continue;
        }

        lines.push(cleaned);
        last_blank = false;
    }

    lines.join("\n").trim().to_string()
}

fn html_fragment_to_text(fragment: &str) -> String {
    let normalized_html = fragment
        .replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
        .replace("</p>", "\n\n")
        .replace("</div>", "\n\n")
        .replace("</li>", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n")
        .replace("</h4>", "\n")
        .replace("</h5>", "\n")
        .replace("</h6>", "\n");

    let fragment = Html::parse_fragment(&normalized_html);
    let text = fragment.root_element().text().collect::<Vec<_>>().join("");
    normalize_text_block(&text)
}

fn strip_ascii_ci_prefix(text: &str, prefix: &str) -> String {
    let text = text.trim();
    if let Some(candidate) = text.get(..prefix.len()) {
        if candidate.eq_ignore_ascii_case(prefix) {
            return text
                .get(prefix.len()..)
                .unwrap_or_default()
                .trim()
                .to_string();
        }
    }

    text.to_string()
}

fn strip_ascii_ci_suffix(text: &str, suffix: &str) -> String {
    let text = text.trim();
    if let Some(start) = text.len().checked_sub(suffix.len()) {
        if let Some(candidate) = text.get(start..) {
            if candidate.eq_ignore_ascii_case(suffix) {
                return text.get(..start).unwrap_or_default().trim().to_string();
            }
        }
    }

    text.to_string()
}

fn split_ascii_ci_once<'a>(text: &'a str, separators: &[&str]) -> Option<(&'a str, &'a str)> {
    let lower = text.to_ascii_lowercase();

    for separator in separators {
        let separator_lower = separator.to_ascii_lowercase();
        if let Some(index) = lower.find(&separator_lower) {
            let after_index = index + separator.len();
            return Some((&text[..index], &text[after_index..]));
        }
    }

    None
}

fn cleanup_song_title(raw_title: &str) -> String {
    let mut title = clean_inline_text(raw_title);

    for prefix in [
        "[Download & Lyrics] ",
        "[Download + Lyrics] ",
        "Download & Lyrics ",
        "Download + Lyrics ",
    ] {
        title = strip_ascii_ci_prefix(&title, prefix);
    }

    for suffix in [
        "| Nigerian Gospel Lyrics",
        "| African Gospel Lyrics",
        "| New-age Gospel Lyrics",
        "• New-age Gospel Lyrics",
    ] {
        title = strip_ascii_ci_suffix(&title, suffix);
    }

    for suffix in [
        " (Mp3 & Lyrics)",
        " (Mp3 + Lyrics)",
        " Mp3 & Lyrics",
        " Mp3 + Lyrics",
        "Lyrics in-Full",
        "Lyrics in Full",
        "Full Lyrics and Video",
        "Full Lyrics",
        "Lyrics",
    ] {
        title = strip_ascii_ci_suffix(&title, suffix);
    }

    title
        .trim_matches(|ch: char| matches!(ch, '-' | ':' | '|' | ' '))
        .trim()
        .to_string()
}

fn cleanup_artist_name(raw_artist: &str) -> String {
    let mut artist = clean_inline_text(raw_artist);

    for prefix in ["a song by ", "song by ", "by "] {
        artist = strip_ascii_ci_prefix(&artist, prefix);
    }

    artist
        .trim_matches(|ch: char| matches!(ch, '-' | ':' | '|' | ' '))
        .trim()
        .to_string()
}

fn extract_field_from_lines(text: &str, field_names: &[&str]) -> Option<String> {
    for line in text.lines().take(10) {
        let cleaned = clean_inline_text(line);
        if cleaned.is_empty() {
            continue;
        }

        let lower = cleaned.to_ascii_lowercase();
        for field_name in field_names {
            let normalized_field = field_name.to_ascii_lowercase();
            if lower.starts_with(&normalized_field) {
                if let Some((_, value)) = cleaned.split_once(':') {
                    let value = clean_inline_text(value);
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
        }
    }

    None
}

fn extract_title_artist_from_content_markers(raw_content_text: &str) -> Option<(String, String)> {
    let mut download_fallback = None;

    for line in raw_content_text.lines().take(100) {
        let cleaned = clean_inline_text(line);
        if cleaned.is_empty() {
            continue;
        }

        let lyrics_line = strip_ascii_ci_prefix(&cleaned, "lyrics:");
        if lyrics_line != cleaned {
            if let Some((title, artist)) = split_ascii_ci_once(&lyrics_line, &[" by "]) {
                let title = cleanup_song_title(title);
                let artist = cleanup_artist_name(artist);
                if !title.is_empty() {
                    return Some((title, artist));
                }
            }
        }

        let download_line = strip_ascii_ci_prefix(&cleaned, "download ");
        if download_line != cleaned {
            if let Some((title, artist)) = split_ascii_ci_once(
                &download_line,
                &[" Mp3 Audio by ", " MP3 Audio by ", " Audio by ", " Mp3 by "],
            ) {
                let title = cleanup_song_title(title);
                let artist = cleanup_artist_name(artist);
                if !title.is_empty() && download_fallback.is_none() {
                    download_fallback = Some((title, artist));
                }
            }
        }
    }

    download_fallback
}

fn extract_title_artist(raw_title: &str, raw_content_text: &str) -> (String, String) {
    let content_title = extract_field_from_lines(raw_content_text, &["song title", "song tittle"]);
    let content_artist = extract_field_from_lines(raw_content_text, &["artist"]);
    let content_marker_pair = extract_title_artist_from_content_markers(raw_content_text);

    let normalized_title = clean_inline_text(raw_title);
    let (mut title, mut artist) = if let Some((before, after)) = split_ascii_ci_once(
        &normalized_title,
        &[
            " Lyrics in-Full: a song by ",
            " Lyrics in Full: a song by ",
            " Lyrics by ",
            " lyrics by ",
            " - ",
        ],
    ) {
        (cleanup_song_title(before), cleanup_artist_name(after))
    } else {
        (cleanup_song_title(&normalized_title), String::new())
    };

    if let Some((marker_title, marker_artist)) = content_marker_pair {
        title = marker_title;
        if !marker_artist.is_empty() {
            artist = marker_artist;
        }
    }

    if let Some(content_title) = content_title {
        title = cleanup_song_title(&content_title);
    }

    if let Some(content_artist) = content_artist {
        artist = cleanup_artist_name(&content_artist);
    }

    (title, artist)
}

fn should_break_lyrics(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "the video"
            | "video"
            | "watch the video"
            | "watch video"
            | "related"
            | "more"
            | "print"
    ) || lower.contains("thanks for visiting")
        || lower.contains("have a blessed week")
        || lower.contains("property and copyright")
        || lower.contains("personal and educational purpose only")
        || lower.contains("contact us to dmca")
        || lower.starts_with("discover more from")
        || lower.starts_with("subscribe to get")
        || lower.starts_with("share on ")
        || lower.starts_with("email a link")
        || lower.starts_with("like loading")
}

fn should_drop_lyrics_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("song title:")
        || lower.starts_with("song tittle:")
        || lower.starts_with("artist:")
        || lower.starts_with("album:")
        || lower.starts_with("lyrics:")
        || lower == "the full lyrics"
        || lower == "full lyrics"
        || lower == "contents:"
        || lower == "toggle"
        || lower.starts_with("read also")
        || lower.starts_with("share this")
        || lower.starts_with("download")
        || lower.contains("(opens in new window)")
        || lower.contains("download here")
        || lower.contains("get mp3 audio")
        || lower.contains("stream, and share")
        || lower.contains("ceenaija")
        || matches!(
            lower.as_str(),
            "share"
                | "tweet"
                | "pin"
                | "whatsapp"
                | "telegram"
                | "facebook"
                | "email"
                | "pinterest"
                | "tumblr"
                | "x"
        )
}

fn prune_lyrics_text(text: &str) -> String {
    let normalized = normalize_text_block(text);
    let normalized_lines = normalized.lines().collect::<Vec<_>>();
    let start_index = normalized_lines
        .iter()
        .position(|line| {
            let lower = clean_inline_text(line).to_ascii_lowercase();
            lower == "lyrics" || lower.starts_with("lyrics:")
        })
        .map(|index| index + 1)
        .unwrap_or(0);
    let mut lines = Vec::new();
    let mut last_blank = false;

    for line in normalized_lines.into_iter().skip(start_index) {
        if should_break_lyrics(line) {
            break;
        }
        if should_drop_lyrics_line(line) {
            continue;
        }

        if line.trim().is_empty() {
            if !last_blank && !lines.is_empty() {
                lines.push(String::new());
            }
            last_blank = true;
            continue;
        }

        lines.push(line.trim().to_string());
        last_blank = false;
    }

    lines.join("\n").trim().to_string()
}

fn build_preview(text: &str) -> String {
    let joined = text
        .lines()
        .map(clean_inline_text)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");

    let preview = joined.trim();
    let mut chars = preview.chars();
    let mut output = chars.by_ref().take(187).collect::<String>();
    if chars.next().is_some() {
        output.push_str("...");
    }

    output
}

fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            tokens.push(current.clone());
            current.clear();
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
        .into_iter()
        .filter(|token| {
            token.len() > 1
                && !matches!(
                    token.as_str(),
                    "lyrics"
                        | "lyric"
                        | "song"
                        | "songs"
                        | "full"
                        | "video"
                        | "download"
                        | "the"
                        | "and"
                        | "feat"
                        | "ft"
                        | "with"
                        | "for"
                        | "from"
                        | "by"
                )
        })
        .collect()
}

fn fuzzy_prefix(token: &str, min_len: usize, max_len: usize) -> Option<String> {
    let char_count = token.chars().count();
    if char_count < min_len {
        return None;
    }

    Some(token.chars().take(char_count.min(max_len)).collect())
}

fn build_online_lyrics_search_queries(query: &str) -> Vec<String> {
    let tokens = tokenize_query(query);
    let mut queries = vec![clean_inline_text(query)];

    if tokens.len() >= 2 {
        let fuzzy_tokens = tokens
            .iter()
            .filter_map(|token| fuzzy_prefix(token, 3, 4))
            .collect::<Vec<_>>();
        if fuzzy_tokens.len() >= 2 {
            queries.push(fuzzy_tokens.join(" "));
        }

        let mixed_prefix_tokens = tokens
            .iter()
            .enumerate()
            .filter_map(|(index, token)| {
                if index == 0 {
                    fuzzy_prefix(token, 3, 3)
                } else {
                    fuzzy_prefix(token, 3, 4)
                }
            })
            .collect::<Vec<_>>();
        if mixed_prefix_tokens.len() >= 2 {
            queries.push(mixed_prefix_tokens.join(" "));
        }
    }

    if tokens.len() == 1 {
        if let Some(prefix) = fuzzy_prefix(&tokens[0], 3, 5) {
            queries.push(prefix);
        }
    }

    queries
        .into_iter()
        .filter(|query| query.chars().count() >= 3)
        .fold(Vec::new(), |mut unique, query| {
            if !unique
                .iter()
                .any(|item: &String| item.eq_ignore_ascii_case(&query))
            {
                unique.push(query);
            }
            unique
        })
}

fn levenshtein_distance(left: &str, right: &str) -> usize {
    if left == right {
        return 0;
    }

    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();

    if left_chars.is_empty() {
        return right_chars.len();
    }
    if right_chars.is_empty() {
        return left_chars.len();
    }

    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();
    let mut current = vec![0; right_chars.len() + 1];

    for (left_index, left_char) in left_chars.iter().enumerate() {
        current[0] = left_index + 1;

        for (right_index, right_char) in right_chars.iter().enumerate() {
            let substitution_cost = if left_char == right_char { 0 } else { 1 };
            current[right_index + 1] = (previous[right_index + 1] + 1)
                .min(current[right_index] + 1)
                .min(previous[right_index] + substitution_cost);
        }

        std::mem::swap(&mut previous, &mut current);
    }

    previous[right_chars.len()]
}

fn fuzzy_token_match_score(query_token: &str, candidate_tokens: &[String]) -> i32 {
    candidate_tokens
        .iter()
        .map(|candidate| {
            if candidate == query_token {
                return 34;
            }
            if candidate.starts_with(query_token) || query_token.starts_with(candidate) {
                return 24;
            }

            let distance = levenshtein_distance(query_token, candidate);
            let max_len = query_token.chars().count().max(candidate.chars().count());
            if max_len >= 5 && distance <= 2 {
                18
            } else if max_len >= 4 && distance <= 1 {
                14
            } else {
                0
            }
        })
        .max()
        .unwrap_or(0)
}

fn compute_result_score(
    query: &str,
    title: &str,
    artist: &str,
    preview: &str,
    lyrics: &str,
) -> i32 {
    let title_lower = title.to_ascii_lowercase();
    let artist_lower = artist.to_ascii_lowercase();
    let preview_lower = preview.to_ascii_lowercase();
    let lyrics_lower = lyrics.to_ascii_lowercase();
    let query_lower = query.trim().to_ascii_lowercase();
    let title_tokens = tokenize_query(title);
    let artist_tokens = tokenize_query(artist);
    let preview_tokens = tokenize_query(preview);
    let lyrics_tokens = tokenize_query(&lyrics.lines().take(24).collect::<Vec<_>>().join(" "));
    let mut score = 0;

    if !query_lower.is_empty() && title_lower.contains(&query_lower) {
        score += 220;
    }
    if !query_lower.is_empty() && artist_lower.contains(&query_lower) {
        score += 70;
    }

    for token in tokenize_query(query) {
        if title_lower.contains(&token) {
            score += 34;
        } else {
            score += fuzzy_token_match_score(&token, &title_tokens);
        }
        if artist_lower.contains(&token) {
            score += 22;
        } else {
            score += fuzzy_token_match_score(&token, &artist_tokens) / 2;
        }
        if preview_lower.contains(&token) {
            score += 12;
        } else {
            score += fuzzy_token_match_score(&token, &preview_tokens) / 3;
        }
        if lyrics_lower.contains(&token) {
            score += 8;
        } else {
            score += fuzzy_token_match_score(&token, &lyrics_tokens) / 4;
        }
    }

    if !artist.is_empty() {
        score += 12;
    }
    if lyrics.len() > 140 {
        score += 18;
    }
    if lyrics.len() > 480 {
        score += 10;
    }

    for penalty in [
        "biography",
        "songs lyrics",
        "songs and lyrics",
        "lyricspedia",
        "ultimate list",
        "top 15",
        "top 10",
        "album",
        "albums",
        "artists",
        "full biography",
    ] {
        if title_lower.contains(penalty) {
            score -= 120;
        }
    }

    score
}

fn build_result(
    source_id: &str,
    source_name: &str,
    raw_title: &str,
    raw_content: &str,
    url: &str,
    thumbnail_url: Option<String>,
    query: &str,
) -> Option<OnlineLyricsSearchResult> {
    let content_text = html_fragment_to_text(raw_content);
    let lyrics = prune_lyrics_text(&content_text);
    let (title, artist) = extract_title_artist(raw_title, &content_text);
    let preview_source = if !lyrics.is_empty() {
        &lyrics
    } else {
        &content_text
    };
    let preview = build_preview(preview_source);
    let score = compute_result_score(query, &title, &artist, &preview, &lyrics);

    if title.is_empty()
        || url.trim().is_empty()
        || (lyrics.len() < 40 && preview.len() < 24)
        || score < 24
    {
        return None;
    }

    Some(OnlineLyricsSearchResult {
        id: format!("{}:{}", source_id, url),
        source_id: source_id.to_string(),
        source_name: source_name.to_string(),
        title,
        artist,
        url: url.to_string(),
        preview,
        lyrics,
        thumbnail_url,
        score,
    })
}

fn search_wordpress_source(
    client: &reqwest::blocking::Client,
    source_id: &str,
    source_name: &str,
    api_url: &str,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get(api_url)
        .query(&[
            ("search", query),
            ("per_page", "6"),
            ("_fields", "link,title,content,jetpack_featured_media_url"),
        ])
        .send()
        .map_err(|err| format!("{} search failed: {}", source_name, err))?
        .error_for_status()
        .map_err(|err| format!("{} search failed: {}", source_name, err))?;

    let posts: Vec<WpPost> = response
        .json()
        .map_err(|err| format!("{} search decode failed: {}", source_name, err))?;

    let mut results = posts
        .into_iter()
        .filter_map(|post| {
            build_result(
                source_id,
                source_name,
                &html_fragment_to_text(&post.title.rendered),
                &post.content.rendered,
                &post.link,
                post.jetpack_featured_media_url,
                query,
            )
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn search_african_gospel_lyrics(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get("https://africangospellyrics.com/")
        .query(&[("s", query)])
        .send()
        .map_err(|err| format!("African Gospel Lyrics search failed: {}", err))?
        .error_for_status()
        .map_err(|err| format!("African Gospel Lyrics search failed: {}", err))?;

    let search_html = response
        .text()
        .map_err(|err| format!("African Gospel Lyrics search decode failed: {}", err))?;
    let search_doc = Html::parse_document(&search_html);
    let post_selector = parse_selector("div.post")?;
    let title_selector = parse_selector("h2.post-title a")?;
    let content_selector = parse_selector("div.post-content")?;

    let mut results = Vec::new();

    for post in search_doc.select(&post_selector).take(4) {
        let Some(link) = post.select(&title_selector).next() else {
            continue;
        };

        let url = link.value().attr("href").unwrap_or("").trim().to_string();
        if url.is_empty() {
            continue;
        }

        let title = clean_inline_text(&link.text().collect::<Vec<_>>().join(" "));
        let detail_html = client
            .get(&url)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|err| format!("African Gospel Lyrics detail fetch failed: {}", err))?
            .text()
            .map_err(|err| format!("African Gospel Lyrics detail decode failed: {}", err))?;
        let detail_doc = Html::parse_document(&detail_html);
        let raw_content = detail_doc
            .select(&content_selector)
            .next()
            .map(|node| node.inner_html())
            .unwrap_or_default();

        if let Some(result) = build_result(
            "africangospellyrics",
            "African Gospel Lyrics",
            &title,
            &raw_content,
            &url,
            None,
            query,
        ) {
            results.push(result);
        }
    }

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn search_godlyrics(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get("https://www.godlyrics.com.ng/feeds/posts/default")
        .query(&[("q", query), ("alt", "json")])
        .send()
        .map_err(|err| format!("GodLyrics search failed: {}", err))?
        .error_for_status()
        .map_err(|err| format!("GodLyrics search failed: {}", err))?;

    let payload: BloggerFeedResponse = response
        .json()
        .map_err(|err| format!("GodLyrics search decode failed: {}", err))?;

    let mut results = payload
        .feed
        .entry
        .into_iter()
        .filter_map(|entry| {
            let url = entry
                .link
                .iter()
                .find(|link| link.rel == "alternate")
                .map(|link| link.href.clone())?;

            build_result(
                "godlyrics",
                "GodLyrics",
                &entry.title.value,
                &entry.content.value,
                &url,
                entry.thumbnail.map(|thumbnail| thumbnail.url),
                query,
            )
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn search_lrclib(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get("https://lrclib.net/api/search")
        .query(&[("q", query)])
        .send()
        .map_err(|err| format!("LRCLIB search failed: {}", err))?
        .error_for_status()
        .map_err(|err| format!("LRCLIB search failed: {}", err))?;

    let tracks: Vec<LrcLibTrack> = response
        .json()
        .map_err(|err| format!("LRCLIB search decode failed: {}", err))?;

    let mut results = tracks
        .into_iter()
        .filter_map(|track| {
            if track.instrumental {
                return None;
            }

            let lyrics = prune_lyrics_text(&track.plain_lyrics.unwrap_or_default());
            let title = clean_inline_text(
                track
                    .track_name
                    .as_deref()
                    .or(track.name.as_deref())
                    .unwrap_or_default(),
            );
            let artist = clean_inline_text(track.artist_name.as_deref().unwrap_or_default());
            let preview = build_preview(&lyrics);
            let score = compute_result_score(query, &title, &artist, &preview, &lyrics);

            if title.is_empty() || lyrics.len() < 40 || score < 12 {
                return None;
            }

            Some(OnlineLyricsSearchResult {
                id: format!("lrclib:{}", track.id),
                source_id: "lrclib".to_string(),
                source_name: "LRCLIB".to_string(),
                title,
                artist,
                url: format!("https://lrclib.net/api/get/{}", track.id),
                preview,
                lyrics,
                thumbnail_url: None,
                score,
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn append_source_results(
    results: &mut Vec<OnlineLyricsSearchResult>,
    source_results: Result<Vec<OnlineLyricsSearchResult>, String>,
) {
    match source_results {
        Ok(mut items) => results.append(&mut items),
        Err(err) => eprintln!("[OnlineLyrics] {}", err),
    }
}

fn finish_online_lyrics_results(
    mut results: Vec<OnlineLyricsSearchResult>,
) -> Vec<OnlineLyricsSearchResult> {
    let mut seen_urls = Vec::<String>::new();
    results.retain(|result| {
        let url_key = result.url.to_ascii_lowercase();
        if seen_urls.iter().any(|url| url == &url_key) {
            return false;
        }
        seen_urls.push(url_key);
        true
    });
    results.sort_by(|left, right| right.score.cmp(&left.score));
    results.truncate(ONLINE_LYRICS_RESULT_LIMIT);
    results
}

fn search_online_song_lyrics_blocking(
    query: String,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let trimmed_query = clean_inline_text(query.trim());
    if trimmed_query.chars().count() < 3 {
        return Ok(Vec::new());
    }

    let client = build_online_lyrics_client()?;
    let mut results = Vec::new();
    let search_queries = build_online_lyrics_search_queries(&trimmed_query);

    for search_query in &search_queries {
        std::thread::scope(|scope| {
            let gospel_client = client.clone();
            let gospel_query = search_query.clone();
            let gospellyrics = scope.spawn(move || {
                search_wordpress_source(
                    &gospel_client,
                    "gospellyricsng",
                    "GospellyricsNG",
                    "https://gospellyricsng.com/wp-json/wp/v2/posts",
                    &gospel_query,
                )
            });

            let african_client = client.clone();
            let african_query = search_query.clone();
            let african =
                scope.spawn(move || search_african_gospel_lyrics(&african_client, &african_query));

            let ceenaija_client = client.clone();
            let ceenaija_query = search_query.clone();
            let ceenaija = scope.spawn(move || {
                search_wordpress_source(
                    &ceenaija_client,
                    "ceenaija",
                    "CeeNaija",
                    "https://www.ceenaija.com/wp-json/wp/v2/posts",
                    &ceenaija_query,
                )
            });

            let lrclib_client = client.clone();
            let lrclib_query = search_query.clone();
            let lrclib = scope.spawn(move || search_lrclib(&lrclib_client, &lrclib_query));

            for source_results in [
                gospellyrics
                    .join()
                    .unwrap_or_else(|_| Err("GospellyricsNG search worker panicked".to_string())),
                african.join().unwrap_or_else(|_| {
                    Err("African Gospel Lyrics search worker panicked".to_string())
                }),
                ceenaija
                    .join()
                    .unwrap_or_else(|_| Err("CeeNaija search worker panicked".to_string())),
                lrclib
                    .join()
                    .unwrap_or_else(|_| Err("LRCLIB search worker panicked".to_string())),
            ] {
                append_source_results(&mut results, source_results);
            }
        });
    }

    if !results.is_empty() {
        return Ok(finish_online_lyrics_results(results));
    }

    for search_query in &search_queries {
        std::thread::scope(|scope| {
            let ng_client = client.clone();
            let ng_query = search_query.clone();
            let nglyrics = scope.spawn(move || {
                search_wordpress_source(
                    &ng_client,
                    "nglyrics",
                    "NgLyrics",
                    "https://www.nglyrics.net/wp-json/wp/v2/posts",
                    &ng_query,
                )
            });

            let godlyrics_client = client.clone();
            let godlyrics_query = search_query.clone();
            let godlyrics =
                scope.spawn(move || search_godlyrics(&godlyrics_client, &godlyrics_query));

            for source_results in [
                nglyrics
                    .join()
                    .unwrap_or_else(|_| Err("NgLyrics search worker panicked".to_string())),
                godlyrics
                    .join()
                    .unwrap_or_else(|_| Err("GodLyrics search worker panicked".to_string())),
            ] {
                append_source_results(&mut results, source_results);
            }
        });
    }

    Ok(finish_online_lyrics_results(results))
}

#[tauri::command]
async fn search_online_song_lyrics(query: String) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search_online_song_lyrics_blocking(query))
        .await
        .map_err(|err| format!("Lyrics search task failed: {}", err))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_song_title_handles_accented_utf8() {
        assert_eq!(cleanup_song_title("Ore Òfé Shá Lyrics"), "Ore Òfé Shá");
    }

    #[test]
    fn build_preview_truncates_utf8_safely() {
        let preview = build_preview(&"Òfé Shá ".repeat(80));

        assert!(preview.ends_with("..."));
        assert!(preview.is_char_boundary(preview.len()));
    }

    #[test]
    fn fuzzy_search_query_handles_misspelled_title() {
        let queries = build_online_lyrics_search_queries("onidhe iyanf");

        assert!(queries.iter().any(|query| query == "oni iyan"));
        assert!(compute_result_score("onidhe iyanf", "Onise Iyanu", "", "", "") > 24);
    }

    #[test]
    fn ceenaija_content_markers_extract_song_and_lyrics() {
        let text = normalize_text_block(
            "Download Number One Mp3 Audio by Dunsin Oyekan Ft. John Wilds\n\
             Biography copy\n\
             Lyrics: Number One by Dunsin Oyekan\n\
             First things first, You are not another option\n\
             You will always be my Number One",
        );
        let (title, artist) =
            extract_title_artist("Dunsin Oyekan - Number One (Mp3 & Lyrics)", &text);
        let lyrics = prune_lyrics_text(&text);

        assert_eq!(title, "Number One");
        assert_eq!(artist, "Dunsin Oyekan");
        assert!(lyrics.starts_with("First things first"));
        assert!(!lyrics.contains("Biography copy"));
    }

    #[test]
    fn prune_lyrics_removes_subscription_and_share_footer() {
        let text = normalize_text_block(
            "Lyrics:\n\
             You are worthy oh God\n\
             No eyes have seen it\n\
             Discover more from African Gospel Lyrics\n\
             Subscribe to get the latest posts sent to your email.\n\
             Type your email...\n\
             Share on Facebook (Opens in new window)\n\
             Facebook\n\
             Related",
        );
        let lyrics = prune_lyrics_text(&text);

        assert_eq!(lyrics, "You are worthy oh God\nNo eyes have seen it");
        assert!(!lyrics.contains("Discover more"));
        assert!(!lyrics.contains("Facebook"));
        assert!(!lyrics.contains("Related"));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceBibleRuntimeStatus {
    model_ready: bool,
    model_name: String,
    model_path: Option<String>,
}

fn voice_bible_dir() -> Result<std::path::PathBuf, String> {
    let dir = app_dir()?.join("voice-bible");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create voice-bible dir: {}", e))?;
    Ok(dir)
}

fn voice_bible_model_path() -> Result<std::path::PathBuf, String> {
    Ok(voice_bible_dir()?.join(VOICE_BIBLE_MODEL_FILE))
}

fn current_voice_bible_status() -> Result<VoiceBibleRuntimeStatus, String> {
    let model_path = voice_bible_model_path()?;
    let model_ready = model_path.is_file()
        && fs::metadata(&model_path)
            .map(|metadata| metadata.len() > 1_000_000)
            .unwrap_or(false);

    Ok(VoiceBibleRuntimeStatus {
        model_ready,
        model_name: VOICE_BIBLE_MODEL_NAME.to_string(),
        model_path: if model_ready {
            Some(
                model_path
                    .to_str()
                    .ok_or("Model path contains invalid UTF-8")?
                    .to_string(),
            )
        } else {
            None
        },
    })
}

fn ensure_voice_bible_model() -> Result<std::path::PathBuf, String> {
    let status = current_voice_bible_status()?;
    if status.model_ready {
        return voice_bible_model_path();
    }

    let model_path = voice_bible_model_path()?;
    let temp_path = model_path.with_extension("bin.part");
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("Failed to create download client: {}", e))?;
    let mut response = client
        .get(VOICE_BIBLE_MODEL_URL)
        .send()
        .map_err(|e| format!("Failed to download Whisper model: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download Whisper model: HTTP {}",
            response.status()
        ));
    }

    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temporary model file: {}", e))?;
    response
        .copy_to(&mut file)
        .map_err(|e| format!("Failed to write Whisper model: {}", e))?;
    file.flush()
        .map_err(|e| format!("Failed to flush Whisper model: {}", e))?;

    fs::rename(&temp_path, &model_path)
        .map_err(|e| format!("Failed to finalize Whisper model: {}", e))?;
    Ok(model_path)
}

#[tauri::command]
fn get_voice_bible_runtime_status() -> Result<VoiceBibleRuntimeStatus, String> {
    current_voice_bible_status()
}

#[tauri::command]
fn prepare_voice_bible_model() -> Result<VoiceBibleRuntimeStatus, String> {
    ensure_voice_bible_model()?;
    current_voice_bible_status()
}

fn transcribe_voice_audio_blocking(wav_data: Vec<u8>) -> Result<String, String> {
    if wav_data.is_empty() {
        return Err("No audio data received".to_string());
    }

    let context = get_voice_bible_context()?;
    let reader = hound::WavReader::new(Cursor::new(wav_data))
        .map_err(|e| format!("Failed to read WAV audio: {}", e))?;
    let spec = reader.spec();

    if spec.sample_rate != 16_000 {
        return Err(format!(
            "Voice audio must be 16kHz mono PCM. Received {}Hz.",
            spec.sample_rate
        ));
    }

    let channels = usize::from(spec.channels);
    if channels == 0 || channels > 2 {
        return Err("Voice audio must be mono or stereo".to_string());
    }

    if spec.bits_per_sample != 16 || spec.sample_format != hound::SampleFormat::Int {
        return Err("Voice audio must be 16-bit PCM WAV".to_string());
    }

    let samples: Vec<i16> = reader
        .into_samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to decode WAV samples: {}", e))?;

    let mut audio = vec![0.0f32; samples.len()];
    whisper_rs::convert_integer_to_float_audio(&samples, &mut audio)
        .map_err(|e| format!("Failed to convert audio samples: {}", e))?;

    let mono_audio = if channels == 1 {
        audio
    } else {
        let mut output = vec![0.0f32; audio.len() / channels];
        whisper_rs::convert_stereo_to_mono_audio(&audio, &mut output)
            .map_err(|e| format!("Failed to convert stereo audio: {}", e))?;
        output
    };

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 0 });
    let threads = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get().min(6) as i32)
        .unwrap_or(2);
    let audio_duration_ms = ((mono_audio.len() as f32 / 16_000.0) * 1000.0).round() as i32;
    let is_live_chunk = audio_duration_ms <= LIVE_CHUNK_MAX_DURATION_MS;
    let prepared_audio = if is_live_chunk {
        match trim_live_chunk_silence(&mono_audio) {
            Some(trimmed) => trimmed,
            None => return Ok(String::new()),
        }
    } else {
        mono_audio
    };

    params.set_n_threads(threads);
    params.set_translate(false);
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_timestamps(true);

    if is_live_chunk {
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_no_context(true);
        params.set_single_segment(true);
        params.set_max_tokens(56);
    }

    let transcript = with_voice_bible_state(&context, |state| {
        state
            .full(params, &prepared_audio)
            .map_err(|e| format!("Whisper transcription failed: {}", e))?;

        Ok::<String, String>(
            state
                .as_iter()
                .map(|segment| segment.to_string())
                .collect::<Vec<_>>()
                .join(" "),
        )
    })?;
    let normalized = transcript.split_whitespace().collect::<Vec<_>>().join(" ");
    if is_live_chunk
        && (is_common_live_hallucination(&normalized) || is_suspicious_live_transcript(&normalized))
    {
        return Ok(String::new());
    }
    Ok(normalized)
}

fn trim_live_chunk_silence(audio: &[f32]) -> Option<Vec<f32>> {
    if audio.is_empty() {
        return None;
    }

    let mut first_active = None;
    let mut last_active = None;

    for (index, sample) in audio.iter().enumerate() {
        if sample.abs() >= LIVE_CHUNK_SILENCE_THRESHOLD {
            if first_active.is_none() {
                first_active = Some(index);
            }
            last_active = Some(index);
        }
    }

    let (first_active, last_active) = match (first_active, last_active) {
        (Some(first), Some(last)) => (first, last),
        _ => return None,
    };

    if last_active.saturating_sub(first_active) < LIVE_CHUNK_MIN_ACTIVE_SAMPLES {
        return None;
    }

    let start = first_active.saturating_sub(LIVE_CHUNK_EDGE_PADDING_SAMPLES);
    let end = (last_active + LIVE_CHUNK_EDGE_PADDING_SAMPLES).min(audio.len().saturating_sub(1));
    let trimmed = audio[start..=end].to_vec();

    let rms =
        (trimmed.iter().map(|sample| sample * sample).sum::<f32>() / trimmed.len() as f32).sqrt();
    if rms < 0.0065 {
        return None;
    }

    Some(trimmed)
}

fn is_common_live_hallucination(transcript: &str) -> bool {
    let normalized = transcript.trim().to_lowercase();
    COMMON_LIVE_HALLUCINATIONS
        .iter()
        .any(|candidate| normalized == *candidate)
}

fn is_suspicious_live_transcript(transcript: &str) -> bool {
    let trimmed = transcript.trim();
    if trimmed.is_empty() {
        return true;
    }

    if !trimmed.is_ascii() {
        return true;
    }

    let tokens: Vec<String> = trimmed
        .split_whitespace()
        .map(|token| {
            token
                .to_lowercase()
                .chars()
                .filter(|character| character.is_ascii_alphanumeric() || *character == '\'')
                .collect::<String>()
        })
        .filter(|token| !token.is_empty())
        .collect();

    if tokens.is_empty() {
        return true;
    }

    let mut repeated_run = 1usize;
    for index in 1..tokens.len() {
        if tokens[index] == tokens[index - 1] {
            repeated_run += 1;
            if repeated_run >= 4 {
                return true;
            }
        } else {
            repeated_run = 1;
        }
    }

    let unique_count = tokens
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len();
    if tokens.len() >= 4 && unique_count <= 2 {
        return true;
    }

    let mut counts = std::collections::HashMap::<&str, usize>::new();
    for token in &tokens {
        *counts.entry(token.as_str()).or_insert(0) += 1;
    }

    let highest_frequency = counts.values().copied().max().unwrap_or(0);
    tokens.len() >= 5 && (highest_frequency as f32 / tokens.len() as f32) >= 0.6
}

fn get_voice_bible_context() -> Result<Arc<WhisperContext>, String> {
    let cache = VOICE_BIBLE_CONTEXT.get_or_init(|| Mutex::new(None));
    let mut guard = cache
        .lock()
        .map_err(|_| "Failed to lock Whisper context cache".to_string())?;

    if let Some(context) = guard.as_ref() {
        return Ok(Arc::clone(context));
    }

    let model_path = ensure_voice_bible_model()?;
    let context = WhisperContext::new_with_params(
        model_path
            .to_str()
            .ok_or("Model path contains invalid UTF-8")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
    let cached = Arc::new(context);
    *guard = Some(Arc::clone(&cached));
    Ok(cached)
}

fn with_voice_bible_state<T>(
    context: &Arc<WhisperContext>,
    action: impl FnOnce(&mut WhisperState) -> Result<T, String>,
) -> Result<T, String> {
    let cache = VOICE_BIBLE_STATE.get_or_init(|| Mutex::new(None));
    let mut guard = cache
        .lock()
        .map_err(|_| "Failed to lock Whisper state cache".to_string())?;

    if guard.is_none() {
        let state = context
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {}", e))?;
        *guard = Some(state);
    }

    let result = match guard.as_mut() {
        Some(state) => action(state),
        None => Err("Whisper state cache was not initialized".to_string()),
    };

    if result.is_err() {
        *guard = None;
    }

    result
}

#[tauri::command]
async fn transcribe_voice_audio(wav_data: Vec<u8>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_voice_audio_blocking(wav_data))
        .await
        .map_err(|e| format!("Voice transcription task failed: {}", e))?
}

/// Start a tiny HTTP server that serves files from the frontend dist folder.
/// Runs in a background thread. Returns the port it bound to, or 0 if it failed.
fn start_overlay_server(resource_dir: std::path::PathBuf) -> u16 {
    // Resolve the uploads directory for serving user-uploaded files
    let uploads_dir = app_dir().ok().map(|d| d.join("uploads"));

    // In dev mode, resource_dir points to <project>/public/ but Vite multi-page
    // entry points (dock.html) live in the project root. Resolve the project
    // root so we can use it as a fallback when a file isn't found in resource_dir.
    let project_root_dir: Option<std::path::PathBuf> = {
        // resource_dir is <project>/public in dev — parent is the project root
        let parent = resource_dir.parent().map(|p| p.to_path_buf());
        // Only use this fallback if the parent contains dock.html (i.e. we're in dev)
        parent.filter(|p| p.join("dock.html").is_file())
    };

    // Try port 45678 first, then fall back to any available port
    let server = match tiny_http::Server::http("127.0.0.1:45678")
        .or_else(|_| tiny_http::Server::http("127.0.0.1:0"))
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Overlay Server] Failed to start: {}. Overlay URLs will fall back to window.location.origin.", e);
            return 0;
        }
    };

    let port = match server.server_addr().to_ip() {
        Some(addr) => addr.port(),
        None => {
            eprintln!("[Overlay Server] Could not determine server port.");
            return 0;
        }
    };
    OVERLAY_PORT.store(port, Ordering::Relaxed);
    println!(
        "[Overlay Server] Serving files from {:?} on http://127.0.0.1:{}",
        resource_dir, port
    );

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let url_path = request.url().to_string();
            // Strip query string and leading slash
            let clean = url_path.split('?').next().unwrap_or(&url_path);
            let clean = clean.trim_start_matches('/');

            // Friendly default route: allow opening the base URL directly
            // (http://127.0.0.1:<port>/) without a 404.
            let clean = if clean.is_empty() {
                "lower-third-overlay.html"
            } else {
                clean
            };

            // Security: don't allow path traversal
            if clean.contains("..") {
                let resp = tiny_http::Response::from_string("Forbidden").with_status_code(403);
                let _ = request.respond(resp);
                continue;
            }

            // API: list uploaded files as JSON array
            if clean == "api/uploads" {
                let mut files: Vec<String> = Vec::new();
                if let Some(ref udir) = uploads_dir {
                    if udir.exists() {
                        if let Ok(entries) = fs::read_dir(udir) {
                            for entry in entries.flatten() {
                                if let Ok(ft) = entry.file_type() {
                                    if ft.is_file() {
                                        if let Some(name) = entry.file_name().to_str() {
                                            files.push(name.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                files.sort();
                let json = serde_json::to_string(&files).unwrap_or_else(|_| "[]".to_string());
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: return the absolute path to the uploads directory
            if clean == "api/uploads-dir" {
                let dir_path = uploads_dir
                    .as_ref()
                    .and_then(|d| d.to_str())
                    .unwrap_or("")
                    .to_string();
                let json = serde_json::json!({ "path": dir_path }).to_string();
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: save a base64-encoded media file to disk, return absolute path
            // POST /api/save-media with JSON body { "fileName": "...", "dataUrl": "data:...;base64,..." }
            if clean == "api/save-media" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if let Err(_) = request.as_reader().read_to_string(&mut body) {
                    let resp =
                        tiny_http::Response::from_string("Bad Request").with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(val) => {
                        let file_name = val.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
                        let data_url = val.get("dataUrl").and_then(|v| v.as_str()).unwrap_or("");

                        if file_name.is_empty() || data_url.is_empty() {
                            let resp = tiny_http::Response::from_string(
                                r#"{"error":"fileName and dataUrl required"}"#,
                            )
                            .with_status_code(400);
                            let _ = request.respond(resp);
                            continue;
                        }

                        // Decode data-URL: "data:<mime>;base64,<data>"
                        let base64_data = if let Some(pos) = data_url.find(",") {
                            &data_url[pos + 1..]
                        } else {
                            data_url
                        };

                        use base64::Engine as _;
                        match base64::engine::general_purpose::STANDARD.decode(base64_data) {
                            Ok(bytes) => {
                                let file_bytes: &[u8] = &bytes;
                                if let Some(ref udir) = uploads_dir {
                                    let _ = fs::create_dir_all(udir);
                                    let safe_name = Path::new(file_name)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or(file_name);
                                    let dest = udir.join(safe_name);
                                    match fs::write(&dest, file_bytes) {
                                        Ok(_) => {
                                            let abs = dest.to_str().unwrap_or("").to_string();
                                            println!(
                                                "[Overlay API] Saved media: {} ({} bytes)",
                                                abs,
                                                bytes.len()
                                            );
                                            let json =
                                                serde_json::json!({ "path": abs }).to_string();
                                            let header = tiny_http::Header::from_bytes(
                                                "Content-Type",
                                                "application/json; charset=utf-8",
                                            )
                                            .unwrap();
                                            let cors = tiny_http::Header::from_bytes(
                                                "Access-Control-Allow-Origin",
                                                "*",
                                            )
                                            .unwrap();
                                            let resp = tiny_http::Response::from_string(json)
                                                .with_header(header)
                                                .with_header(cors);
                                            let _ = request.respond(resp);
                                        }
                                        Err(e) => {
                                            let json = serde_json::json!({ "error": format!("Write failed: {}", e) }).to_string();
                                            let resp = tiny_http::Response::from_string(json)
                                                .with_status_code(500);
                                            let _ = request.respond(resp);
                                        }
                                    }
                                } else {
                                    let resp = tiny_http::Response::from_string(
                                        r#"{"error":"uploads dir not available"}"#,
                                    )
                                    .with_status_code(500);
                                    let _ = request.respond(resp);
                                }
                            }
                            Err(e) => {
                                let json = serde_json::json!({ "error": format!("Base64 decode failed: {}", e) }).to_string();
                                let resp =
                                    tiny_http::Response::from_string(json).with_status_code(400);
                                let _ = request.respond(resp);
                            }
                        }
                        continue;
                    }
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Invalid JSON"}"#)
                            .with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                }
            }

            // API: save arbitrary dock JSON payloads to uploads/<name>.json
            // POST /api/save-dock-data with JSON body { "name": "...", "data": "..." }
            if clean == "api/save-dock-data" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let resp =
                        tiny_http::Response::from_string("Bad Request").with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }

                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(val) => {
                        let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let data = val.get("data").and_then(|v| v.as_str()).unwrap_or("");

                        if name.is_empty() {
                            let resp =
                                tiny_http::Response::from_string(r#"{"error":"name is required"}"#)
                                    .with_status_code(400);
                            let _ = request.respond(resp);
                            continue;
                        }

                        match write_dock_data(name, data) {
                            Ok(_) => {
                                let header = tiny_http::Header::from_bytes(
                                    "Content-Type",
                                    "application/json; charset=utf-8",
                                )
                                .unwrap();
                                let cors = tiny_http::Header::from_bytes(
                                    "Access-Control-Allow-Origin",
                                    "*",
                                )
                                .unwrap();
                                let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                                    .with_header(header)
                                    .with_header(cors);
                                let _ = request.respond(resp);
                            }
                            Err(err) => {
                                let json = serde_json::json!({ "error": err }).to_string();
                                let resp =
                                    tiny_http::Response::from_string(json).with_status_code(500);
                                let _ = request.respond(resp);
                            }
                        }
                    }
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Invalid JSON"}"#)
                            .with_status_code(400);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: save dock favorites — POST /api/save-dock-favorites with JSON body [...]
            // This allows the dock CEF browser to persist favorites back to the
            // overlay server even when it can't use Tauri invoke.
            if clean == "api/save-dock-favorites" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let resp =
                        tiny_http::Response::from_string("Bad Request").with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }
                // Validate it's valid JSON array
                let parsed: Result<Vec<String>, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(_) => {
                        if let Some(ref udir) = uploads_dir {
                            let _ = fs::create_dir_all(udir);
                            let path = udir.join("dock-lt-favorites.json");
                            match fs::write(&path, &body) {
                                Ok(_) => {
                                    println!(
                                        "[Overlay API] Saved dock-lt-favorites ({} bytes)",
                                        body.len()
                                    );
                                    let header = tiny_http::Header::from_bytes(
                                        "Content-Type",
                                        "application/json; charset=utf-8",
                                    )
                                    .unwrap();
                                    let cors = tiny_http::Header::from_bytes(
                                        "Access-Control-Allow-Origin",
                                        "*",
                                    )
                                    .unwrap();
                                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                                        .with_header(header)
                                        .with_header(cors);
                                    let _ = request.respond(resp);
                                }
                                Err(e) => {
                                    let json = format!(r#"{{"error":"Write failed: {}"}}"#, e);
                                    let resp = tiny_http::Response::from_string(json)
                                        .with_status_code(500);
                                    let _ = request.respond(resp);
                                }
                            }
                        } else {
                            let resp = tiny_http::Response::from_string(
                                r#"{"error":"uploads dir not available"}"#,
                            )
                            .with_status_code(500);
                            let _ = request.respond(resp);
                        }
                    }
                    Err(_) => {
                        let resp =
                            tiny_http::Response::from_string(r#"{"error":"Invalid JSON array"}"#)
                                .with_status_code(400);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // Resolve file path — check uploads dir for /uploads/* requests,
            // otherwise serve from the resource dir (public/)
            let mut file_path = if clean.starts_with("uploads/") {
                if let Some(ref udir) = uploads_dir {
                    // Strip the "uploads/" prefix and serve from uploads dir
                    let rel = clean.strip_prefix("uploads/").unwrap_or(clean);
                    let rel_path = Path::new(rel);
                    if !is_safe_relative_path(rel_path) {
                        let resp =
                            tiny_http::Response::from_string("Forbidden").with_status_code(403);
                        let _ = request.respond(resp);
                        continue;
                    }
                    udir.join(rel_path)
                } else {
                    resource_dir.join(clean)
                }
            } else {
                resource_dir.join(clean)
            };

            // Extensionless URL resolution: if the file doesn't exist and
            // has no extension, try appending .html (e.g. /dock → dock.html)
            if !file_path.exists() && file_path.extension().is_none() {
                let with_html = file_path.with_extension("html");
                if with_html.exists() && with_html.is_file() {
                    file_path = with_html;
                }
            }

            // Dev fallback: if the file wasn't found in resource_dir (public/)
            // but a matching Vite multi-page entry exists in the project root
            // (e.g. dock.html), redirect to the Vite dev server so it can
            // properly transform TSX/CSS imports.
            if !file_path.exists() || !file_path.is_file() {
                if let Some(ref root) = project_root_dir {
                    let mut root_candidate = root.join(clean);
                    if !root_candidate.exists() && root_candidate.extension().is_none() {
                        let with_html = root_candidate.with_extension("html");
                        if with_html.exists() && with_html.is_file() {
                            root_candidate = with_html;
                        }
                    }
                    if root_candidate.exists() && root_candidate.is_file() {
                        // Redirect to Vite dev server (localhost:1420) so it handles
                        // module transforms, HMR, etc.
                        let redirect_url = format!("http://localhost:1420/{}", clean);
                        let header =
                            tiny_http::Header::from_bytes("Location", redirect_url.as_str())
                                .unwrap();
                        let cors =
                            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                .unwrap();
                        let resp =
                            tiny_http::Response::from_string("Redirecting to Vite dev server")
                                .with_status_code(302)
                                .with_header(header)
                                .with_header(cors);
                        let _ = request.respond(resp);
                        continue;
                    }
                }
            }

            if file_path.exists() && file_path.is_file() {
                match fs::read(&file_path) {
                    Ok(data) => {
                        let content_type = match file_path.extension().and_then(|e| e.to_str()) {
                            Some("html") => "text/html; charset=utf-8",
                            Some("css") => "text/css; charset=utf-8",
                            Some("js") => "application/javascript; charset=utf-8",
                            Some("json") => "application/json; charset=utf-8",
                            Some("png") => "image/png",
                            Some("jpg") | Some("jpeg") => "image/jpeg",
                            Some("svg") => "image/svg+xml",
                            Some("gif") => "image/gif",
                            Some("webp") => "image/webp",
                            Some("mp4") => "video/mp4",
                            Some("webm") => "video/webm",
                            Some("mov") => "video/quicktime",
                            Some("mp3") => "audio/mpeg",
                            Some("wav") => "audio/wav",
                            Some("ogg") => "audio/ogg",
                            Some("woff") => "font/woff",
                            Some("woff2") => "font/woff2",
                            Some("ttf") => "font/ttf",
                            Some("otf") => "font/otf",
                            _ => "application/octet-stream",
                        };
                        let header =
                            tiny_http::Header::from_bytes("Content-Type", content_type).unwrap();
                        let cors =
                            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                .unwrap();
                        let resp = tiny_http::Response::from_data(data)
                            .with_header(header)
                            .with_header(cors);
                        let _ = request.respond(resp);
                    }
                    Err(_) => {
                        let resp = tiny_http::Response::from_string("Internal Server Error")
                            .with_status_code(500);
                        let _ = request.respond(resp);
                    }
                }
            } else {
                // SPA fallback: for client-side routes, serve index.html
                // so React Router can handle them. Note: dedicated HTML files
                // (like dock.html) are resolved above via the .html extension
                // fallback, so this only triggers for true SPA routes.
                let index_path = resource_dir.join("index.html");
                if index_path.exists() && index_path.is_file() {
                    match fs::read(&index_path) {
                        Ok(data) => {
                            let header = tiny_http::Header::from_bytes(
                                "Content-Type",
                                "text/html; charset=utf-8",
                            )
                            .unwrap();
                            let cors =
                                tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                    .unwrap();
                            let resp = tiny_http::Response::from_data(data)
                                .with_header(header)
                                .with_header(cors);
                            let _ = request.respond(resp);
                        }
                        Err(_) => {
                            let resp = tiny_http::Response::from_string("Internal Server Error")
                                .with_status_code(500);
                            let _ = request.respond(resp);
                        }
                    }
                } else {
                    let resp = tiny_http::Response::from_string("Not Found").with_status_code(404);
                    let _ = request.respond(resp);
                }
            }
        }
    });

    port
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Resolve the directory where overlay HTML files live.
            //
            // Bundled app:
            //   resource_dir() may be:
            //   - .../Contents/Resources/
            //   - .../Contents/Resources/dist/
            //   - .../Contents/Resources/_up_/dist/
            //
            // Local dev:
            //   fall back to <project>/public/.
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            match local_llm::seed_local_llm_model_from_bundle(&resource_dir) {
                Ok(true) => println!("[Tauri] Local LLM model ready."),
                Ok(false) => println!("[Tauri] No bundled local LLM model found."),
                Err(error) => eprintln!("[Tauri] Failed to seed local LLM model: {}", error),
            }

            let serve_dir = resolve_bundled_overlay_dir(&resource_dir)
                .or_else(resolve_dev_public_dir)
                .unwrap_or(resource_dir.clone());

            println!("[Tauri] Overlay resource dir : {:?}", resource_dir);
            println!("[Tauri] Overlay serve dir    : {:?}", serve_dir);
            println!("[Tauri] serve dir exists?     {}", serve_dir.exists());
            println!(
                "[Tauri] has overlay assets?   {}",
                has_overlay_assets(&serve_dir)
            );

            // Log what files are actually in the serve directory
            if serve_dir.exists() {
                if let Ok(entries) = fs::read_dir(&serve_dir) {
                    let names: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().to_string())
                        .collect();
                    println!(
                        "[Tauri] serve dir contents ({} entries): {:?}",
                        names.len(),
                        &names[..names.len().min(20)]
                    );
                }
            }

            let port = start_overlay_server(serve_dir);
            println!("[Tauri] Overlay server started on port {}", port);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_bg_image,
            save_upload_file,
            load_app_data,
            save_app_data,
            get_overlay_port,
            save_dock_data,
            load_dock_data,
            search_online_song_lyrics,
            get_voice_bible_runtime_status,
            prepare_voice_bible_model,
            transcribe_voice_audio,
            local_llm::get_local_llm_runtime_status,
            local_llm::install_local_llm_model,
            local_llm::generate_local_llm_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
