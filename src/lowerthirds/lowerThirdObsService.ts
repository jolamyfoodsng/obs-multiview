/**
 * lowerThirdObsService.ts — OBS integration for Lower Third overlays
 *
 * Manages browser sources in OBS that display lower-third themes.
 * Supports:
 *   - Pushing theme + variable values to OCS-managed LT sources
 *   - Discovering all LT sources in OBS (OCS-managed + MV-created)
 *   - Sending to all LT sources at once
 *   - Sending to a specific LT source
 *   - Blanking / clearing all LT sources
 */

import { obsService } from "../services/obsService";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import {
  registerScene,
  registerInput,
  registerSceneItem,
  getSceneBySlot,
} from "../services/obsRegistry";
import type { LowerThirdTheme, LTObsSource, LTSize, LTCustomStyle, LTFontSize, LTPosition, LTAnimationIn, LTExitStyle } from "./types";
import { LT_DEFAULT_CUSTOM_STYLE, LT_SOURCE_PREFIX, LT_SCENE_NAME, OCS_LT_PATTERN, MV_LT_PATTERN, OCS_BIBLE_LT_PATTERN, LT_SIZE_SCALE, LT_SIZE_WIDTH, LT_SIZE_FONT_SCALE, LT_FONT_SIZE_SCALE, LT_EXIT_STYLE_CSS } from "./types";
import { getLTThemeById } from "./themes";
import { getSettings } from "../multiview/mvStore";
import { applyRuntimeBranding } from "./runtimeBranding";

// Registry slot names
const SLOT_SCENE = "lt-overlay";
const SLOT_INPUT = "lt-browser-source";
const TICKER_SOURCE_NAME = "⚡ OCS Ticker Overlay";
const TICKER_CLEARANCE_FALLBACK_PX = 74;
const TICKER_CLEARANCE_GAP_PX = 10;
const TICKER_CLEARANCE_MAX_PX = 220;

