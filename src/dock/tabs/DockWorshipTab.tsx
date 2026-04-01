/**
 * DockWorshipTab.tsx — Worship tab for the OBS Browser Dock
 *
 * Two views:
 *   1. Song List — shows saved songs with search
 *   2. Lyric Controller — shows song sections (verse/chorus/bridge)
 *      with live/preview indicators and send controls
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { DockStagedItem, DockWorshipSection } from "../dockTypes";
import { dockObsClient } from "../dockObsClient";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import type { BibleTheme } from "../../bible/types";
import { dockClient } from "../../services/dockBridge";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import { generateSlides } from "../../worship/slideEngine";
import Icon from "../DockIcon";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  productionDefaults: DockProductionModuleSettings;
}

type OverlayMode = "fullscreen" | "lower-third";

/** Minimal song type for the dock (imported from worshipDb dynamically) */
interface DockSong {
  id: string;
  title: string;
  artist: string;
  sections: DockWorshipSection[];
}

function parseLyricSections(lyrics: string): DockWorshipSection[] {
  if (!lyrics.trim()) return [];
  return generateSlides(lyrics, 2, false).map((slide) => ({
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

export default function DockWorshipTab({ staged, onStage, productionDefaults }: Props) {
  const [songs, setSongs] = useState<DockSong[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSong, setSelectedSong] = useState<DockSong | null>(null);
  const [liveIdx, setLiveIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [selectedFSTheme, setSelectedFSTheme] = useState<BibleTheme>(
    productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0],
  );
  const [selectedLTTheme, setSelectedLTTheme] = useState<BibleTheme>(
    productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0],
  );
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(productionDefaults.defaultMode);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgramLive =
    staged?.type === "worship" &&
    Boolean((staged.data as Record<string, unknown> | undefined)?._dockLive);

  useEffect(() => {
    setSelectedFSTheme(productionDefaults.fullscreenTheme ?? BUILTIN_THEMES[0]);
    setSelectedLTTheme(productionDefaults.lowerThirdTheme ?? BUILTIN_THEMES[0]);
    setOverlayMode(productionDefaults.defaultMode);
  }, [
    productionDefaults.defaultMode,
    productionDefaults.fullscreenTheme,
    productionDefaults.lowerThirdTheme,
  ]);

  // ── Song loading logic (reusable so we can refresh) ──
  const mapSongs = useCallback(
    (all: Array<{ id: string; metadata: { title: string; artist?: string }; lyrics?: string }>): DockSong[] =>
      all.map((s) => ({
        id: s.id,
        title: s.metadata.title,
        artist: s.metadata.artist || "",
        sections: parseLyricSections(s.lyrics || ""),
      })),
    []
  );

  const loadSongs = useCallback(async () => {
    console.log("[DockWorshipTab] Loading songs...");

    // Strategy 1: try IndexedDB (works when dock runs in same Tauri webview)
    try {
      const { getAllSongs } = await import("../../worship/worshipDb");
      const all = await getAllSongs();
      console.log("[DockWorshipTab] IndexedDB returned", all.length, "songs");
      if (all.length > 0) {
        setSongs(mapSongs(all));
        return;
      }
    } catch (err) {
      console.log("[DockWorshipTab] IndexedDB not available:", err);
    }

    // Strategy 2: fetch from overlay server (works when dock runs in OBS CEF)
    try {
      const res = await fetch("/uploads/dock-worship-songs.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = await res.json();
      console.log("[DockWorshipTab] JSON fetch returned", Array.isArray(all) ? all.length : 0, "songs");
      if (Array.isArray(all) && all.length > 0) {
        setSongs(mapSongs(all));
        return;
      }
    } catch (err) {
      console.log("[DockWorshipTab] JSON fetch failed:", err);
    }

    console.warn("[DockWorshipTab] No songs found from any source");
  }, [mapSongs]);

  // Load songs on mount
  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  // Listen for library-updated signal to refresh songs
  useEffect(() => {
    const unsub = dockClient.onState((msg) => {
      if (msg.type === "state:library-updated" || msg.type === "state:songs-data") {
        loadSongs();
      }
    });
    return unsub;
  }, [loadSongs]);

  const filteredSongs = searchQuery.trim()
    ? songs.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.artist.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : songs;

  const handleSelectSong = useCallback((song: DockSong) => {
    setSelectedSong(song);
    setLiveIdx(null);
    setPreviewIdx(null);
  }, []);

  const buildSectionStage = useCallback((idx: number, live: boolean) => {
    if (!selectedSong) return null;
    const section = selectedSong.sections[idx];
    if (!section) return null;
    const displayLabel = cleanWorshipSectionLabel(section.label);
      const stageData = {
        song: selectedSong,
        sectionIdx: idx,
        artist: "",
        sectionLabel: displayLabel,
        sectionText: section.text,
        overlayMode,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? selectedFSTheme.settings
            : selectedLTTheme.settings
        ),
        ...(live ? { isLive: true } : {}),
      };

    return {
      stageItem: {
        type: "worship" as const,
        label: live
          ? (displayLabel ? `${displayLabel} (LIVE)` : `${selectedSong.title} (LIVE)`)
          : (displayLabel || selectedSong.title),
        subtitle: selectedSong.title,
        data: stageData,
      },
      obsData: {
        sectionText: section.text,
        sectionLabel: displayLabel,
        songTitle: selectedSong.title,
        artist: "",
        overlayMode,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? selectedFSTheme.settings
            : selectedLTTheme.settings
        ) as unknown as Record<string, unknown>,
      },
    };
  }, [selectedSong, selectedLTTheme, selectedFSTheme, overlayMode]);

  const pushSection = useCallback(async (idx: number, live: boolean) => {
    const payload = buildSectionStage(idx, live);
    if (!payload) return;

    if (live) {
      setLiveIdx(idx);
      setPreviewIdx(null);
    } else {
      setPreviewIdx(idx);
    }

    onStage(payload.stageItem);

    if (!dockObsClient.isConnected) return;

    try {
      await dockObsClient.pushWorshipLyrics(payload.obsData, live);
    } catch (err) {
      console.warn(`[DockWorshipTab] ${live ? "Go live" : "Send preview"} failed:`, err);
    }
  }, [buildSectionStage, onStage]);

  useEffect(() => {
    if (!staged || staged.type !== "worship") {
      return;
    }

    const data = staged.data as Record<string, unknown>;
    const stageSong = data.song as DockSong | undefined;
    const stageIdx = typeof data.sectionIdx === "number" ? data.sectionIdx : null;

    if (stageSong && (!selectedSong || selectedSong.id !== stageSong.id)) {
      setSelectedSong(stageSong);
    }

    if (stageIdx === null) return;

    if (data._dockLive) {
      setLiveIdx(stageIdx);
      setPreviewIdx(null);
    } else {
      setPreviewIdx(stageIdx);
    }
  }, [selectedSong, staged]);

  const handleSectionClick = useCallback((idx: number) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void pushSection(idx, isProgramLive);
    }, 220);
  }, [isProgramLive, pushSection]);

  const handleGoLiveSection = useCallback((idx: number) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void pushSection(idx, true);
  }, [pushSection]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const navigateSection = useCallback(
    async (delta: 1 | -1) => {
      if (!selectedSong || selectedSong.sections.length === 0) return;

      const currentIdx = (isProgramLive ? liveIdx : previewIdx) ?? (liveIdx ?? previewIdx ?? 0);
      const nextIdx = Math.max(0, Math.min(selectedSong.sections.length - 1, currentIdx + delta));
      if (nextIdx === currentIdx) return;

      await pushSection(nextIdx, isProgramLive);
    },
    [isProgramLive, liveIdx, previewIdx, pushSection, selectedSong],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectedSong || selectedSong.sections.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        void navigateSection(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateSection(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateSection, selectedSong]);

  const handleClearLyrics = useCallback(() => {
    setLiveIdx(null);
    setPreviewIdx(null);
    onStage(null);
    // Also clear the OBS overlay source directly
    if (dockObsClient.isConnected) {
      dockObsClient.clearWorshipLyrics().catch((err) =>
        console.warn("[DockWorshipTab] clearWorshipLyrics failed:", err)
      );
    }
  }, [onStage]);

  // ── Re-stage current section when overlay mode changes ──
  const prevOverlayMode = useRef(overlayMode);
  useEffect(() => {
    if (prevOverlayMode.current === overlayMode) return;   // skip mount
    prevOverlayMode.current = overlayMode;

    const idx = previewIdx ?? liveIdx;
    if (!selectedSong || idx === null) return;
    const section = selectedSong.sections[idx];
    if (!section) return;
    const displayLabel = cleanWorshipSectionLabel(section.label);

    onStage({
      type: "worship",
      label: previewIdx !== null
        ? (displayLabel || selectedSong.title)
        : (displayLabel ? `${displayLabel} (LIVE)` : `${selectedSong.title} (LIVE)`),
      subtitle: selectedSong.title,
      data: {
        song: selectedSong,
        sectionIdx: idx,
        artist: "",
        sectionLabel: displayLabel,
        sectionText: section.text,
        overlayMode,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? selectedFSTheme.settings
            : selectedLTTheme.settings
        ),
        ...(liveIdx !== null && previewIdx === null ? { isLive: true } : {}),
      },
    });
    if (isProgramLive) {
      void dockObsClient.pushWorshipLyrics({
        sectionText: section.text,
        sectionLabel: displayLabel,
        songTitle: selectedSong.title,
        artist: "",
        overlayMode,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? selectedFSTheme.settings
            : selectedLTTheme.settings
        ) as unknown as Record<string, unknown>,
      }, true).catch((err) => {
        console.warn("[DockWorshipTab] Auto-update program failed:", err);
      });
    }
  }, [overlayMode, selectedSong, previewIdx, liveIdx, selectedLTTheme, selectedFSTheme, onStage, isProgramLive]);

  const prevThemeSignature = useRef(`${selectedFSTheme.id}:${selectedLTTheme.id}`);
  useEffect(() => {
    const nextSignature = `${selectedFSTheme.id}:${selectedLTTheme.id}`;
    if (prevThemeSignature.current === nextSignature) return;
    prevThemeSignature.current = nextSignature;

    const idx = previewIdx ?? liveIdx;
    if (!selectedSong || idx === null) return;
    const section = selectedSong.sections[idx];
    if (!section) return;
    const displayLabel = cleanWorshipSectionLabel(section.label);

    onStage({
      type: "worship",
      label: previewIdx !== null
        ? (displayLabel || selectedSong.title)
        : (displayLabel ? `${displayLabel} (LIVE)` : `${selectedSong.title} (LIVE)`),
      subtitle: selectedSong.title,
      data: {
        song: selectedSong,
        sectionIdx: idx,
        artist: "",
        sectionLabel: displayLabel,
        sectionText: section.text,
        overlayMode,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? selectedFSTheme.settings
            : selectedLTTheme.settings
        ),
        ...(liveIdx !== null && previewIdx === null ? { isLive: true } : {}),
      },
    });
    if (isProgramLive) {
      void dockObsClient.pushWorshipLyrics({
        sectionText: section.text,
        sectionLabel: displayLabel,
        songTitle: selectedSong.title,
        artist: "",
        overlayMode,
        bibleThemeSettings: (
          overlayMode === "fullscreen"
            ? selectedFSTheme.settings
            : selectedLTTheme.settings
        ) as unknown as Record<string, unknown>,
      }, true).catch((err) => {
        console.warn("[DockWorshipTab] Auto-update program failed:", err);
      });
    }
  }, [liveIdx, onStage, overlayMode, previewIdx, selectedFSTheme, selectedLTTheme, selectedSong, isProgramLive]);

  const handleBackToSongList = useCallback(() => {
    setSelectedSong(null);
    setLiveIdx(null);
    setPreviewIdx(null);
  }, []);

  // ── Song list view ──
  if (!selectedSong) {
    return (
      <>
        <div className="dock-search">
          <Icon name="search" size={20} />
          <input
            className="dock-input"
            placeholder="Search songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {filteredSongs.length === 0 && (
          <div className="dock-empty">
            <Icon name="music_off" size={20} />
            <div className="dock-empty__title">
              {songs.length === 0 ? "No Songs" : "No Results"}
            </div>
            <div className="dock-empty__text">
              {songs.length === 0
                ? "Add songs in the app's Song Library."
                : `No songs match "${searchQuery}"`}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="dock-section-label" style={{ margin: 0 }}>Songs ({filteredSongs.length})</div>
          <button
            className="dock-btn"
            style={{ padding: "2px 6px", fontSize: 11, minWidth: 0 }}
            onClick={loadSongs}
            title="Refresh song list"
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
        {filteredSongs.map((song) => (
          <div
            key={song.id}
            className="dock-card"
            onClick={() => handleSelectSong(song)}
          >
            <div className="dock-card__title">{song.title}</div>
            {song.artist && <div className="dock-card__subtitle">{song.artist}</div>}
          </div>
        ))}
      </>
    );
  }

  // ── Lyric controller view ──
  return (
    <>
      {/* Back button */}
      <div className="dock-breadcrumb">
        <button className="dock-breadcrumb-btn" onClick={handleBackToSongList}>
          <Icon name="arrow_back" size={20} />
          Songs
        </button>
        <span className="dock-breadcrumb-sep">›</span>
        <span className="dock-breadcrumb-current">{selectedSong.title}</span>
      </div>

      {/* Overlay mode toggle */}
      <div className="dock-section-label" style={{ marginTop: 4 }}>Overlay Mode</div>
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

      <div className="dock-section-label" style={{ marginTop: 10 }}>Theme Default</div>
      <div className="dock-card" style={{ cursor: "default" }}>
        <div className="dock-card__title">
          {overlayMode === "fullscreen" ? selectedFSTheme.name : selectedLTTheme.name}
        </div>
        <div className="dock-card__subtitle">
          Managed in the app&apos;s Production Theme Settings page.
        </div>
      </div>

      <div className="dock-row" style={{ justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <button
          className="dock-btn"
          style={{ padding: "4px 8px", minWidth: 0 }}
          onClick={() => void navigateSection(-1)}
          title="Previous section"
          disabled={selectedSong.sections.length === 0}
        >
          <Icon name="arrow_back" size={14} />
        </button>
        <button
          className="dock-btn"
          style={{ padding: "4px 8px", minWidth: 0 }}
          onClick={() => void navigateSection(1)}
          title="Next section"
          disabled={selectedSong.sections.length === 0}
        >
          <Icon name="chevron_right" size={14} />
        </button>
      </div>

      {/* Song sections */}
      <div className="dock-section-label">Lyrics</div>

      {selectedSong.sections.length === 0 && (
        <div className="dock-empty" style={{ padding: 16 }}>
          <Icon name="lyrics" size={20} />
          <div className="dock-empty__text">
            This song has no lyrics sections.
          </div>
        </div>
      )}

      {selectedSong.sections.map((section, idx) => {
        const displayLabel = cleanWorshipSectionLabel(section.label);
        return (
          <div
            key={section.id}
            className={`dock-lyric-card${
              liveIdx === idx
                ? " dock-lyric-card--live"
                : previewIdx === idx
                  ? " dock-lyric-card--preview"
                  : ""
            }`}
            onClick={() => handleSectionClick(idx)}
            onDoubleClick={() => handleGoLiveSection(idx)}
          >
            <div className="dock-lyric-card__header">
              {displayLabel ? <span className="dock-lyric-card__label">{displayLabel}</span> : <span />}
              {liveIdx === idx && (
                <span className="dock-lyric-badge dock-lyric-badge--live">
                  <Icon name="fiber_manual_record" size={8} />
                  Live
                </span>
              )}
              {previewIdx === idx && liveIdx !== idx && (
                <span className="dock-lyric-badge dock-lyric-badge--preview">Preview</span>
              )}
            </div>
            <div className="dock-lyric-card__text">{section.text}</div>
          </div>
        );
      })}

      {/* Clear lyrics button */}
      <div className="dock-spacer" />
      <button
        className="dock-btn dock-btn--danger"
        style={{ width: "100%" }}
        onClick={handleClearLyrics}
        disabled={liveIdx === null && previewIdx === null}
      >
        <Icon name="clear" size={20} />
        Clear Lyrics
      </button>
    </>
  );
}
