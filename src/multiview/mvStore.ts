/**
 * Multi-View Store — IndexedDB persistence via `idb`
 *
 * Stores layouts, assets, OBS mappings, and media library locally.
 * All operations are async and return clean TypeScript types.
 *
 * Database: "sunday-mv" v2
 * Object stores:
 *   layouts       — MVLayout objects (key: id)
 *   assets        — MVAsset objects (key: id)
 *   mappings      — ObsMapping objects (key: layoutId)
 *   media-library — MediaItem objects (key: id) — uploaded images/videos references
 */

import { openDB, type IDBPDatabase } from "idb";
import type {
  MVLayout,
  MVAsset,
  ObsMapping,
  LayoutId,
  AssetId,
} from "./types";
import type { StreamingPlatform } from "../services/streamQuality";

// ---------------------------------------------------------------------------
// Media Library — persisted references to uploaded images/videos
// ---------------------------------------------------------------------------

export interface MediaItem {
  id: string;
  /** Display name */
  name: string;
  /** "image" | "video" */
  mediaType: "image" | "video";
  /** Absolute file path on disk (for OBS & re-use) */
  filePath: string;
  /** Data URL or blob URL for in-app preview */
  previewSrc: string;
  /** Small thumbnail data URL */
  thumbnail?: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** ISO timestamp */
  createdAt: string;
  /** Tags / categories */
  tags: string[];
}

const DB_NAME = "sunday-mv";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 stores
        if (!db.objectStoreNames.contains("layouts")) {
          const layouts = db.createObjectStore("layouts", { keyPath: "id" });
          layouts.createIndex("updatedAt", "updatedAt");
          layouts.createIndex("isTemplate", "isTemplate");
        }
        if (!db.objectStoreNames.contains("assets")) {
          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("type", "type");
          assets.createIndex("folder", "folder");
        }
        if (!db.objectStoreNames.contains("mappings")) {
          db.createObjectStore("mappings", { keyPath: "layoutId" });
        }
        // v2 stores
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("media-library")) {
            const media = db.createObjectStore("media-library", { keyPath: "id" });
            media.createIndex("mediaType", "mediaType");
            media.createIndex("createdAt", "createdAt");
          }
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

export async function getAllLayouts(): Promise<MVLayout[]> {
  const db = await getDb();
  return db.getAll("layouts");
}

