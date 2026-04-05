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
import { generateSlides } from "../../worship/slideEngine";
import DockBibleThemePicker from "../components/DockBibleThemePicker";
import {
  DOCK_BACKGROUND_PRESETS,
  type DockBackgroundPreset,
  buildDockBackgroundPresetOverrides,
  dockBackgroundPresetPreviewStyle,
} from "../dockConsoleTheme";
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
}

interface DockWorshipPreferences {
  overlayMode?: OverlayMode;
  fullscreenThemeId?: string;
  lowerThirdThemeId?: string;
  backgroundPreset?: DockBackgroundPreset;
  linesPerSlide?: number;
  deckCollapsed?: boolean;
}

const DOCK_WORSHIP_PREFS_KEY = "ocs-dock-worship-preferences";
const LINES_PER_SLIDE_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

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
  const [backgroundPreset, setBackgroundPreset] = useState<DockBackgroundPreset>("theme");
  const [linesPerSlide, setLinesPerSlide] = useState<number>(2);
  const [deckCollapsed, setDeckCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsReadyRef = useRef(false);
  const isProgramLive =
    staged?.type === "worship" &&
    Boolean((staged.data as Record<string, unknown> | undefined)?._dockLive);

  const selectedSongSections = useMemo(
    () => (selectedSong ? parseLyricSections(selectedSong.lyrics, linesPerSlide) : []),
    [linesPerSlide, selectedSong],
  );

  useEffect(() => {
    prefsReadyRef.current = false;
    const prefs = loadDockWorshipPreferences();
    setSelectedFSTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
    setSelectedLTTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
    setOverlayMode(prefs.overlayMode ?? productionDefaults.defaultMode);
    setBackgroundPreset(prefs.backgroundPreset ?? "theme");
    setLinesPerSlide(
      typeof prefs.linesPerSlide === "number" && LINES_PER_SLIDE_OPTIONS.includes(prefs.linesPerSlide as 1)
        ? prefs.linesPerSlide
        : 2,
    );
    setDeckCollapsed(Boolean(prefs.deckCollapsed));

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
      backgroundPreset,
      linesPerSlide,
      deckCollapsed,
    });
  }, [backgroundPreset, deckCollapsed, linesPerSlide, overlayMode, selectedFSTheme.id, selectedLTTheme.id]);

  const mapSongs = useCallback(
    (all: Array<{ id: string; metadata: { title: string; artist?: string }; lyrics?: string }>): DockSong[] =>
      all.map((song) => ({
        id: song.id,
        title: song.metadata.title,
        artist: song.metadata.artist || "",
        lyrics: song.lyrics || "",
      })),
    [],
  );

  const loadSongs = useCallback(async () => {
    try {
      const { getAllSongs } = await import("../../worship/worshipDb");
      const all = await getAllSongs();
      if (all.length > 0) {
        setSongs(mapSongs(all));
        return;
      }
    } catch (err) {
      console.log("[DockWorshipTab] IndexedDB not available:", err);
    }

    try {
      const res = await fetch("/uploads/dock-worship-songs.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = await res.json();
      if (Array.isArray(all) && all.length > 0) {
        setSongs(mapSongs(all));
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
      if (msg.type === "state:library-updated" || msg.type === "state:songs-data") {
        void loadSongs();
      }
    });
    return unsub;
  }, [loadSongs]);

  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return songs;
    const needle = searchQuery.toLowerCase();
    return songs.filter(
      (song) =>
        song.title.toLowerCase().includes(needle) ||
        song.artist.toLowerCase().includes(needle),
    );
  }, [searchQuery, songs]);

  const fullscreenLiveOverrides = useMemo(
    () => buildDockBackgroundPresetOverrides(selectedFSTheme.settings, backgroundPreset),
    [backgroundPreset, selectedFSTheme.settings],
  );

  const buildSectionPayload = useCallback(
    (idx: number, live: boolean) => {
      if (!selectedSong) return null;
      const section = selectedSongSections[idx];
      if (!section) return null;

      const displayLabel = cleanWorshipSectionLabel(section.label);
      const theme = overlayMode === "fullscreen" ? selectedFSTheme : selectedLTTheme;
      const liveOverrides =
        overlayMode === "fullscreen"
          ? (fullscreenLiveOverrides as Record<string, unknown> | null)
          : null;

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
        liveOverrides,
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
          liveOverrides,
        },
      };
    },
    [
      fullscreenLiveOverrides,
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

  useEffect(() => {
    if (!selectedSong) return;
    const maxIndex = selectedSongSections.length - 1;

    setSelectedIdx((current) => {
      if (current === null) return selectedSongSections.length > 0 ? 0 : null;
      return Math.min(current, Math.max(maxIndex, 0));
    });
    setPreviewIdx((current) => (current === null ? null : Math.min(current, Math.max(maxIndex, 0))));
    setLiveIdx((current) => (current === null ? null : Math.min(current, Math.max(maxIndex, 0))));
  }, [selectedSong, selectedSongSections.length]);

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
    if (!selectedSong || selectedSongSections.length === 0) return null;
    if (selectedIdx !== null && selectedIdx < selectedSongSections.length) return selectedIdx;
    if (previewIdx !== null && previewIdx < selectedSongSections.length) return previewIdx;
    if (liveIdx !== null && liveIdx < selectedSongSections.length) return liveIdx;
    return 0;
  }, [liveIdx, previewIdx, selectedIdx, selectedSong, selectedSongSections.length]);

  const activeSection = activeSectionIndex !== null ? selectedSongSections[activeSectionIndex] ?? null : null;

  const handleSelectSong = useCallback((song: DockSong) => {
    setSelectedSong(song);
    setSelectedIdx(0);
    setLiveIdx(null);
    setPreviewIdx(null);
    setActionError("");
  }, []);

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

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const navigateSection = useCallback(
    async (delta: 1 | -1) => {
      if (!selectedSong || selectedSongSections.length === 0) return;
      const currentIdx = activeSectionIndex ?? 0;
      const nextIdx = Math.max(0, Math.min(selectedSongSections.length - 1, currentIdx + delta));
      if (nextIdx === currentIdx) return;
      await pushSection(nextIdx, isProgramLive);
    },
    [activeSectionIndex, isProgramLive, pushSection, selectedSong, selectedSongSections.length],
  );

  const handlePreviewCurrent = useCallback(async () => {
    if (activeSectionIndex === null) return;
    await pushSection(activeSectionIndex, false);
  }, [activeSectionIndex, pushSection]);

  const handleGoLiveCurrent = useCallback(async () => {
    if (activeSectionIndex === null) return;
    await pushSection(activeSectionIndex, true);
  }, [activeSectionIndex, pushSection]);

  const handleClearLyrics = useCallback(() => {
    setLiveIdx(null);
    setPreviewIdx(null);
    setSelectedIdx(null);
    setActionError("");
    onStage(null);
    if (dockObsClient.isConnected) {
      dockObsClient.clearWorshipLyrics().catch((err) =>
        console.warn("[DockWorshipTab] clearWorshipLyrics failed:", err),
      );
    }
  }, [onStage]);

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

  const prevBackgroundPreset = useRef(backgroundPreset);
  useEffect(() => {
    if (prevBackgroundPreset.current === backgroundPreset) return;
    prevBackgroundPreset.current = backgroundPreset;
    if (overlayMode !== "fullscreen") return;
    if (selectedSong && activeSectionIndex !== null) {
      void restageCurrent(isProgramLive);
    }
  }, [activeSectionIndex, backgroundPreset, isProgramLive, overlayMode, restageCurrent, selectedSong]);

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
        if (targetElement?.closest(".dtb-modal")) return;
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
      if (!selectedSong || selectedSongSections.length === 0) return;

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
  }, [activeSectionIndex, handleClearLyrics, handleGoLiveCurrent, navigateSection, selectedSong, selectedSongSections.length]);

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
              <button
                type="button"
                className="dock-shell-icon-btn"
                onClick={() => void loadSongs()}
                aria-label="Refresh song library"
                title="Refresh song library"
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <div className="dock-search dock-search--console" style={{ marginBottom: 0 }}>
              <Icon name="search" size={14} />
              <input
                className="dock-input"
                placeholder="Search title or artist..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search songs"
              />
            </div>
          </>
        ) : (
          <>
            <div className="dock-console-header">
              <div>
                <div className="dock-console-header__eyebrow">Selected Song</div>
                <div className="dock-console-header__title">{selectedSong.title}</div>
              </div>
              <div className="dock-console-actions">
                {selectedSong.artist && <span className="dock-shell-chip">{selectedSong.artist}</span>}
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
                  <div className="dock-console-header__title">{filteredSongs.length} Songs Ready</div>
                </div>
              </div>
              <div className="dock-console-list dock-worship-workspace__list">
                {filteredSongs.map((song) => (
                  <button
                    key={song.id}
                    type="button"
                    className="dock-card dock-card--console"
                    onClick={() => handleSelectSong(song)}
                  >
                    <span className="dock-card__title">{song.title}</span>
                    <span className="dock-card__subtitle">
                      {song.artist || "Unknown artist"}
                    </span>
                  </button>
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
                  {selectedSongSections.length} Slides ready
                </div>
              </div>
              <div className="dock-console-actions">
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

            {selectedSongSections.length === 0 ? (
              <div className="dock-empty dock-worship-workspace__empty">
                <Icon name="lyrics" size={18} />
                <div className="dock-empty__text">This song does not have any slideable lyrics yet.</div>
              </div>
            ) : (
              <div className="dock-console-list dock-worship-workspace__list">
                {selectedSongSections.map((section, idx) => {
                  const displayLabel = cleanWorshipSectionLabel(section.label);
                  const isLive = liveIdx === idx;
                  const isPreview = previewIdx === idx && liveIdx !== idx;
                  const isSelected = selectedIdx === idx;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={`dock-lyric-card dock-lyric-card--console${isLive
                        ? " dock-lyric-card--live"
                        : isPreview
                          ? " dock-lyric-card--preview"
                          : isSelected
                            ? " dock-lyric-card--selected"
                            : ""
                        }`}
                      onClick={() => handleSectionClick(idx)}
                      onDoubleClick={() => handleGoLiveSection(idx)}
                      title="Click to preview. Double-click to send live."
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
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {selectedSong && (
        <section className={`dock-console-panel dock-console-panel--deck dock-console-panel--deck-static${deckCollapsed ? " dock-console-panel--deck-collapsed" : ""}`}>
          <div className="dock-console-deck__header">
            <div>
              <div className="dock-console-header__eyebrow">Control Deck</div>
              <div className="dock-console-deck__title">
                {activeSection ? stageItemLabel(selectedSong, activeSection, Boolean(isProgramLive && liveIdx === activeSectionIndex)) : "Select a lyric slide"}
              </div>
            </div>
            <button
              type="button"
              className="dock-console-toggle"
              onClick={() => setDeckCollapsed((value) => !value)}
            >
              {deckCollapsed ? "Expand" : "Collapse"}
            </button>
          </div>

          {activeSection ? (
            <div className="dock-staged dock-staged--console">
              <div className="dock-staged__header">
                <span className="dock-staged__badge">
                  <Icon name="fiber_manual_record" size={10} />
                  {liveIdx === activeSectionIndex ? "Live" : previewIdx === activeSectionIndex ? "Preview" : "Cue"}
                </span>
                <div className="dock-console-actions">
                  <span className="dock-shell-chip">{selectedSong.title}</span>
                  {selectedSong.artist && <span className="dock-shell-chip">{selectedSong.artist}</span>}
                </div>
              </div>
              <div className="dock-staged__label">
                {cleanWorshipSectionLabel(activeSection.label) || `Slide ${activeSectionIndex !== null ? activeSectionIndex + 1 : ""}`}
              </div>
              <div className="dock-staged__sub">{activeSection.text}</div>
            </div>
          ) : (
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

          {!deckCollapsed && (
            <>
              <div className="dock-console-action-row dock-console-action-row--worship">
                <div className="dock-console-action-pair">
                  <button
                    type="button"
                    className="dock-btn dock-btn--preview"
                    onClick={() => void handlePreviewCurrent()}
                    disabled={activeSectionIndex === null || sending}
                  >
                    <Icon name={sending ? "sync" : "preview"} size={16} />
                    {sending ? "Sending..." : "Send to Preview"}
                  </button>
                  <button
                    type="button"
                    className="dock-btn dock-btn--live"
                    onClick={() => void handleGoLiveCurrent()}
                    disabled={activeSectionIndex === null || sending}
                  >
                    <Icon name={sending ? "sync" : "cast"} size={16} />
                    {sending ? "Sending..." : "Go Live"}
                  </button>
                </div>
                <button
                  type="button"
                  className="dock-btn dock-btn--danger dock-console-action-row__clear"
                  onClick={handleClearLyrics}
                  disabled={activeSectionIndex === null}
                >
                  <Icon name="clear" size={16} />
                  Clear
                </button>
              </div>

              <div className="dock-worship-deck__utility">
                <div className="dock-worship-deck__utility-row">
                  <div className="dock-console-control">
                    <div className="dock-section-label" style={{ marginTop: 0 }}>Overlay Mode</div>
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
                  </div>

                  <div className="dock-console-control dock-console-control--compact">
                    <div className="dock-section-label" style={{ marginTop: 0 }}>Lines</div>
                    <div className="dock-console-segmented dock-console-segmented--compact dock-console-segmented--grid-3">
                      {LINES_PER_SLIDE_OPTIONS.map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={`dock-console-segmented__item${linesPerSlide === count ? " dock-console-segmented__item--active" : ""}`}
                          onClick={() => setLinesPerSlide(count)}
                        >
                          {count}
                        </button>
                      ))}
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

                {overlayMode === "fullscreen" && (
                  <div className="dock-console-control">
                    <div className="dock-section-label" style={{ marginTop: 0 }}>Background</div>
                    <div className="dock-background-presets">
                      {DOCK_BACKGROUND_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`dock-background-preset${backgroundPreset === preset.id ? " dock-background-preset--active" : ""}`}
                          onClick={() => setBackgroundPreset(preset.id)}
                        >
                          <span
                            className="dock-background-preset__swatch"
                            style={dockBackgroundPresetPreviewStyle(selectedFSTheme.settings, preset.id)}
                          />
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
