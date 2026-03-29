/**
 * QuickMergePanel — Multi-source composition for OBS
 *
 * Lets users compose complex scenes on the fly with up to 8 slots:
 *   - Slot 1 is always the background (required)
 *   - Slots 2+ are overlays (optional, removable)
 *
 * Composition presets: Overlay Full, Side-by-Side
 *
 * Actions:
 *   - Apply to Preview — builds the composition in preview
 *   - TAKE LIVE — transitions the composition to program
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { obsService } from "../../services/obsService";
import { shortcutLabel, SHORTCUT_MAP } from "../../multiview/shortcuts";
import { TEMPLATE_LIBRARY } from "../../multiview/templates";
import type { TemplateDefinition } from "../../multiview/types";
import "./quickMerge.css";
import Icon from "../Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompositionPreset = "overlay" | "side-by-side" | "stacked-pip" | "quad";

interface OBSSourceItem {
  sceneName: string;
  isScene: boolean;
}

interface MergeLayer {
  id: number;
  source: string; // scene/source name
  enabled: boolean;
}

interface TemplatePreviewFrame {
  sceneName: string;
  imageData: string;
}

interface TemplateLayoutOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: TemplateDefinition["category"];
  regionCount: number;
  template: TemplateDefinition;
}

type SceneItemTransform = {
  positionX: number;
  positionY: number;
  boundsWidth: number;
  boundsHeight: number;
  boundsType: string;
};

const PRESET_LABELS: Record<CompositionPreset, string> = {
  "overlay": "Overlay Full",
  "side-by-side": "Side by Side",
  "stacked-pip": "Stacked PiP",
  "quad": "Quad Grid",
};

const PRESET_DESCRIPTIONS: Record<CompositionPreset, string> = {
  "overlay": "All slots stacked full-screen with transparency",
  "side-by-side": "Main source left, overlays split right",
  "stacked-pip": "Full background with floating PiP windows",
  "quad": "Equal 2×2 grid for multi-camera view",
};

const PRESET_ICONS: Record<CompositionPreset, string> = {
  "overlay": "filter_none",
  "side-by-side": "view_sidebar",
  "stacked-pip": "picture_in_picture",
  "quad": "grid_view",
};

const QUICK_PRESETS: CompositionPreset[] = ["overlay", "side-by-side"];

const PRESET_LAYER_HINTS: Record<CompositionPreset, string> = {
  "overlay": "2-4 slots",
  "side-by-side": "2-4 slots",
  "stacked-pip": "2-4 slots",
  "quad": "4 slots",
};

const MAX_SLOTS = 8;

const MERGE_SCENE_NAME = "⚡ Quick Merge";

// ---------------------------------------------------------------------------
// Mini SVG layout thumbnail — renders region rectangles in a tiny preview
// ---------------------------------------------------------------------------
const REGION_COLORS = ["#6366f1", "#38bdf8", "#f472b6", "#34d399", "#fb923c", "#a78bfa"];

function LayoutThumb({ regions, size = 40 }: { regions: TemplateDefinition["regions"]; size?: number }) {
  const W = 1920;
  const H = 1080;
  const visible = regions.filter((r) => r.visible && r.width > 0 && r.height > 0);
  return (
    <svg
      width={size}
      height={size * (9 / 16)}
      viewBox={`0 0 ${W} ${H}`}
      className="qm-layout-thumb-svg"
    >
      <rect x={0} y={0} width={W} height={H} rx={40} fill="rgba(255,255,255,0.06)" />
      {visible.map((r, i) => (
        <rect
          key={r.id}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={20}
          fill={REGION_COLORS[i % REGION_COLORS.length]}
          opacity={0.7}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Custom layout template dropdown with visual thumbnails
// ---------------------------------------------------------------------------
function LayoutTemplateDropdown({
  options,
  selectedId,
  onSelect,
}: {
  options: TemplateLayoutOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = options.find((o) => o.id === selectedId);

  return (
    <div className="qm-tpl-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className={`qm-tpl-dropdown-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="auto_awesome_mosaic" size={18} className="qm-tpl-dropdown-trigger-icon" />
        <span className="qm-tpl-dropdown-trigger-text">
          {selected ? selected.name : "Quick Merge Presets (2 built-in)"}
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={18} className="qm-tpl-dropdown-chevron" />
      </button>

      {open && (
        <div className="qm-tpl-dropdown-menu">
          {/* Default / clear option */}
          <button
            type="button"
            className={`qm-tpl-dropdown-item${!selectedId ? " is-active" : ""}`}
            onClick={() => { onSelect(""); setOpen(false); }}
          >
            <div className="qm-tpl-dropdown-item-thumb qm-tpl-dropdown-item-thumb--default">
              <Icon name="grid_view" size={16} />
            </div>
            <div className="qm-tpl-dropdown-item-info">
              <span className="qm-tpl-dropdown-item-name">Quick Merge Presets</span>
              <span className="qm-tpl-dropdown-item-meta">2 built-in layouts</span>
            </div>
            {!selectedId && <Icon name="check" size={16} className="qm-tpl-dropdown-item-check" />}
          </button>

          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`qm-tpl-dropdown-item${selectedId === option.id ? " is-active" : ""}`}
              onClick={() => { onSelect(option.id); setOpen(false); }}
            >
              <div className="qm-tpl-dropdown-item-thumb">
                <LayoutThumb regions={option.template.regions} size={56} />
              </div>
              <div className="qm-tpl-dropdown-item-info">
                <span className="qm-tpl-dropdown-item-name">{option.name}</span>
                <span className="qm-tpl-dropdown-item-meta">
                  {option.regionCount} slot{option.regionCount > 1 ? "s" : ""} · {option.category}
                </span>
              </div>
              {selectedId === option.id && <Icon name="check" size={16} className="qm-tpl-dropdown-item-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  isActive: boolean;
}

