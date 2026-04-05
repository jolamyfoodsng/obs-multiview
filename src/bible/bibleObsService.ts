/**
 * bibleObsService.ts — OBS integration for Bible overlays
 *
 * Creates and manages a Browser Source in OBS that loads our overlay HTML.
 * Uses the existing obsService singleton.
 */

import { obsService } from "../services/obsService";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import {
  registerScene,
  registerInput,
  registerSceneItem,
  getSceneBySlot,
  getInputBySlot,
} from "../services/obsRegistry";
import { overlayBroadcaster } from "./overlayServer";
import { invoke } from "@tauri-apps/api/core";
import type { BibleThemeSettings, BibleSlide, BibleTemplateType } from "./types";

const BIBLE_SOURCE_NAME = "OBS Church Studio — Bible";
const BIBLE_BG_SOURCE_NAME = "OBS Church Studio — Bible BG";
const BIBLE_SCENE_NAME = "OCS Bible Overlay";

// Registry slot names
const SLOT_SCENE = "bible-overlay";
const SLOT_INPUT = "bible-browser-source";
const SLOT_BG_INPUT = "bible-bg-source";
const SLOT_ITEM = `${SLOT_SCENE}:${SLOT_INPUT}`;
const SLOT_BG_ITEM = `${SLOT_SCENE}:${SLOT_BG_INPUT}`;
const FULLSCREEN_CLEAR_WAIT_MS = 240;

class BibleObsService {
  private sceneItemId: number | null = null;
  private bgSceneItemId: number | null = null;
  private currentSceneName: string | null = null;
  private currentTemplateType: BibleTemplateType = "fullscreen";
  /** Mutex: only one ensureBrowserSource call at a time */
  private ensurePromise: Promise<{ sceneName: string; sceneItemId: number }> | null = null;

  // ── Persistent live state — survives React component unmounts ──
  // Tracked here (singleton) so navigating away from /bible and back
  // does NOT accidentally clear the live verse on OBS.
  private _liveSlide: BibleSlide | null = null;
  private _liveTheme: BibleThemeSettings | null = null;
  private _isLive = false;
  private _isBlanked = false;
  private _liveTemplateType: BibleTemplateType = "fullscreen";

  /**
   * Fingerprint of the background currently pushed to OBS.
   * Format: "color:<hex>:<opacity>" or "image:<hash>"
   * Used to skip redundant BG source updates when only the verse text changes.
   */
  private _lastBgFingerprint: string | null = null;

  /**
   * Current BG source kind in OBS: "color" or "image".
   * When the theme changes from color→image or image→color we must
   * delete the old source and create a new one of the correct type.
   */
  private _currentBgKind: "color" | "image" | null = null;

  /** Cache: last image path written to disk (avoids redundant Tauri calls) */
  private _lastBgImagePath: string | null = null;
  private _lastBgImageHash: string | null = null;
  private _lastOverlayTransportSignature: string | null = null;

