/**
 * bibleData.ts — Bible data service
 *
 * Provides:
 * - Bible data loaded from IndexedDB (downloaded translations) with
 *   fallback to the bundled KJV JSON in public/ for offline use.
 * - Fast search (book/chapter/verse lookup + keyword search)
 * - Book metadata (chapter counts, verse counts)
 * - Reference resolution (abbreviation → canonical name)
 *
 * Translation flow:
 * 1. Check in-memory cache
 * 2. Check IndexedDB "translations" store
 * 3. Fall back to /bible-kjv.json (bundled) if translation is "KJV"
 */

import type {
  BibleBookName,
  BiblePassage,
  BibleTranslation,
  BibleVerse,
  RawBibleData,
} from "./types";
import { BIBLE_BOOKS, BOOK_ABBREVS } from "./types";
import { getTranslationData } from "./bibleDb";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const translationCache = new Map<string, RawBibleData>();

// ---------------------------------------------------------------------------
// Load Bible data
// ---------------------------------------------------------------------------

/**
 * Load a translation into memory.
 * Priority: in-memory cache → IndexedDB → bundled JSON (KJV only).
 */
async function loadTranslation(t: BibleTranslation): Promise<RawBibleData> {
  const key = t.toUpperCase();
  const cached = translationCache.get(key);
  if (cached) return cached;

  // Try IndexedDB (downloaded translations)
  // Wrapped in try-catch because IndexedDB may be unavailable in some
  // environments (e.g. OBS CEF browser dock).
  try {
    const idbData = await getTranslationData(key);
    if (idbData) {
      translationCache.set(key, idbData);
      return idbData;
    }
  } catch {
    // IndexedDB unavailable — fall through to bundled fallback
  }

  try {
    const remoteUrl = `${import.meta.env.BASE_URL}uploads/dock-bible-translation-${key.toLowerCase()}.json`;
    const remoteRes = await fetch(remoteUrl);
    if (remoteRes.ok) {
      const remoteData: RawBibleData = await remoteRes.json();
      translationCache.set(key, remoteData);
      return remoteData;
    }
  } catch {
    // Ignore remote fallback failure — continue to bundled KJV fallback.
  }

  // Fallback: bundled KJV JSON in public/
  if (key === "KJV") {
    const url = `${import.meta.env.BASE_URL}bible-kjv.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load bundled KJV: ${res.statusText}`);
    }
    const data: RawBibleData = await res.json();
    translationCache.set(key, data);
    return data;
  }

  throw new Error(
    `Translation "${t}" is not installed. Download it from the Bible Library.`
  );
}

/**
 * Evict a translation from the in-memory cache
 * (e.g. after deleting from IndexedDB).
 */
export function evictTranslationCache(t: string): void {
  translationCache.delete(t.toUpperCase());
}

// ---------------------------------------------------------------------------
// Book name resolution
// ---------------------------------------------------------------------------

/** Build a lookup map: lowercase abbreviation/name → canonical book name */
const bookLookup = new Map<string, string>();
for (const book of BIBLE_BOOKS) {
  bookLookup.set(book.toLowerCase(), book);
  const abbrevs = BOOK_ABBREVS[book];
  if (abbrevs) {
    for (const a of abbrevs) {
      bookLookup.set(a.toLowerCase(), book);
      // Also without spaces for things like "1cor"
      bookLookup.set(a.toLowerCase().replace(/\s/g, ""), book);
    }
  }
}

/**
 * Resolve a user-typed book name or abbreviation to the canonical name.
 * Returns null if no match found.
 */
