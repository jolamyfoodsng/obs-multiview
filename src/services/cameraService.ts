/**
 * Camera Service — OBS Church Studio
 *
 * Shared camera transform logic used by presets, layout engine, and repair.
 * Single source of truth for all OBS scene item positioning.
 *
 * STRATEGY: "Read source resolution → compute scale → crop overflow"
 *
 * OBS bounds (SCALE_OUTER etc.) are unreliable when stale transforms exist —
 * the bounding box moves but the video inside doesn't resize. Instead we:
 *   1. Read the source's native resolution via GetSceneItemTransform
 *   2. Compute scaleX/scaleY to cover the target panel (like CSS "cover")
 *   3. Crop the overflow so the video fits the panel exactly
 *
 * This matches what OBS does internally when you right-click → Stretch to
 * Screen and then drag the edges to crop.
 */

import { obsService } from "./obsService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal video dimensions needed for transform calculations */
export interface VideoDimensions {
    baseWidth: number;
    baseHeight: number;
}

export interface PanelRect {
    /** Left edge of the panel in canvas pixels */
    x: number;
    /** Top edge of the panel in canvas pixels */
    y: number;
    /** Width of the panel in canvas pixels */
    width: number;
    /** Height of the panel in canvas pixels */
    height: number;
}

/** Native source dimensions read from OBS */
interface SourceDims {
    sourceWidth: number;
    sourceHeight: number;
}

// ---------------------------------------------------------------------------
// Helper: read source native resolution
// ---------------------------------------------------------------------------

async function getSourceDimensions(
    sceneName: string,
    sceneItemId: number
): Promise<SourceDims> {
    const t = await obsService.getSceneItemTransform(sceneName, sceneItemId);
    const sw = Number(t.sourceWidth) || 1920;
    const sh = Number(t.sourceHeight) || 1080;
    console.log(
        `[CameraService] Source dims for item #${sceneItemId}: ${sw}×${sh}`
    );
    return { sourceWidth: sw, sourceHeight: sh };
}

// ---------------------------------------------------------------------------
// Core: Stretch to Panel (cover — may crop)
// ---------------------------------------------------------------------------

/**
 * stretchToPanel — position a source to FILL a rectangular panel.
 *
 * Equivalent to CSS "object-fit: cover". The source is scaled uniformly
 * so it completely covers the panel, then cropped on the overflowing axis.
 *
 * Algorithm:
 *   scaleX = scaleY = max(panelW / sourceW, panelH / sourceH)
 *   → one axis fits exactly, the other overflows
 *   → crop the overflow evenly on both sides
 */
export async function stretchToPanel(
    sceneName: string,
    sceneItemId: number,
    _video: VideoDimensions,
    panel: PanelRect
): Promise<void> {
    const { sourceWidth, sourceHeight } = await getSourceDimensions(sceneName, sceneItemId);

    // Uniform scale to COVER the panel
    const scale = Math.max(panel.width / sourceWidth, panel.height / sourceHeight);

    // Scaled size (before crop)
    const scaledW = sourceWidth * scale;
    const scaledH = sourceHeight * scale;

    // Overflow to crop (in SOURCE pixels — OBS crop is pre-scale)
    const overflowX = (scaledW - panel.width) / scale;
    const overflowY = (scaledH - panel.height) / scale;

    const cropLeft = Math.round(overflowX / 2);
    const cropRight = Math.round(overflowX / 2);
    const cropTop = Math.round(overflowY / 2);
    const cropBottom = Math.round(overflowY / 2);

    console.log(
        `[CameraService] stretchToPanel item #${sceneItemId} in "${sceneName}"`,
        `\n  panel: x=${panel.x} y=${panel.y} w=${panel.width} h=${panel.height}`,
        `\n  source: ${sourceWidth}×${sourceHeight}  scale: ${scale.toFixed(4)}`,
        `\n  crop: L=${cropLeft} R=${cropRight} T=${cropTop} B=${cropBottom}`
    );

    await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: panel.x,
        positionY: panel.y,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        cropLeft,
        cropRight,
        cropTop,
        cropBottom,
        boundsType: "OBS_BOUNDS_NONE",
    });
}

/**
 * stretchFullCanvas — fill the entire canvas (no crop).
 * Shortcut for stretchToPanel with panel = full canvas.
 */
export async function stretchFullCanvas(
    sceneName: string,
    sceneItemId: number,
    video: VideoDimensions
): Promise<void> {
    await stretchToPanel(sceneName, sceneItemId, video, {
        x: 0,
        y: 0,
        width: video.baseWidth,
        height: video.baseHeight,
    });
}

/**
 * fitInsidePanel — scale a source to FIT INSIDE a panel (no crop, may letterbox).
 * Used for scripture/text sources where cropping is undesirable.
 * Equivalent to CSS "object-fit: contain".
 */
export async function fitInsidePanel(
    sceneName: string,
    sceneItemId: number,
    panel: PanelRect
): Promise<void> {
    const { sourceWidth, sourceHeight } = await getSourceDimensions(sceneName, sceneItemId);

    // Uniform scale to FIT inside the panel
    const scale = Math.min(panel.width / sourceWidth, panel.height / sourceHeight);

    console.log(
        `[CameraService] fitInsidePanel item #${sceneItemId} in "${sceneName}"`,
        `panel: x=${panel.x} y=${panel.y} w=${panel.width} h=${panel.height}`,
        `scale: ${scale.toFixed(4)}`
    );

    await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: panel.x,
        positionY: panel.y,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        cropLeft: 0,
        cropRight: 0,
        cropTop: 0,
        cropBottom: 0,
        boundsType: "OBS_BOUNDS_NONE",
    });
}

/**
 * stretchToFillPanel — stretch a source to fill a panel EXACTLY.
 * May distort if aspect ratios don't match. Used for backgrounds/overlays.
 * Equivalent to CSS "object-fit: fill".
 */
export async function stretchToFillPanel(
    sceneName: string,
    sceneItemId: number,
    panel: PanelRect
): Promise<void> {
    const { sourceWidth, sourceHeight } = await getSourceDimensions(sceneName, sceneItemId);

    const sx = panel.width / sourceWidth;
    const sy = panel.height / sourceHeight;

    console.log(
        `[CameraService] stretchToFillPanel item #${sceneItemId} in "${sceneName}"`,
        `panel: x=${panel.x} y=${panel.y} w=${panel.width} h=${panel.height}`,
        `scaleX: ${sx.toFixed(4)} scaleY: ${sy.toFixed(4)}`
    );

    await obsService.setSceneItemTransform(sceneName, sceneItemId, {
        positionX: panel.x,
        positionY: panel.y,
        scaleX: sx,
        scaleY: sy,
        rotation: 0,
        cropLeft: 0,
        cropRight: 0,
        cropTop: 0,
        cropBottom: 0,
        boundsType: "OBS_BOUNDS_NONE",
    });
}

/**
 * fitCameraInPanel — fit a camera source to COVER a panel (may crop).
 * Alias for stretchToPanel — used by PiP preset for semantic clarity.
 */
export async function fitCameraInPanel(
    sceneName: string,
    sceneItemId: number,
    panel: PanelRect
): Promise<void> {
    // We need a dummy video param for stretchToPanel — panel dimensions are what matter
    await stretchToPanel(sceneName, sceneItemId, { baseWidth: 0, baseHeight: 0 }, panel);
}
