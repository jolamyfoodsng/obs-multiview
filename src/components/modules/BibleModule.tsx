/**
 * BibleHome.tsx — Simplified Bible production interface
 *
 * Designed for church volunteers under time pressure.
 * Workflow: Select Book → Select Chapter → Select Verse → Double-click to send to OBS
 *
 * Layout:
 *   HEADER  — Go to Switcher + now displaying + Send to OBS (flash) + OBS status
 *   LEFT    — VerseListPanel (auto) + Theme trigger (opens modal) + Layout & Motion
 *   CENTER  — Utility strip (Favorites/History) + BookChapterPanel
 *   RIGHT   — SlidePreview (closable)
 *   FOOTER  — Prev/Next verse + Blank + Clear + kbd hints
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBible } from "../../bible/bibleStore";
import { bibleObsService } from "../../bible/bibleObsService";
import { getChapter, getChapterCount, getVerseCount, searchBible } from "../../bible/bibleData";
import type { SearchResult } from "../../bible/bibleData";
import { parseBibleSearch } from "../../dock/bibleSearchParser";
import { clearHistory, getBibleSettings, saveBibleSettings, getInstalledTranslations } from "../../bible/bibleDb";
import type { BiblePassage, BibleTemplateType, BibleTranslation } from "../../bible/types";
import { BIBLE_BOOKS } from "../../bible/types";
import { generateSlides } from "../../bible/slideEngine";
import BookChapterPanel from "../../bible/components/BookChapterPanel";
import VerseListPanel from "../../bible/components/VerseListPanel";
import SlidePreview from "../../bible/components/SlidePreview";
import BibleLibrary from "../../bible/components/BibleLibrary";
import { obsService } from "../../services/obsService";
import { serviceStore } from "../../services/serviceStore";
import { ensureDockObsClientConnected } from "../../services/dockObsInterop";
import { isUserSelectableObsScene, normalizeDockStageBaseScene } from "../../services/dockSceneNames";
import { getInputBySlot, getSceneBySlot } from "../../services/obsRegistry";
import { useServiceGate } from "../../hooks/useServiceGate";
import { ObsScenesPanel } from "../shared/ObsScenesPanel";
import { LT_ALL_THEMES, LT_BIBLE_THEMES } from "../../lowerthirds/themes";
import { buildOverlayUrl, lowerThirdObsService } from "../../lowerthirds/lowerThirdObsService";
import type { LowerThirdTheme } from "../../lowerthirds/types";
import type { LTSize } from "../../lowerthirds/types";
import { OCS_LT_PATTERN, MV_LT_PATTERN, OCS_BIBLE_LT_PATTERN } from "../../lowerthirds/types";
import { dockObsClient } from "../../dock/dockObsClient";
import Icon from "../Icon";

const LEFT_PANEL_DEFAULT_WIDTH = 300;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_DEFAULT_WIDTH = 280;
const RIGHT_PANEL_MIN_WIDTH = 220;
const RIGHT_PANEL_MAX_WIDTH = 520;
const SIDEBAR_COLLAPSE_THRESHOLD = 90;
const LT_PREVIEW_FALLBACK_TEXT = "For God so loved the world that He gave His only begotten Son.";
const BIBLE_OVERLAY_SCENE_SLOT = "bible-overlay";
const BIBLE_OVERLAY_SCENE_FALLBACK_NAME = "OCS Bible Overlay";
const BIBLE_MAIN_INPUT_SLOT = "bible-browser-source";
const BIBLE_BG_INPUT_SLOT = "bible-bg-source";
const BIBLE_MAIN_INPUT_FALLBACK_NAME = "OBS Church Studio — Bible";
const BIBLE_BG_INPUT_FALLBACK_NAME = "OBS Church Studio — Bible BG";
const SHARED_WORSHIP_BIBLE_THEME_TAG = "shared-worship-bible";

const BIBLE_LOWER_THIRD_THEMES: LowerThirdTheme[] = (() => {
  const sharedThemes = LT_ALL_THEMES.filter((theme) =>
    Array.isArray(theme.tags)
    && theme.tags.some((tag) => String(tag).trim().toLowerCase() === SHARED_WORSHIP_BIBLE_THEME_TAG)
  ) as unknown as LowerThirdTheme[];

  const byId = new Map<string, LowerThirdTheme>();
  for (const theme of LT_BIBLE_THEMES) byId.set(theme.id, theme);
  for (const theme of sharedThemes) byId.set(theme.id, theme);
  return Array.from(byId.values());
})();

function substituteThemeVariables(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

function escapeStyle(styleText: string): string {
  return styleText.replace(/<\/style/gi, "<\\/style");
}

function buildBibleLTPreviewValues(theme: LowerThirdTheme, reference: string, verseText: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const variable of theme.variables) {
    const key = variable.key.toLowerCase();
    const label = variable.label.toLowerCase();
    const hint = `${key} ${label}`;

    if (hint.includes("verse") || hint.includes("scripture") || hint.includes("quote") || key === "text") {
      values[variable.key] = verseText || variable.defaultValue || LT_PREVIEW_FALLBACK_TEXT;
      continue;
    }

    if (hint.includes("reference")) {
      values[variable.key] = reference || variable.defaultValue || "John 3:16";
      continue;
    }

    if (hint.includes("label") || hint.includes("kicker") || hint.includes("badge")) {
      values[variable.key] = variable.defaultValue || "Scripture";
      continue;
    }

    if (variable.type === "toggle") {
      values[variable.key] = variable.defaultValue === "false" ? "false" : "true";
      continue;
    }

    if (variable.type === "select") {
      values[variable.key] = variable.defaultValue || variable.options?.[0]?.value || "";
      continue;
    }

    values[variable.key] = variable.defaultValue || "";
  }
  return values;
}

function buildBibleLTPreviewDoc(theme: LowerThirdTheme, reference: string, verseText: string): string {
  const values = buildBibleLTPreviewValues(theme, reference, verseText);
  const html = substituteThemeVariables(theme.html, values);
  const imports = Array.isArray(theme.fontImports)
    ? theme.fontImports.map((url) => `@import url("${url}");`).join("\n")
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      body {
        width: 1920px;
        height: 1080px;
        transform: scale(0.3);
        transform-origin: top left;
      }
      ${imports}
      ${escapeStyle(theme.css)}
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`;
}

export interface BibleModuleProps {
  isActive?: boolean;
  homePath?: string;
  templatesPath?: string;
  /** Deep-link: auto-select this Bible verse when set */
  initialSelectBible?: { book: string; chapter: number; verse: number } | null;
  /** Called after the deep-link selection has been consumed */
  onConsumeInitialSelect?: () => void;
}