export function resolveBookName(input: string): BibleBookName | null {
  const key = input.trim().toLowerCase();

  // Exact match
  if (bookLookup.has(key)) {
    return bookLookup.get(key) as BibleBookName;
  }

  // No-space match (e.g. "1samuel" → "1 Samuel")
  const noSpace = key.replace(/\s/g, "");
  if (bookLookup.has(noSpace)) {
    return bookLookup.get(noSpace) as BibleBookName;
  }

  // Prefix match — find first book that starts with the input
  for (const book of BIBLE_BOOKS) {
    if (book.toLowerCase().startsWith(key)) {
      return book;
    }
  }

  // Try abbreviation prefix match
  for (const [abbr, canonical] of bookLookup.entries()) {
    if (abbr.startsWith(key)) {
      return canonical as BibleBookName;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Data queries
// ---------------------------------------------------------------------------

/**
 * Get the list of chapters for a book.
 */
export async function getChapterCount(
  book: string,
  translation: BibleTranslation = "KJV"
): Promise<number> {
  const data = await loadTranslation(translation);
  const bookData = data[book];
  if (!bookData) return 0;
  return Object.keys(bookData).length;
}

/**
 * Get the verse count for a specific chapter.
 */
export async function getVerseCount(
  book: string,
  chapter: number,
  translation: BibleTranslation = "KJV"
): Promise<number> {
  const data = await loadTranslation(translation);
  const chapterData = data[book]?.[String(chapter)];
  if (!chapterData) return 0;
  return Object.keys(chapterData).length;
}

/**
 * Get a specific verse.
 */
export async function getVerse(
  book: string,
  chapter: number,
  verse: number,
  translation: BibleTranslation = "KJV"
): Promise<BibleVerse | null> {
  const data = await loadTranslation(translation);
  const text = data[book]?.[String(chapter)]?.[String(verse)];
  if (!text) return null;

  const abbrevList = BOOK_ABBREVS[book];
  const abbrev = abbrevList?.[0] ?? book.slice(0, 3);

  return { book, chapter, verse, text, abbrev };
}

/**
 * Get a passage (range of verses).
 */
export async function getPassage(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
  translation: BibleTranslation = "KJV"
): Promise<BiblePassage> {
  const data = await loadTranslation(translation);
  const chapterData = data[book]?.[String(chapter)];
  const verses: BibleVerse[] = [];
  const abbrevList = BOOK_ABBREVS[book];
  const abbrev = abbrevList?.[0] ?? book.slice(0, 3);

  if (chapterData) {
    for (let v = startVerse; v <= endVerse; v++) {
      const text = chapterData[String(v)];
      if (text) {
        verses.push({ book, chapter, verse: v, text, abbrev });
      }
    }
  }

  const reference =
    startVerse === endVerse
      ? `${book} ${chapter}:${startVerse}`
      : `${book} ${chapter}:${startVerse}-${endVerse}`;

  return {
    reference,
    book,
    chapter,
    startVerse,
    endVerse,
    verses,
    translation,
  };
}

/**
 * Get an entire chapter.
 */
export async function getChapter(
  book: string,
  chapter: number,
  translation: BibleTranslation = "KJV"
): Promise<BiblePassage> {
  const verseCount = await getVerseCount(book, chapter, translation);
  return getPassage(book, chapter, 1, verseCount, translation);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  /** Highlighted snippet around the match */
  snippet: string;
}

/**
 * Keyword search across the entire Bible.
 * Returns up to `limit` results.
 */
export async function searchBible(
  query: string,
  translation: BibleTranslation = "KJV",
  limit = 50
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const data = await loadTranslation(translation);
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  outer: for (const book of BIBLE_BOOKS) {
    const bookData = data[book];
    if (!bookData) continue;

    for (const [chStr, chData] of Object.entries(bookData)) {
      for (const [vStr, text] of Object.entries(chData)) {
        if (text.toLowerCase().includes(lowerQuery)) {
          const idx = text.toLowerCase().indexOf(lowerQuery);
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + query.length + 30);
          const snippet =
            (start > 0 ? "..." : "") +
            text.slice(start, end) +
            (end < text.length ? "..." : "");

          results.push({
            book,
            chapter: parseInt(chStr, 10),
            verse: parseInt(vStr, 10),
            text,
            snippet,
          });

          if (results.length >= limit) break outer;
        }
      }
    }
  }

  return results;
}

/**
 * Get all books with their chapter counts (for the book picker UI).
 */
export async function getBookIndex(
  translation: BibleTranslation = "KJV"
): Promise<{ book: string; chapters: number }[]> {
  const data = await loadTranslation(translation);
  return BIBLE_BOOKS.map((book) => ({
    book,
    chapters: data[book] ? Object.keys(data[book]).length : 0,
  })).filter((b) => b.chapters > 0);
}

/**
 * Pre-load a translation into memory (call on app start).
 */
export async function preloadTranslation(
  t: BibleTranslation = "KJV"
): Promise<void> {
  await loadTranslation(t);
}
