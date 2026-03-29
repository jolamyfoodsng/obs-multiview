/**
 * bibleApi.ts — Bible catalog API + XML download & parser
 *
 * Connects to the OBS Church Studio Bible API to:
 * - Search/browse the catalog of ~1000 Bibles
 * - Download Bible XML from presigned R2 URLs
 * - Parse XML → RawBibleData JSON format for local storage
 *
 * Uses @tauri-apps/plugin-http `fetch` to bypass CORS restrictions
 * (API doesn't serve Access-Control-Allow-Origin headers).
 *
 * API base: https://obs-multiview-backend-api.fly.dev
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { BIBLE_BOOKS } from "./types";
import type { RawBibleData, CatalogBible } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "https://obs-multiview-backend-api.fly.dev/api";

/** Top 4 free / public-domain Bibles to auto-download on first run */
export const AUTO_DOWNLOAD_BIBLES: { id: string; abbr: string; name: string }[] = [
  { id: "bbea9716-19bd-4b3d-abd0-c7bb0f0e5e12", abbr: "KJV", name: "King James Version" },
  { id: "d65f0bd4-2c36-43dc-afa4-4bc985db1994", abbr: "ASV", name: "American Standard Version" },
  { id: "e9edbd9d-9dd7-4595-92c4-4306555f3776", abbr: "NKJV", name: "New King James Version" },
  { id: "b3b38c78-a876-40b5-8aad-ec92ca65a548", abbr: "ERV", name: "English Revised Version" },
];

// ---------------------------------------------------------------------------
// Book number → name mapping
// ---------------------------------------------------------------------------

/**
 * Maps XML `<book number="N">` to canonical book name.
 * BIBLE_BOOKS is already in standard Protestant order (1-66).
 */
const BOOK_NUMBER_TO_NAME: Record<number, string> = {};
BIBLE_BOOKS.forEach((name, idx) => {
  BOOK_NUMBER_TO_NAME[idx + 1] = name; // 1-indexed
});

// ---------------------------------------------------------------------------
// Catalog API
// ---------------------------------------------------------------------------

export interface CatalogSearchParams {
  query?: string;
  language?: string;
  country?: string;
  version?: string;
  page?: number;
  limit?: number;
}

