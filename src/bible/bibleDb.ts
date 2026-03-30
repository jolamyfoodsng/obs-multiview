/**
 * bibleDb.ts — IndexedDB persistence for the Bible module
 *
 * Stores: favorites, history, custom themes, user settings, downloaded translations.
 * Mirrors the pattern from multiview/mvStore.ts.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { BiblePassage, BibleTheme, SlideConfig } from "./types";
import type { InstalledBible, RawBibleData } from "./types";
import { DEFAULT_SLIDE_CONFIG, DEFAULT_THEME_SETTINGS } from "./types";
import { syncFavoriteBibleThemesToDock } from "../services/favoriteThemes";
import { serializeBibleThemesForDock } from "../services/dockBibleThemeAssets";

const DB_NAME = "sunday-switcher-bible"; // legacy name — do not change (breaks existing user data)
const DB_VERSION = 2;
const CUSTOM_THEMES_STORAGE_KEY = "ocs-bible-custom-themes";

let dbPromise: Promise<IDBPDatabase> | null = null;

function normalizeTheme(theme: BibleTheme): BibleTheme {
  return {
    ...theme,
    settings: { ...DEFAULT_THEME_SETTINGS, ...theme.settings },
  };
}

function readCustomThemesFromLocalStorage(): BibleTheme[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((theme): theme is BibleTheme => !!theme && typeof theme === "object" && "id" in theme)
      .map((theme) => normalizeTheme(theme));
  } catch {
    return [];
  }
}

function writeCustomThemesToLocalStorage(themes: BibleTheme[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      CUSTOM_THEMES_STORAGE_KEY,
      JSON.stringify(themes.map((theme) => normalizeTheme(theme)))
    );
    return true;
  } catch (err) {
    console.warn("[bibleDb] Failed to mirror custom themes to localStorage:", err);
    return false;
  }
}

function upsertCustomThemeInLocalStorage(theme: BibleTheme): boolean {
  const themes = readCustomThemesFromLocalStorage();
  const index = themes.findIndex((item) => item.id === theme.id);
  const nextTheme = normalizeTheme(theme);
  if (index >= 0) {
    themes[index] = nextTheme;
  } else {
    themes.push(nextTheme);
  }
  return writeCustomThemesToLocalStorage(themes);
}

function removeCustomThemeFromLocalStorage(id: string): boolean {
  const themes = readCustomThemesFromLocalStorage().filter((theme) => theme.id !== id);
  return writeCustomThemesToLocalStorage(themes);
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // ── v1 stores ──
        if (oldVersion < 1) {
          // Favorites store
          if (!db.objectStoreNames.contains("favorites")) {
            db.createObjectStore("favorites", { keyPath: "reference" });
          }
          // History store (keyed by timestamp)
          if (!db.objectStoreNames.contains("history")) {
            const store = db.createObjectStore("history", {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("timestamp", "timestamp");
          }
          // Custom themes
          if (!db.objectStoreNames.contains("themes")) {
            db.createObjectStore("themes", { keyPath: "id" });
          }
          // Settings (single row, key = "settings")
          if (!db.objectStoreNames.contains("settings")) {
            db.createObjectStore("settings");
          }
        }

        // ── v2: downloaded translations ──
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("translations")) {
            db.createObjectStore("translations", { keyPath: "abbr" });
          }
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function getFavorites(): Promise<BiblePassage[]> {
  const db = await getDb();
  return db.getAll("favorites");
}

export async function addFavorite(passage: BiblePassage): Promise<void> {
  const db = await getDb();
  await db.put("favorites", passage);
}

export async function removeFavorite(reference: string): Promise<void> {
  const db = await getDb();
  await db.delete("favorites", reference);
}

export async function isFavorite(reference: string): Promise<boolean> {
  const db = await getDb();
  const item = await db.get("favorites", reference);
  return !!item;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id?: number;
  passage: BiblePassage;
  timestamp: number;
}

export async function getHistory(limit = 100): Promise<HistoryEntry[]> {
  const db = await getDb();
  const tx = db.transaction("history", "readonly");
  const index = tx.store.index("timestamp");
  const entries: HistoryEntry[] = [];
  let cursor = await index.openCursor(null, "prev");

  while (cursor && entries.length < limit) {
    entries.push(cursor.value);
    cursor = await cursor.continue();
  }

  return entries;
}

export async function addToHistory(passage: BiblePassage): Promise<void> {
  const db = await getDb();
  await db.add("history", {
    passage,
    timestamp: Date.now(),
  });
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.clear("history");
}

// ---------------------------------------------------------------------------
// Custom Themes
// ---------------------------------------------------------------------------

export async function getCustomThemes(): Promise<BibleTheme[]> {
  try {
    const db = await getDb();
    const themes = (await db.getAll("themes")).map((theme) => normalizeTheme(theme));
    writeCustomThemesToLocalStorage(themes);
    return themes;
  } catch (err) {
    console.warn("[bibleDb] Failed to load custom themes from IndexedDB, falling back to localStorage:", err);
    return readCustomThemesFromLocalStorage();
  }
}

export async function saveCustomTheme(theme: BibleTheme): Promise<void> {
  const normalizedTheme = normalizeTheme(theme);
  let savedToDb = false;

  try {
    const db = await getDb();
    await db.put("themes", normalizedTheme);
    savedToDb = true;
  } catch (err) {
    console.warn("[bibleDb] Failed to save custom theme to IndexedDB, falling back to localStorage:", err);
  }

  const savedToLocalStorage = upsertCustomThemeInLocalStorage(normalizedTheme);
  if (!savedToDb && !savedToLocalStorage) {
    throw new Error("Failed to save custom theme");
  }

  syncCustomThemesToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync custom themes to dock:", err);
  });
  syncFavoriteBibleThemesToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync favorite Bible themes to dock:", err);
  });
}

export async function deleteCustomTheme(id: string): Promise<void> {
  let deletedFromDb = false;

  try {
    const db = await getDb();
    await db.delete("themes", id);
    deletedFromDb = true;
  } catch (err) {
    console.warn("[bibleDb] Failed to delete custom theme from IndexedDB, falling back to localStorage:", err);
  }

  const deletedFromLocalStorage = removeCustomThemeFromLocalStorage(id);
  if (!deletedFromDb && !deletedFromLocalStorage) {
    throw new Error("Failed to delete custom theme");
  }

  syncCustomThemesToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync custom themes to dock:", err);
  });
  syncFavoriteBibleThemesToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync favorite Bible themes to dock:", err);
  });
}

export async function syncCustomThemesToDock(themes?: BibleTheme[]): Promise<void> {
  try {
    const payload = await serializeBibleThemesForDock(themes ?? await getCustomThemes());
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-bible-themes",
      data: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[bibleDb] Failed to sync custom themes to dock:", err);
  }
}

export async function syncInstalledTranslationsToDock(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const installed = await getInstalledTranslations();

    await invoke("save_dock_data", {
      name: "dock-bible-translations",
      data: JSON.stringify(installed.map((entry) => ({
        id: entry.id,
        abbr: entry.abbr,
        name: entry.name,
        language: entry.language,
        downloadedAt: entry.downloadedAt,
        filesize: entry.filesize,
      }))),
    });

    for (const entry of installed) {
      const full = await getInstalledTranslation(entry.abbr);
      if (!full?.data) continue;
      await invoke("save_dock_data", {
        name: `dock-bible-translation-${entry.abbr.toLowerCase()}`,
        data: JSON.stringify(full.data),
      });
    }
  } catch (err) {
    console.warn("[bibleDb] Failed to sync installed translations to dock:", err);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface BibleSettings {
  defaultTranslation: string;
  slideConfig: SlideConfig;
  activeThemeId: string;
  lastBook: string;
  lastChapter: number;
  lastVerse: number;
  /** UI colour mode: 'dark' | 'light' | 'system' */
  colorMode: "dark" | "light" | "system";
  /** Auto-send verse on double-click */
  autoSendOnDoubleClick: boolean;
  /** Font scale factor for UI (1 = default) */
  uiFontScale: number;
  /** Reduce motion / animations in the app UI */
  reduceMotion: boolean;
  /** High-contrast borders and text */
  highContrast: boolean;
}

