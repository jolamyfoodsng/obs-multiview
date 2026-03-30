/**
 * favoriteThemes.ts — Shared favorite-theme persistence
 *
 * Stores two sets of favorite theme IDs in localStorage:
 *   - "ocs-fav-bible-themes"   → Bible overlay themes (BibleTheme ids)
 *   - "ocs-fav-worship-themes" → Worship lower-third themes (LowerThirdTheme ids)
 *
 * Both Bible fullscreen and worship fullscreen share the same Bible theme pool,
 * so they share one favorites list.
 */

import { canonicalizeLowerThirdThemeId } from "../lowerthirds/themes";
import { serializeBibleThemesForDock } from "./dockBibleThemeAssets";
import { getByKey, putRecord, STORES } from "./db";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const BIBLE_FAVS_KEY = "ocs-fav-bible-themes";
const WORSHIP_LT_FAVS_KEY = "ocs-fav-worship-lt-themes";
const BIBLE_DB_KEY = "favorite-themes:bible";
const WORSHIP_LT_DB_KEY = "favorite-themes:worship-lt";
export const FAVORITE_THEMES_UPDATED_EVENT = "favorite-themes-updated";

let bibleFavoritesCache = readSet(BIBLE_FAVS_KEY);
let worshipLtFavoritesCache = normalizeLtFavorites(readSet(WORSHIP_LT_FAVS_KEY));
let hydrationPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
    return true;
  } catch (err) {
    console.warn(`[favoriteThemes] Failed to persist favorites for ${key}:`, err);
    return false;
  }
}

function normalizeLtFavorites(set: Set<string>): Set<string> {
  const normalized = new Set<string>();
  for (const themeId of set) {
    normalized.add(canonicalizeLowerThirdThemeId(themeId));
  }
  return normalized;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function canSyncDockData(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function mergeSets(...sets: Array<Set<string>>): Set<string> {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      if (typeof value === "string" && value.trim()) {
        merged.add(value);
      }
    }
  }
  return merged;
}

function emitFavoritesUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FAVORITE_THEMES_UPDATED_EVENT));
}

async function readSetFromDb(key: string): Promise<Set<string>> {
  try {
    const stored = await getByKey<unknown>(STORES.APP_SETTINGS, key);
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((value): value is string => typeof value === "string" && value.trim().length > 0));
  } catch {
    return new Set();
  }
}

async function writeSetToDb(key: string, set: Set<string>): Promise<void> {
  try {
    await putRecord(STORES.APP_SETTINGS, [...set], key);
  } catch {
    // Best-effort mirror only.
  }
}

function setBibleFavoritesCache(next: Set<string>, emit = true): void {
  bibleFavoritesCache = new Set(next);
  writeSet(BIBLE_FAVS_KEY, bibleFavoritesCache);
  if (emit) emitFavoritesUpdated();
}

function setWorshipLtFavoritesCache(next: Set<string>, emit = true): void {
  worshipLtFavoritesCache = normalizeLtFavorites(next);
  writeSet(WORSHIP_LT_FAVS_KEY, worshipLtFavoritesCache);
  if (emit) emitFavoritesUpdated();
}

function ensureHydrationStarted(): void {
  if (hydrationPromise) return;
  hydrationPromise = hydrateFavoriteThemes().catch(() => {});
}

export async function hydrateFavoriteThemes(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    const [persistedBible, persistedLt] = await Promise.all([
      readSetFromDb(BIBLE_DB_KEY),
      readSetFromDb(WORSHIP_LT_DB_KEY),
    ]);

    const mergedBible = mergeSets(bibleFavoritesCache, persistedBible);
    const mergedLt = normalizeLtFavorites(mergeSets(worshipLtFavoritesCache, persistedLt));

    const bibleChanged = !setsEqual(bibleFavoritesCache, mergedBible);
    const ltChanged = !setsEqual(worshipLtFavoritesCache, mergedLt);

    if (bibleChanged) {
      setBibleFavoritesCache(mergedBible, false);
    }
    if (ltChanged) {
      setWorshipLtFavoritesCache(mergedLt, false);
    }

    await Promise.all([
      writeSetToDb(BIBLE_DB_KEY, mergedBible),
      writeSetToDb(WORSHIP_LT_DB_KEY, mergedLt),
    ]);

    if (bibleChanged || ltChanged) {
      emitFavoritesUpdated();
    }
  })();

  return hydrationPromise;
}

// ---------------------------------------------------------------------------
// Bible themes (fullscreen overlays — shared by Bible & Worship fullscreen)
// ---------------------------------------------------------------------------

export function getBibleFavorites(): Set<string> {
  ensureHydrationStarted();
  const favorites = new Set(bibleFavoritesCache);
  if (favorites.size > 0) {
    syncBibleFavoritesToDock(favorites).catch(() => {});
    syncFavoriteBibleThemesToDock(favorites).catch(() => {});
  }
  return favorites;
}

