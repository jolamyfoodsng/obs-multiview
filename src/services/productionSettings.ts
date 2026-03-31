import type { BibleTheme } from "../bible/types";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import { getByKey, putRecord, STORES } from "./db";
import { serializeBibleThemesForDock } from "./dockBibleThemeAssets";

const PRODUCTION_SETTINGS_KEY = "production-mode-settings";
const PRODUCTION_SETTINGS_STORAGE_KEY = "ocs-production-mode-settings";

export type ProductionOverlayMode = "fullscreen" | "lower-third";

export interface ProductionModuleSettings {
  defaultMode: ProductionOverlayMode;
  fullscreenThemeId: string;
  lowerThirdThemeId: string;
}

export interface ProductionSettings {
  bible: ProductionModuleSettings;
  worship: ProductionModuleSettings;
  updatedAt: string;
}

export interface DockProductionModuleSettings extends ProductionModuleSettings {
  fullscreenTheme: BibleTheme;
  lowerThirdTheme: BibleTheme;
}

export interface DockProductionSettingsPayload {
  bible: DockProductionModuleSettings;
  worship: DockProductionModuleSettings;
  updatedAt: string;
}

const FALLBACK_FULLSCREEN_THEME =
  BUILTIN_THEMES.find((theme) => theme.templateType === "fullscreen") ?? BUILTIN_THEMES[0];
const FALLBACK_LOWER_THIRD_THEME =
  BUILTIN_THEMES.find((theme) => theme.templateType === "lower-third") ?? BUILTIN_THEMES[0];

const DEFAULT_MODULE_SETTINGS: ProductionModuleSettings = {
  defaultMode: "fullscreen",
  fullscreenThemeId: FALLBACK_FULLSCREEN_THEME.id,
  lowerThirdThemeId: FALLBACK_LOWER_THIRD_THEME.id,
};

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function canSyncDockData(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isOverlayMode(value: unknown): value is ProductionOverlayMode {
  return value === "fullscreen" || value === "lower-third";
}

function isBibleTheme(value: unknown): value is BibleTheme {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BibleTheme>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.templateType === "string" &&
    typeof candidate.settings === "object" &&
    candidate.settings !== null
  );
}

function readLocalSettings(): Partial<ProductionSettings> | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(PRODUCTION_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<ProductionSettings>) : null;
  } catch {
    return null;
  }
}

function writeLocalSettings(settings: ProductionSettings): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(PRODUCTION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[productionSettings] Failed to mirror production settings to localStorage:", err);
  }
}

function normalizeModuleSettings(
  value: Partial<ProductionModuleSettings> | undefined,
  fallback: ProductionModuleSettings = DEFAULT_MODULE_SETTINGS,
): ProductionModuleSettings {
  return {
    defaultMode: isOverlayMode(value?.defaultMode) ? value.defaultMode : fallback.defaultMode,
    fullscreenThemeId:
      typeof value?.fullscreenThemeId === "string" && value.fullscreenThemeId.trim()
        ? value.fullscreenThemeId
        : fallback.fullscreenThemeId,
    lowerThirdThemeId:
      typeof value?.lowerThirdThemeId === "string" && value.lowerThirdThemeId.trim()
        ? value.lowerThirdThemeId
        : fallback.lowerThirdThemeId,
  };
}

function resolveTheme(
  themeId: string,
  templateType: BibleTheme["templateType"],
  themes: BibleTheme[],
): BibleTheme {
  return (
    themes.find((theme) => theme.id === themeId && theme.templateType === templateType) ??
    themes.find((theme) => theme.templateType === templateType) ??
    (templateType === "lower-third" ? FALLBACK_LOWER_THIRD_THEME : FALLBACK_FULLSCREEN_THEME)
  );
}

function uniqueThemes(themes: BibleTheme[]): BibleTheme[] {
  const seen = new Set<string>();
  const result: BibleTheme[] = [];
  for (const theme of themes) {
    if (seen.has(theme.id)) continue;
    seen.add(theme.id);
    result.push(theme);
  }
  return result;
}

export function getDefaultProductionSettings(): ProductionSettings {
  return {
    bible: { ...DEFAULT_MODULE_SETTINGS },
    worship: { ...DEFAULT_MODULE_SETTINGS },
    updatedAt: new Date(0).toISOString(),
  };
}

export function normalizeProductionSettings(raw?: Partial<ProductionSettings> | null): ProductionSettings {
  const fallback = getDefaultProductionSettings();
  return {
    bible: normalizeModuleSettings(raw?.bible, fallback.bible),
    worship: normalizeModuleSettings(raw?.worship, fallback.worship),
    updatedAt:
      typeof raw?.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : fallback.updatedAt,
  };
}

export async function loadAvailableProductionThemes(): Promise<BibleTheme[]> {
  try {
    const { getCustomThemes } = await import("../bible/bibleDb");
    const customThemes = await getCustomThemes();
    const builtinIds = new Set(BUILTIN_THEMES.map((theme) => theme.id));
    return uniqueThemes([
      ...BUILTIN_THEMES,
      ...customThemes.filter((theme) => !builtinIds.has(theme.id)),
    ]);
  } catch {
    return [...BUILTIN_THEMES];
  }
}