  private async enableSceneItemSafe(sceneName: string, sceneItemId: number | null): Promise<void> {
    if (!sceneName || sceneItemId === null) return;
    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId,
        sceneItemEnabled: true,
      });
    } catch {
      // Best effort. The scene item may have been removed or be otherwise unavailable.
    }
  }

  private async getCanvasSize(): Promise<{ width: number; height: number }> {
    try {
      const video = await obsService.getVideoSettings();
      return {
        width: Number(video.baseWidth) || 1920,
        height: Number(video.baseHeight) || 1080,
      };
    } catch {
      return { width: 1920, height: 1080 };
    }
  }

  private buildOverlayDataCss(packet: Record<string, unknown>, customCss = ""): string {
    const encodedPacket = encodeURIComponent(JSON.stringify(packet));
    const overlayCss = `:root { --overlay-data: "${encodedPacket}"; }`;
    return customCss ? `${overlayCss}\n${customCss}` : overlayCss;
  }

  private buildThemePayload(theme: BibleThemeSettings | null): {
    themeForHash: BibleThemeSettings | null;
    customCss: string;
  } {
    if (!theme) return { themeForHash: null, customCss: "" };

    let themeForHash: BibleThemeSettings = { ...theme };
    const cssRules: string[] = [];

    if (themeForHash.backgroundImage && themeForHash.backgroundImage.startsWith("data:")) {
      themeForHash = { ...themeForHash, backgroundImage: "__BG_SOURCE__" };
    }

    if (themeForHash.boxBackgroundImage && themeForHash.boxBackgroundImage.startsWith("data:")) {
      cssRules.push(`--box-bg-image: url(${themeForHash.boxBackgroundImage});`);
      themeForHash = { ...themeForHash, boxBackgroundImage: "__FROM_CSS__" };
    }

    if (themeForHash.logoUrl && themeForHash.logoUrl.startsWith("data:")) {
      cssRules.push(`--logo-data-uri: url(${themeForHash.logoUrl});`);
      themeForHash = { ...themeForHash, logoUrl: "__FROM_CSS__" };
    }

    return {
      themeForHash,
      customCss: cssRules.length ? `:root { ${cssRules.join(" ")} }` : "",
    };
  }

  private stripOverlayDataCss(cssText: string | undefined): string {
    return String(cssText || "").replace(/^\s*:root\s*\{\s*--overlay-data:\s*"[^"]*"\s*;\s*\}\s*/s, "");
  }

  private async resolveTrackedSourceNames(): Promise<Set<string>> {
    const names = new Set<string>([BIBLE_SOURCE_NAME, BIBLE_BG_SOURCE_NAME, BIBLE_SCENE_NAME]);
    try {
      const inputs = await obsService.getInputList();
      const regMain = await getInputBySlot(SLOT_INPUT);
      if (regMain) {
        const found = inputs.find((input) => input.inputUuid === regMain.inputUuid);
        if (found?.inputName) names.add(found.inputName);
      }
      const regBg = await getInputBySlot(SLOT_BG_INPUT);
      if (regBg) {
        const found = inputs.find((input) => input.inputUuid === regBg.inputUuid);
        if (found?.inputName) names.add(found.inputName);
      }
      const regScene = await getSceneBySlot(SLOT_SCENE);
      if (regScene?.sceneName) names.add(regScene.sceneName);
    } catch {
      // Fallback to default source names.
    }
    return names;
  }

  private async setOverlayVisibilityForScenes(
    sceneNames: string[],
    enabled: boolean
  ): Promise<void> {
    if (!obsService.isConnected || sceneNames.length === 0) return;
    const uniqueScenes = Array.from(new Set(sceneNames.filter(Boolean)));
    if (uniqueScenes.length === 0) return;
    const sourceNames = await this.resolveTrackedSourceNames();

    await Promise.all(uniqueScenes.map(async (sceneName) => {
      try {
        const items = await obsService.getSceneItemList(sceneName);
        const trackedItems = items.filter((item) => sourceNames.has(item.sourceName));
        await Promise.all(trackedItems.map((item) =>
          obsService.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemEnabled: enabled,
          }).catch(() => {})
        ));
      } catch {
        // Scene may have been deleted or be otherwise inaccessible.
      }
    }));
  }

  private async resolveMainSourceNames(): Promise<Set<string>> {
    const names = new Set<string>([BIBLE_SOURCE_NAME]);
    try {
      const regMain = await getInputBySlot(SLOT_INPUT);
      if (regMain) {
        const inputs = await obsService.getInputList();
        const found = inputs.find((input) => input.inputUuid === regMain.inputUuid);
        if (found?.inputName) names.add(found.inputName);
      }
    } catch {
      // Fallback to default main source name.
    }
    return names;
  }

  private async enforceBgPlacement(sceneName: string, bgItemId: number): Promise<void> {
    try {
      const mainSourceNames = await this.resolveMainSourceNames();
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as {
        sceneItems: Array<{ sceneItemId: number; sourceName: string; sceneItemIndex: number }>;
      }).sceneItems ?? [];

      const bgItem = items.find((item) => item.sceneItemId === bgItemId);
      const mainItem = items.find(
        (item) => item.sceneItemId !== bgItemId && mainSourceNames.has(item.sourceName)
      );

      if (bgItem && mainItem && bgItem.sceneItemIndex >= mainItem.sceneItemIndex) {
        await obsService.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: bgItemId,
          sceneItemIndex: Math.max(0, mainItem.sceneItemIndex - 1),
        });
      } else if (!mainItem) {
        await obsService.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: bgItemId,
          sceneItemIndex: 0,
        });
      }
    } catch (err) {
      console.warn("[BibleOBS] Could not enforce BG z-order:", err);
    }

    try {
      const video = await obsService.getVideoSettings();
      await obsService.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId: bgItemId,
        sceneItemTransform: {
          positionX: 0,
          positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: video.baseWidth,
          boundsHeight: video.baseHeight,
          boundsAlignment: 0,
          cropLeft: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
        },
      });
      await this.enableSceneItemSafe(sceneName, bgItemId);
    } catch (err) {
      console.warn("[BibleOBS] Could not enforce BG transform:", err);
    }
  }

  private async moveSceneItemToTop(sceneName: string, sceneItemId: number): Promise<void> {
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sceneItemId: number; sceneItemIndex: number }> }).sceneItems ?? [];
      const topIndex = Math.max(0, items.length - 1);
      const item = items.find((entry) => entry.sceneItemId === sceneItemId);
      if (item && item.sceneItemIndex !== topIndex) {
        await obsService.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId,
          sceneItemIndex: topIndex,
        });
      }
    } catch { /* ok */ }
  }

  /** Returns the current live state for restoration after remount */
  getLiveState() {
    return {
      slide: this._liveSlide,
      theme: this._liveTheme,
      isLive: this._isLive,
      isBlanked: this._isBlanked,
      templateType: this._liveTemplateType,
    };
  }

  /**
   * Ensure the Bible Browser Source exists in OBS.
   * Creates it if it doesn't exist, or finds the existing one.
   * Uses a mutex to prevent duplicate creation from concurrent calls.
   *
   * @param targetScene - Scene to add the source to. If null, creates a dedicated scene.
   * @param templateType - Which overlay template to use
   */
  async ensureBrowserSource(
    targetScene?: string,
    templateType: BibleTemplateType = "fullscreen"
  ): Promise<{ sceneName: string; sceneItemId: number }> {
    // Mutex: if already running, return the pending promise
    if (this.ensurePromise) {
      return this.ensurePromise;
    }
    this.ensurePromise = this._ensureBrowserSourceImpl(targetScene, templateType);
    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  private async _ensureBrowserSourceImpl(
    targetScene?: string,
    templateType: BibleTemplateType = "fullscreen"
  ): Promise<{ sceneName: string; sceneItemId: number }> {
    if (!obsService.isConnected) {
      throw new Error("OBS is not connected");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NEW ARCHITECTURE: Scene-based overlay
    //
    // 1. Create a dedicated scene (BIBLE_SCENE_NAME = "OCS Bible Overlay")
    // 2. Add the browser_source + BG source INSIDE that scene
    // 3. Nest that scene as a "scene source" into the user's target scene
    //
    // This avoids browser-source flicker because the overlay scene is
    // stable — only its internal sources get URL updates.
    // ═══════════════════════════════════════════════════════════════════════

    const overlaySceneName = BIBLE_SCENE_NAME; // "OCS Bible Overlay"
    const canvas = await this.getCanvasSize();
    let overlaySceneUuid: string | null = null;

    // ── 1. Ensure the overlay scene exists ──
    const regScene = await getSceneBySlot(SLOT_SCENE);
    if (regScene) {
      const scenes = await obsService.getSceneList();
      const found = scenes.find((s) => s.sceneUuid === regScene.sceneUuid);
      if (found && found.sceneName === overlaySceneName) {
        // Registry matches the expected overlay scene name
        overlaySceneUuid = found.sceneUuid;
        console.log(`[BibleOBS] Found registered overlay scene "${found.sceneName}" via UUID ${overlaySceneUuid}`);
      } else if (found) {
        // Registry points to a stale scene (old architecture) — ignore it
        console.log(`[BibleOBS] Registry scene "${found.sceneName}" is stale (expected "${overlaySceneName}"), will create new overlay scene`);
      }
    }

    if (!overlaySceneUuid) {
      const scenes = await obsService.getSceneList();
      const existing = scenes.find((s) => s.sceneName === overlaySceneName);
      if (existing) {
        overlaySceneUuid = existing.sceneUuid;
        await registerScene(SLOT_SCENE, existing.sceneUuid, overlaySceneName);
      } else {
        await obsService.createScene(overlaySceneName);
        const updated = await obsService.getSceneList();
        const created = updated.find((s) => s.sceneName === overlaySceneName);
        if (created) {
          overlaySceneUuid = created.sceneUuid;
          await registerScene(SLOT_SCENE, created.sceneUuid, overlaySceneName);
          console.log(`[BibleOBS] Created overlay scene: ${overlaySceneName} (${overlaySceneUuid})`);
        }
      }
    }

    // ── 2. Ensure browser source exists INSIDE the overlay scene ──
    const overlayUrl = overlayBroadcaster.getOverlayUrl(
      templateType === "lower-third" ? "lower-third" : "fullscreen"
    );

    let currentSourceName = BIBLE_SOURCE_NAME;
    const regInput = await getInputBySlot(SLOT_INPUT);
    if (regInput) {
      const inputs = await obsService.getInputList();
      const found = inputs.find((i) => i.inputUuid === regInput.inputUuid);
      if (found) {
        currentSourceName = found.inputName;
        console.log(`[BibleOBS] Found registered input "${currentSourceName}" via UUID ${regInput.inputUuid}`);
      }
    }

    // Check if browser source already exists in the overlay scene
    let browserItemId: number | null = null;
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: overlaySceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
      const existing = items.find(
        (item) => item.sourceName === currentSourceName || item.sourceName === BIBLE_SOURCE_NAME
      );
      if (existing) {
        browserItemId = existing.sceneItemId;
        let overlayCss = "";
        if (this._isLive && this._liveSlide) {
          const { themeForHash, customCss } = this.buildThemePayload(this._liveTheme);
          const packet = {
            slide: this._liveSlide,
            theme: themeForHash,
            live: true,
            blanked: this._isBlanked,
            timestamp: Date.now(),
          };
          overlayCss = this.buildOverlayDataCss(packet as unknown as Record<string, unknown>, customCss);
        }
        await obsService.call("SetInputSettings", {
          inputName: existing.sourceName,
          inputSettings: { url: overlayUrl, width: canvas.width, height: canvas.height, css: overlayCss },
        });
        await this.enableSceneItemSafe(overlaySceneName, browserItemId);
      }
    } catch { /* scene might be empty */ }

    if (browserItemId === null) {
      // Create the browser source inside the overlay scene
      try {
        browserItemId = await obsService.createInput(
          overlaySceneName,
          BIBLE_SOURCE_NAME,
          "browser_source",
          {
            url: overlayUrl,
            width: canvas.width,
            height: canvas.height,
            css: "",
            shutdown: false,
            restart_when_active: false,
          }
        );
        const inputs = await obsService.getInputList();
        const createdInput = inputs.find((i) => i.inputName === BIBLE_SOURCE_NAME);
        if (createdInput) {
          await registerInput(SLOT_INPUT, createdInput.inputUuid, BIBLE_SOURCE_NAME, "browser_source");
        }
        console.log(`[BibleOBS] Created browser source "${BIBLE_SOURCE_NAME}" inside overlay scene (itemId: ${browserItemId})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists") || msg.includes("600")) {
          // Source exists globally — update URL and add to overlay scene
          await obsService.call("SetInputSettings", {
            inputName: currentSourceName,
            inputSettings: { url: overlayUrl, width: canvas.width, height: canvas.height },
          });
          if (!regInput) {
            const inputs = await obsService.getInputList();
            const found = inputs.find((i) => i.inputName === currentSourceName || i.inputName === BIBLE_SOURCE_NAME);
            if (found) {
              await registerInput(SLOT_INPUT, found.inputUuid, found.inputName, "browser_source");
            }
          }
          // Add to overlay scene if not already there
          try {
            browserItemId = await obsService.createSceneItem(overlaySceneName, currentSourceName);
          } catch {
            // Might already be in the scene
            const resp = await obsService.call("GetSceneItemList", { sceneName: overlaySceneName });
            const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
            const found = items.find((i) => i.sourceName === currentSourceName || i.sourceName === BIBLE_SOURCE_NAME);
            browserItemId = found?.sceneItemId ?? null;
          }
        } else {
          throw err;
        }
      }
    }

    // Stretch browser source to fill the overlay scene canvas (1920×1080)
    if (browserItemId !== null) {
      try {
        await obsService.setSceneItemTransform(overlaySceneName, browserItemId, {
          positionX: 0,
          positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width,
          boundsHeight: canvas.height,
          boundsAlignment: 0,
          rotation: 0,
        });
        await this.moveSceneItemToTop(overlaySceneName, browserItemId);
        await this.enableSceneItemSafe(overlaySceneName, browserItemId);
      } catch { /* ok */ }
    }

    // ── 3. Ensure BG source exists inside the overlay scene ──
    await this.ensureBgSource(overlaySceneName, overlaySceneUuid);

    // ── 4. Nest the overlay scene into the target scene ──
    // If no target is specified, the overlay scene IS the scene we track.
    // If a target is given, we add the overlay scene as a scene source inside it.
    const finalSceneName = targetScene || overlaySceneName;

    if (targetScene) {
      // Ensure target scene exists
      const scenes = await obsService.getSceneList();
      if (!scenes.some((s) => s.sceneName === targetScene)) {
        await obsService.createScene(targetScene);
        console.log(`[BibleOBS] Created target scene: ${targetScene}`);
      }

      // Check if overlay scene is already nested in the target
      let nestedItemId: number | null = null;
      try {
        const resp = await obsService.call("GetSceneItemList", { sceneName: targetScene });
        const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
        const existingNested = items.find((i) => i.sourceName === overlaySceneName);
      if (existingNested) {
        nestedItemId = existingNested.sceneItemId;
      }
      } catch { /* */ }

      if (nestedItemId === null) {
        // Add the overlay scene as a scene source in the target
        nestedItemId = await obsService.createSceneItem(targetScene, overlaySceneName);
        console.log(`[BibleOBS] Nested overlay scene "${overlaySceneName}" into "${targetScene}" (itemId: ${nestedItemId})`);
      }

      // Stretch the nested scene to fill the target
      try {
        await obsService.setSceneItemTransform(targetScene, nestedItemId, {
          positionX: 0,
          positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width,
          boundsHeight: canvas.height,
          boundsAlignment: 0,
          rotation: 0,
        });
        await this.moveSceneItemToTop(targetScene, nestedItemId);
        await this.enableSceneItemSafe(targetScene, nestedItemId);
      } catch { /* ok */ }

      this.sceneItemId = nestedItemId;
      this.currentSceneName = targetScene;
    } else {
      // No target — track the browser source item inside the overlay scene itself
      this.sceneItemId = browserItemId;
      this.currentSceneName = overlaySceneName;
    }

    this.currentTemplateType = templateType;
    await registerSceneItem(SLOT_ITEM, SLOT_SCENE, SLOT_INPUT, this.sceneItemId!, overlaySceneUuid ?? "");
    console.log(`[BibleOBS] ✓ Scene-based overlay ready: "${overlaySceneName}" → "${finalSceneName}"`);
    return { sceneName: finalSceneName, sceneItemId: this.sceneItemId! };
  }

  /**
   * Ensure a background source exists BELOW the main text source.
   * Initially creates a `color_source_v3` (solid color). When the theme
   * changes to an image background, `pushSlide()` will call
   * `recreateBgSource()` to swap it for an `image_source`.
   */
  private async ensureBgSource(sceneName: string, sceneUuid: string | null): Promise<void> {
    if (!obsService.isConnected) return;
    const canvas = await this.getCanvasSize();

    // Check if BG source already exists in scene
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }> }).sceneItems ?? [];
      const existing = items.find((item) => item.sourceName === BIBLE_BG_SOURCE_NAME);
      if (existing) {
        this.bgSceneItemId = existing.sceneItemId;
        // Detect current kind from the input type
        try {
          const resp2 = await obsService.call("GetInputSettings", { inputName: BIBLE_BG_SOURCE_NAME }) as {
            inputKind: string;
          };
          this._currentBgKind = resp2.inputKind === "image_source" ? "image" : "color";
        } catch {
          this._currentBgKind = "color"; // assume color if we can't determine
        }
        await this.enableSceneItemSafe(sceneName, this.bgSceneItemId);
        await this.enforceBgPlacement(sceneName, existing.sceneItemId);
        return; // Already exists
      }
    } catch { /* scene might not have items yet */ }

    // Default colour — black, full opacity, 1920×1080
    const defaultColor = 0xFF000000; // ABGR: fully opaque black

    // Create a Color Source (not a browser source)
    try {
      const bgItemId = await obsService.createInput(
        sceneName,
        BIBLE_BG_SOURCE_NAME,
        "color_source_v3",
        {
          color: defaultColor,
          width: canvas.width,
          height: canvas.height,
        }
      );

      this.bgSceneItemId = bgItemId;
      this._currentBgKind = "color";

      // Register in obsRegistry
      const inputs = await obsService.getInputList();
      const bgInput = inputs.find((i) => i.inputName === BIBLE_BG_SOURCE_NAME);
      if (bgInput) {
        await registerInput(SLOT_BG_INPUT, bgInput.inputUuid, BIBLE_BG_SOURCE_NAME, "color_source_v3");
        await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, sceneUuid ?? "");
      }

      // Move BG source directly below the main text source.
      if (this.sceneItemId !== null) {
        try {
          const resp2 = await obsService.call("GetSceneItemList", { sceneName });
          const items2 = (resp2 as { sceneItems: Array<{ sceneItemId: number; sceneItemIndex: number }> }).sceneItems ?? [];
          const mainItem = items2.find((i) => i.sceneItemId === this.sceneItemId);
          if (mainItem) {
            await obsService.call("SetSceneItemIndex", {
              sceneName,
              sceneItemId: bgItemId,
              sceneItemIndex: Math.max(0, mainItem.sceneItemIndex - 1),
            });
          }
        } catch (err) {
          console.warn("[BibleOBS] Could not reorder BG source:", err);
        }
      }
      await this.enforceBgPlacement(sceneName, bgItemId);

      console.log(`[BibleOBS] Created Color Source BG "${BIBLE_BG_SOURCE_NAME}" in "${sceneName}" (itemId: ${bgItemId})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("600")) {
        try {
          const bgItemId = await obsService.createSceneItem(sceneName, BIBLE_BG_SOURCE_NAME);
          this.bgSceneItemId = bgItemId;
          this._currentBgKind = "color";
          await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, sceneUuid ?? "");
          await this.enforceBgPlacement(sceneName, bgItemId);
        } catch (err2) {
          console.warn("[BibleOBS] Failed to add existing BG source to scene:", err2);
        }
      } else {
        console.warn("[BibleOBS] Failed to create BG source:", err);
      }
    }
  }

  /**
   * Convert a hex color string (#RRGGBB or #AARRGGBB) to OBS ABGR integer.
   * OBS color_source_v3 uses ABGR format as an unsigned 32-bit integer.
   */
  private hexToObsColor(hex: string, opacity: number = 1): number {
    const clean = hex.replace("#", "");
    let r = 0, g = 0, b = 0;
    if (clean.length >= 6) {
      r = parseInt(clean.substring(0, 2), 16);
      g = parseInt(clean.substring(2, 4), 16);
      b = parseInt(clean.substring(4, 6), 16);
    }
    const a = Math.round(opacity * 255);
    // OBS stores as ABGR (little-endian on the wire)
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /**
   * Fast string hash (djb2) — produces a short numeric fingerprint for
   * a string so we can compare background images without storing the
   * entire base64 data-URL.
   */
  private _simpleHash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Save a base64 data-URL image to disk via Tauri and return the absolute
   * file path. Uses a content-addressed filename (hash of the data) so
   * the same image is only written once.
   */
  private async saveBgImageToDisk(dataUrl: string): Promise<string> {
    const hash = this._simpleHash(dataUrl);

    // If we already wrote this exact image, return cached path
    if (hash === this._lastBgImageHash && this._lastBgImagePath) {
      return this._lastBgImagePath;
    }

    // Parse the data URL: "data:image/jpeg;base64,/9j/4AAQ..."
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) throw new Error("Invalid data URL — no comma found");

    const header = dataUrl.substring(0, commaIdx); // "data:image/jpeg;base64"
    const base64Data = dataUrl.substring(commaIdx + 1);

    // Determine file extension from MIME type
    const mimeMatch = header.match(/data:image\/(\w+)/);
    const ext = mimeMatch ? mimeMatch[1].replace("jpeg", "jpg") : "png";
    const fileName = `bg_${hash}.${ext}`;

    // Decode base64 → Uint8Array
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Write to disk via Tauri Rust backend
    const absolutePath = await invoke<string>("save_bg_image", {
      fileName,
      fileData: Array.from(bytes),
    });

    this._lastBgImageHash = hash;
    this._lastBgImagePath = absolutePath;

    console.log(`[BibleOBS] BG image saved to disk: ${absolutePath}`);
    return absolutePath;
  }

  /**
   * Recreate the BG source with a different OBS source type.
   * Deletes the existing source and creates a new one.
   */
  private async recreateBgSource(
    sceneName: string,
    kind: "color" | "image",
    settings: Record<string, unknown>
  ): Promise<void> {
    const canvas = await this.getCanvasSize();
    // Remove old BG source from the scene if it exists
    if (this.bgSceneItemId !== null) {
      try {
        await obsService.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: this.bgSceneItemId,
        });
      } catch { /* might already be gone */ }
      this.bgSceneItemId = null;
    }

    // Delete the old input entirely so we can recreate with a different type
    try {
      await obsService.call("RemoveInput", { inputName: BIBLE_BG_SOURCE_NAME });
    } catch { /* might not exist */ }

    const inputKind = kind === "image" ? "image_source" : "color_source_v3";

    try {
      const bgItemId = await obsService.createInput(
        sceneName,
        BIBLE_BG_SOURCE_NAME,
        inputKind,
        { ...settings, width: canvas.width, height: canvas.height }
      );
      this.bgSceneItemId = bgItemId;
      this._currentBgKind = kind;

      // Register in obsRegistry
      const inputs = await obsService.getInputList();
      const bgInput = inputs.find((i) => i.inputName === BIBLE_BG_SOURCE_NAME);
      if (bgInput) {
        await registerInput(SLOT_BG_INPUT, bgInput.inputUuid, BIBLE_BG_SOURCE_NAME, inputKind);
        const regScene = await getSceneBySlot(SLOT_SCENE);
        await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, regScene?.sceneUuid ?? "");
      }

      // Move BG source directly below the main text source.
      if (this.sceneItemId !== null) {
        try {
          const resp = await obsService.call("GetSceneItemList", { sceneName });
          const items = (resp as { sceneItems: Array<{ sceneItemId: number; sceneItemIndex: number }> }).sceneItems ?? [];
          const mainItem = items.find((i) => i.sceneItemId === this.sceneItemId);
          if (mainItem) {
            await obsService.call("SetSceneItemIndex", {
              sceneName,
              sceneItemId: bgItemId,
              sceneItemIndex: Math.max(0, mainItem.sceneItemIndex - 1),
            });
          }
        } catch { /* ok */ }
      }

      // Stretch to fill canvas
      try {
        const video = await obsService.getVideoSettings();
        await obsService.call("SetSceneItemTransform", {
          sceneName,
          sceneItemId: bgItemId,
          sceneItemTransform: {
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: video.baseWidth,
            boundsHeight: video.baseHeight,
            boundsAlignment: 0,
          },
        });
      } catch { /* ok */ }
      await this.enforceBgPlacement(sceneName, bgItemId);

      console.log(`[BibleOBS] Recreated BG source as ${inputKind} in "${sceneName}" (itemId: ${bgItemId})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("600")) {
        // Source exists globally — update its settings and add to scene
        await obsService.call("SetInputSettings", {
          inputName: BIBLE_BG_SOURCE_NAME,
          inputSettings: settings,
        });
        try {
          const bgItemId = await obsService.createSceneItem(sceneName, BIBLE_BG_SOURCE_NAME);
          this.bgSceneItemId = bgItemId;
          this._currentBgKind = kind;
          await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, "");
          await this.enforceBgPlacement(sceneName, bgItemId);
        } catch { /* ok */ }
      } else {
        console.warn("[BibleOBS] Failed to recreate BG source:", err);
      }
    }
  }

  /**
   * Push a slide to the overlay (via localStorage/BroadcastChannel)
   * and inject data into OBS Browser Source via URL hash.
   *
   * How it works:
   * - The overlay URL is updated with slide data encoded in the hash fragment
   * - OBS Browser Source navigates to the new URL, the overlay reads location.hash on load
   * - For same-origin windows (popup preview), BroadcastChannel + localStorage are used
   *
   * Background images are saved to disk via Tauri and displayed using an
   * OBS `image_source` behind the text browser source. Solid colours use
   * an OBS `color_source_v3`. The source type is swapped dynamically as
   * the theme changes.
   */
  async pushSlide(
    slide: BibleSlide | null,
    theme: BibleThemeSettings | null,
    live: boolean,
    blanked: boolean,
    templateType?: BibleTemplateType
  ): Promise<void> {
    // ── Track live state in singleton (survives React unmounts) ──
    this._liveSlide = slide;
    this._liveTheme = theme;
    this._isLive = live;
    this._isBlanked = blanked;
    if (templateType) this._liveTemplateType = templateType;

    // Update template type if provided
    if (templateType) {
      this.currentTemplateType = templateType;
    }

    // Push to overlay broadcaster (for same-origin windows / BroadcastChannel)
    overlayBroadcaster.pushSlide(slide, theme, live, blanked);

    // If OBS is connected, update the browser source URL with data in the hash
    if (obsService.isConnected) {
      // Auto-create the browser source if it hasn't been set up yet
      if (this.sceneItemId === null) {
        try {
          await this.ensureBrowserSource(undefined, this.currentTemplateType);
          console.log("[BibleOBS] Auto-created scene-based overlay on first push");
        } catch (err) {
          console.warn("[BibleOBS] Failed to auto-create scene-based overlay:", err);
        }
      } else {
        // Verify the overlay scene + browser source still exist in OBS
        // (user may have deleted them from OBS manually)
        try {
          // Check if the overlay scene itself still exists
          const scenes = await obsService.getSceneList();
          const overlaySceneExists = scenes.some((s) => s.sceneName === BIBLE_SCENE_NAME);
          if (!overlaySceneExists) {
            console.log("[BibleOBS] Overlay scene missing in OBS, recreating...");
            this.sceneItemId = null;
            this.currentSceneName = null;
            await this.ensureBrowserSource(undefined, this.currentTemplateType);
          } else {
            // Check if the browser source is still inside the overlay scene
            const resp = await obsService.call("GetSceneItemList", { sceneName: BIBLE_SCENE_NAME });
            const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
            const hasBrowserSource = items.some(
              (item) => item.sourceName === BIBLE_SOURCE_NAME
            );
            if (!hasBrowserSource) {
              console.log("[BibleOBS] Browser source missing from overlay scene, recreating...");
              this.sceneItemId = null;
              this.currentSceneName = null;
              await this.ensureBrowserSource(undefined, this.currentTemplateType);
            }
          }
        } catch {
          console.log("[BibleOBS] Failed to verify overlay, recreating...");
          this.sceneItemId = null;
          this.currentSceneName = null;
          try {
            await this.ensureBrowserSource(undefined, this.currentTemplateType);
          } catch (err2) {
            console.warn("[BibleOBS] Failed to recreate scene-based overlay:", err2);
          }
        }
      }
      try {
        const { themeForHash, customCss } = this.buildThemePayload(theme);

        const packet = {
          slide,
          theme: themeForHash,
          live,
          blanked,
          timestamp: Date.now(),
        };
        const base = getOverlayBaseUrlSync();
        const overlayFile = this.currentTemplateType === "fullscreen"
          ? "bible-overlay-fullscreen.html"
          : "bible-overlay-lower-third.html";
        const baseUrl = `${base}/${overlayFile}`;
        const overlayCss = this.buildOverlayDataCss(packet as unknown as Record<string, unknown>, customCss || "");
        const sourceSignature = JSON.stringify({
          baseUrl,
          css: customCss || "",
        });
        if (this.bgSceneItemId !== null) {
          await this.enforceBgPlacement(BIBLE_SCENE_NAME, this.bgSceneItemId);
        }

        // Resolve current input name from registry (survives renames)
        let resolvedInputName = BIBLE_SOURCE_NAME;
        const regInput = await getInputBySlot(SLOT_INPUT);
        if (regInput) {
          const inputs = await obsService.getInputList();
          const found = inputs.find((i) => i.inputUuid === regInput.inputUuid);
          if (found) resolvedInputName = found.inputName;
        }

        if (this._lastOverlayTransportSignature !== sourceSignature || blanked || !slide) {
          const inputSettings = this._lastOverlayTransportSignature !== sourceSignature
            ? { url: baseUrl, css: overlayCss }
            : { css: overlayCss };
          await obsService.call("SetInputSettings", {
            inputName: resolvedInputName,
            inputSettings,
          });
          this._lastOverlayTransportSignature = sourceSignature;
        }

        // ── Push BG source — fingerprint-based dedup ──
        // • Image background → save to disk, use OBS image_source
        // • Solid color → use OBS color_source_v3
        // Switches source type when needed (e.g. color → image or vice versa).
        if (theme) {
          try {
            const hasImage = !!(theme.backgroundImage && theme.backgroundImage.startsWith("data:"));
            const bgFingerprint = hasImage
              ? `image:${this._simpleHash(theme.backgroundImage)}`
              : `color:${(theme.backgroundColor || "#000000").toLowerCase()}:${theme.backgroundOpacity ?? 1}`;

            if (bgFingerprint !== this._lastBgFingerprint) {
              // BG source lives inside the overlay scene, not the target scene
              const bgSceneName = BIBLE_SCENE_NAME;

              if (hasImage) {
                // ── IMAGE BACKGROUND ──
                // Save the base64 data URL to disk, get the absolute file path,
                // then point an OBS image_source at it.
                const filePath = await this.saveBgImageToDisk(theme.backgroundImage);

                if (this._currentBgKind !== "image") {
                  // Need to switch from color_source_v3 → image_source
                  await this.recreateBgSource(bgSceneName, "image", { file: filePath });
                } else {
                  // Already an image_source — just update the file path
                  let resolvedBgName = BIBLE_BG_SOURCE_NAME;
                  const regBg = await getInputBySlot(SLOT_BG_INPUT);
                  if (regBg) {
                    const inputs = await obsService.getInputList();
                    const found = inputs.find((i) => i.inputUuid === regBg.inputUuid);
                    if (found) resolvedBgName = found.inputName;
                  }
                  await obsService.call("SetInputSettings", {
                    inputName: resolvedBgName,
                    inputSettings: { file: filePath },
                  });
                }
              } else {
                // ── SOLID COLOR BACKGROUND ──
                const obsColor = this.hexToObsColor(
                  theme.backgroundColor || "#000000",
                  theme.backgroundOpacity ?? 1
                );

                if (this._currentBgKind !== "color") {
                  // Need to switch from image_source → color_source_v3
                  await this.recreateBgSource(bgSceneName, "color", { color: obsColor });
                } else if (this.bgSceneItemId !== null) {
                  // Already a color_source_v3 — just update the color
                  let resolvedBgName = BIBLE_BG_SOURCE_NAME;
                  const regBg = await getInputBySlot(SLOT_BG_INPUT);
                  if (regBg) {
                    const inputs = await obsService.getInputList();
                    const found = inputs.find((i) => i.inputUuid === regBg.inputUuid);
                    if (found) resolvedBgName = found.inputName;
                  }
                  const canvas = await this.getCanvasSize();
                  await obsService.call("SetInputSettings", {
                    inputName: resolvedBgName,
                    inputSettings: { color: obsColor, width: canvas.width, height: canvas.height },
                  });
                } else {
                  // No BG source exists yet — create one
                  await this.ensureBgSource(bgSceneName, null);
                  this._currentBgKind = "color";
                }
              }

              this._lastBgFingerprint = bgFingerprint;
              console.log(`[BibleOBS] BG updated → ${bgFingerprint}`);
            }
          } catch (bgErr) {
            console.warn("[BibleOBS] Failed to update BG source:", bgErr);
          }
        }

        // ── Also push to all MV-created Bible browser sources ──
        // These are created by the layout editor with names like "MV_LayoutName_Bible:ThemeName_regionId"
        // They need to receive the same verse data but keep their own theme CSS.
        await this.pushToMVBibleSources(slide, live, blanked);
      } catch (err) {
        console.warn("[BibleOBS] Failed to push slide via URL hash:", err);
      }
    }
  }

  /**
   * Push a slide to all MV-created Bible browser sources in OBS.
   *
   * MV Bible sources are browser_source inputs with names matching "MV_*_Bible:*".
   * They were created by the layout editor (mvObsService) and have their own
   * theme CSS injected via the OBS custom CSS setting.
   *
   * We update only the URL hash (slide data) — the CSS (theme) is preserved
   * from the layout editor so the verse appears with the correct theme & size.
   */
  private async pushToMVBibleSources(
    slide: BibleSlide | null,
    live: boolean,
    blanked: boolean,
  ): Promise<void> {
    try {
      const inputs = await obsService.getInputList();
      // Find all MV Bible browser sources (name pattern: MV_*_Bible:*)
      const mvBibleInputs = inputs.filter(
        (i) => i.inputKind === "browser_source" && /^MV_.+_Bible:/.test(i.inputName)
      );

      if (mvBibleInputs.length === 0) return;

      console.log(`[BibleOBS] Found ${mvBibleInputs.length} MV Bible source(s) to update`);

      // Build the slide packet (without theme — the overlay reads theme from CSS vars)
      const packet = {
        slide,
        theme: null as null,  // Theme is baked into the CSS by mvObsService
        live,
        blanked,
        timestamp: Date.now(),
      };
      for (const input of mvBibleInputs) {
        try {
          // Get current settings to find the base URL and preserve custom CSS
          const resp = await obsService.call("GetInputSettings", { inputName: input.inputName }) as {
            inputSettings: { url?: string; css?: string; width?: number; height?: number };
          };
          const currentSettings = resp.inputSettings;
          const currentUrl = currentSettings.url || "";

          // Extract the base URL (everything before #)
          const baseUrl = currentUrl.split("#")[0] || currentUrl;

          const baseCss = this.stripOverlayDataCss(currentSettings.css || "");
          const overlayCss = this.buildOverlayDataCss(packet as unknown as Record<string, unknown>, baseCss);

          const inputSettings = currentUrl.split("#")[0] === baseUrl
            ? { css: overlayCss }
            : { url: baseUrl, css: overlayCss };
          await obsService.call("SetInputSettings", {
            inputName: input.inputName,
            inputSettings,
          });
          console.log(`[BibleOBS] Pushed verse to MV source "${input.inputName}"`);
        } catch (err) {
          console.warn(`[BibleOBS] Failed to push to MV source "${input.inputName}":`, err);
        }
      }
    } catch (err) {
      console.warn("[BibleOBS] Failed to scan for MV Bible sources:", err);
    }
  }

  /**
   * Show the Bible overlay (make visible in OBS).
   */
  async show(): Promise<void> {
    if (!obsService.isConnected || !this.currentSceneName || !this.sceneItemId)
      return;

    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName: this.currentSceneName,
        sceneItemId: this.sceneItemId,
        sceneItemEnabled: true,
      });
    } catch (err) {
      console.error("[BibleOBS] Failed to show overlay:", err);
    }
  }

  async clearOverlay(sceneNames?: string[]): Promise<void> {
    const liveSlide = this._liveSlide;
    const liveTheme = this._liveTheme;
    const liveTemplateType = this._liveTemplateType;

    this._isLive = false;
    this._isBlanked = false;

    if (!obsService.isConnected) {
      this._liveSlide = null;
      this._liveTheme = null;
      overlayBroadcaster.clear();
      return;
    }

    if (this.sceneItemId !== null && liveSlide) {
      try {
        await this.pushSlide(liveSlide, liveTheme, false, true, liveTemplateType);
        await new Promise((resolve) => window.setTimeout(resolve, FULLSCREEN_CLEAR_WAIT_MS));
      } catch {
        // Best effort. Visibility shutdown below still clears the output.
      }
    }

    if (this.sceneItemId !== null) {
      try {
        await this.pushSlide(null, liveTheme, false, false, liveTemplateType);
      } catch {
        overlayBroadcaster.clear();
      }
    } else {
      overlayBroadcaster.clear();
    }

    let targets = sceneNames?.filter(Boolean) ?? [];
    let overlaySceneName = BIBLE_SCENE_NAME;
    try {
      const regScene = await getSceneBySlot(SLOT_SCENE);
      if (regScene?.sceneName) overlaySceneName = regScene.sceneName;
    } catch {
      // Registry lookup is best-effort.
    }
    const candidateTargets = Array.from(new Set([...targets, this.currentSceneName || ""].filter(Boolean)));
    const visibilityTargets = candidateTargets.filter((sceneName) => sceneName !== overlaySceneName);
    await this.setOverlayVisibilityForScenes(
      visibilityTargets.length > 0 ? visibilityTargets : candidateTargets,
      false,
    );

    this._liveSlide = null;
    this._liveTheme = null;
  }

  /**
   * Hide the Bible overlay in OBS.
   */
  async hide(): Promise<void> {
    if (!obsService.isConnected || !this.currentSceneName || !this.sceneItemId)
      return;

    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName: this.currentSceneName,
        sceneItemId: this.sceneItemId,
        sceneItemEnabled: false,
      });
    } catch (err) {
      console.error("[BibleOBS] Failed to hide overlay:", err);
    }
  }

  /**
   * Get the current state.
   */
  getState() {
    return {
      sourceName: BIBLE_SOURCE_NAME,
      sceneName: this.currentSceneName,
      sceneItemId: this.sceneItemId,
      isSetup: this.sceneItemId !== null,
    };
  }
}

export const bibleObsService = new BibleObsService();
