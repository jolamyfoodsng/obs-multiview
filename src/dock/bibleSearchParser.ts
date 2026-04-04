/**
 * bibleSearchParser.ts — Smart Bible reference parser for the dock
 *
 * Parses fuzzy queries like:
 *   "gen1vs1"     → Genesis 1:1
 *   "g11"         → Genesis 1:1
 *   "gn11"        → Genesis 1:1
 *   "gs11"        → Genesis 1:1
 *   "genesis 1:1" → Genesis 1:1
 *   "jn3:16"      → John 3:16
 *   "1cor13"      → 1 Corinthians 13
 *   "ps23"        → Psalms 23
 *   "rev22:21"    → Revelation 22:21
 *
 * Returns a list of match candidates ranked by confidence.
 */

import { OT_BOOKS, NT_BOOKS, BOOK_CHAPTERS } from "./dockTypes";

const ALL_BOOKS = [...OT_BOOKS, ...NT_BOOKS];

const ROMAN_NUMERAL_PREFIX: Record<"1" | "2" | "3", string> = {
  "1": "i",
  "2": "ii",
  "3": "iii",
};

// ---------------------------------------------------------------------------
// Abbreviation map — multiple short forms per book
// ---------------------------------------------------------------------------

interface BookAlias {
  book: string;
  aliases: string[];
}

const BOOK_ALIASES: BookAlias[] = [
  { book: "Genesis", aliases: ["gen", "ge", "gn", "gs"] },
  { book: "Exodus", aliases: ["exo", "ex", "exod"] },
  { book: "Leviticus", aliases: ["lev", "le", "lv"] },
  { book: "Numbers", aliases: ["num", "nu", "nm", "nb"] },
  { book: "Deuteronomy", aliases: ["deut", "de", "dt"] },
  { book: "Joshua", aliases: ["josh", "jos", "jsh"] },
  { book: "Judges", aliases: ["judg", "jdg", "jg", "jdgs"] },
  { book: "Ruth", aliases: ["ruth", "rth", "ru"] },
  { book: "1 Samuel", aliases: ["1sam", "1sa", "1sm", "1s"] },
  { book: "2 Samuel", aliases: ["2sam", "2sa", "2sm", "2s"] },
  { book: "1 Kings", aliases: ["1kgs", "1ki", "1k", "1kin"] },
  { book: "2 Kings", aliases: ["2kgs", "2ki", "2k", "2kin"] },
  { book: "1 Chronicles", aliases: ["1chr", "1ch", "1chron"] },
  { book: "2 Chronicles", aliases: ["2chr", "2ch", "2chron"] },
  { book: "Ezra", aliases: ["ezr", "ez"] },
  { book: "Nehemiah", aliases: ["neh", "ne"] },
  { book: "Esther", aliases: ["esth", "est", "es"] },
  { book: "Job", aliases: ["job", "jb"] },
  { book: "Psalms", aliases: ["psa", "ps", "pss", "psalm"] },
  { book: "Proverbs", aliases: ["prov", "pro", "pr", "prv"] },
  { book: "Ecclesiastes", aliases: ["eccl", "ecc", "ec", "eccles"] },
  { book: "Song of Solomon", aliases: ["song", "sos", "ss", "sol", "sg"] },
  { book: "Isaiah", aliases: ["isa", "is"] },
  { book: "Jeremiah", aliases: ["jer", "je", "jr"] },
  { book: "Lamentations", aliases: ["lam", "la"] },
  { book: "Ezekiel", aliases: ["ezek", "eze", "ezk"] },
  { book: "Daniel", aliases: ["dan", "da", "dn"] },
  { book: "Hosea", aliases: ["hos", "ho"] },
  { book: "Joel", aliases: ["joel", "jl"] },
  { book: "Amos", aliases: ["amos", "am"] },
  { book: "Obadiah", aliases: ["obad", "ob", "obadia", "obadya", "obedia", "obediah"] },
  { book: "Jonah", aliases: ["jonah", "jon", "jnh"] },
  { book: "Micah", aliases: ["mic", "mc"] },
  { book: "Nahum", aliases: ["nah", "na"] },
  { book: "Habakkuk", aliases: ["hab", "hb"] },
  { book: "Zephaniah", aliases: ["zeph", "zep", "zp"] },
  { book: "Haggai", aliases: ["hag", "hg"] },
  { book: "Zechariah", aliases: ["zech", "zec", "zc"] },
  { book: "Malachi", aliases: ["mal", "ml"] },
  { book: "Matthew", aliases: ["matt", "mat", "mt"] },
  { book: "Mark", aliases: ["mark", "mrk", "mk"] },
  { book: "Luke", aliases: ["luke", "luk", "lk"] },
  { book: "John", aliases: ["john", "joh", "jhn", "jn", "j"] },
  { book: "Acts", aliases: ["acts", "act", "ac"] },
  { book: "Romans", aliases: ["rom", "ro", "rm"] },
  { book: "1 Corinthians", aliases: ["1cor", "1co"] },
  { book: "2 Corinthians", aliases: ["2cor", "2co"] },
  { book: "Galatians", aliases: ["gal", "ga"] },
  { book: "Ephesians", aliases: ["eph", "ep"] },
  { book: "Philippians", aliases: ["phil", "php", "pp"] },
  { book: "Colossians", aliases: ["col", "co", "coloss", "collossians"] },
  { book: "1 Thessalonians", aliases: ["1thes", "1th", "1thess"] },
  { book: "2 Thessalonians", aliases: ["2thes", "2th", "2thess"] },
  { book: "1 Timothy", aliases: ["1tim", "1ti", "1tm"] },
  { book: "2 Timothy", aliases: ["2tim", "2ti", "2tm"] },
  { book: "Titus", aliases: ["titus", "tit", "ti"] },
  { book: "Philemon", aliases: ["phm", "philem", "pm"] },
  { book: "Hebrews", aliases: ["heb", "he"] },
  { book: "James", aliases: ["jas", "ja", "jm"] },
  { book: "1 Peter", aliases: ["1pet", "1pe", "1pt", "1p"] },
  { book: "2 Peter", aliases: ["2pet", "2pe", "2pt", "2p"] },
  { book: "1 John", aliases: ["1jn", "1jo", "1joh", "1john"] },
  { book: "2 John", aliases: ["2jn", "2jo", "2joh", "2john"] },
  { book: "3 John", aliases: ["3jn", "3jo", "3joh", "3john"] },
  { book: "Jude", aliases: ["jude", "jud", "jd"] },
  { book: "Revelation", aliases: ["rev", "re", "rv"] },
];

