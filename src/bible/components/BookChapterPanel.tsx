/**
 * BookChapterPanel.tsx — Center panel: Simplified Bible selector
 *
 * Section-based color coding for rapid visual recognition.
 * Auto-selects chapter 1, verse 1 when book is clicked.
 * Double-click verse sends to OBS.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { BIBLE_BOOKS } from "../types";
import { getChapterCount, getVerseCount } from "../bibleData";
import type { BibleTranslation } from "../types";

const PAGE_SIZE = 50;

/** Holyrics-style abbreviations (exact order matches BIBLE_BOOKS) */
const HOLYRICS_ABBREVS: Record<string, string> = {
  Genesis: "Gn", Exodus: "Ex", Leviticus: "Lv", Numbers: "Nm", Deuteronomy: "Dt",
  Joshua: "Jos", Judges: "Jg", Ruth: "Ru",
  "1 Samuel": "1Sm", "2 Samuel": "2Sm", "1 Kings": "1Ki", "2 Kings": "2Ki",
  "1 Chronicles": "1Ch", "2 Chronicles": "2Ch",
  Ezra: "Ezr", Nehemiah: "Ne", Esther: "Es",
  Job: "Jb", Psalms: "Ps", Proverbs: "Pr", Ecclesiastes: "Ec", "Song of Solomon": "So",
  Isaiah: "Is", Jeremiah: "Jr", Lamentations: "La", Ezekiel: "Eze", Daniel: "Dn",
  Hosea: "Ho", Joel: "Jl", Amos: "Am", Obadiah: "Ob", Jonah: "Jon", Micah: "Mic",
  Nahum: "Na", Habakkuk: "Hab", Zephaniah: "Zp", Haggai: "Hg", Zechariah: "Zc", Malachi: "Ml",
  Matthew: "Mt", Mark: "Mk", Luke: "Lk", John: "Jn", Acts: "Ac",
  Romans: "Rm", "1 Corinthians": "1Co", "2 Corinthians": "2Co",
  Galatians: "Ga", Ephesians: "Eph", Philippians: "Php", Colossians: "Col",
  "1 Thessalonians": "1Th", "2 Thessalonians": "2Th",
  "1 Timothy": "1Ti", "2 Timothy": "2Ti", Titus: "Tit", Philemon: "Phm",
  Hebrews: "Heb", James: "Jm", "1 Peter": "1Pe", "2 Peter": "2Pe",
  "1 John": "1Jo", "2 John": "2Jo", "3 John": "3Jo", Jude: "Jud", Revelation: "Rev",
};

type BookCategory =
  | "law" | "history" | "wisdom"
  | "major-prophets" | "minor-prophets"
  | "gospels" | "pauline" | "general" | "revelation";

interface BookMeta { name: string; abbrev: string; category: BookCategory; testament: "OT" | "NT"; }

