/**
 * DockBibleTab.tsx — Bible tab for the OBS Browser Dock
 *
 * Smart search: type "gen1vs1", "g11", "jn3:16", "ps23" etc.
 * Also supports manual Book → Chapter → Verse multi-step flow.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  OT_BOOKS,
  NT_BOOKS,
  BOOK_CHAPTERS,
  bookAbbrev,
  type DockStagedItem,
} from "../dockTypes";
import { parseBibleSearch, type BibleSearchResult } from "../bibleSearchParser";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import type { BibleTheme } from "../../bible/types";
import { dockObsClient } from "../dockObsClient";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import Icon from "../DockIcon";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  productionDefaults: DockProductionModuleSettings;
}

type BibleStep = "book" | "chapter" | "verse";
type OverlayMode = "fullscreen" | "lower-third";

export default function DockBibleTab({ staged: _staged, onStage, productionDefaults }: Props) {
  const [step, setStep] = useState<BibleStep>("book");
  const [testament, setTestament] = useState<"ot" | "nt">("ot");
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const [translation, setTranslation] = useState("KJV");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBibleTheme, setSelectedBibleTheme] = useState<BibleTheme>(
    productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0],
  );
  const [selectedLowerThirdTheme, setSelectedLowerThirdTheme] = useState<BibleTheme>(
    productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0],
  );
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(productionDefaults.defaultMode);
  const [availableTranslations, setAvailableTranslations] = useState<Array<{ value: string; label: string }>>([
    { value: "KJV", label: "KJV" },
  ]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [_verseText, setVerseText] = useState<string | null>(null);
  const [verseCount, setVerseCount] = useState(30);
  const searchRef = useRef<HTMLDivElement>(null);

  const books = testament === "ot" ? OT_BOOKS : NT_BOOKS;

  useEffect(() => {
    setSelectedBibleTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
    setSelectedLowerThirdTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
    setOverlayMode(productionDefaults.defaultMode);
  }, [
    productionDefaults.defaultMode,
    productionDefaults.fullscreenTheme,
    productionDefaults.lowerThirdTheme,
  ]);

  useEffect(() => {
    let cancelled = false;

    const loadTranslations = async () => {
      try {
        const remote = await fetch("/uploads/dock-bible-translations.json");
        if (remote.ok) {
          const payload = await remote.json() as Array<{ abbr: string; name: string }>;
          if (!cancelled && Array.isArray(payload) && payload.length > 0) {
            setAvailableTranslations([
              { value: "KJV", label: "KJV" },
              ...payload
                .filter((entry) => entry.abbr && entry.abbr.toUpperCase() !== "KJV")
                .map((entry) => ({ value: entry.abbr.toUpperCase(), label: entry.abbr.toUpperCase() })),
            ]);
            return;
          }
        }
      } catch {
        // Fall through to local IndexedDB fallback.
      }

      try {
        const { getInstalledTranslations } = await import("../../bible/bibleDb");
        const installed = await getInstalledTranslations();
        if (cancelled) return;
        setAvailableTranslations([
          { value: "KJV", label: "KJV" },
          ...installed
            .filter((entry) => entry.abbr && entry.abbr.toUpperCase() !== "KJV")
            .map((entry) => ({ value: entry.abbr.toUpperCase(), label: entry.abbr.toUpperCase() })),
        ]);
      } catch {
        if (!cancelled) {
          setAvailableTranslations([{ value: "KJV", label: "KJV" }]);
        }
      }
    };

    void loadTranslations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const allowed = new Set(availableTranslations.map((entry) => entry.value.toUpperCase()));
    if (allowed.has(translation.toUpperCase())) return;
    setTranslation("KJV");
  }, [availableTranslations, translation]);

  // ── Fetch verse count when chapter changes ──
  useEffect(() => {
    if (!selectedBook || !selectedChapter) { setVerseCount(30); return; }
    let cancelled = false;
    (async () => {
      try {
        const { getVerseCount } = await import("../../bible/bibleData");
        const count = await getVerseCount(selectedBook, selectedChapter, translation);
        if (!cancelled) setVerseCount(count || 30);
      } catch { if (!cancelled) setVerseCount(30); }
    })();
    return () => { cancelled = true; };
  }, [selectedBook, selectedChapter, translation]);

  // ── Fetch actual verse text helper ──
  const fetchVerseText = useCallback(async (book: string, chapter: number, verse: number, trans: string): Promise<string> => {
    try {
      const { getVerse } = await import("../../bible/bibleData");
      const result = await getVerse(book, chapter, verse, trans);
      if (!result?.text) {
        console.warn(`[DockBibleTab] getVerse returned no text for ${book} ${chapter}:${verse} (${trans})`);
      }
      return result?.text || `${book} ${chapter}:${verse}`;
    } catch (err) {
      console.error(`[DockBibleTab] fetchVerseText failed for ${book} ${chapter}:${verse}:`, err);
      return `${book} ${chapter}:${verse}`;
    }
  }, []);

  // ── Re-fetch verse text when translation changes (if a verse is already selected) ──
  const prevTranslation = useRef(translation);
  useEffect(() => {
    // Only act when translation actually changed (not on initial mount)
    if (prevTranslation.current === translation) return;
    prevTranslation.current = translation;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    let cancelled = false;
    (async () => {
      const text = await fetchVerseText(selectedBook, selectedChapter, selectedVerse, translation);
      if (cancelled) return;
      setVerseText(text);
      onStage({
        type: "bible",
        label: `${selectedBook} ${selectedChapter}:${selectedVerse}`,
        subtitle: text,
        data: {
          book: selectedBook,
          chapter: selectedChapter,
          verse: selectedVerse,
          translation,
          verseText: text,
          overlayMode,
          theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
          bibleThemeSettings: overlayMode === "fullscreen" ? selectedBibleTheme.settings : selectedLowerThirdTheme.settings,
        },
      });
    })();
    return () => { cancelled = true; };
  }, [translation, selectedBook, selectedChapter, selectedVerse, overlayMode, selectedBibleTheme, selectedLowerThirdTheme, fetchVerseText, onStage]);

  // ── Re-stage verse when overlay mode changes ──
  const prevOverlayMode = useRef(overlayMode);
  useEffect(() => {
    if (prevOverlayMode.current === overlayMode) return;   // skip mount
    prevOverlayMode.current = overlayMode;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    // Re-stage with the updated overlay mode
    onStage({
      type: "bible",
      label: `${selectedBook} ${selectedChapter}:${selectedVerse}`,
      subtitle: _verseText || `${selectedBook} ${selectedChapter}:${selectedVerse}`,
      data: {
        book: selectedBook,
        chapter: selectedChapter,
        verse: selectedVerse,
        translation,
        verseText: _verseText || `${selectedBook} ${selectedChapter}:${selectedVerse}`,
        overlayMode,
        theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
        bibleThemeSettings: overlayMode === "fullscreen" ? selectedBibleTheme.settings : selectedLowerThirdTheme.settings,
      },
    });
  }, [overlayMode, selectedBook, selectedChapter, selectedVerse, _verseText, translation, selectedBibleTheme, selectedLowerThirdTheme, onStage]);

  const prevThemeSignature = useRef(`${selectedBibleTheme.id}:${selectedLowerThirdTheme.id}`);
  useEffect(() => {
    const nextSignature = `${selectedBibleTheme.id}:${selectedLowerThirdTheme.id}`;
    if (prevThemeSignature.current === nextSignature) return;
    prevThemeSignature.current = nextSignature;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    onStage({
      type: "bible",
      label: `${selectedBook} ${selectedChapter}:${selectedVerse}`,
      subtitle: _verseText || `${selectedBook} ${selectedChapter}:${selectedVerse}`,
      data: {
        book: selectedBook,
        chapter: selectedChapter,
        verse: selectedVerse,
        translation,
        verseText: _verseText || `${selectedBook} ${selectedChapter}:${selectedVerse}`,
        overlayMode,
        theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
        bibleThemeSettings: overlayMode === "fullscreen" ? selectedBibleTheme.settings : selectedLowerThirdTheme.settings,
      },
    });
  }, [
    _verseText,
    onStage,
    overlayMode,
    selectedBibleTheme,
    selectedBook,
    selectedChapter,
    selectedLowerThirdTheme,
    selectedVerse,
    translation,
  ]);

  // ── Smart search results ──
  const searchResults = useMemo<BibleSearchResult[]>(() => {
    if (!searchQuery.trim()) return [];
    return parseBibleSearch(searchQuery);
  }, [searchQuery]);

  // Filter books by search (for the grid fallback)
  const filteredBooks = useMemo(() => {
    if (!searchQuery.trim()) return books;
    const q = searchQuery.toLowerCase();
    return books.filter(
      (b) =>
        b.toLowerCase().includes(q) ||
        bookAbbrev(b).toLowerCase().includes(q)
    );
  }, [books, searchQuery]);

  // Chapter count for selected book
  const chapterCount = selectedBook ? (BOOK_CHAPTERS[selectedBook] ?? 1) : 0;

  // ── Close dropdown when clicking outside ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Search change handler ──
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    setShowDropdown(val.trim().length > 0);
    setActiveIdx(-1);
  }, []);

  // ── Pick a search result ──
  const handlePickResult = useCallback(
    async (result: BibleSearchResult, options?: { sendToPreview?: boolean }) => {
      const sendToPreview = options?.sendToPreview ?? false;
      setSearchQuery("");
      setShowDropdown(false);
      setActiveIdx(-1);

      if (result.chapter !== null && result.verse !== null) {
        // Full reference — stage it immediately
        setSelectedBook(result.book);
        setSelectedChapter(result.chapter);
        setSelectedVerse(result.verse);
        setStep("verse");

        const text = await fetchVerseText(result.book, result.chapter, result.verse, translation);
        setVerseText(text);
        const stageData = {
          book: result.book,
          chapter: result.chapter,
          verse: result.verse,
          translation,
          verseText: text,
          overlayMode,
          theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
          bibleThemeSettings: (overlayMode === "fullscreen"
            ? selectedBibleTheme.settings
            : selectedLowerThirdTheme.settings) as unknown as Record<string, unknown>,
        };

        onStage({
          type: "bible",
          label: `${result.book} ${result.chapter}:${result.verse}`,
          subtitle: text,
          data: stageData,
        });

        if (sendToPreview) {
          try {
            await dockObsClient.pushBible(stageData, false);
          } catch (err) {
            console.warn("[DockBibleTab] Search Enter send to preview failed:", err);
          }
        }
      } else if (result.chapter !== null) {
        // Book + chapter — go to verse picker
        setSelectedBook(result.book);
        setSelectedChapter(result.chapter);
        setSelectedVerse(null);
        setStep("verse");
      } else {
        // Book only — go to chapter picker
        setSelectedBook(result.book);
        setSelectedChapter(null);
        setSelectedVerse(null);
        setStep("chapter");
      }
    },
    [translation, selectedBibleTheme, selectedLowerThirdTheme, overlayMode, fetchVerseText, onStage]
  );

  // ── Keyboard navigation ──
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || searchResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const picked = searchResults[activeIdx >= 0 ? activeIdx : 0];
        if (picked) {
          handlePickResult(picked, { sendToPreview: true });
        }
      } else if (e.key === "Escape") {
        setShowDropdown(false);
      }
    },
    [showDropdown, searchResults, activeIdx, handlePickResult]
  );

  const handleSelectBook = useCallback((book: string) => {
    setSelectedBook(book);
    setSelectedChapter(null);
    setSelectedVerse(null);
    setStep("chapter");
  }, []);

  const handleSelectChapter = useCallback((ch: number) => {
    setSelectedChapter(ch);
    setSelectedVerse(null);
    setStep("verse");
  }, []);

  const handleSelectVerse = useCallback(
    async (v: number) => {
      setSelectedVerse(v);
      if (selectedBook && selectedChapter) {
        const text = await fetchVerseText(selectedBook, selectedChapter, v, translation);
        setVerseText(text);
        onStage({
          type: "bible",
          label: `${selectedBook} ${selectedChapter}:${v}`,
          subtitle: text,
          data: {
            book: selectedBook,
            chapter: selectedChapter,
            verse: v,
            translation,
            verseText: text,
            overlayMode,
            theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
            bibleThemeSettings: overlayMode === "fullscreen" ? selectedBibleTheme.settings : selectedLowerThirdTheme.settings,
          },
        });
      }
    },
    [selectedBook, selectedChapter, translation, selectedBibleTheme, selectedLowerThirdTheme, overlayMode, fetchVerseText, onStage]
  );

  /** Double-click a verse → stage it AND immediately send to OBS preview */
  const handleDoubleClickVerse = useCallback(
    async (v: number) => {
      if (!selectedBook || !selectedChapter) return;
      // Stage first (reuse handleSelectVerse logic)
      const text = await fetchVerseText(selectedBook, selectedChapter, v, translation);
      setSelectedVerse(v);
      setVerseText(text);

      const stageData = {
        book: selectedBook,
        chapter: selectedChapter,
        verse: v,
        translation,
        verseText: text,
        overlayMode,
        theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
        bibleThemeSettings: (overlayMode === "fullscreen" ? selectedBibleTheme.settings : selectedLowerThirdTheme.settings) as unknown as Record<string, unknown>,
      };

      onStage({
        type: "bible",
        label: `${selectedBook} ${selectedChapter}:${v}`,
        subtitle: text,
        data: stageData,
      });

      // Immediately push to OBS preview (live=false)
      try {
        await dockObsClient.pushBible(stageData, false);
      } catch (err) {
        console.warn("[DockBibleTab] Double-click send to preview failed:", err);
      }
    },
    [selectedBook, selectedChapter, translation, selectedBibleTheme, selectedLowerThirdTheme, overlayMode, fetchVerseText, onStage]
  );

  const goBack = useCallback(() => {
    if (step === "verse") {
      setStep("chapter");
      setSelectedVerse(null);
    } else if (step === "chapter") {
      setStep("book");
      setSelectedChapter(null);
      setSelectedBook(null);
    }
  }, [step]);

  return (
    <>
      {/* Search + Translation */}
      <div className="dock-row" style={{ gap: 6, marginBottom: 10 }}>
        <div
          className="dock-search dock-search--smart"
          style={{ flex: 1, marginBottom: 0 }}
          ref={searchRef}
        >
          {/* <Icon name="search" size={20} /> */}
          <input
            className="dock-input"
            placeholder='Search "gen1:1", "ps23", "jn3:16"...'
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => {
              if (searchQuery.trim()) setShowDropdown(true);
            }}
          />

          {/* ── Smart search dropdown ── */}
          {showDropdown && searchResults.length > 0 && (
            <div className="dock-search-dropdown">
              {searchResults.map((result, i) => (
                <button
                  key={result.label + i}
                  className={`dock-search-dropdown__item${i === activeIdx ? " dock-search-dropdown__item--active" : ""}`}
                  onClick={() => handlePickResult(result)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <Icon name={result.verse !== null
                    ? "format_quote"
                    : result.chapter !== null
                      ? "menu_book"
                      : "auto_stories"} size={14} style={{ opacity: 0.5 }} />
                  <span className="dock-search-dropdown__label">{result.label}</span>
                  <span className="dock-search-dropdown__hint">
                    {result.verse !== null
                      ? "Verse"
                      : result.chapter !== null
                        ? "Chapter"
                        : "Book"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {showDropdown && searchQuery.trim() && searchResults.length === 0 && (
            <div className="dock-search-dropdown">
              <div className="dock-search-dropdown__empty">
                No matches for "{searchQuery}"
              </div>
            </div>
          )}
        </div>
        <select
          className="dock-select"
          style={{ width: 80, flexShrink: 0 }}
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
        >
          {availableTranslations.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Breadcrumb */}
      {step !== "book" && (
        <div className="dock-breadcrumb">
          <button className="dock-breadcrumb-btn" onClick={goBack}>
            <Icon name="arrow_back" size={20} />
            Back
          </button>
          {selectedBook && (
            <>
              <span className="dock-breadcrumb-sep">›</span>
              <span className="dock-breadcrumb-current">
                {selectedBook}
                {selectedChapter != null && ` ${selectedChapter}`}
              </span>
            </>
          )}
        </div>
      )}

      {/* Step: Book selection */}
      {step === "book" && (
        <>
          {/* OT / NT toggle */}
          <div className="dock-theme-bar" style={{ marginBottom: 8 }}>
            <button
              className={`dock-theme-pill${testament === "ot" ? " dock-theme-pill--active" : ""}`}
              onClick={() => { setTestament("ot"); setSearchQuery(""); setShowDropdown(false); }}
            >
              Old Testament
            </button>
            <button
              className={`dock-theme-pill${testament === "nt" ? " dock-theme-pill--active" : ""}`}
              onClick={() => { setTestament("nt"); setSearchQuery(""); setShowDropdown(false); }}
            >
              New Testament
            </button>
          </div>

          <div className="dock-bible-grid">
            {filteredBooks.map((book) => (
              <button
                key={book}
                className={`dock-bible-book-btn${selectedBook === book ? " dock-bible-book-btn--active" : ""}`}
                onClick={() => handleSelectBook(book)}
                title={book}
              >
                {bookAbbrev(book)}
              </button>
            ))}
          </div>

          {filteredBooks.length === 0 && !searchResults.length && (
            <div className="dock-empty" style={{ padding: 16 }}>
              <div className="dock-empty__text">No books match "{searchQuery}"</div>
            </div>
          )}
        </>
      )}

      {/* Step: Chapter selection */}
      {step === "chapter" && (
        <>
          <div className="dock-section-label">Select Chapter</div>
          <div className="dock-numpad">
            {Array.from({ length: chapterCount }, (_, i) => i + 1).map((ch) => (
              <button
                key={ch}
                className={`dock-numpad-btn${selectedChapter === ch ? " dock-numpad-btn--active" : ""}`}
                onClick={() => handleSelectChapter(ch)}
              >
                {ch}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Step: Verse selection */}
      {step === "verse" && (
        <>
          <div className="dock-section-label">Select Verse</div>
          <div className="dock-numpad">
            {Array.from({ length: verseCount }, (_, i) => i + 1).map((v) => (
              <button
                key={v}
                className={`dock-numpad-btn${selectedVerse === v ? " dock-numpad-btn--active" : ""}`}
                onClick={() => handleSelectVerse(v)}
                onDoubleClick={() => handleDoubleClickVerse(v)}
                title="Click to stage, double-click to send to preview"
              >
                {v}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Overlay mode toggle */}
      <div className="dock-section-label" style={{ marginTop: 8 }}>Overlay Mode</div>
      <div className="dock-theme-bar" style={{ marginBottom: 8 }}>
        <button
          className={`dock-theme-pill${overlayMode === "fullscreen" ? " dock-theme-pill--active" : ""}`}
          onClick={() => setOverlayMode("fullscreen")}
        >
          <Icon name="fullscreen" size={14} />
          Fullscreen
        </button>
        <button
          className={`dock-theme-pill${overlayMode === "lower-third" ? " dock-theme-pill--active" : ""}`}
          onClick={() => setOverlayMode("lower-third")}
        >
          <Icon name="subtitles" size={14} />
          Lower Third
        </button>
      </div>

      <div className="dock-section-label" style={{ marginTop: 10 }}>
        Theme Default
      </div>
      <div className="dock-card" style={{ cursor: "default" }}>
        <div className="dock-card__title">
          {overlayMode === "fullscreen" ? selectedBibleTheme.name : selectedLowerThirdTheme.name}
        </div>
        <div className="dock-card__subtitle">
          Managed in the app&apos;s Production Theme Settings page.
        </div>
      </div>
    </>
  );
}
