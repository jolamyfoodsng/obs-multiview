/**
 * store.ts — Local JSON Storage
 *
 * Thin wrapper over Tauri invoke for ~/Documents/OBSChurchStudio/app_data.json.
 * No React Context. No state manager. Just read/write a JSON file.
 *
 * Auto-saves on every call to updateData().
 * Returns typed defaults if file is missing or corrupt.
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppData {
    churchName: string;
    themeColor: string;
    logoPath: string | null;
    obsWebSocket: {
        url: string;
        password: string;
        autoConnect: boolean;
    };
    layout: {
        splitRatio: number;
        backgroundColor: string;
        logoScale: number;
    };
    sources: {
        cameraSource: string | null;
        scriptureSource: string | null;
    };
    /** Last-used preset ID */
    activePreset: string;
    /** Volunteer mode: hides advanced settings */
    volunteerMode: boolean;
    /** Transition settings */
    transition: {
        kind: string;
        durationMs: number;
    };
    /** PiP settings */
    pip: {
        size: number;
        corner: string;
    };
}

export const DEFAULT_APP_DATA: AppData = {
    churchName: "",
    themeColor: "#102216",
    logoPath: null,
    obsWebSocket: {
        url: "ws://localhost:4455",
        password: "",
        autoConnect: false,
    },
    layout: {
        splitRatio: 0.5,
        backgroundColor: "#000000",
        logoScale: 0.1,
    },
    sources: {
        cameraSource: null,
        scriptureSource: null,
    },
    activePreset: "full-pastor",
    volunteerMode: false,
    transition: {
        kind: "Cut",
        durationMs: 300,
    },
    pip: {
        size: 0.25,
        corner: "bottom-right",
    },
};

// ---------------------------------------------------------------------------
// In-memory cache (avoid reading disk on every access)
// ---------------------------------------------------------------------------

let cache: AppData | null = null;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load app data from disk. Returns cached copy if already loaded.
 * If file is missing or corrupt, returns defaults.
 */
export async function loadData(): Promise<AppData> {
    if (cache) return cache;

    try {
        const raw = await invoke<string>("load_app_data");
        const parsed = JSON.parse(raw);
        // Merge with defaults to fill any missing fields
        cache = deepMerge(DEFAULT_APP_DATA, parsed);
        return cache;
    } catch (err) {
        console.warn("[Store] Failed to load, using defaults:", err);
        cache = { ...DEFAULT_APP_DATA };
        return cache;
    }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save current app data to disk. Call this after any mutation.
 */
export async function saveData(data: AppData): Promise<void> {
    cache = data;
    try {
        const json = JSON.stringify(data, null, 2);
        await invoke("save_app_data", { data: json });
    } catch (err) {
        console.error("[Store] Failed to save:", err);
    }
}

// ---------------------------------------------------------------------------
// Update (merge + save — the main auto-save function)
// ---------------------------------------------------------------------------

/**
 * Merge partial updates into current data and save to disk.
 * This is the primary function UI components should call.
 *
 * Usage: await updateData({ layout: { ...current.layout, splitRatio: 0.6 } })
 */
export async function updateData(partial: DeepPartial<AppData>): Promise<void> {
    const current = await loadData();
    const merged = deepMerge(current, partial);
    await saveData(merged);
}

/**
 * Get cached data synchronously (returns null if not yet loaded).
 * Use loadData() for the first access.
 */
export function getCachedData(): AppData | null {
    return cache;
}

/**
 * Force reload from disk (clears cache).
 */
export async function reloadData(): Promise<AppData> {
    cache = null;
    return loadData();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Simple deep merge: target ← source. Only merges plain objects, not arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge<T extends Record<string, any>>(
    target: T,
    source: DeepPartial<T>
): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        const srcVal = source[key];
        const tgtVal = target[key];
        if (
            srcVal !== undefined &&
            srcVal !== null &&
            typeof srcVal === "object" &&
            !Array.isArray(srcVal) &&
            typeof tgtVal === "object" &&
            !Array.isArray(tgtVal) &&
            tgtVal !== null
        ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result[key] = deepMerge(tgtVal as any, srcVal as any) as T[keyof T];
        } else if (srcVal !== undefined) {
            result[key] = srcVal as T[keyof T];
        }
    }
    return result;
}