const DEFAULT_SETTINGS: BibleSettings = {
  defaultTranslation: "KJV",
  slideConfig: DEFAULT_SLIDE_CONFIG,
  activeThemeId: "classic-dark",
  lastBook: "John",
  lastChapter: 3,
  lastVerse: 1,
  colorMode: "dark",
  autoSendOnDoubleClick: true,
  uiFontScale: 1,
  reduceMotion: false,
  highContrast: false,
};

export async function getBibleSettings(): Promise<BibleSettings> {
  const db = await getDb();
  const settings = await db.get("settings", "settings");
  return settings ?? { ...DEFAULT_SETTINGS };
}

export async function saveBibleSettings(
  settings: Partial<BibleSettings>
): Promise<void> {
  const db = await getDb();
  const current = await getBibleSettings();
  await db.put("settings", { ...current, ...settings }, "settings");
}

// ---------------------------------------------------------------------------
// Downloaded Translations
// ---------------------------------------------------------------------------

/**
 * Get all installed / downloaded translations (metadata only — no data field).
 */
export async function getInstalledTranslations(): Promise<Omit<InstalledBible, "data">[]> {
  const db = await getDb();
  const all: InstalledBible[] = await db.getAll("translations");
  // Strip the heavy data field for listing
  return all.map(({ data: _data, ...meta }) => meta);
}

/**
 * Get a specific installed translation including its full data.
 */
export async function getInstalledTranslation(
  abbr: string
): Promise<InstalledBible | undefined> {
  const db = await getDb();
  return db.get("translations", abbr);
}

/**
 * Get only the Bible data for an installed translation (for loading into memory).
 */
export async function getTranslationData(
  abbr: string
): Promise<RawBibleData | undefined> {
  const bible = await getInstalledTranslation(abbr);
  return bible?.data;
}

/**
 * Save a fully downloaded + parsed Bible into IndexedDB.
 */
export async function saveInstalledTranslation(
  bible: InstalledBible
): Promise<void> {
  const db = await getDb();
  await db.put("translations", bible);
  syncInstalledTranslationsToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync installed translations after save:", err);
  });
}

/**
 * Delete a downloaded translation.
 */
export async function deleteInstalledTranslation(
  abbr: string
): Promise<void> {
  const db = await getDb();
  await db.delete("translations", abbr);
  syncInstalledTranslationsToDock().catch((err) => {
    console.warn("[bibleDb] Failed to sync installed translations after delete:", err);
  });
}

/**
 * Check if a translation is already installed.
 */
export async function isTranslationInstalled(
  abbr: string
): Promise<boolean> {
  const db = await getDb();
  const item = await db.get("translations", abbr);
  return !!item;
}

// ---------------------------------------------------------------------------
// First-Run Detection
// ---------------------------------------------------------------------------

/**
 * Returns true if this is the very first time the app is running
 * (no translations have ever been downloaded).
 */
export async function isFirstRun(): Promise<boolean> {
  const db = await getDb();
  const count = await db.count("translations");
  return count === 0;
}
