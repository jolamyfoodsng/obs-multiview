/**
 * MVCanvas.tsx — Konva-based Canvas for the Multi-View Editor
 *
 * v6: Edge resize handles, live OBS thumbnails, context menu, delete modal.
 *   - Template slots are LOCKED in position but RESIZABLE from edges
 *   - Scene can be deleted from slot (slot stays), with confirmation modal
 *   - Right-click context menu: "Delete Scene" / "Change Scene"
 *   - Live OBS screenshots replace colored rectangles for assigned scenes
 */

import { useRef, useCallback, useEffect, useState, type JSX } from "react";
import { Stage, Layer, Rect, Group, Text, Line, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { useEditor } from "../editorStore";
import { regionTypeLabel, getContentArea } from "../types";
import type { Region, RegionId, OBSSceneRegion, ImageOverlayRegion } from "../types";
import { useDragState, useDropTarget, type DragPayload } from "../hooks/useDragDrop";
import { obsService } from "../../services/obsService";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { DEFAULT_THEME_SETTINGS, type BibleTheme } from "../../bible/types";
import { getCustomThemes } from "../../bible/bibleDb";
import { LT_BIBLE_THEMES, LT_WORSHIP_THEMES, LT_GENERAL_THEMES } from "../../lowerthirds/themes";
import Icon from "../../components/Icon";

const GRID_SIZE = 40;
const HANDLE_SIZE = 6;
const THUMB_POLL_MS = 1500;

export function MVCanvas() {
  const { state, dispatch, assignSceneToRegion, unassignSceneFromRegion, updateRegion, snapshot } = useEditor();
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 450 });

  const dragState = useDragState();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; regionId: RegionId } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ regionId: RegionId; sceneName: string } | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, HTMLImageElement>>({});
  const [obsConnected, setOBSConnected] = useState(obsService.status === "connected");
  const [programScene, setProgramScene] = useState<string | null>(null);
  const [livePulse, setLivePulse] = useState(true);

  // ── Slot picker popover (3-tab: Scenes / Bible / Worship) ──
  const [scenePicker, setScenePicker] = useState<{ x: number; y: number; regionId: RegionId } | null>(null);
  const [pickerScenes, setPickerScenes] = useState<{ sceneName: string; sceneIndex: number; thumbnail: string | null }[]>([]);
  const [pickerTab, setPickerTab] = useState<"scenes" | "bible" | "worship" | "lower-third">("scenes");

  // ── Overwrite confirmation modal ──
  const [overwriteModal, setOverwriteModal] = useState<{ regionId: RegionId; newSceneName: string; newSceneIndex: number } | null>(null);

  // ── Custom themes loaded from IndexedDB ──
  const [customBibleThemes, setCustomBibleThemes] = useState<BibleTheme[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCustomThemes().then((themes) => { if (!cancelled) setCustomBibleThemes(themes); }).catch(() => {});
    return () => { cancelled = true; };
  }, [scenePicker]); // reload when picker opens

  // Dummy worship themes (same set as MVInspector)
  const worshipThemes: BibleTheme[] = [
    { id: "worship-classic", name: "Classic Worship", description: "Traditional worship lyrics.", source: "builtin", templateType: "fullscreen", settings: { ...DEFAULT_THEME_SETTINGS, fontFamily: '"CMG Sans", sans-serif', fontSize: 52, fontWeight: "bold", fontColor: "#FFFFFF", lineHeight: 1.7, textAlign: "center", textShadow: "0 2px 12px rgba(0,0,0,0.8)", textOutline: false, textOutlineColor: "#000000", textOutlineWidth: 0, textTransform: "none", refFontSize: 22, refFontColor: "#aaaaaa", refFontWeight: "normal", refPosition: "bottom", backgroundColor: "#0a0a14", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1, logoUrl: "", logoPosition: "bottom-right", logoSize: 60, padding: 80, safeArea: 50, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "", lowerThirdSize: "medium", animation: "fade", animationDuration: 500 }, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
    { id: "worship-modern", name: "Modern Worship", description: "Bold modern lyrics.", source: "builtin", templateType: "fullscreen", settings: { ...DEFAULT_THEME_SETTINGS, fontFamily: '"CMG Sans Bold", sans-serif', fontSize: 56, fontWeight: "bold", fontColor: "#FFFFFF", lineHeight: 1.6, textAlign: "center", textShadow: "0 4px 20px rgba(0,0,0,0.9)", textOutline: true, textOutlineColor: "rgba(0,0,0,0.3)", textOutlineWidth: 1, textTransform: "uppercase", refFontSize: 20, refFontColor: "#d4af37", refFontWeight: "bold", refPosition: "bottom", backgroundColor: "#000000", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1, logoUrl: "", logoPosition: "bottom-right", logoSize: 60, padding: 100, safeArea: 60, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "", lowerThirdSize: "medium", animation: "slide-up", animationDuration: 600 }, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
    { id: "worship-minimal", name: "Minimal Worship", description: "Clean minimal lyrics.", source: "builtin", templateType: "fullscreen", settings: { ...DEFAULT_THEME_SETTINGS, fontFamily: '"CMG Sans Light", sans-serif', fontSize: 44, fontWeight: "light", fontColor: "#333333", lineHeight: 1.5, textAlign: "center", textShadow: "none", textOutline: false, textOutlineColor: "#000000", textOutlineWidth: 0, textTransform: "none", refFontSize: 18, refFontColor: "#888888", refFontWeight: "normal", refPosition: "bottom", backgroundColor: "#f8f8f8", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1, logoUrl: "", logoPosition: "bottom-right", logoSize: 50, padding: 80, safeArea: 50, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "", lowerThirdSize: "medium", animation: "fade", animationDuration: 300 }, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
  ];

  const layout = state.layout;
  const canvas = layout?.canvas ?? { width: 1920, height: 1080, label: "1080p" };
  const regions = layout?.regions ?? [];
  const background = layout?.background;
  const safeFrame = layout?.safeFrame;

  // ── Fit stage to container ────────────────────────────────
  const fitStage = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    setStageSize({ width: clientWidth, height: clientHeight });
  }, []);

  useEffect(() => {
    fitStage();
    const ro = new ResizeObserver(fitStage);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fitStage]);

  // ── Compute scale ────────────────────────────────────────
  const pad = 60;
  const scaleX = (stageSize.width - pad * 2) / canvas.width;
  const scaleY = (stageSize.height - pad * 2) / canvas.height;
  const fitScale = Math.min(scaleX, scaleY, 1);
  const effectiveScale = fitScale * state.zoom;
  const offsetX = (stageSize.width - canvas.width * effectiveScale) / 2;
  const offsetY = (stageSize.height - canvas.height * effectiveScale) / 2;

  const toScreen = useCallback(
    (cx: number, cy: number) => ({
      x: offsetX + state.panX + cx * effectiveScale,
      y: offsetY + state.panY + cy * effectiveScale,
    }),
    [offsetX, offsetY, state.panX, state.panY, effectiveScale]
  );

  // ── Subscribe to OBS connection status reactively ──────
  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setOBSConnected(s === "connected"));
    return unsub;
  }, []);

  // ── Poll current program (live) scene ────────────────────
  useEffect(() => {
    if (!obsConnected) { setProgramScene(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const name = await obsService.getCurrentProgramScene();
        if (!cancelled) setProgramScene(name);
      } catch { if (!cancelled) setProgramScene(null); }
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [obsConnected]);

  // ── LIVE badge pulse animation ────────────────────────────
  useEffect(() => {
    if (!programScene) return;
    const iv = setInterval(() => setLivePulse((p) => !p), 800);
    return () => clearInterval(iv);
  }, [programScene]);

  // ── Live thumbnail polling ────────────────────────────────
  useEffect(() => {
    if (!obsConnected) return;
    const assigned = regions.filter(
      (r) => r.type === "obs-scene" && (r as OBSSceneRegion).sceneName
    ) as OBSSceneRegion[];
    if (assigned.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      const batch: Record<string, HTMLImageElement> = {};
      await Promise.all(
        assigned.map(async (r) => {
          try {
            const dataUrl = await obsService.getSourceScreenshot(r.sceneName, 320);
            if (dataUrl && !cancelled) {
              const img = new window.Image();
              img.src = dataUrl;
              await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); });
              if (!cancelled) batch[r.id] = img;
            }
          } catch { /* ignore */ }
        })
      );
      if (!cancelled) setThumbnails((prev) => ({ ...prev, ...batch }));
    };
    poll();
    const iv = setInterval(poll, THUMB_POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [regions, obsConnected]);

  // ── Image overlay images (logo / custom image regions) ────
  const [overlayImages, setOverlayImages] = useState<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    const imageRegions = regions.filter(
      (r) => r.type === "image-overlay" && !!(r as ImageOverlayRegion).src
    ) as ImageOverlayRegion[];

    // Build a key of id:src to detect changes
    const key = imageRegions.map((r) => `${r.id}:${r.src}`).join("|");
    if (!key) { setOverlayImages({}); return; }

    let cancelled = false;
    const load = async () => {
      const batch: Record<string, HTMLImageElement> = {};
      await Promise.all(
        imageRegions.map(async (r) => {
          try {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.src = r.src;
            await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); });
            if (!cancelled) batch[r.id] = img;
          } catch { /* ignore */ }
        })
      );
      if (!cancelled) setOverlayImages(batch);
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions.filter((r) => r.type === "image-overlay").map((r) => `${r.id}:${(r as ImageOverlayRegion).src}`).join("|")]);

  // ── Close context menu on click elsewhere ────────────────
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("contextmenu", close); };
  }, [ctxMenu]);

  // ── Close scene picker on click elsewhere ────────────────
  useEffect(() => {
    if (!scenePicker) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".mv-scene-picker")) return;
      setScenePicker(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [scenePicker]);

  // ── Delete/Backspace → modal for assigned scenes or themed slots ─────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't intercept when user is in an input/textarea/select/contenteditable
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          (e.target as HTMLElement)?.isContentEditable) return;

        if (state.selectedRegionIds.length !== 1) return;
        const r = regions.find((rg) => rg.id === state.selectedRegionIds[0]);
        if (!r) return;

        const hasScene = r.type === "obs-scene" && (r as OBSSceneRegion).sceneName;
        const isThemed = (r.name?.startsWith("Bible:") || r.name?.startsWith("Worship:")) && !!r.themeSettings;
        const isLT = !!(r.name?.startsWith("LT:") && r.themeId);

        if (hasScene) {
          e.preventDefault();
          e.stopPropagation();
          setDeleteModal({ regionId: r.id, sceneName: (r as OBSSceneRegion).sceneName });
        } else if (isThemed || isLT) {
          e.preventDefault();
          e.stopPropagation();
          const label = r.name?.startsWith("Bible:") ? "Bible Theme" : r.name?.startsWith("Worship:") ? "Worship Theme" : "Lower Third";
          setDeleteModal({ regionId: r.id, sceneName: r.name ?? label });
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [state.selectedRegionIds, regions]);

  // ── Stage click ──────────────────────────────────────────
  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (dragState.isDragging) return;
      setCtxMenu(null);
      setScenePicker(null);
      if (e.target === stageRef.current || e.target.name() === "canvas-bg" || e.target.name() === "safe-frame-overlay") {
        dispatch({ type: "DESELECT_ALL" });
      }
    },
    [dispatch, dragState.isDragging]
  );

  // ── Open scene picker for an empty slot ──
  const openScenePicker = useCallback(
    async (regionId: RegionId, clientX: number, clientY: number) => {
      if (obsService.status !== "connected") return;
      try {
        const sceneList = await obsService.getSceneList();
        const items = await Promise.all(
          sceneList.map(async (s, i) => {
            let thumb: string | null = null;
            try { thumb = await obsService.getSourceScreenshot(s.sceneName, 160); } catch { /* */ }
            return { sceneName: s.sceneName, sceneIndex: i, thumbnail: thumb };
          })
        );
        setPickerScenes(items);
        setScenePicker({ x: clientX, y: clientY, regionId });
      } catch { /* */ }
    },
    []
  );

  const handleRegionClick = useCallback(
    (regionId: RegionId, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (dragState.isDragging) return;
      e.cancelBubble = true;
      setCtxMenu(null);

      const raw = e.evt;
      const multi = "shiftKey" in raw ? raw.shiftKey || raw.metaKey || raw.ctrlKey : false;
      dispatch({ type: "SELECT_REGION", regionId, additive: multi });

      // Open 3-tab slot popover ONLY on truly empty slots (no modifier, no themed content)
      if (!multi) {
        const r = regions.find((rg) => rg.id === regionId);
        const isThemed = !!(r?.name?.startsWith("Bible:") || r?.name?.startsWith("Worship:")) && !!r?.themeSettings;
        const isLT = !!(r?.name?.startsWith("LT:") && r?.themeId);
        if (r && r.type === "obs-scene" && !(r as OBSSceneRegion).sceneName && !isThemed && !isLT) {
          const evt = e.evt as MouseEvent;
          openScenePicker(regionId, evt.clientX, evt.clientY);
        }
      }
    },
    [dispatch, dragState.isDragging, regions, openScenePicker]
  );

  const handleContextMenu = useCallback(
    (regionId: RegionId, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      dispatch({ type: "SELECT_REGION", regionId, additive: false });
      // Always show context menu on right-click, never open the scene picker
      setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, regionId });
    },
    [dispatch]
  );

  // ── Edge resize (with bounds clamping to canvas / safe area) ──
  const handleEdgeResize = useCallback(
    (regionId: RegionId, edge: "left" | "right" | "bottom", e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;
      snapshot();
      const startX = e.evt.clientX;
      const startY = e.evt.clientY;
      const startW = region.width;
      const startH = region.height;
      const startRX = region.x;

      // Bounds: if safe frame is enabled, clamp to safe area; otherwise clamp to canvas
      const sf = safeFrame;
      const boundsLeft = sf?.enabled ? sf.left : 0;
      const boundsRight = sf?.enabled ? canvas.width - sf.right : canvas.width;
      const boundsBottom = sf?.enabled ? canvas.height - sf.bottom : canvas.height;

      const onMove = (me: MouseEvent) => {
        const dx = (me.clientX - startX) / effectiveScale;
        const dy = (me.clientY - startY) / effectiveScale;
        const changes: Partial<Region> = {};
        if (edge === "right") {
          let newW = Math.max(60, startW + dx);
          // Clamp: region right edge must not exceed bounds
          if (region.x + newW > boundsRight) newW = boundsRight - region.x;
          changes.width = Math.max(60, newW);
        } else if (edge === "left") {
          let newW = Math.max(60, startW - dx);
          let newX = startRX + (startW - newW);
          // Clamp: region left edge must not go past bounds
          if (newX < boundsLeft) { newX = boundsLeft; newW = startRX + startW - boundsLeft; }
          changes.width = Math.max(60, newW);
          if (!region.constraints?.lockPosition) {
            changes.x = newX;
          }
        } else if (edge === "bottom") {
          let newH = Math.max(40, startH + dy);
          // Clamp: region bottom edge must not exceed bounds
          if (region.y + newH > boundsBottom) newH = boundsBottom - region.y;
          changes.height = Math.max(40, newH);
        }
        updateRegion(regionId, changes);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = edge === "bottom" ? "ns-resize" : "ew-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [regions, effectiveScale, updateRegion, snapshot, safeFrame, canvas]
  );

  // ── Grid lines ───────────────────────────────────────────
  const gridLines: JSX.Element[] = [];
  if (state.showGrid) {
    for (let x = 0; x <= canvas.width; x += GRID_SIZE) {
      gridLines.push(<Line key={`gv-${x}`} points={[x, 0, x, canvas.height]} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />);
    }
    for (let y = 0; y <= canvas.height; y += GRID_SIZE) {
      gridLines.push(<Line key={`gh-${y}`} points={[0, y, canvas.width, y]} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />);
    }
  }

  // ── Safe frame ───────────────────────────────────────────
  const safeFrameElements: JSX.Element[] = [];
  if (state.showSafeFrame && safeFrame?.enabled) {
    const content = getContentArea(canvas, safeFrame);
    safeFrameElements.push(
      <Line key="safe-frame-border" name="safe-frame-overlay"
        points={[ content.x, content.y, content.x + content.width, content.y, content.x + content.width, content.y + content.height, content.x, content.y + content.height, content.x, content.y ]}
        stroke="rgba(255,200,0,0.5)" strokeWidth={2 / effectiveScale} dash={[10, 5]} listening={false} />
    );
    const dc = "rgba(0,0,0,0.25)";
    safeFrameElements.push(
      <Rect key="sf-top" x={0} y={0} width={canvas.width} height={safeFrame.top} fill={dc} listening={false} />,
      <Rect key="sf-bottom" x={0} y={canvas.height - safeFrame.bottom} width={canvas.width} height={safeFrame.bottom} fill={dc} listening={false} />,
      <Rect key="sf-left" x={0} y={safeFrame.top} width={safeFrame.left} height={canvas.height - safeFrame.top - safeFrame.bottom} fill={dc} listening={false} />,
      <Rect key="sf-right" x={canvas.width - safeFrame.right} y={safeFrame.top} width={safeFrame.right} height={canvas.height - safeFrame.top - safeFrame.bottom} fill={dc} listening={false} />,
    );
    const lf = 11 / effectiveScale;
    safeFrameElements.push(<Text key="sf-label" x={content.x + 4} y={content.y - lf - 2} text="Safe Frame" fontSize={lf} fill="rgba(255,200,0,0.6)" listening={false} />);
  }

  const sortedRegions = [...regions].sort((a, b) => a.zIndex - b.zIndex);
  const hw = HANDLE_SIZE / effectiveScale;

  // ── Background image (loaded from data URL or path) ──
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const src = background?.type === "image" ? background.imageSrc : undefined;
    if (!src) { setBgImage(null); return; }
    const img = new window.Image();
    img.src = src;
    img.onload = () => setBgImage(img);
    img.onerror = () => setBgImage(null);
  }, [background?.type, background?.imageSrc]);

  // ── Background video (HTML video element for Konva) ──
  const [bgVideoEl, setBgVideoEl] = useState<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (background?.type !== "video" || !background.videoSrc) {
      if (bgVideoRef.current) {
        bgVideoRef.current.pause();
        bgVideoRef.current.src = "";
        bgVideoRef.current = null;
      }
      setBgVideoEl(null);
      return;
    }
    const video = document.createElement("video");
    video.src = background.videoSrc;
    video.loop = background.loop ?? true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.crossOrigin = "anonymous";
    bgVideoRef.current = video;

    video.addEventListener("loadeddata", () => {
      setBgVideoEl(video);
      video.play().catch(() => {});
    });
    video.load();

    return () => {
      video.pause();
      video.src = "";
      bgVideoRef.current = null;
      setBgVideoEl(null);
    };
  }, [background?.type, background?.videoSrc, background?.loop]);

  // Force Konva to re-render while video is playing
  const layerRef = useRef<Konva.Layer>(null);
  useEffect(() => {
    if (!bgVideoEl) return;
    let anim: ReturnType<typeof setInterval>;
    anim = setInterval(() => {
      layerRef.current?.batchDraw();
    }, 1000 / 30); // 30fps
    return () => clearInterval(anim);
  }, [bgVideoEl]);

  /** Distinctive border colors for multi-layer layouts */
  const LAYER_COLORS = [
    "#FF3B30", // red
    "#007AFF", // blue
    "#34C759", // green
    "#FF9500", // orange
    "#AF52DE", // purple
    "#FF2D55", // pink
    "#5AC8FA", // cyan
    "#FFCC00", // yellow
    "#00C7BE", // teal
    "#FF6482", // coral
  ];
  const multiLayer = sortedRegions.length > 1;

  return (
    <div ref={containerRef} className="mv-canvas-container">
      <Stage ref={stageRef} width={stageSize.width} height={stageSize.height}
        onClick={handleStageClick} onTap={handleStageClick}
        style={{ position: "absolute", top: 0, left: 0 }}>
        <Layer ref={layerRef} x={offsetX + state.panX} y={offsetY + state.panY} scaleX={effectiveScale} scaleY={effectiveScale}>
          {/* Background */}
          <Rect name="canvas-bg" x={0} y={0} width={canvas.width} height={canvas.height}
            fill={background?.color ?? layout?.backgroundColor ?? "#0a0a14"}
            shadowColor="#000" shadowBlur={20} shadowOpacity={0.5} />
          {/* Background image overlay */}
          {bgImage && background?.type === "image" && (
            <KonvaImage image={bgImage} x={0} y={0} width={canvas.width} height={canvas.height}
              opacity={background.opacity ?? 1} listening={false} />
          )}
          {/* Background video overlay */}
          {bgVideoEl && background?.type === "video" && (
            <KonvaImage image={bgVideoEl} x={0} y={0} width={canvas.width} height={canvas.height}
              opacity={background.opacity ?? 1} listening={false} />
          )}
          {gridLines}

          {/* Regions */}
          {sortedRegions.map((region, regionIndex) => {
            const isSelected = state.selectedRegionIds.includes(region.id);
            // ── Bible / Worship theme detection (must come BEFORE isEmptySlot) ──
            const isBibleSlot = !!(region.name?.startsWith("Bible:") && region.themeSettings);
            const isWorshipSlot = !!(region.name?.startsWith("Worship:") && region.themeSettings);
            const isLTSlot = !!(region.name?.startsWith("LT:") && region.themeId);
            const isThemedSlot = isBibleSlot || isWorshipSlot || isLTSlot;

            const hasScene = region.type === "obs-scene" && !!(region as OBSSceneRegion).sceneName;
            // Themed slots are NOT empty even though sceneName is blank
            const isEmptySlot = region.type === "obs-scene" && !(region as OBSSceneRegion).sceneName && !isThemedSlot;
            const isImageOverlay = region.type === "image-overlay";
            const overlayImg = isImageOverlay ? overlayImages[region.id] : null;
            const displayName = region.name || region.slotLabel || regionTypeLabel(region.type);
            const thumbImg = thumbnails[region.id];
            const layerColor = LAYER_COLORS[regionIndex % LAYER_COLORS.length];
            const borderColor = isSelected ? "#fff" : isEmptySlot ? "#ff9800" : multiLayer ? layerColor : "#00e5ff";
            const borderWidth = isSelected ? 6 / effectiveScale : multiLayer ? 4 / effectiveScale : 3 / effectiveScale;
            const ts = region.themeSettings;   // persisted theme settings
            const fo = region.fontOverrides;   // persisted font overrides

            // Effective theme values (fallback: black bg + white text)
            const themeBg    = ts?.backgroundColor ?? "#000000";
            const themeFont  = fo?.fontFamily ?? ts?.fontFamily ?? '"CMG Sans", sans-serif';
            const themeFontW = ts?.fontWeight ?? "normal";
            const themeAlign = fo?.textAlign ?? ts?.textAlign ?? "center";
            const themeTT    = (fo?.textTransform ?? ts?.textTransform ?? "none") as string;
            const vAlign     = fo?.verticalAlign ?? "center";
            // Font size: scale proportionally to slot, cap at MAX_PREVIEW_FONT
            const MAX_PREVIEW_FONT = 150;
            const MIN_PREVIEW_FONT = 12;
            const baseFontPx = fo?.fontSize ?? ts?.fontSize ?? 48;
            const slotScale  = Math.min(region.width / 1920, region.height / 1080);
            const scaledFont = Math.max(MIN_PREVIEW_FONT, Math.min(MAX_PREVIEW_FONT, Math.round(baseFontPx * slotScale)));
            const lineH      = ts?.lineHeight ?? 1.5;
            // Padding in canvas coords (proportional to slot)
            const padX = Math.max(8, region.width * 0.03);
            const padTop = Math.max(24, region.height * 0.06);

            const previewText = isBibleSlot
              ? "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
              : "jesus love you soo much, sooo much.";
            const refText = isBibleSlot ? "— John 3:16 (KJV)" : "";

            // Apply textTransform to preview text
            const transformText = (t: string) => {
              if (themeTT === "uppercase") return t.toUpperCase();
              if (themeTT === "lowercase") return t.toLowerCase();
              if (themeTT === "capitalize") return t.replace(/\b\w/g, (c) => c.toUpperCase());
              return t;
            };

            const hasFill = (hasScene && thumbImg) || (isImageOverlay && overlayImg) || isThemedSlot;


            return (
              <Group key={region.id}>
                <Rect id={`region-${region.id}`}
                  x={region.x} y={region.y} width={region.width} height={region.height}
                  rotation={region.rotation}
                  fill={isThemedSlot ? themeBg : isEmptySlot ? "rgba(108,92,231,0.15)" : hasFill ? "transparent" : "#6c5ce7"}
                  opacity={region.opacity * (isEmptySlot ? 0.5 : 1)}
                  stroke={borderColor}
                  strokeWidth={borderWidth}
                  dash={isEmptySlot ? [8, 4] : undefined}
                  cornerRadius={region.borderRadius} draggable={false} visible={region.visible}
                  onClick={(e) => handleRegionClick(region.id, e)}
                  onTap={(e) => handleRegionClick(region.id, e)}
                  onContextMenu={(e) => handleContextMenu(region.id, e)} />

                {/* Live thumbnail */}
                {hasScene && thumbImg && region.visible && (
                  <KonvaImage image={thumbImg}
                    x={region.x} y={region.y} width={region.width} height={region.height}
                    opacity={region.opacity} cornerRadius={region.borderRadius}
                    onClick={(e) => handleRegionClick(region.id, e)}
                    onTap={(e) => handleRegionClick(region.id, e)}
                    onContextMenu={(e) => handleContextMenu(region.id, e)} />
                )}

                {/* Image overlay (logo/custom image) */}
                {isImageOverlay && overlayImg && region.visible && (
                  <KonvaImage image={overlayImg}
                    x={region.x} y={region.y} width={region.width} height={region.height}
                    opacity={region.opacity} cornerRadius={region.borderRadius}
                    onClick={(e) => handleRegionClick(region.id, e)}
                    onTap={(e) => handleRegionClick(region.id, e)}
                    onContextMenu={(e) => handleContextMenu(region.id, e)} />
                )}

                {/* Label */}
                <Text x={region.x + 8} y={region.y + 6} text={displayName}
                  fontSize={14 / effectiveScale} fontStyle="bold"
                  fill={isThemedSlot ? (ts?.fontColor ?? "#fff") : "#fff"}
                  listening={false} visible={region.visible} opacity={0.85} />

                {/* Empty hint */}
                {isEmptySlot && (
                  <Text x={region.x} y={region.y + region.height / 2 - 10 / effectiveScale}
                    text="Click to Assign" fontSize={13 / effectiveScale}
                    fill="rgba(255,255,255,0.30)" fontStyle="italic" align="center"
                    width={region.width} listening={false} visible={region.visible} />
                )}

                {/* Bible / Worship theme preview */}
                {isThemedSlot && region.visible && (() => {
                  // Compute vertical offset based on verticalAlign
                  const refLineH = refText ? scaledFont * 0.55 + 4 : 0;
                  const contentH = region.height - padTop - refLineH - padX;
                  let verseY = region.y + padTop; // top
                  if (vAlign === "center") {
                    verseY = region.y + padTop; // Konva verticalAlign="middle" handles centering within height
                  } else if (vAlign === "bottom") {
                    verseY = region.y + padTop; // bottom: let height constraint push text down
                  }
                  const konvaVAlign = vAlign === "center" ? "middle" : vAlign === "bottom" ? "bottom" : "top";
                  const refY = region.y + region.height - scaledFont * 0.55 - padX;
                  return (
                  <>
                    {/* Verse / lyrics text */}
                    <Text
                      x={region.x + padX}
                      y={verseY}
                      text={transformText(previewText)}
                      fontSize={scaledFont}
                      fontFamily={themeFont}
                      fontStyle={themeFontW === "bold" ? "bold" : themeFontW === "light" ? "normal" : "normal"}
                      fill={ts?.fontColor ?? "#FFFFFF"}
                      align={themeAlign}
                      verticalAlign={konvaVAlign}
                      width={region.width - padX * 2}
                      height={contentH}
                      lineHeight={lineH}
                      listening={false}
                      wrap="word"
                      ellipsis={true}
                    />
                    {/* Reference line (Bible only) */}
                    {refText && (
                      <Text
                        x={region.x + padX}
                        y={refY}
                        text={refText}
                        fontSize={Math.max(8, scaledFont * 0.45)}
                        fontFamily={themeFont}
                        fill={ts?.refFontColor ?? "rgba(255,255,255,0.6)"}
                        align={themeAlign}
                        width={region.width - padX * 2}
                        listening={false}
                      />
                    )}
                  </>
                  );
                })()}

                {/* Slot label */}
                {region.slotLabel && !isEmptySlot && (
                  <Text x={region.x + 8} y={region.y + region.height - 20 / effectiveScale}
                    text={region.slotLabel} fontSize={10 / effectiveScale}
                    fill="rgba(255,255,255,0.35)" fontStyle="italic" listening={false} visible={region.visible} />
                )}

                {/* Lock icon */}
                {region.constraints?.lockDelete && (
                  <Text x={region.x + region.width - 18 / effectiveScale} y={region.y + 6}
                    text="LOCK" fontSize={11 / effectiveScale} listening={false} visible={region.visible} />
                )}

                {/* ── LIVE badge (red with subtle pulse, non-obstructive) ── */}
                {hasScene && programScene && (region as OBSSceneRegion).sceneName === programScene && region.visible && (
                  <Group x={region.x + region.width - 76 / effectiveScale} y={region.y + 8 / effectiveScale} listening={false}
                    opacity={livePulse ? 0.95 : 0.75}>
                    <Rect
                      width={68 / effectiveScale} height={26 / effectiveScale}
                      fill="#dc2626" cornerRadius={5 / effectiveScale}
                      shadowColor="rgba(220,38,38,0.5)" shadowBlur={8} shadowOffsetY={2}
                    />
                    <Text
                      x={10 / effectiveScale} y={5 / effectiveScale}
                      text="● LIVE"
                      fontSize={14 / effectiveScale} fontStyle="bold" fill="#fff"
                      listening={false}
                    />
                  </Group>
                )}

                {/* ── Resize Handles (only when selected) ── */}
                {isSelected && region.visible && (
                  <>
                    {/* Right edge */}
                    <Rect x={region.x + region.width - hw / 2} y={region.y + hw}
                      width={hw} height={region.height - hw * 2}
                      fill="rgba(0,120,212,0.6)" cornerRadius={hw / 2}
                      onMouseDown={(e) => handleEdgeResize(region.id, "right", e)}
                      onMouseEnter={() => { if (stageRef.current) stageRef.current.container().style.cursor = "ew-resize"; }}
                      onMouseLeave={() => { if (stageRef.current) stageRef.current.container().style.cursor = "default"; }} />
                    {/* Left edge */}
                    <Rect x={region.x - hw / 2} y={region.y + hw}
                      width={hw} height={region.height - hw * 2}
                      fill="rgba(0,120,212,0.6)" cornerRadius={hw / 2}
                      onMouseDown={(e) => handleEdgeResize(region.id, "left", e)}
                      onMouseEnter={() => { if (stageRef.current) stageRef.current.container().style.cursor = "ew-resize"; }}
                      onMouseLeave={() => { if (stageRef.current) stageRef.current.container().style.cursor = "default"; }} />
                    {/* Bottom edge */}
                    <Rect x={region.x + hw} y={region.y + region.height - hw / 2}
                      width={region.width - hw * 2} height={hw}
                      fill="rgba(0,120,212,0.6)" cornerRadius={hw / 2}
                      onMouseDown={(e) => handleEdgeResize(region.id, "bottom", e)}
                      onMouseEnter={() => { if (stageRef.current) stageRef.current.container().style.cursor = "ns-resize"; }}
                      onMouseLeave={() => { if (stageRef.current) stageRef.current.container().style.cursor = "default"; }} />
                  </>
                )}
              </Group>
            );
          })}
          {safeFrameElements}
        </Layer>
      </Stage>

      {/* ── Drop Overlay ── */}
      <div className={`mv-drop-overlay ${dragState.isDragging ? "mv-drop-overlay--active" : ""}`}>
        {regions.filter(r => r.visible).map((region) => (
          <DropTargetRegion key={`drop-${region.id}`} region={region}
            effectiveScale={effectiveScale} toScreen={toScreen}
            isDragging={dragState.isDragging}
            assignSceneToRegion={(rid, name, idx) => {
              // If slot already has content, show confirmation
              const r = regions.find((rg) => rg.id === rid);
              const hasContent = r?.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName;
              if (hasContent) {
                setOverwriteModal({ regionId: rid, newSceneName: name, newSceneIndex: idx });
              } else {
                assignSceneToRegion(rid, name, idx);
              }
            }} />
        ))}
        {dragState.isDragging && (
          <div className="mv-drop-canvas-hint">
            <Icon name="open_with" size={20} />
            <span>Drag onto a slot to assign your scene</span>
          </div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (() => {
        const region = regions.find((r) => r.id === ctxMenu.regionId);
        if (!region) return null;
        const hasScene = region.type === "obs-scene" && !!(region as OBSSceneRegion).sceneName;
        const isBible = !!(region.name?.startsWith("Bible:") && region.themeSettings);
        const isWorship = !!(region.name?.startsWith("Worship:") && region.themeSettings);
        const isLT = !!(region.name?.startsWith("LT:") && region.themeId);
        const isThemed = isBible || isWorship || isLT;
        const hasContent = hasScene || isThemed;
        const contentLabel = isBible ? "Bible Theme" : isWorship ? "Worship Theme" : isLT ? "Lower Third" : "Scene";
        return (
          <div className="mv-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}>
            {hasContent && (
              <>
                <button className="mv-context-menu-item mv-context-menu-item--danger"
                  onClick={() => {
                    setCtxMenu(null);
                    if (isThemed) {
                      // Remove themed content: clear name, theme data
                      updateRegion(region.id, {
                        name: region.slotLabel || regionTypeLabel(region.type),
                        themeId: undefined,
                        themeSettings: undefined,
                        fontOverrides: undefined,
                      } as any);
                    } else {
                      setDeleteModal({ regionId: region.id, sceneName: (region as OBSSceneRegion).sceneName });
                    }
                  }}>
                  <Icon name="delete" size={20} />Remove {contentLabel}
                </button>
                <button className="mv-context-menu-item"
                  onClick={() => {
                    setCtxMenu(null);
                    if (isThemed) {
                      updateRegion(region.id, {
                        name: region.slotLabel || regionTypeLabel(region.type),
                        themeId: undefined,
                        themeSettings: undefined,
                        fontOverrides: undefined,
                      } as any);
                    } else {
                      unassignSceneFromRegion(region.id);
                    }
                  }}>
                  <Icon name="swap_horiz" size={20} />Change {contentLabel}
                </button>
                <div className="mv-context-menu-divider" />
              </>
            )}
            {/* Substitute to other slots */}
            {hasScene && sortedRegions.filter((r) => r.id !== region.id && r.type === "obs-scene").map((target) => {
              const targetIdx = sortedRegions.findIndex((r) => r.id === target.id) + 1;
              return (
                <button key={target.id} className="mv-context-menu-item"
                  onClick={() => {
                    setCtxMenu(null);
                    assignSceneToRegion(target.id, (region as OBSSceneRegion).sceneName, (region as OBSSceneRegion).sceneIndex ?? 0);
                  }}>
                  <Icon name="swap_calls" size={20} />Substitute to Slot {targetIdx}
                </button>
              );
            })}
            {hasContent && <div className="mv-context-menu-divider" />}
            <button className="mv-context-menu-item"
              onClick={() => { setCtxMenu(null); dispatch({ type: "TOGGLE_VISIBILITY", regionId: region.id }); }}>
              <Icon name={region.visible ? "visibility_off" : "visibility"} size={20} />
              {region.visible ? "Hide Slot" : "Show Slot"}
            </button>
            <button className="mv-context-menu-item"
              onClick={() => { setCtxMenu(null); dispatch({ type: "SELECT_REGION", regionId: region.id, additive: false }); }}>
              <Icon name="info" size={20} />Inspect
            </button>
          </div>
        );
      })()}

      {/* ── Delete Modal ── */}
      {deleteModal && (() => {
        // Count ALL assigned content (OBS scenes + Bible/Worship themed slots + LT slots)
        const assignedCount = regions.filter((r) => {
          if (r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName) return true;
          if ((r.name?.startsWith("Bible:") || r.name?.startsWith("Worship:")) && r.themeSettings) return true;
          if (r.name?.startsWith("LT:") && r.themeId) return true;
          return false;
        }).length;
        const isLastScene = assignedCount <= 1;
        const modalRegion = regions.find((r) => r.id === deleteModal.regionId);
        const isLTDelete = !!(modalRegion?.name?.startsWith("LT:") && modalRegion?.themeId);
        const isThemedDelete = isLTDelete || (modalRegion && (modalRegion.name?.startsWith("Bible:") || modalRegion.name?.startsWith("Worship:")) && !!modalRegion.themeSettings);
        const contentLabel = isThemedDelete ? "content" : "scene";
        return (
          <div className="mv-modal-backdrop" onClick={() => setDeleteModal(null)}>
            <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
              <div className="mv-modal-icon"><Icon name="warning" size={20} /></div>
              <h3 className="mv-modal-title">{isLastScene ? "Cannot Remove Last Content" : `Remove ${isThemedDelete ? "Theme" : "Scene"}?`}</h3>
              <p className="mv-modal-text">
                {isLastScene
                  ? `You must keep at least one ${contentLabel} assigned.`
                  : <>Are you sure you want to remove <strong>"{deleteModal.sceneName}"</strong> from this slot? The slot will remain but the {contentLabel} will be unassigned.</>
                }
              </p>
              <div className="mv-modal-actions">
                <button className="mv-btn mv-btn--ghost" onClick={() => setDeleteModal(null)}>{isLastScene ? "OK" : "Cancel"}</button>
                {!isLastScene && (
                  <button className="mv-btn mv-btn--danger"
                    onClick={() => {
                      if (isThemedDelete) {
                        // Clear theme / LT data from region
                        updateRegion(deleteModal.regionId, {
                          name: modalRegion?.slotLabel || regionTypeLabel(modalRegion?.type ?? "obs-scene"),
                          themeId: undefined,
                          themeSettings: undefined,
                          fontOverrides: undefined,
                          ltValues: undefined,
                          ltEnabled: undefined,
                          ltSize: undefined,
                          ltBgColor: undefined,
                        } as any);
                      } else {
                        unassignSceneFromRegion(deleteModal.regionId);
                      }
                      setDeleteModal(null);
                    }}>
                    Remove {isThemedDelete ? "Theme" : "Scene"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Overwrite Confirmation Modal ── */}
      {overwriteModal && (
        <div className="mv-modal-backdrop" onClick={() => setOverwriteModal(null)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon"><Icon name="swap_horiz" size={20} /></div>
            <h3 className="mv-modal-title">Replace Slot Content?</h3>
            <p className="mv-modal-text">
              This slot already has content assigned. Do you want to replace it with <strong>"{overwriteModal.newSceneName}"</strong>?
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setOverwriteModal(null)}>Cancel</button>
              <button className="mv-btn mv-btn--primary"
                onClick={() => { assignSceneToRegion(overwriteModal.regionId, overwriteModal.newSceneName, overwriteModal.newSceneIndex); setOverwriteModal(null); }}>
                Yes, Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Slot Picker Popover (3-tab: Scenes / Bible / Worship) ── */}
      {scenePicker && (
        <div className="mv-scene-picker" style={{ left: scenePicker.x, top: scenePicker.y }}
          onClick={(e) => e.stopPropagation()}>
          <div className="mv-scene-picker-header">
            <Icon name="playlist_add" size={16} />
            <span>Assign to Slot</span>
            <button className="mv-scene-picker-close" onClick={() => setScenePicker(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
          {/* Tabs */}
          <div className="mv-scene-picker-tabs">
            <button className={`mv-scene-picker-tab ${pickerTab === "scenes" ? "mv-scene-picker-tab--active" : ""}`}
              onClick={() => setPickerTab("scenes")}>
              <Icon name="videocam" size={14} /> Scenes
            </button>
            <button className={`mv-scene-picker-tab ${pickerTab === "bible" ? "mv-scene-picker-tab--active" : ""}`}
              onClick={() => setPickerTab("bible")}>
              <Icon name="menu_book" size={14} /> Bible
            </button>
            <button className={`mv-scene-picker-tab ${pickerTab === "worship" ? "mv-scene-picker-tab--active" : ""}`}
              onClick={() => setPickerTab("worship")}>
              <Icon name="music_note" size={14} /> Worship
            </button>
            <button className={`mv-scene-picker-tab ${pickerTab === "lower-third" ? "mv-scene-picker-tab--active" : ""}`}
              onClick={() => setPickerTab("lower-third")}>
              <Icon name="subtitles" size={14} /> Lower Third
            </button>
          </div>

          {/* Tab: Scenes */}
          {pickerTab === "scenes" && (
            pickerScenes.length > 0 ? (
              <div className="mv-scene-picker-list">
                {pickerScenes.map((scene) => (
                  <button key={scene.sceneName} className="mv-scene-picker-item"
                    onClick={() => {
                      assignSceneToRegion(scenePicker.regionId, scene.sceneName, scene.sceneIndex);
                      setScenePicker(null);
                    }}>
                    <div className="mv-scene-picker-thumb">
                      {scene.thumbnail ? (
                        <img src={scene.thumbnail} alt={scene.sceneName} draggable={false} />
                      ) : (
                        <Icon name="slideshow" size={28} style={{ opacity: 0.3 }} />
                      )}
                    </div>
                    <span className="mv-scene-picker-name">{scene.sceneName}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mv-scene-picker-empty">
                <Icon name="link_off" size={20} style={{ opacity: 0.3 }} />
                <span>No scenes found. Connect to OBS first.</span>
              </div>
            )
          )}

          {/* Tab: Bible Themes */}
          {pickerTab === "bible" && (
            <div className="mv-scene-picker-themes">
              <div className="mv-scene-picker-theme-section">
                <h5 className="mv-scene-picker-theme-heading">Built-in</h5>
                {BUILTIN_THEMES.filter((t) => t.source === "builtin").map((theme) => (
                  <button key={theme.id} className="mv-scene-picker-theme-item"
                    onClick={() => {
                      // Assign Bible theme — persist theme settings on the region
                      updateRegion(scenePicker.regionId, {
                        name: `Bible: ${theme.name}`,
                        themeId: theme.id,
                        themeSettings: { ...theme.settings },
                        fontOverrides: undefined,
                      } as any);
                      setScenePicker(null);
                    }}>
                    <div className="mv-scene-picker-theme-preview" style={{
                      background: theme.settings.backgroundColor,
                      color: theme.settings.fontColor,
                      fontFamily: theme.settings.fontFamily,
                      fontSize: 10, padding: 6, textAlign: theme.settings.textAlign as any,
                    }}>Aa</div>
                    <div className="mv-scene-picker-theme-info">
                      <span className="mv-scene-picker-theme-name">{theme.name}</span>
                      <span className="mv-scene-picker-theme-desc">{theme.description}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mv-scene-picker-theme-section">
                <h5 className="mv-scene-picker-theme-heading">Custom</h5>
                {customBibleThemes.length === 0 ? (
                  <p className="mv-scene-picker-empty-text">Create custom themes in Bible &gt; Templates.</p>
                ) : (
                  customBibleThemes.map((theme) => (
                    <button key={theme.id} className="mv-scene-picker-theme-item"
                      onClick={() => {
                        updateRegion(scenePicker.regionId, {
                          name: `Bible: ${theme.name}`,
                          themeId: theme.id,
                          themeSettings: { ...theme.settings },
                          fontOverrides: undefined,
                        } as any);
                        setScenePicker(null);
                      }}>
                      <div className="mv-scene-picker-theme-preview" style={{
                        background: theme.settings.backgroundColor,
                        color: theme.settings.fontColor,
                        fontFamily: theme.settings.fontFamily,
                        fontSize: 10, padding: 6, textAlign: theme.settings.textAlign as any,
                      }}>Aa</div>
                      <div className="mv-scene-picker-theme-info">
                        <span className="mv-scene-picker-theme-name">{theme.name}</span>
                        <span className="mv-scene-picker-theme-desc">{theme.description}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tab: Worship Themes */}
          {pickerTab === "worship" && (
            <div className="mv-scene-picker-themes">
              <div className="mv-scene-picker-theme-section">
                <h5 className="mv-scene-picker-theme-heading">Built-in</h5>
                {worshipThemes.map((theme) => (
                  <button key={theme.id} className="mv-scene-picker-theme-item"
                    onClick={() => {
                      updateRegion(scenePicker.regionId, {
                        name: `Worship: ${theme.name}`,
                        themeId: theme.id,
                        themeSettings: { ...theme.settings },
                        fontOverrides: undefined,
                      } as any);
                      setScenePicker(null);
                    }}>
                    <div className="mv-scene-picker-theme-preview" style={{
                      background: theme.settings.backgroundColor,
                      color: theme.settings.fontColor,
                      fontFamily: theme.settings.fontFamily,
                      fontSize: 10, padding: 6, textAlign: theme.settings.textAlign as any,
                    }}>Aa</div>
                    <div className="mv-scene-picker-theme-info">
                      <span className="mv-scene-picker-theme-name">{theme.name}</span>
                      <span className="mv-scene-picker-theme-desc">{theme.description}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mv-scene-picker-theme-section">
                <h5 className="mv-scene-picker-theme-heading">Custom</h5>
                <p className="mv-scene-picker-empty-text">Custom worship themes coming soon.</p>
              </div>
            </div>
          )}

          {/* Tab: Lower Third Themes */}
          {pickerTab === "lower-third" && (
            <div className="mv-scene-picker-themes">
              {[
                { label: "Bible", themes: LT_BIBLE_THEMES },
                { label: "Worship", themes: LT_WORSHIP_THEMES },
                { label: "General", themes: LT_GENERAL_THEMES },
              ].map((group) => (
                <div key={group.label} className="mv-scene-picker-theme-section">
                  <h5 className="mv-scene-picker-theme-heading">{group.label}</h5>
                  {group.themes.map((theme) => (
                    <button key={theme.id} className="mv-scene-picker-theme-item"
                      onClick={() => {
                        // Build default values from theme variables
                        const defaults: Record<string, string> = {};
                        theme.variables.forEach((v) => { defaults[v.key] = v.defaultValue ?? ""; });
                        updateRegion(scenePicker.regionId, {
                          name: `LT: ${theme.name}`,
                          themeId: theme.id,
                          ltValues: defaults,
                          ltEnabled: true,
                          ltSize: "medium",
                          // Clear any Bible/Worship data
                          themeSettings: undefined,
                          fontOverrides: undefined,
                        } as any);
                        setScenePicker(null);
                      }}>
                      <div className="mv-scene-picker-theme-preview" style={{
                        background: theme.accentColor || "#333",
                        color: "#fff",
                        fontSize: 10, padding: 6, display: "flex", alignItems: "center", gap: 4,
                      }}>
                        <Icon name={theme.icon || "subtitles"} size={14} />
                      </div>
                      <div className="mv-scene-picker-theme-info">
                        <span className="mv-scene-picker-theme-name">{theme.name}</span>
                        <span className="mv-scene-picker-theme-desc">{theme.description}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DropTargetRegion
// ─────────────────────────────────────────────────────────────────────────────

function DropTargetRegion({ region, effectiveScale, toScreen, isDragging, assignSceneToRegion }: {
  region: Region; effectiveScale: number;
  toScreen: (cx: number, cy: number) => { x: number; y: number };
  isDragging: boolean;
  assignSceneToRegion: (regionId: RegionId, sceneName: string, sceneIndex: number) => void;
}) {
  const handleDrop = useCallback(
    (payload: DragPayload) => { assignSceneToRegion(region.id, payload.sceneName, payload.sceneIndex); },
    [region.id, assignSceneToRegion]
  );
  const { ref, isHovered } = useDropTarget(region.id, handleDrop);
  const pos = toScreen(region.x, region.y);
  const w = region.width * effectiveScale;
  const h = region.height * effectiveScale;
  const isAssigned = region.type === "obs-scene" && !!(region as OBSSceneRegion).sceneName;

  return (
    <div ref={ref}
      className={`mv-drop-target ${isHovered ? "mv-drop-target--hover" : ""} ${isAssigned ? "mv-drop-target--assigned" : ""} ${!isDragging ? "mv-drop-target--hidden" : ""}`}
      style={{ position: "absolute", left: pos.x, top: pos.y, width: w, height: h }}>
      {isHovered && (
        <div className="mv-drop-target-label">
          <Icon name="add_circle" size={24} />
          <span>Drop to assign</span>
        </div>
      )}
    </div>
  );
}
