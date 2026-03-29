/**
 * SmartSearchModal.tsx — Global Bible Quick Search (⌘K / Ctrl+K)
 *
 * Spotlight-style search modal for instant scripture lookup.
 * Parses fuzzy references like "j316", "Matt 5", "Ps 23:1-3", "1 Cor 13".
 *
 * Features:
 * - Smart reference parsing (abbreviations, shorthand, ranges)
 * - Keyword search fallback (when input doesn't match a reference)
 * - Keyboard navigation (↑↓ arrows, Enter to select, Escape to close)
 * - Best match + close matches layout (inspired by smart-bible-controller-modal.html)
 * - Production-safe: never crashes the app, all errors handled gracefully
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { resolveBookName, getVerse, getPassage, searchBible, getChapterCount, getVerseCount } from "../bibleData";
import { BIBLE_BOOKS, BOOK_ABBREVS } from "../types";
import Icon from "../../components/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmartSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when user selects a verse/passage. Parent navigates to it. */
  onSelect: (book: string, chapter: number, verse: number) => void;
  /** Current translation to search in */
  translation: string;
  /** Optional initial query to pre-fill (e.g. when user pressed a letter key to open) */
  initialQuery?: string;
}

interface SearchResult {
  id: string;
  reference: string;
  text: string;
  book: string;
  chapter: number;
  verse: number;
  type: "exact" | "close" | "keyword";
}

// ---------------------------------------------------------------------------
// Reference parser — handles fuzzy shorthand like "j316", "matt5:1", "ps23"
// ---------------------------------------------------------------------------

interface ParsedRef {
  book: string | null;        // Resolved canonical book name
  chapter: number | null;
  verse: number | null;
  endVerse: number | null;    // For ranges like "3:16-18"
  raw: string;
}

/**
 * Parse a user-typed query into a structured Bible reference.
 *
 * Supports formats:
 *   "John 3:16"       → { book: "John", chapter: 3, verse: 16 }
 *   "j316"            → { book: "John", chapter: 3, verse: 16 } (compact)
 *   "j 3:16"          → { book: "John", chapter: 3, verse: 16 }
 *   "Ps 23"           → { book: "Psalms", chapter: 23, verse: null }
 *   "Matt 5:1-12"     → { book: "Matthew", chapter: 5, verse: 1, endVerse: 12 }
 *   "1 Cor 13"        → { book: "1 Corinthians", chapter: 13, verse: null }
 *   "gen1:1"          → { book: "Genesis", chapter: 1, verse: 1 }
 */
