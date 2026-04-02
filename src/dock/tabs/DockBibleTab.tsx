/**
 * DockBibleTab.tsx — Bible tab for the OBS Browser Dock
 *
 * Smart search: type "gen1vs1", "g11", "jn3:16", "ps23" etc.
 * Resolves straight into a fast chapter reader with stage / live actions per verse.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResult as BibleKeywordResult } from "../../bible/bibleData";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import type { BiblePassage, BibleTheme } from "../../bible/types";
import { dockClient, type DockStateMessage } from "../../services/dockBridge";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import {
  createVoiceBibleDockCommand,
  getVoiceBibleResultKey,
  loadVoiceBibleDockState,
  postVoiceBibleDockCommand,
  type VoiceBibleDockCommandType,
} from "../../services/voiceBibleDockInterop";
import type {
  VoiceBibleCandidate,
  VoiceBibleContextPayload,
  VoiceBibleResult,
  VoiceBibleSnapshot,
} from "../../services/voiceBibleTypes";
import { parseBibleSearch, type BibleSearchResult } from "../bibleSearchParser";
import DockBibleThemePicker from "../components/DockBibleThemePicker";
import {
  buildDockBackgroundPresetOverrides,
  type DockBackgroundPreset
} from "../dockConsoleTheme";
import Icon from "../DockIcon";
import { dockObsClient } from "../dockObsClient";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";
import {
  BOOK_CHAPTERS,
  OT_BOOKS,
  type DockStagedItem,
} from "../dockTypes";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  productionDefaults: DockProductionModuleSettings;
  initialVoiceBible?: VoiceBibleSnapshot | null;
  appConnected: boolean;
}

type OverlayMode = "fullscreen" | "lower-third";
const DOCK_BIBLE_PREFS_KEY = "ocs-dock-bible-preferences";
const MAX_VERSE_LINES = 4;
const DEFAULT_VERSE_LINES = 1;
const QUICK_SELECT_VERSION_COUNT = 3;

interface DockBiblePreferences {
  overlayMode?: OverlayMode;
  translation?: string;
  translations?: string[];
  verseLineCount?: number;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  backgroundPreset?: DockBackgroundPreset;
  selectedBook?: string;
  selectedChapter?: number;
}

type ColumnTranslations = string[];

function normalizeColumnTranslations(
  values?: string[] | null,
  fallback = "KJV",
): ColumnTranslations {
  const source = Array.isArray(values) ? values.filter(Boolean) : [];
  return Array.from({ length: MAX_VERSE_LINES }, (_, index) => {
    const next = source[index] ?? source[0] ?? fallback;
    return next.toUpperCase();
  });
}

function createEmptyPassages(): Array<BiblePassage | null> {
  return Array.from({ length: MAX_VERSE_LINES }, () => null);
}

function createEmptyErrors(): string[] {
  return Array.from({ length: MAX_VERSE_LINES }, () => "");
}

function clampVerseLineCount(value?: number): number {
  if (!value || Number.isNaN(value)) return DEFAULT_VERSE_LINES;
  return Math.min(MAX_VERSE_LINES, Math.max(1, value));
}

function loadDockBiblePreferences(): DockBiblePreferences {
  try {
    const raw = localStorage.getItem(DOCK_BIBLE_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DockBiblePreferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDockBiblePreferences(next: DockBiblePreferences): void {
  try {
    localStorage.setItem(DOCK_BIBLE_PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore persistence failures in OBS CEF
  }
}

type DockBibleSearchOption =
  | ({ kind: "reference" } & BibleSearchResult)
  | {
    kind: "keyword";
    book: string;
    chapter: number;
    verse: number;
    label: string;
    snippet: string;
  };

function emptyVoiceBibleSnapshot(): VoiceBibleSnapshot {
  return {
    status: "idle",
    modelReady: false,
    semanticReady: false,
    candidates: [],
    lastResult: null,
  };
}

export default function DockBibleTab({
  staged,
  onStage,
  productionDefaults,
  initialVoiceBible,
  appConnected,
}: Props) {
  const [selectedBook, setSelectedBook] = useState<string | null>(OT_BOOKS[0] ?? null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(1);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [columnTranslations, setColumnTranslations] = useState<ColumnTranslations>(() => normalizeColumnTranslations());
  const [verseLineCount, setVerseLineCount] = useState(DEFAULT_VERSE_LINES);
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
  const [keywordResults, setKeywordResults] = useState<BibleKeywordResult[]>([]);
  const [isKeywordSearching, setIsKeywordSearching] = useState(false);
  const [, setVerseText] = useState<string | null>(null);
  const [verseCount, setVerseCount] = useState(30);
  const [voiceBible, setVoiceBible] = useState<VoiceBibleSnapshot>(
    () => initialVoiceBible ?? emptyVoiceBibleSnapshot(),
  );
  const [voiceHeld, setVoiceHeld] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [backgroundPreset, setBackgroundPreset] = useState<DockBackgroundPreset>("theme");
  const [chapterPassages, setChapterPassages] = useState<Array<BiblePassage | null>>(() => createEmptyPassages());
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterErrors, setChapterErrors] = useState<string[]>(() => createEmptyErrors());
  const [highlightVerse, setHighlightVerse] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const verseGridRef = useRef<HTMLDivElement>(null);
  const verseClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionBarRef = useRef<HTMLDivElement>(null);
  const voiceHeldRef = useRef(false);
  const voiceBridgeTimeoutRef = useRef<number | null>(null);
  const voiceFallbackReadyRef = useRef(false);
  const lastVoiceResultKeyRef = useRef(getVoiceBibleResultKey(initialVoiceBible?.lastResult));
  const lastVoiceEventTimestampRef = useRef(0);
  const pendingScrollVerseRef = useRef<number | null>(null);
  const prefsReadyRef = useRef(false);
  const [openVersionDropdownIndex, setOpenVersionDropdownIndex] = useState<number | null>(null);
  const isProgramLive =
    staged?.type === "bible" &&
    Boolean((staged.data as Record<string, unknown> | undefined)?._dockLive);
  const activeColumnIndex = Math.min(Math.max(selectedColumn, 0), QUICK_SELECT_VERSION_COUNT - 1);
  const activeTranslation = columnTranslations[activeColumnIndex] ?? columnTranslations[0];
  const quickTranslations = useMemo(
    () => columnTranslations.slice(0, QUICK_SELECT_VERSION_COUNT),
    [columnTranslations],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!versionBarRef.current?.contains(event.target as Node)) {
        setOpenVersionDropdownIndex(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    prefsReadyRef.current = false;
    const prefs = loadDockBiblePreferences();
    const initialBook =
      prefs.selectedBook && BOOK_CHAPTERS[prefs.selectedBook]
        ? prefs.selectedBook
        : (OT_BOOKS[0] ?? null);
    const maxInitialChapter = initialBook ? (BOOK_CHAPTERS[initialBook] ?? 1) : 1;
    const initialChapter = Math.min(
      Math.max(prefs.selectedChapter ?? 1, 1),
      maxInitialChapter,
    );
    setSelectedBibleTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
    setSelectedLowerThirdTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
    setOverlayMode(prefs.overlayMode ?? productionDefaults.defaultMode);
    setColumnTranslations(
      normalizeColumnTranslations(
        prefs.translations ?? (prefs.translation ? [prefs.translation] : undefined),
      ),
    );
    setVerseLineCount(clampVerseLineCount(prefs.verseLineCount));
    setBackgroundPreset(prefs.backgroundPreset ?? "theme");
    setSelectedBook(initialBook);
    setSelectedChapter(initialBook ? initialChapter : null);
    setSelectedVerse(null);
    setSelectedColumn(0);

    let cancelled = false;
    const applyStoredThemes = async () => {
      const [fullscreenFavorites, lowerThirdFavorites] = await Promise.all([
        loadDockFavoriteBibleThemes("fullscreen"),
        loadDockFavoriteBibleThemes("lower-third"),
      ]);

      if (cancelled) return;

      const storedFullscreen = fullscreenFavorites.find((theme) => theme.id === prefs.fullscreenThemeId);
      const storedLowerThird = lowerThirdFavorites.find((theme) => theme.id === prefs.lowerThirdThemeId);

      if (storedFullscreen) {
        setSelectedBibleTheme(storedFullscreen);
      }

      if (storedLowerThird) {
        setSelectedLowerThirdTheme(storedLowerThird);
      }

      prefsReadyRef.current = true;
    };

    void applyStoredThemes().catch(() => {
      prefsReadyRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [
    productionDefaults.defaultMode,
    productionDefaults.fullscreenTheme,
    productionDefaults.lowerThirdTheme,
  ]);

  useEffect(() => {
    if (!prefsReadyRef.current) return;
    saveDockBiblePreferences({
      overlayMode,
      translation: activeTranslation,
      translations: [...columnTranslations],
      verseLineCount,
      fullscreenThemeId: selectedBibleTheme.id,
      lowerThirdThemeId: selectedLowerThirdTheme.id,
      backgroundPreset,
      selectedBook: selectedBook ?? undefined,
      selectedChapter: selectedChapter ?? undefined,
    });
  }, [
    activeTranslation,
    backgroundPreset,
    columnTranslations,
    overlayMode,
    verseLineCount,
    selectedBibleTheme.id,
    selectedBook,
    selectedChapter,
    selectedLowerThirdTheme.id,
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
    setColumnTranslations((current) => {
      const next = current.map((value) =>
        allowed.has(value.toUpperCase()) ? value.toUpperCase() : "KJV",
      );
      return current.every((value, index) => value === next[index]) ? current : next;
    });
  }, [availableTranslations]);

  const fullscreenLiveOverrides = useMemo(
    () => buildDockBackgroundPresetOverrides(selectedBibleTheme.settings, backgroundPreset),
    [backgroundPreset, selectedBibleTheme.settings],
  );

  // ── Fetch verse count when chapter changes ──
  useEffect(() => {
    if (!selectedBook || !selectedChapter) { setVerseCount(30); return; }
    let cancelled = false;
    (async () => {
      try {
        const { getVerseCount } = await import("../../bible/bibleData");
        const count = await getVerseCount(selectedBook, selectedChapter, activeTranslation);
        if (!cancelled) setVerseCount(count || 30);
      } catch { if (!cancelled) setVerseCount(30); }
    })();
    return () => { cancelled = true; };
  }, [activeTranslation, selectedBook, selectedChapter]);

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

  const focusReference = useCallback((book: string, chapter: number, verse?: number | null) => {
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setSelectedVerse(verse ?? null);
    pendingScrollVerseRef.current = verse ?? null;
  }, []);

  useEffect(() => {
    if (!selectedBook || !selectedChapter) {
      setChapterPassages(createEmptyPassages());
      setChapterLoading(false);
      setChapterErrors(createEmptyErrors());
      return;
    }

    let cancelled = false;
    setChapterLoading(true);
    setChapterErrors(createEmptyErrors());
    setChapterPassages(createEmptyPassages());
    (async () => {
      try {
        const { getChapter } = await import("../../bible/bibleData");
        const uniqueTranslations = Array.from(
          new Set(quickTranslations.map((value) => value.toUpperCase())),
        );
        const passageMap = new Map<string, BiblePassage>();
        const errorMap = new Map<string, string>();

        await Promise.all(
          uniqueTranslations.map(async (version) => {
            try {
              const passage = await getChapter(selectedBook, selectedChapter, version);
              passageMap.set(version, passage);
            } catch (error) {
              errorMap.set(
                version,
                error instanceof Error ? error.message : "Unable to load this version.",
              );
            }
          }),
        );
        if (cancelled) return;
        const nextPassages = createEmptyPassages();
        const nextErrors = createEmptyErrors();
        columnTranslations.forEach((version, index) => {
          nextPassages[index] = passageMap.get(version) ?? null;
          nextErrors[index] = errorMap.get(version) ?? "";
        });
        setChapterPassages(nextPassages);
        setChapterErrors(nextErrors);
      } catch (error) {
        if (cancelled) return;
        const nextErrors = createEmptyErrors();
        nextErrors[0] = error instanceof Error ? error.message : "Unable to load the selected chapter.";
        setChapterPassages(createEmptyPassages());
        setChapterErrors(nextErrors);
      } finally {
        if (!cancelled) {
          setChapterLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [columnTranslations, quickTranslations, selectedBook, selectedChapter]);

  const resolveVerseSelection = useCallback(
    async (
      book: string,
      chapter: number,
      verse: number,
      translation: string,
      lineCount: number,
    ): Promise<{ text: string; verseRange: string; verseEnd: number }> => {
      const safeLineCount = clampVerseLineCount(lineCount);
      const existingPassage =
        book === selectedBook && chapter === selectedChapter && translation === activeTranslation
          ? chapterPassages[activeColumnIndex]
          : null;

      let passage = existingPassage;
      if (!passage) {
        try {
          const { getChapter } = await import("../../bible/bibleData");
          passage = await getChapter(book, chapter, translation);
        } catch {
          passage = null;
        }
      }

      const verses = passage?.verses ?? [];
      const startIndex = verses.findIndex((entry) => entry.verse === verse);
      if (startIndex === -1) {
        const text = await fetchVerseText(book, chapter, verse, translation);
        return { text, verseRange: String(verse), verseEnd: verse };
      }

      const selection = verses.slice(startIndex, startIndex + safeLineCount);
      const verseEnd = selection[selection.length - 1]?.verse ?? verse;
      const text =
        selection.length <= 1
          ? (selection[0]?.text ?? `${book} ${chapter}:${verse}`)
          : selection.map((entry) => `${entry.verse}. ${entry.text}`).join("\n");
      const verseRange = verseEnd === verse ? String(verse) : `${verse}-${verseEnd}`;
      return { text, verseRange, verseEnd };
    },
    [activeColumnIndex, activeTranslation, chapterPassages, fetchVerseText, selectedBook, selectedChapter],
  );

  const stageVerse = useCallback(
    async (
      book: string,
      chapter: number,
      verse: number,
      options?: {
        sendToPreview?: boolean;
        sendToProgram?: boolean;
        translation?: string;
        columnIndex?: number;
      },
    ) => {
      const effectiveTranslation = options?.translation ?? activeTranslation;
      focusReference(book, chapter, verse);
      if (typeof options?.columnIndex === "number") {
        setSelectedColumn(Math.min(Math.max(options.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1));
      }
      setActionError("");
      const selection = await resolveVerseSelection(book, chapter, verse, effectiveTranslation, verseLineCount);
      setVerseText(selection.text);
      const referenceLabel = `${book} ${chapter}:${selection.verseRange}`;

      const stageData = {
        book,
        chapter,
        verse,
        columnIndex:
          typeof options?.columnIndex === "number"
            ? Math.min(Math.max(options.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1)
            : activeColumnIndex,
        verseEnd: selection.verseEnd,
        verseRange: selection.verseRange,
        referenceLabel,
        lineCount: verseLineCount,
        translation: effectiveTranslation,
        verseText: selection.text,
        overlayMode,
        theme: overlayMode === "fullscreen" ? selectedBibleTheme.id : selectedLowerThirdTheme.id,
        bibleThemeSettings: (
          overlayMode === "fullscreen" ? selectedBibleTheme.settings : selectedLowerThirdTheme.settings
        ) as unknown as Record<string, unknown>,
        liveOverrides:
          overlayMode === "fullscreen"
            ? (fullscreenLiveOverrides as Record<string, unknown> | null)
            : null,
        _dockLive: Boolean(options?.sendToProgram),
      };

      onStage({
        type: "bible",
        label: referenceLabel,
        subtitle: selection.text,
        data: stageData,
      });

      if (options?.sendToProgram) {
        setSending(true);
        try {
          await dockObsClient.pushBible(stageData, true);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[DockBibleTab] Auto-update program failed:", err);
          setActionError(message);
        } finally {
          setSending(false);
        }
        return;
      }

      if (options?.sendToPreview) {
        setSending(true);
        try {
          await dockObsClient.pushBible(stageData, false);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[DockBibleTab] Send to preview failed:", err);
          setActionError(message);
        } finally {
          setSending(false);
        }
      }
    },
    [
      focusReference,
      fullscreenLiveOverrides,
      onStage,
      overlayMode,
      resolveVerseSelection,
      selectedBibleTheme.id,
      selectedBibleTheme.settings,
      selectedLowerThirdTheme.id,
      selectedLowerThirdTheme.settings,
      activeTranslation,
      verseLineCount,
    ],
  );

  // ── Re-fetch verse text when the active column translation changes ──
  const prevActiveTranslation = useRef(activeTranslation);
  useEffect(() => {
    if (prevActiveTranslation.current === activeTranslation) return;
    prevActiveTranslation.current = activeTranslation;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    let cancelled = false;
    (async () => {
      await stageVerse(selectedBook, selectedChapter, selectedVerse, {
        sendToProgram: isProgramLive,
        translation: activeTranslation,
        columnIndex: activeColumnIndex,
      });
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [
    activeColumnIndex,
    activeTranslation,
    isProgramLive,
    selectedBook,
    selectedChapter,
    selectedVerse,
    stageVerse,
  ]);

  // ── Re-stage verse when overlay mode changes ──
  const prevOverlayMode = useRef(overlayMode);
  useEffect(() => {
    if (prevOverlayMode.current === overlayMode) return;   // skip mount
    prevOverlayMode.current = overlayMode;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    void stageVerse(selectedBook, selectedChapter, selectedVerse, {
      sendToProgram: isProgramLive,
    });
  }, [overlayMode, selectedBook, selectedChapter, selectedVerse, stageVerse, isProgramLive]);

  const prevThemeSignature = useRef(`${selectedBibleTheme.id}:${selectedLowerThirdTheme.id}`);
  useEffect(() => {
    const nextSignature = `${selectedBibleTheme.id}:${selectedLowerThirdTheme.id}`;
    if (prevThemeSignature.current === nextSignature) return;
    prevThemeSignature.current = nextSignature;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    void stageVerse(selectedBook, selectedChapter, selectedVerse, {
      sendToProgram: isProgramLive,
    });
  }, [selectedBibleTheme, selectedLowerThirdTheme, selectedBook, selectedChapter, selectedVerse, stageVerse, isProgramLive]);

  const prevBackgroundPreset = useRef(backgroundPreset);
  useEffect(() => {
    if (prevBackgroundPreset.current === backgroundPreset) return;
    prevBackgroundPreset.current = backgroundPreset;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;
    if (overlayMode !== "fullscreen") return;

    void stageVerse(selectedBook, selectedChapter, selectedVerse, {
      sendToProgram: isProgramLive,
    });
  }, [
    backgroundPreset,
    isProgramLive,
    overlayMode,
    selectedBook,
    selectedChapter,
    selectedVerse,
    stageVerse,
  ]);

  const prevVerseLineCount = useRef(verseLineCount);
  useEffect(() => {
    if (prevVerseLineCount.current === verseLineCount) return;
    prevVerseLineCount.current = verseLineCount;

    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    void stageVerse(selectedBook, selectedChapter, selectedVerse, {
      sendToProgram: isProgramLive,
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
    });
  }, [
    activeColumnIndex,
    activeTranslation,
    isProgramLive,
    selectedBook,
    selectedChapter,
    selectedVerse,
    stageVerse,
    verseLineCount,
  ]);

  useEffect(() => {
    if (!initialVoiceBible) return;
    setVoiceBible(initialVoiceBible);
  }, [initialVoiceBible]);

  useEffect(() => {
    if (!staged || staged.type !== "bible") return;
    const data = (staged.data ?? null) as Record<string, unknown> | null;
    if (!data) return;

    const book = typeof data.book === "string" ? data.book : null;
    const chapter = typeof data.chapter === "number" ? data.chapter : null;
    const verse = typeof data.verse === "number" ? data.verse : null;
    const translation = typeof data.translation === "string" ? data.translation.toUpperCase() : null;
    const stagedColumnIndex =
      typeof data.columnIndex === "number"
        ? Math.min(Math.max(data.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1)
        : null;
    const lineCount = typeof data.lineCount === "number" ? clampVerseLineCount(data.lineCount) : null;
    const nextOverlayMode =
      data.overlayMode === "fullscreen" || data.overlayMode === "lower-third"
        ? (data.overlayMode as OverlayMode)
        : null;

    if (book && BOOK_CHAPTERS[book]) {
      setSelectedBook(book);
    }
    if (chapter) {
      setSelectedChapter(chapter);
    }
    if (verse) {
      setSelectedVerse(verse);
      pendingScrollVerseRef.current = verse;
    }
    if (translation) {
      setColumnTranslations((current) => {
        const next = [...current];
        const targetIndex = stagedColumnIndex ?? activeColumnIndex;
        next[targetIndex] = translation;
        return next;
      });
    }
    if (lineCount) {
      setVerseLineCount(lineCount);
    }
    if (nextOverlayMode) {
      setOverlayMode(nextOverlayMode);
    }
  }, [staged]);

  const buildVoiceContext = useCallback(
    (): VoiceBibleContextPayload => ({
      selectedBook,
      selectedChapter,
      selectedVerse,
      translation: activeTranslation,
      availableTranslations,
    }),
    [activeTranslation, availableTranslations, selectedBook, selectedChapter, selectedVerse],
  );

  const applyVoiceResult = useCallback(
    async (result: VoiceBibleResult | null) => {
      if (!result) return;

      if (result.action === "set-translation" && result.translation) {
        setColumnTranslations((current) => {
          const next = [...current];
          next[activeColumnIndex] = result.translation!.toUpperCase();
          return next;
        });
        return;
      }

      if (result.action === "set-chapter" && result.book && result.chapter) {
        setSelectedBook(result.book);
        setSelectedChapter(result.chapter);
        setSelectedVerse(null);
        setSearchQuery("");
        setShowDropdown(false);
        pendingScrollVerseRef.current = null;
        return;
      }

      if (
        result.action === "stage-verse" &&
        result.book &&
        result.chapter &&
        result.verse
      ) {
        if (result.translation && result.translation !== activeTranslation) {
          setColumnTranslations((current) => {
            const next = [...current];
            next[activeColumnIndex] = result.translation!.toUpperCase();
            return next;
          });
        }
        await stageVerse(result.book, result.chapter, result.verse, {
          translation: result.translation ?? activeTranslation,
          columnIndex: activeColumnIndex,
        });
      }
    },
    [activeColumnIndex, activeTranslation, stageVerse],
  );

  useEffect(() => {
    const unsub = dockClient.onState((msg: DockStateMessage) => {
      if (msg.type === "state:update") {
        const payload = msg.payload as Record<string, unknown>;
        if (payload.voiceBible) {
          if (voiceBridgeTimeoutRef.current) {
            clearTimeout(voiceBridgeTimeoutRef.current);
            voiceBridgeTimeoutRef.current = null;
          }
          voiceFallbackReadyRef.current = true;
          lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
          lastVoiceResultKeyRef.current = getVoiceBibleResultKey(
            (payload.voiceBible as VoiceBibleSnapshot).lastResult,
          );
          setVoiceBible(payload.voiceBible as VoiceBibleSnapshot);
        }
        return;
      }

      if (msg.type === "state:voice-bible-status") {
        if (voiceBridgeTimeoutRef.current) {
          clearTimeout(voiceBridgeTimeoutRef.current);
          voiceBridgeTimeoutRef.current = null;
        }
        voiceFallbackReadyRef.current = true;
        lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
        lastVoiceResultKeyRef.current = getVoiceBibleResultKey(
          (msg.payload as VoiceBibleSnapshot).lastResult,
        );
        setVoiceBible(msg.payload as VoiceBibleSnapshot);
        return;
      }

      if (msg.type === "state:voice-bible-candidates") {
        if (voiceBridgeTimeoutRef.current) {
          clearTimeout(voiceBridgeTimeoutRef.current);
          voiceBridgeTimeoutRef.current = null;
        }
        voiceFallbackReadyRef.current = true;
        lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
        const payload = msg.payload as {
          transcript?: string;
          detail?: string;
          candidates?: VoiceBibleCandidate[];
        };
        setVoiceBible((current) => ({
          ...current,
          transcript: payload.transcript ?? current.transcript,
          detail: payload.detail ?? current.detail,
          candidates: payload.candidates ?? [],
        }));
        return;
      }

      if (msg.type === "state:voice-bible-result") {
        if (voiceBridgeTimeoutRef.current) {
          clearTimeout(voiceBridgeTimeoutRef.current);
          voiceBridgeTimeoutRef.current = null;
        }
        voiceFallbackReadyRef.current = true;
        lastVoiceEventTimestampRef.current = Math.max(lastVoiceEventTimestampRef.current, msg.timestamp);
        const payload = (msg.payload ?? null) as VoiceBibleResult | null;
        lastVoiceResultKeyRef.current = getVoiceBibleResultKey(payload);
        void applyVoiceResult(payload);
      }
    });

    return unsub;
  }, [applyVoiceResult]);

  useEffect(() => {
    let cancelled = false;

    const pollVoiceState = async () => {
      const fallback = await loadVoiceBibleDockState();
      if (!fallback || cancelled) return;
      if (fallback.updatedAt <= lastVoiceEventTimestampRef.current) return;

      lastVoiceEventTimestampRef.current = fallback.updatedAt;
      if (voiceBridgeTimeoutRef.current) {
        clearTimeout(voiceBridgeTimeoutRef.current);
        voiceBridgeTimeoutRef.current = null;
      }

      const resultKey = getVoiceBibleResultKey(fallback.snapshot.lastResult);
      const shouldSkipInitialReplay =
        !voiceFallbackReadyRef.current &&
        !voiceHeldRef.current &&
        voiceBible.status === "idle";

      voiceFallbackReadyRef.current = true;
      setVoiceBible(fallback.snapshot);

      if (shouldSkipInitialReplay) {
        lastVoiceResultKeyRef.current = resultKey;
        return;
      }

      if (resultKey && resultKey !== lastVoiceResultKeyRef.current) {
        lastVoiceResultKeyRef.current = resultKey;
        await applyVoiceResult(fallback.snapshot.lastResult ?? null);
        return;
      }

      if (!resultKey) {
        lastVoiceResultKeyRef.current = "";
      }
    };

    void pollVoiceState();
    const intervalId = window.setInterval(() => {
      void pollVoiceState();
    }, appConnected ? 900 : 300);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [appConnected, applyVoiceResult, voiceBible.status]);

  const voiceStatusLabel =
    voiceBible.status === "listening"
      ? "Listening"
      : voiceBible.status === "transcribing"
        ? "Transcribing"
        : voiceBible.status === "matching"
          ? "Matching"
          : voiceBible.status === "no-match"
            ? "No Match"
            : voiceBible.status === "error"
              ? "Error"
              : "Idle";
  const voiceBusy =
    voiceBible.status === "transcribing" || voiceBible.status === "matching";
  const voiceListening = voiceHeld || voiceBible.status === "listening";
  const voiceActionIcon =
    voiceBible.status === "listening"
      ? "record_voice_over"
      : voiceBusy
        ? "sync"
        : "mic";
  const voiceActionLabel =
    voiceListening
      ? "Stop voice search"
      : voiceBusy
        ? "Processing voice search"
        : "Start voice search";

  const sendVoiceCommand = useCallback(
    (
      type: VoiceBibleDockCommandType,
      payload?: VoiceBibleContextPayload | null,
    ) => {
      const command = createVoiceBibleDockCommand(type, payload);
      dockClient.sendCommand(command);
      void postVoiceBibleDockCommand(command).catch((err) => {
        console.warn("[DockBibleTab] Voice fallback command failed:", err);
      });
    },
    [],
  );

  useEffect(() => () => {
    voiceHeldRef.current = false;
    if (voiceBridgeTimeoutRef.current) {
      clearTimeout(voiceBridgeTimeoutRef.current);
      voiceBridgeTimeoutRef.current = null;
    }
    const command = createVoiceBibleDockCommand("voice-bible:cancel");
    dockClient.sendCommand(command);
    void postVoiceBibleDockCommand(command).catch(() => { });
  }, []);

  const beginVoiceCapture = useCallback(() => {
    if (voiceHeldRef.current || voiceBusy) return;
    voiceFallbackReadyRef.current = true;
    if (voiceBridgeTimeoutRef.current) {
      clearTimeout(voiceBridgeTimeoutRef.current);
      voiceBridgeTimeoutRef.current = null;
    }
    voiceBridgeTimeoutRef.current = window.setTimeout(() => {
      voiceBridgeTimeoutRef.current = null;
      voiceHeldRef.current = false;
      setVoiceHeld(false);
      setVoiceBible((current) => ({
        ...current,
        status: "error",
        detail: "Voice control requires the desktop app connection.",
        error: "The dock sent the request but did not receive a response from the desktop app. Keep the app open, then try again.",
      }));
    }, 2000);
    voiceHeldRef.current = true;
    setVoiceHeld(true);
    setVoiceBible((current) => ({
      ...current,
      status: "transcribing",
      detail: appConnected ? "Starting voice search…" : "Connecting to desktop app…",
      error: undefined,
      candidates: [],
    }));
    sendVoiceCommand("voice-bible:start", buildVoiceContext());
  }, [appConnected, buildVoiceContext, sendVoiceCommand, voiceBusy]);

  const endVoiceCapture = useCallback(() => {
    if (!voiceHeldRef.current) return;
    voiceHeldRef.current = false;
    setVoiceHeld(false);
    sendVoiceCommand("voice-bible:stop", buildVoiceContext());
  }, [buildVoiceContext, sendVoiceCommand]);
  const handleVoiceToggle = useCallback(() => {
    if (voiceBusy) return;
    if (voiceHeldRef.current || voiceBible.status === "listening") {
      endVoiceCapture();
      return;
    }
    beginVoiceCapture();
  }, [beginVoiceCapture, endVoiceCapture, voiceBible.status, voiceBusy]);

  const handlePickVoiceCandidate = useCallback(
    async (candidate: VoiceBibleCandidate) => {
      if (candidate.translation !== activeTranslation) {
        setColumnTranslations((current) => {
          const next = [...current];
          next[activeColumnIndex] = candidate.translation.toUpperCase();
          return next;
        });
      }
      setVoiceBible((current) => ({
        ...current,
        status: "idle",
        detail: `Staged ${candidate.label}`,
        candidates: [],
      }));
      await stageVerse(candidate.book, candidate.chapter, candidate.verse, {
        translation: candidate.translation,
        columnIndex: activeColumnIndex,
      });
    },
    [activeColumnIndex, activeTranslation, stageVerse],
  );

  // ── Smart search results ──
  const referenceResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return parseBibleSearch(searchQuery).map((result) => ({
      ...result,
      kind: "reference" as const,
    }));
  }, [searchQuery]);

  useEffect(() => {
    const trimmed = searchQuery.trim();

    if (!trimmed || trimmed.length < 3 || referenceResults.length > 0) {
      setKeywordResults([]);
      setIsKeywordSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsKeywordSearching(true);
      try {
        const { searchBible } = await import("../../bible/bibleData");
        const matches = await searchBible(trimmed, activeTranslation, 12);
        if (!cancelled) {
          setKeywordResults(matches);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[DockBibleTab] Keyword search failed:", err);
          setKeywordResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsKeywordSearching(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTranslation, referenceResults.length, searchQuery]);

  const searchResults = useMemo<DockBibleSearchOption[]>(() => {
    const keywordMatches = keywordResults.map((result) => ({
      kind: "keyword" as const,
      book: result.book,
      chapter: result.chapter,
      verse: result.verse,
      label: `${result.book} ${result.chapter}:${result.verse}`,
      snippet: result.snippet || result.text,
    }));
    return [...referenceResults, ...keywordMatches];
  }, [keywordResults, referenceResults]);

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
    async (result: DockBibleSearchOption, options?: { sendToPreview?: boolean; sendToProgram?: boolean }) => {
      const sendToProgram = options?.sendToProgram ?? false;
      const sendToPreview = options?.sendToPreview ?? false;
      setSearchQuery("");
      setShowDropdown(false);
      setActiveIdx(-1);

      if (result.kind === "keyword") {
        focusReference(result.book, result.chapter, result.verse);
        await stageVerse(result.book, result.chapter, result.verse, {
          sendToProgram,
          sendToPreview,
          translation: activeTranslation,
          columnIndex: activeColumnIndex,
        });
      } else if (result.chapter !== null && result.verse !== null) {
        focusReference(result.book, result.chapter, result.verse);
        await stageVerse(result.book, result.chapter, result.verse, {
          sendToProgram,
          sendToPreview,
          translation: activeTranslation,
          columnIndex: activeColumnIndex,
        });
      } else if (result.chapter !== null) {
        focusReference(result.book, result.chapter, null);
      } else {
        setSelectedBook(result.book);
        setSelectedChapter(1);
        setSelectedVerse(null);
        pendingScrollVerseRef.current = null;
      }
    },
    [activeColumnIndex, activeTranslation, focusReference, stageVerse]
  );

  // ── Keyboard navigation ──
  const handleClearVerse = useCallback(() => {
    setSelectedVerse(null);
    setVerseText(null);
    setActionError("");
    pendingScrollVerseRef.current = null;
    onStage(null);
    if (dockObsClient.isConnected) {
      dockObsClient.clearBible().catch((err) =>
        console.warn("[DockBibleTab] clearBible failed:", err)
      );
    }
  }, [onStage]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget instanceof HTMLInputElement) {
          e.currentTarget.select();
        }
        return;
      }

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
          void handlePickResult(picked);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (showDropdown) {
          setShowDropdown(false);
          return;
        }
        handleClearVerse();
      }
    },
    [showDropdown, searchResults, activeIdx, handleClearVerse, handlePickResult]
  );

  const handleVerseClick = useCallback(
    (v: number, columnIndex: number, version: string) => {
      if (!selectedBook || !selectedChapter) return;
      if (verseClickTimerRef.current) {
        clearTimeout(verseClickTimerRef.current);
      }
      verseClickTimerRef.current = setTimeout(() => {
        verseClickTimerRef.current = null;
        void stageVerse(selectedBook, selectedChapter, v, {
          translation: version,
          columnIndex,
        });
      }, 220);
    },
    [selectedBook, selectedChapter, stageVerse],
  );

  const navigateChapter = useCallback(
    (delta: -1 | 1) => {
      if (!selectedBook || !selectedChapter) return;
      const maxChapter = BOOK_CHAPTERS[selectedBook] ?? selectedChapter;
      const nextChapter = Math.min(maxChapter, Math.max(1, selectedChapter + delta));
      if (nextChapter === selectedChapter) return;
      setSelectedChapter(nextChapter);
      setSelectedVerse(null);
      setActionError("");
      pendingScrollVerseRef.current = null;
    },
    [selectedBook, selectedChapter],
  );

  const handleVerseDoubleClick = useCallback(
    (v: number, columnIndex: number, version: string) => {
      if (!selectedBook || !selectedChapter) return;
      if (verseClickTimerRef.current) {
        clearTimeout(verseClickTimerRef.current);
        verseClickTimerRef.current = null;
      }
      void stageVerse(selectedBook, selectedChapter, v, {
        sendToProgram: true,
        translation: version,
        columnIndex,
      });
    },
    [selectedBook, selectedChapter, stageVerse],
  );

  const stopVerseActionEvent = useCallback((event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleQuickVersionSelect = useCallback((columnIndex: number) => {
    setSelectedColumn(Math.min(Math.max(columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1));
    setOpenVersionDropdownIndex(null);
  }, []);

  const handleQuickVersionChange = useCallback((columnIndex: number, version: string) => {
    const nextValue = version.toUpperCase();
    setColumnTranslations((current) => {
      const next = [...current];
      next[columnIndex] = nextValue;
      return next;
    });
    setOpenVersionDropdownIndex(null);
  }, []);

  const handleQuickVersionToggle = useCallback((event: React.MouseEvent, columnIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    setOpenVersionDropdownIndex((current) => (current === columnIndex ? null : columnIndex));
  }, []);

  const handleSelectFullscreenTheme = useCallback((theme: BibleTheme) => {
    setSelectedBibleTheme(theme);
    setOverlayMode("fullscreen");
  }, []);

  const handleSelectLowerThirdTheme = useCallback((theme: BibleTheme) => {
    setSelectedLowerThirdTheme(theme);
    setOverlayMode("lower-third");
  }, []);

  const activeThemePickerProps =
    overlayMode === "fullscreen"
      ? {
          selectedThemeId: selectedBibleTheme.id,
          onSelect: handleSelectFullscreenTheme,
          label: "Fullscreen Theme",
          templateType: "fullscreen" as const,
        }
      : {
          selectedThemeId: selectedLowerThirdTheme.id,
          onSelect: handleSelectLowerThirdTheme,
          label: "Lower Third Theme",
          templateType: "lower-third" as const,
        };

  const navigateVerse = useCallback(
    async (delta: 1 | -1) => {
      if (!selectedBook || !selectedChapter) return;

      let nextChapter = selectedChapter;
      let nextVerse = selectedVerse ?? 1;
      let nextVerseCount = verseCount;

      if (delta > 0) {
        if (nextVerse < verseCount) {
          nextVerse += 1;
        } else {
          const maxChapter = BOOK_CHAPTERS[selectedBook] ?? selectedChapter;
          if (selectedChapter >= maxChapter) return;
          nextChapter = selectedChapter + 1;
          try {
            const { getVerseCount } = await import("../../bible/bibleData");
            nextVerseCount = await getVerseCount(selectedBook, nextChapter, activeTranslation) || 30;
          } catch {
            nextVerseCount = 30;
          }
          nextVerse = 1;
        }
      } else if (nextVerse > 1) {
        nextVerse -= 1;
      } else {
        if (selectedChapter <= 1) return;
        nextChapter = selectedChapter - 1;
        try {
          const { getVerseCount } = await import("../../bible/bibleData");
          nextVerseCount = await getVerseCount(selectedBook, nextChapter, activeTranslation) || 30;
        } catch {
          nextVerseCount = 30;
        }
        nextVerse = nextVerseCount;
      }

      if (nextChapter !== selectedChapter) {
        setSelectedChapter(nextChapter);
        setVerseCount(nextVerseCount);
      }

      await stageVerse(selectedBook, nextChapter, nextVerse, {
        sendToProgram: isProgramLive,
        translation: activeTranslation,
        columnIndex: activeColumnIndex,
      });
    },
    [
      activeColumnIndex,
      activeTranslation,
      isProgramLive,
      selectedBook,
      selectedChapter,
      selectedVerse,
      stageVerse,
      verseCount,
    ],
  );

  const sendSelectedVerseToProgram = useCallback(async () => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;
    await stageVerse(selectedBook, selectedChapter, selectedVerse, {
      sendToProgram: true,
      translation: activeTranslation,
      columnIndex: activeColumnIndex,
    });
  }, [activeColumnIndex, activeTranslation, selectedBook, selectedChapter, selectedVerse, stageVerse]);

  useEffect(() => {
    const verseToReveal = pendingScrollVerseRef.current ?? selectedVerse;
    if (verseToReveal === null) return;
    const container = verseGridRef.current;
    if (!container) return;

    const frame = window.requestAnimationFrame(() => {
      const target = container.querySelector<HTMLElement>(`[data-verse-row="${verseToReveal}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightVerse(verseToReveal);
      pendingScrollVerseRef.current = null;
    });

    const timer = window.setTimeout(() => {
      setHighlightVerse((current) => (current === verseToReveal ? null : current));
    }, 1800);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [chapterPassages, selectedVerse]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Escape") {
        if (targetElement?.closest(".dtb-modal")) return;
        event.preventDefault();
        setShowDropdown(false);
        setOpenVersionDropdownIndex(null);
        handleClearVerse();
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectedBook || !selectedChapter) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        void navigateVerse(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateVerse(-1);
      } else if (event.key === "Enter" && selectedVerse !== null) {
        event.preventDefault();
        void sendSelectedVerseToProgram();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (verseClickTimerRef.current) {
        clearTimeout(verseClickTimerRef.current);
        verseClickTimerRef.current = null;
      }
    };
  }, [handleClearVerse, navigateVerse, selectedBook, selectedChapter, selectedVerse, sendSelectedVerseToProgram]);

  const currentChapterLabel =
    selectedBook && selectedChapter ? `${selectedBook} ${selectedChapter}` : "Bible Browser";
  const activePassage = chapterPassages[activeColumnIndex] ?? null;
  const activeChapterError = chapterErrors[activeColumnIndex] ?? "";

  return (
    <div className="dock-module dock-module--bible">
      <section className="dock-console-panel dock-console-panel--toolbar">
        <div className="dock-console-row dock-console-row--stretch">
          <div
            className="dock-search dock-search--smart dock-search--console"
            style={{ flex: 1, marginBottom: 0 }}
            ref={searchRef}
          >
            <Icon name="search" size={14} />
            <input
              className="dock-input"
              placeholder='Search reference or word, e.g. "jn3:16", "icor", "God"...'
              aria-label="Search Bible by reference or word"
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
            <button
              type="button"
              className={`dock-search__action dock-search__action--voice${voiceListening ? " is-listening" : ""}${voiceBusy ? " is-busy" : ""}`}
              onClick={handleVoiceToggle}
              disabled={voiceBusy}
              aria-label={voiceActionLabel}
              aria-pressed={voiceListening}
              title={voiceActionLabel}
            >
              <Icon name={voiceActionIcon} size={15} />
            </button>

            {showDropdown && searchResults.length > 0 && (
              <div className="dock-search-dropdown">
                {searchResults.map((result, i) => (
                  <button
                    key={result.label + i}
                    className={`dock-search-dropdown__item${i === activeIdx ? " dock-search-dropdown__item--active" : ""}`}
                    onClick={() => void handlePickResult(result)}
                    onMouseEnter={() => setActiveIdx(i)}
                  >
                    <Icon
                      name={
                        result.kind === "keyword"
                          ? "search"
                          : result.verse !== null
                            ? "format_quote"
                            : result.chapter !== null
                              ? "menu_book"
                              : "auto_stories"
                      }
                      size={14}
                      style={{ opacity: 0.5 }}
                    />
                    <span className="dock-search-dropdown__content">
                      <span className="dock-search-dropdown__label">{result.label}</span>
                      {result.kind === "keyword" && (
                        <span className="dock-search-dropdown__snippet">{result.snippet}</span>
                      )}
                    </span>
                    <span className="dock-search-dropdown__hint">
                      {result.kind === "keyword"
                        ? ""
                        : result.verse !== null
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
                  {isKeywordSearching
                    ? `Searching "${searchQuery}"...`
                    : `No matches for "${searchQuery}"`}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dock-voice-bible__inline">
          <div className="dock-voice-bible__row">
            <div className="dock-voice-bible__meta">
              {/* <span>{voiceBible.sourceLabel ?? "Configured source"}</span>
              <span>{voiceBible.modelReady ? "Whisper ready" : "Whisper will download on first use"}</span>
              <span>{voiceBible.semanticReady ? "Ollama rerank ready" : "Lexical match fallback"}</span> */}
              <span className={`dock-voice-bible__status dock-voice-bible__status--${voiceBible.status}`}>
                {voiceStatusLabel}
              </span>
            </div>
          </div>

          {(voiceBible.transcript || voiceBible.detail || voiceBible.error || voiceBible.candidates.length > 0) && (
            <div className="dock-voice-bible__inline-details">
              {(voiceBible.transcript || voiceBible.detail) && (
                <div className="dock-voice-bible__detail">
                  {voiceBible.transcript && (
                    <div className="dock-voice-bible__transcript">Transcript: {voiceBible.transcript}</div>
                  )}
                  {voiceBible.detail && (
                    <div className="dock-voice-bible__hint">{voiceBible.detail}</div>
                  )}
                </div>
              )}

              {voiceBible.error && (
                <div className="dock-voice-bible__error">{voiceBible.error}</div>
              )}

              {voiceBible.candidates.length > 0 && (
                <div className="dock-voice-bible__candidates">
                  {voiceBible.candidates.map((candidate) => (
                    <button
                      key={`${candidate.label}-${candidate.translation}`}
                      className="dock-voice-bible__candidate"
                      onClick={() => void handlePickVoiceCandidate(candidate)}
                      title={candidate.snippet}
                    >
                      <span className="dock-voice-bible__candidate-label">{candidate.label}</span>
                      <span className="dock-voice-bible__candidate-snippet">{candidate.snippet}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* <div className="dock-voice-bible__examples">
            Try: “John 1 verse 2”, “next verse”, “go to chapter 4”, “last chapter”, “use NIV”.
          </div> */}
        </div>
      </section>

      <section className="dock-console-panel dock-console-panel--workspace">
        <div className="dock-bible-browser__summary" aria-label={currentChapterLabel}>
          <div className="dock-bible-browser__summary-spacer" aria-hidden="true" />
          <div className="dock-bible-browser__titlebar">
            <button
              type="button"
              className="dock-bible-browser__chapter-nav"
              onClick={() => navigateChapter(-1)}
              disabled={!selectedBook || !selectedChapter || selectedChapter <= 1 || sending}
              aria-label="Previous chapter"
              title="Previous chapter"
            >
              <Icon name="arrow_back" size={14} />
            </button>
            <div className="dock-bible-browser__title">{currentChapterLabel}</div>
            <button
              type="button"
              className="dock-bible-browser__chapter-nav"
              onClick={() => navigateChapter(1)}
              disabled={
                !selectedBook ||
                !selectedChapter ||
                sending ||
                selectedChapter >= (BOOK_CHAPTERS[selectedBook] ?? selectedChapter)
              }
              aria-label="Next chapter"
              title="Next chapter"
            >
              <Icon name="chevron_right" size={14} />
            </button>
          </div>
          <div className="dock-console-actions">
            {selectedVerse !== null && (
              <button
                type="button"
                className="dock-bible-browser__chapter-nav"
                onClick={handleClearVerse}
                disabled={sending}
                aria-label="Clear selected verse"
                title="Clear selected verse"
              >
                <Icon name="clear" size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="dock-bible-reader" ref={verseGridRef}>
          <div className="dock-bible-version-bar" ref={versionBarRef}>
            {quickTranslations.map((translation, index) => {
              const isActive = activeColumnIndex === index;
              const isOpen = openVersionDropdownIndex === index;
              const selectedLabel =
                availableTranslations.find((option) => option.value === translation)?.label ?? translation;

              return (
                <div
                  key={`quick-version-${index}-${translation}`}
                  className={[
                    "dock-bible-version-bar__slot",
                    isActive ? "dock-bible-version-bar__slot--active" : "",
                    isOpen ? "dock-bible-version-bar__slot--open" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="dock-bible-version-bar__button"
                    onClick={() => handleQuickVersionSelect(index)}
                    aria-pressed={isActive}
                    title={`Use ${selectedLabel}`}
                  >
                    <span className="dock-bible-version-bar__button-label">{selectedLabel}</span>
                  </button>
                  <button
                    type="button"
                    className="dock-bible-version-bar__toggle"
                    onClick={(event) => handleQuickVersionToggle(event, index)}
                    aria-label={`Choose Bible versions for slot ${index + 1}`}
                    aria-expanded={isOpen}
                    title="Choose another version"
                  >
                    <Icon name="expand_more" size={14} />
                  </button>

                  {isOpen && (
                    <div className="dock-bible-version-bar__dropdown" role="listbox" aria-label="Bible versions">
                      {availableTranslations.map((option) => {
                        const isSelected = option.value === translation;
                        return (
                          <button
                            key={`${index}-${option.value}`}
                            type="button"
                            className={`dock-bible-version-bar__dropdown-item${isSelected ? " dock-bible-version-bar__dropdown-item--selected" : ""}`}
                            onClick={() => handleQuickVersionChange(index, option.value)}
                            role="option"
                            aria-selected={isSelected}
                            title={option.label}
                          >
                            <span>{option.label}</span>
                            {isSelected && <Icon name="check" size={12} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {chapterLoading && (
            <div className="dock-console-placeholder">Loading {currentChapterLabel}…</div>
          )}

          {!chapterLoading && activeChapterError && !activePassage?.verses.length && (
            <div className="dock-action-error dock-action-error--console">
              <Icon name="warning" size={14} />
              <span style={{ flex: 1 }}>{activeChapterError}</span>
            </div>
          )}

          {!chapterLoading && !activePassage?.verses.length && !activeChapterError && (
            <div className="dock-console-placeholder">
              No verses are available for the selected chapter.
            </div>
          )}

          {!chapterLoading &&
            activePassage?.verses.map((verse) => (
              <div
                key={verse.verse}
                data-verse-row={verse.verse}
                className={[
                  "dock-bible-verse-row",
                  selectedVerse === verse.verse ? "dock-bible-verse-row--selected" : "",
                  highlightVerse === verse.verse ? "dock-bible-verse-row--highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => void handleVerseClick(verse.verse, activeColumnIndex, activeTranslation)}
                onDoubleClick={() => void handleVerseDoubleClick(verse.verse, activeColumnIndex, activeTranslation)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (event.shiftKey) {
                    void handleVerseDoubleClick(verse.verse, activeColumnIndex, activeTranslation);
                    return;
                  }
                  void handleVerseClick(verse.verse, activeColumnIndex, activeTranslation);
                }}
                tabIndex={0}
                role="button"
                aria-current={selectedVerse === verse.verse ? "true" : undefined}
                aria-label={`Verse ${verse.verse} in ${activeTranslation}. ${verse.text}`}
                title={`${activeTranslation} ${selectedBook} ${selectedChapter}:${verse.verse}`}
              >
                <div className="dock-bible-verse-row__main">
                  <span className="dock-bible-verse-row__num">{verse.verse}</span>
                  <span className="dock-bible-verse-row__text">{verse.text}</span>
                </div>

                <div className="dock-hover-actions dock-bible-verse-row__actions">
                  <button
                    type="button"
                    className="dock-hover-actions__btn dock-hover-actions__btn--preview"
                    aria-label={`Send ${selectedBook} ${selectedChapter}:${verse.verse} in ${activeTranslation} to preview`}
                    title="Send to Preview"
                    disabled={sending}
                    onPointerDown={stopVerseActionEvent}
                    onMouseDown={stopVerseActionEvent}
                    onDoubleClick={stopVerseActionEvent}
                    onClick={(event) => {
                      stopVerseActionEvent(event);
                      void stageVerse(selectedBook!, selectedChapter!, verse.verse, {
                        sendToPreview: true,
                        translation: activeTranslation,
                        columnIndex: activeColumnIndex,
                      });
                    }}
                  >
                    <Icon name="preview" size={12} />
                  </button>
                  <button
                    type="button"
                    className="dock-hover-actions__btn dock-hover-actions__btn--program"
                    aria-label={`Send ${selectedBook} ${selectedChapter}:${verse.verse} in ${activeTranslation} to program`}
                    title="Send to Program"
                    disabled={sending}
                    onPointerDown={stopVerseActionEvent}
                    onMouseDown={stopVerseActionEvent}
                    onDoubleClick={stopVerseActionEvent}
                    onClick={(event) => {
                      stopVerseActionEvent(event);
                      void stageVerse(selectedBook!, selectedChapter!, verse.verse, {
                        sendToProgram: true,
                        translation: activeTranslation,
                        columnIndex: activeColumnIndex,
                      });
                    }}
                  >
                    <Icon name="cast" size={12} />
                  </button>
                </div>
              </div>
            ))}
        </div>

        {actionError && (
          <div className="dock-action-error dock-action-error--console">
            <Icon name="warning" size={14} />
            <span style={{ flex: 1 }}>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError("")}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        <div className="dock-bible-browser__utility">
          <div className="dock-bible-browser__utility-row">
            <div className="dock-console-control">
              <div className="dock-section-label" style={{ marginTop: 0 }}>Overlay Mode</div>
              <div className="dock-console-segmented">
                <button
                  className={`dock-console-segmented__item${overlayMode === "fullscreen" ? " dock-console-segmented__item--active" : ""}`}
                  onClick={() => setOverlayMode("fullscreen")}
                >
                  <Icon name="fullscreen" size={14} />
                  Full
                </button>
                <button
                  className={`dock-console-segmented__item${overlayMode === "lower-third" ? " dock-console-segmented__item--active" : ""}`}
                  onClick={() => setOverlayMode("lower-third")}
                >
                  <Icon name="subtitles" size={14} />
                  LT
                </button>
              </div>
            </div>

            <div className="dock-console-control dock-console-control--compact">
              <div className="dock-section-label" style={{ marginTop: 0 }}>Lines</div>
              <div className="dock-console-segmented dock-console-segmented--compact">
                {Array.from({ length: MAX_VERSE_LINES }, (_, index) => {
                  const count = index + 1;
                  return (
                    <button
                      key={`lines-${count}`}
                      className={`dock-console-segmented__item${verseLineCount === count ? " dock-console-segmented__item--active" : ""}`}
                      onClick={() => setVerseLineCount(count)}
                      aria-label={`Stage ${count} verse${count > 1 ? "s" : ""} at a time`}
                      title={`Stage ${count} verse${count > 1 ? "s" : ""} at a time`}
                    >
                      {count}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>


          <div className="dock-console-control">
            <DockBibleThemePicker
              selectedThemeId={activeThemePickerProps.selectedThemeId}
              onSelect={activeThemePickerProps.onSelect}
              label={activeThemePickerProps.label}
              templateType={activeThemePickerProps.templateType}
            />
          </div>

          {selectedVerse !== null && (
            <div className="dock-bible-browser__footer-actions">
              <button
                type="button"
                className="dock-btn dock-btn--ghost dock-btn--compact"
                onClick={handleClearVerse}
                disabled={sending}
              >
                <Icon name="clear" size={14} />
                Clear
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
