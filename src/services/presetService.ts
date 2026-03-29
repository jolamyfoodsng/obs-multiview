/**
 * Preset Service — OBS Church Studio
 *
 * Defines 6 service mode presets that configure OBS scenes with
 * different camera/scripture layouts. Each preset is a pure function
 * that takes a GenerationConfig and applies transforms to OBS.
 *
 * Presets:
 *   1. Full Pastor      — Camera fills entire canvas
 *   2. Scripture View    — Side-by-side camera + scripture (configurable ratio)
 *   3. Worship           — Camera full + lyrics overlay on top
 *   4. Picture-in-Picture — Scripture full, camera small corner inset
 *   5. Fullscreen Scripture — Scripture fills entire canvas, no camera
 *   6. Blank / Emergency — Black screen (no sources visible)
 */

import { obsService, type VideoSettings } from "./obsService";
import { SUNDAY_SCENES } from "./layoutService";
import {
    stretchToPanel,
    stretchFullCanvas,
    fitInsidePanel,
    stretchToFillPanel,
    fitCameraInPanel,
    type PanelRect,
} from "./cameraService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PresetId =
    | "full-pastor"
    | "scripture-view"
    | "worship"
    | "picture-in-picture"
    | "fullscreen-scripture"
    | "blank";

export interface Preset {
    id: PresetId;
    label: string;
    icon: string;
    description: string;
    /** Which existing Sunday scene to switch to, or null for custom */
    targetScene: string | null;
}

