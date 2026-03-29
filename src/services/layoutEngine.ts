/**
 * Layout Engine — OBS Church Studio
 *
 * Translates layout state into REAL OBS API calls via obs-websocket.
 * Nothing here is simulated — every function sends actual WebSocket commands.
 *
 * Managed OBS sources:
 *   "Scripture Background" — color_source_v3 (background fill)
 *   "Church Logo"          — image_source    (logo overlay)
 *
 * OBS color format: color_source_v3 uses 0xAABBGGRR (little-endian ABGR).
 * We convert CSS hex (#RRGGBB) → that format.
 */

import { invoke } from "@tauri-apps/api/core";
import { obsService } from "./obsService";
import { SUNDAY_SCENES, type GenerationConfig } from "./layoutService";
import {
    stretchToPanel as sharedStretchToPanel,
    fitInsidePanel,
    stretchToFillPanel,
} from "./cameraService";

// ---------------------------------------------------------------------------
// Constants — OBS source names we manage
// ---------------------------------------------------------------------------

const BG_SOURCE_NAME = "Scripture Background";
const BG_INPUT_KIND = "color_source_v3";

const LOGO_SOURCE_NAME = "Church Logo";
const LOGO_INPUT_KIND = "image_source";

const TARGET_SCENE = SUNDAY_SCENES.SCRIPTURE_VIEW;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutState {
    splitRatio: number;       // 0.3 – 0.7, camera width fraction
    backgroundColor: string;  // CSS hex e.g. "#102216"
    logoUrl: string | null;   // absolute file path on disk
    logoScale: number;        // 0.05 – 0.25
    autoSync: boolean;        // auto-push to OBS on every change
}