function parseReference(input: string): ParsedRef {
  const raw = input.trim();
  if (!raw) return { book: null, chapter: null, verse: null, endVerse: null, raw };

  // Try standard reference pattern: <book> <chapter>:<verse>[-<endVerse>]
  // Book can be "1 John", "2 Samuel", "Song of Solomon", etc.
  const stdMatch = raw.match(
    /^((?:\d\s*)?[a-zA-Z][a-zA-Z\s]*?)[\s.]*(\d+)(?:\s*[:.]?\s*(\d+))?(?:\s*[-–]\s*(\d+))?$/
  );

  if (stdMatch) {
    const bookInput = stdMatch[1].trim();
    const chapter = parseInt(stdMatch[2], 10);
    const verse = stdMatch[3] ? parseInt(stdMatch[3], 10) : null;
    const endVerse = stdMatch[4] ? parseInt(stdMatch[4], 10) : null;
    const book = resolveBookName(bookInput);

    if (book) {
      return { book, chapter, verse, endVerse, raw };
    }
  }

  // Try compact form: "j316" → book=J(ohn), chapter=3, verse=16
  // Pattern: letters (book abbreviation) followed by digits (ch[verse])
  const compactMatch = raw.match(/^(\d?\s*[a-zA-Z]+)(\d{1,3})(\d{2})$/);
  if (compactMatch) {
    const bookInput = compactMatch[1].trim();
    const chapter = parseInt(compactMatch[2], 10);
    const verse = parseInt(compactMatch[3], 10);
    const book = resolveBookName(bookInput);

    if (book && chapter > 0 && verse > 0) {
      return { book, chapter, verse, endVerse: null, raw };
    }
  }

  // Try book-only: just a book name with no numbers
  const bookOnly = resolveBookName(raw);
  if (bookOnly) {
    return { book: bookOnly, chapter: null, verse: null, endVerse: null, raw };
  }

  return { book: null, chapter: null, verse: null, endVerse: null, raw };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SmartSearchModal({
  open,
  onClose,
  onSelect,
  translation,
  initialQuery = "",
}: SmartSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when modal opens, pre-fill with initialQuery if provided
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setResults([]);
      setSelectedIndex(0);
      setLoading(false);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Place cursor at end
          const len = initialQuery.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 50);
    }
  }, [open, initialQuery]);

  // ── Search logic ──
  const performSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const parsed = parseReference(q);
        const newResults: SearchResult[] = [];

        // ── Helper: find ALL books matching a letter prefix ──
        // Priority 1: book name or abbreviation STARTS WITH the letters
        // Priority 2: book name or abbreviation CONTAINS the letters
        const findAllMatchingBooks = (letters: string): { startsWithBooks: string[]; containsBooks: string[] } => {
          const lc = letters.toLowerCase();
          const startsWithBooks: string[] = [];
          const containsBooks: string[] = [];
          const seen = new Set<string>();

          for (const book of BIBLE_BOOKS) {
            let isStartsWith = false;
            let isContains = false;

            // Check canonical name
            if (book.toLowerCase().startsWith(lc)) isStartsWith = true;
            else if (book.toLowerCase().includes(lc)) isContains = true;

            // Check abbreviations
            const abbrevs = BOOK_ABBREVS[book] || [];
            for (const ab of abbrevs) {
              if (ab.toLowerCase().startsWith(lc) || ab.toLowerCase().replace(/\s/g, "").startsWith(lc)) {
                isStartsWith = true;
              } else if (ab.toLowerCase().includes(lc)) {
                isContains = true;
              }
            }

            if (isStartsWith && !seen.has(book)) {
              startsWithBooks.push(book);
              seen.add(book);
            } else if (isContains && !seen.has(book)) {
              containsBooks.push(book);
              seen.add(book);
            }
          }

          return { startsWithBooks, containsBooks };
        };

        // ── Helper: try to add a verse result, avoiding duplicates ──
        const addResult = async (
          book: string, chapter: number, verse: number,
          type: "exact" | "close" | "keyword", prefix: string,
        ) => {
          if (newResults.some((r) => r.book === book && r.chapter === chapter && r.verse === verse)) return;
          try {
            const v = await getVerse(book, chapter, verse, translation);
            if (v) {
              newResults.push({
                id: `${prefix}-${v.book}-${v.chapter}-${v.verse}`,
                reference: `${v.book} ${v.chapter}:${v.verse}`,
                text: v.text,
                book: v.book,
                chapter: v.chapter,
                verse: v.verse,
                type,
              });
            }
          } catch { /* skip */ }
        };

        // ── Detect if this is a compact/ambiguous input (letters + digits, no separator) ──
        const compactMatch = q.match(/^(\d?\s*[a-zA-Z]+?)(\d+)$/);
        const isCompactForm = !!compactMatch;
        const letterPart = compactMatch ? compactMatch[1].trim() : null;
        const digitPart = compactMatch ? compactMatch[2] : null;

        // ── Standard exact reference path (has separator like ":" or space between chapter/verse) ──
        if (parsed.book && parsed.chapter && parsed.verse && !isCompactForm) {
          // Exact match
          try {
            if (parsed.endVerse && parsed.endVerse > parsed.verse) {
              const passage = await getPassage(
                parsed.book, parsed.chapter, parsed.verse, parsed.endVerse, translation
              );
              if (passage.verses.length > 0) {
                newResults.push({
                  id: `exact-${parsed.book}-${parsed.chapter}-${parsed.verse}`,
                  reference: passage.reference,
                  text: passage.verses.map((v) => v.text).join(" "),
                  book: parsed.book,
                  chapter: parsed.chapter,
                  verse: parsed.verse,
                  type: "exact",
                });
              }
            } else {
              await addResult(parsed.book, parsed.chapter, parsed.verse, "exact", "exact");
            }
          } catch { /* skip */ }

          // Nearby verses
          try {
            const chVerseCount = await getVerseCount(parsed.book, parsed.chapter, translation);
            const nearbyVerses = [parsed.verse - 1, parsed.verse + 1, parsed.verse + 2]
              .filter((v) => v > 0 && v <= chVerseCount && v !== parsed.verse);
            for (const v of nearbyVerses.slice(0, 3)) {
              await addResult(parsed.book, parsed.chapter, v, "close", "close");
            }
          } catch { /* skip */ }

        } else if (isCompactForm && letterPart && digitPart) {
          // ── COMPACT FORM: "G11", "j316", "gn11", "matt5" ──
          // Find ALL books matching the letter portion
          const { startsWithBooks, containsBooks } = findAllMatchingBooks(letterPart);
          const allBooks = [...startsWithBooks, ...containsBooks];

          if (allBooks.length > 0) {
            // For each matching book, try all digit splits
            // "11" → ch11:v1 (default), ch1:v1 (split)
            // "316" → ch3:v16, ch31:v6
            const MAX_BOOK_RESULTS = 12;
            let totalAdded = 0;

            for (const book of allBooks) {
              if (totalAdded >= MAX_BOOK_RESULTS) break;
              const isStartsWith = startsWithBooks.includes(book);

              // 1. Default interpretation: all digits = chapter, verse 1
              const defaultChapter = parseInt(digitPart, 10);
              if (defaultChapter > 0) {
                await addResult(book, defaultChapter, 1,
                  isStartsWith && totalAdded === 0 ? "exact" : "close", "compact");
                totalAdded = newResults.length;
              }

              // 2. Try digit splits: ch:v combos
              for (let splitAt = 1; splitAt < digitPart.length; splitAt++) {
                if (totalAdded >= MAX_BOOK_RESULTS) break;
                const ch = parseInt(digitPart.slice(0, splitAt), 10);
                const v = parseInt(digitPart.slice(splitAt), 10);
                if (ch < 1 || v < 1 || v > 176) continue;
                if (ch === defaultChapter && v === 1) continue; // already added
                await addResult(book, ch, v, "close", "split");
                totalAdded = newResults.length;
              }
            }
          }

        } else if (parsed.book && parsed.chapter && parsed.verse) {
          // Compact form that was already parsed (fallback)
          await addResult(parsed.book, parsed.chapter, parsed.verse, "exact", "exact");

        } else if (parsed.book && parsed.chapter) {
          // Book + chapter (no verse) — e.g. "Genesis 11" with explicit space
          try {
            const passage = await getPassage(parsed.book, parsed.chapter, 1, 5, translation);
            for (const v of passage.verses) {
              newResults.push({
                id: `ch-${v.book}-${v.chapter}-${v.verse}`,
                reference: `${v.book} ${v.chapter}:${v.verse}`,
                text: v.text,
                book: v.book,
                chapter: v.chapter,
                verse: v.verse,
                type: newResults.length === 0 ? "exact" : "close",
              });
            }
          } catch { /* skip */ }

        } else if (parsed.book) {
          // Book only — show chapter 1 first few verses
          try {
            const chCount = await getChapterCount(parsed.book, translation);
            if (chCount > 0) {
              const passage = await getPassage(parsed.book, 1, 1, 3, translation);
              for (const v of passage.verses) {
                newResults.push({
                  id: `book-${v.book}-${v.chapter}-${v.verse}`,
                  reference: `${v.book} ${v.chapter}:${v.verse}`,
                  text: v.text,
                  book: v.book,
                  chapter: v.chapter,
                  verse: v.verse,
                  type: "close",
                });
              }
            }
          } catch { /* skip */ }

        } else if (q.match(/^[a-zA-Z]+$/)) {
          // ── Letters only, no digits — show matching books ──
          const { startsWithBooks, containsBooks } = findAllMatchingBooks(q.trim());
          const allBooks = [...startsWithBooks, ...containsBooks];
          let count = 0;
          for (const book of allBooks) {
            if (count >= 8) break;
            try {
              const passage = await getPassage(book, 1, 1, 1, translation);
              for (const v of passage.verses) {
                newResults.push({
                  id: `book-${v.book}-${v.chapter}-${v.verse}`,
                  reference: `${v.book} 1:1`,
                  text: v.text,
                  book: v.book,
                  chapter: v.chapter,
                  verse: v.verse,
                  type: count === 0 ? "exact" : "close",
                });
                count++;
              }
            } catch { /* skip */ }
          }
        }

        // Keyword search fallback — if no reference-based results
        if (newResults.length === 0 && q.trim().length >= 3) {
          try {
            const keywordResults = await searchBible(q, translation, 8);
            for (const kr of keywordResults) {
              newResults.push({
                id: `kw-${kr.book}-${kr.chapter}-${kr.verse}`,
                reference: `${kr.book} ${kr.chapter}:${kr.verse}`,
                text: kr.text,
                book: kr.book,
                chapter: kr.chapter,
                verse: kr.verse,
                type: "keyword",
              });
            }
          } catch { /* skip */ }
        }

        setResults(newResults);
        setSelectedIndex(0);
      } catch (err) {
        console.error("[SmartSearch] Search failed:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [translation]
  );

  // Debounced search
  useEffect(() => {
    if (!open) return;

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, open, performSearch]);

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            const r = results[selectedIndex];
            onSelect(r.book, r.chapter, r.verse);
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onSelect, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Separate best match and close/keyword matches
  const bestMatch = results.find((r) => r.type === "exact");
  const closeMatches = results.filter((r) => r !== bestMatch);

  if (!open) return null;

  return (
    <div className="smart-search-backdrop" onClick={onClose}>
      <div className="smart-search-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Search Input ── */}
        <div className="smart-search-input-wrap">
          <Icon name="search" size={20} className="smart-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="smart-search-input"
            placeholder='Search scripture… (e.g. "John 3:16", "Ps 23", "j316")'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="smart-search-hints">
            {query && (
              <button
                className="smart-search-clear"
                onClick={() => setQuery("")}
                title="Clear"
              >
                <Icon name="close" size={20} />
              </button>
            )}
            <kbd className="smart-search-kbd">ESC</kbd>
          </div>
        </div>

        {/* ── Results dropdown ── */}
        {query.trim().length > 0 && (
          <div className="smart-search-results" ref={listRef}>
            {loading && results.length === 0 && (
              <div className="smart-search-loading">
                <Icon name="sync" size={20} className="spin" />
                Searching…
              </div>
            )}

            {!loading && results.length === 0 && query.trim().length > 0 && (
              <div className="smart-search-empty">
                <Icon name="search_off" size={20} />
                <span>No results for "{query}"</span>
              </div>
            )}

            {/* Best Match */}
            {bestMatch && (
              <>
                <div className="smart-search-section-label">
                  <span>Best Match</span>
                  <kbd className="smart-search-kbd-sm">ENTER</kbd>
                </div>
                <div
                  className={`smart-search-result smart-search-result--best ${
                    results.indexOf(bestMatch) === selectedIndex ? "smart-search-result--active" : ""
                  }`}
                  data-index={results.indexOf(bestMatch)}
                  onClick={() => {
                    onSelect(bestMatch.book, bestMatch.chapter, bestMatch.verse);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(results.indexOf(bestMatch))}
                >
                  <Icon name="bookmark" size={20} className="smart-search-result-icon" />
                  <div className="smart-search-result-content">
                    <div className="smart-search-result-header">
                      <span className="smart-search-result-ref">{bestMatch.reference}</span>
                      <span className="smart-search-result-trans">{translation}</span>
                    </div>
                    <p className="smart-search-result-text">{bestMatch.text}</p>
                  </div>
                </div>
              </>
            )}

            {/* Close Matches / Keyword Results */}
            {closeMatches.length > 0 && (
              <>
                <div className="smart-search-section-label">
                  <span>
                    {closeMatches[0].type === "keyword" ? "Keyword Matches" : "Close Matches"}
                  </span>
                </div>
                {closeMatches.map((result) => {
                  const globalIdx = results.indexOf(result);
                  return (
                    <div
                      key={result.id}
                      className={`smart-search-result ${
                        globalIdx === selectedIndex ? "smart-search-result--active" : ""
                      }`}
                      data-index={globalIdx}
                      onClick={() => {
                        onSelect(result.book, result.chapter, result.verse);
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <Icon name={result.type === "keyword" ? "text_snippet" : "format_quote"} size={20} className="smart-search-result-icon" />
                      <div className="smart-search-result-content">
                        <div className="smart-search-result-header">
                          <span className="smart-search-result-ref">{result.reference}</span>
                          {result.type === "keyword" && (
                            <span className="smart-search-result-trans">{translation}</span>
                          )}
                        </div>
                        <p className="smart-search-result-text smart-search-result-text--truncate">
                          {result.text}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── Footer hints ── */}
        <div className="smart-search-footer">
          <span className="smart-search-footer-hint">
            <kbd>↑</kbd><kbd>↓</kbd> Navigate
          </span>
          <span className="smart-search-footer-hint">
            <kbd>↵</kbd> Select
          </span>
          <span className="smart-search-footer-hint">
            <kbd>ESC</kbd> Close
          </span>
          <span className="smart-search-footer-hint" style={{ marginLeft: "auto", opacity: 0.5 }}>
            Try: "Ps 23", "Matt 5:1", "j316", "1 Cor 13"
          </span>
        </div>
      </div>
    </div>
  );
}
