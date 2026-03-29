/**
 * Layout Service — OBS Church Studio
 *
 * Handles auto-detection of camera/scripture sources, programmatic
 * creation of Sunday scenes, configurable split-screen layout, and repair.
 *
 * CAMERA TRANSFORM STRATEGY — "Stretch to Screen, then crop":
 *   1. Scale the source to fill the ENTIRE canvas (like OBS "Stretch to Screen")
 *   2. Crop from the edges to fit the target panel size
 *   This is the exact same thing as manually right-clicking → Stretch to Screen,
 *   then dragging the right edge inward. It works reliably with any source
 *   resolution and avoids the boundsType issues.
 *
 * SCRIPTURE/TEXT: Still uses OBS_BOUNDS_SCALE_INNER (fits inside, no crop).
 * BACKGROUNDS/OVERLAYS: Still uses OBS_BOUNDS_STRETCH (fills, may distort).
 *
 * All transforms use dynamic canvas dimensions from GetVideoSettings.
 * No hardcoded pixel values.
 */

import {
    obsService,
    type OBSInput,
    type VideoSettings,
} from "./obsService";
import {
    stretchToPanel as sharedStretchToPanel,
    fitInsidePanel,
    stretchToFillPanel,
} from "./cameraService";

// ---------------------------------------------------------------------------
// Constants — Scene names used across the app
// ---------------------------------------------------------------------------

export const SUNDAY_SCENES = {
    FULL_PASTOR: "Sunday - Full Pastor",
    SCRIPTURE_VIEW: "Sunday - Scripture View",
    WORSHIP: "Sunday - Worship",
} as const;

export const SUNDAY_SCENE_NAMES = Object.values(SUNDAY_SCENES);

// ---------------------------------------------------------------------------
// Layout Settings — persisted configuration
// ---------------------------------------------------------------------------

export interface LayoutSettings {
    /** Split ratio for Scripture View (0.0 – 1.0). Camera gets this fraction of width. */
    splitRatio: number;
    /** Logo position: top-left or top-right */
    logoPosition: "top-left" | "top-right";
    /** Logo size as fraction of canvas height (0.05 – 0.25) */
    logoSize: number;
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
    splitRatio: 0.5,
    logoPosition: "top-right",
    logoSize: 0.1,
};

// ---------------------------------------------------------------------------
// Source Detection
// ---------------------------------------------------------------------------

/** OBS input kinds that are likely camera/video capture sources */
const CAMERA_KINDS = [
    "av_capture_input",       // macOS AVFoundation camera
    "av_capture_input_v2",    // macOS AVFoundation v2
    "macos-avcapture",        // macOS alias
    "dshow_input",            // Windows DirectShow
    "v4l2_input",             // Linux Video4Linux
    "decklink-input",         // Blackmagic Decklink
    "ndi_source",             // NDI network source
];

/** OBS input kinds that could be scripture/lyrics/presentation */
const SCRIPTURE_KINDS = [
    "browser_source",
    "window_capture",
    "text_ft2_source_v2",
    "text_gdiplus_v3",
    "monitor_capture",
    "display_capture",
    "screen_capture",
    "macos-screen-capture",
];

/** Keywords in input names that suggest scripture/lyrics usage */
const SCRIPTURE_KEYWORDS = [
    "easyworship",
    "propresenter",
    "scripture",
    "bible",
    "lyrics",
    "worship",
    "presentation",
    "slides",
    "text",
    "verse",
];

export function detectCameraSources(inputs: OBSInput[]): OBSInput[] {
    return inputs.filter((input) =>
        CAMERA_KINDS.some((kind) =>
            input.unversionedInputKind.toLowerCase().includes(kind.toLowerCase()) ||
            input.inputKind.toLowerCase().includes(kind.toLowerCase())
        )
    );
}

export function detectScriptureSources(inputs: OBSInput[]): OBSInput[] {
    const byKind = inputs.filter((input) =>
        SCRIPTURE_KINDS.some((kind) =>
            input.unversionedInputKind.toLowerCase().includes(kind.toLowerCase()) ||
            input.inputKind.toLowerCase().includes(kind.toLowerCase())
        )
    );

    const withKeyword = byKind.filter((input) =>
        SCRIPTURE_KEYWORDS.some((kw) =>
            input.inputName.toLowerCase().includes(kw)
        )
    );

    if (withKeyword.length > 0) {
        const rest = byKind.filter((i) => !withKeyword.includes(i));
        return [...withKeyword, ...rest];
    }
    return byKind;
}