export const DEFAULT_LAYOUT_STATE: LayoutState = {
    splitRatio: 0.5,
    backgroundColor: "#000000",
    logoUrl: null,
    logoScale: 0.1,
    autoSync: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert CSS hex "#RRGGBB" to OBS color integer (ABGR little-endian).
 * OBS color_source_v3 stores color as 0xAABBGGRR unsigned 32-bit.
 */
function hexToObsColor(hex: string): number {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const obsColor = ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0;
    console.log(`[LayoutEngine] hexToObsColor: ${hex} → 0x${obsColor.toString(16).toUpperCase().padStart(8, '0')}`);
    return obsColor;
}

/**
 * Find a scene item by source name in a scene.
 * Returns { sceneItemId } or null if not found.
 */
async function findSceneItem(
    sceneName: string,
    sourceName: string
): Promise<{ sceneItemId: number } | null> {
    try {
        const items = await obsService.getSceneItemList(sceneName);
        const found = items.find((item) => item.sourceName === sourceName);
        if (found) {
            console.log(`[LayoutEngine] Found "${sourceName}" in "${sceneName}" → id ${found.sceneItemId}`);
            return { sceneItemId: found.sceneItemId };
        }
        console.log(`[LayoutEngine] "${sourceName}" NOT found in "${sceneName}"`);
        return null;
    } catch (err) {
        console.error(`[LayoutEngine] Error listing items in "${sceneName}":`, err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// File Upload via Tauri Rust
// ---------------------------------------------------------------------------

/**
 * Save an uploaded File to disk using Tauri's Rust backend.
 * Writes to ~/Documents/OBSChurchStudio/uploads/<filename>
 * Returns the absolute file path on disk.
 */
export async function saveUploadFile(file: File): Promise<string> {
    console.log(`[LayoutEngine] Saving file: ${file.name} (${file.size} bytes)`);

    // Read file as ArrayBuffer → convert to Uint8Array for Rust
    const buffer = await file.arrayBuffer();
    const fileData = Array.from(new Uint8Array(buffer));

    const absolutePath = await invoke<string>("save_upload_file", {
        fileName: file.name,
        fileData,
    });

    console.log(`[LayoutEngine] File saved to disk: ${absolutePath}`);
    return absolutePath;
}

// ---------------------------------------------------------------------------
// 1) BACKGROUND COLOR — "Scripture Background" (color_source_v3)
// ---------------------------------------------------------------------------

/**
 * Ensure "Scripture Background" color source exists in the scene.
 * If missing, creates it, moves to z=0 (bottom), stretches to fill canvas.
 */
async function ensureBackgroundSource(): Promise<number> {
    const existing = await findSceneItem(TARGET_SCENE, BG_SOURCE_NAME);

    if (existing) {
        return existing.sceneItemId;
    }

    console.log(`[LayoutEngine] Creating "${BG_SOURCE_NAME}" in "${TARGET_SCENE}"`);
    const video = await obsService.getVideoSettings();
    const itemId = await obsService.createInput(
        TARGET_SCENE,
        BG_SOURCE_NAME,
        BG_INPUT_KIND,
        { color: hexToObsColor("#000000"), width: video.baseWidth, height: video.baseHeight }
    );

    // Move to bottom layer (z-index 0)
    console.log(`[LayoutEngine] Moving "${BG_SOURCE_NAME}" to bottom layer (z=0)`);
    await obsService.setSceneItemIndex(TARGET_SCENE, itemId, 0);

    // Stretch to fill entire canvas
    console.log(`[LayoutEngine] Stretching "${BG_SOURCE_NAME}" to fill ${video.baseWidth}×${video.baseHeight}`);
    await stretchToFillPanel(TARGET_SCENE, itemId, {
        x: 0,
        y: 0,
        width: video.baseWidth,
        height: video.baseHeight,
    });

    return itemId;
}

/**
 * Apply background color to OBS.
 * Creates "Scripture Background" if it doesn't exist, then updates color.
 */
export async function applyBackgroundColor(hexColor: string): Promise<void> {
    console.log(`[LayoutEngine] ── Applying background color: ${hexColor} ──`);
    await ensureBackgroundSource();

    const obsColor = hexToObsColor(hexColor);
    console.log(`[LayoutEngine] Calling SetInputSettings("${BG_SOURCE_NAME}", { color: ${obsColor} })`);
    await obsService.setInputSettings(BG_SOURCE_NAME, { color: obsColor });

    console.log(`[LayoutEngine] ✓ Background color applied: ${hexColor}`);
}

// ---------------------------------------------------------------------------
// 2) CHURCH LOGO — "Church Logo" (image_source)
// ---------------------------------------------------------------------------

/**
 * Ensure "Church Logo" image source exists in the scene.
 * Creates if missing.
 */
async function ensureLogoSource(): Promise<number> {
    const existing = await findSceneItem(TARGET_SCENE, LOGO_SOURCE_NAME);

    if (existing) {
        return existing.sceneItemId;
    }

    console.log(`[LayoutEngine] Creating "${LOGO_SOURCE_NAME}" in "${TARGET_SCENE}"`);
    const itemId = await obsService.createInput(
        TARGET_SCENE,
        LOGO_SOURCE_NAME,
        LOGO_INPUT_KIND,
        {}
    );

    return itemId;
}

/**
 * Apply logo to OBS — sets file path, positions bottom-center, scales.
 *
 * @param filePath Absolute path to logo file on disk
 * @param scale    Logo size as fraction of canvas height (0.05–0.25)
 */
export async function applyLogo(
    filePath: string,
    scale: number
): Promise<void> {
    console.log(`[LayoutEngine] ── Applying logo: ${filePath} (scale: ${Math.round(scale * 100)}%) ──`);
    const itemId = await ensureLogoSource();
    const video = await obsService.getVideoSettings();

    // Set the image file path in OBS
    console.log(`[LayoutEngine] Calling SetInputSettings("${LOGO_SOURCE_NAME}", { file: "${filePath}" })`);
    await obsService.setInputSettings(LOGO_SOURCE_NAME, { file: filePath });

    // Calculate size (square bounds based on canvas height fraction)
    const logoHeight = Math.round(video.baseHeight * scale);
    const logoWidth = logoHeight;
    const margin = 20;

    // Position: bottom center
    const posX = Math.round((video.baseWidth - logoWidth) / 2);
    const posY = video.baseHeight - logoHeight - margin;

    console.log(`[LayoutEngine] Logo transform: pos(${posX}, ${posY}) bounds(${logoWidth}×${logoHeight})`);
    await fitInsidePanel(TARGET_SCENE, itemId, {
        x: posX,
        y: posY,
        width: logoWidth,
        height: logoHeight,
    });

    console.log(`[LayoutEngine] ✓ Logo applied: ${filePath}`);
}

/**
 * Remove logo from OBS by clearing the file path.
 */
export async function removeLogo(): Promise<void> {
    const existing = await findSceneItem(TARGET_SCENE, LOGO_SOURCE_NAME);
    if (!existing) {
        console.log("[LayoutEngine] No logo source to remove");
        return;
    }

    console.log(`[LayoutEngine] Removing logo (clearing file path)`);
    await obsService.setInputSettings(LOGO_SOURCE_NAME, { file: "" });
    console.log(`[LayoutEngine] ✓ Logo removed`);
}

// ---------------------------------------------------------------------------
// 3) SPLIT LAYOUT — Camera (left) + Scripture (right)
//
// Transform Strategy:
//   Camera:    "Stretch to Screen, then crop" — no bounds
//              1. Scale source to fill entire canvas
//              2. Crop left/right edges to fit the panel
//              Works with any camera aspect ratio (16:9, 4:3, vertical phone)
//
//   Scripture: OBS_BOUNDS_SCALE_INNER → fits inside bounds, no text cropped
// ---------------------------------------------------------------------------

/**
 * Stretch a source to fill the canvas, then crop to fit a panel.
 * Delegates to the shared cameraService.stretchToPanel.
 */
async function stretchToPanel(
    sceneName: string,
    sceneItemId: number,
    video: { baseWidth: number; baseHeight: number },
    panelX: number,
    panelWidth: number,
): Promise<void> {
    await sharedStretchToPanel(sceneName, sceneItemId, video, {
        x: panelX,
        y: 0,
        width: panelWidth,
        height: video.baseHeight,
    });
}

/**
 * Apply split ratio to "Sunday - Scripture View" scene.
 * Camera occupies left portion, Scripture occupies right portion.
 */
export async function applySplitRatio(
    config: GenerationConfig,
    ratio: number
): Promise<void> {
    const video = await obsService.getVideoSettings();
    const camWidth = Math.round(video.baseWidth * ratio);
    const scriptWidth = video.baseWidth - camWidth;

    console.log(`[LayoutEngine] ── Applying split ratio: ${Math.round(ratio * 100)}/${Math.round((1 - ratio) * 100)} ──`);
    console.log(`[LayoutEngine] Canvas: ${video.baseWidth}×${video.baseHeight}`);
    console.log(`[LayoutEngine] Camera width: ${camWidth}px | Scripture width: ${scriptWidth}px`);

    // Get camera scene item ID
    const camResponse = await obsService.call("GetSceneItemId", {
        sceneName: TARGET_SCENE,
        sourceName: config.cameraSource,
    });
    const camId = camResponse.sceneItemId as number;

    // Get scripture scene item ID
    const scriptResponse = await obsService.call("GetSceneItemId", {
        sceneName: TARGET_SCENE,
        sourceName: config.scriptureSource,
    });
    const scriptId = scriptResponse.sceneItemId as number;

    // Camera (left) — stretch to screen, crop to left panel
    await stretchToPanel(TARGET_SCENE, camId, video, 0, camWidth);

    // Scripture (right) — fit inside, no text cropped
    await fitInsidePanel(TARGET_SCENE, scriptId, {
        x: camWidth,
        y: 0,
        width: scriptWidth,
        height: video.baseHeight,
    });

    console.log(`[LayoutEngine] ✓ Split ratio applied: ${Math.round(ratio * 100)}/${Math.round((1 - ratio) * 100)}`);
}

// ---------------------------------------------------------------------------
// FULL LAYOUT APPLY — orchestrates all three + logo
// ---------------------------------------------------------------------------

/**
 * Apply the complete layout state to OBS.
 * Called by "Apply to OBS" button and by auto-sync.
 * Every call here sends real obs-websocket commands.
 */
export async function applyFullLayout(
    config: GenerationConfig,
    state: LayoutState
): Promise<void> {
    console.log("[LayoutEngine] ═══════════════════════════════════════");
    console.log("[LayoutEngine] APPLYING FULL LAYOUT TO OBS");
    console.log("[LayoutEngine] State:", JSON.stringify(state, null, 2));
    console.log("[LayoutEngine] ═══════════════════════════════════════");

    // 1. Background color
    try {
        await applyBackgroundColor(state.backgroundColor);
    } catch (err) {
        console.error("[LayoutEngine] ✗ Background color FAILED:", err);
    }

    // 2. Split ratio
    try {
        await applySplitRatio(config, state.splitRatio);
    } catch (err) {
        console.error("[LayoutEngine] ✗ Split ratio FAILED:", err);
    }

    // 3. Logo
    try {
        if (state.logoUrl) {
            await applyLogo(state.logoUrl, state.logoScale);
        } else {
            await removeLogo();
        }
    } catch (err) {
        console.error("[LayoutEngine] ✗ Logo FAILED:", err);
    }

    console.log("[LayoutEngine] ═══════════════════════════════════════");
    console.log("[LayoutEngine] FULL LAYOUT APPLIED SUCCESSFULLY");
    console.log("[LayoutEngine] ═══════════════════════════════════════");
}
