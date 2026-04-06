import { invoke } from "@tauri-apps/api/core";

export interface OnlineLyricsSearchResult {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  artist: string;
  url: string;
  preview: string;
  lyrics: string;
  thumbnailUrl?: string | null;
}

interface WordPressLyricsSource {
  sourceId: string;
  sourceName: string;
  apiUrl: string;
}

interface WpRenderedField {
  rendered?: string;
}

interface WpPost {
  link?: string;
  title?: WpRenderedField;
  content?: WpRenderedField;
  jetpack_featured_media_url?: string | null;
}

interface SpotifyOEmbedResponse {
  title?: string;
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

const WORDPRESS_LYRICS_SOURCES: WordPressLyricsSource[] = [
  {
    sourceId: "gospellyricsng",
    sourceName: "GospellyricsNG",
    apiUrl: "https://gospellyricsng.com/wp-json/wp/v2/posts",
  },
  {
    sourceId: "nglyrics",
    sourceName: "NgLyrics",
    apiUrl: "https://www.nglyrics.net/wp-json/wp/v2/posts",
  },
  {
    sourceId: "ceenaija",
    sourceName: "CeeNaija",
    apiUrl: "https://www.ceenaija.com/wp-json/wp/v2/posts",
  },
];

const ONLINE_LYRICS_RESULT_LIMIT = 12;
const SPOTIFY_TRACK_URL_PATTERN = /(?:open\.spotify\.com\/track\/|spotify:track:)([A-Za-z0-9]+)/i;

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function formatOnlineLyricsSearchError(error: unknown): string {
  const message = errorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("unknown command")
    || lowerMessage.includes("command")
    || lowerMessage.includes("__tauri")
    || lowerMessage.includes("desktop backend")
  ) {
    return `Online lyrics search needs the desktop app backend. Restart the app, then try again. (${message})`;
  }

  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network")) {
    return "Online lyrics search could not reach the lyrics sources. Check the connection and try again.";
  }

  return `Online lyrics search failed: ${message}`;
}

function cleanInlineText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlFragmentToText(html: string): string {
  const withLineBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, "\n");

  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(withLineBreaks, "text/html");
    document.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
    return normalizeTextBlock(document.body?.textContent ?? "");
  }

  return normalizeTextBlock(withLineBreaks.replace(/<[^>]+>/g, " "));
}