export function QuickMergePanel({ isActive }: Props) {
  // ── State ──
  const [sources, setSources] = useState<OBSSourceItem[]>([]);
  const [templatePreviewFrames, setTemplatePreviewFrames] = useState<TemplatePreviewFrame[]>([]);
  const [layers, setLayers] = useState<MergeLayer[]>([
    { id: 1, source: "", enabled: true },
  ]);
  const [preset, setPreset] = useState<CompositionPreset>("stacked-pip");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [programImg, setProgramImg] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [taking, setTaking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const templateLayoutOptions = useMemo<TemplateLayoutOption[]>(() => {
    const options: TemplateLayoutOption[] = [];
    for (const template of TEMPLATE_LIBRARY) {
      const regionCount = template.regions.filter(
        (region) => region.visible && region.width > 0 && region.height > 0
      ).length;
      if (regionCount === 0) continue;
      options.push({
        id: String(template.id),
        name: template.name,
        description: template.description,
        icon: template.icon,
        category: template.category,
        regionCount,
        template,
      });
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const selectedTemplateLayout = useMemo(
    () => templateLayoutOptions.find((option) => option.id === selectedTemplateId) ?? null,
    [templateLayoutOptions, selectedTemplateId]
  );

  // ── Build template previews from the first 3 OBS scenes ──
  const refreshTemplatePreviews = useCallback(async (sceneItems: OBSSourceItem[]) => {
    if (!obsConnected) {
      setTemplatePreviewFrames([]);
      return;
    }

    const previewSceneNames = sceneItems
      .slice(0, 3)
      .map((s) => s.sceneName)
      .filter(Boolean);

    if (previewSceneNames.length === 0) {
      setTemplatePreviewFrames([]);
      return;
    }

    try {
      const shots = await Promise.all(
        previewSceneNames.map(async (sceneName) => {
          const imageData = await obsService.getSourceScreenshot(sceneName, 640);
          if (!imageData) return null;
          return { sceneName, imageData };
        })
      );
      setTemplatePreviewFrames(shots.filter((f): f is TemplatePreviewFrame => !!f));
    } catch {
      setTemplatePreviewFrames([]);
    }
  }, [obsConnected]);

  // ── Fetch sources from OBS ──
  const refreshSources = useCallback(async () => {
    try {
      const scenes = await obsService.getSceneList();
      const items: OBSSourceItem[] = scenes
        .filter((s) => s.sceneName !== MERGE_SCENE_NAME)
        .map((s) => ({ sceneName: s.sceneName, isScene: true }));
      setSources(items);
      void refreshTemplatePreviews(items);
    } catch {
      // silently ignore
    }
  }, [refreshTemplatePreviews]);

  useEffect(() => {
    if (!isActive) return;
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
      if (status === "connected") {
        void refreshSources();
      } else {
        setTemplatePreviewFrames([]);
      }
    });
    setObsConnected(obsService.status === "connected");
    if (obsService.status === "connected") {
      void refreshSources();
    }
    return unsub;
  }, [isActive, refreshSources]);

  // ── Poll preview / program screenshots ──
  useEffect(() => {
    if (!isActive || !obsConnected) return;
    const poll = async () => {
      try {
        const pvw = await obsService.getCurrentPreviewScene().catch(() => null);
        const pgm = await obsService.getCurrentProgramScene().catch(() => null);
        if (pvw) {
          const img = await obsService.getSourceScreenshot(pvw, 320);
          setPreviewImg(img);
        }
        if (pgm) {
          const img = await obsService.getSourceScreenshot(pgm, 320);
          setProgramImg(img);
        }
      } catch { /* ignore */ }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isActive, obsConnected]);

  // Seed first 3 layers from first 3 scenes (only when nothing is selected yet)
  useEffect(() => {
    if (!isActive || sources.length === 0) return;
    setLayers((prev) => {
      if (prev.some((l) => !!l.source)) return prev;
      const seeded: MergeLayer[] = [
        { id: 1, source: sources[0]?.sceneName ?? "", enabled: true },
      ];
      if (sources[1]) seeded.push({ id: 2, source: sources[1].sceneName, enabled: true });
      if (sources[2]) seeded.push({ id: 3, source: sources[2].sceneName, enabled: true });
      return seeded;
    });
  }, [isActive, sources]);

  // ── Toast helper ──
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Layer management ──
  const addLayer = useCallback(() => {
    setLayers((prev) => {
      if (prev.length >= MAX_SLOTS) return prev;
      const nextId = Math.max(...prev.map((l) => l.id), 0) + 1;
      return [...prev, { id: nextId, source: "", enabled: true }];
    });
  }, []);

  const removeLayer = useCallback((id: number) => {
    setLayers((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((l) => l.id !== id);
    });
  }, []);

  const updateLayerSource = useCallback((id: number, source: string) => {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, source } : l));
  }, []);

  const toggleLayerEnabled = useCallback((id: number) => {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, enabled: !l.enabled } : l));
  }, []);

  // ── Select a template and adjust slot count to match ──
  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return; // clearing selection — don't touch slots
    const tpl = templateLayoutOptions.find((o) => o.id === templateId);
    if (!tpl) return;
    const neededSlots = tpl.regionCount;
    setLayers((prev) => {
      if (prev.length === neededSlots) return prev;
      if (prev.length < neededSlots) {
        // add empty slots to reach neededSlots
        const toAdd = neededSlots - prev.length;
        const maxId = Math.max(...prev.map((l) => l.id), 0);
        const newSlots: MergeLayer[] = Array.from({ length: toAdd }, (_, i) => ({
          id: maxId + i + 1,
          source: "",
          enabled: true,
        }));
        return [...prev, ...newSlots];
      }
      // more slots than needed — trim from the end (but keep at least 1)
      return prev.slice(0, Math.max(neededSlots, 1));
    });
  }, [templateLayoutOptions]);

  // ── Compute transforms for quick presets ──
  const computeQuickTransforms = useCallback(
    (
      presetType: CompositionPreset,
      layerCount: number,
      canvasW: number,
      canvasH: number
    ): SceneItemTransform[] => {
      const transforms: SceneItemTransform[] = [];

      switch (presetType) {
        case "overlay": {
          for (let i = 0; i < layerCount; i++) {
            transforms.push({
              positionX: 0,
              positionY: 0,
              boundsWidth: canvasW,
              boundsHeight: canvasH,
              boundsType: "OBS_BOUNDS_SCALE_INNER",
            });
          }
          break;
        }
        case "side-by-side": {
          const halfW = Math.floor(canvasW / 2);
          transforms.push({
            positionX: 0,
            positionY: 0,
            boundsWidth: halfW,
            boundsHeight: canvasH,
            boundsType: "OBS_BOUNDS_SCALE_INNER",
          });
          const rightSlots = Math.max(1, layerCount - 1);
          const slotH = Math.floor(canvasH / rightSlots);
          for (let i = 1; i < layerCount; i++) {
            transforms.push({
              positionX: halfW,
              positionY: slotH * (i - 1),
              boundsWidth: halfW,
              boundsHeight: slotH,
              boundsType: "OBS_BOUNDS_SCALE_INNER",
            });
          }
          break;
        }
        case "stacked-pip": {
          transforms.push({
            positionX: 0,
            positionY: 0,
            boundsWidth: canvasW,
            boundsHeight: canvasH,
            boundsType: "OBS_BOUNDS_SCALE_INNER",
          });
          const pipW = Math.floor(canvasW * 0.25);
          const pipH = Math.floor(canvasH * 0.25);
          const pipPad = 16;
          for (let i = 1; i < layerCount; i++) {
            transforms.push({
              positionX: canvasW - pipW - pipPad,
              positionY: pipPad + (pipH + pipPad) * (i - 1),
              boundsWidth: pipW,
              boundsHeight: pipH,
              boundsType: "OBS_BOUNDS_SCALE_INNER",
            });
          }
          break;
        }
        case "quad": {
          const cellW = Math.floor(canvasW / 2);
          const cellH = Math.floor(canvasH / 2);
          const positions = [
            { x: 0, y: 0 },
            { x: cellW, y: 0 },
            { x: 0, y: cellH },
            { x: cellW, y: cellH },
          ];
          for (let i = 0; i < Math.min(layerCount, 4); i++) {
            transforms.push({
              positionX: positions[i].x,
              positionY: positions[i].y,
              boundsWidth: cellW,
              boundsHeight: cellH,
              boundsType: "OBS_BOUNDS_SCALE_INNER",
            });
          }
          break;
        }
      }
      return transforms;
    },
    []
  );

  // ── Compute transforms from the template library ──
  const computeTemplateTransforms = useCallback(
    (
      template: TemplateDefinition,
      layerCount: number,
      canvasW: number,
      canvasH: number
    ): SceneItemTransform[] => {
      const orderedRegions = [...template.regions]
        .filter((region) => region.visible && region.width > 0 && region.height > 0)
        .sort((a, b) => a.zIndex - b.zIndex)
        .slice(0, MAX_SLOTS);

      const baseCanvasW = template.canvas.width || canvasW;
      const baseCanvasH = template.canvas.height || canvasH;
      const scaleX = canvasW / baseCanvasW;
      const scaleY = canvasH / baseCanvasH;

      const mapped = orderedRegions.map((region) => ({
        positionX: Math.round(region.x * scaleX),
        positionY: Math.round(region.y * scaleY),
        boundsWidth: Math.max(1, Math.round(region.width * scaleX)),
        boundsHeight: Math.max(1, Math.round(region.height * scaleY)),
        boundsType: "OBS_BOUNDS_SCALE_INNER",
      }));

      if (mapped.length >= layerCount) {
        return mapped.slice(0, layerCount);
      }

      const fallback = computeQuickTransforms("stacked-pip", layerCount, canvasW, canvasH);
      return [...mapped, ...fallback.slice(mapped.length)];
    },
    [computeQuickTransforms]
  );

  // ── Ensure merge scene exists ──
  const ensureMergeScene = useCallback(async (): Promise<void> => {
    try {
      const scenes = await obsService.getSceneList();
      if (scenes.some((s) => s.sceneName === MERGE_SCENE_NAME)) {
        // Clear existing items
        const items = await obsService.getSceneItemList(MERGE_SCENE_NAME);
        for (const item of items) {
          await obsService.call("RemoveSceneItem", {
            sceneName: MERGE_SCENE_NAME,
            sceneItemId: item.sceneItemId,
          });
        }
        return;
      }
      await obsService.createScene(MERGE_SCENE_NAME);
    } catch (err) {
      console.warn("[QuickMerge] ensureMergeScene error:", err);
    }
  }, []);

  // ── Build composition in OBS ──
  const buildComposition = useCallback(async (): Promise<boolean> => {
    const activeLayers = layers.filter((l) => l.enabled && l.source);
    if (activeLayers.length === 0) {
      showToast("Add at least one source layer");
      return false;
    }

    try {
      await ensureMergeScene();

      const video = await obsService.getVideoSettings();
      const transforms = selectedTemplateLayout
        ? computeTemplateTransforms(
            selectedTemplateLayout.template,
            activeLayers.length,
            video.baseWidth,
            video.baseHeight
          )
        : computeQuickTransforms(preset, activeLayers.length, video.baseWidth, video.baseHeight);

      // Add each layer as a scene item (sub-scene reference)
      for (let i = 0; i < activeLayers.length; i++) {
        const layer = activeLayers[i];
        const sceneItemId = await obsService.createSceneItem(MERGE_SCENE_NAME, layer.source);
        await obsService.setSceneItemTransform(MERGE_SCENE_NAME, sceneItemId, transforms[i]);
        // Ensure correct z-order (layer 0 = bottom)
        await obsService.setSceneItemIndex(MERGE_SCENE_NAME, sceneItemId, i);
      }

      return true;
    } catch (err) {
      console.error("[QuickMerge] buildComposition error:", err);
      showToast("Failed to build composition — check OBS connection");
      return false;
    }
  }, [
    layers,
    preset,
    selectedTemplateLayout,
    ensureMergeScene,
    computeTemplateTransforms,
    computeQuickTransforms,
    showToast,
  ]);

  // ── Apply to Preview ──
  const handleApplyPreview = useCallback(async () => {
    setApplying(true);
    try {
      const ok = await buildComposition();
      if (!ok) return;
      // Try to load merge scene into preview (studio mode)
      try {
        await obsService.setCurrentPreviewScene(MERGE_SCENE_NAME);
        showToast("Composition loaded into Preview");
      } catch {
        // Studio mode might be off — go straight to program
        showToast("Composition built — enable Studio Mode for preview");
      }
    } finally {
      setApplying(false);
    }
  }, [buildComposition, showToast]);

  // ── TAKE LIVE ──
  const handleTakeLive = useCallback(async () => {
    setTaking(true);
    try {
      const ok = await buildComposition();
      if (!ok) return;
      await obsService.setCurrentProgramScene(MERGE_SCENE_NAME);
      showToast("Composition is LIVE!");
    } catch (err) {
      console.error("[QuickMerge] take live error:", err);
      showToast("Failed to go live — check OBS connection");
    } finally {
      setTaking(false);
    }
  }, [buildComposition, showToast]);

  // ── Active layer count ──
  const activeCount = layers.filter((l) => l.enabled && l.source).length;
  const preview1 = templatePreviewFrames[0]?.imageData ?? null;
  const preview2 = templatePreviewFrames[1]?.imageData ?? preview1;
  const preview3 = templatePreviewFrames[2]?.imageData ?? preview2;

  const frameStyle = useCallback((img: string | null, opacity = 1): CSSProperties | undefined => {
    if (!img) return undefined;
    return {
      backgroundImage: `url(${img})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      opacity,
    };
  }, []);

  // ── Render ──
  return (
    <div className="qm-root">
      {/* ── Toast ── */}
      {toast && (
        <div className="qm-toast">
          <Icon name="info" size={20} />
          {toast}
        </div>
      )}

      <div className="qm-grid">
        {/* ═══════ Left Column — Layers + Presets ═══════ */}
        <div className="qm-left">
          {/* Header */}
          <div className="qm-section-header">
            <h2 className="qm-section-title">
              <Icon name="grid_view" size={20} />
              Multi-Source Quick Merge
            </h2>
            <p className="qm-section-desc">
              Compose complex scenes on the fly with up to {MAX_SLOTS} slots.
            </p>
          </div>

          {/* ── Section 1: Source Layers ── */}
          <div className="qm-card">
            <div className="qm-card-head">
              <div className="qm-card-head-left">
                <span className="qm-step-badge">1</span>
                <h3 className="qm-card-title">Source Slots</h3>
              </div>
              <span className="qm-layer-count">
                {activeCount} Active Slot{activeCount !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="qm-layer-stack">
              {layers.map((layer, index) => (
                <div
                  key={layer.id}
                  className={`qm-layer-row${layer.enabled ? "" : " is-disabled"}`}
                >
                  <div className="qm-layer-head">
                    <label className="qm-layer-label">
                      <Icon name={index === 0 ? "wallpaper" : "layers"} size={20} className="qm-layer-icon" />
                      Slot {index + 1}
                    </label>
                    <div className="qm-layer-actions">
                      {/* Toggle visibility */}
                      <button
                        type="button"
                        className="qm-layer-action-btn"
                        onClick={() => toggleLayerEnabled(layer.id)}
                        title={layer.enabled ? "Hide layer" : "Show layer"}
                      >
                        <Icon name={layer.enabled ? "visibility" : "visibility_off"} size={20} />
                      </button>
                      {/* Delete (not for background layer) */}
                      {index > 0 && (
                        <button
                          type="button"
                          className="qm-layer-action-btn qm-layer-action-delete"
                          onClick={() => removeLayer(layer.id)}
                          title="Remove layer"
                        >
                          <Icon name="delete" size={20} />
                        </button>
                      )}
                      {/* Active indicator */}
                      <span
                        className={`qm-layer-dot${layer.enabled && layer.source ? " is-active" : ""}`}
                      />
                    </div>
                  </div>

                  <div className="qm-layer-select-wrap">
                    <Icon name={index === 0 ? "videocam" : "picture_in_picture"} size={20} className="qm-layer-select-icon" />
                    <select
                      className="qm-layer-select"
                      value={layer.source}
                      onChange={(e) => updateLayerSource(layer.id, e.target.value)}
                    >
                      <option value="">— Select source —</option>
                      {sources.map((s) => (
                        <option key={s.sceneName} value={s.sceneName}>
                          {s.sceneName}
                        </option>
                      ))}
                    </select>
                    <Icon name="expand_more" size={20} className="qm-layer-select-arrow" />
                  </div>
                </div>
              ))}

              {layers.length < MAX_SLOTS && (
                <button type="button" className="qm-add-layer-btn" onClick={addLayer}>
                  <Icon name="add_circle" size={20} />
                  Add Slot
                </button>
              )}
            </div>
          </div>

          {/* ── Section 2: Composition Presets ── */}
          <div className="qm-card">
            <div className="qm-card-head">
              <div className="qm-card-head-left">
                <span className="qm-step-badge">2</span>
                <h3 className="qm-card-title">Composition Layout</h3>
              </div>
            </div>
            <div className="qm-layout-picker">
              <label className="qm-layout-picker-label">
                Layout Templates
              </label>
              <LayoutTemplateDropdown
                options={templateLayoutOptions}
                selectedId={selectedTemplateId}
                onSelect={handleSelectTemplate}
              />
            </div>

            {/* ── Selected template visual preview ── */}
            {selectedTemplateLayout && (
              <div className="qm-tpl-preview-card">
                <div className="qm-tpl-preview-header">
                  <Icon name="check_circle" size={16} className="qm-tpl-preview-check" />
                  <span className="qm-tpl-preview-name">{selectedTemplateLayout.name}</span>
                  <span className="qm-tpl-preview-slots">
                    {selectedTemplateLayout.regionCount} slot{selectedTemplateLayout.regionCount > 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    className="qm-tpl-preview-clear"
                    title="Clear template selection"
                    onClick={() => setSelectedTemplateId("")}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <div className="qm-tpl-preview-canvas">
                  {/* Render each visible region with OBS scene thumbnails */}
                  {selectedTemplateLayout.template.regions
                    .filter((r) => r.visible && r.width > 0 && r.height > 0)
                    .map((region, idx) => {
                      const sceneImg = templatePreviewFrames[idx % templatePreviewFrames.length]?.imageData ?? null;
                      const regionLabel = region.slotLabel || region.name || `Slot ${idx + 1}`;
                      const pct = {
                        left: `${(region.x / 1920) * 100}%`,
                        top: `${(region.y / 1080) * 100}%`,
                        width: `${(region.width / 1920) * 100}%`,
                        height: `${(region.height / 1080) * 100}%`,
                      };
                      return (
                        <div
                          key={region.id}
                          className="qm-tpl-preview-region"
                          style={{
                            ...pct,
                            backgroundColor: REGION_COLORS[idx % REGION_COLORS.length],
                            ...(sceneImg
                              ? {
                                  backgroundImage: `url(${sceneImg})`,
                                  backgroundSize: "cover",
                                  backgroundPosition: "center",
                                }
                              : {}),
                          }}
                        >
                          <span className={`qm-tpl-preview-region-label${sceneImg ? " has-image" : ""}`}>
                            {regionLabel}
                          </span>
                        </div>
                      );
                    })}
                </div>
                {templatePreviewFrames.length > 0 && (
                  <p className="qm-tpl-preview-sources">
                    {templatePreviewFrames.map((f) => f.sceneName).join("  •  ")}
                  </p>
                )}
              </div>
            )}

            {/* ── Divider between template preview and presets ── */}
            {selectedTemplateLayout && (
              <div className="qm-layout-divider">
                <span className="qm-layout-divider-text">or use a preset</span>
              </div>
            )}

            <div className="qm-preset-grid">
              {QUICK_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`qm-preset-btn${!selectedTemplateLayout && preset === p ? " is-active" : ""}`}
                  onClick={() => {
                    setSelectedTemplateId("");
                    setPreset(p);
                  }}
                  >
                  {!selectedTemplateLayout && preset === p && (
                    <Icon name="check_circle" size={20} className="qm-preset-check" />
                  )}
                  <div className={`qm-preset-thumb qm-preset-thumb--${p}`}>
                    {/* Visual thumbnail for each preset */}
                    {p === "overlay" && (
                      <>
                        <div className="qm-pt-bg" style={frameStyle(preview1)}>
                          {!preview1 && <Icon name="videocam" size={20} className="qm-pt-bg-icon" />}
                        </div>
                        <div className="qm-pt-overlay-full" style={frameStyle(preview2, preview2 ? 0.8 : 1)}>
                          {!preview2 && <Icon name="layers" size={20} className="qm-pt-overlay-icon" />}
                        </div>
                        {preview3 && (
                          <div className="qm-pt-overlay-full qm-pt-overlay-full--ghost" style={frameStyle(preview3, 0.55)} />
                        )}
                      </>
                    )}
                    {p === "side-by-side" && (
                      <>
                        <div className="qm-pt-half-left" style={frameStyle(preview1)}>
                          {!preview1 && <Icon name="videocam" size={20} className="qm-pt-half-left-icon" />}
                        </div>
                        <div className="qm-pt-half-right">
                          <div className="qm-pt-stack-top" style={frameStyle(preview2)}>
                            {!preview2 && "2"}
                          </div>
                          <div className="qm-pt-stack-bottom" style={frameStyle(preview3)}>
                            {!preview3 && "3"}
                          </div>
                        </div>
                      </>
                    )}
                    {p === "stacked-pip" && (
                      <>
                        <div className="qm-pt-bg" style={frameStyle(preview1)}>
                          {!preview1 && <Icon name="videocam" size={20} className="qm-pt-bg-icon" />}
                        </div>
                        <div className="qm-pt-pip qm-pt-pip-1" style={frameStyle(preview2)}>
                          {!preview2 && <Icon name="person" size={20} className="qm-pt-pip-icon" />}
                        </div>
                        <div className="qm-pt-pip qm-pt-pip-2" style={frameStyle(preview3)}>
                          {!preview3 && <Icon name="title" size={20} className="qm-pt-pip-icon" />}
                        </div>
                      </>
                    )}
                    {p === "quad" && (
                      <div className="qm-pt-quad">
                        <div style={frameStyle(preview1)}>{!preview1 && "1"}</div>
                        <div style={frameStyle(preview2)}>{!preview2 && "2"}</div>
                        <div style={frameStyle(preview3)}>{!preview3 && "3"}</div>
                        <div>{preview3 ? "4" : "4"}</div>
                      </div>
                    )}
                    {/* Layer count badge */}
                    <div className="qm-preset-layer-badges">
                      <span className="qm-preset-layer-badge qm-preset-layer-badge--primary">
                        <Icon name={PRESET_ICONS[p]} size={8} />
                      </span>
                      <span className="qm-preset-layer-badge">
                        {PRESET_LAYER_HINTS[p]}
                      </span>
                    </div>
                  </div>
                  <div className="qm-preset-footer">
                    <span className="qm-preset-label">{PRESET_LABELS[p]}</span>
                    <span className="qm-preset-desc">{PRESET_DESCRIPTIONS[p]}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Action buttons ── */}
          <div className="qm-action-row">
            <button
              type="button"
              className="qm-action-preview"
              disabled={applying || !obsConnected || activeCount === 0}
              onClick={handleApplyPreview}
            >
              <Icon name="preview" size={20} />
              <span className="qm-action-text">
                <strong>{applying ? "Applying…" : "Apply to Preview"}</strong>
                <small>Check multi-layer merge</small>
              </span>
            </button>
            <button
              type="button"
              className="qm-action-take"
              disabled={taking || !obsConnected || activeCount === 0}
              onClick={handleTakeLive}
            >
              <Icon name="bolt" size={20} />
              <span className="qm-action-text">
                <strong>{taking ? "Going Live…" : "TAKE LIVE"}</strong>
                <small>Transition All Layers</small>
              </span>
            </button>
          </div>
        </div>

        {/* ═══════ Right Column — Monitors ═══════ */}
        <div className="qm-right">
          <div className="qm-monitor-panel">
            <h3 className="qm-monitor-heading">
              <Icon name="monitor" size={20} />
              Monitor Output
            </h3>

            {/* Preview */}
            <div className="qm-monitor-block">
              <div className="qm-monitor-label">
                <span className="qm-monitor-dot qm-monitor-dot--pvw" />
                <span className="qm-monitor-tag qm-monitor-tag--pvw">PREVIEW</span>
                <span className="qm-monitor-res">1920×1080</span>
              </div>
              <div className="qm-monitor-frame qm-monitor-frame--pvw">
                {previewImg ? (
                  <img src={previewImg} alt="Preview" className="qm-monitor-img" />
                ) : (
                  <div className="qm-monitor-empty">
                    <Icon name="church" size={20} />
                    <span>PVW</span>
                  </div>
                )}
                <span className="qm-monitor-badge">PVW</span>
              </div>
            </div>

            {/* Program */}
            <div className="qm-monitor-block">
              <div className="qm-monitor-label">
                <span className="qm-monitor-dot qm-monitor-dot--pgm" />
                <span className="qm-monitor-tag qm-monitor-tag--pgm">PROGRAM</span>
                <span className="qm-monitor-res">LIVE</span>
              </div>
              <div className="qm-monitor-frame qm-monitor-frame--pgm">
                {programImg ? (
                  <img src={programImg} alt="Program" className="qm-monitor-img" />
                ) : (
                  <div className="qm-monitor-empty">
                    <Icon name="live_tv" size={20} />
                    <span>PGM</span>
                  </div>
                )}
                <span className="qm-monitor-badge qm-monitor-badge--live">LIVE</span>
              </div>
            </div>

            {/* Connection status */}
            <div className="qm-monitor-status">
              <div className={`qm-obs-status${obsConnected ? " is-connected" : ""}`}>
                <span className="qm-obs-status-dot" />
                <span>OBS {obsConnected ? "Connected" : "Disconnected"}</span>
              </div>
              <button
                type="button"
                className="qm-refresh-btn"
                onClick={refreshSources}
                title="Refresh sources"
              >
                <Icon name="refresh" size={20} />
              </button>
            </div>

            {/* Keyboard shortcuts */}
            <div className="qm-shortcuts-card">
              <h4>Shortcuts</h4>
              <div className="qm-shortcut-row">
                <span className="qm-shortcut-desc">Apply to Preview</span>
                <kbd>{shortcutLabel(SHORTCUT_MAP.get("qm-apply-preview")!.keys)}</kbd>
              </div>
              <div className="qm-shortcut-row">
                <span className="qm-shortcut-desc">Take Live</span>
                <kbd>{shortcutLabel(SHORTCUT_MAP.get("qm-take-live")!.keys)}</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Keyboard shortcuts ── */}
      <KeyboardHandler
        isActive={isActive}
        onApplyPreview={handleApplyPreview}
        onTakeLive={handleTakeLive}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard handler sub-component
// ---------------------------------------------------------------------------

function KeyboardHandler({
  isActive,
  onApplyPreview,
  onTakeLive,
}: {
  isActive: boolean;
  onApplyPreview: () => void;
  onTakeLive: () => void;
}) {
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onApplyPreview();
      }
      if (meta && e.key === "Enter") {
        e.preventDefault();
        onTakeLive();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, onApplyPreview, onTakeLive]);

  return null;
}