export async function getUserLayouts(): Promise<MVLayout[]> {
  const all = await getAllLayouts();
  return all.filter((l) => !l.isTemplate).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export async function getTemplateLayouts(): Promise<MVLayout[]> {
  const all = await getAllLayouts();
  return all.filter((l) => l.isTemplate).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export async function getLayout(id: LayoutId): Promise<MVLayout | undefined> {
  const db = await getDb();
  return db.get("layouts", id);
}

export async function saveLayout(layout: MVLayout): Promise<void> {
  const db = await getDb();
  layout.updatedAt = new Date().toISOString();
  await db.put("layouts", layout);
}

export async function deleteLayout(id: LayoutId): Promise<void> {
  const db = await getDb();
  await db.delete("layouts", id);
  // Also delete mapping if exists
  await db.delete("mappings", id).catch(() => {});
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function getAllAssets(): Promise<MVAsset[]> {
  const db = await getDb();
  return db.getAll("assets");
}

export async function getAsset(id: AssetId): Promise<MVAsset | undefined> {
  const db = await getDb();
  return db.get("assets", id);
}

export async function saveAsset(asset: MVAsset): Promise<void> {
  const db = await getDb();
  await db.put("assets", asset);
}

export async function deleteAsset(id: AssetId): Promise<void> {
  const db = await getDb();
  await db.delete("assets", id);
}

// ---------------------------------------------------------------------------
// OBS Mappings
// ---------------------------------------------------------------------------

export async function getMapping(layoutId: LayoutId): Promise<ObsMapping | undefined> {
  const db = await getDb();
  return db.get("mappings", layoutId);
}

export async function saveMapping(mapping: ObsMapping): Promise<void> {
  const db = await getDb();
  await db.put("mappings", mapping);
}

// ---------------------------------------------------------------------------
// Bulk / Seed
// ---------------------------------------------------------------------------

export async function seedTemplates(templates: MVLayout[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("layouts", "readwrite");
  for (const t of templates) {
    const existing = await tx.store.get(t.id);
    if (!existing) {
      await tx.store.put(t);
    }
  }
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear("layouts");
  await db.clear("assets");
  await db.clear("mappings");
  await db.clear("media-library").catch(() => {});
}

// ---------------------------------------------------------------------------
// Media Library
// ---------------------------------------------------------------------------

export async function getAllMedia(): Promise<MediaItem[]> {
  const db = await getDb();
  return db.getAll("media-library");
}

export async function getMediaByType(mediaType: "image" | "video"): Promise<MediaItem[]> {
  const db = await getDb();
  const all: MediaItem[] = await db.getAll("media-library");
  return all
    .filter((m) => m.mediaType === mediaType)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveMediaItem(item: MediaItem): Promise<void> {
  const db = await getDb();
  await db.put("media-library", item);
}

export async function deleteMediaItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("media-library", id);
}

/** Check if a media item with the given filePath already exists */
export async function findMediaByPath(filePath: string): Promise<MediaItem | undefined> {
  const all = await getAllMedia();
  return all.find((m) => m.filePath === filePath);
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

/** Export a layout as a JSON string (clean, portable) */
export function exportLayoutJSON(layout: MVLayout): string {
  const exportData = {
    _format: "sunday-mv-layout",
    _version: 2,
    _exportedAt: new Date().toISOString(),
    layout: {
      ...layout,
      // Strip runtime-only fields
      thumbnail: undefined,
    },
  };
  return JSON.stringify(exportData, null, 2);
}

/** Download a layout as a JSON file via browser download */
export function downloadLayoutJSON(layout: MVLayout): void {
  const json = exportLayoutJSON(layout);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${layout.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_layout.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Parse and validate an imported layout JSON string. Returns the layout or throws. */
export function parseImportedLayoutJSON(jsonString: string): MVLayout {
  const data = JSON.parse(jsonString);
  if (!data || data._format !== "sunday-mv-layout") {
    throw new Error("Invalid layout file format");
  }
  const layout = data.layout as MVLayout;
  if (!layout || !layout.id || !layout.regions || !layout.canvas) {
    throw new Error("Incomplete layout data");
  }
  return layout;
}

/** Import a layout from a File object. Saves to IndexedDB and returns the layout. */
export async function importLayoutFromFile(file: File): Promise<MVLayout> {
  const text = await file.text();
  const layout = parseImportedLayoutJSON(text);
  // Assign a fresh ID and timestamps so it doesn't clash with existing layouts
  const { nanoid } = await import("nanoid");
  layout.id = nanoid(12) as LayoutId;
  layout.name = `${layout.name} (Imported)`;
  layout.createdAt = new Date().toISOString();
  layout.updatedAt = new Date().toISOString();
  layout.isTemplate = false;
  await saveLayout(layout);
  return layout;
}

/** Prompt user to pick a JSON file and import it */
export function promptImportLayout(): Promise<MVLayout> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error("No file selected")); return; }
      try {
        const layout = await importLayoutFromFile(file);
        resolve(layout);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Auto-Save Recovery
// ---------------------------------------------------------------------------

const RECOVERY_KEY = "mv-recovery-layout";

/** Save a recovery snapshot to localStorage (fast, synchronous fallback) */
export function saveRecoverySnapshot(layout: MVLayout): void {
  try {
    const data = JSON.stringify({
      layout,
      savedAt: new Date().toISOString(),
    });
    localStorage.setItem(RECOVERY_KEY, data);
  } catch { /* localStorage full or unavailable — silently fail */ }
}

/** Get the recovery snapshot if one exists */
export function getRecoverySnapshot(): { layout: MVLayout; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.layout?.id) return null;
    return data;
  } catch { return null; }
}

/** Clear the recovery snapshot (e.g. after a successful save) */
export function clearRecoverySnapshot(): void {
  try { localStorage.removeItem(RECOVERY_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// First-run detection
// ---------------------------------------------------------------------------

const ONBOARDING_KEY = "mv-onboarding-complete";

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === "true";
}

export function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_KEY, "true");
}

// ---------------------------------------------------------------------------
// App Settings — persisted to localStorage for instant access
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "mv-settings";
export const MV_SETTINGS_UPDATED_EVENT = "mv-settings-updated";

export interface SpeakerProfileSetting {
  name: string;
  role: string;
}

export interface SermonPointSetting {
  id: string;
  text: string;
  type: "quote" | "point";
  attribution?: string;
}

export interface MVSettings {
  // ── OBS Connection ──
  obsUrl: string;
  obsPassword: string;
  obsAutoReconnect: boolean;
  obsConnectOnStartup: boolean;

  // ── Default Canvas ──
  defaultCanvasPreset: number; // index into CANVAS_PRESETS

  // ── Editor Defaults ──
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  showSafeMargins: boolean;
  showLabels: boolean;

  // ── Auto-Save ──
  autoSaveEnabled: boolean;
  autoSaveIntervalSec: number;

  // ── Appearance ──
  theme: "dark" | "light" | "system";
  highContrast: boolean;
  canvasBackground: string;
  animateTransitions: boolean;

  // ── Notifications ──
  showToastNotifications: boolean;

  // ── Broadcast Safety ──
  confirmBeforeProgramSend: boolean;

  // ── Streaming Platform ──
  streamingPlatform: StreamingPlatform;

  // ── Service Hub Defaults ──
  lowerThirdDefaultDurationSec: number;
  brandColor: string;
  churchName: string;
  pastorNames: string;
  pastorSpeakers: SpeakerProfileSetting[];
  brandLogoPath: string;
  socialWebsite: string;
  socialInstagram: string;
  socialFacebook: string;
  socialYouTube: string;
  socialX: string;
  socialTikTok: string;

  // ── Sermon Notes ──
  sermonTitle: string;
  sermonSeries: string;
  sermonSpeaker: string;
  sermonPoints: SermonPointSetting[];
}

export const DEFAULT_SETTINGS: MVSettings = {
  obsUrl: "ws://localhost:4455",
  obsPassword: "",
  obsAutoReconnect: true,
  obsConnectOnStartup: false,

  defaultCanvasPreset: 0,

  showGrid: true,
  snapToGrid: true,
  gridSize: 20,
  showSafeMargins: true,
  showLabels: true,

  autoSaveEnabled: true,
  autoSaveIntervalSec: 60,

  theme: "dark",
  highContrast: false,
  canvasBackground: "#0d0d1a",
  animateTransitions: true,

  showToastNotifications: true,

  confirmBeforeProgramSend: true,
  streamingPlatform: "custom",

  lowerThirdDefaultDurationSec: 10,
  brandColor: "#2563eb",
  churchName: "",
  pastorNames: "",
  pastorSpeakers: [],
  brandLogoPath: "",
  socialWebsite: "",
  socialInstagram: "",
  socialFacebook: "",
  socialYouTube: "",
  socialX: "",
  socialTikTok: "",

  sermonTitle: "",
  sermonSeries: "",
  sermonSpeaker: "",
  sermonPoints: [],
};

export function getSettings(): MVSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<MVSettings>;
    // Merge with defaults so new keys always have a value
    return { ...DEFAULT_SETTINGS, ...saved, obsPassword: "" };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: MVSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* localStorage full — silently fail */ }
}

function notifySettingsUpdated(settings: MVSettings): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MVSettings>(MV_SETTINGS_UPDATED_EVENT, { detail: settings }));
}

