/**
 * BibleSearch.tsx — Professional scripture browser
 *
 * Dense, Holyrics-inspired layout:
 * - Always-visible search bar at top (smart reference parsing)
 * - Toggle between Browse (book/chapter/verse grid) and Search (keyword)
 * - Color-coded book categories: Pentateuch, History, Wisdom, Prophets, Gospels, Epistles, Revelation
 * - Compact chapter + verse grids
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { BiblePassage, BibleTranslation } from "../types";
import { BIBLE_BOOKS } from "../types";
import {
  resolveBookName,
  getChapterCount,
  getVerseCount,
  getPassage,
  getChapter,
  searchBible,
  getBookIndex,
  type SearchResult,
} from "../bibleData";
import { parseReference } from "../slideEngine";

/* ── Book category mapping ────────────────────────────────────── */

type BookCategory =
  | "pentateuch"
  | "history"
  | "wisdom"
  | "prophets"
  | "gospels"
  | "epistles"
  | "revelation";

interface BookMeta {
  name: string;
  abbrev: string;
  category: BookCategory;
}

const CATEGORY_LABELS: Record<BookCategory, string> = {
  pentateuch: "Pentateuch",
  history: "History",
  wisdom: "Wisdom",
  prophets: "Prophets",
  gospels: "Gospels & Acts",
  epistles: "Epistles",
  revelation: "Revelation",
};

function getCategory(book: string): BookCategory {
  const idx = BIBLE_BOOKS.indexOf(book as (typeof BIBLE_BOOKS)[number]);
  if (idx < 5) return "pentateuch";   // Genesis–Deuteronomy
  if (idx < 17) return "history";     // Joshua–Esther
  if (idx < 22) return "wisdom";      // Job–Song of Solomon
  if (idx < 39) return "prophets";    // Isaiah–Malachi
  if (idx < 44) return "gospels";     // Matthew–Acts
  if (idx < 65) return "epistles";    // Romans–Jude
  return "revelation";
}

function abbrev(book: string): string {
  // Short abbreviation for the grid button
  if (book.startsWith("1 ") || book.startsWith("2 ") || book.startsWith("3 "))
    return book[0] + book.split(" ")[1].slice(0, 3);
  if (book === "Song of Solomon") return "Song";
  if (book === "Ecclesiastes") return "Eccl";
  if (book === "Lamentations") return "Lam";
  if (book === "Philippians") return "Phil";
  if (book === "Colossians") return "Col";
  if (book === "Philemon") return "Phlm";
  if (book === "Thessalonians") return "Thess";
  if (book === "Deuteronomy") return "Deut";
  if (book === "Revelation") return "Rev";
  if (book.length > 6) return book.slice(0, 4);
  return book;
}

const BOOK_META: BookMeta[] = BIBLE_BOOKS.map((b) => ({
  name: b,
  abbrev: abbrev(b),
  category: getCategory(b),
}));

const CATEGORIES: BookCategory[] = [
  "pentateuch",
  "history",
  "wisdom",
  "prophets",
  "gospels",
  "epistles",
  "revelation",
];

/* ── Props ────────────────────────────────────────────────────── */

interface Props {
  translation: BibleTranslation;
  onSelectPassage: (passage: BiblePassage) => void;
}

/* ── Component ────────────────────────────────────────────────── */