export function resolveProductionSettings(
  settings: ProductionSettings,
  themes: BibleTheme[],
): DockProductionSettingsPayload {
  const normalized = normalizeProductionSettings(settings);
  const availableThemes = themes.length > 0 ? uniqueThemes(themes) : [...BUILTIN_THEMES];

  const buildModule = (moduleSettings: ProductionModuleSettings): DockProductionModuleSettings => ({
    ...moduleSettings,
    fullscreenTheme: resolveTheme(moduleSettings.fullscreenThemeId, "fullscreen", availableThemes),
    lowerThirdTheme: resolveTheme(moduleSettings.lowerThirdThemeId, "lower-third", availableThemes),
  });

  return {
    updatedAt: normalized.updatedAt,
    bible: buildModule(normalized.bible),
    worship: buildModule(normalized.worship),
  };
}

export function getDefaultDockProductionSettings(): DockProductionSettingsPayload {
  return resolveProductionSettings(getDefaultProductionSettings(), BUILTIN_THEMES);
}

export async function getProductionSettings(): Promise<ProductionSettings> {
  const [fromDb, fromLocal] = await Promise.all([
    getByKey<ProductionSettings>(STORES.APP_SETTINGS, PRODUCTION_SETTINGS_KEY).catch(() => undefined),
    Promise.resolve(readLocalSettings() ?? undefined),
  ]);

  const normalized = normalizeProductionSettings(fromDb ?? fromLocal ?? undefined);
  writeLocalSettings(normalized);
  return normalized;
}

export async function saveProductionSettings(settings: ProductionSettings): Promise<ProductionSettings> {
  const normalized = normalizeProductionSettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  });

  await putRecord(STORES.APP_SETTINGS, normalized, PRODUCTION_SETTINGS_KEY).catch((err) => {
    console.warn("[productionSettings] Failed to save production settings to IndexedDB:", err);
  });
  writeLocalSettings(normalized);
  return normalized;
}

async function serializeDockPayload(
  payload: DockProductionSettingsPayload,
): Promise<DockProductionSettingsPayload> {
  const serializedThemes = await serializeBibleThemesForDock(
    uniqueThemes([
      payload.bible.fullscreenTheme,
      payload.bible.lowerThirdTheme,
      payload.worship.fullscreenTheme,
      payload.worship.lowerThirdTheme,
    ]),
  );
  const serializedById = new Map(serializedThemes.map((theme) => [theme.id, theme]));

  const mapModule = (moduleSettings: DockProductionModuleSettings): DockProductionModuleSettings => ({
    ...moduleSettings,
    fullscreenTheme:
      serializedById.get(moduleSettings.fullscreenTheme.id) ?? moduleSettings.fullscreenTheme,
    lowerThirdTheme:
      serializedById.get(moduleSettings.lowerThirdTheme.id) ?? moduleSettings.lowerThirdTheme,
  });

  return {
    ...payload,
    bible: mapModule(payload.bible),
    worship: mapModule(payload.worship),
  };
}

export async function buildDockProductionSettingsPayload(
  settings?: ProductionSettings,
): Promise<DockProductionSettingsPayload> {
  const [resolvedSettings, themes] = await Promise.all([
    settings ? Promise.resolve(normalizeProductionSettings(settings)) : getProductionSettings(),
    loadAvailableProductionThemes(),
  ]);
  const payload = resolveProductionSettings(resolvedSettings, themes);
  return serializeDockPayload(payload);
}

export async function syncProductionSettingsToDock(
  settings?: ProductionSettings,
): Promise<DockProductionSettingsPayload> {
  const payload = await buildDockProductionSettingsPayload(settings);

  if (!canSyncDockData()) {
    return payload;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_dock_data", {
      name: "dock-production-settings",
      data: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[productionSettings] Failed to sync production settings to dock:", err);
  }

  return payload;
}

function normalizeDockPayload(raw: unknown): DockProductionSettingsPayload | null {
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as Partial<Record<keyof DockProductionSettingsPayload, unknown>>;
  const normalized = normalizeProductionSettings(candidate as Partial<ProductionSettings>);
  const fallback = resolveProductionSettings(normalized, BUILTIN_THEMES);

  const normalizeDockModule = (
    value: unknown,
    fallbackModule: DockProductionModuleSettings,
  ): DockProductionModuleSettings => {
    const moduleValue = value && typeof value === "object"
      ? (value as Partial<DockProductionModuleSettings>)
      : {};
    const baseModule = normalizeModuleSettings(moduleValue, fallbackModule);

    return {
      ...baseModule,
      fullscreenTheme: isBibleTheme(moduleValue.fullscreenTheme)
        ? moduleValue.fullscreenTheme
        : fallbackModule.fullscreenTheme,
      lowerThirdTheme: isBibleTheme(moduleValue.lowerThirdTheme)
        ? moduleValue.lowerThirdTheme
        : fallbackModule.lowerThirdTheme,
    };
  };

  return {
    updatedAt: normalized.updatedAt,
    bible: normalizeDockModule(candidate.bible, fallback.bible),
    worship: normalizeDockModule(candidate.worship, fallback.worship),
  };
}

export async function loadDockProductionSettings(): Promise<DockProductionSettingsPayload> {
  try {
    const response = await fetch("/uploads/dock-production-settings.json", { cache: "no-store" });
    if (response.ok) {
      const raw: unknown = await response.json();
      const normalized = normalizeDockPayload(raw);
      if (normalized) return normalized;
    }
  } catch {
    // Fall through to app-side resolution.
  }

  try {
    return await buildDockProductionSettingsPayload();
  } catch {
    return getDefaultDockProductionSettings();
  }
}