async function moveSceneItemToTop(sceneName: string, sceneItemId: number): Promise<void> {
  try {
    const resp = await obsService.call("GetSceneItemList", { sceneName }) as {
      sceneItems: Array<{ sceneItemId: number; sceneItemIndex: number }>;
    };
    const topIndex = Math.max(0, resp.sceneItems.length - 1);
    const item = resp.sceneItems.find((entry) => entry.sceneItemId === sceneItemId);
    if (item && item.sceneItemIndex !== topIndex) {
      await obsService.call("SetSceneItemIndex", {
        sceneName,
        sceneItemId,
        sceneItemIndex: topIndex,
      });
    }
  } catch { /* ok */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build overlay URL with data payload
// ─────────────────────────────────────────────────────────────────────────────


export function buildOverlayUrl(
  theme: LowerThirdTheme,
  values: Record<string, string>,
  live: boolean,
  blanked: boolean,
  size: LTSize = "xl",
  customStyles?: LTCustomStyle,
  fontSize?: LTFontSize,
  position?: LTPosition,
  customX?: number,
  customY?: number,
  animationIn?: LTAnimationIn,
  exitStyle?: LTExitStyle,
): string {
  const runtimeBranding = applyRuntimeBranding(theme, values, getSettings());
  const runtimeTheme = runtimeBranding.theme;
  const runtimeValues = runtimeBranding.values;
  const baseUrl = `${getOverlayBaseUrlSync()}/lower-third-overlay.html`;
  const scale = LT_SIZE_SCALE[size] ?? 1;
  const widthPct = LT_SIZE_WIDTH[size] ?? 65;
  const fontScale = LT_SIZE_FONT_SCALE[size] ?? 1;
  const fontSizeScale = fontSize ? (LT_FONT_SIZE_SCALE[fontSize] ?? 1) : 1;
  const payload: Record<string, unknown> = {
    themeId: runtimeTheme.id,
    html: runtimeTheme.html,
    css: runtimeTheme.css,
    values: runtimeValues,
    live,
    blanked,
    size,
    scale,
    widthPct,
    fontScale,
    fontSizeScale,
    position: position || "bottom-left",
    customX: customX ?? 2.5,
    customY: customY ?? 92,
    animationIn: animationIn || "slide-left",
    exitStyle: exitStyle ? LT_EXIT_STYLE_CSS[exitStyle] : undefined,
    timestamp: Date.now(),
  };
  // Include dynamic font imports (e.g. Font Awesome, Montserrat for social loops)
  if (runtimeTheme.fontImports && runtimeTheme.fontImports.length > 0) {
    payload.fontImports = runtimeTheme.fontImports;
  }
  // Include custom style overrides if any are set
  let hasAccentOverride = false;
  if (customStyles) {
    if (customStyles.bgColor) payload.bgColor = customStyles.bgColor;
    if (customStyles.textColor) payload.textColor = customStyles.textColor;
    if (customStyles.accentColor) {
      payload.accentColor = customStyles.accentColor;
      hasAccentOverride = true;
    }
    if (customStyles.bgImage) {
      payload.bgImage = customStyles.bgImage;
      payload.bgImageOpacity = customStyles.bgImageOpacity ?? 0.3;
    }
    if (customStyles.heightPx && customStyles.heightPx > 0) {
      payload.heightPx = customStyles.heightPx;
    }
    if (customStyles.logoScale && customStyles.logoScale > 0) {
      payload.logoScale = customStyles.logoScale;
    }
  }
  if (!hasAccentOverride) {
    payload.accentColor = runtimeBranding.brandColor;
  }
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `${baseUrl}#data=${encoded}`;
}

function buildOverlayUrlFromPayload(payload: Record<string, unknown>): string {
  const baseUrl = `${getOverlayBaseUrlSync()}/lower-third-overlay.html`;
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `${baseUrl}#data=${encoded}`;
}

function parseOverlayPayloadFromUrl(url: string): Record<string, unknown> | null {
  try {
    const marker = "#data=";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const encoded = url.slice(idx + marker.length);
    if (!encoded) return null;
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LowerThirdObsService — singleton
// ═══════════════════════════════════════════════════════════════════════════

class LowerThirdObsService {
  private _currentThemeId: string | null = null;
  private _currentValues: Record<string, string> = {};
  private _currentSize: LTSize = "xl";
  private _currentCustomStyles: LTCustomStyle = { ...LT_DEFAULT_CUSTOM_STYLE };
  private _isLive = false;
  private _isBlanked = false;
  private _ltBasePosYBySceneItem = new Map<string, number>();

  private isLowerThirdSourceName(sourceName: string): boolean {
    return OCS_LT_PATTERN.test(sourceName) || MV_LT_PATTERN.test(sourceName) || OCS_BIBLE_LT_PATTERN.test(sourceName) || sourceName.startsWith("OCS LT:");
  }

  private sceneItemKey(sceneName: string, sceneItemId: number): string {
    return `${sceneName}::${sceneItemId}`;
  }

  private async getTickerClearancePx(
    sceneName: string,
    sceneItems: Array<{ sceneItemId: number; sourceName: string; inputKind: string }>,
  ): Promise<number> {
    const tickerItem = sceneItems.find((item) => item.sourceName === TICKER_SOURCE_NAME);
    if (!tickerItem) return 0;

    let tickerHeight = TICKER_CLEARANCE_FALLBACK_PX;
    let tickerY: number | null = null;
    try {
      const transform = await obsService.getSceneItemTransform(sceneName, tickerItem.sceneItemId);
      const boundsHeight = Number(transform.boundsHeight);
      const sourceHeight = Number(transform.sourceHeight);
      const scaleY = Number(transform.scaleY);
      const positionY = Number(transform.positionY);
      if (Number.isFinite(positionY)) {
        tickerY = positionY;
      }
      if (Number.isFinite(boundsHeight) && boundsHeight > 0) {
        tickerHeight = boundsHeight;
      } else if (Number.isFinite(sourceHeight) && sourceHeight > 0) {
        tickerHeight = sourceHeight * (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
      }
    } catch {
      // Fall back to known ticker height.
    }

    // Only offset lower-thirds when ticker is bottom-positioned.
    // Top ticker (positionY ~ 0) does not overlap lower-thirds.
    if (tickerY !== null && tickerY <= 4) return 0;

    return Math.max(0, Math.min(TICKER_CLEARANCE_MAX_PX, Math.round(tickerHeight + TICKER_CLEARANCE_GAP_PX)));
  }

  /**
   * If ticker is present in this scene, move LT sources up and keep them above ticker.
   * If ticker is absent, restore LT sources to their base vertical position.
   */
  async syncTickerClearanceForScene(sceneName: string): Promise<void> {
    if (!obsService.isConnected) return;

    let sceneItems: Array<{ sceneItemId: number; sourceName: string; inputKind: string }> = [];
    try {
      sceneItems = await obsService.getSceneItemList(sceneName);
    } catch {
      return;
    }

    const ltItems = sceneItems.filter((item) => this.isLowerThirdSourceName(item.sourceName));
    if (ltItems.length === 0) return;
    const liveKeys = new Set(ltItems.map((item) => this.sceneItemKey(sceneName, item.sceneItemId)));
    for (const key of this._ltBasePosYBySceneItem.keys()) {
      if (key.startsWith(`${sceneName}::`) && !liveKeys.has(key)) {
        this._ltBasePosYBySceneItem.delete(key);
      }
    }

    const clearancePx = await this.getTickerClearancePx(sceneName, sceneItems);
    const tickerOffsetY = clearancePx > 0 ? -clearancePx : 0;

    for (const item of ltItems) {
      const key = this.sceneItemKey(sceneName, item.sceneItemId);
      let currentY = 0;
      try {
        const transform = await obsService.getSceneItemTransform(sceneName, item.sceneItemId);
        const posY = Number(transform.positionY);
        if (Number.isFinite(posY)) currentY = posY;
      } catch {
        // Keep fallback.
      }

      if (!this._ltBasePosYBySceneItem.has(key)) {
        let inferredBase = currentY;
        if (clearancePx > 0 && Math.abs(currentY - tickerOffsetY) <= 2) {
          // Already offset; infer original base.
          inferredBase = currentY - tickerOffsetY;
        } else if (clearancePx === 0 && currentY < -10) {
          // Likely stale ticker offset from previous runtime.
          inferredBase = 0;
        }
        this._ltBasePosYBySceneItem.set(key, inferredBase);
      }

      const baseY = this._ltBasePosYBySceneItem.get(key) ?? 0;
      const targetY = baseY + tickerOffsetY;
      if (Math.abs(currentY - targetY) > 0.5) {
        try {
          await obsService.setSceneItemTransform(sceneName, item.sceneItemId, { positionY: targetY });
        } catch {
          // Best-effort.
        }
      }

      if (clearancePx > 0) {
        try {
          // Keep lower thirds above ticker for clean stacking.
          await obsService.setSceneItemIndex(sceneName, item.sceneItemId, sceneItems.length - 1);
        } catch {
          // Best-effort.
        }
      }
    }
  }

  /** Returns the current live state */
  getLiveState() {
    return {
      themeId: this._currentThemeId,
      values: this._currentValues,
      size: this._currentSize,
      customStyles: this._currentCustomStyles,
      isLive: this._isLive,
      isBlanked: this._isBlanked,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ensure OBS scene + source exist
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensure the dedicated LT scene exists in OBS.
   * Creates it if needed, returns the scene name.
   */
  async ensureScene(): Promise<string> {
    if (!obsService.isConnected) throw new Error("OBS not connected");

    // Check registry first
    const registered = await getSceneBySlot(SLOT_SCENE);
    if (registered) {
      // Verify it still exists in OBS
      try {
        const scenes = await obsService.getSceneList();
        if (scenes.some((s) => s.sceneName === registered.sceneName)) {
          return registered.sceneName;
        }
      } catch { /* */ }
    }

    // Check if scene already exists
    const scenes = await obsService.getSceneList();
    const existing = scenes.find((s) => s.sceneName === LT_SCENE_NAME);
    if (existing) {
      await registerScene(SLOT_SCENE, existing.sceneUuid, LT_SCENE_NAME);
      return LT_SCENE_NAME;
    }

    // Create it
    const resp = await obsService.call("CreateScene", { sceneName: LT_SCENE_NAME }) as {
      sceneUuid: string;
    };
    await registerScene(SLOT_SCENE, resp.sceneUuid, LT_SCENE_NAME);
    console.log(`[LT-OBS] Created scene "${LT_SCENE_NAME}"`);
    return LT_SCENE_NAME;
  }

  /**
   * Ensure a dedicated OCS LT scene exists with a browser source inside.
   * The scene is named "OCS LT: <sourceName>" and contains one browser_source.
   * Returns the scene name and the browser source name.
   */
  async ensureSource(sourceName?: string): Promise<{ sceneName: string; sourceName: string }> {
    const ltSceneName = await this.ensureScene();
    const name = sourceName || `${LT_SOURCE_PREFIX}Main`;
    const ltOverlayScene = `OCS LT: ${name}`;

    // Check if the overlay scene already exists
    const scenes = await obsService.getSceneList();
    const overlayExists = scenes.some((s) => s.sceneName === ltOverlayScene);

    if (!overlayExists) {
      // Create the overlay scene
      await obsService.call("CreateScene", { sceneName: ltOverlayScene });
      console.log(`[LT-OBS] Created overlay scene "${ltOverlayScene}"`);
    }

    // Check if browser source already exists inside the overlay scene
    let hasBrowserSource = false;
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: ltOverlayScene }) as {
        sceneItems: { sourceName: string; sceneItemId: number }[];
      };
      hasBrowserSource = resp.sceneItems.some((si) => si.sourceName === name);
    } catch { /* scene might be empty */ }

    if (!hasBrowserSource) {
      // Check if the input already exists globally
      const inputs = await obsService.getInputList();
      const existing = inputs.find((i) => i.inputName === name);

      if (existing) {
        // Add existing input to the overlay scene
        try {
          const itemId = await obsService.createSceneItem(ltOverlayScene, name);
          // Stretch to fill
          await obsService.setSceneItemTransform(ltOverlayScene, itemId, {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: 1920, boundsHeight: 1080,
            boundsAlignment: 0, rotation: 0,
          });
          await moveSceneItemToTop(ltOverlayScene, itemId);
        } catch { /* might already be in scene */ }
      } else {
        // Create browser source inside the overlay scene
        const overlayUrl = `${getOverlayBaseUrlSync()}/lower-third-overlay.html`;
        const resp = await obsService.call("CreateInput", {
          sceneName: ltOverlayScene,
          inputName: name,
          inputKind: "browser_source",
          inputSettings: {
            url: overlayUrl,
            width: 1920,
            height: 1080,
            css: "",
            fps_custom: true,
            fps: 60,
            reroute_audio: false,
            shutdown: false,
          },
        }) as { sceneItemId: number; inputUuid: string };

        // Stretch to fill
        try {
          await obsService.setSceneItemTransform(ltOverlayScene, resp.sceneItemId, {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: 1920, boundsHeight: 1080,
            boundsAlignment: 0, rotation: 0,
          });
          await moveSceneItemToTop(ltOverlayScene, resp.sceneItemId);
        } catch { /* ok */ }

        await registerInput(SLOT_INPUT, resp.inputUuid, name, "browser_source");
        await registerSceneItem(`${SLOT_SCENE}:${SLOT_INPUT}`, SLOT_SCENE, SLOT_INPUT, resp.sceneItemId, "");
        console.log(`[LT-OBS] Created source "${name}" in overlay scene "${ltOverlayScene}"`);
      }
    }

    // Now nest the overlay scene into the main LT scene
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: ltSceneName }) as {
        sceneItems: { sourceName: string; sceneItemId: number }[];
      };
      const alreadyNested = resp.sceneItems.some((si) => si.sourceName === ltOverlayScene);
      if (!alreadyNested) {
        const nestedItemId = await obsService.createSceneItem(ltSceneName, ltOverlayScene);
        // Stretch to fill
        await obsService.setSceneItemTransform(ltSceneName, nestedItemId, {
          positionX: 0, positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: 1920, boundsHeight: 1080,
          boundsAlignment: 0, rotation: 0,
        });
        await moveSceneItemToTop(ltSceneName, nestedItemId);
        console.log(`[LT-OBS] Nested overlay scene "${ltOverlayScene}" into "${ltSceneName}"`);
      }
    } catch { /* might already exist */ }

    return { sceneName: ltSceneName, sourceName: name };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Discover real OBS scenes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all real OBS scenes — used to let the user pick which scene
   * should receive the lower-third overlay browser source.
   */
  async discoverScenes(): Promise<{ sceneName: string; sceneIndex: number; sceneUuid?: string }[]> {
    if (!obsService.isConnected) return [];
    try {
      return await obsService.getSceneList();
    } catch (err) {
      console.warn("[LT-OBS] Failed to discover scenes:", err);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Discover LT sources
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scan OBS for all lower-third browser sources.
   * Returns both OCS-managed (OCS_LT_*) and MV-created (MV_*_LT:*) sources.
   */
  async discoverSources(): Promise<LTObsSource[]> {
    if (!obsService.isConnected) return [];

    try {
      const inputs = await obsService.getInputList();
      const ltSources: LTObsSource[] = [];

      for (const input of inputs) {
        if (input.inputKind !== "browser_source") continue;

        const isOcs = OCS_LT_PATTERN.test(input.inputName);
        const isMv = MV_LT_PATTERN.test(input.inputName);
        const isBibleLt = OCS_BIBLE_LT_PATTERN.test(input.inputName);

        if (isOcs || isMv || isBibleLt) {
          // Try to get current theme ID from the URL hash
          let themeId: string | undefined;
          try {
            const resp = await obsService.call("GetInputSettings", {
              inputName: input.inputName,
            }) as { inputSettings: { url?: string } };
            const url = resp.inputSettings.url || "";
            if (url.includes("#data=")) {
              const encoded = url.split("#data=")[1];
              const parsed = JSON.parse(decodeURIComponent(encoded));
              themeId = parsed.themeId;
            }
          } catch { /* */ }

          ltSources.push({
            inputName: input.inputName,
            inputKind: input.inputKind,
            isOcsManaged: isOcs || isBibleLt,
            themeId,
          });
        }
      }

      return ltSources;
    } catch (err) {
      console.warn("[LT-OBS] Failed to discover sources:", err);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Push content to sources
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensure a lower-third overlay exists for a specific target scene.
   * Creates a dedicated "OCS LT: <sourceName>" scene with a browser source inside,
   * then nests that scene into the target scene.
   */
  async ensureSourceInScene(targetScene: string): Promise<string> {
    if (!obsService.isConnected) throw new Error("OBS not connected");

    // Build a safe source name from the target scene
    const safeName = targetScene.replace(/[^a-zA-Z0-9_\- ]/g, "");
    const sourceName = `${LT_SOURCE_PREFIX}${safeName}`;
    const ltOverlayScene = `OCS LT: ${sourceName}`;

    // 1. Ensure the overlay scene exists
    const scenes = await obsService.getSceneList();
    const overlayExists = scenes.some((s) => s.sceneName === ltOverlayScene);

    if (!overlayExists) {
      await obsService.call("CreateScene", { sceneName: ltOverlayScene });
      console.log(`[LT-OBS] Created overlay scene "${ltOverlayScene}"`);
    }

    // 2. Ensure browser source exists inside the overlay scene
    let hasBrowserSource = false;
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: ltOverlayScene }) as {
        sceneItems: { sourceName: string; sceneItemId: number }[];
      };
      hasBrowserSource = resp.sceneItems.some((si) => si.sourceName === sourceName);
    } catch { /* scene might be empty */ }

    if (!hasBrowserSource) {
      const inputs = await obsService.getInputList();
      const existing = inputs.find((i) => i.inputName === sourceName);

      if (existing) {
        // Add existing input into the overlay scene
        try {
          const itemId = await obsService.createSceneItem(ltOverlayScene, sourceName);
          await obsService.setSceneItemTransform(ltOverlayScene, itemId, {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: 1920, boundsHeight: 1080,
            boundsAlignment: 0, rotation: 0,
          });
          await moveSceneItemToTop(ltOverlayScene, itemId);
        } catch { /* might already be in scene */ }
      } else {
        // Create new browser source inside the overlay scene
        const overlayUrl = `${getOverlayBaseUrlSync()}/lower-third-overlay.html`;
        const resp = await obsService.call("CreateInput", {
          sceneName: ltOverlayScene,
          inputName: sourceName,
          inputKind: "browser_source",
          inputSettings: {
            url: overlayUrl,
            width: 1920,
            height: 1080,
            css: "",
            fps_custom: true,
            fps: 60,
            reroute_audio: false,
            shutdown: false,
          },
        }) as { sceneItemId: number; inputUuid: string };

        // Stretch to fill
        try {
          await obsService.setSceneItemTransform(ltOverlayScene, resp.sceneItemId, {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: 1920, boundsHeight: 1080,
            boundsAlignment: 0, rotation: 0,
          });
          await moveSceneItemToTop(ltOverlayScene, resp.sceneItemId);
        } catch { /* ok */ }

        console.log(`[LT-OBS] Created source "${sourceName}" in overlay scene "${ltOverlayScene}"`);
      }
    }

    // 3. Nest the overlay scene into the target scene
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: targetScene }) as {
        sceneItems: { sourceName: string; sceneItemId: number }[];
      };
      const alreadyNested = resp.sceneItems.some((si) => si.sourceName === ltOverlayScene);
      if (!alreadyNested) {
        const nestedItemId = await obsService.createSceneItem(targetScene, ltOverlayScene);
        await obsService.setSceneItemTransform(targetScene, nestedItemId, {
          positionX: 0, positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: 1920, boundsHeight: 1080,
          boundsAlignment: 0, rotation: 0,
        });
        await moveSceneItemToTop(targetScene, nestedItemId);
        console.log(`[LT-OBS] Nested overlay scene "${ltOverlayScene}" into "${targetScene}"`);
      }
    } catch { /* might already exist */ }

    return sourceName;
  }

  /**
   * Hide any existing LT overlay scenes / browser sources in a scene
   * that are NOT the one we're about to push to.
   * Prevents multiple lower-thirds stacking.
   */
  async hideExistingLTSourcesInScene(targetScene: string, keepSourceName: string): Promise<void> {
    if (!obsService.isConnected) return;
    const keepOverlayScene = `OCS LT: ${keepSourceName}`;
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: targetScene }) as {
        sceneItems: { sourceName: string; sceneItemId: number; sceneItemEnabled: boolean }[];
      };
      for (const item of resp.sceneItems) {
        // Skip the overlay scene we're about to push to
        if (item.sourceName === keepOverlayScene) continue;
        // Skip the direct source name as well (legacy compat)
        if (item.sourceName === keepSourceName) continue;
        // Hide any OCS LT overlay scenes, OCS_LT_, OCS_BibleLT_, or MV_*_LT: sources
        const isOcsLtOverlay = item.sourceName.startsWith("OCS LT:");
        if (isOcsLtOverlay || OCS_LT_PATTERN.test(item.sourceName) || MV_LT_PATTERN.test(item.sourceName) || OCS_BIBLE_LT_PATTERN.test(item.sourceName)) {
          try {
            await obsService.call("SetSceneItemEnabled", {
              sceneName: targetScene,
              sceneItemId: item.sceneItemId,
              sceneItemEnabled: false,
            });
            console.log(`[LT-OBS] Hidden existing LT source "${item.sourceName}" in "${targetScene}"`);
          } catch { /* item may have been removed */ }
        }
      }
    } catch (err) {
      console.warn(`[LT-OBS] Failed to hide existing LT sources in "${targetScene}":`, err);
    }
  }

  /**
   * Push theme + values to a specific OBS scene.
   * Creates a browser source in that scene if needed, then updates its URL.
   * Hides any other LT sources in that scene first.
   */
  async pushToScene(
    targetScene: string,
    theme: LowerThirdTheme,
    values: Record<string, string>,
    live = true,
    blanked = false,
    size: LTSize = "xl",
    customStyles?: LTCustomStyle,
    fontSize?: LTFontSize,
    position?: LTPosition,
    customX?: number,
    customY?: number,
    animationIn?: LTAnimationIn,
    exitStyle?: LTExitStyle,
  ): Promise<string> {
    const sourceName = await this.ensureSourceInScene(targetScene);

    // Hide other LT sources in this scene before showing ours
    await this.hideExistingLTSourcesInScene(targetScene, sourceName);

    // Make sure our overlay scene is enabled in the target scene
    const ltOverlayScene = `OCS LT: ${sourceName}`;
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: targetScene }) as {
        sceneItems: { sourceName: string; sceneItemId: number }[];
      };
      const ourItem = resp.sceneItems.find((si) => si.sourceName === ltOverlayScene);
      if (ourItem) {
        await obsService.call("SetSceneItemEnabled", {
          sceneName: targetScene,
          sceneItemId: ourItem.sceneItemId,
          sceneItemEnabled: true,
        });
      }
    } catch { /* best effort */ }

    await this.pushToSource(sourceName, theme, values, live, blanked, size, customStyles, fontSize, position, customX, customY, animationIn, exitStyle);
    await this.syncTickerClearanceForScene(targetScene);

    // Update internal state
    this._currentThemeId = theme.id;
    this._currentValues = values;
    this._currentSize = size;
    this._currentCustomStyles = { ...LT_DEFAULT_CUSTOM_STYLE, ...(customStyles || {}) };
    this._isLive = live;
    this._isBlanked = blanked;

    return sourceName;
  }

  /**
   * Push theme + values to a specific OBS source.
   */
  async pushToSource(
    sourceName: string,
    theme: LowerThirdTheme,
    values: Record<string, string>,
    live = true,
    blanked = false,
    size: LTSize = "xl",
    customStyles?: LTCustomStyle,
    fontSize?: LTFontSize,
    position?: LTPosition,
    customX?: number,
    customY?: number,
    animationIn?: LTAnimationIn,
    exitStyle?: LTExitStyle,
  ): Promise<void> {
    if (!obsService.isConnected) throw new Error("OBS not connected");

    const url = buildOverlayUrl(theme, values, live, blanked, size, customStyles, fontSize, position, customX, customY, animationIn, exitStyle);

    // Push URL + ensure correct resolution to prevent blurriness.
    // Match the OBS canvas (1920×1080) so no rescaling artifacts occur.
    await obsService.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings: {
        url,
        width: 1920,
        height: 1080,
        fps_custom: true,
        fps: 60,
      },
    });

    console.log(`[LT-OBS] Pushed "${theme.name}" to "${sourceName}"`);
  }

  /**
   * Push theme + values to all discovered LT sources.
   */
  async pushToAll(
    theme: LowerThirdTheme,
    values: Record<string, string>,
    live = true,
    blanked = false,
    size: LTSize = "xl",
    customStyles?: LTCustomStyle,
    fontSize?: LTFontSize,
    position?: LTPosition,
    customX?: number,
    customY?: number,
    animationIn?: LTAnimationIn,
    exitStyle?: LTExitStyle,
  ): Promise<{ success: string[]; failed: string[] }> {
    const sources = await this.discoverSources();
    const success: string[] = [];
    const failed: string[] = [];

    // If no OCS sources found, log a warning instead of auto-creating OCS_LT_Main.
    // The user should send to a specific scene instead.
    if (sources.length === 0) {
      console.warn("[LT-OBS] No LT sources found. Use 'Send to Scene' to target a specific OBS scene.");
    }

    for (const source of sources) {
      try {
        await this.pushToSource(source.inputName, theme, values, live, blanked, size, customStyles, fontSize, position, customX, customY, animationIn, exitStyle);
        success.push(source.inputName);
      } catch (err) {
        console.warn(`[LT-OBS] Failed to push to "${source.inputName}":`, err);
        failed.push(source.inputName);
      }
    }

    try {
      const scenes = await this.discoverScenes();
      for (const scene of scenes) {
        await this.syncTickerClearanceForScene(scene.sceneName);
      }
    } catch {
      // Best-effort.
    }

    // Update internal state
    this._currentThemeId = theme.id;
    this._currentValues = values;
    this._currentSize = size;
    this._currentCustomStyles = { ...LT_DEFAULT_CUSTOM_STYLE, ...(customStyles || {}) };
    this._isLive = live;
    this._isBlanked = blanked;

    return { success, failed };
  }

  /**
   * Send theme + values to a specific source (by name).
   *
   * If the source doesn't exist, it creates it.
   */
  async sendToSpecific(
    sourceName: string,
    theme: LowerThirdTheme,
    values: Record<string, string>,
    size: LTSize = "xl",
    customStyles?: LTCustomStyle,
    fontSize?: LTFontSize,
    position?: LTPosition,
    customX?: number,
    customY?: number,
    animationIn?: LTAnimationIn,
    exitStyle?: LTExitStyle,
  ): Promise<void> {
    // Ensure the source exists
    await this.ensureSource(sourceName);
    await this.pushToSource(sourceName, theme, values, true, false, size, customStyles, fontSize, position, customX, customY, animationIn, exitStyle);

    this._currentThemeId = theme.id;
    this._currentValues = values;
    this._currentSize = size;
    this._currentCustomStyles = { ...LT_DEFAULT_CUSTOM_STYLE, ...(customStyles || {}) };
    this._isLive = true;
    this._isBlanked = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Blanking / clearing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Blank all LT sources (hide the overlay without removing the source).
   */
  async blankAll(): Promise<void> {
    if (!this._currentThemeId) return;
    const theme = getLTThemeById(this._currentThemeId);
    if (!theme) return;

    await this.pushToAll(theme, this._currentValues, false, true, this._currentSize, this._currentCustomStyles);
    this._isLive = false;
    this._isBlanked = true;
  }

  /**
   * Clear all LT sources (remove content entirely).
   */
  async clearAll(): Promise<void> {
    const sources = await this.discoverSources();
    const blankUrl = `${getOverlayBaseUrlSync()}/lower-third-overlay.html`;

    for (const source of sources) {
      try {
        let nextUrl = blankUrl;

        // Prefer animated clear by reusing the source's current payload,
        // then marking it as not live/blanked.
        try {
          const current = await obsService.call("GetInputSettings", {
            inputName: source.inputName,
          }) as { inputSettings?: { url?: string } };
          const currentUrl = current.inputSettings?.url ?? "";
          const payload = parseOverlayPayloadFromUrl(currentUrl);
          if (payload && typeof payload.themeId === "string" && typeof payload.html === "string") {
            nextUrl = buildOverlayUrlFromPayload({
              ...payload,
              live: false,
              blanked: true,
              timestamp: Date.now(),
            });
          }
        } catch {
          // Fall back to blank URL if we can't inspect current source settings.
        }

        await obsService.call("SetInputSettings", {
          inputName: source.inputName,
          inputSettings: {
            url: nextUrl,
            width: 1920,
            height: 1080,
          },
        });
      } catch (err) {
        console.warn(`[LT-OBS] Failed to clear "${source.inputName}":`, err);
      }
    }

    this._currentThemeId = null;
    this._currentValues = {};
    this._currentSize = "xl";
    this._isLive = false;
    this._isBlanked = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const lowerThirdObsService = new LowerThirdObsService();
