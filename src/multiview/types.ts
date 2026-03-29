/**
 * Multi-View Editor — Core Data Models
 *
 * These types define every object in the Multi-View system.
 * Persisted to IndexedDB via the mvStore service.
 *
 * v2: Template-driven system with region constraints, safe frame,
 *     background-as-base-layer, and professional broadcast presets.
 *
 * Naming convention:
 *   MV prefix = Multi-View (avoids collisions with existing OBS Church Studio types)
 */

// ---------------------------------------------------------------------------
// IDs — branded strings for type safety
// ---------------------------------------------------------------------------

/** Unique layout ID (nanoid) */
export type LayoutId = string & { readonly __brand: "LayoutId" };
/** Unique region ID within a layout */
export type RegionId = string & { readonly __brand: "RegionId" };
/** Unique asset ID */
export type AssetId = string & { readonly __brand: "AssetId" };
/** Unique template ID */
export type TemplateId = string & { readonly __brand: "TemplateId" };

// ---------------------------------------------------------------------------
// Canvas Configuration
// ---------------------------------------------------------------------------

export interface CanvasConfig {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Display name for the resolution */
  label: string;
}

export const CANVAS_PRESETS: CanvasConfig[] = [
  { width: 1920, height: 1080, label: "1080p (16:9)" },
  { width: 1280, height: 720, label: "720p (16:9)" },
  { width: 1080, height: 1920, label: "1080p Vertical (9:16)" },
  { width: 3840, height: 2160, label: "4K (16:9)" },
];

// ---------------------------------------------------------------------------
// Safe Frame / Canvas Padding
// ---------------------------------------------------------------------------

export interface SafeFrameConfig {
  /** Padding from each canvas edge in px. Content regions stay inside. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Whether safe frame is active (constrains content placement) */
  enabled: boolean;
  /** Whether to show the safe frame overlay on the canvas */
  visible: boolean;
}

export const DEFAULT_SAFE_FRAME: SafeFrameConfig = {
  top: 80,
  right: 80,
  bottom: 80,
  left: 80,
  enabled: true,
  visible: true,
};

// ---------------------------------------------------------------------------
// Background Configuration — always the base layer (z=0, edge-to-edge)
// ---------------------------------------------------------------------------

export type BackgroundType = "color" | "image" | "video";

export interface BackgroundConfig {
  type: BackgroundType;
  /** CSS color string (for type "color") */
  color: string;
  /** Image src (data URL or path, for type "image") */
  imageSrc?: string;
  /** Video src (data URL or path, for type "video") */
  videoSrc?: string;
  /** Absolute file path on disk (for OBS — images and videos) */
  filePath?: string;
  /** How image/video fills the canvas */
  objectFit: "cover" | "contain" | "fill";
  /** Whether video loops */
  loop: boolean;
  /** Opacity 0–1 */
  opacity: number;
}

export const DEFAULT_BACKGROUND: BackgroundConfig = {
  type: "color",
  color: "#0a0a14",
  objectFit: "cover",
  loop: true,
  opacity: 1,
};

// ---------------------------------------------------------------------------
// Region Types — what can live on the canvas (content layer, above background)
// ---------------------------------------------------------------------------

export type RegionType =
  | "obs-scene"       // OBS scene (nested scene as source)
  | "video-input"     // Camera / capture card
  | "image-overlay"   // Static image (logo, graphic)
  | "media"           // Video / animated background
  | "browser"         // Browser source (URL)
  | "color";          // Solid color fill

// ---------------------------------------------------------------------------
// Region Constraints — template-defined editing limits
// ---------------------------------------------------------------------------

export interface RegionConstraints {
  /** Can the user move this region? */
  lockPosition: boolean;
  /** Can the user resize this region? */
  lockSize: boolean;
  /** Can the user delete this region? */
  lockDelete: boolean;
  /** Minimum width in px (0 = no min) */
  minWidth: number;
  /** Minimum height in px (0 = no min) */
  minHeight: number;
  /** Maximum width in px (0 = no max, uses canvas width) */
  maxWidth: number;
  /** Maximum height in px (0 = no max, uses canvas height) */
  maxHeight: number;
  /** Allowed content types for this slot */
  allowedContentTypes: RegionType[];
  /** Which style properties the user can edit */
  editableStyles: RegionEditableStyle[];
}

/** Which style properties can be user-modified */
export type RegionEditableStyle =
  | "opacity"
  | "borderRadius"
  | "color"
  | "objectFit"
  | "rotation";