const LAW = new Set(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
const HISTORY_OT = new Set(["Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther"]);
const WISDOM = new Set(["Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon"]);
const MAJOR_PROPHETS = new Set(["Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel"]);
const MINOR_PROPHETS = new Set(["Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"]);
const GOSPELS_SET = new Set(["Matthew", "Mark", "Luke", "John", "Acts"]);
const PAULINE = new Set(["Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews"]);
const GENERAL_NT = new Set(["James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude"]);

function getCategory(book: string): BookCategory {
  if (LAW.has(book)) return "law";
  if (HISTORY_OT.has(book)) return "history";
  if (WISDOM.has(book)) return "wisdom";
  if (MAJOR_PROPHETS.has(book)) return "major-prophets";
  if (MINOR_PROPHETS.has(book)) return "minor-prophets";
  if (GOSPELS_SET.has(book)) return "gospels";
  if (PAULINE.has(book)) return "pauline";
  if (GENERAL_NT.has(book)) return "general";
  return "revelation";
}

export { getCategory };
export type { BookCategory };

function getAbbrev(book: string): string {
  return HOLYRICS_ABBREVS[book] ?? book.slice(0, 3);
}

const BOOK_META: BookMeta[] = BIBLE_BOOKS.map((name, idx) => ({
  name,
  abbrev: getAbbrev(name),
  category: getCategory(name),
  testament: idx < 39 ? "OT" as const : "NT" as const,
}));

interface Props {
  translation: BibleTranslation;
  selectedBook: string | null;
  selectedChapter: number | null;
  selectedVerse: number | null;
  onSelectBook: (book: string) => void;
  onSelectChapter: (book: string, chapter: number) => void;
  onSelectVerse: (verse: number) => void;
  onDoubleClickVerse: (verse: number) => void;
  onDoubleClickBook?: (book: string) => void;
  onDoubleClickChapter?: (book: string, chapter: number) => void;
}

export default function BookChapterPanel({
  translation, selectedBook, selectedChapter, selectedVerse,
  onSelectBook, onSelectChapter, onSelectVerse, onDoubleClickVerse,
  onDoubleClickBook, onDoubleClickChapter,
}: Props) {
  const [chapterCount, setChapterCount] = useState(0);
  const [verseCount, setVerseCount] = useState(0);

  useEffect(() => {
    if (!selectedBook) { setChapterCount(0); return; }
    let cancelled = false;
    getChapterCount(selectedBook, translation).then((n) => { if (!cancelled) setChapterCount(n); });
    return () => { cancelled = true; };
  }, [selectedBook, translation]);

  useEffect(() => {
    if (!selectedBook || !selectedChapter) { setVerseCount(0); return; }
    let cancelled = false;
    getVerseCount(selectedBook, selectedChapter, translation).then((n) => { if (!cancelled) setVerseCount(n); });
    return () => { cancelled = true; };
  }, [selectedBook, selectedChapter, translation]);

  const chapters = useMemo(() => chapterCount <= 0 ? [] : Array.from({ length: chapterCount }, (_, i) => i + 1), [chapterCount]);
  const verseNums = useMemo(() => verseCount <= 0 ? [] : Array.from({ length: verseCount }, (_, i) => i + 1), [verseCount]);

  // Pagination state
  const [chapterPage, setChapterPage] = useState(0);
  const [versePage, setVersePage] = useState(0);

  // Reset pages when book/chapter changes
  useEffect(() => { setChapterPage(0); }, [selectedBook]);
  useEffect(() => { setVersePage(0); }, [selectedBook, selectedChapter]);

  // Paginated slices — show PAGE_SIZE items, with inline nav tiles
  const needsChapterPagination = chapters.length > PAGE_SIZE;
  const chapterTotalPages = Math.ceil(chapters.length / PAGE_SIZE);
  const chapterSlice = needsChapterPagination
    ? chapters.slice(chapterPage * PAGE_SIZE, (chapterPage + 1) * PAGE_SIZE)
    : chapters;

  const needsVersePagination = verseNums.length > PAGE_SIZE;
  const verseTotalPages = Math.ceil(verseNums.length / PAGE_SIZE);
  const verseSlice = needsVersePagination
    ? verseNums.slice(versePage * PAGE_SIZE, (versePage + 1) * PAGE_SIZE)
    : verseNums;

  // Determine grid columns based on item count
  const getGridCols = (count: number): number => {
    if (count == 1) return 1;
    if (count <= 4) return 2;
    if (count <= 10) return 4;
    if (count <= 20) return 5;
    return 6; // 21+
  };

  // Handle Enter key on verse tile → same as double-click
  const handleVerseKeyDown = useCallback((e: React.KeyboardEvent, vs: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDoubleClickVerse(vs);
    }
  }, [onDoubleClickVerse]);

  // Group books by category for the legend display
  const selectedCategory = selectedBook ? getCategory(selectedBook) : null;

  return (
    <div className="book-chapter-panel">
      <div className="center-scroll b-scroll">
        {/* Book Grid */}
        <div className="book-grid-section">
          <div className={`book-grid${selectedBook ? " has-active" : ""}`}>
            {BOOK_META.map((bk) => (
              <button
                key={bk.name}
                className={`book-tile${selectedBook === bk.name ? " active" : ""}`}
                data-cat={bk.category}
                title={`${bk.name} — double-click to send Ch 1:1 to OBS`}
                onClick={() => onSelectBook(bk.name)}
                onDoubleClick={() => onDoubleClickBook?.(bk.name)}
              >
                <span className="book-tile-abbrev">{bk.abbrev}</span>
                <span className="book-tile-name">{bk.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chapter + Verse selectors */}
        <div className="cv-section" data-cat={selectedCategory ?? "law"}>
          <div className="cv-grid-row">
            {/* Chapters */}
            <div className="cv-grid-card">
              <div className="cv-grid-body b-scroll" style={{ gridTemplateColumns: `repeat(${getGridCols(chapterSlice.length)}, minmax(60px, 1fr))` }}>
                {/* < nav tile — go to previous page */}
                {needsChapterPagination && chapterPage > 0 && (
                  <button
                    className="cv-tile nav"
                    onClick={() => setChapterPage(p => p - 1)}
                    title="Previous chapters"
                  >
                    ‹
                  </button>
                )}

                {chapterSlice.map((ch) => (
                  <button
                    key={ch}
                    className={`cv-tile ch${selectedChapter === ch ? " active" : ""}`}
                    onClick={() => selectedBook && onSelectChapter(selectedBook, ch)}
                    onDoubleClick={() => selectedBook && onDoubleClickChapter?.(selectedBook, ch)}
                    title="Double-click to send verse 1 to OBS"
                  >
                    {ch}
                  </button>
                ))}

                {/* > nav tile — go to next page */}
                {needsChapterPagination && chapterPage < chapterTotalPages - 1 && (
                  <button
                    className="cv-tile nav"
                    onClick={() => setChapterPage(p => p + 1)}
                    title="More chapters"
                  >
                    ›
                  </button>
                )}
              </div>
            </div>

            {/* Verses */}
            <div className="cv-grid-card">
              <div className="cv-grid-body b-scroll" style={{ gridTemplateColumns: `repeat(${getGridCols(verseSlice.length)}, minmax(60px, 1fr))` }}>
                {/* < nav tile — go to previous page */}
                {needsVersePagination && versePage > 0 && (
                  <button
                    className="cv-tile nav"
                    onClick={() => setVersePage(p => p - 1)}
                    title="Previous verses"
                  >
                    ‹
                  </button>
                )}

                {verseSlice.map((vs) => (
                  <button
                    key={vs}
                    className={`cv-tile vs${selectedVerse === vs ? " active" : ""}`}
                    tabIndex={0}
                    onClick={() => onSelectVerse(vs)}
                    onDoubleClick={() => onDoubleClickVerse(vs)}
                    onKeyDown={(e) => handleVerseKeyDown(e, vs)}
                    title="Double-click or click and press Enter to send to OBS"
                  >
                    {vs}
                  </button>
                ))}

                {/* > nav tile — go to next page */}
                {needsVersePagination && versePage < verseTotalPages - 1 && (
                  <button
                    className="cv-tile nav"
                    onClick={() => setVersePage(p => p + 1)}
                    title="More verses"
                  >
                    ›
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
