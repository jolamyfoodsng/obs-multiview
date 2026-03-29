// Tauri Rust backend — OBS Church Studio
//
// Commands:
//   save_bg_image      — persist background image to disk (for OBS image_source)
//   save_upload_file   — persist uploaded logo to disk
//   load_app_data      — read app_data.json (or return "{}" if missing)
//   save_app_data      — write app_data.json
//   get_overlay_port   — return the port of the local overlay HTTP server
//
// On startup, a lightweight HTTP server is spawned on a localhost port
// to serve overlay HTML files (Bible, Worship, Lower Third) so that OBS
// browser sources can access them. Tauri's internal protocol (tauri:// or
// https://tauri.localhost) is NOT reachable by OBS/CEF, so we need a real
// localhost server.

use std::fs;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicU16, Ordering};
use tauri::Manager;

/// The port the overlay server is running on (set at startup).
static OVERLAY_PORT: AtomicU16 = AtomicU16::new(0);

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
        println!("[Overlay Resolve] {:?} → {}", dir, if found { "FOUND" } else { "miss" });
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

/// Save dock-shared data to a JSON file in the uploads directory.
/// The overlay server can then serve it to the dock page.
/// `name` is the filename (e.g. "worship-songs"), `.json` is appended.
#[tauri::command]
fn save_dock_data(name: String, data: String) -> Result<(), String> {
    let safe = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if safe.is_empty() {
        return Err("Invalid data name".to_string());
    }
    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|e| format!("Failed to create uploads dir: {}", e))?;
    let path = uploads_dir.join(format!("{}.json", safe));
    fs::write(&path, &data).map_err(|e| format!("Failed to write dock data: {}", e))?;
    println!("[Tauri] Saved dock data '{}' ({} bytes)", safe, data.len());
    Ok(())
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
    println!("[Overlay Server] Serving files from {:?} on http://127.0.0.1:{}", resource_dir, port);

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
                let resp = tiny_http::Response::from_string("Forbidden")
                    .with_status_code(403);
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
                    "Content-Type", "application/json; charset=utf-8"
                ).unwrap();
                let cors = tiny_http::Header::from_bytes(
                    "Access-Control-Allow-Origin", "*"
                ).unwrap();
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
                    "Content-Type", "application/json; charset=utf-8"
                ).unwrap();
                let cors = tiny_http::Header::from_bytes(
                    "Access-Control-Allow-Origin", "*"
                ).unwrap();
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
                    let resp = tiny_http::Response::from_string("Bad Request")
                        .with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(val) => {
                        let file_name = val.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
                        let data_url = val.get("dataUrl").and_then(|v| v.as_str()).unwrap_or("");

                        if file_name.is_empty() || data_url.is_empty() {
                            let resp = tiny_http::Response::from_string(r#"{"error":"fileName and dataUrl required"}"#)
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
                                            println!("[Overlay API] Saved media: {} ({} bytes)", abs, bytes.len());
                                            let json = serde_json::json!({ "path": abs }).to_string();
                                            let header = tiny_http::Header::from_bytes(
                                                "Content-Type", "application/json; charset=utf-8"
                                            ).unwrap();
                                            let cors = tiny_http::Header::from_bytes(
                                                "Access-Control-Allow-Origin", "*"
                                            ).unwrap();
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
                                    let resp = tiny_http::Response::from_string(r#"{"error":"uploads dir not available"}"#)
                                        .with_status_code(500);
                                    let _ = request.respond(resp);
                                }
                            }
                            Err(e) => {
                                let json = serde_json::json!({ "error": format!("Base64 decode failed: {}", e) }).to_string();
                                let resp = tiny_http::Response::from_string(json)
                                    .with_status_code(400);
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

            // API: save dock favorites — POST /api/save-dock-favorites with JSON body [...]
            // This allows the dock CEF browser to persist favorites back to the
            // overlay server even when it can't use Tauri invoke.
            if clean == "api/save-dock-favorites" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let resp = tiny_http::Response::from_string("Bad Request")
                        .with_status_code(400);
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
                                    println!("[Overlay API] Saved dock-lt-favorites ({} bytes)", body.len());
                                    let header = tiny_http::Header::from_bytes(
                                        "Content-Type", "application/json; charset=utf-8"
                                    ).unwrap();
                                    let cors = tiny_http::Header::from_bytes(
                                        "Access-Control-Allow-Origin", "*"
                                    ).unwrap();
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
                            let resp = tiny_http::Response::from_string(r#"{"error":"uploads dir not available"}"#)
                                .with_status_code(500);
                            let _ = request.respond(resp);
                        }
                    }
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Invalid JSON array"}"#)
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
                        let resp = tiny_http::Response::from_string("Forbidden")
                            .with_status_code(403);
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
                        let header = tiny_http::Header::from_bytes(
                            "Location", redirect_url.as_str()
                        ).unwrap();
                        let cors = tiny_http::Header::from_bytes(
                            "Access-Control-Allow-Origin", "*"
                        ).unwrap();
                        let resp = tiny_http::Response::from_string("Redirecting to Vite dev server")
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
                        let header = tiny_http::Header::from_bytes(
                            "Content-Type", content_type
                        ).unwrap();
                        let cors = tiny_http::Header::from_bytes(
                            "Access-Control-Allow-Origin", "*"
                        ).unwrap();
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
                                "Content-Type", "text/html; charset=utf-8"
                            ).unwrap();
                            let cors = tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Origin", "*"
                            ).unwrap();
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
                    let resp = tiny_http::Response::from_string("Not Found")
                        .with_status_code(404);
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

            let serve_dir = resolve_bundled_overlay_dir(&resource_dir)
                .or_else(resolve_dev_public_dir)
                .unwrap_or(resource_dir.clone());

            println!("[Tauri] Overlay resource dir : {:?}", resource_dir);
            println!("[Tauri] Overlay serve dir    : {:?}", serve_dir);
            println!("[Tauri] serve dir exists?     {}", serve_dir.exists());
            println!("[Tauri] has overlay assets?   {}", has_overlay_assets(&serve_dir));

            // Log what files are actually in the serve directory
            if serve_dir.exists() {
                if let Ok(entries) = fs::read_dir(&serve_dir) {
                    let names: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().to_string())
                        .collect();
                    println!("[Tauri] serve dir contents ({} entries): {:?}",
                        names.len(), &names[..names.len().min(20)]);
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
            save_dock_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