export interface CatalogResponse {
  items: CatalogBible[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * Search / list Bibles in the catalog.
 */
export async function searchCatalog(
  params: CatalogSearchParams = {}
): Promise<CatalogResponse> {
  const url = new URL(`${API_BASE}/bibles`);
  if (params.query) url.searchParams.set("query", params.query);
  if (params.language) url.searchParams.set("language", params.language);
  if (params.country) url.searchParams.set("country", params.country);
  if (params.version) url.searchParams.set("version", params.version);
  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.limit) url.searchParams.set("limit", String(params.limit));

  let res: Response;
  try {
    res = await tauriFetch(url.toString());
  } catch (err) {
    throw new Error(
      "Unable to reach the Bible catalog server. Please check your internet connection and try again."
    );
  }
  if (!res.ok) throw new Error(`Catalog search failed (${res.status}). Please try again later.`);

  try {
    const json = await res.json();
    // Normalize: API may return the array directly or wrapped in { items, total, ... }
    if (Array.isArray(json)) {
      return { items: json, total: json.length, page: 1, limit: json.length, pages: 1 };
    }
    // Ensure expected shape
    const items = json.items ?? json.data ?? [];
    const total = json.total ?? json.count ?? 0;
    const limit = json.limit ?? 20;
    const page = json.page ?? 1;
    const pages = json.pages ?? json.totalPages ?? Math.max(1, Math.ceil(total / limit));
    return { items, total, page, limit, pages };
  } catch (err) {
    throw new Error(`Catalog search: invalid JSON response — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Fetch ALL unique languages from the catalog by paginating through all results.
 * Caches the result so subsequent calls are instant.
 */
let _cachedLanguages: string[] | null = null;
export async function fetchAllLanguages(): Promise<string[]> {
  if (_cachedLanguages) return _cachedLanguages;

  const languages = new Set<string>();
  let page = 1;
  const limit = 100;

  try {
    // Fetch pages until we've seen all items
    while (true) {
      const result = await searchCatalog({ page, limit, language: "" });
      for (const item of result.items) {
        if (item.language) languages.add(item.language);
      }
      if (page * limit >= result.total) break;
      page++;
      // Safety cap — don't loop forever
      if (page > 20) break;
    }
  } catch (err) {
    console.error("[bibleApi] Failed to fetch all languages:", err);
  }

  _cachedLanguages = Array.from(languages).sort((a, b) => a.localeCompare(b));
  return _cachedLanguages;
}

/**
 * Get a single Bible's metadata by ID.
 */
export async function getCatalogBible(id: string): Promise<CatalogBible> {
  let res: Response;
  try {
    res = await tauriFetch(`${API_BASE}/bibles/${id}`);
  } catch (err) {
    throw new Error(
      "Unable to reach the Bible catalog server. Please check your internet connection and try again."
    );
  }
  if (!res.ok) throw new Error(`Failed to fetch Bible details (${res.status}). Please try again later.`);
  return res.json();
}

/**
 * Get a presigned download URL for a Bible.
 */
async function getDownloadUrl(id: string): Promise<string> {
  let res: Response;
  try {
    res = await tauriFetch(`${API_BASE}/bibles/${id}/download`);
  } catch (err) {
    throw new Error(
      "Unable to reach the download server. Please check your internet connection and try again."
    );
  }
  if (!res.ok)
    throw new Error(`Failed to get download URL (${res.status}). Please try again later.`);
  const data = await res.json();
  return data.url;
}

// ---------------------------------------------------------------------------
// XML Download + Parse
// ---------------------------------------------------------------------------

/**
 * Download a Bible XML from the API and parse it into RawBibleData.
 *
 * Calls `onProgress` with a 0–1 value during download (if body is streamable).
 * Returns the parsed JSON ready for IndexedDB storage.
 */
export async function downloadAndParseBible(
  id: string,
  onProgress?: (fraction: number) => void
): Promise<RawBibleData> {
  // Step 1: get presigned URL
  const url = await getDownloadUrl(id);

  // Step 2: download XML with progress tracking
  const xml = await fetchWithProgress(url, onProgress);

  // Step 3: parse XML → RawBibleData
  return parseXmlToBibleData(xml);
}

/**
 * Fetch text content with download progress tracking.
 */
async function fetchWithProgress(
  url: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
  let res: Response;
  try {
    res = await tauriFetch(url);
  } catch (err) {
    throw new Error(`Download network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  // If no body or no onProgress, just read as text
  if (!res.body || !onProgress) {
    return res.text();
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (contentLength > 0) {
      onProgress(Math.min(received / contentLength, 1));
    }
  }

  // Combine chunks and decode
  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8").decode(combined);
}

/**
 * Parse Bible XML into the RawBibleData JSON format:
 * { "Genesis": { "1": { "1": "In the beginning...", "2": "..." } } }
 *
 * XML format:
 * <bible translation="English KJV" status="Public Domain">
 *   <testament name="Old">
 *     <book number="1">
 *       <chapter number="1">
 *         <verse number="1">In the beginning...</verse>
 *       </chapter>
 *     </book>
 *   </testament>
 * </bible>
 */
export function parseXmlToBibleData(xml: string): RawBibleData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent}`);
  }

  const data: RawBibleData = {};

  const bookElements = doc.querySelectorAll("book");
  for (const bookEl of bookElements) {
    const bookNumber = parseInt(bookEl.getAttribute("number") || "0", 10);
    const bookName = BOOK_NUMBER_TO_NAME[bookNumber];
    if (!bookName) continue; // skip unknown book numbers

    const bookData: Record<string, Record<string, string>> = {};

    const chapterElements = bookEl.querySelectorAll("chapter");
    for (const chapterEl of chapterElements) {
      const chapterNum = chapterEl.getAttribute("number") || "0";
      const chapterData: Record<string, string> = {};

      const verseElements = chapterEl.querySelectorAll("verse");
      for (const verseEl of verseElements) {
        const verseNum = verseEl.getAttribute("number") || "0";
        const text = (verseEl.textContent || "").trim();
        if (text) {
          chapterData[verseNum] = text;
        }
      }

      if (Object.keys(chapterData).length > 0) {
        bookData[chapterNum] = chapterData;
      }
    }

    if (Object.keys(bookData).length > 0) {
      data[bookName] = bookData;
    }
  }

  return data;
}
