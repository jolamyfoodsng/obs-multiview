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
const corpusCache = new Map<string, BibleCorpusEntry[]>();
const searchVocabularyCache = new Map<string, Map<string, number>>();

export interface BibleCorpusEntry {
  book: string;
  chapter: number;
  verse: number;
  endVerse: number;
  translation: string;
  reference: string;
  text: string;
}

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
  const key = t.toUpperCase();
  translationCache.delete(key);
  for (const cacheKey of [...corpusCache.keys()]) {
    if (cacheKey.startsWith(`${key}:`)) {
      corpusCache.delete(cacheKey);
    }
  }
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

interface RankedSearchResult extends SearchResult {
  score: number;
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "but",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);
const COMMON_SEARCH_TOKEN_ALIASES = new Map<string, string>([
  ["captity", "captivity"],
  ["captivty", "captivity"],
  ["captiviti", "captivity"],
  ["captivite", "captivity"],
  ["bonus", "bones"],
  ["word", "world"],
  ["load", "lord"],
  ["ion", "zion"],
  ["vally", "valley"],
  ["rejoyce", "rejoice"],
]);

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearch(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const filtered = tokens.filter(
    (token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token),
  );

  return filtered.length > 0 ? filtered : tokens.filter((token) => token.length > 1);
}

function normalizeSearchToken(token: string): string {
  if (token.length <= 4) return token;

  if (token.endsWith("eth") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("est") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ing") && token.length > 6) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("es") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  if (token.endsWith("e") && token.length > 6) {
    return token.slice(0, -1);
  }

  return token;
}

function tokensEquivalent(a: string, b: string): boolean {
  return normalizeSearchToken(a) === normalizeSearchToken(b);
}