export const DEFAULT_CONSTRAINTS: RegionConstraints = {
  lockPosition: false,
  lockSize: false,
  lockDelete: false,
  minWidth: 20,
  minHeight: 20,
  maxWidth: 0,
  maxHeight: 0,
  allowedContentTypes: [
    "obs-scene",
    "video-input",
    "image-overlay",
    "media",
    "browser",
    "color",
  ],
  editableStyles: ["opacity", "borderRadius", "color", "objectFit", "rotation"],
};

// ---------------------------------------------------------------------------
// Region Base — shared fields for all region types
// ---------------------------------------------------------------------------

export interface RegionBase {
  id: RegionId;
  type: RegionType;
  /** Display name */
  name: string;
  /** Slot label (from template, e.g. "Camera Box", "Scripture Area") */
  slotLabel?: string;
  /** X position (px from canvas left) */
  x: number;
  /** Y position (px from canvas top) */
  y: number;
  /** Width in px */
  width: number;
  /** Height in px */
  height: number;
  /** Rotation in degrees */
  rotation: number;
  /** Z-index (higher = on top). Background is always 0. Content starts at 1. */
  zIndex: number;
  /** Opacity 0–1 */
  opacity: number;
  /** Is the region locked from editing? */
  locked: boolean;
  /** Is the region visible? */
  visible: boolean;
  /** Border radius in px */
  borderRadius: number;
  /** Optional OBS source name this region maps to */
  obsSourceName?: string;
  /** Optional OBS source type for auto-creation */
  obsSourceType?: string;
  /** Template-defined constraints for this region */
  constraints: RegionConstraints;

  // ── Theme / overlay settings (Bible & Worship slots) ────────────────────
  /** ID of the assigned theme (e.g. "classic-dark", "worship-modern") */
  themeId?: string;
  /** Full snapshot of the theme settings at time of assignment */
  themeSettings?: import("../bible/types").BibleThemeSettings;
  /** User-level font overrides on top of the theme */
  fontOverrides?: { fontSize?: number; textTransform?: string; fontFamily?: string; textAlign?: string; verticalAlign?: "top" | "center" | "bottom" };
}

// ── Type-specific region data ──

export interface VideoInputRegion extends RegionBase {
  type: "video-input";
  /** OBS input/source name to capture from */
  inputName: string;
}

export interface OBSSceneRegion extends RegionBase {
  type: "obs-scene";
  /** OBS scene name to nest as a source */
  sceneName: string;
  /** Scene index in OBS scene list (for ordering) */
  sceneIndex: number;
  /** Cached thumbnail (base64 data URL) */
  thumbnail?: string;
}

export interface ImageOverlayRegion extends RegionBase {
  type: "image-overlay";
  /** Asset ID or data URL */
  assetId?: AssetId;
  src: string;
  /** Absolute file path on disk (for OBS). Takes priority over src data URLs. */
  filePath?: string;
  /** Object fit: cover, contain, fill */
  objectFit: "cover" | "contain" | "fill";
}

export interface MediaRegion extends RegionBase {
  type: "media";
  assetId?: AssetId;
  src: string;
  /** Absolute file path on disk (for OBS). Takes priority over src data URLs. */
  filePath?: string;
  loop: boolean;
  objectFit: "cover" | "contain" | "fill";
}

export interface BrowserRegion extends RegionBase {
  type: "browser";
  url: string;
}

export interface ColorRegion extends RegionBase {
  type: "color";
  color: string;
}

/** Union of all region types */
export type Region =
  | OBSSceneRegion
  | VideoInputRegion
  | ImageOverlayRegion
  | MediaRegion
  | BrowserRegion
  | ColorRegion;

// ---------------------------------------------------------------------------
// Template Definition — a preset layout blueprint
// ---------------------------------------------------------------------------

export interface TemplateDefinition {
  id: TemplateId;
  /** Display name */
  name: string;
  /** Description shown in gallery */
  description: string;
  /** Category for grouping in gallery */
  category: TemplateCategory;
  /** Thumbnail icon (Material Icons name) */
  icon: string;
  /** Canvas dimensions */
  canvas: CanvasConfig;
  /** Default background for this template */
  background: BackgroundConfig;
  /** Default safe frame for this template */
  safeFrame: SafeFrameConfig;
  /** Region blueprints — these define the slots */
  regions: Region[];
  /** Tags for search/filter */
  tags: string[];
  /** Preview color accent for card display */
  accentColor: string;
}