export interface PresetOptions {
    /** Split ratio for Scripture View (0.0–1.0, camera fraction) */
    splitRatio: number;
    /** PiP inset size as fraction of canvas (0.15–0.35) */
    pipSize: number;
    /** PiP corner position */
    pipCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

export const DEFAULT_PRESET_OPTIONS: PresetOptions = {
    splitRatio: 0.5,
    pipSize: 0.25,
    pipCorner: "bottom-right",
};

// ---------------------------------------------------------------------------
// Preset Definitions
// ---------------------------------------------------------------------------

export const PRESETS: Preset[] = [
    {
        id: "full-pastor",
        label: "Full Pastor",
        icon: "person",
        description: "Camera fills entire screen",
        targetScene: SUNDAY_SCENES.FULL_PASTOR,
    },
    {
        id: "scripture-view",
        label: "Scripture View",
        icon: "menu_book",
        description: "Camera + Scripture side by side",
        targetScene: SUNDAY_SCENES.SCRIPTURE_VIEW,
    },
    {
        id: "worship",
        label: "Worship",
        icon: "music_note",
        description: "Camera with lyrics overlay",
        targetScene: SUNDAY_SCENES.WORSHIP,
    },
    {
        id: "picture-in-picture",
        label: "Picture in Picture",
        icon: "picture_in_picture",
        description: "Scripture fullscreen, camera in corner",
        targetScene: SUNDAY_SCENES.SCRIPTURE_VIEW,
    },
    {
        id: "fullscreen-scripture",
        label: "Full Scripture",
        icon: "auto_stories",
        description: "Scripture fills entire screen",
        targetScene: SUNDAY_SCENES.SCRIPTURE_VIEW,
    },
    {
        id: "blank",
        label: "Blank Screen",
        icon: "visibility_off",
        description: "Emergency — black screen",
        targetScene: null,
    },
];

// ---------------------------------------------------------------------------
// Scene Name for Blank/Emergency
// ---------------------------------------------------------------------------

const EMERGENCY_SCENE = "Sunday - Emergency Black";

// ---------------------------------------------------------------------------
// Apply Preset
// ---------------------------------------------------------------------------

/**
 * Apply a preset to OBS. This:
 *   1. Applies transforms to the target scene's items
 *   2. Switches the OBS program output to that scene
 *
 * @param presetId       Which preset to apply
 * @param cameraSource   Name of the camera input in OBS
 * @param scriptureSource Name of the scripture input in OBS
 * @param options        Configurable options (split ratio, PiP size, etc.)
 */
export async function applyPreset(
    presetId: PresetId,
    cameraSource: string,
    scriptureSource: string,
    options: PresetOptions = DEFAULT_PRESET_OPTIONS
): Promise<void> {
    const video = await obsService.getVideoSettings();

    switch (presetId) {
        case "full-pastor":
            await applyFullPastor(cameraSource, video);
            await obsService.setCurrentProgramScene(SUNDAY_SCENES.FULL_PASTOR);
            break;

        case "scripture-view":
            await applyScriptureView(cameraSource, scriptureSource, video, options.splitRatio);
            await obsService.setCurrentProgramScene(SUNDAY_SCENES.SCRIPTURE_VIEW);
            break;

        case "worship":
            await applyWorship(cameraSource, scriptureSource, video);
            await obsService.setCurrentProgramScene(SUNDAY_SCENES.WORSHIP);
            break;

        case "picture-in-picture":
            await applyPictureInPicture(cameraSource, scriptureSource, video, options);
            await obsService.setCurrentProgramScene(SUNDAY_SCENES.SCRIPTURE_VIEW);
            break;

        case "fullscreen-scripture":
            await applyFullscreenScripture(cameraSource, scriptureSource, video);
            await obsService.setCurrentProgramScene(SUNDAY_SCENES.SCRIPTURE_VIEW);
            break;

        case "blank":
            await applyBlank(video);
            break;
    }

    console.log(`[PresetService] Applied preset: ${presetId}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-enable a scene item (in case it was disabled by Fullscreen Scripture).
 */
async function ensureItemEnabled(
    sceneName: string,
    sceneItemId: number
): Promise<void> {
    try {
        await obsService.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId,
            sceneItemEnabled: true,
        });
    } catch {
        // Item may not exist — ignore
    }
}

// ---------------------------------------------------------------------------
// Individual Preset Implementations
// ---------------------------------------------------------------------------

/**
 * Full Pastor — Camera fills entire canvas.
 */
async function applyFullPastor(
    cameraSource: string,
    video: VideoSettings
): Promise<void> {
    const scene = SUNDAY_SCENES.FULL_PASTOR;
    const camId = await getItemId(scene, cameraSource);
    if (camId === null) return;

    await stretchFullCanvas(scene, camId, video);
}

/**
 * Scripture View — Side-by-side split.
 * Camera on left (splitRatio), Scripture on right (1 - splitRatio).
 */
async function applyScriptureView(
    cameraSource: string,
    scriptureSource: string,
    video: VideoSettings,
    splitRatio: number
): Promise<void> {
    const scene = SUNDAY_SCENES.SCRIPTURE_VIEW;
    const camId = await getItemId(scene, cameraSource);
    const scriptId = await getItemId(scene, scriptureSource);

    // Re-enable camera in case it was disabled by Fullscreen Scripture
    if (camId !== null) {
        await ensureItemEnabled(scene, camId);
    }

    const camWidth = Math.round(video.baseWidth * splitRatio);
    const scriptWidth = video.baseWidth - camWidth;

    if (camId !== null) {
        await stretchToPanel(scene, camId, video, {
            x: 0, y: 0,
            width: camWidth,
            height: video.baseHeight,
        });
    }

    if (scriptId !== null) {
        await fitInsidePanel(scene, scriptId, {
            x: camWidth, y: 0,
            width: scriptWidth,
            height: video.baseHeight,
        });
    }
}

/**
 * Worship — Camera fills canvas, scripture overlays on top.
 */
async function applyWorship(
    cameraSource: string,
    scriptureSource: string,
    video: VideoSettings
): Promise<void> {
    const scene = SUNDAY_SCENES.WORSHIP;
    const camId = await getItemId(scene, cameraSource);
    const scriptId = await getItemId(scene, scriptureSource);

    if (camId !== null) {
        await stretchFullCanvas(scene, camId, video);
    }

    if (scriptId !== null) {
        // Lyrics overlay — stretch to fill entire canvas
        await stretchToFillPanel(scene, scriptId, {
            x: 0, y: 0,
            width: video.baseWidth,
            height: video.baseHeight,
        });
    }
}

/**
 * Picture-in-Picture — Scripture fills canvas, camera in a small corner inset.
 * Uses the Scripture View scene with modified transforms.
 */
async function applyPictureInPicture(
    cameraSource: string,
    scriptureSource: string,
    video: VideoSettings,
    options: PresetOptions
): Promise<void> {
    const scene = SUNDAY_SCENES.SCRIPTURE_VIEW;
    const camId = await getItemId(scene, cameraSource);
    const scriptId = await getItemId(scene, scriptureSource);

    // Re-enable camera in case it was disabled by Fullscreen Scripture
    if (camId !== null) {
        await ensureItemEnabled(scene, camId);
    }

    // Scripture fills entire canvas
    if (scriptId !== null) {
        await fitInsidePanel(scene, scriptId, {
            x: 0, y: 0,
            width: video.baseWidth,
            height: video.baseHeight,
        });
    }

    // Camera in corner inset — use bounds-based scaling (not stretch+crop)
    // because the PiP panel is much smaller than the canvas
    if (camId !== null) {
        const pipPanel = calculatePipRect(video, options.pipSize, options.pipCorner);
        await fitCameraInPanel(scene, camId, pipPanel);
    }
}

/**
 * Fullscreen Scripture — Scripture fills entire canvas, camera hidden (zero-size).
 */
async function applyFullscreenScripture(
    cameraSource: string,
    scriptureSource: string,
    video: VideoSettings
): Promise<void> {
    const scene = SUNDAY_SCENES.SCRIPTURE_VIEW;
    const camId = await getItemId(scene, cameraSource);
    const scriptId = await getItemId(scene, scriptureSource);

    if (scriptId !== null) {
        await fitInsidePanel(scene, scriptId, {
            x: 0, y: 0,
            width: video.baseWidth,
            height: video.baseHeight,
        });
    }

    // Hide camera by disabling the scene item (OBS rejects extreme scale values)
    if (camId !== null) {
        await obsService.call("SetSceneItemEnabled", {
            sceneName: scene,
            sceneItemId: camId,
            sceneItemEnabled: false,
        });
    }
}

/**
 * Blank / Emergency — switch to a black scene.
 * Creates the emergency scene if it doesn't exist.
 */
async function applyBlank(video: VideoSettings): Promise<void> {
    // Ensure the emergency scene exists
    try {
        await obsService.createScene(EMERGENCY_SCENE);
        console.log(`[PresetService] Created emergency scene: ${EMERGENCY_SCENE}`);

        // Add a black color source
        const itemId = await obsService.createInput(
            EMERGENCY_SCENE,
            "Emergency Black BG",
            "color_source_v3",
            { color: 0xff000000, width: video.baseWidth, height: video.baseHeight }
        );

        // Stretch to fill
        await stretchToFillPanel(EMERGENCY_SCENE, itemId, {
            x: 0, y: 0,
            width: video.baseWidth,
            height: video.baseHeight,
        });
    } catch {
        // Scene already exists — that's fine
    }

    await obsService.setCurrentProgramScene(EMERGENCY_SCENE);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the sceneItemId for a source in a scene.
 * Returns null (with warning) if not found — does NOT throw.
 */
async function getItemId(
    sceneName: string,
    sourceName: string
): Promise<number | null> {
    try {
        const resp = await obsService.call("GetSceneItemId", {
            sceneName,
            sourceName,
        });
        return (resp as Record<string, unknown>).sceneItemId as number;
    } catch (err) {
        console.warn(
            `[PresetService] Source "${sourceName}" not found in "${sceneName}":`,
            err
        );
        return null;
    }
}

/**
 * Calculate the PiP inset rectangle for a given corner.
 */
function calculatePipRect(
    video: VideoSettings,
    sizeFraction: number,
    corner: PresetOptions["pipCorner"]
): PanelRect {
    const padding = 20; // px from edge
    const pipW = Math.round(video.baseWidth * sizeFraction);
    const pipH = Math.round(video.baseHeight * sizeFraction);

    let x: number, y: number;

    switch (corner) {
        case "top-left":
            x = padding;
            y = padding;
            break;
        case "top-right":
            x = video.baseWidth - pipW - padding;
            y = padding;
            break;
        case "bottom-left":
            x = padding;
            y = video.baseHeight - pipH - padding;
            break;
        case "bottom-right":
        default:
            x = video.baseWidth - pipW - padding;
            y = video.baseHeight - pipH - padding;
            break;
    }

    return { x, y, width: pipW, height: pipH };
}
