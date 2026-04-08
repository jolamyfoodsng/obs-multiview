/**
 * DockWorshipTab.tsx — Worship tab for the OBS Browser Dock
 *
 * Dense operator console for song browsing, lyric cueing, and live transport.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { DockStagedItem, DockWorshipSection } from "../dockTypes";
import { dockObsClient } from "../dockObsClient";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import type { BibleTheme } from "../../bible/types";
import { dockClient } from "../../services/dockBridge";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import {
  createWorshipDockSongSaveCommand,
  loadWorshipDockSongSaveResult,
  postWorshipDockSongSaveCommand,
  type WorshipDockSongSavePayload,
} from "../../services/worshipDockInterop";
import { generateSlides, parseWorshipLyricSections } from "../../worship/slideEngine";
import type { Song } from "../../worship/types";
import {
  formatOnlineLyricsSearchError,
  searchOnlineSongLyrics,
  type OnlineLyricsSearchResult,
} from "../../worship/onlineLyricsService";
import DockBibleThemePicker from "../components/DockBibleThemePicker";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";
import Icon from "../DockIcon";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  productionDefaults: DockProductionModuleSettings;
}

type OverlayMode = "fullscreen" | "lower-third";

interface DockSong {
  id: string;
  title: string;
  artist: string;
  lyrics: string;
  importSourceName?: string;
  importSourceType?: "manual" | "online";
  importSourceUrl?: string;
}

interface DockWorshipPreferences {
  overlayMode?: OverlayMode;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  linesPerSlide?: number;
}

const DOCK_WORSHIP_PREFS_KEY = "ocs-dock-worship-preferences";
const DOCK_WORSHIP_SONG_DEFAULTS_KEY = "ocs-dock-worship-song-defaults-v1";
const DOCK_WORSHIP_RECENT_SEARCHES_KEY = "ocs-dock-worship-recent-searches-v1";
const LINES_PER_SLIDE_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const DOCK_WORSHIP_SAVE_TIMEOUT_MS = 3500;
const DOCK_WORSHIP_SAVE_FALLBACK_DELAY_MS = 350;
const DOCK_WORSHIP_SAVE_RESULT_POLL_MS = 250;
const DOCK_WORSHIP_RECENT_SEARCH_LIMIT = 6;

interface DockSongDraft {
  title: string;
  artist: string;
  lyrics: string;
}

interface DockSongDefault extends DockSongDraft {
  importSourceName?: string;
  importSourceType?: "manual" | "online";
  importSourceUrl?: string;
}

type DockSongDefaults = Record<string, DockSongDefault>;
type DockToastTone = "info" | "success" | "error";

interface DockToast {
  id: string;
  message: string;
  tone: DockToastTone;
}

function readRecentWorshipSearches(): string[] {
  try {
    const raw = localStorage.getItem(DOCK_WORSHIP_RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeRecentWorshipSearches(items: string[]): void {
  try {
    localStorage.setItem(DOCK_WORSHIP_RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, DOCK_WORSHIP_RECENT_SEARCH_LIMIT)));
  } catch {
    // ignore OBS CEF storage failures
  }
}

function pushRecentWorshipSearch(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) return readRecentWorshipSearches();
  const next = [
    normalized,
    ...readRecentWorshipSearches().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, DOCK_WORSHIP_RECENT_SEARCH_LIMIT);
  writeRecentWorshipSearches(next);
  return next;
}

function createDockSongId(): string {
  return crypto.randomUUID?.() ?? `dock-song-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readDockSongDefaults(): DockSongDefaults {
  try {
    const raw = localStorage.getItem(DOCK_WORSHIP_SONG_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DockSongDefaults;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDockSongDefaults(next: DockSongDefaults): void {
  try {
    localStorage.setItem(DOCK_WORSHIP_SONG_DEFAULTS_KEY, JSON.stringify(next));
  } catch {
    // ignore OBS CEF storage failures
  }
}

function rememberDockSongDefault(song: DockSong): void {
  const defaults = readDockSongDefaults();
  if (defaults[song.id]) return;
  defaults[song.id] = {
    title: song.title,
    artist: song.artist,
    lyrics: song.lyrics,
    importSourceName: song.importSourceName,
    importSourceType: song.importSourceType,
    importSourceUrl: song.importSourceUrl,
  };
  writeDockSongDefaults(defaults);
}

function rememberDockSongDefaults(songs: DockSong[]): void {
  const defaults = readDockSongDefaults();
  let changed = false;
  for (const song of songs) {
    if (defaults[song.id]) continue;
    defaults[song.id] = {
      title: song.title,
      artist: song.artist,
      lyrics: song.lyrics,
      importSourceName: song.importSourceName,
      importSourceType: song.importSourceType,
      importSourceUrl: song.importSourceUrl,
    };
    changed = true;
  }
  if (changed) writeDockSongDefaults(defaults);
}

function mapAppSongToDockSong(song: {
  id: string;
  metadata: { title: string; artist?: string };
  lyrics?: string;
  importSourceName?: string;
  importSourceType?: "manual" | "online";
  importSourceUrl?: string;
}): DockSong {
  return {
    id: song.id,
    title: song.metadata.title,
    artist: song.metadata.artist || "",
    lyrics: song.lyrics || "",
    importSourceName: song.importSourceName,
    importSourceType: song.importSourceType,
    importSourceUrl: song.importSourceUrl,
  };
}

function loadDockWorshipPreferences(): DockWorshipPreferences {
  try {
    const raw = localStorage.getItem(DOCK_WORSHIP_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DockWorshipPreferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDockWorshipPreferences(next: DockWorshipPreferences): void {
  try {
    localStorage.setItem(DOCK_WORSHIP_PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore OBS CEF storage failures
  }
}

function parseLyricSections(lyrics: string, linesPerSlide: number): DockWorshipSection[] {
  if (!lyrics.trim()) return [];
  return generateSlides(lyrics, linesPerSlide, false).map((slide) => ({
    id: slide.id,
    label: slide.isContinuation ? "" : slide.label,
    text: slide.content,
  }));
}

function cleanWorshipSectionLabel(label: string): string {
  const normalized = label.trim();
  if (!normalized) return "";
  return /^verse\s+\d+$/i.test(normalized) ? "" : normalized;
}

function stageItemLabel(song: DockSong, section: DockWorshipSection, live: boolean): string {
  const displayLabel = cleanWorshipSectionLabel(section.label);
  if (live) {
    return displayLabel ? `${displayLabel} (LIVE)` : `${song.title} (LIVE)`;
  }
  return displayLabel || song.title;
}

export default function DockWorshipTab({ staged, onStage, productionDefaults }: Props) {
  const [songs, setSongs] = useState<DockSong[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentWorshipSearches());
  const [selectedSong, setSelectedSong] = useState<DockSong | null>(null);
  const [liveIdx, setLiveIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedFSTheme, setSelectedFSTheme] = useState<BibleTheme>(
    productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0],
  );
  const [selectedLTTheme, setSelectedLTTheme] = useState<BibleTheme>(
    productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0],
  );
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(productionDefaults.defaultMode);
  const [linesPerSlide, setLinesPerSlide] = useState<number>(2);
  const [, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [songEditor, setSongEditor] = useState<DockSong | null>(null);
  const [songDraft, setSongDraft] = useState<DockSongDraft>({ title: "", artist: "", lyrics: "" });
  const [newSongDraft, setNewSongDraft] = useState<DockSongDraft>({ title: "", artist: "", lyrics: "" });
  const [newSongSource, setNewSongSource] = useState<Pick<DockSong, "importSourceName" | "importSourceType" | "importSourceUrl"> | null>(null);
  const [isNewSongModalOpen, setIsNewSongModalOpen] = useState(false);
  const [slideEditor, setSlideEditor] = useState<{ index: number; label: string; text: string } | null>(null);
  const [onlineSearchOpen, setOnlineSearchOpen] = useState(false);
  const [onlineSearchQuery, setOnlineSearchQuery] = useState("");
  const [onlineResults, setOnlineResults] = useState<OnlineLyricsSearchResult[]>([]);
  const [onlineSearchLoading, setOnlineSearchLoading] = useState(false);
  const [onlineSearchError, setOnlineSearchError] = useState("");
  const [hiddenSectionIndexes, setHiddenSectionIndexes] = useState<Set<number>>(() => new Set());
  const [savingSong, setSavingSong] = useState(false);
  const [toasts, setToasts] = useState<DockToast[]>([]);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const prefsReadyRef = useRef(false);
  const isProgramLive =
    staged?.type === "worship" &&
    Boolean((staged.data as Record<string, unknown> | undefined)?._dockLive);

  const selectedSongSections = useMemo(
    () => (selectedSong ? parseLyricSections(selectedSong.lyrics, linesPerSlide) : []),
    [linesPerSlide, selectedSong],
  );
  const selectedSongLyricSections = useMemo(
    () => (selectedSong ? parseWorshipLyricSections(selectedSong.lyrics, linesPerSlide) : []),
    [linesPerSlide, selectedSong],
  );
  const visibleSectionIndexes = useMemo(
    () => selectedSongSections.map((_, index) => index).filter((index) => !hiddenSectionIndexes.has(index)),
    [hiddenSectionIndexes, selectedSongSections],
  );

  const showToast = useCallback((message: string, tone: DockToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 1500);
    toastTimersRef.current.push(timer);
  }, []);

  useEffect(() => () => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current = [];
  }, []);

  useEffect(() => {
    prefsReadyRef.current = false;
    const prefs = loadDockWorshipPreferences();
    setSelectedFSTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
    setSelectedLTTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
    setOverlayMode(prefs.overlayMode ?? productionDefaults.defaultMode);
    setLinesPerSlide(
      typeof prefs.linesPerSlide === "number" && LINES_PER_SLIDE_OPTIONS.includes(prefs.linesPerSlide as 1)
        ? prefs.linesPerSlide
        : 2,
    );

    let cancelled = false;
    const applyStoredThemes = async () => {
      const [fullscreenFavorites, lowerThirdFavorites] = await Promise.all([
        loadDockFavoriteBibleThemes("fullscreen"),
        loadDockFavoriteBibleThemes("lower-third"),
      ]);

      if (cancelled) return;

      const storedFullscreen = fullscreenFavorites.find((theme) => theme.id === prefs.fullscreenThemeId);
      const storedLowerThird = lowerThirdFavorites.find((theme) => theme.id === prefs.lowerThirdThemeId);

      if (storedFullscreen) setSelectedFSTheme(storedFullscreen);
      if (storedLowerThird) setSelectedLTTheme(storedLowerThird);
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
    saveDockWorshipPreferences({
      overlayMode,
      fullscreenThemeId: selectedFSTheme.id,
      lowerThirdThemeId: selectedLTTheme.id,
      linesPerSlide,
    });
  }, [linesPerSlide, overlayMode, selectedFSTheme.id, selectedLTTheme.id]);

  const mapSongs = useCallback(
    (all: Array<{
      id: string;
      metadata: { title: string; artist?: string };
      lyrics?: string;
      importSourceName?: string;
      importSourceType?: "manual" | "online";
      importSourceUrl?: string;
    }>): DockSong[] => all.map(mapAppSongToDockSong),
    [],
  );

  const loadSongs = useCallback(async (allowJsonFallback = true) => {
    dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });

    if (!allowJsonFallback) return;

    try {
      const res = await fetch("/uploads/dock-worship-songs.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = await res.json();
      if (Array.isArray(all) && all.length > 0) {
        const nextSongs = mapSongs(all);
        rememberDockSongDefaults(nextSongs);
        setSongs(nextSongs);
        return;
      }
    } catch (err) {
      console.log("[DockWorshipTab] JSON fetch failed:", err);
    }

    setSongs([]);
  }, [mapSongs]);

  useEffect(() => {
    void loadSongs();
  }, [loadSongs]);

  useEffect(() => {
    const unsub = dockClient.onState((msg) => {
      if (msg.type === "state:songs-data" && Array.isArray(msg.payload)) {
        const nextSongs = mapSongs(msg.payload as Parameters<typeof mapSongs>[0]);
        rememberDockSongDefaults(nextSongs);
        setSongs(nextSongs);
        return;
      }
      if (msg.type === "state:library-updated") {
        void loadSongs();
      }
    });
    return unsub;
  }, [loadSongs]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowRecentSearches(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return songs;
    const needle = searchQuery.toLowerCase();
    return songs.filter(
      (song) =>
        song.title.toLowerCase().includes(needle) ||
        song.artist.toLowerCase().includes(needle) ||
        song.lyrics.toLowerCase().includes(needle),
    );
  }, [searchQuery, songs]);

  const buildSectionPayload = useCallback(
    (idx: number, live: boolean) => {
      if (!selectedSong) return null;
      const section = selectedSongSections[idx];
      if (!section) return null;

      const displayLabel = cleanWorshipSectionLabel(section.label);
      const theme = overlayMode === "fullscreen" ? selectedFSTheme : selectedLTTheme;

      const stageData = {
        song: selectedSong,
        sectionIdx: idx,
        artist: selectedSong.artist,
        sectionLabel: displayLabel,
        sectionText: section.text,
        overlayMode,
        linesPerSlide,
        theme: theme.id,
        bibleThemeSettings: theme.settings as unknown as Record<string, unknown>,
        liveOverrides: null,
        _dockLive: live,
      };

      return {
        section,
        stageItem: {
          type: "worship" as const,
          label: stageItemLabel(selectedSong, section, live),
          subtitle: selectedSong.title,
          data: stageData,
        },
        obsData: {
          sectionText: section.text,
          sectionLabel: displayLabel,
          songTitle: selectedSong.title,
          artist: selectedSong.artist,
          overlayMode,
          bibleThemeSettings: theme.settings as unknown as Record<string, unknown>,
          liveOverrides: null,
        },
      };
    },
    [
      linesPerSlide,
      overlayMode,
      selectedFSTheme,
      selectedLTTheme,
      selectedSong,
      selectedSongSections,
    ],
  );

  const pushSection = useCallback(
    async (idx: number, live: boolean) => {
      const payload = buildSectionPayload(idx, live);
      if (!payload) return;

      setActionError("");
      setSelectedIdx(idx);
      if (live) {
        setLiveIdx(idx);
        setPreviewIdx(null);
      } else {
        setPreviewIdx(idx);
      }

      onStage(payload.stageItem);

      if (!dockObsClient.isConnected) return;

      setSending(true);
      try {
        await dockObsClient.pushWorshipLyrics(payload.obsData, live);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[DockWorshipTab] ${live ? "Go live" : "Send preview"} failed:`, err);
        setActionError(message);
      } finally {
        setSending(false);
      }
    },
    [buildSectionPayload, onStage],
  );

  const saveSongInMainApp = useCallback(
    (payload: WorshipDockSongSavePayload): Promise<DockSong> =>
      new Promise((resolve, reject) => {
        const command = createWorshipDockSongSaveCommand(payload);
        let fallbackPosted = false;
        let fallbackError: Error | null = null;
        let fallbackTimer: number | null = null;
        let resultPollTimer: number | null = null;
        let timeoutTimer: number | null = null;
        let unsubscribe = () => { };
        let settled = false;

        const cleanup = () => {
          if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
          if (resultPollTimer !== null) window.clearInterval(resultPollTimer);
          if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
          unsubscribe();
        };

        const complete = (result: {
          ok?: boolean;
          song?: Song;
          error?: string;
        }) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (!result.ok || !result.song) {
            reject(new Error(result.error || "Song save failed."));
            return;
          }
          resolve(mapAppSongToDockSong(result.song));
        };

        unsubscribe = dockClient.onState((msg) => {
          if (msg.type !== "state:worship-song-save-result") return;
          const result = msg.payload as {
            commandId?: string;
            ok?: boolean;
            song?: Song;
            error?: string;
          };
          if (result.commandId !== command.commandId) return;
          complete(result);
        });

        const postFallback = () => {
          fallbackPosted = true;
          void postWorshipDockSongSaveCommand(command).catch((err) => {
            fallbackError = err instanceof Error ? err : new Error(String(err));
            console.warn("[DockWorshipTab] Fallback song save command failed:", err);
          });
        };

        fallbackTimer = window.setTimeout(postFallback, DOCK_WORSHIP_SAVE_FALLBACK_DELAY_MS);
        resultPollTimer = window.setInterval(() => {
          if (!fallbackPosted || settled) return;
          void loadWorshipDockSongSaveResult(command.commandId).then((result) => {
            if (!result) return;
            complete(result);
          }).catch(() => { });
        }, DOCK_WORSHIP_SAVE_RESULT_POLL_MS);

        timeoutTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(fallbackError ?? new Error("Main app did not confirm the song save."));
        }, DOCK_WORSHIP_SAVE_TIMEOUT_MS);

        dockClient.sendCommand({
          type: "worship:song-save",
          payload,
          commandId: command.commandId,
          timestamp: command.timestamp,
        });
      }),
    [],
  );

  const persistSong = useCallback(
    async (
      songId: string,
      draft: DockSongDraft,
      source?: Pick<DockSong, "importSourceName" | "importSourceType" | "importSourceUrl">,
    ) => {
      const title = draft.title.trim();
      const lyrics = draft.lyrics.trim();
      if (!title || !lyrics) return null;

      const dockSong = await saveSongInMainApp({
        id: songId,
        title,
        artist: draft.artist.trim(),
        lyrics,
        importSourceName: source?.importSourceName,
        importSourceType: source?.importSourceType ?? "manual",
        importSourceUrl: source?.importSourceUrl,
      });

      setSongs((current) => {
        const withoutSong = current.filter((song) => song.id !== dockSong.id);
        return [dockSong, ...withoutSong];
      });
      setSelectedSong((current) => (current?.id === dockSong.id ? dockSong : current));
      return dockSong;
    },
    [saveSongInMainApp],
  );

  const openSongEditor = useCallback((song: DockSong) => {
    rememberDockSongDefault(song);
    setSongEditor(song);
    setSongDraft({
      title: song.title,
      artist: song.artist,
      lyrics: song.lyrics,
    });
    setActionError("");
  }, []);

  const handleSaveSongEditor = useCallback(async () => {
    if (!songEditor) return;
    setSavingSong(true);
    setActionError("");
    try {
      await persistSong(songEditor.id, songDraft, songEditor);
      showToast("Song saved", "success");
      setSongEditor(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[DockWorshipTab] save song edit failed:", err);
      setActionError(message);
    } finally {
      setSavingSong(false);
    }
  }, [persistSong, showToast, songDraft, songEditor]);

  const handleResetSongEditor = useCallback(() => {
    if (!songEditor) return;
    const defaults = readDockSongDefaults();
    const fallback = defaults[songEditor.id] ?? songEditor;
    setSongDraft({
      title: fallback.title,
      artist: fallback.artist,
      lyrics: fallback.lyrics,
    });
    showToast("Default restored in editor");
  }, [showToast, songEditor]);

  const openNewSongModal = useCallback((draft?: Partial<DockSongDraft>) => {
    setNewSongDraft({
      title: draft?.title ?? "",
      artist: draft?.artist ?? "",
      lyrics: draft?.lyrics ?? "",
    });
    setNewSongSource({ importSourceType: "manual" });
    setIsNewSongModalOpen(true);
    setActionError("");
  }, []);

  const handleSaveNewSong = useCallback(async () => {
    setSavingSong(true);
    setActionError("");
    try {
      const newSong = await persistSong(createDockSongId(), newSongDraft, newSongSource ?? { importSourceType: "manual" });
      if (newSong) {
        rememberDockSongDefault(newSong);
        setIsNewSongModalOpen(false);
        setNewSongSource(null);
        setSelectedSong(newSong);
        setSelectedIdx(0);
        setLiveIdx(null);
        setPreviewIdx(null);
        setHiddenSectionIndexes(new Set());
        showToast(newSong.importSourceType === "online" ? "Import saved" : "Song added", "success");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[DockWorshipTab] add song failed:", err);
      setActionError(message);
    } finally {
      setSavingSong(false);
    }
  }, [newSongDraft, newSongSource, persistSong, showToast]);

  useEffect(() => {
    if (!selectedSong) return;
    const maxIndex = visibleSectionIndexes.length - 1;
    const fallbackIndex = visibleSectionIndexes[0] ?? null;
    const clampToVisible = (current: number | null) => {
      if (current === null) return fallbackIndex;
      if (visibleSectionIndexes.includes(current)) return current;
      if (maxIndex < 0) return null;
      return visibleSectionIndexes.find((index) => index > current) ?? visibleSectionIndexes[maxIndex] ?? null;
    };

    setSelectedIdx((current) => clampToVisible(current));
    setPreviewIdx((current) => (current === null ? null : clampToVisible(current)));
    setLiveIdx((current) => (current === null ? null : clampToVisible(current)));
  }, [selectedSong, visibleSectionIndexes]);

  useEffect(() => {
    if (!staged || staged.type !== "worship") return;

    const data = staged.data as Record<string, unknown>;
    const stageSong = data.song as DockSong | undefined;
    const stageIdx = typeof data.sectionIdx === "number" ? data.sectionIdx : null;

    if (stageSong) {
      setSelectedSong((current) => {
        if (current?.id === stageSong.id) return current;
        const existing = songs.find((song) => song.id === stageSong.id);
        return existing ?? stageSong;
      });
    }

    if (stageIdx !== null) {
      setSelectedIdx(stageIdx);
      if (data._dockLive) {
        setLiveIdx(stageIdx);
        setPreviewIdx(null);
      } else {
        setPreviewIdx(stageIdx);
      }
    }
  }, [songs, staged]);

  const activeSectionIndex = useMemo(() => {
    if (!selectedSong || visibleSectionIndexes.length === 0) return null;
    if (selectedIdx !== null && visibleSectionIndexes.includes(selectedIdx)) return selectedIdx;
    if (previewIdx !== null && visibleSectionIndexes.includes(previewIdx)) return previewIdx;
    if (liveIdx !== null && visibleSectionIndexes.includes(liveIdx)) return liveIdx;
    return visibleSectionIndexes[0] ?? null;
  }, [liveIdx, previewIdx, selectedIdx, selectedSong, visibleSectionIndexes]);

  const activeSection = activeSectionIndex !== null ? selectedSongSections[activeSectionIndex] ?? null : null;

  const handleSelectSong = useCallback((song: DockSong) => {
    setRecentSearches(pushRecentWorshipSearch(`song: ${song.title}`));
    setShowRecentSearches(false);
    setSelectedSong(song);
    setSelectedIdx(0);
    setLiveIdx(null);
    setPreviewIdx(null);
    setHiddenSectionIndexes(new Set());
    setActionError("");
  }, []);

  const applyRecentWorshipSearch = useCallback(
    (recentLabel: string) => {
      const title = recentLabel.replace(/^song:\s*/i, "").trim();
      setShowRecentSearches(false);
      if (!title) return;

      const exactSong = songs.find((song) => song.title.toLowerCase() === title.toLowerCase());
      if (exactSong) {
        setSearchQuery("");
        handleSelectSong(exactSong);
        return;
      }

      setSearchQuery(title);
    },
    [handleSelectSong, songs],
  );

  const handleBackToSongList = useCallback(() => {
    setSelectedSong(null);
    setSelectedIdx(null);
    setLiveIdx(null);
    setPreviewIdx(null);
    setActionError("");
  }, []);

  const handleSectionClick = useCallback(
    (idx: number) => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        void pushSection(idx, false);
      }, 220);
    },
    [pushSection],
  );

  const handleGoLiveSection = useCallback(
    (idx: number) => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      void pushSection(idx, true);
    },
    [pushSection],
  );

  const handleJumpToLyricSection = useCallback(
    (idx: number, live = false) => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      void pushSection(idx, live);
    },
    [pushSection],
  );

  const handleHideSection = useCallback(
    (idx: number) => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      setHiddenSectionIndexes((current) => {
        const next = new Set(current);
        next.add(idx);
        return next;
      });
      showToast(`Slide ${idx + 1} hidden`);
      if (activeSectionIndex === idx) {
        const nextIdx = visibleSectionIndexes.find((index) => index > idx) ?? visibleSectionIndexes.find((index) => index < idx) ?? null;
        setSelectedIdx(nextIdx);
        setPreviewIdx((current) => (current === idx ? null : current));
        setLiveIdx((current) => (current === idx ? null : current));
      }
    },
    [activeSectionIndex, showToast, visibleSectionIndexes],
  );

  const openSlideEditor = useCallback(
    (idx: number) => {
      const section = selectedSongSections[idx];
      if (!section) return;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      setSlideEditor({
        index: idx,
        label: cleanWorshipSectionLabel(section.label) || `Slide ${idx + 1}`,
        text: section.text,
      });
    },
    [selectedSongSections],
  );

  const handleSaveSlideEditor = useCallback(async () => {
    if (!selectedSong || !slideEditor) return;
    const nextSections = selectedSongSections.map((section, index) =>
      index === slideEditor.index ? { ...section, text: slideEditor.text.trim() } : section,
    );
    const nextLyrics = nextSections
      .map((section) => section.text.trim())
      .filter(Boolean)
      .join("\n\n");

    if (!nextLyrics.trim()) return;

    setSavingSong(true);
    setActionError("");
    try {
      const updatedSong = await persistSong(selectedSong.id, {
        title: selectedSong.title,
        artist: selectedSong.artist,
        lyrics: nextLyrics,
      }, selectedSong);
      if (updatedSong) {
        setSelectedSong(updatedSong);
        setSelectedIdx(slideEditor.index);
      }
      showToast("Slide updated", "success");
      setSlideEditor(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[DockWorshipTab] save slide edit failed:", err);
      setActionError(message);
    } finally {
      setSavingSong(false);
    }
  }, [persistSong, selectedSong, selectedSongSections, showToast, slideEditor]);

  const handleLinesPerSlideChange = useCallback((nextLinesPerSlide: number) => {
    setLinesPerSlide(nextLinesPerSlide);
    setHiddenSectionIndexes(new Set());
    setSelectedIdx(0);
    setPreviewIdx(null);
  }, []);

  const handleImportOnlineResult = useCallback(
    (result: OnlineLyricsSearchResult) => {
      setOnlineSearchOpen(false);
      setOnlineSearchError("");
      setOnlineResults([]);
      setOnlineSearchQuery("");
      setNewSongDraft({
        title: result.title,
        artist: result.artist,
        lyrics: result.lyrics,
      });
      setNewSongSource({
        importSourceName: result.sourceName,
        importSourceType: "online",
        importSourceUrl: result.url,
      });
      setIsNewSongModalOpen(true);
    },
    [],
  );

  useEffect(() => {
    if (!onlineSearchOpen) return;

    const query = onlineSearchQuery.trim();
    if (query.length < 3) {
      setOnlineResults([]);
      setOnlineSearchError("");
      setOnlineSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setOnlineSearchLoading(true);
      setOnlineSearchError("");
      searchOnlineSongLyrics(query)
        .then((results) => {
          if (cancelled) return;
          setOnlineResults(results);
          if (results.length === 0) setOnlineSearchError("No online lyric matches found.");
        })
        .catch((err) => {
          if (cancelled) return;
          setOnlineSearchError(formatOnlineLyricsSearchError(err));
          setOnlineResults([]);
        })
        .finally(() => {
          if (!cancelled) setOnlineSearchLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onlineSearchOpen, onlineSearchQuery]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const navigateSection = useCallback(
    async (delta: 1 | -1) => {
      if (!selectedSong || visibleSectionIndexes.length === 0) return;
      const currentIdx = activeSectionIndex ?? 0;
      const currentVisibleIndex = visibleSectionIndexes.indexOf(currentIdx);
      const currentPosition = currentVisibleIndex >= 0 ? currentVisibleIndex : 0;
      const nextPosition = Math.max(0, Math.min(visibleSectionIndexes.length - 1, currentPosition + delta));
      const nextIdx = visibleSectionIndexes[nextPosition] ?? currentIdx;
      if (nextIdx === currentIdx) return;
      await pushSection(nextIdx, isProgramLive);
    },
    [activeSectionIndex, isProgramLive, pushSection, selectedSong, visibleSectionIndexes],
  );

  const handleGoLiveCurrent = useCallback(async () => {
    if (activeSectionIndex === null) return;
    await pushSection(activeSectionIndex, true);
  }, [activeSectionIndex, pushSection]);

  const handleClearLyricsTarget = useCallback(
    (target: "preview" | "program" | "all") => {
      setActionError("");
      if (target === "preview" || target === "all") {
        setPreviewIdx(null);
      }
      if (target === "program" || target === "all") {
        setLiveIdx(null);
      }
      if (target === "all") {
        setSelectedIdx(null);
      }
      if (
        target === "all" ||
        (target === "preview" && !isProgramLive) ||
        (target === "program" && isProgramLive)
      ) {
        onStage(null);
      }

      const label = target === "all" ? "Worship cleared" : `Worship ${target} cleared`;
      showToast(label);
      if (!dockObsClient.isConnected) return;

      const clearPromise = target === "all"
        ? dockObsClient.clearWorshipLyrics()
        : dockObsClient.clearWorshipLyricsTarget(target === "program");

      clearPromise.catch((err) =>
        console.warn(`[DockWorshipTab] clear worship ${target} failed:`, err),
      );
    },
    [isProgramLive, onStage, showToast],
  );

  const handleClearLyrics = useCallback(() => {
    handleClearLyricsTarget("all");
  }, [handleClearLyricsTarget]);

  const handleSelectFullscreenTheme = useCallback((theme: BibleTheme) => {
    setSelectedFSTheme(theme);
    setOverlayMode("fullscreen");
  }, []);

  const handleSelectLowerThirdTheme = useCallback((theme: BibleTheme) => {
    setSelectedLTTheme(theme);
    setOverlayMode("lower-third");
  }, []);

  const activeThemePickerProps =
    overlayMode === "fullscreen"
      ? {
        selectedThemeId: selectedFSTheme.id,
        onSelect: handleSelectFullscreenTheme,
        label: "Fullscreen Theme",
        templateType: "fullscreen" as const,
      }
      : {
        selectedThemeId: selectedLTTheme.id,
        onSelect: handleSelectLowerThirdTheme,
        label: "Lower Third Theme",
        templateType: "lower-third" as const,
      };

  const restageCurrent = useCallback(
    async (live: boolean) => {
      if (activeSectionIndex === null || !selectedSong) return;
      await pushSection(activeSectionIndex, live);
    },
    [activeSectionIndex, pushSection, selectedSong],
  );

  const prevOverlayMode = useRef(overlayMode);
  useEffect(() => {
    if (prevOverlayMode.current === overlayMode) return;
    prevOverlayMode.current = overlayMode;
    if (selectedSong && activeSectionIndex !== null) {
      void restageCurrent(isProgramLive);
    }
  }, [activeSectionIndex, isProgramLive, overlayMode, restageCurrent, selectedSong]);

  const prevThemeSignature = useRef(`${selectedFSTheme.id}:${selectedLTTheme.id}`);
  useEffect(() => {
    const nextSignature = `${selectedFSTheme.id}:${selectedLTTheme.id}`;
    if (prevThemeSignature.current === nextSignature) return;
    prevThemeSignature.current = nextSignature;
    if (selectedSong && activeSectionIndex !== null) {
      void restageCurrent(isProgramLive);
    }
  }, [activeSectionIndex, isProgramLive, restageCurrent, selectedFSTheme.id, selectedLTTheme.id, selectedSong]);

  const prevLinesPerSlide = useRef(linesPerSlide);
  useEffect(() => {
    if (prevLinesPerSlide.current === linesPerSlide) return;
    prevLinesPerSlide.current = linesPerSlide;
    if (selectedSong && activeSectionIndex !== null) {
      void restageCurrent(isProgramLive);
    }
  }, [activeSectionIndex, isProgramLive, linesPerSlide, restageCurrent, selectedSong]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Escape") {
        if (songEditor || slideEditor || isNewSongModalOpen || onlineSearchOpen) {
          event.preventDefault();
          setSongEditor(null);
          setSlideEditor(null);
          setIsNewSongModalOpen(false);
          setOnlineSearchOpen(false);
          setNewSongSource(null);
          return;
        }
        if (targetElement?.closest(".dtb-modal, .dock-dialog")) return;
        event.preventDefault();
        handleClearLyrics();
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectedSong || visibleSectionIndexes.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        void navigateSection(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateSection(-1);
      } else if (event.key === "Enter" && activeSectionIndex !== null) {
        event.preventDefault();
        void handleGoLiveCurrent();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeSectionIndex,
    handleClearLyrics,
    handleGoLiveCurrent,
    isNewSongModalOpen,
    navigateSection,
    onlineSearchOpen,
    selectedSong,
    slideEditor,
    songEditor,
    visibleSectionIndexes.length,
  ]);

  return (
    <div className="dock-module dock-module--worship">
      <section className="dock-console-panel dock-console-panel--toolbar">
        {!selectedSong ? (
          <>
            <div className="dock-console-header">
              <div>
                <div className="dock-console-header__eyebrow">Song Browser</div>
                <div className="dock-console-header__title">Find a Song</div>
              </div>
              <div className="dock-console-actions dock-console-actions--song-browser">
                <button
                  type="button"
                  className="dock-console-toggle"
                  onClick={() => {
                    setOnlineSearchQuery(searchQuery.trim());
                    setOnlineSearchOpen(true);
                    setOnlineSearchError("");
                  }}
                >
                  <Icon name="travel_explore" size={13} />
                  Search Online
                </button>
                <button
                  type="button"
                  className="dock-console-toggle"
                  onClick={() => openNewSongModal()}
                >
                  <Icon name="add" size={13} />
                  Add Song
                </button>
                <button
                  type="button"
                  className="dock-shell-icon-btn"
                  onClick={() => {
                    void loadSongs(true).then(() => showToast("Songs refreshed", "success"));
                  }}
                  aria-label="Refresh song library"
                  title="Refresh song library"
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>
            </div>
            <div className="dock-search dock-search--console" style={{ marginBottom: 0 }} ref={searchRef}>
              <Icon name="search" size={14} className="dock-search__icon" />
              <input
                className="dock-input"
                placeholder="Search title or artist..."
                value={searchQuery}
                onChange={(event) => {
                  const next = event.target.value;
                  setSearchQuery(next);
                  setShowRecentSearches(next.trim().length === 0 && recentSearches.length > 0);
                }}
                onFocus={() => {
                  if (!searchQuery.trim() && recentSearches.length > 0) {
                    setShowRecentSearches(true);
                  }
                }}
                aria-label="Search songs"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="dock-search__clear"
                  onClick={() => {
                    setSearchQuery("");
                    setShowRecentSearches(recentSearches.length > 0);
                  }}
                  aria-label="Clear song search"
                  title="Clear song search"
                >
                  <Icon name="close" size={13} />
                </button>
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
                      onClick={() => applyRecentWorshipSearch(item)}
                    >
                      <Icon name="history" size={13} style={{ opacity: 0.5 }} />
                      <span className="dock-search-dropdown__content">
                        <span className="dock-search-dropdown__label">{item}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="dock-console-header">
              <div>
                <div className="dock-console-header__eyebrow">Selected Song</div>
                <div className="dock-console-header__title">{selectedSong.title}/{selectedSong.artist.substring(0, 30)}{selectedSong.artist.length > 30 ? "..." : ""}</div>
              </div>
              <div className="dock-console-actions">
                {/* {selectedSong.artist && <span className="dock-shell-chip">{selectedSong.artist}</span>} */}
                <button
                  type="button"
                  className="dock-console-toggle"
                  onClick={handleBackToSongList}
                >
                  Change Song
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="dock-console-panel dock-console-panel--workspace dock-worship-workspace">
        {!selectedSong ? (
          filteredSongs.length === 0 ? (
            <div className="dock-empty dock-worship-workspace__empty">
              <Icon name={songs.length === 0 ? "music_off" : "search_off"} size={20} />
              <div className="dock-empty__title">
                {songs.length === 0 ? "No Songs Yet" : "No Matches"}
              </div>
              <div className="dock-empty__text">
                {songs.length === 0
                  ? "Load songs in the main app to use them in the dock."
                  : `No songs match "${searchQuery}".`}
              </div>
            </div>
          ) : (
            <>
              <div className="dock-console-header">
                <div>
                  <div className="dock-console-header__eyebrow">Library</div>
                  {/* <div className="dock-console-header__title">{filteredSongs.length} Songs Ready</div> */}
                </div>
              </div>
              <div className="dock-console-list dock-worship-workspace__list">
                {filteredSongs.map((song) => (
                  <div
                    key={song.id}
                    className="dock-card dock-card--console dock-song-card"
                  >
                    <button
                      type="button"
                      className="dock-song-card__main"
                      onClick={() => handleSelectSong(song)}
                    >
                      <span className="dock-card__title">{song.title}</span>
                      <span className="dock-card__subtitle">
                        {song.artist || "Unknown artist"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="dock-song-card__edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        openSongEditor(song);
                      }}
                      aria-label={`Edit ${song.title}`}
                      title="Edit song"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <div className="dock-console-header">
              <div>
                <div className="dock-console-header__eyebrow">Cue List</div>
                <div className="dock-console-header__title">
                  {visibleSectionIndexes.length} of {selectedSongSections.length} slides visible
                </div>
              </div>
              <div className="dock-console-actions">
                {hiddenSectionIndexes.size > 0 && (
                  <button
                    type="button"
                    className="dock-console-toggle"
                    onClick={() => setHiddenSectionIndexes(new Set())}
                  >
                    Show All
                  </button>
                )}
                <button
                  type="button"
                  className="dock-btn dock-btn--ghost"
                  style={{ padding: "6px 8px", minWidth: 0 }}
                  onClick={() => void navigateSection(-1)}
                  title="Previous section"
                >
                  <Icon name="arrow_back" size={14} />
                </button>
                <button
                  type="button"
                  className="dock-btn dock-btn--ghost"
                  style={{ padding: "6px 8px", minWidth: 0 }}
                  onClick={() => void navigateSection(1)}
                  title="Next section"
                >
                  <Icon name="chevron_right" size={14} />
                </button>
              </div>
            </div>

            {selectedSongLyricSections.length > 1 && (
              <div className="dock-worship-jumpbar" aria-label="Worship section quick jumps">
                {selectedSongLyricSections.map((section) => {
                  const isActive = activeSectionIndex !== null &&
                    activeSectionIndex >= section.startSlideIndex &&
                    activeSectionIndex < section.startSlideIndex + section.slideCount;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={`dock-worship-jump${isActive ? " dock-worship-jump--active" : ""} dock-worship-jump--${section.type}`}
                      onClick={() => handleJumpToLyricSection(section.startSlideIndex, false)}
                      onDoubleClick={() => handleJumpToLyricSection(section.startSlideIndex, true)}
                      title={`${section.label}: click previews, double-click sends Program`}
                    >
                      <span className="dock-worship-jump__short">{section.shortLabel}</span>
                      <span className="dock-worship-jump__label">{section.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSongSections.length === 0 || visibleSectionIndexes.length === 0 ? (
              <div className="dock-empty dock-worship-workspace__empty">
                <Icon name="lyrics" size={18} />
                <div className="dock-empty__text">
                  {selectedSongSections.length === 0
                    ? "This song does not have any slideable lyrics yet."
                    : "All slides are hidden for this line setting."}
                </div>
              </div>
            ) : (
              <div className="dock-console-list dock-worship-workspace__list">
                <div className="dock-cue-hint">
                  Click previews • Double-click sends Program • Hover for Edit/Hide • Arrows navigate • Esc clears
                </div>
                {visibleSectionIndexes.map((idx) => {
                  const section = selectedSongSections[idx];
                  if (!section) return null;
                  const displayLabel = cleanWorshipSectionLabel(section.label);
                  const isLive = liveIdx === idx;
                  const isPreview = previewIdx === idx && liveIdx !== idx;
                  const isSelected = selectedIdx === idx;
                  return (
                    <div
                      key={section.id}
                      className={`dock-lyric-card dock-lyric-card--console${isLive
                        ? " dock-lyric-card--live"
                        : isPreview
                          ? " dock-lyric-card--preview"
                          : isSelected
                            ? " dock-lyric-card--selected"
                            : ""
                        }`}
                      title="Click to preview. Double-click to send live."
                    >
                      <button
                        type="button"
                        className="dock-lyric-card__main"
                        onClick={() => handleSectionClick(idx)}
                        onDoubleClick={() => handleGoLiveSection(idx)}
                      >
                        <div className="dock-lyric-card__header">
                          {displayLabel ? (
                            <span className="dock-lyric-card__label">{displayLabel}</span>
                          ) : (
                            <span className="dock-lyric-card__label dock-lyric-card__label--muted">
                              Slide {idx + 1}
                            </span>
                          )}
                          <div className="dock-lyric-card__meta">
                            {isLive && (
                              <span className="dock-lyric-badge dock-lyric-badge--live">
                                <Icon name="fiber_manual_record" size={8} />
                                Live
                              </span>
                            )}
                            {isPreview && <span className="dock-lyric-badge dock-lyric-badge--preview">Preview</span>}
                            {!isLive && !isPreview && isSelected && (
                              <span className="dock-lyric-badge">Selected</span>
                            )}
                          </div>
                        </div>
                        <div className="dock-lyric-card__text">{section.text}</div>
                      </button>
                      <div className="dock-lyric-card__actions" aria-label={`Actions for slide ${idx + 1}`}>
                        <button
                          type="button"
                          className="dock-lyric-card__action"
                          onClick={() => openSlideEditor(idx)}
                          aria-label={`Edit slide ${idx + 1}`}
                          title="Edit slide"
                        >
                          <Icon name="edit" size={12} />
                        </button>
                        <button
                          type="button"
                          className="dock-lyric-card__action"
                          onClick={() => handleHideSection(idx)}
                          aria-label={`Hide slide ${idx + 1}`}
                          title="Hide slide"
                        >
                          <Icon name="visibility_off" size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {selectedSong && (
        <section className="dock-console-panel dock-console-panel--deck dock-console-panel--deck-static dock-console-panel--deck-worship">
          {!activeSection && (
            <div className="dock-console-placeholder">
              Choose a lyric slide to preview it here. Double-click any slide to take it live instantly.
            </div>
          )}

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

          <div className="dock-console-action-row dock-console-action-row--worship">
            <div className="dock-worship-clear-group" aria-label="Clear worship outputs">
              <button
                type="button"
                className="dock-btn dock-btn--toolbar dock-btn--danger dock-worship-clear-group__btn"
                onClick={() => handleClearLyricsTarget("preview")}
                title="Clear Worship Preview only"
              >
                <Icon name="preview" size={13} />
                Preview
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--toolbar dock-btn--danger dock-worship-clear-group__btn"
                onClick={() => handleClearLyricsTarget("program")}
                title="Clear Worship Program only"
              >
                <Icon name="live_tv" size={13} />
                Program
              </button>
            </div>
            <button
              type="button"
              className="dock-btn dock-btn--toolbar dock-btn--danger dock-console-action-row__clear"
              onClick={handleClearLyrics}
              title="Clear Worship Preview and Program"
            >
              <Icon name="clear" size={16} />
              All
            </button>
          </div>

          <div className="dock-worship-toolbar">
            <div className="dock-worship-toolbar__row">
              <div className="dock-worship-inline-control dock-worship-inline-control--mode-theme">
                <span className="dock-worship-inline-control__label">Mode</span>
                <div className="dock-console-segmented">
                  <button
                    type="button"
                    className={`dock-console-segmented__item${overlayMode === "fullscreen" ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => setOverlayMode("fullscreen")}
                  >
                    <Icon name="fullscreen" size={14} />
                    Full
                  </button>
                  <button
                    type="button"
                    className={`dock-console-segmented__item${overlayMode === "lower-third" ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => setOverlayMode("lower-third")}
                  >
                    <Icon name="subtitles" size={14} />
                    LT
                  </button>
                </div>
                <DockBibleThemePicker
                  selectedThemeId={activeThemePickerProps.selectedThemeId}
                  onSelect={activeThemePickerProps.onSelect}
                  label=""
                  templateType={activeThemePickerProps.templateType}
                  allowedCategories={["worship", "general"]}
                />
              </div>

              <div className="dock-worship-inline-control dock-worship-inline-control--lines">
                <span className="dock-worship-inline-control__label">Lines</span>
                <select
                  className="dock-select dock-select--worship-lines"
                  value={linesPerSlide}
                  onChange={(event) => handleLinesPerSlideChange(Number(event.target.value))}
                  aria-label="Lines per worship slide"
                  title="Lines per worship slide"
                >
                  {LINES_PER_SLIDE_OPTIONS.map((count) => (
                    <option key={count} value={count}>
                      {count} line{count > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>
      )}

      {songEditor && (
        <div className="dock-dialog-backdrop" role="presentation">
          <div className="dock-dialog" role="dialog" aria-modal="true" aria-labelledby="dock-song-editor-title">
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">Edit Song</div>
                <h2 id="dock-song-editor-title" className="dock-dialog__title">Song details</h2>
              </div>
              <button
                type="button"
                className="dock-dialog__close"
                onClick={() => setSongEditor(null)}
                aria-label="Close song editor"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <label className="dock-dialog-field">
                <span>Title</span>
                <input
                  className="dock-input"
                  value={songDraft.title}
                  onChange={(event) => setSongDraft((draft) => ({ ...draft, title: event.target.value }))}
                />
              </label>
              <label className="dock-dialog-field">
                <span>Artist</span>
                <input
                  className="dock-input"
                  value={songDraft.artist}
                  onChange={(event) => setSongDraft((draft) => ({ ...draft, artist: event.target.value }))}
                />
              </label>
              <label className="dock-dialog-field">
                <span>Lyrics</span>
                <textarea
                  className="dock-input dock-dialog-textarea"
                  value={songDraft.lyrics}
                  onChange={(event) => setSongDraft((draft) => ({ ...draft, lyrics: event.target.value }))}
                />
              </label>
            </div>
            <div className="dock-dialog__footer">
              <button type="button" className="dock-btn dock-btn--ghost" onClick={handleResetSongEditor}>
                Reset to Default
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--primary"
                onClick={() => void handleSaveSongEditor()}
                disabled={savingSong || !songDraft.title.trim() || !songDraft.lyrics.trim()}
              >
                {savingSong ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {slideEditor && (
        <div className="dock-dialog-backdrop" role="presentation">
          <div className="dock-dialog dock-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="dock-slide-editor-title">
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">Quick Edit</div>
                <h2 id="dock-slide-editor-title" className="dock-dialog__title">{slideEditor.label}</h2>
              </div>
              <button
                type="button"
                className="dock-dialog__close"
                onClick={() => setSlideEditor(null)}
                aria-label="Close slide editor"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <label className="dock-dialog-field">
                <span>Slide text</span>
                <textarea
                  className="dock-input dock-dialog-textarea dock-dialog-textarea--short"
                  value={slideEditor.text}
                  onChange={(event) => setSlideEditor((draft) => draft ? { ...draft, text: event.target.value } : draft)}
                />
              </label>
            </div>
            <div className="dock-dialog__footer">
              <button type="button" className="dock-btn dock-btn--ghost" onClick={() => setSlideEditor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--primary"
                onClick={() => void handleSaveSlideEditor()}
                disabled={savingSong || !slideEditor.text.trim()}
              >
                {savingSong ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isNewSongModalOpen && (
        <div className="dock-dialog-backdrop" role="presentation">
          <div className="dock-dialog" role="dialog" aria-modal="true" aria-labelledby="dock-new-song-title">
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">{newSongSource?.importSourceType === "online" ? "Review Import" : "Add Song"}</div>
                <h2 id="dock-new-song-title" className="dock-dialog__title">
                  {newSongSource?.importSourceType === "online" ? "Review lyrics before saving" : "New worship song"}
                </h2>
              </div>
              <button
                type="button"
                className="dock-dialog__close"
                onClick={() => {
                  setIsNewSongModalOpen(false);
                  setNewSongSource(null);
                }}
                aria-label="Close add song dialog"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <label className="dock-dialog-field">
                <span>Title</span>
                <input
                  className="dock-input"
                  value={newSongDraft.title}
                  onChange={(event) => setNewSongDraft((draft) => ({ ...draft, title: event.target.value }))}
                />
              </label>
              <label className="dock-dialog-field">
                <span>Artist</span>
                <input
                  className="dock-input"
                  value={newSongDraft.artist}
                  onChange={(event) => setNewSongDraft((draft) => ({ ...draft, artist: event.target.value }))}
                />
              </label>
              <label className="dock-dialog-field">
                <span>Lyrics</span>
                <textarea
                  className="dock-input dock-dialog-textarea"
                  value={newSongDraft.lyrics}
                  onChange={(event) => setNewSongDraft((draft) => ({ ...draft, lyrics: event.target.value }))}
                />
              </label>
            </div>
            <div className="dock-dialog__footer">
              <button
                type="button"
                className="dock-btn dock-btn--ghost"
                onClick={() => {
                  setIsNewSongModalOpen(false);
                  setNewSongSource(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--primary"
                onClick={() => void handleSaveNewSong()}
                disabled={savingSong || !newSongDraft.title.trim() || !newSongDraft.lyrics.trim()}
              >
                {savingSong ? "Saving..." : "Save Song"}
              </button>
            </div>
          </div>
        </div>
      )}

      {onlineSearchOpen && (
        <div className="dock-dialog-backdrop" role="presentation">
          <div className="dock-dialog" role="dialog" aria-modal="true" aria-labelledby="dock-online-song-title">
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">Search Online</div>
                <h2 id="dock-online-song-title" className="dock-dialog__title">Import lyrics</h2>
              </div>
              <button
                type="button"
                className="dock-dialog__close"
                onClick={() => setOnlineSearchOpen(false)}
                aria-label="Close online search"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <div className="dock-search dock-search--console">
                <Icon name="search" size={14} className="dock-search__icon" />
                <input
                  className="dock-input"
                  placeholder="Type to start searching..."
                  value={onlineSearchQuery}
                  onChange={(event) => setOnlineSearchQuery(event.target.value)}
                  aria-label="Search online lyrics"
                  autoFocus
                />
                {onlineSearchQuery && (
                  <button
                    type="button"
                    className="dock-search__clear"
                    onClick={() => setOnlineSearchQuery("")}
                    aria-label="Clear online lyrics search"
                    title="Clear online lyrics search"
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
              </div>
              {onlineSearchLoading && (
                <div className="dock-dialog__status">
                  <Icon name="sync" size={13} />
                  Searching online sources...
                </div>
              )}
              {onlineSearchError && <div className="dock-dialog__error">{onlineSearchError}</div>}
              <div className="dock-dialog-results">
                {onlineResults.map((result) => (
                  <div className="dock-dialog-result" key={result.id}>
                    <div className="dock-dialog-result__body">
                      <span className="dock-dialog-result__title">{result.title}</span>
                      <span className="dock-dialog-result__meta">
                        {[result.artist, result.sourceName].filter(Boolean).join(" · ") || "Online lyrics"}
                      </span>
                      {result.preview && <span className="dock-dialog-result__preview">{result.preview}</span>}
                    </div>
                    <button
                      type="button"
                      className="dock-btn dock-btn--ghost dock-dialog-result__action"
                      onClick={() => handleImportOnlineResult(result)}
                    >
                      Import
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="dock-toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`dock-toast dock-toast--${toast.tone}`}>
              {toast.tone === "success" && <Icon name="check" size={13} />}
              {toast.tone === "error" && <Icon name="warning" size={13} />}
              {toast.tone === "info" && <Icon name="check_circle" size={13} />}
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