export default function BibleSearch({ translation, onSelectPassage }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Browse state
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [verseCount, setVerseCount] = useState(0);
  const [verseStart, setVerseStart] = useState<number | null>(null);
  const [verseEnd, setVerseEnd] = useState<number | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load book index on mount (to warm cache)
  useEffect(() => {
    getBookIndex(translation).catch(console.error);
  }, [translation]);

  // Load chapter count when book selected
  useEffect(() => {
    if (selectedBook) {
      getChapterCount(selectedBook, translation)
        .then(setChapterCount)
        .catch(console.error);
    }
  }, [selectedBook, translation]);

  // Load verse count when chapter selected
  useEffect(() => {
    if (selectedBook && selectedChapter) {
      getVerseCount(selectedBook, selectedChapter, translation)
        .then(setVerseCount)
        .catch(console.error);
    }
  }, [selectedBook, selectedChapter, translation]);

  // Quick reference handler (from search bar)
  const handleQuickSearch = useCallback(async () => {
    const parsed = parseReference(query);
    if (!parsed) return;

    const bookName = resolveBookName(parsed.book);
    if (!bookName) return;

    try {
      let passage: BiblePassage;
      if (parsed.startVerse !== null && parsed.endVerse !== null) {
        passage = await getPassage(
          bookName,
          parsed.chapter,
          parsed.startVerse,
          parsed.endVerse,
          translation
        );
      } else {
        passage = await getChapter(bookName, parsed.chapter, translation);
      }
      if (passage.verses.length > 0) {
        onSelectPassage(passage);
      }
    } catch (err) {
      console.error("Quick search error:", err);
    }
  }, [query, translation, onSelectPassage]);

  // Keyword search
  const handleKeywordSearch = useCallback(
    async (q: string) => {
      if (q.length < 3) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const results = await searchBible(q, translation, 30);
        setSearchResults(results);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setIsSearching(false);
      }
    },
    [translation]
  );

  // Input change
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (searchTimeout.current !== null) clearTimeout(searchTimeout.current);

    if (mode === "search") {
      searchTimeout.current = setTimeout(() => {
        handleKeywordSearch(value);
      }, 300);
    }
  };

  // Key handler
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "search") {
        handleKeywordSearch(query);
      } else {
        handleQuickSearch();
      }
    }
  };

  // Browse: select passage from picker
  const handleBrowseSelect = async () => {
    if (!selectedBook || !selectedChapter) return;
    try {
      const start = verseStart ?? 1;
      const end =
        verseEnd ??
        (verseStart ??
          (await getVerseCount(selectedBook, selectedChapter, translation)));
      const passage = await getPassage(
        selectedBook,
        selectedChapter,
        start,
        end,
        translation
      );
      if (passage.verses.length > 0) {
        onSelectPassage(passage);
      }
    } catch (err) {
      console.error("Browse select error:", err);
    }
  };

  // Search result click
  const handleSearchResultClick = async (result: SearchResult) => {
    try {
      const passage = await getPassage(
        result.book,
        result.chapter,
        result.verse,
        result.verse,
        translation
      );
      onSelectPassage(passage);
    } catch (err) {
      console.error("Search result click error:", err);
    }
  };

  // Group books by category
  const groupedBooks = useMemo(() => {
    const groups: Record<BookCategory, BookMeta[]> = {
      pentateuch: [],
      history: [],
      wisdom: [],
      prophets: [],
      gospels: [],
      epistles: [],
      revelation: [],
    };
    for (const b of BOOK_META) {
      groups[b.category].push(b);
    }
    return groups;
  }, []);

  return (
    <div className="bible-search">
      {/* Always-visible search bar */}
      <div className="bible-search-bar">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "browse"
              ? "Jn 3:16, Ps 23, Gen 1:1-5…"
              : "Search word or phrase…"
          }
          className="bible-search-input"
        />
        <button
          className="bible-search-go"
          onClick={mode === "search" ? () => handleKeywordSearch(query) : handleQuickSearch}
          disabled={!query.trim()}
        >
          Go
        </button>
      </div>

      {/* Mode toggle */}
      <div className="bible-mode-toggle">
        <button
          className={`bible-mode-btn ${mode === "browse" ? "active" : ""}`}
          onClick={() => setMode("browse")}
        >
          Browse
        </button>
        <button
          className={`bible-mode-btn ${mode === "search" ? "active" : ""}`}
          onClick={() => setMode("search")}
        >
          Search
        </button>
      </div>

      {/* Browse mode */}
      {mode === "browse" && (
        <div className="bible-browser">
          {/* Book grid by category */}
          {CATEGORIES.map((cat) => (
            <div key={cat} className="bible-book-category">
              <span className="bible-category-label">
                {CATEGORY_LABELS[cat]}
              </span>
              <div className="bible-book-grid">
                {groupedBooks[cat].map((b) => (
                  <button
                    key={b.name}
                    className={`bible-book-btn ${selectedBook === b.name ? "active" : ""}`}
                    data-cat={b.category}
                    onClick={() => {
                      setSelectedBook(b.name);
                      setSelectedChapter(null);
                      setVerseStart(null);
                      setVerseEnd(null);
                    }}
                    title={b.name}
                  >
                    {b.abbrev}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Chapter grid */}
          {selectedBook && chapterCount > 0 && (
            <div className="bible-chapter-section">
              <span className="bible-section-label">
                <span className="bible-section-label-book">{selectedBook}</span>{" "}
                — Chapter
              </span>
              <div className="bible-chapter-grid">
                {Array.from({ length: chapterCount }, (_, i) => i + 1).map(
                  (ch) => (
                    <button
                      key={ch}
                      className={`bible-ch-btn ${selectedChapter === ch ? "active" : ""}`}
                      onClick={() => {
                        setSelectedChapter(ch);
                        setVerseStart(null);
                        setVerseEnd(null);
                      }}
                    >
                      {ch}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Verse grid */}
          {selectedChapter !== null && verseCount > 0 && (
            <div className="bible-verse-section">
              <span className="bible-section-label">
                Verses{" "}
                <span style={{ fontWeight: 400, fontSize: 9, color: "var(--bible-text-3)" }}>
                  (click start, then end — or leave blank for whole chapter)
                </span>
              </span>
              <div className="bible-verse-grid">
                {Array.from({ length: verseCount }, (_, i) => i + 1).map(
                  (v) => {
                    const isInRange =
                      verseStart !== null &&
                      verseEnd !== null &&
                      v >= verseStart &&
                      v <= verseEnd;
                    const isStart = v === verseStart;
                    const isEnd = v === verseEnd;
                    return (
                      <button
                        key={v}
                        className={`bible-vs-btn ${isInRange ? "in-range" : ""} ${isStart ? "range-start" : ""} ${isEnd ? "range-end" : ""}`}
                        onClick={() => {
                          if (verseStart === null) {
                            setVerseStart(v);
                            setVerseEnd(v);
                          } else if (verseEnd === verseStart) {
                            if (v >= verseStart) {
                              setVerseEnd(v);
                            } else {
                              setVerseEnd(verseStart);
                              setVerseStart(v);
                            }
                          } else {
                            setVerseStart(v);
                            setVerseEnd(v);
                          }
                        }}
                      >
                        {v}
                      </button>
                    );
                  }
                )}
              </div>
              <button
                className="bible-select-passage-btn"
                onClick={handleBrowseSelect}
              >
                {verseStart
                  ? `Select ${selectedBook} ${selectedChapter}:${verseStart}${verseEnd && verseEnd !== verseStart ? `–${verseEnd}` : ""}`
                  : `Select entire chapter ${selectedChapter}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Search mode */}
      {mode === "search" && (
        <div className="bible-browser">
          {isSearching && (
            <div className="bible-search-loading">Searching…</div>
          )}
          <div className="bible-keyword-results">
            {searchResults.map((r, i) => (
              <button
                key={`${r.book}-${r.chapter}-${r.verse}-${i}`}
                className="bible-keyword-result"
                onClick={() => handleSearchResultClick(r)}
              >
                <span className="bible-keyword-result-ref">
                  {r.book} {r.chapter}:{r.verse}
                </span>
                <span className="bible-keyword-result-text">{r.snippet}</span>
              </button>
            ))}
            {!isSearching &&
              query.length >= 3 &&
              searchResults.length === 0 && (
                <div className="bible-search-no-results">
                  No results for "{query}"
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