function normalizeTextBlock(text: string): string {
  const lines: string[] = [];
  let lastBlank = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanInlineText(rawLine);
    if (!line) {
      if (!lastBlank && lines.length > 0) {
        lines.push("");
      }
      lastBlank = true;
      continue;
    }
    lines.push(line);
    lastBlank = false;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function shouldBreakLyricsLine(line: string): boolean {
  const lowerLine = line.toLowerCase();
  return (
    lowerLine.startsWith("discover more from")
    || lowerLine.startsWith("subscribe to get")
    || lowerLine.startsWith("share on ")
    || lowerLine.startsWith("email a link")
    || lowerLine.startsWith("like loading")
    || lowerLine === "related"
    || lowerLine === "more"
    || lowerLine === "print"
    || lowerLine.includes("thanks for visiting")
    || lowerLine.includes("property and copyright")
    || lowerLine.includes("personal and educational purpose only")
  );
}

function shouldDropLyricsLine(line: string): boolean {
  const lowerLine = line.toLowerCase();
  return (
    line.length > 260
    || lowerLine.includes("gospellyricsng.com")
    || lowerLine.includes("nglyrics.net")
    || lowerLine.includes("download mp3")
    || lowerLine.includes("watch video")
    || lowerLine.includes("follow us")
    || lowerLine.includes("subscribe")
    || lowerLine.includes("share this")
    || lowerLine.includes("related posts")
    || lowerLine.includes("copyright")
    || lowerLine.includes("ceenaija")
    || lowerLine.includes("download here")
    || lowerLine.includes("get mp3 audio")
    || lowerLine.includes("stream, and share")
    || lowerLine.startsWith("lyrics:")
    || /\(opens in new window\)/i.test(line)
    || /^(share|tweet|pin|whatsapp|telegram|facebook|email|pinterest|tumblr|x|lyrics)$/i.test(line)
  );
}

function pruneLyricsText(text: string): string {
  const lines = normalizeTextBlock(text).split("\n");
  const lyricsStart = lines.findIndex((rawLine) => {
    const lowerLine = cleanInlineText(rawLine).toLowerCase();
    return lowerLine === "lyrics" || lowerLine.startsWith("lyrics:");
  });
  const searchableLines = lyricsStart >= 0 ? lines.slice(lyricsStart + 1) : lines;
  const keep: string[] = [];

  for (const rawLine of searchableLines) {
    const line = cleanInlineText(rawLine);

    if (!line) {
      if (keep.length > 0 && keep[keep.length - 1] !== "") {
        keep.push("");
      }
      continue;
    }

    if (shouldBreakLyricsLine(line)) {
      break;
    }

    if (shouldDropLyricsLine(line)) {
      continue;
    }

    keep.push(line);
  }

  return keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanOnlineLyricsResult(result: OnlineLyricsSearchResult): OnlineLyricsSearchResult {
  const lyrics = pruneLyricsText(result.lyrics);
  const fallbackLyrics = lyrics || pruneLyricsText(result.preview);

  return {
    ...result,
    lyrics: fallbackLyrics,
    preview: buildPreview(fallbackLyrics || result.preview),
  };
}

function extractTitleArtist(rawTitle: string, fallbackText: string): { title: string; artist: string } {
  let title = cleanInlineText(rawTitle)
    .replace(/\s*\|\s*.*$/i, "")
    .replace(/\s*\(mp3\s*[&+]\s*lyrics\)\s*$/i, "")
    .replace(/\s*mp3\s*[&+]\s*lyrics\s*$/i, "")
    .replace(/\s*lyrics\s*$/i, "")
    .trim();
  let artist = "";
  const markerLines = fallbackText
    .split(/\r?\n/)
    .slice(0, 100)
    .map((line) => cleanInlineText(line));
  const lyricsMarkerLine = markerLines.find((line) => /^lyrics:\s+.+?\s+by\s+.+/i.test(line));
  const downloadMarkerLine = markerLines.find((line) =>
    /^download\s+.+?\s+(?:mp3\s+audio|audio|mp3)\s+by\s+.+/i.test(line),
  );
  const lyricsMarkerMatch = lyricsMarkerLine?.match(/^lyrics:\s+(.+?)\s+by\s+(.+)$/i);
  const downloadMarkerMatch = downloadMarkerLine?.match(/^download\s+(.+?)\s+(?:mp3\s+audio|audio|mp3)\s+by\s+(.+)$/i);

  if (lyricsMarkerMatch) {
    return {
      title: cleanInlineText(lyricsMarkerMatch[1]).replace(/\s*\(mp3\s*[&+]\s*lyrics\)\s*$/i, ""),
      artist: cleanInlineText(lyricsMarkerMatch[2]),
    };
  }

  if (downloadMarkerMatch) {
    return {
      title: cleanInlineText(downloadMarkerMatch[1]).replace(/\s*\(mp3\s*[&+]\s*lyrics\)\s*$/i, ""),
      artist: cleanInlineText(downloadMarkerMatch[2]),
    };
  }

  const byMatch = title.match(/^(.+?)\s+(?:by|ft\.?|feat\.?|featuring)\s+(.+)$/i);
  const dashMatch = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);

  if (byMatch) {
    title = cleanInlineText(byMatch[1]);
    artist = cleanInlineText(byMatch[2]);
  } else if (dashMatch) {
    title = cleanInlineText(dashMatch[1]);
    artist = cleanInlineText(dashMatch[2]);
  }

  if (!artist) {
    const firstLine = cleanInlineText(fallbackText.split(/\r?\n/).find(Boolean) ?? "");
    const fallbackMatch = firstLine.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (fallbackMatch && fallbackMatch[1].length <= 80 && fallbackMatch[2].length <= 120) {
      title = title || cleanInlineText(fallbackMatch[1]);
      artist = cleanInlineText(fallbackMatch[2]);
    }
  }

  return { title, artist };
}

function buildPreview(text: string): string {
  return normalizeTextBlock(text)
    .split("\n")
    .map((line) => cleanInlineText(line))
    .filter(Boolean)
    .slice(0, 3)
    .join(" / ")
    .slice(0, 180);
}

function tokenize(value: string): string[] {
  return cleanInlineText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1);
}

function computeScore(query: string, title: string, artist: string, preview: string, lyrics: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const titleText = `${title} ${artist}`.toLowerCase();
  const haystackTokens = new Set(tokenize(`${title} ${artist} ${preview} ${lyrics.slice(0, 1200)}`));
  let score = 0;

  for (const token of queryTokens) {
    if (titleText.includes(token)) {
      score += 28;
    } else if (haystackTokens.has(token)) {
      score += 12;
    }
  }

  if (titleText.includes(query.toLowerCase())) {
    score += 60;
  }

  return score;
}