export type TemplateCategory =
  | "sermon"
  | "worship"
  | "announcement"
  | "multi-camera"
  | "ceremony"
  | "youth"
  | "kids"
  | "custom";

// ---------------------------------------------------------------------------
// Transition — OBS scene transition config per-layout
// ---------------------------------------------------------------------------

export type MVTransitionKind = "Cut" | "Fade" | "Swipe" | "Slide";

export interface MVTransitionConfig {
  /** Transition type — maps to OBS built-in transition names */
  kind: MVTransitionKind;
  /** Duration in ms (ignored for Cut) */
  durationMs: number;
}

export const DEFAULT_TRANSITION_CONFIG: MVTransitionConfig = {
  kind: "Fade",
  durationMs: 500,
};

export const MV_TRANSITION_OPTIONS: { kind: MVTransitionKind; label: string; icon: string }[] = [
  { kind: "Cut",   label: "Cut",   icon: "content_cut" },
  { kind: "Fade",  label: "Fade",  icon: "gradient" },
  { kind: "Swipe", label: "Swipe", icon: "swipe" },
  { kind: "Slide", label: "Slide", icon: "slideshow" },
];

// ---------------------------------------------------------------------------
// Layout — a saved multi-view composition (user's instance of a template)
// ---------------------------------------------------------------------------

export interface MVLayout {
  id: LayoutId;
  /** User-facing name */
  name: string;
  /** Optional description */
  description: string;
  /** Canvas dimensions */
  canvas: CanvasConfig;
  /** All regions in this layout */
  regions: Region[];
  /** Background configuration (base layer) */
  background: BackgroundConfig;
  /** Safe frame configuration */
  safeFrame: SafeFrameConfig;
  /** Auto-generated thumbnail (data URL) */
  thumbnail?: string;
  /** Tags for filtering */
  tags: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last modification */
  updatedAt: string;
  /** Is this a built-in template? */
  isTemplate: boolean;
  /** Template ID this was cloned from (if any) */
  fromTemplateId?: TemplateId;

  /** OBS transition settings for this layout (defaults to Fade 500ms) */
  transition?: MVTransitionConfig;

