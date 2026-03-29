import type { BibleTheme } from "../bible/types";
import { getBibleFavorites, getWorshipLTFavorites, hydrateFavoriteThemes } from "../services/favoriteThemes";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";

function mergeIdSets(...sets: Array<Iterable<string>>): Set<string> {
  const merged = new Set<string>();
  for (const values of sets) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        merged.add(value);
      }
    }
  }
  return merged;
}

async function loadJsonArray<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadDockBibleFavorites(): Promise<Set<string>> {
  await hydrateFavoriteThemes().catch(() => {});
  const local = getBibleFavorites();
  const remote = await loadJsonArray<string>("/uploads/dock-bible-favorites.json");
  return mergeIdSets(local, remote);
}

export async function loadDockLTFavorites(): Promise<Set<string>> {
  await hydrateFavoriteThemes().catch(() => {});
  const local = getWorshipLTFavorites();
  const remote = await loadJsonArray<string>("/uploads/dock-lt-favorites.json");
  return mergeIdSets(local, remote);
}

export async function loadDockCustomBibleThemes(): Promise<BibleTheme[]> {
  try {
    const { getCustomThemes } = await import("../bible/bibleDb");
    const localThemes = await getCustomThemes();
    if (localThemes.length > 0) return localThemes;
  } catch {
    // Fall back to dock JSON data below.
  }

  return loadJsonArray<BibleTheme>("/uploads/dock-bible-themes.json");
}

export async function loadDockFavoriteBibleThemes(
  templateType?: BibleTheme["templateType"],
): Promise<BibleTheme[]> {
  const remoteFavorites = await loadJsonArray<BibleTheme>("/uploads/dock-bible-favorite-themes.json");
  const favoriteIds = await loadDockBibleFavorites();
  const customThemes = await loadDockCustomBibleThemes();
  const builtinIds = new Set(BUILTIN_THEMES.map((theme) => theme.id));
  const uniqueCustom = customThemes.filter((theme) => !builtinIds.has(theme.id));
  const localFavorites = [...BUILTIN_THEMES, ...uniqueCustom].filter((theme) => favoriteIds.has(theme.id));
  const remoteById = new Map(remoteFavorites.map((theme) => [theme.id, theme]));
  const localById = new Map(localFavorites.map((theme) => [theme.id, theme]));
  const merged = new Map<string, BibleTheme>([...localById, ...remoteById]);
  const values = [...merged.values()];
  return templateType ? values.filter((theme) => theme.templateType === templateType) : values;
}