export function toggleBibleFavorite(themeId: string): Set<string> {
  const set = new Set(bibleFavoritesCache);
  if (set.has(themeId)) {
    set.delete(themeId);
  } else {
    set.add(themeId);
  }
  setBibleFavoritesCache(set);
  writeSetToDb(BIBLE_DB_KEY, set).catch(() => {});
  syncBibleFavoritesToDock(set).catch(() => {});
  syncFavoriteBibleThemesToDock(set).catch(() => {});
  return new Set(set);
}

export function addBibleFavorite(themeId: string): Set<string> {
  const set = new Set(bibleFavoritesCache);
  if (!set.has(themeId)) {
    set.add(themeId);
    setBibleFavoritesCache(set);
    writeSetToDb(BIBLE_DB_KEY, set).catch(() => {});
    syncBibleFavoritesToDock(set).catch(() => {});
    syncFavoriteBibleThemesToDock(set).catch(() => {});
  }
  return new Set(set);
}

export function isBibleFavorite(themeId: string): boolean {
  ensureHydrationStarted();
  return bibleFavoritesCache.has(themeId);
}

// ---------------------------------------------------------------------------
// Worship lower-third themes
// ---------------------------------------------------------------------------

export function getWorshipLTFavorites(): Set<string> {
  ensureHydrationStarted();
  const normalized = new Set(worshipLtFavoritesCache);
  if (normalized.size > 0) {
    syncLTFavoritesToDock(normalized).catch(() => {});
  }
  return normalized;
}

export function toggleWorshipLTFavorite(themeId: string): Set<string> {
  const canonicalThemeId = canonicalizeLowerThirdThemeId(themeId);
  const set = new Set(worshipLtFavoritesCache);
  if (set.has(canonicalThemeId)) {
    set.delete(canonicalThemeId);
  } else {
    set.add(canonicalThemeId);
  }
  setWorshipLtFavoritesCache(set);
  writeSetToDb(WORSHIP_LT_DB_KEY, set).catch(() => {});

  // Fire-and-forget sync to dock JSON file so the dock (different origin) can read it
  syncLTFavoritesToDock(set).catch(() => {});

  return new Set(set);
}

export function isWorshipLTFavorite(themeId: string): boolean {
  ensureHydrationStarted();
  return worshipLtFavoritesCache.has(canonicalizeLowerThirdThemeId(themeId));
}

// ---------------------------------------------------------------------------
// Sort helper — favorites first, then the rest
// ---------------------------------------------------------------------------

export function sortWithFavorites<T extends { id: string }>(
  items: T[],
  favorites: Set<string>,
): T[] {
  const favs: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (favorites.has(item.id)) {
      favs.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...favs, ...rest];
}

// ---------------------------------------------------------------------------
// Dock sync — write favorites to a JSON file so the dock (different origin)
// can fetch them via the overlay HTTP server.
// ---------------------------------------------------------------------------

/**
 * Sync LT favorites to a dock-accessible JSON file.
 * Called automatically when favorites change.
 */
export async function syncLTFavoritesToDock(favorites?: Set<string>): Promise<void> {
  try {
    if (!canSyncDockData()) return;
    const favs = favorites ?? getWorshipLTFavorites();
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-lt-favorites",
      data: JSON.stringify([...favs]),
    });
  } catch (err) {
    console.warn("[favoriteThemes] Failed to sync LT favorites to dock:", err);
  }
}

export async function syncBibleFavoritesToDock(favorites?: Set<string>): Promise<void> {
  try {
    if (!canSyncDockData()) return;
    const favs = favorites ?? getBibleFavorites();
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-bible-favorites",
      data: JSON.stringify([...favs]),
    });
  } catch (err) {
    console.warn("[favoriteThemes] Failed to sync Bible favorites to dock:", err);
  }
}

export async function syncFavoriteBibleThemesToDock(favorites?: Set<string>): Promise<void> {
  try {
    if (!canSyncDockData()) return;
    const favs = favorites ?? getBibleFavorites();
    const [{ BUILTIN_THEMES }, { getCustomThemes }] = await Promise.all([
      import("../bible/themes/builtinThemes"),
      import("../bible/bibleDb"),
    ]);
    const customThemes = await getCustomThemes();
    const builtinIds = new Set(BUILTIN_THEMES.map((theme) => theme.id));
    const uniqueCustom = customThemes.filter((theme) => !builtinIds.has(theme.id));
    const favoriteThemes = [...BUILTIN_THEMES, ...uniqueCustom].filter((theme) => favs.has(theme.id));
    const serializedFavoriteThemes = await serializeBibleThemesForDock(favoriteThemes);

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-bible-favorite-themes",
      data: JSON.stringify(serializedFavoriteThemes),
    });
  } catch (err) {
    console.warn("[favoriteThemes] Failed to sync favorite Bible themes to dock:", err);
  }
}