export function BibleModule({
  isActive = true,
  homePath = "/",
  templatesPath = "/bible/templates",
  initialSelectBible,
  onConsumeInitialSelect,
}: BibleModuleProps) {
  const {
    state, dispatch, addToQueue, toggleFavorite, recordHistory,
    currentQueueItem, activeTheme,
    goLive, goBlank, goClear, setTheme,
  } = useBible();
  const navigate = useNavigate();

  // Navigation state — default to Genesis 1:1, restored from IndexedDB on mount
  const [selectedBook, setSelectedBook] = useState<string>("Genesis");
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [selectedVerse, setSelectedVerse] = useState<number>(1);
  const [selectionLoaded, setSelectionLoaded] = useState(false);

  // Restore last selection from IndexedDB on mount
  useEffect(() => {
    getBibleSettings().then((settings) => {
      if (settings.lastBook) setSelectedBook(settings.lastBook);
      if (settings.lastChapter) setSelectedChapter(settings.lastChapter);
      if (settings.lastVerse) setSelectedVerse(settings.lastVerse);
      setSelectionLoaded(true);
    }).catch(() => setSelectionLoaded(true));
  }, []);

  // Persist selection to IndexedDB on change (debounced)
  useEffect(() => {
    if (!selectionLoaded) return;
    const timer = setTimeout(() => {
      saveBibleSettings({
        lastBook: selectedBook,
        lastChapter: selectedChapter,
        lastVerse: selectedVerse,
      }).catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedBook, selectedChapter, selectedVerse, selectionLoaded]);

  // Deep-link: navigate to a specific verse when triggered from global search
  useEffect(() => {
    if (initialSelectBible) {
      setSelectedBook(initialSelectBible.book);
      setSelectedChapter(initialSelectBible.chapter);
      setSelectedVerse(initialSelectBible.verse);
      onConsumeInitialSelect?.();
    }
  }, [initialSelectBible, onConsumeInitialSelect]);

  // OBS connection
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");

  // Verse count for current chapter
  const [currentVerseCount, setCurrentVerseCount] = useState(0);

  // Track whether we've sent to OBS (for auto next/prev)
  const [hasSentToObs, setHasSentToObs] = useState(false);

  // Right panel visibility
  const [showPreview, setShowPreview] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const resizeStateRef = useRef<{
    side: "left" | "right";
    startX: number;
    leftWidth: number;
    rightWidth: number;
  } | null>(null);

  // Quick Setup wizard
  const [showQuickSetup, setShowQuickSetup] = useState(false);

  // Flash feedback for Send to OBS button
  const [sendFlash, setSendFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Utility strip: 'none' | 'favorites' | 'history' | 'search'
  const [activeUtilityTab, setActiveUtilityTab] = useState<"none" | "favorites" | "history" | "search">("none");

  // Full-text Bible search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Smart reference matches (e.g. "jhn1623" → John 16:23)
  const [refMatches, setRefMatches] = useState<{ book: string; chapter: number | null; verse: number | null; label: string }[]>([]);

  // Theme picker modal
  const [showThemeModal, setShowThemeModal] = useState(false);

  // Context menu for theme modal right-click
  const [themeContextMenu, setThemeContextMenu] = useState<{ x: number; y: number; themeId: string } | null>(null);

  // Drag-to-reorder state for theme modal
  const [dragThemeId, setDragThemeId] = useState<string | null>(null);
  const [dragOverThemeId, setDragOverThemeId] = useState<string | null>(null);

  // ── Lower Third overlay state ──
  const [selectedLTTheme, setSelectedLTTheme] = useState<LowerThirdTheme | null>(null);
  const [ltScenes, setLtScenes] = useState<string[]>([]);
  const [ltTargetScene, setLtTargetScene] = useState<string>("");
  const [ltPreviewScene, setLtPreviewScene] = useState<string>("");
  const [ltProgramScene, setLtProgramScene] = useState<string>("");
  const [ltSize, setLtSize] = useState<LTSize>("xl");
  const [ltSending, setLtSending] = useState(false);
  const [ltScenesRefreshing, setLtScenesRefreshing] = useState(false);
  // Scenes that have an active LT bible source — used for real-time updates
  const [ltLiveScenes, setLtLiveScenes] = useState<string[]>([]);
  // Scenes that have an active fullscreen Bible source
  const [fullLiveScenes, setFullLiveScenes] = useState<string[]>([]);
  const ltScenePollBusyRef = useRef(false);
  const bibleOverlaySceneNameRef = useRef<string>(BIBLE_OVERLAY_SCENE_FALLBACK_NAME);
  const lastNonBibleProgramSceneRef = useRef<string>("");
  const lastNonBiblePreviewSceneRef = useRef<string>("");

  // Detect Mac for shortcut labels
  const isMac = useMemo(() => navigator.platform.toUpperCase().indexOf("MAC") >= 0, []);

  // Bible Library modal
  const [showLibrary, setShowLibrary] = useState(false);
  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Installed translations for the switcher dropdown
  const [installedTranslations, setInstalledTranslations] = useState<{ abbr: string; name: string }[]>([]);

  // Service gate (no-op — service gate concept removed)
  const { checkServiceActive } = useServiceGate();

  const refreshInstalledTranslations = useCallback(() => {
    getInstalledTranslations().then((list) => {
      setInstalledTranslations(list.map((t) => ({ abbr: t.abbr, name: t.name })));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    refreshInstalledTranslations();
  }, [refreshInstalledTranslations]);

  useEffect(() => {
    const currentTranslation = state.translation.toUpperCase();
    if (currentTranslation === "KJV") return;
    const isInstalled = installedTranslations.some((entry) => entry.abbr.toUpperCase() === currentTranslation);
    if (isInstalled) return;

    dispatch({ type: "SET_TRANSLATION", translation: "KJV" });
    setToastMessage(`${state.translation} is not installed. Switched to KJV.`);
    const timer = window.setTimeout(() => setToastMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [installedTranslations, state.translation, dispatch]);

  // Layout mode
  const [layoutMode, setLayoutMode] = useState<BibleTemplateType>("fullscreen");

  // Layout confirmation modal
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [pendingLayoutMode, setPendingLayoutMode] = useState<BibleTemplateType | null>(null);
  const [skipLayoutConfirm, setSkipLayoutConfirm] = useState(() => localStorage.getItem("bible-skip-layout-confirm") === "true");

  // ── Lower Third: fetch scenes ──
  const resolveBibleOverlaySceneName = useCallback(async (): Promise<string> => {
    let name = bibleOverlaySceneNameRef.current;
    try {
      const regScene = await getSceneBySlot(BIBLE_OVERLAY_SCENE_SLOT);
      if (regScene?.sceneName) {
        name = regScene.sceneName;
      }
    } catch {
      // Registry lookup is best-effort.
    }
    if (!name) {
      name = BIBLE_OVERLAY_SCENE_FALLBACK_NAME;
    }
    bibleOverlaySceneNameRef.current = name;
    return name;
  }, []);

  const isBibleFullscreenSceneName = useCallback((sceneName: string, bibleOverlaySceneName: string): boolean => {
    const current = sceneName.trim().toLowerCase();
    const bibleScene = bibleOverlaySceneName.trim().toLowerCase();
    if (!current) return false;
    return current === bibleScene || /\bbible\b/.test(current);
  }, []);

  const loadLtScenes = useCallback(async () => {
    if (!obsService.isConnected) return;
    try {
      const bibleOverlaySceneName = await resolveBibleOverlaySceneName();
      const scenes = await obsService.getSceneList();
      const visibleScenes = scenes.filter((scene) => isUserSelectableObsScene(scene.sceneName));
      const names = visibleScenes.map((scene) => scene.sceneName);
      setLtScenes(names);
      setLtLiveScenes((prev) => prev.filter((sceneName) => names.includes(sceneName)));
      setFullLiveScenes((prev) => prev.filter((sceneName) => names.includes(sceneName)));
      const program = await obsService.getCurrentProgramScene();
      const normalizedProgram = normalizeDockStageBaseScene(program);
      const displayProgram = names.includes(program)
        ? program
        : (names.includes(normalizedProgram) ? normalizedProgram : "");
      setLtProgramScene(displayProgram);
      if (normalizedProgram && !isBibleFullscreenSceneName(program, bibleOverlaySceneName)) {
        lastNonBibleProgramSceneRef.current = normalizedProgram;
      }
      try {
        const preview = await obsService.getCurrentPreviewScene();
        const normalizedPreview = normalizeDockStageBaseScene(preview);
        const displayPreview = names.includes(preview)
          ? preview
          : (names.includes(normalizedPreview) ? normalizedPreview : "");
        setLtPreviewScene(displayPreview);
        if (normalizedPreview && !isBibleFullscreenSceneName(preview, bibleOverlaySceneName)) {
          lastNonBiblePreviewSceneRef.current = normalizedPreview;
        }
      } catch {
        setLtPreviewScene("");
      }
      if (!ltTargetScene || !names.includes(ltTargetScene)) {
        const mainScene = serviceStore.sceneMapping.mainScene;
        const defaultScene = mainScene && names.includes(mainScene) ? mainScene : names[0] ?? "";
        setLtTargetScene(defaultScene);
      }
    } catch (err) {
      console.warn("[BibleModule] Failed to fetch scenes:", err);
    }
  }, [isBibleFullscreenSceneName, ltTargetScene, resolveBibleOverlaySceneName]);

  const restoreFromBibleFullscreenIfNeeded = useCallback(async (
    mode: "scene" | "preview" | "program",
    requestedSceneName: string,
  ): Promise<string> => {
    if (mode === "scene" || !obsService.isConnected) {
      return requestedSceneName;
    }

    const bibleOverlaySceneName = await resolveBibleOverlaySceneName();
    const fallbackSceneFromList =
      ltScenes.find((sceneName) => !isBibleFullscreenSceneName(sceneName, bibleOverlaySceneName)) || "";
    const fallbackScene = serviceStore.sceneMapping.mainScene || fallbackSceneFromList || requestedSceneName;

    if (mode === "program") {
      const currentProgram = await obsService.getCurrentProgramScene().catch(() => requestedSceneName);
      if (!isBibleFullscreenSceneName(currentProgram, bibleOverlaySceneName)) {
        if (currentProgram) lastNonBibleProgramSceneRef.current = currentProgram;
        return requestedSceneName;
      }
      const restoreTarget = lastNonBibleProgramSceneRef.current || fallbackScene;
      if (!restoreTarget || restoreTarget === currentProgram) {
        return requestedSceneName;
      }
      try {
        await obsService.setCurrentProgramScene(restoreTarget);
        setLtProgramScene(restoreTarget);
        return restoreTarget;
      } catch (err) {
        console.warn("[BibleModule] Failed to restore program scene before lower-third send:", err);
        return requestedSceneName;
      }
    }

    const currentPreview = await obsService.getCurrentPreviewScene().catch(() => requestedSceneName);
    if (!isBibleFullscreenSceneName(currentPreview, bibleOverlaySceneName)) {
      if (currentPreview) lastNonBiblePreviewSceneRef.current = currentPreview;
      return requestedSceneName;
    }
    const restoreTarget = lastNonBiblePreviewSceneRef.current || fallbackScene;
    if (!restoreTarget || restoreTarget === currentPreview) {
      return requestedSceneName;
    }
    try {
      await obsService.setCurrentPreviewScene(restoreTarget);
      setLtPreviewScene(restoreTarget);
      return restoreTarget;
    } catch (err) {
      console.warn("[BibleModule] Failed to restore preview scene before lower-third send:", err);
      return requestedSceneName;
    }
  }, [isBibleFullscreenSceneName, ltScenes, resolveBibleOverlaySceneName]);

  const disableFullscreenBibleSourcesInScene = useCallback(async (sceneName: string): Promise<void> => {
    if (!sceneName || !obsService.isConnected) return;
    try {
      const inputs = await obsService.getInputList();

      const regMainInput = await getInputBySlot(BIBLE_MAIN_INPUT_SLOT).catch(() => undefined);
      const regBgInput = await getInputBySlot(BIBLE_BG_INPUT_SLOT).catch(() => undefined);

      let mainInputName = regMainInput?.inputName || BIBLE_MAIN_INPUT_FALLBACK_NAME;
      if (regMainInput?.inputUuid) {
        const found = inputs.find((input) => input.inputUuid === regMainInput.inputUuid);
        if (found?.inputName) mainInputName = found.inputName;
      }

      let bgInputName = regBgInput?.inputName || BIBLE_BG_INPUT_FALLBACK_NAME;
      if (regBgInput?.inputUuid) {
        const found = inputs.find((input) => input.inputUuid === regBgInput.inputUuid);
        if (found?.inputName) bgInputName = found.inputName;
      }

      const fullscreenSourceNames = new Set<string>([
        mainInputName,
        bgInputName,
        BIBLE_MAIN_INPUT_FALLBACK_NAME,
        BIBLE_BG_INPUT_FALLBACK_NAME,
      ]);

      const sceneItems = await obsService.getSceneItemList(sceneName);
      for (const item of sceneItems) {
        if (!fullscreenSourceNames.has(item.sourceName)) continue;
        // Never disable lower-third bible sources.
        if (OCS_BIBLE_LT_PATTERN.test(item.sourceName)) continue;
        try {
          await obsService.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemEnabled: false,
          });
        } catch {
          // Best effort.
        }
      }
    } catch (err) {
      console.warn("[BibleModule] Failed to disable fullscreen Bible sources:", err);
    }
  }, []);

  const prepareForLowerThirdMode = useCallback(async (): Promise<void> => {
    if (!obsConnected) return;

    let resolvedProgramScene = "";
    const currentProgramScene = await obsService.getCurrentProgramScene().catch(() => "");
    if (currentProgramScene) {
      resolvedProgramScene = await restoreFromBibleFullscreenIfNeeded("program", currentProgramScene);
      if (resolvedProgramScene) {
        await disableFullscreenBibleSourcesInScene(resolvedProgramScene);
      }
    }

    const currentPreviewScene = await obsService.getCurrentPreviewScene().catch(() => "");
    if (currentPreviewScene) {
      const resolvedPreviewScene = await restoreFromBibleFullscreenIfNeeded("preview", currentPreviewScene);
      if (resolvedPreviewScene && resolvedPreviewScene !== resolvedProgramScene) {
        await disableFullscreenBibleSourcesInScene(resolvedPreviewScene);
      }
    }
  }, [disableFullscreenBibleSourcesInScene, obsConnected, restoreFromBibleFullscreenIfNeeded]);

  const handleRefreshLtScenes = useCallback(async () => {
    setLtScenesRefreshing(true);
    try {
      await loadLtScenes();
    } finally {
      setLtScenesRefreshing(false);
    }
  }, [loadLtScenes]);

  const beginSidebarResize = useCallback((side: "left" | "right", e: React.MouseEvent) => {
    e.preventDefault();
    resizeStateRef.current = {
      side,
      startX: e.clientX,
      leftWidth: leftPanelCollapsed ? 0 : leftPanelWidth,
      rightWidth: showPreview ? rightPanelWidth : 0,
    };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [leftPanelCollapsed, leftPanelWidth, rightPanelWidth, showPreview]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const active = resizeStateRef.current;
      if (!active) return;

      if (active.side === "left") {
        const nextRaw = active.leftWidth + (e.clientX - active.startX);
        if (nextRaw <= SIDEBAR_COLLAPSE_THRESHOLD) {
          setLeftPanelCollapsed(true);
          return;
        }
        setLeftPanelCollapsed(false);
        setLeftPanelWidth(Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_MAX_WIDTH, Math.round(nextRaw))));
        return;
      }

      const nextRaw = active.rightWidth + (active.startX - e.clientX);
      if (nextRaw <= SIDEBAR_COLLAPSE_THRESHOLD) {
        setShowPreview(false);
        return;
      }
      setShowPreview(true);
      setRightPanelWidth(Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, Math.round(nextRaw))));
    };

    const onUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const handleLayoutClick = useCallback((mode: BibleTemplateType) => {
    if (mode === layoutMode) return;
    if (skipLayoutConfirm) {
      setLayoutMode(mode);
      if (mode === "lower-third") {
        loadLtScenes();
        // Auto-select the first LT theme if none is selected
        if (!selectedLTTheme && BIBLE_LOWER_THIRD_THEMES.length > 0) {
          setSelectedLTTheme(BIBLE_LOWER_THIRD_THEMES[0]);
        }
        void prepareForLowerThirdMode();
      }
      return;
    }
    setPendingLayoutMode(mode);
    setShowLayoutModal(true);
  }, [layoutMode, skipLayoutConfirm, loadLtScenes, prepareForLowerThirdMode, selectedLTTheme]);

  const confirmLayoutChange = useCallback(() => {
    if (pendingLayoutMode) {
      setLayoutMode(pendingLayoutMode);
      if (pendingLayoutMode === "lower-third") {
        loadLtScenes();
        // Auto-select the first LT theme if none is selected
        if (!selectedLTTheme && BIBLE_LOWER_THIRD_THEMES.length > 0) {
          setSelectedLTTheme(BIBLE_LOWER_THIRD_THEMES[0]);
        }
        void prepareForLowerThirdMode();
      }
    }
    setShowLayoutModal(false);
    setPendingLayoutMode(null);
  }, [pendingLayoutMode, loadLtScenes, prepareForLowerThirdMode, selectedLTTheme]);

  const cancelLayoutChange = useCallback(() => {
    setShowLayoutModal(false);
    setPendingLayoutMode(null);
  }, []);

  useEffect(() => {
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isActive) return;

    if (!obsConnected) {
      setLtScenes([]);
      setLtPreviewScene("");
      setLtProgramScene("");
      setLtTargetScene("");
      setLtLiveScenes([]);
      setFullLiveScenes([]);
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

  // Auto-ensure OBS browser source exists when Bible section opens or OBS connects
  useEffect(() => {
    if (!obsConnected) return;
    // Fire-and-forget: ensure the browser source exists in OBS
    bibleObsService.ensureBrowserSource(undefined, activeTheme?.templateType ?? "fullscreen")
      .then(() => console.log("[BibleHome] OBS browser source verified/created"))
      .catch((err) => console.warn("[BibleHome] Could not auto-ensure browser source:", err));
  }, [obsConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load verse count when chapter changes
  useEffect(() => {
    if (!selectedBook || !selectedChapter) { setCurrentVerseCount(0); return; }
    let cancelled = false;
    getVerseCount(selectedBook, selectedChapter, state.translation).then((n) => {
      if (!cancelled) setCurrentVerseCount(n);
    });
    return () => { cancelled = true; };
  }, [selectedBook, selectedChapter, state.translation]);

  // Load chapter count for current book (used by Shift+Arrow shortcuts)
  const [currentChapterCount, setCurrentChapterCount] = useState(0);
  useEffect(() => {
    if (!selectedBook) { setCurrentChapterCount(0); return; }
    let cancelled = false;
    getChapterCount(selectedBook, state.translation).then((n) => {
      if (!cancelled) setCurrentChapterCount(n);
    });
    return () => { cancelled = true; };
  }, [selectedBook, state.translation]);

  // Trigger flash feedback
  const triggerFlash = useCallback(() => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setSendFlash(true);
    flashTimerRef.current = setTimeout(() => setSendFlash(false), 600);
  }, []);

  // Send verse directly to OBS — CLEARS queue first for continuous sends
  const sendVerseToObs = useCallback(async (
    book: string,
    chapter: number,
    verse: number,
    options?: { useLegacyObs?: boolean },
  ): Promise<boolean> => {
    if (!checkServiceActive("display Bible verses on OBS")) return false;
    const useLegacyObs = options?.useLegacyObs ?? true;
    let passage: BiblePassage;
    try {
      passage = await getChapter(book, chapter, state.translation);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load the selected Bible translation.";
      console.warn("[BibleModule] sendVerseToObs failed:", err);
      setToastMessage(message);
      window.setTimeout(() => setToastMessage(null), 3500);
      return false;
    }
    const verseData = passage.verses.find(v => v.verse === verse);
    if (!verseData) {
      setToastMessage(`Could not load ${book} ${chapter}:${verse} (${state.translation}).`);
      window.setTimeout(() => setToastMessage(null), 3500);
      return false;
    }

    const biblePassage: BiblePassage = {
      reference: `${book} ${chapter}:${verse}`,
      book,
      chapter,
      startVerse: verse,
      endVerse: verse,
      verses: [verseData],
      translation: state.translation,
    };
    // Clear queue first so activeQueueIndex resets → OBS always gets the new verse
    dispatch({ type: "CLEAR_QUEUE" });
    addToQueue(biblePassage);
    recordHistory(biblePassage);
    goLive();
    setHasSentToObs(true);

    if (layoutMode === "fullscreen" && useLegacyObs) {
      const liveSlide = generateSlides(biblePassage, state.slideConfig)[0] ?? null;
      if (liveSlide) {
        await bibleObsService.pushSlide(
          liveSlide,
          activeTheme?.settings ?? null,
          true,
          false,
          "fullscreen"
        );
        await bibleObsService.show();
      }
    }

    triggerFlash();
    // In fullscreen mode, show a toast notification indicating the verse is in preview
    if (layoutMode === "fullscreen") {
      setToastMessage(`${book} ${chapter}:${verse} sent to preview`);
      setTimeout(() => setToastMessage(null), 3000);
    }
    // Track bible verse for service stats
    if (serviceStore.status === "live" || serviceStore.status === "preservice") {
      serviceStore.trackBibleVerse();
    }
    return true;
  }, [state.translation, state.slideConfig, dispatch, addToQueue, recordHistory, goLive, activeTheme, triggerFlash, checkServiceActive, layoutMode]);

  const syncLiveFullscreenSelection = useCallback((book: string, chapter: number, verse: number): boolean => {
    if (layoutMode !== "fullscreen") return false;
    if (!state.isLive && !hasSentToObs && fullLiveScenes.length === 0) return false;
    void sendVerseToObs(book, chapter, verse);
    return true;
  }, [layoutMode, state.isLive, hasSentToObs, fullLiveScenes.length, sendVerseToObs]);

  // Auto-select chapter 1, verse 1 when book is clicked
  const handleSelectBook = useCallback((book: string) => {
    setSelectedBook(book);
    setSelectedChapter(1);
    setSelectedVerse(1);
    setHasSentToObs(false);
  }, []);

  const handleSelectChapter = useCallback((book: string, chapter: number) => {
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setSelectedVerse(1);
    setHasSentToObs(false);
  }, []);

  const handleSelectVerse = useCallback((verse: number) => {
    setSelectedVerse(verse);
    if (!selectedBook || !selectedChapter) {
      setHasSentToObs(false);
      return;
    }
    if (!syncLiveFullscreenSelection(selectedBook, selectedChapter, verse)) {
      setHasSentToObs(false);
    }
  }, [selectedBook, selectedChapter, syncLiveFullscreenSelection]);

  // Double-click verse → always update the preview panel and push to OBS
  // In LT mode: also pushes to the LT target scene on first use
  const handleDoubleClickVerse = useCallback((verse: number) => {
    if (!selectedBook || !selectedChapter) return;
    setSelectedVerse(verse);

    // Always update preview + push to OBS
    sendVerseToObs(selectedBook, selectedChapter, verse);

    // In LT mode, also push to the LT target scene on first use;
    // the reactive effect handles subsequent updates automatically
    if (layoutMode === "lower-third" && selectedLTTheme && ltLiveScenes.length === 0 && ltTargetScene) {
      (async () => {
        setLtSending(true);
        try { await pushLtToSceneRef.current(ltTargetScene); } catch { /* logged */ }
        setLtSending(false);
      })();
    }
  }, [selectedBook, selectedChapter, sendVerseToObs, layoutMode, selectedLTTheme, ltLiveScenes, ltTargetScene]);

  // Double-click book → navigate to chapter 1 and send verse 1 to OBS
  const handleDoubleClickBook = useCallback((book: string) => {
    setSelectedBook(book);
    setSelectedChapter(1);
    setSelectedVerse(1);
    sendVerseToObs(book, 1, 1);
  }, [sendVerseToObs]);

  // Double-click chapter → navigate to that chapter and send verse 1 to OBS
  const handleDoubleClickChapter = useCallback((book: string, chapter: number) => {
    setSelectedBook(book);
    setSelectedChapter(chapter);
    setSelectedVerse(1);
    sendVerseToObs(book, chapter, 1);
  }, [sendVerseToObs]);

  // Toggle favorite for a specific verse
  const handleToggleFavoriteVerse = useCallback(async (verse: number) => {
    if (!selectedBook || !selectedChapter) return;
    const passage = await getChapter(selectedBook, selectedChapter, state.translation);
    const verseData = passage.verses.find(v => v.verse === verse);
    if (!verseData) return;
    const biblePassage: BiblePassage = {
      reference: `${selectedBook} ${selectedChapter}:${verse}`,
      book: selectedBook,
      chapter: selectedChapter,
      startVerse: verse,
      endVerse: verse,
      verses: [verseData],
      translation: state.translation,
    };
    toggleFavorite(biblePassage);
  }, [selectedBook, selectedChapter, state.translation, toggleFavorite]);

  // Toggle favorite for current verse (Ctrl+D)
  const handleToggleFavoriteCurrent = useCallback(() => {
    if (!selectedVerse) return;
    handleToggleFavoriteVerse(selectedVerse);
  }, [selectedVerse, handleToggleFavoriteVerse]);

  // Next verse — wraps to next chapter/book boundary.
  const handleNextVerse = useCallback(async () => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    let nextBook = selectedBook;
    let nextChapter = selectedChapter;
    let nextVerse = selectedVerse;

    if (selectedVerse < currentVerseCount) {
      nextVerse = selectedVerse + 1;
    } else if (selectedChapter < currentChapterCount) {
      nextChapter = selectedChapter + 1;
      nextVerse = 1;
    } else {
      const bookIndex = BIBLE_BOOKS.indexOf(selectedBook as (typeof BIBLE_BOOKS)[number]);
      if (bookIndex < 0) return;
      let found = false;
      for (let i = bookIndex + 1; i < BIBLE_BOOKS.length; i += 1) {
        const candidateBook = BIBLE_BOOKS[i];
        const chapterCount = await getChapterCount(candidateBook, state.translation);
        if (chapterCount <= 0) continue;
        const verseCount = await getVerseCount(candidateBook, 1, state.translation);
        if (verseCount <= 0) continue;
        nextBook = candidateBook;
        nextChapter = 1;
        nextVerse = 1;
        found = true;
        break;
      }
      if (!found) return;
    }

    setSelectedBook(nextBook);
    setSelectedChapter(nextChapter);
    setSelectedVerse(nextVerse);
    if (hasSentToObs) {
      void sendVerseToObs(nextBook, nextChapter, nextVerse);
    }
  }, [
    selectedBook,
    selectedChapter,
    selectedVerse,
    currentVerseCount,
    currentChapterCount,
    state.translation,
    hasSentToObs,
    sendVerseToObs,
  ]);

  const handlePrevVerse = useCallback(async () => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;

    let prevBook = selectedBook;
    let prevChapter = selectedChapter;
    let prevVerse = selectedVerse;

    if (selectedVerse > 1) {
      prevVerse = selectedVerse - 1;
    } else if (selectedChapter > 1) {
      prevChapter = selectedChapter - 1;
      const verseCount = await getVerseCount(selectedBook, prevChapter, state.translation);
      prevVerse = Math.max(1, verseCount || 1);
    } else {
      const bookIndex = BIBLE_BOOKS.indexOf(selectedBook as (typeof BIBLE_BOOKS)[number]);
      if (bookIndex <= 0) return;
      let found = false;
      for (let i = bookIndex - 1; i >= 0; i -= 1) {
        const candidateBook = BIBLE_BOOKS[i];
        const chapterCount = await getChapterCount(candidateBook, state.translation);
        if (chapterCount <= 0) continue;
        const verseCount = await getVerseCount(candidateBook, chapterCount, state.translation);
        if (verseCount <= 0) continue;
        prevBook = candidateBook;
        prevChapter = chapterCount;
        prevVerse = Math.max(1, verseCount);
        found = true;
        break;
      }
      if (!found) return;
    }

    setSelectedBook(prevBook);
    setSelectedChapter(prevChapter);
    setSelectedVerse(prevVerse);
    if (hasSentToObs) {
      void sendVerseToObs(prevBook, prevChapter, prevVerse);
    }
  }, [selectedBook, selectedChapter, selectedVerse, state.translation, hasSentToObs, sendVerseToObs]);

  // Jump by N verses (for Up/Down arrow grid row navigation)
  const GRID_ROW_SIZE = 6;

  const handleJumpVerseForward = useCallback(() => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;
    const targetV = Math.min(selectedVerse + GRID_ROW_SIZE, currentVerseCount);
    if (targetV !== selectedVerse) {
      setSelectedVerse(targetV);
      if (hasSentToObs) {
        sendVerseToObs(selectedBook, selectedChapter, targetV);
      }
    }
  }, [selectedBook, selectedChapter, selectedVerse, currentVerseCount, hasSentToObs, sendVerseToObs]);

  const handleJumpVerseBackward = useCallback(() => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return;
    const targetV = Math.max(selectedVerse - GRID_ROW_SIZE, 1);
    if (targetV !== selectedVerse) {
      setSelectedVerse(targetV);
      if (hasSentToObs) {
        sendVerseToObs(selectedBook, selectedChapter, targetV);
      }
    }
  }, [selectedBook, selectedChapter, selectedVerse, hasSentToObs, sendVerseToObs]);

  // Explicit clear: push null to OBS and clear live state
  // Also hides all OCS_BibleLT_* lower-third sources in every scene they were pushed to
  const handleClear = useCallback(async () => {
    goClear();
    setHasSentToObs(false);

    await Promise.all([
      bibleObsService.clearOverlay(fullLiveScenes.length > 0 ? fullLiveScenes : undefined).catch((err) => {
        console.warn("[BibleModule] Fullscreen clear failed:", err);
      }),
      (async () => {
        try {
          await ensureDockObsClientConnected();
          await dockObsClient.clearBible();
        } catch (err) {
          console.warn("[BibleModule] Dock Bible clear failed:", err);
        }
      })(),
    ]);
    setFullLiveScenes([]);

    // Hide lower-third sources in all scenes they were sent to
    if (obsService.isConnected && ltLiveScenes.length > 0) {
      (async () => {
        for (const sceneName of ltLiveScenes) {
          try {
            const sceneItems = await obsService.getSceneItemList(sceneName);
            for (const item of sceneItems) {
              if (OCS_BIBLE_LT_PATTERN.test(item.sourceName)) {
                await obsService.call("SetSceneItemEnabled", {
                  sceneName,
                  sceneItemId: item.sceneItemId,
                  sceneItemEnabled: false,
                });
                console.log(`[BibleModule] Clear: hidden LT "${item.sourceName}" in "${sceneName}"`);
              }
            }
          } catch (err) {
            console.warn(`[BibleModule] Clear: failed to hide LT in "${sceneName}":`, err);
          }
        }
        setLtLiveScenes([]);
      })();
    }
  }, [goClear, fullLiveScenes, ltLiveScenes]);

  // Chapter navigation (Shift+Arrow)
  const handleNextChapter = useCallback(() => {
    if (!selectedBook || !selectedChapter) return;
    if (selectedChapter < currentChapterCount) {
      const next = selectedChapter + 1;
      setSelectedChapter(next);
      setSelectedVerse(1);
      setHasSentToObs(false);
    }
  }, [selectedBook, selectedChapter, currentChapterCount]);

  const handlePrevChapter = useCallback(() => {
    if (!selectedBook || !selectedChapter) return;
    if (selectedChapter > 1) {
      const prev = selectedChapter - 1;
      setSelectedChapter(prev);
      setSelectedVerse(1);
      setHasSentToObs(false);
    }
  }, [selectedBook, selectedChapter]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      // Don't intercept keys when any modal/overlay is open or search dropdown is active
      if (showLibrary || showThemeModal || showQuickSetup || showLayoutModal) return;
      if (activeUtilityTab === "search") return;
      // Also bail if a global search overlay is present (from ServiceHubPage)
      if (document.querySelector(".gs-backdrop")) return;
      // Ctrl+D / Cmd+D → toggle favorite
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        handleToggleFavoriteCurrent();
        return;
      }
      // Cmd+1-9 / Ctrl+1-9 → switch to Nth theme
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < state.themes.length) {
          setTheme(state.themes[idx].id);
        }
        return;
      }
      // Shift+Arrow → chapter navigation
      if (e.shiftKey) {
        switch (e.key) {
          case "ArrowLeft": e.preventDefault(); handlePrevChapter(); return;
          case "ArrowRight": e.preventDefault(); handleNextChapter(); return;
          case "ArrowUp": e.preventDefault(); handlePrevChapter(); return;
          case "ArrowDown": e.preventDefault(); handleNextChapter(); return;
        }
      }
      // Arrow keys → verse navigation
      // Left/Right = move by 1 (horizontal in grid), Up/Down = jump by row (6 columns)
      switch (e.key) {
        case "ArrowRight": e.preventDefault(); void handleNextVerse(); break;
        case "ArrowLeft": e.preventDefault(); void handlePrevVerse(); break;
        case "ArrowDown": e.preventDefault(); handleJumpVerseForward(); break;
        case "ArrowUp": e.preventDefault(); handleJumpVerseBackward(); break;
        case "Escape": e.preventDefault(); handleClear(); break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActive, handleNextVerse, handlePrevVerse, handleJumpVerseForward, handleJumpVerseBackward, handleNextChapter, handlePrevChapter, handleClear, handleToggleFavoriteCurrent, state.themes, setTheme, showLibrary, showThemeModal, showQuickSetup, showLayoutModal, activeUtilityTab]);

  // Push slide to OBS — now handled by BibleProvider's global effect.
  // This keeps the live output stable across page navigations (e.g. to/from /bible/templates).

  const handleTranslationChange = useCallback((t: BibleTranslation) => {
    dispatch({ type: "SET_TRANSLATION", translation: t });
  }, [dispatch]);

  // OBS Setup
  const handleSetupObs = useCallback(async () => {
    try {
      const result = await bibleObsService.ensureBrowserSource(undefined, activeTheme?.templateType);
      alert(`Bible overlay created!\nScene: ${result.sceneName}\nItem ID: ${result.sceneItemId}`);
    } catch (err) {
      alert(`Failed to setup OBS: ${err instanceof Error ? err.message : err}`);
    }
  }, [activeTheme]);

  // Live verse range for verse list highlight
  const liveVerseRange = useMemo(() => {
    if (!state.isLive || !currentQueueItem) return null;
    if (currentQueueItem.passage.book !== selectedBook || currentQueueItem.passage.chapter !== selectedChapter) return null;
    return { start: currentQueueItem.passage.startVerse, end: currentQueueItem.passage.endVerse };
  }, [state.isLive, currentQueueItem, selectedBook, selectedChapter]);

  // Favorite references as Set for quick lookup
  const favoriteRefs = useMemo(() => new Set(state.favorites.map(f => f.reference)), [state.favorites]);

  // Handle utility tab toggle
  const toggleUtilityTab = useCallback((tab: "favorites" | "history" | "search") => {
    setActiveUtilityTab(prev => {
      const next = prev === tab ? "none" : tab;
      // Auto-focus search input when opening the search tab
      if (next === "search") {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      return next;
    });
  }, []);

  // Debounced Bible keyword search + smart reference parsing
  const handleSearchInput = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setRefMatches([]);
      setIsSearching(false);
      return;
    }

    // Immediately try smart reference parsing (synchronous, fast)
    try {
      const refs = parseBibleSearch(trimmed);
      setRefMatches(refs.map(r => ({ book: r.book, chapter: r.chapter, verse: r.verse, label: r.label })));
    } catch {
      setRefMatches([]);
    }

    // Also do keyword search (async, debounced)
    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchBible(trimmed, state.translation, 200);
        setSearchResults(results);
      } catch (err) {
        console.error("Bible search error:", err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, [state.translation]);

  // Navigate to a search result
  const handleSearchResultClick = useCallback((result: SearchResult) => {
    setSelectedBook(result.book);
    setSelectedChapter(result.chapter);
    setSelectedVerse(result.verse);
    setActiveUtilityTab("none");
    if (!syncLiveFullscreenSelection(result.book, result.chapter, result.verse)) {
      setHasSentToObs(false);
    }
  }, [syncLiveFullscreenSelection]);

  // Click a history/favorite item → navigate to that verse
  const handleJumpToPassage = useCallback((p: BiblePassage) => {
    setSelectedBook(p.book);
    setSelectedChapter(p.chapter);
    setSelectedVerse(p.startVerse);
    setActiveUtilityTab("none");
    if (!syncLiveFullscreenSelection(p.book, p.chapter, p.startVerse)) {
      setHasSentToObs(false);
    }
  }, [syncLiveFullscreenSelection]);

  // Clear history
  const handleClearHistory = useCallback(() => {
    dispatch({ type: "SET_HISTORY", history: [] });
    clearHistory().catch(console.error);
  }, [dispatch]);

  // ── Theme modal: right-click context menu handlers ──
  const handleThemeContextMenu = useCallback((e: React.MouseEvent, themeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setThemeContextMenu({ x: e.clientX, y: e.clientY, themeId });
  }, []);

  const openThemeTemplates = useCallback((routeState?: { createNew?: boolean; editThemeId?: string }) => {
    setThemeContextMenu(null);
    setShowThemeModal(false);
    setShowQuickSetup(false);
    window.setTimeout(() => {
      navigate(templatesPath, routeState ? { state: routeState } : undefined);
    }, 0);
  }, [navigate, templatesPath]);

  const handleThemeEdit = useCallback((themeId: string) => {
    openThemeTemplates({ editThemeId: themeId });
  }, [openThemeTemplates]);

  const handleThemeToggleHidden = useCallback((themeId: string) => {
    setThemeContextMenu(null);
    const theme = state.themes.find(t => t.id === themeId);
    if (!theme) return;
    dispatch({ type: "UPDATE_THEME", theme: { ...theme, hidden: !theme.hidden } });
  }, [state.themes, dispatch]);

  // ── Theme modal: drag-to-reorder handlers ──
  const handleThemeDragStart = useCallback((e: React.DragEvent, themeId: string) => {
    e.dataTransfer.effectAllowed = "move";
    setDragThemeId(themeId);
  }, []);

  const handleThemeDragOver = useCallback((e: React.DragEvent, themeId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverThemeId(themeId);
  }, []);

  const handleThemeDrop = useCallback((e: React.DragEvent, targetThemeId: string) => {
    e.preventDefault();
    if (!dragThemeId || dragThemeId === targetThemeId) {
      setDragThemeId(null);
      setDragOverThemeId(null);
      return;
    }
    const fromIndex = state.themes.findIndex(t => t.id === dragThemeId);
    const toIndex = state.themes.findIndex(t => t.id === targetThemeId);
    if (fromIndex >= 0 && toIndex >= 0) {
      dispatch({ type: "REORDER_THEMES", fromIndex, toIndex });
    }
    setDragThemeId(null);
    setDragOverThemeId(null);
  }, [dragThemeId, state.themes, dispatch]);

  const handleThemeDragEnd = useCallback(() => {
    setDragThemeId(null);
    setDragOverThemeId(null);
  }, []);

  const visibleFullThemes = useMemo(
    () => state.themes.filter((theme) => !theme.hidden && theme.templateType === "fullscreen"),
    [state.themes],
  );

  const activeFullTheme = useMemo(() => {
    const selected = visibleFullThemes.find((theme) => theme.id === state.activeThemeId);
    if (selected) return selected;
    if (activeTheme && !activeTheme.hidden && activeTheme.templateType === "fullscreen") return activeTheme;
    return visibleFullThemes[0] ?? null;
  }, [activeTheme, state.activeThemeId, visibleFullThemes]);

  useEffect(() => {
    if (layoutMode !== "fullscreen") return;
    if (visibleFullThemes.length === 0) return;
    if (visibleFullThemes.some((theme) => theme.id === state.activeThemeId)) return;
    setTheme(visibleFullThemes[0].id);
  }, [layoutMode, visibleFullThemes, state.activeThemeId, setTheme]);

  const fullThemePreviewStyle = useMemo(
    () => ({
      backgroundImage: activeFullTheme?.settings.backgroundImage
        ? `url(${activeFullTheme.settings.backgroundImage})`
        : undefined,
      backgroundColor: activeFullTheme?.settings.backgroundImage
        ? undefined
        : (activeFullTheme?.settings.backgroundColor ?? "#1a1a2e"),
      backgroundSize: "cover",
      backgroundPosition: "center",
    }),
    [activeFullTheme],
  );

  // Auto-fill LT variable values from the current Bible selection
  const ltAutoValues = useMemo(() => {
    if (!selectedLTTheme) return {};
    const verseRef = `${selectedBook} ${selectedChapter}:${selectedVerse}`;
    const vals: Record<string, string> = {};
    for (const v of selectedLTTheme.variables) {
      if (v.key === "reference") vals.reference = `${verseRef} (${state.translation})`;
      else if (v.key === "verseText") vals.verseText = ""; // filled dynamically below
      else if (v.key === "label") vals.label = v.defaultValue || "Scripture";
      else vals[v.key] = v.defaultValue || "";
    }
    return vals;
  }, [selectedLTTheme, selectedBook, selectedChapter, selectedVerse, state.translation]);

  // Fill verseText from chapter data
  const [ltVerseText, setLtVerseText] = useState("");
  useEffect(() => {
    if (!selectedBook || !selectedChapter || !selectedVerse) {
      setLtVerseText("");
      return;
    }
    let cancelled = false;
    getChapter(selectedBook, selectedChapter, state.translation).then((passage) => {
      if (cancelled) return;
      const vd = passage.verses.find(v => v.verse === selectedVerse);
      setLtVerseText(vd?.text ?? "");
    }).catch((err) => {
      if (cancelled) return;
      console.warn("[BibleModule] Failed to load lower-third verse text:", err);
      setLtVerseText("");
    });
    return () => { cancelled = true; };
  }, [selectedBook, selectedChapter, selectedVerse, state.translation]);

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

  const pushSelectedBibleViaDock = useCallback(async (live: boolean): Promise<boolean> => {
    if (!selectedBook || !selectedChapter || !selectedVerse) return false;

    const staged = await sendVerseToObs(selectedBook, selectedChapter, selectedVerse, {
      useLegacyObs: false,
    });
    if (!staged) return false;

    const overlayMode = layoutMode === "lower-third" ? "lower-third" : "fullscreen";

    await ensureDockObsClientConnected();
    await dockObsClient.pushBible({
      book: selectedBook,
      chapter: selectedChapter,
      verse: selectedVerse,
      translation: state.translation,
      verseText: ltVerseText || `${selectedBook} ${selectedChapter}:${selectedVerse}`,
      overlayMode,
      ltTheme: overlayMode === "lower-third" && selectedLTTheme
        ? { id: selectedLTTheme.id, html: selectedLTTheme.html, css: selectedLTTheme.css }
        : undefined,
      bibleThemeSettings: overlayMode === "fullscreen"
        ? (activeTheme?.settings as unknown as Record<string, unknown> | null | undefined)
        : undefined,
    }, live);

    return true;
  }, [
    selectedBook,
    selectedChapter,
    selectedVerse,
    sendVerseToObs,
    state.translation,
    ltVerseText,
    layoutMode,
    selectedLTTheme,
    activeTheme,
  ]);

  const lowerThemePreviewReference = useMemo(
    () => `${selectedBook} ${selectedChapter}:${selectedVerse} (${state.translation})`,
    [selectedBook, selectedChapter, selectedVerse, state.translation],
  );
  const lowerThemePreviewText = useMemo(
    () => (ltVerseText || "").trim() || LT_PREVIEW_FALLBACK_TEXT,
    [ltVerseText],
  );
  const selectedLowerThemePreviewDoc = useMemo(() => {
    if (!selectedLTTheme) return "";
    return buildBibleLTPreviewDoc(selectedLTTheme, lowerThemePreviewReference, lowerThemePreviewText);
  }, [selectedLTTheme, lowerThemePreviewReference, lowerThemePreviewText]);

  // Handle selecting a LT Bible theme
  const handleSelectLTTheme = useCallback((ltTheme: LowerThirdTheme) => {
    setSelectedLTTheme(ltTheme);
    setLayoutMode("lower-third");
    loadLtScenes();
    setShowThemeModal(false);
  }, [loadLtScenes]);

  // Helper: push LT overlay to a specific scene
  const pushLtToScene = useCallback(async (sceneName: string) => {
    if (!selectedLTTheme) return;
    const values = { ...ltAutoValues, verseText: ltVerseText };
    const sourceName = `OCS_BibleLT_${sceneName}`;

    try {
      // Check if source already exists in OBS
      const inputs = await obsService.getInputList();
      const existing = inputs.find(i => i.inputName === sourceName);
      if (!existing) {
        // Create a new browser source in the target scene
        const url = buildOverlayUrl(selectedLTTheme, values, true, false, ltSize);
        const sceneItemId = await obsService.createInput(sceneName, sourceName, "browser_source", {
          url,
          width: 1920,
          height: 1080,
          css: "",
        });
        // Move it to the top (highest z-index)
        const items = await obsService.getSceneItemList(sceneName);
        await obsService.setSceneItemIndex(sceneName, sceneItemId, items.length - 1);
      } else {
        // Source exists — check if it's in this scene already
        const sceneItems = await obsService.getSceneItemList(sceneName);
        const inScene = sceneItems.find(si => si.sourceName === sourceName);
        if (!inScene) {
          // Add existing source to this scene
          const sceneItemId = await obsService.createSceneItem(sceneName, sourceName);
          const items = await obsService.getSceneItemList(sceneName);
          await obsService.setSceneItemIndex(sceneName, sceneItemId, items.length - 1);
        }
        // Update the URL
        const url = buildOverlayUrl(selectedLTTheme, values, true, false, ltSize);
        await obsService.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings: { url, width: 1920, height: 1080 },
        });
      }

      // ── Hide competing LT sources & enable ours ──
      // Get all scene items and hide any other OCS_LT_, OCS_BibleLT_, or MV_*_LT: sources
      const sceneItems = await obsService.getSceneItemList(sceneName);
      for (const item of sceneItems) {
        if (item.sourceName === sourceName) {
          // Enable our source
          await obsService.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemEnabled: true,
          });
        } else if (
          OCS_LT_PATTERN.test(item.sourceName) ||
          MV_LT_PATTERN.test(item.sourceName) ||
          OCS_BIBLE_LT_PATTERN.test(item.sourceName)
        ) {
          // Hide other LT sources
          try {
            await obsService.call("SetSceneItemEnabled", {
              sceneName,
              sceneItemId: item.sceneItemId,
              sceneItemEnabled: false,
            });
            console.log(`[BibleModule] Hidden competing LT "${item.sourceName}" in "${sceneName}"`);
          } catch { /* best effort */ }
        }
      }
    } catch (err) {
      console.error(`[BibleModule] Failed to push LT to "${sceneName}":`, err);
      throw err;
    }
    try {
      await lowerThirdObsService.syncTickerClearanceForScene(sceneName);
    } catch {
      // Best-effort.
    }
    // Track this scene as having an active LT source
    setLtLiveScenes(prev => prev.includes(sceneName) ? prev : [...prev, sceneName]);
  }, [selectedLTTheme, ltAutoValues, ltVerseText, ltSize]);

  // Stable ref for pushLtToScene so handlers defined earlier can use it
  const pushLtToSceneRef = useRef(pushLtToScene);
  pushLtToSceneRef.current = pushLtToScene;

  const handleLtSendToScene = useCallback(async (
    sceneName: string,
    mode: "scene" | "preview" | "program" = "scene",
  ) => {
    if (!selectedLTTheme || !selectedBook || !selectedChapter || !selectedVerse) return;
    if (!checkServiceActive("send bible lower-third to OBS")) return;

    const dockLive = await resolveDockSendLive(sceneName, mode);
    if (dockLive !== null) {
      setLtTargetScene(sceneName);
      setLtSending(true);
      try {
        const sent = await pushSelectedBibleViaDock(dockLive);
        if (!sent) return;
        setLtLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
        triggerFlash();
        setHasSentToObs(true);
      } catch (err) {
        console.warn(`[BibleModule] Dock lower-third send failed for "${sceneName}":`, err);
      } finally {
        setLtSending(false);
      }
      return;
    }

    const resolvedSceneName = await restoreFromBibleFullscreenIfNeeded(mode, sceneName);
    setLtTargetScene(resolvedSceneName);

    setLtSending(true);
    try {
      await disableFullscreenBibleSourcesInScene(resolvedSceneName);
      await pushLtToScene(resolvedSceneName);
      triggerFlash();
      setHasSentToObs(true);
    } catch { /* logged in pushLtToScene */ }
    setLtSending(false);
  }, [
    selectedLTTheme,
    selectedBook,
    selectedChapter,
    selectedVerse,
    checkServiceActive,
    resolveDockSendLive,
    pushSelectedBibleViaDock,
    restoreFromBibleFullscreenIfNeeded,
    disableFullscreenBibleSourcesInScene,
    pushLtToScene,
    triggerFlash,
  ]);

  const handleFullSendToScene = useCallback(async (
    sceneName: string,
    mode: "scene" | "preview" | "program" = "scene",
  ) => {
    if (!obsConnected || !selectedBook || !selectedChapter || !selectedVerse) return;
    if (!checkServiceActive("send bible full overlay to OBS")) return;

    const dockLive = await resolveDockSendLive(sceneName, mode);
    if (dockLive !== null) {
      setLtSending(true);
      try {
        const sent = await pushSelectedBibleViaDock(dockLive);
        if (!sent) return;
        setFullLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
        triggerFlash();
      } catch (err) {
        console.warn(`[BibleModule] Dock fullscreen send failed for "${sceneName}":`, err);
      } finally {
        setLtSending(false);
      }
      return;
    }

    setLtSending(true);
    try {
      if (mode === "program") {
        const currentProgram = await obsService.getCurrentProgramScene().catch(() => "");
        if (currentProgram) {
          lastNonBibleProgramSceneRef.current = currentProgram;
        }
      } else if (mode === "preview") {
        const currentPreview = await obsService.getCurrentPreviewScene().catch(() => "");
        if (currentPreview) {
          lastNonBiblePreviewSceneRef.current = currentPreview;
        }
      }
      await bibleObsService.ensureBrowserSource(sceneName, "fullscreen");
      const sent = await sendVerseToObs(selectedBook, selectedChapter, selectedVerse);
      if (!sent) return;
      await bibleObsService.show();
      setFullLiveScenes((prev) => (prev.includes(sceneName) ? prev : [...prev, sceneName]));
      triggerFlash();
    } catch (err) {
      console.warn(`[BibleModule] Failed to send fullscreen Bible overlay to "${sceneName}":`, err);
    } finally {
      setLtSending(false);
    }
  }, [
    obsConnected,
    selectedBook,
    selectedChapter,
    selectedVerse,
    checkServiceActive,
    resolveDockSendLive,
    pushSelectedBibleViaDock,
    sendVerseToObs,
    triggerFlash,
  ]);

  // ── Real-time LT update: when verse changes and LT is live, auto-push ──
  const ltLiveScenesRef = useRef(ltLiveScenes);
  ltLiveScenesRef.current = ltLiveScenes;
  const selectedLTThemeRef = useRef(selectedLTTheme);
  selectedLTThemeRef.current = selectedLTTheme;
  const ltSizeRef = useRef(ltSize);
  ltSizeRef.current = ltSize;

  useEffect(() => {
    const scenes = ltLiveScenesRef.current;
    const theme = selectedLTThemeRef.current;
    if (!theme || scenes.length === 0 || !ltVerseText || !obsService.isConnected) return;

    const verseRef = `${selectedBook} ${selectedChapter}:${selectedVerse} (${state.translation})`;
    const values: Record<string, string> = {};
    for (const v of theme.variables) {
      if (v.key === "reference") values.reference = verseRef;
      else if (v.key === "verseText") values.verseText = ltVerseText;
      else if (v.key === "label") values.label = v.defaultValue || "Scripture";
      else values[v.key] = v.defaultValue || "";
    }
    const url = buildOverlayUrl(theme, values, true, false, ltSizeRef.current);

    // Update all live scenes
    for (const sceneName of scenes) {
      const sourceName = `OCS_BibleLT_${sceneName}`;
      obsService.call("SetInputSettings", {
        inputName: sourceName,
        inputSettings: { url, width: 1920, height: 1080 },
      }).catch(err => console.warn(`[BibleModule] LT auto-update failed for "${sceneName}":`, err));
    }
  }, [ltVerseText, selectedBook, selectedChapter, selectedVerse, state.translation]);

  // ── Colour mode class computation ──
  const effectiveColorMode = useMemo(() => {
    if (state.colorMode === "system") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return state.colorMode;
  }, [state.colorMode]);

  const rootClassName = useMemo(() => {
    const parts = ["bible-home"];
    if (effectiveColorMode === "light") parts.push("light-mode");
    if (state.reduceMotion) parts.push("reduce-motion");
    if (state.highContrast) parts.push("high-contrast");
    return parts.join(" ");
  }, [effectiveColorMode, state.reduceMotion, state.highContrast]);

  const activeModeLiveScenes = layoutMode === "fullscreen" ? fullLiveScenes : ltLiveScenes;
  const modeSendLabel = layoutMode === "fullscreen" ? "Send Full" : "Send Lower";
  const canSendSelectedVerse = Boolean(selectedBook && selectedChapter && selectedVerse);

  return (
    <div
      id="bible-module-root"
      className={`${rootClassName} bible-style-root${sendFlash ? " bible-send-flash" : ""}`}
      data-module="bible"
    >
      {/* ═══ HEADER ═══ */}
      <div id="bible-header" className="bible-header bible-style-header">
        <div className="bible-header-left">
          <button className="bible-nav-btn" onClick={() => navigate(homePath)} title="Back to Layouts">
            <Icon name="arrow_back" size={20} />
            Layouts
          </button>
          <span className="bible-header-divider" />
          <span className="bible-header-title">
            <Icon name="menu_book" size={20} />
            Bible
          </span>
          <span className="bible-header-divider" />
          {/* Translation switcher */}

          {/* Bible Library button */}
          <button
            className="bible-header-icon-btn"
            onClick={() => setShowLibrary(true)}
            title="Bible Library — Download translations"
          >
            <Icon name="library_books" size={20} />
          </button>
        </div>

        {/* <div className="bible-header-center">
          <span className="bible-now-displaying">{nowDisplaying}</span>
        </div> */}

        <div className="bible-header-right">
          {/* Show Bible fullscreen in OBS */}
          {/* <button
            className="bible-header-fullscreen-btn"
            onClick={handleShowBibleFullscreen}
            disabled={!obsConnected}
            title="Show Bible fullscreen in OBS"
          >
            <Icon name="cast" size={20} />
            Show in OBS
          </button> */}

          {/* OBS Status chip */}
          {/* <div className={`bible-obs-status ${obsConnected ? "connected" : ""}`}>
            <span className="bible-obs-dot" />
            <span>OBS {obsConnected ? "Connected" : "Disconnected"}</span>
          </div> */}

          {/* Blank indicator */}
          {state.isBlanked && (
            <div className="bible-blank-indicator" title="Screen is blanked">
              <Icon name="visibility_off" size={20} />
            </div>
          )}
<div className="bible-footer-left">
          <button
            className={`bible-footer-btn blank ${state.isBlanked ? "active" : ""}`}
            onClick={() => goBlank()}
            title="Blank screen (B)"
          >
            <Icon name={state.isBlanked ? "visibility" : "visibility_off"} size={20} />
            {state.isBlanked ? "Show" : "Blank"}
          </button>
          <button
            className="bible-footer-btn clear"
            onClick={() => handleClear()}
            title="Clear output (Esc)"
          >
            <Icon name="block" size={20} />
            Clear
          </button>
        </div>
          {/* Toggle right sidebar */}
          <button
            className="bible-footer-btn clear"
            onClick={() => {
              setShowPreview((prev) => {
                const next = !prev;
                if (next && rightPanelWidth < RIGHT_PANEL_MIN_WIDTH) {
                  setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH);
                }
                return next;
              });
            }}
            title={showPreview ? "Hide sidebar" : "Show sidebar"}
          >
            <Icon name={showPreview ? "chevron_right" : "chevron_left"} size={20} />
            {showPreview ? "Hide Sidebar" : "Show Sidebar"}
          </button>
        </div>
      </div>

      {/* ═══ MAIN BODY ═══ */}
      <div id="bible-main" className="bible-main bible-style-main">
        {/* LEFT — Verse List + Theme Trigger + Layout & Motion */}

        <aside
          id="bible-left-panel"
          className={`bible-left-panel bible-style-panel bible-style-panel-left${leftPanelCollapsed ? " collapsed" : ""}`}
          style={{
            width: leftPanelCollapsed ? 0 : leftPanelWidth,
            minWidth: leftPanelCollapsed ? 0 : leftPanelWidth,
          }}
        >

          <div id="bible-left-panel-verses" className="bible-left-panel-verses bible-style-panel-content">
            <VerseListPanel
              translation={state.translation}
              book={selectedBook}
              chapter={selectedChapter}
              selectedVerse={selectedVerse}
              liveVerseRange={liveVerseRange}
              favoriteRefs={favoriteRefs}
              installedTranslations={installedTranslations}
              onTranslationChange={handleTranslationChange}
              onSelectVerse={handleSelectVerse}
              onDoubleClickVerse={handleDoubleClickVerse}
              onToggleFavorite={handleToggleFavoriteVerse}
              onOpenLibrary={() => setShowLibrary(true)}
              sentVerse={hasSentToObs ? selectedVerse : null}
            />
          </div>
        </aside>

        <div
          className={`bible-sidebar-resizer left${leftPanelCollapsed ? " collapsed" : ""}`}
          onMouseDown={(e) => beginSidebarResize("left", e)}
          title="Drag to resize left sidebar"
          role="separator"
          aria-orientation="vertical"
        />

        {/* CENTER — Utility Strip + Book & Chapter Grid */}
        <main id="bible-center-panel" className="bible-center-panel bible-style-panel bible-style-panel-center">
          {/* Utility Strip — Favorites + History */}
          <div className="bible-utility-strip">
            <span className="bible-utility-breadcrumb">
              {selectedBook} › Ch {selectedChapter} › v{selectedVerse}
            </span>
            <span className="bible-utility-spacer" />
            <div className="bible-utility-tabs">
              <button
                className={`bible-utility-tab${activeUtilityTab === "favorites" ? " active" : ""}`}
                onClick={() => toggleUtilityTab("favorites")}
              >
                <Icon name="star" size={20} />
                Favorites
                {state.favorites.length > 0 && (
                  <span className="bible-utility-tab-badge">{state.favorites.length}</span>
                )}
              </button>
              <button
                className={`bible-utility-tab${activeUtilityTab === "history" ? " active" : ""}`}
                onClick={() => toggleUtilityTab("history")}
              >
                <Icon name="history" size={20} />
                History
                {state.history.length > 0 && (
                  <span className="bible-utility-tab-badge">{state.history.length}</span>
                )}
              </button>
              <button
                className={`bible-utility-tab${activeUtilityTab === "search" ? " active" : ""}`}
                onClick={() => toggleUtilityTab("search")}
              >
                <Icon name="search" size={20} />
                Search
                {searchResults.length > 0 && (
                  <span className="bible-utility-tab-badge">{searchResults.length}</span>
                )}
              </button>
            </div>
          </div>

          {/* Favorites dropdown */}
          {activeUtilityTab === "favorites" && (
            <div className="bible-utility-dropdown b-scroll">
              <div className="bible-utility-dropdown-header">
                <span className="bible-utility-dropdown-title">Favorites</span>
              </div>
              <div className="bible-utility-list">
                {state.favorites.length === 0 ? (
                  <div className="bible-utility-empty">
                    No favorites yet — press <kbd>Ctrl+D</kbd> or click the ★ on a verse
                  </div>
                ) : (
                  state.favorites.slice(0, 5).map((fav) => (
                    <div
                      key={fav.reference}
                      className="bible-utility-item"
                      onClick={() => handleJumpToPassage(fav)}
                    >
                      <Icon name="star" size={20} className="bible-utility-item-icon fav" />
                      <span className="bible-utility-item-ref">{fav.reference}</span>
                      <button
                        className="bible-utility-item-remove"
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(fav); }}
                        title="Remove"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* History dropdown */}
          {activeUtilityTab === "history" && (
            <div className="bible-utility-dropdown b-scroll">
              <div className="bible-utility-dropdown-header">
                <span className="bible-utility-dropdown-title">History</span>
                {state.history.length > 0 && (
                  <button className="bible-utility-dropdown-action" onClick={handleClearHistory}>
                    Clear All
                  </button>
                )}
              </div>
              <div className="bible-utility-list">
                {state.history.length === 0 ? (
                  <div className="bible-utility-empty">
                    No history yet — verses you send to OBS will appear here
                  </div>
                ) : (
                  state.history.slice(0, 5).map((entry, idx) => (
                    <div
                      key={`${entry.reference}-${idx}`}
                      className="bible-utility-item"
                      onClick={() => handleJumpToPassage(entry)}
                    >
                      <Icon name="schedule" size={20} className="bible-utility-item-icon" />
                      <span className="bible-utility-item-ref">{entry.reference}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Search dropdown */}
          {activeUtilityTab === "search" && (
            <div className="bible-utility-dropdown bible-search-dropdown b-scroll">
              <div className="bible-search-input-row">
                <Icon name="search" size={18} className="bible-search-input-icon" />
                <input
                  ref={searchInputRef}
                  className="bible-search-input"
                  type="text"
                  placeholder="Search Bible… (e.g. &quot;jhn316&quot;, &quot;grace&quot;, &quot;love your neighbor&quot;)"
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <button
                    className="bible-search-clear-btn"
                    onClick={() => { setSearchQuery(""); setSearchResults([]); setRefMatches([]); searchInputRef.current?.focus(); }}
                    title="Clear search"
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>

              {/* Smart reference matches (e.g. "jhn1623" → John 16:23) */}
              {refMatches.length > 0 && (
                <div className="bible-search-ref-section">
                  <div className="bible-search-ref-header">
                    <Icon name="menu_book" size={14} />
                    Go to reference
                  </div>
                  <div className="bible-search-ref-list">
                    {refMatches.map((ref, idx) => (
                      <button
                        key={`ref-${ref.label}-${idx}`}
                        className="bible-search-ref-chip"
                        onClick={() => {
                          const chapter = ref.chapter ?? 1;
                          const verse = ref.verse ?? 1;
                          setSelectedBook(ref.book);
                          setSelectedChapter(chapter);
                          setSelectedVerse(verse);
                          setActiveUtilityTab("none");
                          if (!syncLiveFullscreenSelection(ref.book, chapter, verse)) {
                            setHasSentToObs(false);
                          }
                        }}
                        onDoubleClick={() => {
                          const book = ref.book;
                          const chapter = ref.chapter ?? 1;
                          const verse = ref.verse ?? 1;
                          setSelectedBook(book);
                          setSelectedChapter(chapter);
                          setSelectedVerse(verse);
                          setActiveUtilityTab("none");
                          sendVerseToObs(book, chapter, verse);
                        }}
                      >
                        <Icon name="arrow_forward" size={14} />
                        {ref.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isSearching && (
                <div className="bible-search-status">
                  <span className="bible-search-spinner" />
                  Searching…
                </div>
              )}
              {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && refMatches.length === 0 && (
                <div className="bible-search-status">
                  No results found for &ldquo;{searchQuery.trim()}&rdquo;
                </div>
              )}
              {!isSearching && searchResults.length > 0 && (
                <>
                  <div className="bible-search-result-count">
                    {searchResults.length >= 200 ? "200+ results" : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}`}
                    <span className="bible-search-result-hint"> — click to navigate, double-click to send to OBS</span>
                  </div>
                  <div className="bible-search-results">
                    {searchResults.map((r, idx) => (
                      <div
                        key={`${r.book}-${r.chapter}-${r.verse}-${idx}`}
                        className="bible-search-result-item"
                        onClick={() => handleSearchResultClick(r)}
                        onDoubleClick={() => {
                          setSelectedBook(r.book);
                          setSelectedChapter(r.chapter);
                          setSelectedVerse(r.verse);
                          setActiveUtilityTab("none");
                          sendVerseToObs(r.book, r.chapter, r.verse);
                        }}
                      >
                        <span className="bible-search-result-ref">
                          {r.book} {r.chapter}:{r.verse}
                        </span>
                        <span
                          className="bible-search-result-snippet"
                          dangerouslySetInnerHTML={{
                            __html: r.snippet.replace(
                              new RegExp(`(${searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
                              '<mark class="bible-search-highlight">$1</mark>'
                            ),
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <BookChapterPanel
            translation={state.translation}
            selectedBook={selectedBook}
            selectedChapter={selectedChapter}
            selectedVerse={selectedVerse}
            onSelectBook={handleSelectBook}
            onSelectChapter={handleSelectChapter}
            onSelectVerse={handleSelectVerse}
            onDoubleClickVerse={handleDoubleClickVerse}
            onDoubleClickBook={handleDoubleClickBook}
            onDoubleClickChapter={handleDoubleClickChapter}
          />
        </main>

        {/* RIGHT — Controls sidebar */}
        <div
          className={`bible-sidebar-resizer right${!showPreview ? " collapsed" : ""}`}
          onMouseDown={(e) => beginSidebarResize("right", e)}
          title="Drag to resize right sidebar"
          role="separator"
          aria-orientation="vertical"
        />

        <aside
          id="bible-right-panel"
          className={`bible-right-panel bible-style-panel bible-style-panel-right${!showPreview ? " collapsed" : ""}`}
          style={{
            width: showPreview ? rightPanelWidth : 0,
            minWidth: showPreview ? rightPanelWidth : 0,
          }}
        >
          {/* ── Preview ── */}
          <div className="bible-right-section bible-right-preview-section">
            <SlidePreview onClose={() => setShowPreview(false)} />
          </div>

          {/* ── Layout & Motion ── */}
          <div className="bible-right-section bible-layout-section">
            <div className="bible-layout-header">
              <Icon name="view_quilt" size={20} />
              <span className="bible-layout-header-label">Layout & Motion</span>
            </div>
            <div className="bible-layout-modes">
              <button
                className={`bible-layout-mode-btn${layoutMode === "fullscreen" ? " active" : ""}`}
                onClick={() => handleLayoutClick("fullscreen")}
              >
                <Icon name="fullscreen" size={20} />
                Full
              </button>
              <button
                className={`bible-layout-mode-btn${layoutMode === "lower-third" ? " active" : ""}`}
                onClick={() => handleLayoutClick("lower-third")}
              >
                <Icon name="subtitles" size={20} />
                Lower
              </button>
            </div>

            {layoutMode === "fullscreen" && (
              <>
                <label className="bible-right-label">Full Theme (1-4 keys)</label>
                <div
                  className="bible-theme-selector"
                  onClick={() => setShowThemeModal(true)}
                >
                  <div className="bible-theme-preview-thumb" style={fullThemePreviewStyle} />
                  <span className="bible-theme-name">{activeFullTheme?.name ?? "Theme"}</span>
                  <Icon name="expand_more" size={20} />
                </div>
              </>
            )}

            {layoutMode === "lower-third" && (
              <>
                <label className="bible-right-label">Lower Theme</label>
                <div
                  className="bible-theme-selector"
                  onClick={() => setShowThemeModal(true)}
                >
                  <div className="bible-theme-preview-thumb bible-theme-preview-thumb--lt">
                    {selectedLowerThemePreviewDoc ? (
                      <iframe
                        className="bible-theme-preview-frame"
                        srcDoc={selectedLowerThemePreviewDoc}
                        title={`${selectedLTTheme?.name ?? "Lower theme"} preview`}
                        sandbox="allow-same-origin"
                      />
                    ) : (
                      <Icon name="subtitles" size={20} />
                    )}
                  </div>
                  <span className="bible-theme-name">{selectedLTTheme?.name ?? "Theme"}</span>
                  <Icon name="expand_more" size={20} />
                </div>
                <span className="bible-inline-hint">
                  Lower mode uses Bible lower-third themes when sending to OBS scenes.
                </span>
              </>
            )}

            <div className="bible-lt-sidebar">
              {layoutMode === "lower-third" && selectedLTTheme && (
                <div className="bible-lt-sidebar-field">
                  <label>Size</label>
                  <select
                    className="bible-lt-sidebar-select"
                    value={ltSize}
                    onChange={(e) => setLtSize(e.target.value as LTSize)}
                  >
                    <option value="sm">Small</option>
                    <option value="md">Medium</option>
                    <option value="lg">Large</option>
                    <option value="xl">XL</option>
                    <option value="2xl">2XL</option>
                    <option value="3xl">3XL</option>
                  </select>
                </div>
              )}
              {layoutMode === "lower-third" && !selectedLTTheme && (
                <p className="bible-lt-sidebar-scene-empty">
                  Choose a lower-third theme to send Bible overlays to OBS scenes.
                </p>
              )}

              <ObsScenesPanel
                title="OBS Scenes (Full & Lower)"
                contentLabel={layoutMode === "fullscreen" ? "full Bible overlay" : "Bible lower-third"}
                description={`These are your current scenes in OBS. Click ${modeSendLabel} on any scene, or use Preview/Program for the current OBS targets.`}
                connected={obsConnected}
                scenes={ltScenes.map((sceneName, sceneIndex) => ({ sceneName, sceneIndex }))}
                mainScene={serviceStore.sceneMapping.mainScene}
                previewScene={ltPreviewScene}
                programScene={ltProgramScene}
                activeScenes={activeModeLiveScenes}
                refreshing={ltScenesRefreshing}
                disabled={ltSending || !canSendSelectedVerse || (layoutMode === "lower-third" && !selectedLTTheme)}
                sendLabel={modeSendLabel}
                onRefresh={handleRefreshLtScenes}
                onSendToScene={async (sceneName, mode) => {
                  if (layoutMode === "fullscreen") {
                    await handleFullSendToScene(sceneName, mode);
                  } else {
                    await handleLtSendToScene(sceneName, mode);
                  }
                  triggerFlash();
                }}
              />

              {activeModeLiveScenes.length > 0 && (
                <div className="bible-lt-sidebar-live-indicator">
                  <span className="bible-lt-sidebar-live-dot" />
                  <span>Live on {activeModeLiveScenes.length} scene{activeModeLiveScenes.length !== 1 ? "s" : ""} — updates in real-time</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Pro Tools ── */}
          {/* <div className="bible-right-section bible-right-pro">
            <div className="bible-layout-header">
              <Icon name="build" size={20} />
              <span className="bible-layout-header-label">Pro Tools</span>
            </div>
            <div className="bible-right-pro-actions">
              <button className="bible-right-pro-btn" onClick={handleSetupObs} title="Setup OBS Browser Source">
                <Icon name="settings_input_antenna" size={20} />
                OBS Setup
              </button>
              <button className="bible-right-pro-btn" onClick={() => navigate(templatesPath)} title="Theme Settings">
                <Icon name="palette" size={20} />
                Themes
              </button>
              <button className="bible-right-pro-btn" onClick={() => navigate(settingsPath)} title="General Settings">
                <Icon name="settings" size={20} />
                Settings
              </button>
              <button className="bible-right-pro-btn" onClick={() => setShowQuickSetup(!showQuickSetup)} title="Quick Service Setup">
                <Icon name="bolt" size={20} />
                Quick Setup
              </button>
            </div>
          </div> */}
        </aside>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div id="bible-footer" className="bible-footer bible-style-footer">




        <div className="bible-footer-right">
          <div className="bible-footer-hints">
            <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span><kbd>Shift+←</kbd><kbd>↓</kbd> Prev Ch.</span>
            <span><kbd>Shift+→</kbd><kbd>↑</kbd> Next Ch.</span>
            <span><kbd>Dbl-click</kbd> Send to OBS</span>
            <span><kbd>⌘/Ctrl+1-9</kbd> Theme</span>
            <span><kbd>Ctrl+D</kbd> Favorite</span>
            <span><kbd>B</kbd> Blank</span>
            <span><kbd>Esc</kbd> Clear</span>
          </div>
        </div>
      </div>

      {/* ═══ THEME PICKER MODAL ═══ */}
      {showThemeModal && (
        <div className="bible-modal-overlay" onClick={() => { setShowThemeModal(false); setThemeContextMenu(null); }}>
          <div className="bible-modal" onClick={(e) => { e.stopPropagation(); setThemeContextMenu(null); }}>
            <div className="bible-modal-header">
              <Icon name={layoutMode === "lower-third" ? "subtitles" : "palette"} size={20} />
              <h3>{layoutMode === "lower-third" ? "Choose Lower Third Theme" : "Choose Theme"}</h3>
              <button className="bible-modal-close" onClick={() => setShowThemeModal(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="bible-modal-body">
              {/* ── Full / Default Themes (only when layoutMode === fullscreen) ── */}
              {layoutMode === "fullscreen" && (
                <div className="bible-theme-modal-grid">
                  {visibleFullThemes.map((theme, idx) => {
                    const isActive = theme.id === state.activeThemeId;
                    const bgImg = theme.settings.backgroundImage;
                    const isDragOver = dragOverThemeId === theme.id && dragThemeId !== theme.id;
                    return (
                      <div
                        key={theme.id}
                        className={`bible-theme-modal-card${isActive ? " active" : ""}${isDragOver ? " drag-over" : ""}`}
                        onClick={() => { setTheme(theme.id); setShowThemeModal(false); }}
                        onContextMenu={(e) => handleThemeContextMenu(e, theme.id)}
                        draggable
                        onDragStart={(e) => handleThemeDragStart(e, theme.id)}
                        onDragOver={(e) => handleThemeDragOver(e, theme.id)}
                        onDrop={(e) => handleThemeDrop(e, theme.id)}
                        onDragEnd={handleThemeDragEnd}
                        style={{ opacity: dragThemeId === theme.id ? 0.4 : 1 }}
                      >
                        <div
                          className="bible-theme-modal-preview"
                          style={{
                            backgroundImage: bgImg ? `url(${bgImg})` : undefined,
                            backgroundColor: bgImg ? undefined : theme.settings.backgroundColor,
                            color: theme.settings.fontColor,
                            fontFamily: theme.settings.fontFamily,
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>John 3:16</span>
                          <span style={{ fontSize: 9, opacity: 0.5 }}>Preview</span>
                        </div>
                        <div className="bible-theme-modal-name">{theme.name}</div>
                        {idx < 9 && (
                          <div className="bible-theme-modal-shortcut">
 {isMac ? "⌘" : "Ctrl+"}{idx + 1}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Lower Third Bible Themes (only when layoutMode === lower-third) ── */}
              {layoutMode === "lower-third" && BIBLE_LOWER_THIRD_THEMES.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 11, fontWeight: 700, color: "var(--b-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon name="subtitles" size={14} />
                    Lower Third Overlays
                  </h4>
                  <div className="bible-theme-modal-grid">
                    {BIBLE_LOWER_THIRD_THEMES.map((ltTheme: LowerThirdTheme) => {
                      const isSelected = selectedLTTheme?.id === ltTheme.id;
                      return (
                        <div
                          key={ltTheme.id}
                          className={`bible-theme-modal-card${isSelected ? " active" : ""}`}
                          onClick={() => handleSelectLTTheme(ltTheme)}
                          title={ltTheme.name}
                        >
                          <div
                            className="bible-theme-modal-preview"
                            style={{
                              background: ltTheme.accentColor,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Icon name={ltTheme.icon} size={20} style={{ color: "#fff" }} />
                          </div>
                          <div className="bible-theme-modal-name">{ltTheme.name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="bible-modal-footer">
              <button type="button" className="bible-modal-secondary" onClick={() => openThemeTemplates({ createNew: true })}>
                Create Theme
              </button>
              <button type="button" className="bible-modal-secondary" onClick={() => openThemeTemplates()}>
                Manage Themes
              </button>
              <button type="button" className="bible-modal-done" onClick={() => setShowThemeModal(false)}>
                Done
              </button>
            </div>
          </div>

          {/* ── Right-click context menu ── */}
          {themeContextMenu && (
            <div
              className="bible-theme-context-menu"
              style={{ top: themeContextMenu.y, left: themeContextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="bible-theme-context-item"
                onClick={() => handleThemeEdit(themeContextMenu.themeId)}
              >
                <Icon name="edit" size={20} />
                Edit Theme
              </button>
              <button
                className="bible-theme-context-item"
                onClick={() => handleThemeToggleHidden(themeContextMenu.themeId)}
              >
                <Icon name="visibility_off" size={20} />
                Hide Theme
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ LAYOUT CONFIRMATION MODAL ═══ */}
      {showLayoutModal && (
        <div className="bible-modal-overlay" onClick={cancelLayoutChange}>
          <div className="bible-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bible-modal-header">
              <Icon name="view_quilt" size={20} />
              <h3>Change Layout</h3>
              <button className="bible-modal-close" onClick={cancelLayoutChange}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="bible-modal-body">
              <p style={{ fontSize: 13, color: "var(--b-text-2)", lineHeight: 1.6 }}>
                This will change the overlay layout on OBS to <strong>{pendingLayoutMode === "fullscreen" ? "Fullscreen" : pendingLayoutMode === "lower-third" ? "Lower Third" : "Scene"}</strong>. The change will reflect immediately on your live output.
              </p>
              <p style={{ fontSize: 13, color: "var(--b-text-2)", marginTop: 12 }}>
                Do you want to continue?
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 11, color: "var(--b-text-3)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={skipLayoutConfirm}
                  onChange={(e) => {
                    setSkipLayoutConfirm(e.target.checked);
                    localStorage.setItem("bible-skip-layout-confirm", String(e.target.checked));
                  }}
                />
                Do not show this again
              </label>
            </div>
            <div className="bible-modal-footer">
              <button className="bible-modal-done" onClick={cancelLayoutChange} style={{ background: "var(--b-tile)" }}>
                Cancel
              </button>
              <button className="bible-modal-done" onClick={confirmLayoutChange}>
                Yes, Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Setup Wizard Modal */}
      {showQuickSetup && (
        <div className="bible-modal-overlay" onClick={() => setShowQuickSetup(false)}>
          <div className="bible-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bible-modal-header">
              <Icon name="bolt" size={20} />
              <h3>Quick Service Setup</h3>
              <button className="bible-modal-close" onClick={() => setShowQuickSetup(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="bible-modal-body">
              <div className="bible-setup-step">
                <span className="bible-setup-step-num">1</span>
                <div className="bible-setup-step-content">
                  <h4>OBS Scene</h4>
                  <p>Browser source will be created automatically</p>
                  <button className="bible-setup-action" onClick={handleSetupObs}>
                    <Icon name="add_circle" size={20} />
                    Create Bible Overlay in OBS
                  </button>
                </div>
              </div>
              <div className="bible-setup-step">
                <span className="bible-setup-step-num">2</span>
                <div className="bible-setup-step-content">
                  <h4>Theme</h4>
                  <p>Choose a visual theme for your overlay</p>
                  <button type="button" className="bible-setup-action" onClick={() => openThemeTemplates()}>
                    <Icon name="palette" size={20} />
                    Select Theme
                  </button>
                </div>
              </div>
              <div className="bible-setup-step">
                <span className="bible-setup-step-num">3</span>
                <div className="bible-setup-step-content">
                  <h4>Ready!</h4>
                  <p>Double-click any verse to send it live</p>
                </div>
              </div>
            </div>
            <div className="bible-modal-footer">
              <button className="bible-modal-done" onClick={() => setShowQuickSetup(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BIBLE LIBRARY MODAL ═══ */}
      <BibleLibrary
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onTranslationsChanged={refreshInstalledTranslations}
      />

      {/* ═══ TOAST NOTIFICATION ═══ */}
      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: "#1E1E1E",
          color: "#fff",
          padding: "10px 20px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.08)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 8,
          animation: "fadeInUp 0.3s ease",
        }}>
          <Icon name="check_circle" size={16} style={{ color: "#00E676" }} />
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default BibleModule;
