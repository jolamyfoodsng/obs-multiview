/**
 * WorshipHome.tsx — Worship Module main page
 *
 * Two views:
 *   1. Dashboard — Song library sidebar, slide editor centre, live preview right
 *   2. Import Wizard — Paste lyrics → auto-split into slides → save to library
 *
 * Features:
 *   - Songs persisted to IndexedDB
 *   - Send to OBS via double-click or button
 *   - Theme selector with built-in themes
 *   - Prev / Next / Blackout / Clear controls
 *   - Quick Edit mode for live lyrics editing
 *   - Keyboard shortcuts (← → B C)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateSlides } from "../../worship/slideEngine";
import { archiveSong, getAllSongs, saveSong, syncSongsToDock } from "../../worship/worshipDb";
import { worshipObsService } from "../../worship/worshipObsService";
import { lowerThirdObsService } from "../../lowerthirds/lowerThirdObsService";
import { dockObsClient } from "../../dock/dockObsClient";
import { ensureDockObsClientConnected } from "../../services/dockObsInterop";
import { isUserSelectableObsScene, normalizeDockStageBaseScene } from "../../services/dockSceneNames";
import { obsService } from "../../services/obsService";
import { serviceStore } from "../../services/serviceStore";
import {
  FAVORITE_THEMES_UPDATED_EVENT,
  getBibleFavorites,
  hydrateFavoriteThemes,
  toggleBibleFavorite,
  getWorshipLTFavorites,
  toggleWorshipLTFavorite,
  sortWithFavorites,
} from "../../services/favoriteThemes";
import { useServiceGate } from "../../hooks/useServiceGate";
import { ObsScenesPanel } from "../shared/ObsScenesPanel";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { getCustomThemes } from "../../bible/bibleDb";
import { DEFAULT_THEME_SETTINGS, type BibleTemplateType, type BibleTheme, type BibleThemeSettings } from "../../bible/types";
import { LT_WORSHIP_THEMES } from "../../lowerthirds/themes";
import type { LowerThirdTheme, LTCustomStyle } from "../../lowerthirds/types";
import type { Song, SongMetadata, SplitConfig, Slide } from "../../worship/types";
import "../../worship/worship.css";
import Icon from "../Icon";

const WORSHIP_THEME_KEYWORDS = ["worship", "prayer", "lyric", "lyrics", "song", "hymn", "choir"];

function isWorshipPrayerTheme(theme: LowerThirdTheme): boolean {
  if (String(theme.id).startsWith("lt-img-")) return false;
  const haystack = `${theme.id} ${theme.name} ${theme.description ?? ""} ${(theme.tags ?? []).join(" ")}`.toLowerCase();
  if (haystack.includes("sermon")) return false;
  return WORSHIP_THEME_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

const WORSHIP_LOWER_THIRD_THEMES: LowerThirdTheme[] = (
  LT_WORSHIP_THEMES.filter(isWorshipPrayerTheme)
);

const WORSHIP_THEME_OPTIONS: LowerThirdTheme[] = (
  WORSHIP_LOWER_THIRD_THEMES.length > 0 ? WORSHIP_LOWER_THIRD_THEMES : LT_WORSHIP_THEMES
);

function isGenericVerseLabel(label: string): boolean {
  return /^verse\s+\d+$/i.test(label.trim());
}

function normalizeWorshipObsLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed && !isGenericVerseLabel(trimmed) ? trimmed : "";
}

const DEFAULT_WORSHIP_THEME_ID = WORSHIP_THEME_OPTIONS[0]?.id ?? "";
const WORSHIP_FULLSCREEN_THEME_FALLBACKS: BibleTheme[] = BUILTIN_THEMES.filter(
  (theme) => theme.templateType === "fullscreen",
);

// ---------------------------------------------------------------------------
// Default song seeded on first launch
// ---------------------------------------------------------------------------
const DEFAULT_SONG: Song = {
  id: "default-amazing-grace",
  metadata: { title: "Amazing Grace", artist: "John Newton" },
  lyrics: `Amazing grace! How sweet the sound
That saved a wretch like me!
I once was lost, but now am found;
Was blind, but now I see.

\u2018Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed.

The Lord has promised good to me,
His word my hope secures;
He will my shield and portion be,
As long as life endures.`,
  slides: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export interface WorshipModuleProps {
  isActive?: boolean;
  homePath?: string;
  /** Deep-link: auto-select this song when set */
  initialSelectSongId?: string | null;
  /** Called after the deep-link selection has been consumed */
  onConsumeInitialSelect?: () => void;
}