  // ── Legacy fields (kept for backward-compat, new code uses `background`) ──
  backgroundColor?: string;
  backgroundSrc?: string;
  backgroundAssetId?: AssetId;
  logoAssetId?: AssetId;
  logoSrc?: string;
  logoPosition?: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Asset — uploaded media files
// ---------------------------------------------------------------------------

export type AssetType = "image" | "video" | "audio";

export interface MVAsset {
  id: AssetId;
  name: string;
  type: AssetType;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Data URL or blob URL */
  src: string;
  /** Thumbnail data URL (for images/videos) */
  thumbnail?: string;
  /** Tags for organizing */
  tags: string[];
  /** Folder path */
  folder: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// OBS Mapping — how a layout maps to OBS
// ---------------------------------------------------------------------------

export interface ObsRegionMapping {
  regionId: RegionId;
  /** OBS scene item ID (after creation) */
  obsSceneItemId?: number;
  /** OBS source name */
  obsSourceName: string;
  /** OBS source type (browser_source, ffmpeg_source, text_gdiplus_v3, etc.) */
  obsSourceKind: string;
  /** Extra OBS input settings */
  obsInputSettings?: Record<string, unknown>;
}

export interface ObsMapping {
  layoutId: LayoutId;
  /** Target OBS scene name */
  obsSceneName: string;
  /** Per-region mappings */
  regionMappings: ObsRegionMapping[];
  /** Last time this mapping was pushed to OBS */
  lastPushedAt?: string;
}

// ---------------------------------------------------------------------------
// Editor State — in-memory state for the canvas editor (not persisted)
// ---------------------------------------------------------------------------

export interface EditorState {
  /** Currently open layout */
  layout: MVLayout | null;
  /** Selected region IDs */
  selectedRegionIds: RegionId[];
  /** Clipboard (copied regions) */
  clipboard: Region[];
  /** Undo stack */
  undoStack: MVLayout[];
  /** Redo stack */
  redoStack: MVLayout[];
  /** Zoom level (1 = 100%) */
  zoom: number;
  /** Canvas pan offset */
  panX: number;
  panY: number;
  /** Show safe frame overlay? */
  showSafeFrame: boolean;
  /** Show grid? */
  showGrid: boolean;
  /** Snap enabled? */
  snapEnabled: boolean;
  /** Is currently dragging? */
  isDragging: boolean;
  /** Is currently resizing? */
  isResizing: boolean;
  /** Show background picker panel */
  showBackgroundPicker: boolean;
}

export const INITIAL_EDITOR_STATE: EditorState = {
  layout: null,
  selectedRegionIds: [],
  clipboard: [],
  undoStack: [],
  redoStack: [],
  zoom: 1,
  panX: 0,
  panY: 0,
  showSafeFrame: true,
  showGrid: false,
  snapEnabled: true,
  isDragging: false,
  isResizing: false,
  showBackgroundPicker: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default region values for new regions */
export function createDefaultRegion(
  type: RegionType,
  id: RegionId,
  canvas: CanvasConfig,
  safeFrame?: SafeFrameConfig
): Region {
  const sf = safeFrame ?? DEFAULT_SAFE_FRAME;
  const contentX = sf.enabled ? sf.left : Math.round(canvas.width * 0.1);
  const contentY = sf.enabled ? sf.top : Math.round(canvas.height * 0.1);
  const contentW = sf.enabled
    ? canvas.width - sf.left - sf.right
    : Math.round(canvas.width * 0.4);
  const contentH = sf.enabled
    ? canvas.height - sf.top - sf.bottom
    : Math.round(canvas.height * 0.4);

  const base: RegionBase = {
    id,
    type,
    name: regionTypeLabel(type),
    x: contentX + Math.round(contentW * 0.1),
    y: contentY + Math.round(contentH * 0.1),
    width: Math.round(contentW * 0.6),
    height: Math.round(contentH * 0.6),
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    visible: true,
    borderRadius: 0,
    constraints: { ...DEFAULT_CONSTRAINTS },
  };

  switch (type) {
    case "obs-scene":
      return { ...base, type: "obs-scene", sceneName: "", sceneIndex: -1 };
    case "video-input":
      return { ...base, type: "video-input", inputName: "" };
    case "image-overlay":
      return { ...base, type: "image-overlay", src: "", objectFit: "cover", width: 450, height: 450 };
    case "media":
      return { ...base, type: "media", src: "", loop: true, objectFit: "cover" };
    case "browser":
      return { ...base, type: "browser", url: "" };
    case "color":
      return { ...base, type: "color", color: "#000000" };
  }
}

export function regionTypeLabel(type: RegionType): string {
  const labels: Record<RegionType, string> = {
    "obs-scene": "OBS Scene",
    "video-input": "Video Input",
    "image-overlay": "Image",
    "media": "Media",
    "browser": "Browser",
    "color": "Color Fill",
  };
  return labels[type];
}

export function regionTypeIcon(type: RegionType): string {
  const icons: Record<RegionType, string> = {
    "obs-scene": "slideshow",
    "video-input": "videocam",
    "image-overlay": "image",
    "media": "movie",
    "browser": "language",
    "color": "format_color_fill",
  };
  return icons[type];
}

/** Get the content area rect (inside safe frame) */
export function getContentArea(
  canvas: CanvasConfig,
  safeFrame: SafeFrameConfig
): { x: number; y: number; width: number; height: number } {
  if (!safeFrame.enabled) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  return {
    x: safeFrame.left,
    y: safeFrame.top,
    width: canvas.width - safeFrame.left - safeFrame.right,
    height: canvas.height - safeFrame.top - safeFrame.bottom,
  };
}

/** Migrate a legacy layout to the new format */
export function migrateLayout(layout: MVLayout): MVLayout {
  const out = { ...layout };
  // Add background if missing
  if (!out.background) {
    const bg: BackgroundConfig = {
      ...DEFAULT_BACKGROUND,
      color: out.backgroundColor ?? "#0a0a14",
    };
    if (out.backgroundSrc) {
      bg.type = "image";
      bg.imageSrc = out.backgroundSrc;
    }
    out.background = bg;
  }
  // Add safeFrame if missing
  if (!out.safeFrame) {
    out.safeFrame = { ...DEFAULT_SAFE_FRAME };
  }
  // Add constraints to regions if missing
  out.regions = out.regions.map((r) => {
    if (!r.constraints) {
      return { ...r, constraints: { ...DEFAULT_CONSTRAINTS } };
    }
    return r;
  });
  return out;
}