function buildSearchVocabulary(
  translation: BibleTranslation,
  data: RawBibleData,
): Map<string, number> {
  const key = translation.toUpperCase();
  const cached = searchVocabularyCache.get(key);
  if (cached) return cached;

  const vocabulary = new Map<string, number>();

  for (const book of BIBLE_BOOKS) {
    const bookData = data[book];
    if (!bookData) continue;

    for (const chapterData of Object.values(bookData)) {
      for (const text of Object.values(chapterData)) {
        for (const token of normalizeSearchText(text).split(" ").filter(Boolean)) {
          if (token.length < 2) continue;
          vocabulary.set(token, (vocabulary.get(token) ?? 0) + 1);
        }
      }
    }
  }

  searchVocabularyCache.set(key, vocabulary);
  return vocabulary;
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  const aLength = a.length;
  const bLength = b.length;

  if (Math.abs(aLength - bLength) > maxDistance) {
    return maxDistance + 1;
  }

  const previous = new Array<number>(bLength + 1);
  const current = new Array<number>(bLength + 1);

  for (let column = 0; column <= bLength; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= aLength; row += 1) {
    current[0] = row;
    let rowMin = current[0];

    for (let column = 1; column <= bLength; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
      rowMin = Math.min(rowMin, current[column]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let column = 0; column <= bLength; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[bLength];
}

function repairSearchQuery(
  query: string,
  translation: BibleTranslation,
  data: RawBibleData,
): string {
  const normalized = normalizeSearchText(query);
  if (!normalized) return normalized;

  const vocabulary = buildSearchVocabulary(translation, data);
  const corrected = normalized.split(" ").filter(Boolean).map((token) => {
    const alias = COMMON_SEARCH_TOKEN_ALIASES.get(token);
    if (alias) return alias;

    if (
      token.length < 4 ||
      SEARCH_STOP_WORDS.has(token) ||
      /^\d+$/.test(token) ||
      vocabulary.has(token)
    ) {
      return token;
    }

    let bestCandidate: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestFrequency = -1;

    for (const [candidate, frequency] of vocabulary) {
      if (
        candidate.length < 4 ||
        Math.abs(candidate.length - token.length) > 2 ||
        candidate[0] !== token[0]
      ) {
        continue;
      }

      const distance = boundedEditDistance(token, candidate, 2);
      if (distance > 2) continue;

      if (
        distance < bestDistance ||
        (distance === bestDistance && frequency > bestFrequency)
      ) {
        bestCandidate = candidate;
        bestDistance = distance;
        bestFrequency = frequency;
      }
    }

    return bestCandidate && bestDistance <= 2 ? bestCandidate : token;
  });

  return corrected.join(" ")
    .replace(/\breverse\b(?=.*\bcaptivity\b)/g, "turn")
    .replace(/\s+/g, " ")
    .trim();
}

function orderedTokenCoverage(queryTokens: string[], textTokens: string[]): number {
  if (queryTokens.length === 0 || textTokens.length === 0) return 0;

  let matches = 0;
  let startIndex = 0;

  for (const queryToken of queryTokens) {
    const foundIndex = textTokens.findIndex(
      (textToken, index) => index >= startIndex && tokensEquivalent(queryToken, textToken),
    );
    if (foundIndex === -1) continue;
    matches += 1;
    startIndex = foundIndex + 1;
  }

  return matches / queryTokens.length;
}

function nearbyPairCoverage(queryTokens: string[], textTokens: string[]): number {
  if (queryTokens.length < 2 || textTokens.length === 0) return 0;

  let matchedPairs = 0;

  for (let index = 0; index < queryTokens.length - 1; index += 1) {
    const first = queryTokens[index];
    const second = queryTokens[index + 1];
    const firstIndex = textTokens.findIndex((textToken) => tokensEquivalent(first, textToken));
    if (firstIndex === -1) continue;

    const window = textTokens.slice(firstIndex + 1, firstIndex + 4);
    if (window.some((textToken) => tokensEquivalent(second, textToken))) {
      matchedPairs += 1;
    }
  }

  return matchedPairs / (queryTokens.length - 1);
}

function buildSearchSnippet(text: string, queryTokens: string[]): string {
  const lowerText = text.toLowerCase();
  let anchor = -1;

  for (const token of queryTokens) {
    const index = lowerText.indexOf(token.toLowerCase());
    if (index >= 0 && (anchor === -1 || index < anchor)) {
      anchor = index;
    }
  }

  if (anchor === -1) {
    return text.length > 100 ? `${text.slice(0, 100)}...` : text;
  }

  const start = Math.max(0, anchor - 32);
  const end = Math.min(text.length, anchor + 88);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function scoreVerseMatch(
  text: string,
  normalizedQuery: string,
  queryTokens: string[],
): number {
  if (!normalizedQuery) return 0;

  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return 0;

  if (normalizedText.includes(normalizedQuery)) {
    return 1;
  }

  const textTokens = normalizedText.split(" ").filter(Boolean);
  if (textTokens.length === 0 || queryTokens.length === 0) return 0;

  const tokenMatches = queryTokens.filter((token) =>
    textTokens.some((textToken) => tokensEquivalent(token, textToken)),
  ).length;
  if (tokenMatches === 0) return 0;

  const tokenCoverage = tokenMatches / queryTokens.length;
  const orderedCoverage = orderedTokenCoverage(queryTokens, textTokens);
  const pairCoverage = nearbyPairCoverage(queryTokens, textTokens);
  const prefixBonus =
    queryTokens.length > 0 && normalizedText.startsWith(queryTokens[0]) ? 0.06 : 0;

  return Math.min(
    1,
    tokenCoverage * 0.55 + orderedCoverage * 0.25 + pairCoverage * 0.14 + prefixBonus,
  );
}

async function searchBibleInTranslation(
  query: string,
  translation: BibleTranslation,
  limit: number,
): Promise<RankedSearchResult[]> {
  const data = await loadTranslation(translation);
  const results: RankedSearchResult[] = [];
  const repairedQuery = repairSearchQuery(query, translation, data);
  const queryVariants = Array.from(
    new Set([normalizeSearchText(query), normalizeSearchText(repairedQuery)].filter(Boolean)),
  ).map((variant) => ({
    normalizedQuery: variant,
    queryTokens: tokenizeSearch(variant),
  }));

  for (const book of BIBLE_BOOKS) {
    const bookData = data[book];
    if (!bookData) continue;

    for (const [chStr, chData] of Object.entries(bookData)) {
      for (const [vStr, text] of Object.entries(chData)) {
        let bestScore = 0;
        let bestTokens: string[] = [];

        for (const variant of queryVariants) {
          const score = scoreVerseMatch(text, variant.normalizedQuery, variant.queryTokens);
          if (score > bestScore) {
            bestScore = score;
            bestTokens = variant.queryTokens;
          }
        }

        const score = bestScore;
        if (score < 0.42) continue;

        results.push({
          book,
          chapter: parseInt(chStr, 10),
          verse: parseInt(vStr, 10),
          text,
          snippet: buildSearchSnippet(text, bestTokens),
          score,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
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

  const selectedTranslation = translation.toUpperCase() as BibleTranslation;
  const primaryResults = await searchBibleInTranslation(query, selectedTranslation, limit);
  const shouldSearchKjv =
    selectedTranslation !== "KJV" &&
    (primaryResults.length === 0 || primaryResults[0].score < 0.78);

  const fallbackResults = shouldSearchKjv
    ? await searchBibleInTranslation(query, "KJV", limit)
    : [];

  const merged = [...primaryResults, ...fallbackResults]
    .reduce<RankedSearchResult[]>((accumulator, candidate) => {
      if (
        accumulator.some(
          (existing) =>
            existing.book === candidate.book &&
            existing.chapter === candidate.chapter &&
            existing.verse === candidate.verse,
        )
      ) {
        return accumulator;
      }
      accumulator.push(candidate);
      return accumulator;
    }, [])
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return merged.map(({ score: _score, ...result }) => result);
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

/**
 * Build a cached verse/window corpus for fuzzy and semantic search.
 */
export async function getBibleCorpus(
  translation: BibleTranslation = "KJV",
  maxWindowSize = 3,
): Promise<BibleCorpusEntry[]> {
  const key = `${translation.toUpperCase()}:${maxWindowSize}`;
  const cached = corpusCache.get(key);
  if (cached) return cached;

  const data = await loadTranslation(translation);
  const entries: BibleCorpusEntry[] = [];

  for (const book of BIBLE_BOOKS) {
    const bookData = data[book];
    if (!bookData) continue;

    for (const [chapterStr, chapterData] of Object.entries(bookData)) {
      const chapter = parseInt(chapterStr, 10);
      const verses = Object.entries(chapterData)
        .map(([verseStr, text]) => ({
          verse: parseInt(verseStr, 10),
          text,
        }))
        .sort((a, b) => a.verse - b.verse);

      for (let index = 0; index < verses.length; index += 1) {
        let combinedText = "";

        for (
          let windowSize = 1;
          windowSize <= maxWindowSize && index + windowSize - 1 < verses.length;
          windowSize += 1
        ) {
          const item = verses[index + windowSize - 1];
          combinedText = combinedText ? `${combinedText} ${item.text}` : item.text;

          const startVerse = verses[index].verse;
          const endVerse = item.verse;
          entries.push({
            book,
            chapter,
            verse: startVerse,
            endVerse,
            translation: translation.toUpperCase(),
            reference:
              startVerse === endVerse
                ? `${book} ${chapter}:${startVerse}`
                : `${book} ${chapter}:${startVerse}-${endVerse}`,
            text: combinedText,
          });
        }
      }
    }
  }

  corpusCache.set(key, entries);
  return entries;
}
