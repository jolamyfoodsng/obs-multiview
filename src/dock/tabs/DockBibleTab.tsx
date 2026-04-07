/**
 * DockBibleTab.tsx — Bible tab for the OBS Browser Dock
 *
 * Smart search: type "gen1vs1", "g11", "jn3:16", "ps23" etc.
 * Resolves straight into a fast chapter reader with stage / live actions per verse.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SearchResult as BibleKeywordResult } from "../../bible/bibleData";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import {
  DEFAULT_THEME_SETTINGS,
  type BiblePassage,
  type BibleTheme,
  type BibleThemeSettings,
} from "../../bible/types";
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
import DockFullscreenThemeQuickSettings, {
  type DockFullscreenQuickThemeSettings,
} from "../components/DockFullscreenThemeQuickSettings";
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
const MIN_DOCK_KEYWORD_SEARCH_LENGTH = 2;
const DOCK_KEYWORD_SEARCH_LIMIT = 24;
const BIBLE_RECENT_SEARCHES_KEY = "ocs-dock-bible-recent-searches-v1";
const BIBLE_RECENT_SEARCH_LIMIT = 6;

interface DockBiblePreferences {
  overlayMode?: OverlayMode;
  translation?: string;
  translations?: string[];
  verseLineCount?: number;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  backgroundPreset?: DockBackgroundPreset;
  fullscreenQuickThemeSettings?: DockFullscreenQuickThemeSettings | null;
  selectedBook?: string;
  selectedChapter?: number;
}

type ColumnTranslations = string[];
type LiveTranscriptWordChip = {
  id: string;
  text: string;
  lane: "start" | "end";
};

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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function extractFullscreenQuickThemeSettings(
  settings: BibleThemeSettings,
): DockFullscreenQuickThemeSettings {
  return {
    fontSize: clampNumber(settings.fontSize, 28, 200),
    refFontSize: clampNumber(settings.refFontSize, 14, 150),
    fontColor: settings.fontColor || DEFAULT_THEME_SETTINGS.fontColor,
    refFontColor: settings.refFontColor || settings.fontColor || DEFAULT_THEME_SETTINGS.refFontColor,
    fullscreenShadeColor:
      settings.fullscreenShadeColor || DEFAULT_THEME_SETTINGS.fullscreenShadeColor,
    fullscreenShadeOpacity: clampNumber(settings.fullscreenShadeOpacity, 0, 1),
    textAlign: settings.textAlign || DEFAULT_THEME_SETTINGS.textAlign,
    lineHeight: clampNumber(settings.lineHeight, 1.05, 1.8),
    fontWeight: settings.fontWeight || DEFAULT_THEME_SETTINGS.fontWeight,
    textTransform: settings.textTransform || DEFAULT_THEME_SETTINGS.textTransform,
  };
}

function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

function sanitizeFullscreenQuickThemeSettings(
  value: unknown,
): DockFullscreenQuickThemeSettings | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<DockFullscreenQuickThemeSettings>;
  const fontWeight =
    source.fontWeight === "light" || source.fontWeight === "normal" || source.fontWeight === "bold"
      ? source.fontWeight
      : DEFAULT_THEME_SETTINGS.fontWeight;
  const textAlign =
    source.textAlign === "left" || source.textAlign === "center" || source.textAlign === "right"
      ? source.textAlign
      : DEFAULT_THEME_SETTINGS.textAlign;
  const textTransform =
    source.textTransform === "none" ||
      source.textTransform === "uppercase" ||
      source.textTransform === "lowercase" ||
      source.textTransform === "capitalize"
      ? source.textTransform
      : DEFAULT_THEME_SETTINGS.textTransform;

  return {
    fontSize: clampNumber(Number(source.fontSize ?? DEFAULT_THEME_SETTINGS.fontSize), 28, 200),
    refFontSize: clampNumber(
      Number(source.refFontSize ?? DEFAULT_THEME_SETTINGS.refFontSize),
      14,
      150,
    ),
    fontColor: sanitizeColor(source.fontColor, DEFAULT_THEME_SETTINGS.fontColor),
    refFontColor: sanitizeColor(source.refFontColor, DEFAULT_THEME_SETTINGS.refFontColor),
    fullscreenShadeColor: sanitizeColor(
      source.fullscreenShadeColor,
      DEFAULT_THEME_SETTINGS.fullscreenShadeColor,
    ),
    fullscreenShadeOpacity: clampNumber(
      Number(source.fullscreenShadeOpacity ?? DEFAULT_THEME_SETTINGS.fullscreenShadeOpacity),
      0,
      1,
    ),
    textAlign,
    lineHeight: clampNumber(
      Number(source.lineHeight ?? DEFAULT_THEME_SETTINGS.lineHeight),
      1.05,
      1.8,
    ),
    fontWeight,
    textTransform,
  };
}

function applyFullscreenQuickThemeSettings(
  theme: BibleTheme,
  quickSettings: DockFullscreenQuickThemeSettings | null,
): BibleTheme {
  if (!quickSettings) return theme;
  return {
    ...theme,
    settings: {
      ...theme.settings,
      fontSize: quickSettings.fontSize,
      refFontSize: quickSettings.refFontSize,
      fontColor: quickSettings.fontColor,
      refFontColor: quickSettings.refFontColor,
      fullscreenShadeColor: quickSettings.fullscreenShadeColor,
      fullscreenShadeOpacity: quickSettings.fullscreenShadeOpacity,
      fullscreenShadeEnabled: quickSettings.fullscreenShadeOpacity > 0,
      textAlign: quickSettings.textAlign,
      lineHeight: quickSettings.lineHeight,
      fontWeight: quickSettings.fontWeight,
      refFontWeight: quickSettings.fontWeight,
      textTransform: quickSettings.textTransform,
    },
  };
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

function normalizeTranscriptStackWord(word: string): string {
  return word.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, "");
}

function splitTranscriptStackWords(transcript: string): string[] {
  return transcript
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function extractTranscriptWordTail(previousWords: string[], nextWords: string[]): string[] {
  if (nextWords.length === 0) return [];
  if (previousWords.length === 0) return nextWords;

  const normalizedPrevious = previousWords.map(normalizeTranscriptStackWord).filter(Boolean);
  const normalizedNext = nextWords.map(normalizeTranscriptStackWord).filter(Boolean);
  const maxOverlap = Math.min(normalizedPrevious.length, normalizedNext.length, 18);

  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (
        normalizedPrevious[normalizedPrevious.length - overlap + index] !==
        normalizedNext[index]
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return nextWords.slice(overlap);
    }
  }

  return nextWords;
}

function isVerseRowVisibleWithinContainer(
  container: HTMLElement,
  target: HTMLElement,
): boolean {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  return (
    targetRect.top >= containerRect.top &&
    targetRect.bottom <= containerRect.bottom
  );
}

function isReferenceLikeBibleQuery(query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return false;
  return (
    /\d/.test(trimmed) ||
    /[:.-]/.test(trimmed) ||
    /\b(vs|verse|verses|chapter|chap)\b/.test(trimmed)
  );
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
    inputLevel: 0,
    modelReady: false,
    semanticReady: false,
    candidates: [],
    lastResult: null,
  };
}

function readRecentBibleSearches(): string[] {
  try {
    const raw = localStorage.getItem(BIBLE_RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeRecentBibleSearches(items: string[]): void {
  try {
    localStorage.setItem(BIBLE_RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, BIBLE_RECENT_SEARCH_LIMIT)));
  } catch {
    // ignore OBS CEF storage failures
  }
}

function pushRecentBibleSearch(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) return readRecentBibleSearches();
  const next = [
    normalized,
    ...readRecentBibleSearches().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, BIBLE_RECENT_SEARCH_LIMIT);
  writeRecentBibleSearches(next);
  return next;
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
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentBibleSearches());
  const [activeIdx, setActiveIdx] = useState(-1);
  const [keywordResults, setKeywordResults] = useState<BibleKeywordResult[]>([]);
  const [isKeywordSearching, setIsKeywordSearching] = useState(false);
  const [, setVerseText] = useState<string | null>(null);
  const [verseCount, setVerseCount] = useState(30);
  const [voiceBible, setVoiceBible] = useState<VoiceBibleSnapshot>(
    () => initialVoiceBible ?? emptyVoiceBibleSnapshot(),
  );
  const [, setLiveTranscriptWords] = useState<LiveTranscriptWordChip[]>([]);
  const [voiceHeld, setVoiceHeld] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [backgroundPreset, setBackgroundPreset] = useState<DockBackgroundPreset>("theme");
  const [savedFullscreenQuickThemeSettings, setSavedFullscreenQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
  const [fullscreenQuickThemeSettings, setFullscreenQuickThemeSettings] =
    useState<DockFullscreenQuickThemeSettings | null>(null);
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
  const liveTranscriptWordCounterRef = useRef(0);
  const lastTranscriptWordsRef = useRef<string[]>([]);
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
    const transcript = voiceBible.transcript?.trim() ?? "";
    if (!transcript) {
      return;
    }

    const nextWords = splitTranscriptStackWords(transcript);
    if (nextWords.length === 0) {
      return;
    }

    const appendedWords = extractTranscriptWordTail(
      lastTranscriptWordsRef.current,
      nextWords,
    );
    lastTranscriptWordsRef.current = nextWords;

    if (appendedWords.length === 0) {
      return;
    }

    setLiveTranscriptWords((current) => {
      const next = [...current];
      for (const word of appendedWords) {
        const absoluteIndex = liveTranscriptWordCounterRef.current;
        next.push({
          id: `voice-word-${absoluteIndex}-${word}`,
          text: word,
          lane: absoluteIndex % 2 === 0 ? "start" : "end",
        });
        liveTranscriptWordCounterRef.current += 1;
      }
      return next.slice(-28);
    });
  }, [voiceBible.transcript]);

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
    const storedQuickSettings = sanitizeFullscreenQuickThemeSettings(
      prefs.fullscreenQuickThemeSettings,
    );
    setSavedFullscreenQuickThemeSettings(storedQuickSettings);
    setFullscreenQuickThemeSettings(storedQuickSettings);
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
      fullscreenQuickThemeSettings: savedFullscreenQuickThemeSettings,
      selectedBook: selectedBook ?? undefined,
      selectedChapter: selectedChapter ?? undefined,
    });
  }, [
    activeTranslation,
    backgroundPreset,
    columnTranslations,
    overlayMode,
    savedFullscreenQuickThemeSettings,
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

  const effectiveSelectedBibleTheme = useMemo(
    () =>
      applyFullscreenQuickThemeSettings(
        selectedBibleTheme,
        fullscreenQuickThemeSettings,
      ),
    [fullscreenQuickThemeSettings, selectedBibleTheme],
  );

  const activeFullscreenQuickThemeSettings = useMemo(
    () => extractFullscreenQuickThemeSettings(effectiveSelectedBibleTheme.settings),
    [effectiveSelectedBibleTheme.settings],
  );

  const fullscreenLiveOverrides = useMemo(
    () => buildDockBackgroundPresetOverrides(effectiveSelectedBibleTheme.settings, backgroundPreset),
    [backgroundPreset, effectiveSelectedBibleTheme.settings],
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
        theme: overlayMode === "fullscreen" ? effectiveSelectedBibleTheme.id : selectedLowerThirdTheme.id,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? effectiveSelectedBibleTheme.settings
            : selectedLowerThirdTheme.settings
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
      effectiveSelectedBibleTheme.id,
      effectiveSelectedBibleTheme.settings,
      selectedLowerThirdTheme.id,
      selectedLowerThirdTheme.settings,
      activeTranslation,
      verseLineCount,
    ],
  );

  const handleSaveFullscreenQuickThemeSettings = useCallback(async () => {
    const nextSavedSettings = { ...activeFullscreenQuickThemeSettings };
    setSavedFullscreenQuickThemeSettings(nextSavedSettings);

    if (staged?.type !== "bible") {
      return;
    }

    const data = (staged.data ?? null) as Record<string, unknown> | null;
    if (!data) {
      return;
    }

    const book = typeof data.book === "string" ? data.book : null;
    const chapter = typeof data.chapter === "number" ? data.chapter : null;
    const verse = typeof data.verse === "number" ? data.verse : null;
    const translation =
      typeof data.translation === "string" ? data.translation.toUpperCase() : activeTranslation;
    const columnIndex =
      typeof data.columnIndex === "number"
        ? Math.min(Math.max(data.columnIndex, 0), QUICK_SELECT_VERSION_COUNT - 1)
        : activeColumnIndex;

    if (!book || !chapter || !verse) {
      return;
    }

    await stageVerse(book, chapter, verse, {
      sendToPreview: true,
      translation,
      columnIndex,
    });

    if (data._dockLive) {
      await stageVerse(book, chapter, verse, {
        sendToProgram: true,
        translation,
        columnIndex,
      });
    }
  }, [
    activeColumnIndex,
    activeFullscreenQuickThemeSettings,
    activeTranslation,
    stageVerse,
    staged,
  ]);

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

  const voiceBusy =
    voiceBible.status === "transcribing" || voiceBible.status === "matching";
  const voiceListening = voiceHeld || voiceBible.status === "listening";
  const voiceInputLevel = Math.max(0, Math.min(1, voiceBible.inputLevel ?? 0));
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
  const voiceMeterStyle = useMemo(
    () =>
      ({
        "--voice-meter-1": `${8 + voiceInputLevel * 8}px`,
        "--voice-meter-2": `${10 + voiceInputLevel * 12}px`,
        "--voice-meter-3": `${7 + voiceInputLevel * 9}px`,
      }) as CSSProperties,
    [voiceInputLevel],
  );

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

    if (!trimmed || trimmed.length < MIN_DOCK_KEYWORD_SEARCH_LENGTH) {
      setKeywordResults([]);
      setIsKeywordSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsKeywordSearching(true);
      try {
        const { searchBible } = await import("../../bible/bibleData");
        const matches = await searchBible(trimmed, activeTranslation, DOCK_KEYWORD_SEARCH_LIMIT);
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
  }, [activeTranslation, searchQuery]);

  const searchResults = useMemo<DockBibleSearchOption[]>(() => {
    const keywordMatches = keywordResults.map((result) => ({
      kind: "keyword" as const,
      book: result.book,
      chapter: result.chapter,
      verse: result.verse,
      label: `${result.book} ${result.chapter}:${result.verse}`,
      snippet: result.snippet || result.text,
    }));
    if (keywordMatches.length === 0) {
      return referenceResults;
    }

    if (referenceResults.length === 0) {
      return keywordMatches;
    }

    return isReferenceLikeBibleQuery(searchQuery)
      ? [...referenceResults, ...keywordMatches]
      : [...keywordMatches, ...referenceResults];
  }, [keywordResults, referenceResults, searchQuery]);

  // ── Close dropdown when clicking outside ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setShowRecentSearches(false);
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
    setShowRecentSearches(val.trim().length === 0);
    setActiveIdx(-1);
  }, []);

  // ── Pick a search result ──
  const handlePickResult = useCallback(
    async (result: DockBibleSearchOption, options?: { sendToPreview?: boolean; sendToProgram?: boolean }) => {
      const sendToProgram = options?.sendToProgram ?? false;
      const sendToPreview = options?.sendToPreview ?? false;
      setRecentSearches(pushRecentBibleSearch(result.label));
      setSearchQuery("");
      setShowDropdown(false);
      setShowRecentSearches(false);
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

  const applyRecentBibleSearch = useCallback(
    (query: string) => {
      const recentResult = parseBibleSearch(query)[0];
      setSearchQuery("");
      setShowRecentSearches(false);
      setShowDropdown(false);
      setActiveIdx(-1);

      if (recentResult) {
        void handlePickResult({ ...recentResult, kind: "reference" });
      }
    },
    [handlePickResult],
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

  const handleClearBibleTarget = useCallback((live: boolean) => {
    setActionError("");
    if (!dockObsClient.isConnected) return;
    dockObsClient.clearBibleTarget(live).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[DockBibleTab] clearBibleTarget(${live ? "program" : "preview"}) failed:`, err);
      setActionError(message);
    });
  }, []);

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
      if (target && !isVerseRowVisibleWithinContainer(container, target)) {
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
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
            className="dock-search dock-search--smart dock-search--console dock-search--has-action"
            style={{ flex: 1, marginBottom: 0 }}
            ref={searchRef}
          >
            <Icon name="search" size={14} className="dock-search__icon" />
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
                else if (recentSearches.length > 0) setShowRecentSearches(true);
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="dock-search__clear"
                onClick={() => {
                  setSearchQuery("");
                  setShowDropdown(false);
                  setShowRecentSearches(recentSearches.length > 0);
                }}
                aria-label="Clear Bible search"
                title="Clear Bible search"
              >
                <Icon name="close" size={13} />
              </button>
            )}

            <button
              type="button"
              className={`dock-search__action dock-search__action--voice${voiceListening ? " is-listening" : ""}${voiceBusy ? " is-busy" : ""}`}
              onClick={handleVoiceToggle}
              disabled={voiceBusy}
              aria-label={voiceActionLabel}
              aria-pressed={voiceListening}
              title={voiceActionLabel}
              style={voiceListening ? voiceMeterStyle : undefined}
            >
              <Icon name={voiceActionIcon} size={15} />
              {voiceListening && (
                <span className="dock-search__voice-meter" aria-hidden="true">
                  <span className="dock-search__voice-meter-bar" />
                  <span className="dock-search__voice-meter-bar" />
                  <span className="dock-search__voice-meter-bar" />
                </span>
              )}
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

            {showRecentSearches && !searchQuery.trim() && recentSearches.length > 0 && (
              <div className="dock-search-dropdown dock-search-dropdown--recent">
                <div className="dock-search-dropdown__heading">Recent searches</div>
                {recentSearches.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className="dock-search-dropdown__item dock-search-dropdown__item--recent"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyRecentBibleSearch(item)}
                  >
                    <Icon name="history" size={13} style={{ opacity: 0.5 }} />
                    <span className="dock-search-dropdown__content">
                      <span className="dock-search-dropdown__label">{item}</span>
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


          {(voiceBible.transcript || voiceBible.detail || voiceBible.error || voiceBible.candidates.length > 0) && (
            <div className="dock-voice-bible__inline-details">


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
            <div className="dock-console-control dock-console-control--mode-stack">
              <div>

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

                <div className="dock-theme-inline-row">
                  <DockBibleThemePicker
                    selectedThemeId={activeThemePickerProps.selectedThemeId}
                    onSelect={activeThemePickerProps.onSelect}
                    label=""
                    templateType={activeThemePickerProps.templateType}
                    allowedCategories={["bible", "general"]}
                    previewTheme={overlayMode === "fullscreen" ? effectiveSelectedBibleTheme : undefined}
                  />
                  {overlayMode === "fullscreen" ? (
                    <DockFullscreenThemeQuickSettings
                      settings={activeFullscreenQuickThemeSettings}
                      onChange={setFullscreenQuickThemeSettings}
                      onReset={() => setFullscreenQuickThemeSettings(savedFullscreenQuickThemeSettings)}
                      onSaveDefault={handleSaveFullscreenQuickThemeSettings}
                    />
                  ) : null}
                </div>
              </div>

            </div>
            <div className=" dock-console-control--compact">
              <div className="dock-section-label" style={{ marginTop: 0 }}>Lines</div>
              <select
                className="dock-select dock-select--console dock-select--lines"
                value={verseLineCount}
                onChange={(event) => setVerseLineCount(clampVerseLineCount(Number(event.target.value)))}
                aria-label="Stage this many verses at a time"
                title="Stage this many verses at a time"
              >
                {Array.from({ length: MAX_VERSE_LINES }, (_, index) => {
                  const count = index + 1;
                  return (
                    <option key={`lines-${count}`} value={count}>
                      {count} line{count > 1 ? "s" : ""}
                    </option>
                  );
                })}
              </select>
            </div>



          </div>

          {selectedVerse !== null && (
            <div className="dock-bible-browser__footer-actions">
              <button
                type="button"
                className="dock-btn dock-btn--ghost dock-btn--compact"
                onClick={() => handleClearBibleTarget(false)}
                disabled={sending}
                aria-label="Clear Bible preview"
              >
                <Icon name="clear" size={14} />
                Clear Preview
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--ghost dock-btn--compact"
                onClick={() => handleClearBibleTarget(true)}
                disabled={sending}
                aria-label="Clear Bible program"
              >
                <Icon name="clear" size={14} />
                Clear Program
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--ghost dock-btn--compact"
                onClick={handleClearVerse}
                disabled={sending}
                aria-label="Clear Bible preview and program"
              >
                <Icon name="clear" size={14} />
                Clear All
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