// ---------------------------------------------------------------------------
// Scene Existence Check
// ---------------------------------------------------------------------------

export async function sundayScenesExist(): Promise<boolean> {
    const scenes = await obsService.getSceneList();
    const sceneNames = new Set(scenes.map((s) => s.sceneName));
    return SUNDAY_SCENE_NAMES.every((name) => sceneNames.has(name));
}

/**
 * Auto-detect camera and scripture sources from existing OBS inputs.
 * Used on app reload when Sunday scenes already exist but config was lost.
 * Returns a GenerationConfig or null if detection fails.
 */
export async function autoDetectConfig(): Promise<GenerationConfig | null> {
    try {
        console.log("[LayoutService] Auto-detecting config from existing OBS inputs...");
        const inputs = await obsService.getInputList();

        const cameras = detectCameraSources(inputs);
        const scriptures = detectScriptureSources(inputs);

        if (cameras.length === 0) {
            console.warn("[LayoutService] No camera sources detected");
            return null;
        }
        if (scriptures.length === 0) {
            console.warn("[LayoutService] No scripture sources detected");
            return null;
        }

        const config: GenerationConfig = {
            cameraSource: cameras[0].inputName,
            scriptureSource: scriptures[0].inputName,
        };

        console.log("[LayoutService] Auto-detected config:", config);
        return config;
    } catch (err) {
        console.error("[LayoutService] Auto-detect failed:", err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Scene Generation Config
// ---------------------------------------------------------------------------

export interface GenerationConfig {
    cameraSource: string;
    scriptureSource: string;
}

// ---------------------------------------------------------------------------
// Helper: get scene item ID by source name
// ---------------------------------------------------------------------------

async function getItemId(
    sceneName: string,
    sourceName: string
): Promise<number> {
    const response = await obsService.call("GetSceneItemId", {
        sceneName,
        sourceName,
    });
    return response.sceneItemId as number;
}

/**
 * Create a scene if it doesn't already exist.
 * OBS throws error 601 if the scene already exists — we catch that silently.
 */
async function ensureScene(sceneName: string): Promise<void> {
    try {
        await obsService.createScene(sceneName);
        console.log(`[LayoutService] Created scene: "${sceneName}"`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // OBS error 601 = "A scene with that name already exists"
        if (msg.includes("601") || msg.toLowerCase().includes("already exists")) {
            console.log(`[LayoutService] Scene "${sceneName}" already exists — reusing`);
        } else {
            throw err;
        }
    }
}

/**
 * Ensure a source exists as a scene item. If already present, returns its ID.
 * If missing, creates it via createSceneItem and returns the new ID.
 */
async function ensureSceneItem(
    sceneName: string,
    sourceName: string
): Promise<number> {
    try {
        const id = await getItemId(sceneName, sourceName);
        console.log(`[LayoutService] "${sourceName}" already in "${sceneName}" → id ${id}`);
        return id;
    } catch {
        // Not found — create it
        const id = await obsService.createSceneItem(sceneName, sourceName);
        console.log(`[LayoutService] Added "${sourceName}" to "${sceneName}" → id ${id}`);
        return id;
    }
}

// ---------------------------------------------------------------------------
// Scene Generation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Camera Transform Helper — delegates to shared cameraService
// ---------------------------------------------------------------------------

/**
 * Apply "stretch to screen then crop" transform to a camera source.
 * Delegates to the shared cameraService.stretchToPanel.
 *
 * @param sceneName   Scene containing the source
 * @param sceneItemId The scene item ID to transform
 * @param video       Canvas dimensions
 * @param panelX      Left edge of the panel in canvas pixels
 * @param panelWidth  Width of the panel in canvas pixels
 */
async function stretchToPanel(
    sceneName: string,
    sceneItemId: number,
    video: VideoSettings,
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
 * Generate all three Sunday scenes in OBS.
 *
 * Camera strategy: "Stretch to Screen, then crop" — no bounds.
 * Scripture/text: OBS_BOUNDS_SCALE_INNER → fits inside bounds, clean text.
 * Full canvas overlays: OBS_BOUNDS_STRETCH → fills canvas.
 */
export async function generateSundayScenes(
    config: GenerationConfig,
    layout: LayoutSettings = DEFAULT_LAYOUT_SETTINGS
): Promise<void> {
    const { cameraSource, scriptureSource } = config;
    const video = await obsService.getVideoSettings();

    console.log(`[LayoutService] Canvas: ${video.baseWidth}×${video.baseHeight}`);

    // Scene 1: Full Pastor
    await createFullPastorScene(cameraSource, video);

    // Scene 2: Scripture View (split)
    await createScriptureViewScene(cameraSource, scriptureSource, video, layout);

    // Scene 3: Worship
    await createWorshipScene(cameraSource, scriptureSource, video);

    // Switch to first scene
    await obsService.setCurrentProgramScene(SUNDAY_SCENES.FULL_PASTOR);

    console.log("[LayoutService] All Sunday scenes generated successfully");
}

// ---------------------------------------------------------------------------
// Scene 1: Full Pastor
// Camera fills full canvas — stretch to screen, no crop needed.
// ---------------------------------------------------------------------------

async function createFullPastorScene(
    cameraSource: string,
    video: VideoSettings
): Promise<void> {
    const sceneName = SUNDAY_SCENES.FULL_PASTOR;
    await ensureScene(sceneName);

    const itemId = await ensureSceneItem(sceneName, cameraSource);
    await stretchToPanel(sceneName, itemId, video, 0, video.baseWidth);

    console.log(`[LayoutService] Ready: "${sceneName}"`);
}

// ---------------------------------------------------------------------------
// Scene 2: Scripture View (configurable split)
//
// Camera (left): Stretch to screen, crop right edge to panel width
// Scripture (right): OBS_BOUNDS_SCALE_INNER → fits inside, no text cropped
// ---------------------------------------------------------------------------

async function createScriptureViewScene(
    cameraSource: string,
    scriptureSource: string,
    video: VideoSettings,
    layout: LayoutSettings
): Promise<void> {
    const sceneName = SUNDAY_SCENES.SCRIPTURE_VIEW;
    const camWidth = Math.round(video.baseWidth * layout.splitRatio);
    const scriptWidth = video.baseWidth - camWidth;

    await ensureScene(sceneName);

    // Left: camera — stretch to screen, crop to left panel
    const camId = await ensureSceneItem(sceneName, cameraSource);
    await stretchToPanel(sceneName, camId, video, 0, camWidth);

    // Right: scripture — fit inside panel (text must not be cropped)
    const scriptId = await ensureSceneItem(sceneName, scriptureSource);
    await fitInsidePanel(sceneName, scriptId, {
        x: camWidth,
        y: 0,
        width: scriptWidth,
        height: video.baseHeight,
    });

    console.log(
        `[LayoutService] Ready: "${sceneName}" (${Math.round(layout.splitRatio * 100)}/${Math.round((1 - layout.splitRatio) * 100)} split)`
    );
}

// ---------------------------------------------------------------------------
// Scene 3: Worship
// Camera fills canvas (stretch to screen), lyrics overlay on top
// ---------------------------------------------------------------------------

async function createWorshipScene(
    cameraSource: string,
    scriptureSource: string,
    video: VideoSettings
): Promise<void> {
    const sceneName = SUNDAY_SCENES.WORSHIP;
    await ensureScene(sceneName);

    // Bottom layer: camera fills canvas (stretch to screen, no crop)
    const camId = await ensureSceneItem(sceneName, cameraSource);
    await stretchToPanel(sceneName, camId, video, 0, video.baseWidth);

    // Top layer: lyrics (stretched to fill canvas — expected for text overlays)
    const lyricsId = await ensureSceneItem(sceneName, scriptureSource);
    await stretchToFillPanel(sceneName, lyricsId, {
        x: 0,
        y: 0,
        width: video.baseWidth,
        height: video.baseHeight,
    });

    console.log(`[LayoutService] Ready: "${sceneName}"`);
}

// ---------------------------------------------------------------------------
// Apply Scripture View Layout — update transforms on existing scene
//
// Called from Layout Settings page when user changes ratio.
// Uses GetSceneItemId to look up existing items, then re-applies transforms.
// ---------------------------------------------------------------------------

export async function applyScriptureViewLayout(
    config: GenerationConfig,
    layout: LayoutSettings
): Promise<void> {
    const video = await obsService.getVideoSettings();
    const sceneName = SUNDAY_SCENES.SCRIPTURE_VIEW;
    const camWidth = Math.round(video.baseWidth * layout.splitRatio);
    const scriptWidth = video.baseWidth - camWidth;

    // Look up scene item IDs
    const camId = await getItemId(sceneName, config.cameraSource);
    const scriptId = await getItemId(sceneName, config.scriptureSource);

    // Camera (left region) — stretch to screen, crop to panel
    await stretchToPanel(sceneName, camId, video, 0, camWidth);

    // Scripture (right region) — fit inside, no text cropped
    await fitInsidePanel(sceneName, scriptId, {
        x: camWidth,
        y: 0,
        width: scriptWidth,
        height: video.baseHeight,
    });

    console.log(
        `[LayoutService] Applied Scripture View layout: ${Math.round(layout.splitRatio * 100)}/${Math.round((1 - layout.splitRatio) * 100)}`
    );
}

// ---------------------------------------------------------------------------
// Repair — Re-create scenes if missing, re-add sources, re-apply transforms
// ---------------------------------------------------------------------------

export async function repairSundayLayouts(
    config: GenerationConfig,
    layout: LayoutSettings = DEFAULT_LAYOUT_SETTINGS
): Promise<void> {
    console.log("[LayoutService] Repair started", { config, layout });
    const video = await obsService.getVideoSettings();
    console.log(`[LayoutService] Canvas: ${video.baseWidth}×${video.baseHeight}`);

    const camWidth = Math.round(video.baseWidth * layout.splitRatio);
    const scriptWidth = video.baseWidth - camWidth;
    const errors: string[] = [];

    // Helper: enable a scene item via raw OBS call
    const enableItem = async (scene: string, itemId: number) => {
        await obsService.call("SetSceneItemEnabled", {
            sceneName: scene,
            sceneItemId: itemId,
            sceneItemEnabled: true,
        });
    };

    // ── Repair Full Pastor ──
    try {
        await ensureScene(SUNDAY_SCENES.FULL_PASTOR);
        const camId = await ensureSceneItem(SUNDAY_SCENES.FULL_PASTOR, config.cameraSource);
        await enableItem(SUNDAY_SCENES.FULL_PASTOR, camId);
        await stretchToPanel(SUNDAY_SCENES.FULL_PASTOR, camId, video, 0, video.baseWidth);
        console.log("[LayoutService] ✓ Repaired Full Pastor");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[LayoutService] ✗ Repair Full Pastor failed:", msg);
        errors.push(`Full Pastor: ${msg}`);
    }

    // ── Repair Scripture View ──
    try {
        await ensureScene(SUNDAY_SCENES.SCRIPTURE_VIEW);

        const camId = await ensureSceneItem(SUNDAY_SCENES.SCRIPTURE_VIEW, config.cameraSource);
        await enableItem(SUNDAY_SCENES.SCRIPTURE_VIEW, camId);
        await stretchToPanel(SUNDAY_SCENES.SCRIPTURE_VIEW, camId, video, 0, camWidth);

        const scriptId = await ensureSceneItem(SUNDAY_SCENES.SCRIPTURE_VIEW, config.scriptureSource);
        await enableItem(SUNDAY_SCENES.SCRIPTURE_VIEW, scriptId);
        await fitInsidePanel(SUNDAY_SCENES.SCRIPTURE_VIEW, scriptId, {
            x: camWidth,
            y: 0,
            width: scriptWidth,
            height: video.baseHeight,
        });
        console.log("[LayoutService] ✓ Repaired Scripture View");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[LayoutService] ✗ Repair Scripture View failed:", msg);
        errors.push(`Scripture View: ${msg}`);
    }

    // ── Repair Worship ──
    try {
        await ensureScene(SUNDAY_SCENES.WORSHIP);

        const camId = await ensureSceneItem(SUNDAY_SCENES.WORSHIP, config.cameraSource);
        await enableItem(SUNDAY_SCENES.WORSHIP, camId);
        await stretchToPanel(SUNDAY_SCENES.WORSHIP, camId, video, 0, video.baseWidth);

        const lyricsId = await ensureSceneItem(SUNDAY_SCENES.WORSHIP, config.scriptureSource);
        await enableItem(SUNDAY_SCENES.WORSHIP, lyricsId);
        await stretchToFillPanel(SUNDAY_SCENES.WORSHIP, lyricsId, {
            x: 0,
            y: 0,
            width: video.baseWidth,
            height: video.baseHeight,
        });
        console.log("[LayoutService] ✓ Repaired Worship");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[LayoutService] ✗ Repair Worship failed:", msg);
        errors.push(`Worship: ${msg}`);
    }

    if (errors.length > 0) {
        console.error("[LayoutService] Repair finished with errors:", errors);
        throw new Error(errors.join("; "));
    }

    console.log("[LayoutService] ✓ Repair complete — all scenes OK");
}