function getExtendedAliases(entry: BookAlias): string[] {
  const aliases = new Set(entry.aliases);
  const numberedMatch = entry.book.match(/^([123])\s+(.+)$/);

  if (numberedMatch) {
    const digit = numberedMatch[1] as "1" | "2" | "3";
    const romanPrefix = ROMAN_NUMERAL_PREFIX[digit];

    for (const alias of entry.aliases) {
      if (alias.startsWith(digit)) {
        aliases.add(`${romanPrefix}${alias.slice(1)}`);
      }
    }

    aliases.add(`${romanPrefix}${numberedMatch[2].toLowerCase().replace(/\s+/g, "")}`);
  }

  return [...aliases];
}

// Build a flat lookup: alias → book name
const ALIAS_MAP = new Map<string, string>();
for (const entry of BOOK_ALIASES) {
  // Add all aliases
  for (const alias of getExtendedAliases(entry)) {
    ALIAS_MAP.set(alias, entry.book);
  }
  // Also add the full lowercase name
  ALIAS_MAP.set(entry.book.toLowerCase().replace(/\s+/g, ""), entry.book);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface BibleSearchResult {
  /** Full book name */
  book: string;
  /** Chapter number (or null if only book matched) */
  chapter: number | null;
  /** Verse number (or null if only book+chapter matched) */
  verse: number | null;
  /** Display label, e.g. "Genesis 1:1" */
  label: string;
  /** Confidence 0-100 */
  score: number;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a fuzzy Bible reference query into search results.
 *
 * Handles formats like:
 *   "gen 1:1", "gen1vs1", "gen1.1", "gen11", "g11",
 *   "genesis 1 1", "1cor13:4", "ps23", "jn3:16",
 *   "j316" → John 3:16 AND John 31:6
 *   "jn316" → John 3:16 AND John 31:6
 */
export function parseBibleSearch(query: string): BibleSearchResult[] {
  const raw = query.trim();
  if (!raw) return [];

  // Normalize: lowercase, collapse whitespace
  const q = raw.toLowerCase().replace(/\s+/g, " ");

  // ── Strategy 1: Split into book-part and numbers ──
  // Try to extract a leading book identifier and trailing numbers
  // Patterns:
  //   "genesis 1:1"  → book="genesis", nums="1:1"
  //   "gen1vs1"      → book="gen", nums="1vs1"
  //   "g11"          → book="g", nums="11"
  //   "1cor13:4"     → book="1cor", nums="13:4"
  //   "1 john 3:16"  → book="1john", nums="3:16"

  // Handle numbered books: "1 samuel" → "1samuel", "2 kings" → "2kings"
  const normalized = q.replace(/^((?:\d|iii|ii|i))\s+/, "$1");

  // Split into book text and number portion
  // Match: optional leading digit, then letters (book name), then numbers/separators
  const splitMatch = normalized.match(
    /^(\d?[a-z]+)\s*(\d.*)?$/
  );

  if (!splitMatch) {
    // Try plain text match against book names
    return matchBooksByName(q);
  }

  const bookPart = splitMatch[1]; // e.g. "gen", "1cor", "g", "j", "jn"
  const numPart = splitMatch[2] ?? ""; // e.g. "1:1", "1vs1", "11", "316"

  // Find matching books
  const matchedBooks = findBooks(bookPart);

  if (matchedBooks.length === 0) return [];

  // Parse chapter:verse candidates from number part
  const candidates = parseChapterVerseCandidates(numPart);

  // Build results
  const results: BibleSearchResult[] = [];

  for (const { book, score: bookScore } of matchedBooks) {
    const maxCh = BOOK_CHAPTERS[book] ?? 1;

    if (maxCh === 1 && numPart) {
      const singleChapterCandidates = parseSingleChapterVerseCandidates(numPart);
      if (singleChapterCandidates.length > 0) {
        for (const candidate of singleChapterCandidates) {
          results.push({
            book,
            chapter: 1,
            verse: candidate.verse,
            label: `${book} 1:${candidate.verse}`,
            score: bookScore + candidate.confidence,
          });
        }
        continue;
      }
    }

    if (candidates.length === 0) {
      // Book-only match
      results.push({
        book,
        chapter: null,
        verse: null,
        label: book,
        score: bookScore,
      });
    } else {
      for (const { chapter, verse, confidence } of candidates) {
        if (chapter !== null && chapter >= 1 && chapter <= maxCh) {
          if (verse !== null) {
            results.push({
              book,
              chapter,
              verse,
              label: `${book} ${chapter}:${verse}`,
              score: bookScore + confidence,
            });
          } else {
            results.push({
              book,
              chapter,
              verse: null,
              label: `${book} ${chapter}`,
              score: bookScore + confidence - 5,
            });
          }
        } else if (chapter !== null && verse !== null) {
          for (const repaired of recoverInvalidExplicitCandidates(chapter, verse, maxCh, confidence)) {
            results.push({
              book,
              chapter: repaired.chapter,
              verse: repaired.verse,
              label: `${book} ${repaired.chapter}:${repaired.verse}`,
              score: bookScore + repaired.confidence,
            });
          }
        }
      }

      // If no candidates matched the book's chapter range, still show the book
      const hasValidResult = results.some((r) => r.book === book && r.chapter !== null);
      if (!hasValidResult) {
        results.push({
          book,
          chapter: null,
          verse: null,
          label: book,
          score: bookScore - 10,
        });
      }
    }
  }

  // Deduplicate by label
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.label)) return false;
    seen.add(r.label);
    return true;
  });

  // Sort by score descending
  deduped.sort((a, b) => b.score - a.score);

  return deduped.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBooks(bookPart: string): Array<{ book: string; score: number }> {
  const results: Array<{ book: string; score: number }> = [];

  // 1. Exact alias match (highest priority)
  const exact = ALIAS_MAP.get(bookPart);
  if (exact) {
    results.push({ book: exact, score: 100 });
    return results; // Exact match — don't add fuzzy results
  }

  // 2. Prefix match on aliases
  for (const entry of BOOK_ALIASES) {
    for (const alias of getExtendedAliases(entry)) {
      if (alias.startsWith(bookPart)) {
        results.push({ book: entry.book, score: 80 });
        break; // One match per book is enough
      }
    }
  }

  // 3. Prefix match on full book names
  if (results.length === 0) {
    for (const book of ALL_BOOKS) {
      const bookLower = book.toLowerCase().replace(/\s+/g, "");
      if (bookLower.startsWith(bookPart)) {
        results.push({ book, score: 70 });
      }
    }
  }

  // 4. Substring match (lowest priority)
  if (results.length === 0) {
    for (const book of ALL_BOOKS) {
      const bookLower = book.toLowerCase().replace(/\s+/g, "");
      if (bookLower.includes(bookPart)) {
        results.push({ book, score: 50 });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.book)) return false;
    seen.add(r.book);
    return true;
  });
}