export function updateSettings(patch: Partial<MVSettings>): MVSettings {
  const current = getSettings();
  const updated = { ...current, ...patch, obsPassword: "" };
  saveSettings(updated);
  notifySettingsUpdated(updated);

  // Sync speaker profiles to dock data file (fire-and-forget)
  if (patch.pastorSpeakers) {
    syncSpeakersToDock(updated.pastorSpeakers).catch(() => {});
  }

  // Sync sermon data to dock data file (fire-and-forget)
  if (patch.sermonTitle !== undefined || patch.sermonPoints !== undefined || patch.sermonSpeaker !== undefined || patch.sermonSeries !== undefined) {
    syncSermonToDock(updated).catch(() => {});
  }

  // Sync branding settings to dock data file (fire-and-forget)
  if (patch.brandLogoPath !== undefined || patch.brandColor !== undefined || patch.churchName !== undefined) {
    syncBrandingToDock(updated).catch(() => {});
  }

  return updated;
}

/**
 * Sync speaker profiles to a JSON file the overlay server can serve to the dock.
 * Mirrors the pattern used by worshipDb.syncSongsToDock().
 */
export async function syncSpeakersToDock(speakers: SpeakerProfileSetting[]): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-speakers",
      data: JSON.stringify(speakers),
    });
  } catch (err) {
    console.warn("[mvStore] Failed to sync speakers to dock:", err);
  }
}

/**
 * Sync branding settings (logo, color, church name) to a JSON file the
 * overlay server can serve to the dock.  The dock page (different origin)
 * fetches /uploads/dock-branding.json to display the church logo in
 * lower-third overlays.
 */
export async function syncBrandingToDock(settings: MVSettings): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // Extract just the filename from the absolute path — the dock resolves
    // it via the overlay server at /uploads/<filename>
    const logoFileName = settings.brandLogoPath
      ? (settings.brandLogoPath.split(/[\\/]/).pop()?.trim() ?? "")
      : "";
    await invoke("save_dock_data", {
      name: "dock-branding",
      data: JSON.stringify({
        brandLogoPath: settings.brandLogoPath,
        brandLogoFileName: logoFileName,
        brandColor: settings.brandColor,
        churchName: settings.churchName,
      }),
    });
  } catch (err) {
    console.warn("[mvStore] Failed to sync branding to dock:", err);
  }
}

/**
 * Sync sermon notes to a JSON file the overlay server can serve to the dock.
 * This allows the dock (even in OBS CEF) to read the latest sermon data.
 */
export async function syncSermonToDock(settings: MVSettings): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-sermon",
      data: JSON.stringify({
        title: settings.sermonTitle,
        series: settings.sermonSeries,
        speaker: settings.sermonSpeaker,
        points: settings.sermonPoints,
      }),
    });
  } catch (err) {
    console.warn("[mvStore] Failed to sync sermon to dock:", err);
  }
}