export function WorshipModule({
  isActive = true,
  initialSelectSongId,
  onConsumeInitialSelect,
}: WorshipModuleProps) {
  const [view, setView] = useState<"dashboard" | "import">("dashboard");

  // ── Song library state ──
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string>("");
  const [sidebarTab, setSidebarTab] = useState<"songs" | "setlist" | "history">("songs");
  const [songSearch, setSongSearch] = useState("");
  const [songsLoaded, setSongsLoaded] = useState(false);
  const [confirmDeleteSong, setConfirmDeleteSong] = useState<Song | null>(null);

  // ── Theme state ──
  const [themes, setThemes] = useState<BibleTheme[]>(WORSHIP_FULLSCREEN_THEME_FALLBACKS);
  const [layoutMode, setLayoutMode] = useState<BibleTemplateType>("fullscreen");
  const [activeThemeId, setActiveThemeId] = useState(WORSHIP_FULLSCREEN_THEME_FALLBACKS[0]?.id ?? "classic-dark");
  const [themeOpen, setThemeOpen] = useState(false);
  const [activeWorshipLowerThirdId, setActiveWorshipLowerThirdId] = useState(DEFAULT_WORSHIP_THEME_ID);
  const [worshipThemeOpen, setWorshipThemeOpen] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#4ADE80");
  const [lowerThirdBusy, setLowerThirdBusy] = useState(false);

  // ── Favorite themes ──
  const [bibleFavs, setBibleFavs] = useState<Set<string>>(() => getBibleFavorites());
  const [worshipLTFavs, setWorshipLTFavs] = useState<Set<string>>(() => getWorshipLTFavorites());

  useEffect(() => {
    let cancelled = false;

    const syncFavorites = () => {
      if (cancelled) return;
      setBibleFavs(new Set(getBibleFavorites()));
      setWorshipLTFavs(new Set(getWorshipLTFavorites()));
    };

    const handleFavoritesUpdated = () => {
      syncFavorites();
    };

    window.addEventListener(FAVORITE_THEMES_UPDATED_EVENT, handleFavoritesUpdated);
    hydrateFavoriteThemes().then(syncFavorites).catch(() => { });

    return () => {
      cancelled = true;
      window.removeEventListener(FAVORITE_THEMES_UPDATED_EVENT, handleFavoritesUpdated);
    };
  }, []);

  const handleToggleBibleFav = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = toggleBibleFavorite(id);
    setBibleFavs(new Set(updated));
  }, []);

  const handleToggleWorshipLTFav = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = toggleWorshipLTFavorite(id);
    setWorshipLTFavs(new Set(updated));
  }, []);

  const sortedThemes = useMemo(() => sortWithFavorites(themes, bibleFavs), [themes, bibleFavs]);
  const sortedWorshipLTThemes = useMemo(
    () => sortWithFavorites(WORSHIP_THEME_OPTIONS, worshipLTFavs),
    [worshipLTFavs],
  );
  const baseTheme: BibleThemeSettings = useMemo(
    () => themes.find((t) => t.id === activeThemeId)?.settings ?? themes[0]?.settings ?? DEFAULT_THEME_SETTINGS,
    [themes, activeThemeId]
  );
  const activeTheme: BibleThemeSettings = useMemo(() => baseTheme, [baseTheme]);
  const activeWorshipLowerThird = useMemo(
    () => WORSHIP_THEME_OPTIONS.find((t) => t.id === activeWorshipLowerThirdId) ?? WORSHIP_THEME_OPTIONS[0] ?? null,
    [activeWorshipLowerThirdId]
  );

  // ── Live state ──
  const [liveSlideIndex, setLiveSlideIndex] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [isBlanked, setIsBlanked] = useState(false);
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const [ltScenes, setLtScenes] = useState<{ sceneName: string; sceneIndex: number }[]>([]);
  const [ltPreviewScene, setLtPreviewScene] = useState("");
  const [ltProgramScene, setLtProgramScene] = useState("");
  const [fullLiveScenes, setFullLiveScenes] = useState<string[]>([]);
  const [ltLiveScenes, setLtLiveScenes] = useState<string[]>([]);
  const [ltScenesRefreshing, setLtScenesRefreshing] = useState(false);
  const ltScenePollBusyRef = useRef(false);

  // ── Quick Edit state ──
  const [editingSlideIdx, setEditingSlideIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  // ── Import wizard state ──
  const [importLyrics, setImportLyrics] = useState("");
  const [importMetadata, setImportMetadata] = useState<SongMetadata>({ title: "", artist: "" });
  const [splitConfig, setSplitConfig] = useState<SplitConfig>({ linesPerSlide: 2, identifyChorus: true });

  // ── Refs ──
  const slideListRef = useRef<HTMLDivElement>(null);

  // ── Service gate (no-op — service gate concept removed) ──
  const { checkServiceActive } = useServiceGate();

  // ── Load songs from DB on mount ──
  useEffect(() => {
    (async () => {
      let dbSongs = await getAllSongs();
      if (dbSongs.length === 0) {
        await saveSong(DEFAULT_SONG);
        dbSongs = [DEFAULT_SONG];
      }
      setSongs(dbSongs);
      setSelectedSongId(dbSongs[0].id);
      setSongsLoaded(true);
      // Sync songs to dock (fire-and-forget)
      syncSongsToDock().catch(() => { });
    })();
  }, []);

  // Deep-link: select a specific song when triggered from global search
  useEffect(() => {
    if (initialSelectSongId && songsLoaded) {
      setSelectedSongId(initialSelectSongId);
      onConsumeInitialSelect?.();
    }
  }, [initialSelectSongId, songsLoaded, onConsumeInitialSelect]);

  // Load fullscreen Bible/Worship OBS themes (built-in + custom from theme DB)
  const loadFullscreenThemes = useCallback(async () => {
    try {
      const customThemes = await getCustomThemes();
      const mergedById = new Map<string, BibleTheme>();
      for (const theme of WORSHIP_FULLSCREEN_THEME_FALLBACKS) {
        mergedById.set(theme.id, theme);
      }
      for (const theme of customThemes) {
        if (theme.templateType !== "fullscreen") continue;
        mergedById.set(theme.id, theme);
      }
      const merged = Array.from(mergedById.values());
      setThemes(merged.length > 0 ? merged : WORSHIP_FULLSCREEN_THEME_FALLBACKS);
    } catch (error) {
      console.warn("[Worship] Failed to load custom themes:", error);
      setThemes(WORSHIP_FULLSCREEN_THEME_FALLBACKS);
    }
  }, []);

  useEffect(() => {
    void loadFullscreenThemes();
  }, [loadFullscreenThemes]);

  useEffect(() => {
    const refresh = () => {
      void loadFullscreenThemes();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("obs-themes-updated", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("obs-themes-updated", refresh);
    };
  }, [loadFullscreenThemes]);

  useEffect(() => {
    if (themes.some((theme) => theme.id === activeThemeId)) return;
    setActiveThemeId(themes[0]?.id ?? "classic-dark");
  }, [themes, activeThemeId]);

  // ── OBS connection listener ──
  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setObsConnected(s === "connected"));
    return unsub;
  }, []);

  useEffect(() => {
    const cssPrimary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    if (cssPrimary) setPrimaryColor(cssPrimary);
  }, []);

  useEffect(() => {
    if (activeWorshipLowerThird) return;
    if (!DEFAULT_WORSHIP_THEME_ID) return;
    setActiveWorshipLowerThirdId(DEFAULT_WORSHIP_THEME_ID);
  }, [activeWorshipLowerThird]);

  const loadLtScenes = useCallback(async () => {
    if (!obsService.isConnected) {
      setLtScenes([]);
      setLtPreviewScene("");
      setLtProgramScene("");
      return;
    }
    try {
      const scenes = await obsService.getSceneList();
      const visibleScenes = scenes.filter((scene) => isUserSelectableObsScene(scene.sceneName));
      const names = visibleScenes.map((scene) => scene.sceneName);
      setLtScenes(visibleScenes.map((scene) => ({ sceneName: scene.sceneName, sceneIndex: scene.sceneIndex })));
      setFullLiveScenes((prev) => prev.filter((sceneName) => names.includes(sceneName)));
      setLtLiveScenes((prev) => prev.filter((sceneName) => names.includes(sceneName)));
      const program = await obsService.getCurrentProgramScene();
      const normalizedProgram = normalizeDockStageBaseScene(program);
      setLtProgramScene(
        names.includes(program)
          ? program
          : (names.includes(normalizedProgram) ? normalizedProgram : ""),
      );
      try {
        const preview = await obsService.getCurrentPreviewScene();
        const normalizedPreview = normalizeDockStageBaseScene(preview);
        setLtPreviewScene(
          names.includes(preview)
            ? preview
            : (names.includes(normalizedPreview) ? normalizedPreview : ""),
        );
      } catch {
        setLtPreviewScene("");
      }
    } catch (err) {
      console.warn("[Worship] Failed to fetch OBS scenes:", err);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;

    if (!obsConnected) {
      setLtScenes([]);
      setLtPreviewScene("");
      setLtProgramScene("");
      setFullLiveScenes([]);
      setLtLiveScenes([]);
      return;
    }
    const poll = async () => {
      if (ltScenePollBusyRef.current) return;
      ltScenePollBusyRef.current = true;
      try {
        await loadLtScenes();
      } finally {
        ltScenePollBusyRef.current = false;
      }
    };
    poll();
    const iv = window.setInterval(poll, 500);
    return () => window.clearInterval(iv);
  }, [isActive, obsConnected, loadLtScenes]);

  // ── Selected song + slides ──
  const selectedSong = useMemo(
    () => songs.find((s) => s.id === selectedSongId) ?? songs[0],
    [songs, selectedSongId]
  );

  const songSlides: Slide[] = useMemo(
    () => (selectedSong ? generateSlides(selectedSong.lyrics, 2, false) : []),
    [selectedSong]
  );

  // Import preview slides
  const importSlides = useMemo(
    () => generateSlides(importLyrics, splitConfig.linesPerSlide, splitConfig.identifyChorus),
    [importLyrics, splitConfig]
  );

  const filteredSongs = useMemo(() => {
    if (!songSearch.trim()) return songs;
    const q = songSearch.toLowerCase();
    return songs.filter(
      (s) => s.metadata.title.toLowerCase().includes(q) || s.metadata.artist.toLowerCase().includes(q)
    );
  }, [songs, songSearch]);

  const worshipCustomStyles = useMemo<LTCustomStyle>(() => ({
    bgColor: "",
    textColor: "",
    accentColor: primaryColor,
    bgImage: "",
    bgImageOpacity: 0.3,
    heightPx: 0,
    logoScale: 1.2,
  }), [primaryColor]);

  // ── Reload songs helper ──
  const reloadSongs = useCallback(async () => {
    const dbSongs = await getAllSongs();
    setSongs(dbSongs);
    return dbSongs;
  }, []);

  // ── Push currently-selected slide with a specific theme ──
  const pushLiveSlideWithTheme = useCallback(async (theme: BibleThemeSettings) => {
    if (!isLive || isBlanked) return;
    const slide = songSlides[liveSlideIndex];
    if (!slide) return;
    await worshipObsService.pushSlide(
      slide.content,
      "",
      theme,
      true,
      false
    );
  }, [isLive, isBlanked, songSlides, liveSlideIndex, selectedSong]);

  const buildWorshipLowerThirdValues = useCallback((theme: LowerThirdTheme): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const v of theme.variables) values[v.key] = v.defaultValue;

    const slideText = (songSlides[liveSlideIndex]?.content ?? "").trim();
    const lines = slideText
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const line1 = lines[0] ?? (slideText || "Worship");
    const line2 = lines.slice(1).join(" ").trim();
    const sectionLabel = normalizeWorshipObsLabel(songSlides[liveSlideIndex]?.label ?? "");
    const songInfo = sectionLabel || "";
    const quote = slideText || line1;
    const subtitle = line2 || "Worship";
    const meta = songInfo || "Worship";
    const details = line2 || "Worship Service";
    const reference = sectionLabel;

    const setIfPresent = (key: string, value: string) => {
      if (key in values && value) values[key] = value;
    };

    setIfPresent("line1", line1);
    setIfPresent("line2", line2 || line1);
    setIfPresent("lyrics", slideText || line1);
    setIfPresent("songName", line1);
    if ("artist" in values) values.artist = "";
    setIfPresent("songInfo", songInfo || line2 || line1);
    setIfPresent("title", line1);
    setIfPresent("subtitle", subtitle);
    setIfPresent("text", slideText || line1);
    setIfPresent("verseText", slideText || line1);
    setIfPresent("headline", line1);
    setIfPresent("details", details);
    setIfPresent("name", line1);
    setIfPresent("quote", quote);
    if ("reference" in values) values.reference = reference;
    setIfPresent("song", line1);
    setIfPresent("meta", meta);
    if ("role" in values) values.role = sectionLabel;
    if ("label" in values) values.label = sectionLabel;

    if ("state" in values && !values.state.trim()) {
      values.state = "live";
    }
    if ("animMode" in values && !values.animMode.trim()) {
      values.animMode = "stagger";
    }

    return values;
  }, [songSlides, liveSlideIndex, selectedSong]);

  // ── Push current slide to OBS ──
  const getDefaultLtScenes = useCallback((): string[] => {
    if (ltLiveScenes.length > 0) return ltLiveScenes;
    const names = ltScenes.map((scene) => scene.sceneName);
    if (names.length === 0) return [];
    const mainScene = serviceStore.sceneMapping.mainScene;
    const preferred = mainScene && names.includes(mainScene) ? mainScene : names[0];
    return preferred ? [preferred] : [];
  }, [ltLiveScenes, ltScenes]);

  const getDefaultFullScenes = useCallback((): string[] => {
    if (fullLiveScenes.length > 0) return fullLiveScenes;
    const names = ltScenes.map((scene) => scene.sceneName);
    if (names.length === 0) return [];
    const mainScene = serviceStore.sceneMapping.mainScene;
    const preferred = mainScene && names.includes(mainScene) ? mainScene : names[0];
    return preferred ? [preferred] : [];
  }, [fullLiveScenes, ltScenes]);

  const pushWorshipLowerThirdToScene = useCallback(async (sceneName: string, live: boolean, blanked: boolean) => {
    if (!activeWorshipLowerThird) return;
    const values = buildWorshipLowerThirdValues(activeWorshipLowerThird);
    await lowerThirdObsService.pushToScene(
      sceneName,
      activeWorshipLowerThird,
      values,
      live,
      blanked,
      "lg",
      worshipCustomStyles
    );
  }, [activeWorshipLowerThird, buildWorshipLowerThirdValues, worshipCustomStyles]);

  const resolveDockSendLive = useCallback(async (
    sceneName: string,
    mode: "scene" | "preview" | "program",
  ): Promise<boolean | null> => {
    if (mode === "program") return true;
    if (mode === "preview") return false;

    const [programScene, previewScene] = await Promise.all([
      obsService.getCurrentProgramScene().catch(() => ltProgramScene),
      obsService.getCurrentPreviewScene().catch(() => ltPreviewScene),
    ]);

    const normalizedProgramScene = normalizeDockStageBaseScene(programScene);
    const normalizedPreviewScene = normalizeDockStageBaseScene(previewScene);

    if (sceneName && (sceneName === programScene || sceneName === normalizedProgramScene)) return true;
    if (sceneName && (sceneName === previewScene || sceneName === normalizedPreviewScene)) return false;
    return null;
  }, [ltProgramScene, ltPreviewScene]);

  const pushCurrentWorshipViaDock = useCallback(async (live: boolean): Promise<void> => {
    const slide = songSlides[liveSlideIndex];
    const overlayMode = layoutMode === "lower-third" ? "lower-third" : "fullscreen";

    await ensureDockObsClientConnected();
    await dockObsClient.pushWorshipLyrics({
      sectionText: slide?.content ?? "",
      sectionLabel: normalizeWorshipObsLabel(slide?.label ?? ""),
      songTitle: selectedSong?.metadata.title ?? "",
      artist: selectedSong?.metadata.artist ?? "",
      overlayMode,
      ltTheme: overlayMode === "lower-third" && activeWorshipLowerThird
        ? { id: activeWorshipLowerThird.id, html: activeWorshipLowerThird.html, css: activeWorshipLowerThird.css }
        : undefined,
      bibleThemeSettings: overlayMode === "fullscreen"
        ? (activeTheme as unknown as Record<string, unknown>)
        : undefined,
    }, live);
  }, [
    songSlides,
    liveSlideIndex,
    selectedSong,
    layoutMode,
    activeWorshipLowerThird,
    activeTheme,
  ]);

  const handleSendWorshipFullToScene = useCallback(async (
    sceneName: string,
    mode: "scene" | "preview" | "program" = "scene",
  ) => {
    if (!obsConnected) return;
    if (!checkServiceActive("send worship full overlay to OBS")) return;
    const slide = songSlides[liveSlideIndex];
    const text = slide?.content ?? null;
    const ref = "";
    const wasLive = isLive;

    const dockLive = await resolveDockSendLive(sceneName, mode);
    if (dockLive !== null) {
      setLowerThirdBusy(true);
      try {
        setIsLive(true);
        setIsBlanked(false);
        await pushCurrentWorshipViaDock(dockLive);
        setFullLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
        if (!wasLive && (serviceStore.status === "live" || serviceStore.status === "preservice")) {
          serviceStore.trackSongPlayed();
        }
      } finally {
        setLowerThirdBusy(false);
      }
      return;
    }

    setLowerThirdBusy(true);
    try {
      await worshipObsService.ensureBrowserSource(sceneName);
      setIsLive(true);
      setIsBlanked(false);
      await worshipObsService.pushSlide(text, ref, activeTheme, true, false);
      setFullLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
      if (!wasLive && (serviceStore.status === "live" || serviceStore.status === "preservice")) {
        serviceStore.trackSongPlayed();
      }
    } finally {
      setLowerThirdBusy(false);
    }
  }, [obsConnected, checkServiceActive, songSlides, liveSlideIndex, selectedSong, isLive, activeTheme, resolveDockSendLive, pushCurrentWorshipViaDock]);

  const handleSendWorshipLowerThirdToScene = useCallback(async (
    sceneName: string,
    mode: "scene" | "preview" | "program" = "scene",
  ) => {
    if (!activeWorshipLowerThird || !obsConnected) return;
    if (!checkServiceActive("send worship lower-third to OBS")) return;
    const wasLive = isLive;

    const dockLive = await resolveDockSendLive(sceneName, mode);
    if (dockLive !== null) {
      setLowerThirdBusy(true);
      try {
        setIsLive(true);
        setIsBlanked(false);
        await pushCurrentWorshipViaDock(dockLive);
        setLtLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
        if (!wasLive && (serviceStore.status === "live" || serviceStore.status === "preservice")) {
          serviceStore.trackSongPlayed();
        }
      } finally {
        setLowerThirdBusy(false);
      }
      return;
    }

    setLowerThirdBusy(true);
    try {
      setIsLive(true);
      setIsBlanked(false);
      await pushWorshipLowerThirdToScene(sceneName, true, false);
      setLtLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
      if (!wasLive && (serviceStore.status === "live" || serviceStore.status === "preservice")) {
        serviceStore.trackSongPlayed();
      }
    } finally {
      setLowerThirdBusy(false);
    }
  }, [activeWorshipLowerThird, obsConnected, checkServiceActive, isLive, pushWorshipLowerThirdToScene, resolveDockSendLive, pushCurrentWorshipViaDock]);

  const pushToObs = useCallback(
    async (slideIdx: number, live: boolean, blanked: boolean) => {
      if (!obsConnected) return;
      const slide = songSlides[slideIdx];
      if (!slide && live) return;
      if (layoutMode === "fullscreen") {
        const text = blanked || !slide ? null : slide.content;
        const ref = "";
        const targetScenes = getDefaultFullScenes();
        if (targetScenes.length > 0) {
          setLowerThirdBusy(true);
          try {
            await Promise.all(targetScenes.map((sceneName) => worshipObsService.ensureBrowserSource(sceneName)));
            await worshipObsService.pushSlide(text, ref, activeTheme, live, blanked);
            if (live && !blanked) {
              setFullLiveScenes((prev) => Array.from(new Set([...prev, ...targetScenes])));
            }
          } finally {
            setLowerThirdBusy(false);
          }
        } else {
          await worshipObsService.pushSlide(text, ref, activeTheme, live, blanked);
        }
        return;
      }

      if (!activeWorshipLowerThird) return;
      const targetScenes = getDefaultLtScenes();
      if (targetScenes.length === 0) return;

      setLowerThirdBusy(true);
      try {
        await Promise.all(targetScenes.map((sceneName) => (
          pushWorshipLowerThirdToScene(sceneName, live && !blanked, blanked || !live)
        )));
        if (live && !blanked) {
          setLtLiveScenes((prev) => Array.from(new Set([...prev, ...targetScenes])));
        }
      } finally {
        setLowerThirdBusy(false);
      }
    },
    [
      obsConnected,
      songSlides,
      selectedSong,
      activeTheme,
      layoutMode,
      activeWorshipLowerThird,
      getDefaultFullScenes,
      getDefaultLtScenes,
      pushWorshipLowerThirdToScene,
    ]
  );

  // ── Send slide to OBS (go live) ──
  const sendSlideToObs = useCallback(
    async (idx: number) => {
      const action = layoutMode === "lower-third"
        ? "send worship lower-third to OBS"
        : "send worship lyrics to OBS";
      if (!checkServiceActive(action)) return;
      const wasLive = isLive;
      setLiveSlideIndex(idx);
      setIsLive(true);
      setIsBlanked(false);
      await pushToObs(idx, true, false);
      // Track song play when first going live with a song
      if (!wasLive && (serviceStore.status === "live" || serviceStore.status === "preservice")) {
        serviceStore.trackSongPlayed();
      }
    },
    [pushToObs, isLive, layoutMode, checkServiceActive]
  );

  // ── Controls ──
  const handlePrevSlide = useCallback(async () => {
    const next = Math.max(0, liveSlideIndex - 1);
    setLiveSlideIndex(next);
    if (isLive) await pushToObs(next, true, false);
  }, [liveSlideIndex, isLive, pushToObs]);

  const handleNextSlide = useCallback(async () => {
    const next = Math.min(songSlides.length - 1, liveSlideIndex + 1);
    setLiveSlideIndex(next);
    if (isLive) await pushToObs(next, true, false);
  }, [liveSlideIndex, songSlides.length, isLive, pushToObs]);

  const handleBlackout = useCallback(async () => {
    setIsBlanked(true);
    await pushToObs(liveSlideIndex, isLive, true);
  }, [liveSlideIndex, isLive, pushToObs]);

  const handleClear = useCallback(async () => {
    setIsLive(false);
    setIsBlanked(false);

    const fullTargets = fullLiveScenes.length > 0 ? fullLiveScenes : getDefaultFullScenes();
    await worshipObsService.clearOverlay(fullTargets.length > 0 ? fullTargets : undefined);
    setFullLiveScenes([]);

    if (layoutMode === "lower-third") {
      const targetScenes = getDefaultLtScenes();
      setLtLiveScenes([]);
      if (targetScenes.length === 0) return;
      setLowerThirdBusy(true);
      try {
        await Promise.all(targetScenes.map((sceneName) => (
          pushWorshipLowerThirdToScene(sceneName, false, true)
        )));
      } finally {
        setLowerThirdBusy(false);
      }
      return;
    }
  }, [
    layoutMode,
    fullLiveScenes,
    getDefaultFullScenes,
    getDefaultLtScenes,
    pushWorshipLowerThirdToScene,
  ]);

  // ── Theme change ──
  const handleThemeChange = useCallback(
    async (themeId: string) => {
      setActiveThemeId(themeId);
      setThemeOpen(false);
      const selectedTheme = themes.find((t) => t.id === themeId)?.settings ?? baseTheme;
      await pushLiveSlideWithTheme(selectedTheme);
    },
    [themes, baseTheme, pushLiveSlideWithTheme]
  );

  const handleLayoutClick = useCallback((mode: BibleTemplateType) => {
    if (mode === layoutMode) return;
    setLayoutMode(mode);
    setThemeOpen(false);
    setWorshipThemeOpen(false);
    if (mode === "lower-third") {
      loadLtScenes();
      if (!activeWorshipLowerThird && WORSHIP_THEME_OPTIONS.length > 0) {
        setActiveWorshipLowerThirdId(WORSHIP_THEME_OPTIONS[0].id);
      }
    }
  }, [layoutMode, loadLtScenes, activeWorshipLowerThird]);

  const handleRefreshLtScenes = useCallback(async () => {
    setLtScenesRefreshing(true);
    try {
      await loadLtScenes();
    } finally {
      setLtScenesRefreshing(false);
    }
  }, [loadLtScenes]);

  // ── Quick Edit ──
  const startEdit = useCallback(
    (idx: number) => {
      setEditingSlideIdx(idx);
      setEditText(songSlides[idx]?.content ?? "");
    },
    [songSlides]
  );

  const saveEdit = useCallback(async () => {
    if (editingSlideIdx === null || !selectedSong) return;
    const newSlides = songSlides.map((s, i) =>
      i === editingSlideIdx ? { ...s, content: editText } : s
    );
    const newLyrics = newSlides.map((s) => s.content).join("\n\n");
    const updated: Song = {
      ...selectedSong,
      lyrics: newLyrics,
      updatedAt: new Date().toISOString(),
    };
    await saveSong(updated);
    await reloadSongs();
    setEditingSlideIdx(null);
  }, [editingSlideIdx, editText, selectedSong, songSlides, reloadSongs]);

  // ── Archive song ──
  const handleArchiveSong = useCallback(
    async (id: string) => {
      await archiveSong(id);
      const updated = await reloadSongs();
      if (updated.length > 0) setSelectedSongId(updated[0].id);
      else setSelectedSongId("");
      setConfirmDeleteSong(null);
    },
    [reloadSongs]
  );

  // ── Save import ──
  const handleSaveImport = useCallback(async () => {
    if (!importMetadata.title.trim()) return;
    const newSong: Song = {
      id: `song-${Date.now()}`,
      metadata: { ...importMetadata },
      lyrics: importLyrics,
      slides: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveSong(newSong);
    await reloadSongs();
    setSelectedSongId(newSong.id);
    setView("dashboard");
    setImportLyrics("");
    setImportMetadata({ title: "", artist: "" });
  }, [importMetadata, importLyrics, reloadSongs]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (!isActive || view !== "dashboard") return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          handlePrevSlide();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleNextSlide();
          break;
        case "b":
        case "B":
          e.preventDefault();
          handleBlackout();
          break;
        case "c":
        case "C":
          e.preventDefault();
          handleClear();
          break;
        case "Enter":
          e.preventDefault();
          sendSlideToObs(liveSlideIndex);
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          const idx = parseInt(e.key, 10) - 1;
          if (layoutMode === "fullscreen" && themes[idx]) handleThemeChange(themes[idx].id);
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, view, layoutMode, handlePrevSlide, handleNextSlide, handleBlackout, handleClear, handleThemeChange, themes, sendSlideToObs, liveSlideIndex]);

  const themePreviewStyle = useMemo(() => (
    activeTheme.backgroundImage
      ? {
        backgroundImage: `url(${activeTheme.backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
      : { background: activeTheme.backgroundColor }
  ), [activeTheme.backgroundColor, activeTheme.backgroundImage]);

  const previewBackgroundStyle = useMemo(() => (
    activeTheme.backgroundImage
      ? {
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url(${activeTheme.backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
      : { backgroundColor: activeTheme.backgroundColor }
  ), [activeTheme.backgroundColor, activeTheme.backgroundImage]);

  const worshipLowerThemePreviewStyle = useMemo(() => {
    const accent = activeWorshipLowerThird?.accentColor || primaryColor;
    return {
      background: `linear-gradient(135deg, ${accent} 0%, #111827 100%)`,
    };
  }, [activeWorshipLowerThird?.accentColor, primaryColor]);

  const activeModeLiveScenes = layoutMode === "fullscreen" ? fullLiveScenes : ltLiveScenes;
  const modeSendLabel = layoutMode === "fullscreen" ? "Send Full" : "Send Lower";
  const showLiveSlideStrip = isLive && songSlides.length > 0;

  if (!songsLoaded) {
    return (
      <div className="worship-home" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--b-text-3)", fontSize: 14 }}>Loading worship library…</span>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // IMPORT WIZARD VIEW
  // ═══════════════════════════════════════════════════════
  if (view === "import") {
    return (
      <div className="worship-home">
        <div className="worship-import-header">
          <div className="worship-import-header-left">
            <h1 className="worship-import-title">Song Import Wizard</h1>
            <p className="worship-import-subtitle">Paste lyrics → preview slides → save</p>
          </div>
          <div className="worship-import-meta">
            <div className="worship-import-field">
              <label>Song Title</label>
              <input
                type="text"
                placeholder="Enter song title"
                value={importMetadata.title}
                onChange={(e) => setImportMetadata((m) => ({ ...m, title: e.target.value }))}
              />
            </div>
            <div className="worship-import-field">
              <label>Artist</label>
              <input
                type="text"
                placeholder="Enter artist name"
                value={importMetadata.artist}
                onChange={(e) => setImportMetadata((m) => ({ ...m, artist: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="worship-import-toolbar">
          <div className="worship-toolbar-group">
            <Icon name="splitscreen" size={20} />
            <div className="worship-toolbar-control">
              <span className="worship-toolbar-label">Lines per slide</span>
              <div className="worship-toolbar-slider">
                <span className="worship-toolbar-val">2</span>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="1"
                  value={splitConfig.linesPerSlide}
                  onChange={(e) =>
                    setSplitConfig((c) => ({ ...c, linesPerSlide: parseInt(e.target.value, 10) }))
                  }
                />
                <span className="worship-toolbar-val highlight">{splitConfig.linesPerSlide}</span>
              </div>
            </div>
          </div>


        </div>

        <div className="worship-import-body">
          <section className="worship-lyrics-editor">
            <div className="worship-section-head">
              <Icon name="edit_note" size={20} />
              <h3>Raw Lyrics</h3>
              <span className="worship-section-meta">Lines: {importLyrics.split("\n").length}</span>
            </div>
            <textarea
              className="worship-lyrics-textarea"
              spellCheck={false}
              placeholder={"Paste song lyrics here…\n\nSeparate stanzas with a blank line."}
              value={importLyrics}
              onChange={(e) => setImportLyrics(e.target.value)}
            />
          </section>

          <section className="worship-slides-preview">
            <div className="worship-section-head">
              <Icon name="slideshow" size={20} />
              <h3>Generated Slides</h3>
              <span className="worship-section-meta">
                {importSlides.length} slide{importSlides.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="worship-slides-grid">
              {importSlides.map((slide) => (
                <div key={slide.id} className={`worship-slide-card${slide.isContinuation ? " cont" : ""}`}>
                  <div className="worship-slide-card-head">
                    <span className={`worship-slide-label${slide.isContinuation ? " cont" : ""}`}>
                      {slide.label}
                    </span>
                  </div>
                  <div className="worship-slide-card-body">
                    <p>{slide.content}</p>
                  </div>
                </div>
              ))}
              {importSlides.length === 0 && (
                <div className="worship-import-empty">
                  <Icon name="lyrics" size={20} />
                  <p>Paste lyrics on the left to generate slides</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="worship-import-footer">
          <button className="worship-btn-secondary" onClick={() => setView("dashboard")}>
            <Icon name="arrow_back" size={20} />
            Back
          </button>
          <div className="worship-import-footer-right">
            <button
              className="worship-btn-primary"
              disabled={!importMetadata.title.trim() || importSlides.length === 0}
              onClick={handleSaveImport}
            >
              <Icon name="save" size={20} />
              Save to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // DASHBOARD VIEW
  // ═══════════════════════════════════════════════════════
  return (
    <>
      <div className="worship-home">
        {/* ── Header ── */}


        <div className={`worship-main${showLiveSlideStrip ? " has-live-strip" : ""}`}>
          {/* ── LEFT — Song library sidebar ── */}
          <aside className="worship-sidebar">
            <div className="worship-sidebar-search">
              <Icon name="search" size={20} />
              <input
                type="text"
                placeholder="Search library…"
                value={songSearch}
                onChange={(e) => setSongSearch(e.target.value)}
              />
            </div>

            <div className="worship-sidebar-tabs">
              {(["songs", "setlist", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`worship-sidebar-tab${sidebarTab === tab ? " active" : ""}`}
                  onClick={() => setSidebarTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="worship-sidebar-list">
              {filteredSongs.length === 0 && (
                <div className="worship-sidebar-empty">
                  <Icon name="library_music" size={20} />
                  <p>No songs yet</p>
                </div>
              )}
              {filteredSongs.map((song) => {
                const isActive = song.id === selectedSongId;
                return (
                  <div
                    key={song.id}
                    className={`worship-song-item${isActive ? " active" : ""}`}
                    onClick={() => {
                      setSelectedSongId(song.id);
                      setLiveSlideIndex(0);
                      setEditingSlideIdx(null);
                    }}
                  >
                    <div className="worship-song-item-info">
                      <h3>{song.metadata.title}</h3>
                      <span className="worship-song-item-artist">{song.metadata.artist}</span>
                    </div>
                    <div className="worship-song-item-actions">
                      {isActive && (
                        <Icon name="graphic_eq" size={20} className="worship-song-item-playing" />
                      )}
                      <button
                        className="worship-song-delete-btn"
                        title="Archive song"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteSong(song);
                        }}
                      >
                        <Icon name="archive" size={20} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="worship-sidebar-footer">
              <button
                className="worship-sidebar-action primary"
                onClick={() => {
                  setImportLyrics("");
                  setImportMetadata({ title: "", artist: "" });
                  setView("import");
                }}
              >
                <Icon name="add" size={20} />
                Add Song
              </button>
            </div>
          </aside>

          {/* ── CENTER — Slide editor ── */}
          <section className="worship-center">
            {selectedSong ? (
              <>
                <div className="worship-center-head">
                  <div className="worship-center-head-info">
                    <div className="worship-center-head-accent" />
                    <div>
                      <h2>{selectedSong.metadata.title}</h2>
                    </div>
                  </div>
                  <div className="worship-center-head-tools">
                    <button
                      title={editingSlideIdx !== null ? "Save edit" : "Quick Edit lyrics"}
                      onClick={() => {
                        if (editingSlideIdx !== null) {
                          saveEdit();
                        } else if (songSlides.length > 0) {
                          startEdit(liveSlideIndex);
                        }
                      }}
                    >
                      <Icon name={editingSlideIdx !== null ? "check" : "edit_note"} size={20} />
                    </button>
                  </div>
                </div>

                <div className="worship-slides-list" ref={slideListRef}>
                  {songSlides.map((slide, index) => {
                    const isLiveSlide = index === liveSlideIndex && isLive;
                    const isSelected = index === liveSlideIndex;
                    return (
                      <div key={slide.id} className="worship-slide-row">
                        <div className="worship-slide-row-label">
                          {!slide.isContinuation && (
                            <span className={`worship-slide-tag${isLiveSlide ? " live" : ""}`}>
                              {slide.label}
                            </span>
                          )}
                        </div>
                        <div
                          className={`worship-slide-block${isLiveSlide ? " live" : ""}${isSelected && !isLive ? " selected" : ""}`}
                          onClick={() => setLiveSlideIndex(index)}
                          onDoubleClick={() => sendSlideToObs(index)}
                          title="Double-click to send to OBS"
                        >
                          {isLiveSlide && <div className="worship-slide-live-badge">LIVE</div>}
                          <button
                            className="worship-slide-send-btn"
                            title="Send to OBS"
                            onClick={(e) => {
                              e.stopPropagation();
                              sendSlideToObs(index);
                            }}
                          >
                            <Icon name="cast" size={20} />
                          </button>
                          <div className="worship-slide-block-text">
                            {editingSlideIdx === index ? (
                              <textarea
                                className="worship-slide-edit-textarea"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && e.metaKey) saveEdit();
                                  if (e.key === "Escape") setEditingSlideIdx(null);
                                }}
                                autoFocus
                              />
                            ) : (
                              <p>{slide.content}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="worship-center-empty">
                <Icon name="music_off" size={20} />
                <p>Select a song or add one to get started</p>
              </div>
            )}
          </section>

          {/* ── RIGHT — Preview & controls ── */}
          <aside className="worship-right">
            <div className="worship-right-section">
              <div className="worship-preview-label-row">
                <span className="worship-preview-label">Preview (Next)</span>
                {songSlides[liveSlideIndex + 1] && !isGenericVerseLabel(songSlides[liveSlideIndex + 1].label) && (
                  <span className="worship-preview-tag">{songSlides[liveSlideIndex + 1].label}</span>
                )}
              </div>
              <div className="worship-preview-box preview" style={previewBackgroundStyle}>
                <p>{songSlides[liveSlideIndex + 1]?.content ?? "End of song"}</p>
              </div>
            </div>



            {/* Controls */}
            <div className="worship-controls">
              <button
                className="worship-control-btn"
                onClick={handlePrevSlide}
                disabled={liveSlideIndex <= 0}
                title="Previous slide (←)"
              >
                <Icon name="skip_previous" size={20} />
                <span>Prev</span>
              </button>
              <button
                className="worship-control-btn primary"
                onClick={handleNextSlide}
                disabled={liveSlideIndex >= songSlides.length - 1}
                title="Next slide (→)"
              >
                <Icon name="skip_next" size={20} />
                <span>Next</span>
              </button>
              <button
                className={`worship-control-btn${isBlanked ? " active-warn" : ""}`}
                onClick={handleBlackout}
                title="Blackout (B)"
              >
                <Icon name="desktop_access_disabled" size={20} />
                <span>Blackout</span>
              </button>
              <button
                className="worship-control-btn danger"
                onClick={handleClear}
                title="Clear output (C)"
              >
                <Icon name="cancel_presentation" size={20} />
                <span>Clear</span>
              </button>
            </div>

            {/* Layout & Motion */}
            <div className="worship-right-section">
              <div className="worship-layout-header">
                <Icon name="view_quilt" size={20} />
                <span className="worship-layout-header-label">Layout &amp; Motion</span>
              </div>
              <div className="worship-layout-modes">
                <button
                  className={`worship-layout-mode-btn${layoutMode === "fullscreen" ? " active" : ""}`}
                  onClick={() => handleLayoutClick("fullscreen")}
                >
                  <Icon name="fullscreen" size={20} />
                  Full
                </button>
                <button
                  className={`worship-layout-mode-btn${layoutMode === "lower-third" ? " active" : ""}`}
                  onClick={() => handleLayoutClick("lower-third")}
                >
                  <Icon name="subtitles" size={20} />
                  Lower
                </button>
              </div>

              {layoutMode === "fullscreen" && (
                <>
                  <label className="worship-right-label">Full Theme (1-4 keys)</label>
                  <div className="worship-theme-selector" onClick={() => setThemeOpen((o) => !o)}>
                    <div
                      className="worship-theme-preview-thumb"
                      style={themePreviewStyle}
                    />
                    <span className="worship-theme-name">
                      {themes.find((t) => t.id === activeThemeId)?.name ?? "Theme"}
                    </span>
                    <Icon name={themeOpen ? "arrow_drop_up" : "arrow_drop_down"} size={20} />
                  </div>
                  {themeOpen && (
                    <div className="worship-theme-dropdown">
                      {sortedThemes.map((t) => (
                        <button
                          key={t.id}
                          className={`worship-theme-option${t.id === activeThemeId ? " active" : ""}`}
                          onClick={() => handleThemeChange(t.id)}
                        >
                          <div
                            className="worship-theme-option-thumb"
                            style={{
                              background: t.settings.backgroundColor,
                              backgroundImage: t.settings.backgroundImage ? `url(${t.settings.backgroundImage})` : undefined,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                          <div className="worship-theme-option-info">
                            <span className="worship-theme-option-name">{t.name}</span>
                            <span className="worship-theme-option-desc">{t.description}</span>
                          </div>
                          <span
                            className="worship-theme-fav"
                            title={bibleFavs.has(t.id) ? "Remove from favorites" : "Add to favorites"}
                            onClick={(e) => handleToggleBibleFav(t.id, e)}
                            style={{ color: bibleFavs.has(t.id) ? "#f59e0b" : "#555", cursor: "pointer", marginRight: 4, display: "inline-flex" }}
                          >
                            <Icon name={bibleFavs.has(t.id) ? "star" : "star_border"} size={16} />
                          </span>
                          {t.id === activeThemeId && (
                            <Icon name="check" size={20} className="worship-theme-check" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {layoutMode === "lower-third" && (
                <>
                  <label className="worship-right-label">Lower Theme</label>
                  <div className="worship-theme-selector" onClick={() => setWorshipThemeOpen((open) => !open)}>
                    <div
                      className="worship-theme-preview-thumb"
                      style={worshipLowerThemePreviewStyle}
                    />
                    <span className="worship-theme-name">
                      {activeWorshipLowerThird?.name ?? "Theme"}
                    </span>
                    <Icon name={worshipThemeOpen ? "arrow_drop_up" : "arrow_drop_down"} size={20} />
                  </div>
                  {worshipThemeOpen && (
                    <div className="worship-theme-dropdown">
                      {sortedWorshipLTThemes.map((t) => (
                        <button
                          key={t.id}
                          className={`worship-theme-option${t.id === activeWorshipLowerThird?.id ? " active" : ""}`}
                          onClick={() => {
                            setActiveWorshipLowerThirdId(t.id);
                            setWorshipThemeOpen(false);
                          }}
                        >
                          <div
                            className="worship-theme-option-thumb"
                            style={{
                              background: `linear-gradient(135deg, ${t.accentColor || primaryColor} 0%, #111827 100%)`,
                            }}
                          />
                          <div className="worship-theme-option-info">
                            <span className="worship-theme-option-name">{t.name}</span>
                            <span className="worship-theme-option-desc">{t.description}</span>
                          </div>
                          <span
                            className="worship-theme-fav"
                            title={worshipLTFavs.has(t.id) ? "Remove from favorites" : "Add to favorites"}
                            onClick={(e) => handleToggleWorshipLTFav(t.id, e)}
                            style={{ color: worshipLTFavs.has(t.id) ? "#f59e0b" : "#555", cursor: "pointer", marginRight: 4, display: "inline-flex" }}
                          >
                            <Icon name={worshipLTFavs.has(t.id) ? "star" : "star_border"} size={16} />
                          </span>
                          {t.id === activeWorshipLowerThird?.id && (
                            <Icon name="check" size={20} className="worship-theme-check" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="worship-inline-hint">
                    Lower mode uses these worship/prayer themes when sending to OBS scenes.
                  </span>
                </>
              )}
            </div>

            <div className="worship-right-section">
              <ObsScenesPanel
                title="OBS Scenes (Full & Lower)"
                contentLabel={layoutMode === "fullscreen" ? "full worship overlay" : "worship lower-third"}
                description={`These are your current scenes in OBS. Click ${modeSendLabel} on any scene, or use Preview/Program for the current OBS targets.`}
                connected={obsConnected}
                scenes={ltScenes}
                mainScene={serviceStore.sceneMapping.mainScene}
                previewScene={ltPreviewScene}
                programScene={ltProgramScene}
                activeScenes={activeModeLiveScenes}
                refreshing={ltScenesRefreshing}
                disabled={layoutMode === "lower-third" && !activeWorshipLowerThird ? true : lowerThirdBusy}
                sendLabel={modeSendLabel}
                onRefresh={handleRefreshLtScenes}
                onSendToScene={async (sceneName, mode) => {
                  if (layoutMode === "fullscreen") {
                    await handleSendWorshipFullToScene(sceneName, mode);
                  } else {
                    await handleSendWorshipLowerThirdToScene(sceneName, mode);
                  }
                }}
              />
              {activeModeLiveScenes.length > 0 && (
                <span className="worship-inline-hint">
                  Live on {activeModeLiveScenes.length} scene{activeModeLiveScenes.length !== 1 ? "s" : ""} — updates in real-time.
                </span>
              )}
            </div>

            {/* Keyboard hints */}
            <div className="worship-shortcuts-hint">
              <span>← → slides</span>
              <span>B blackout</span>
              <span>C clear</span>
              {layoutMode === "fullscreen" && <span>1-4 theme</span>}
              <span>Send by scene</span>
              <span>Dbl-click → OBS</span>
            </div>
          </aside>
        </div>

        {showLiveSlideStrip && (
          <div className="worship-live-strip" role="region" aria-label="Live worship slides">
            <div className="worship-live-strip-head">
              <span className="worship-live-strip-title">
                <Icon name="slideshow" size={20} />
                Live Slides
              </span>
              <div className="worship-live-strip-shortcuts">
                <span><kbd>←</kbd>/<kbd>→</kbd> Prev/Next</span>
                <span><kbd>B</kbd> Go Black</span>
                <span><kbd>C</kbd> Clear</span>
                <span><kbd>Enter</kbd> Send Selected</span>
              </div>
            </div>
            <div className="worship-live-strip-rail">
              {songSlides.map((slide, index) => {
                const isCurrent = index === liveSlideIndex;
                return (
                  <button
                    key={slide.id}
                    type="button"
                    className={`worship-live-strip-slide${isCurrent ? " active" : ""}`}
                    onClick={() => {
                      setLiveSlideIndex(index);
                      if (isLive) {
                        void pushToObs(index, true, false);
                      }
                    }}
                    title={`Slide ${index + 1}`}
                  >
                    <span className="worship-live-strip-slide-text">{slide.content}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {confirmDeleteSong && (
        <div className="end-confirm-backdrop" onClick={() => setConfirmDeleteSong(null)}>
          <div className="end-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Archive the song?</h2>
            <p>
              Move <strong>{confirmDeleteSong.metadata.title}</strong> out of your active worship library? It will be archived, not deleted.
            </p>
            <div className="end-confirm-actions">
              <button
                className="end-confirm-btn-cancel"
                onClick={() => setConfirmDeleteSong(null)}
              >
                Cancel
              </button>
              <button
                className="end-confirm-btn-end"
                onClick={() => { void handleArchiveSong(confirmDeleteSong.id); }}
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default WorshipModule;