export function isSpotifyTrackLyricsQuery(query: string): boolean {
  return SPOTIFY_TRACK_URL_PATTERN.test(query);
}

async function resolveSpotifyTrackTitle(query: string): Promise<string> {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Spotify returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SpotifyOEmbedResponse;
  const title = cleanInlineText(payload.title ?? "");

  if (!title) {
    throw new Error("Spotify did not return a track title");
  }

  return title;
}

async function resolveLyricsSearchQuery(query: string): Promise<string> {
  if (!isSpotifyTrackLyricsQuery(query)) {
    return query;
  }

  return resolveSpotifyTrackTitle(query);
}

function buildWordPressResult(
  source: WordPressLyricsSource,
  post: WpPost,
  query: string
): OnlineLyricsSearchResult | null {
  const url = cleanInlineText(post.link ?? "");
  const rawTitle = htmlFragmentToText(post.title?.rendered ?? "");
  const rawContent = post.content?.rendered ?? "";
  const contentText = htmlFragmentToText(rawContent);
  const lyrics = pruneLyricsText(contentText);
  const { title, artist } = extractTitleArtist(rawTitle, contentText);
  const preview = buildPreview(lyrics || contentText);
  const score = computeScore(query, title, artist, preview, lyrics);

  if (!url || !title || (lyrics.length < 40 && preview.length < 24) || score < 12) {
    return null;
  }

  return {
    id: `${source.sourceId}:${url}`,
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    title,
    artist,
    url,
    preview,
    lyrics,
    thumbnailUrl: post.jetpack_featured_media_url ?? null,
  };
}

async function searchWordPressLyricsSource(
  source: WordPressLyricsSource,
  query: string
): Promise<OnlineLyricsSearchResult[]> {
  const url = new URL(source.apiUrl);
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "8");
  url.searchParams.set("_fields", "link,title,content,jetpack_featured_media_url");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`${source.sourceName} returned HTTP ${response.status}`);
  }

  const posts = (await response.json()) as WpPost[];
  if (!Array.isArray(posts)) {
    throw new Error(`${source.sourceName} returned an invalid response`);
  }

  return posts
    .map((post) => buildWordPressResult(source, post, query))
    .filter((result): result is OnlineLyricsSearchResult => result !== null);
}

async function searchOnlineSongLyricsFallback(query: string): Promise<OnlineLyricsSearchResult[]> {
  const settledResults = await Promise.allSettled(
    WORDPRESS_LYRICS_SOURCES.map((source) => searchWordPressLyricsSource(source, query))
  );
  const results = settledResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  if (results.length === 0 && settledResults.every((result) => result.status === "rejected")) {
    const firstError = settledResults.find((result) => result.status === "rejected");
    throw new Error(firstError?.reason ? errorMessage(firstError.reason) : "No online lyrics sources responded");
  }

  const seenUrls = new Set<string>();
  return results
    .filter((result) => {
      const key = result.url.toLowerCase();
      if (seenUrls.has(key)) {
        return false;
      }
      seenUrls.add(key);
      return true;
    })
    .slice(0, ONLINE_LYRICS_RESULT_LIMIT);
}

export async function searchOnlineSongLyrics(query: string): Promise<OnlineLyricsSearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 3) {
    return [];
  }
  const resolvedQuery = await resolveLyricsSearchQuery(trimmedQuery);

  let invokeError: unknown = null;

  if (hasTauriRuntime()) {
    try {
      const results = await invoke<OnlineLyricsSearchResult[]>("search_online_song_lyrics", {
        query: resolvedQuery,
      });

      return Array.isArray(results) ? results.map(cleanOnlineLyricsResult) : [];
    } catch (error) {
      invokeError = error;
      console.warn("[onlineLyricsService] Desktop lyrics search failed; trying browser fallback:", error);
    }
  }

  try {
    return (await searchOnlineSongLyricsFallback(resolvedQuery)).map(cleanOnlineLyricsResult);
  } catch (fallbackError) {
    if (invokeError) {
      throw new Error(
        `Desktop search failed (${errorMessage(invokeError)}). Browser fallback failed (${errorMessage(fallbackError)}).`
      );
    }

    if (!hasTauriRuntime()) {
      throw new Error(`Desktop backend is unavailable. Browser fallback failed (${errorMessage(fallbackError)}).`);
    }

    throw fallbackError;
  }
}