interface ChapterVerseCandidate {
  chapter: number | null;
  verse: number | null;
  /** Higher = more likely the intended interpretation */
  confidence: number;
}

function recoverInvalidExplicitCandidates(
  chapter: number,
  verse: number | null,
  maxChapter: number,
  confidence: number,
): ChapterVerseCandidate[] {
  if (verse === null || chapter <= maxChapter || maxChapter >= 10) {
    return [];
  }

  const recovered: ChapterVerseCandidate[] = [];
  const seen = new Set<string>();
  const chapterDigits = String(chapter);

  const pushRecovered = (nextChapter: number, nextVerse: number | null, penalty: number) => {
    if (!Number.isFinite(nextChapter) || nextChapter < 1 || nextChapter > maxChapter) return;
    if (nextVerse !== null && (!Number.isFinite(nextVerse) || nextVerse < 1)) return;
    const key = `${nextChapter}:${nextVerse ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    recovered.push({
      chapter: nextChapter,
      verse: nextVerse,
      confidence: Math.max(10, confidence - penalty),
    });
  };

  if (chapterDigits.endsWith("0")) {
    const strippedChapter = Number.parseInt(chapterDigits.slice(0, -1), 10);
    pushRecovered(strippedChapter, verse, 4);
  }

  if (chapterDigits.length >= 2) {
    const mergedChapter = Number.parseInt(chapterDigits[0], 10);
    const mergedVerseDigits = `${chapterDigits.slice(1)}${verse}`;
    const mergedVerse = Number.parseInt(mergedVerseDigits.replace(/^0+/, "") || "0", 10);
    pushRecovered(mergedChapter, mergedVerse, 6);
  }

  return recovered;
}

function parseSingleChapterVerseCandidates(numPart: string): ChapterVerseCandidate[] {
  if (!numPart) return [];

  const cleaned = numPart
    .replace(/vs/gi, ":")
    .replace(/v/gi, ":")
    .replace(/\./g, ":")
    .replace(/[-–—]/g, ":")
    .replace(/\s+/g, ":");

  const parts = cleaned.split(":").filter(Boolean);
  if (parts.length === 0) return [];

  if (parts.length >= 2) {
    const chapter = parseInt(parts[0], 10);
    const verse = parseInt(parts[1], 10);
    if (chapter === 1 && Number.isFinite(verse) && verse >= 1) {
      return [{ chapter: 1, verse, confidence: 32 }];
    }
  }

  if (parts.length === 1) {
    const verse = parseInt(parts[0], 10);
    if (Number.isFinite(verse) && verse >= 1) {
      return [{ chapter: 1, verse, confidence: parts[0].length === 1 ? 26 : 23 }];
    }
  }

  return [];
}

/**
 * Parse a number portion into one or more chapter:verse candidates.
 *
 * For explicit separators ("3:16", "3vs16", "3.16") → single result.
 * For jammed numbers ("316") → try all split points:
 *   "316" → 3:16 (conf 25), 31:6 (conf 20)
 *   "11"  → 1:1 (conf 15), chapter 11 (conf 10)
 */
function parseChapterVerseCandidates(numPart: string): ChapterVerseCandidate[] {
  if (!numPart) return [];

  // Clean separators: "vs", "v", ".", ":"  all become ":"
  const cleaned = numPart
    .replace(/vs/gi, ":")
    .replace(/v/gi, ":")
    .replace(/\./g, ":")
    .replace(/[-–—]/g, ":")
    .replace(/\s+/g, ":");

  // Split by ":"
  const parts = cleaned.split(":").filter(Boolean);

  if (parts.length === 0) return [];

  // Two or more explicit parts → unambiguous chapter:verse
  if (parts.length >= 2) {
    const ch = parseInt(parts[0], 10);
    const vs = parseInt(parts[1], 10);
    if (isNaN(ch)) return [];
    return [{
      chapter: ch,
      verse: isNaN(vs) ? null : vs,
      confidence: 30,
    }];
  }

  // Single jammed number like "316", "11", "2316" etc.
  const digits = parts[0];
  const num = parseInt(digits, 10);
  if (isNaN(num)) return [];

  const candidates: ChapterVerseCandidate[] = [];

  // Try all possible split positions: digits[0..i] : digits[i..]
  // e.g. "316" → "3":"16", "31":"6"
  for (let i = 1; i < digits.length; i++) {
    const chStr = digits.substring(0, i);
    const vsStr = digits.substring(i);
    // Skip if verse part has a leading zero (e.g. "30:06" is odd)
    if (vsStr.length > 1 && vsStr[0] === "0") continue;

    const ch = parseInt(chStr, 10);
    const vs = parseInt(vsStr, 10);
    if (ch < 1 || vs < 1) continue;

    // For 3+ digit numbers (like "316"), the ch:vs split is almost certainly
    // intended → give high confidence to early splits.
    // For 2-digit numbers (like "23"), chapter-only is usually intended,
    // so give splits lower confidence.
    let conf: number;
    if (digits.length >= 3) {
      // "316" → 3:16 (conf 25), 31:6 (conf 18)
      conf = 25 - (i - 1) * 7;
    } else {
      // "23" → 2:3 (conf 12)  — lower than chapter-only (15)
      conf = 12 - (i - 1) * 3;
    }
    candidates.push({ chapter: ch, verse: vs, confidence: Math.max(conf, 8) });
  }

  // Also add the whole number as chapter-only (if reasonable)
  if (num >= 1 && num <= 150) {
    // For 2-digit numbers, chapter-only gets higher confidence.
    // For 3+ digits, it's unlikely to be a chapter number, so lower confidence.
    const chapterConf = digits.length <= 2 ? 15 : 5;
    candidates.push({ chapter: num, verse: null, confidence: chapterConf });
  }

  return candidates;
}

function matchBooksByName(query: string): BibleSearchResult[] {
  const results: BibleSearchResult[] = [];
  const q = query.toLowerCase().replace(/\s+/g, "");

  for (const book of ALL_BOOKS) {
    const bookLower = book.toLowerCase().replace(/\s+/g, "");
    if (bookLower.includes(q) || q.includes(bookLower)) {
      results.push({
        book,
        chapter: null,
        verse: null,
        label: book,
        score: bookLower.startsWith(q) ? 90 : 60,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 8);
}
