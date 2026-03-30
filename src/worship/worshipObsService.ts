/**
 * worshipObsService.ts — OBS integration for Worship lyrics overlays
 *
 * Creates and manages a Browser Source in OBS that displays worship lyrics.
 * Reuses the same overlay HTML as the Bible module (fullscreen template)
 * but with worship-specific content.
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
import { invoke } from "@tauri-apps/api/core";
import type { BibleThemeSettings, BibleSlide } from "../bible/types";

const WORSHIP_SOURCE_NAME = "OBS Church Studio — Worship";
const WORSHIP_BG_SOURCE_NAME = "OBS Church Studio — Worship BG";
const WORSHIP_SCENE_NAME = "OCS Worship Overlay";

// Registry slot names
const SLOT_SCENE = "worship-overlay";
const SLOT_INPUT = "worship-browser-source";
const SLOT_BG_INPUT = "worship-bg-source";
const SLOT_ITEM = `${SLOT_SCENE}:${SLOT_INPUT}`;
const SLOT_BG_ITEM = `${SLOT_SCENE}:${SLOT_BG_INPUT}`;

class WorshipObsService {
  private sceneItemId: number | null = null;
  private bgSceneItemId: number | null = null;
  private currentSceneName: string | null = null;
  private ensurePromise: Promise<{ sceneName: string; sceneItemId: number }> | null = null;

  // Persistent live state
  private _liveText: string | null = null;
  private _liveRef: string | null = null;
  private _liveTheme: BibleThemeSettings | null = null;
  private _isLive = false;
  private _isBlanked = false;
  private _lastBgFingerprint: string | null = null;
  private _currentBgKind: "color" | "image" | null = null;
  private _lastBgImagePath: string | null = null;
  private _lastBgImageHash: string | null = null;

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

  getLiveState() {
    return {
      text: this._liveText,
      ref: this._liveRef,
      theme: this._liveTheme,
      isLive: this._isLive,
      isBlanked: this._isBlanked,
    };
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

  private async resolveTrackedSourceNames(): Promise<Set<string>> {
    const names = new Set<string>([WORSHIP_SOURCE_NAME, WORSHIP_BG_SOURCE_NAME]);
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
    } catch {
      // Fallback to default source names.
    }
    return names;
  }

  private async resolveMainSourceNames(): Promise<Set<string>> {
    const names = new Set<string>([WORSHIP_SOURCE_NAME]);
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

  /**
   * Ensure worship BG stays behind text and fills the whole canvas.
   */
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
      console.warn("[WorshipOBS] Could not enforce BG z-order:", err);
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
      await obsService.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: bgItemId,
        sceneItemEnabled: true,
      });
    } catch (err) {
      console.warn("[WorshipOBS] Could not enforce BG transform:", err);
    }
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
        const worshipItems = items.filter((item) => sourceNames.has(item.sourceName));
        await Promise.all(worshipItems.map((item) =>
          obsService.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: item.sceneItemId,
            sceneItemEnabled: enabled,
          }).catch(() => {})
        ));
      } catch {
        // Scene may have been deleted or inaccessible; ignore.
      }
    }));
  }

  async ensureBrowserSource(
    targetScene?: string
  ): Promise<{ sceneName: string; sceneItemId: number }> {
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this._ensureImpl(targetScene);
    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  private async _ensureImpl(
    targetScene?: string
  ): Promise<{ sceneName: string; sceneItemId: number }> {
    if (!obsService.isConnected) throw new Error("OBS is not connected");

    // ═══════════════════════════════════════════════════════════════════════
    // Scene-based overlay architecture:
    //
    // 1. Create a dedicated scene (WORSHIP_SCENE_NAME = "OCS Worship Overlay")
    // 2. Add the browser_source + BG source INSIDE that scene
    // 3. Nest that scene as a "scene source" into the user's target scene
    // ═══════════════════════════════════════════════════════════════════════

    const overlaySceneName = WORSHIP_SCENE_NAME; // "OCS Worship Overlay"
    const canvas = await this.getCanvasSize();
    let overlaySceneUuid: string | null = null;

    // ── 1. Ensure the overlay scene exists ──
    const regScene = await getSceneBySlot(SLOT_SCENE);
    if (regScene) {
      const scenes = await obsService.getSceneList();
      const found = scenes.find((s) => s.sceneUuid === regScene.sceneUuid);
      if (found && found.sceneName === overlaySceneName) {
        overlaySceneUuid = found.sceneUuid;
        console.log(`[WorshipOBS] Found registered overlay scene "${found.sceneName}" via UUID ${overlaySceneUuid}`);
      } else if (found) {
        console.log(`[WorshipOBS] Registry scene "${found.sceneName}" is stale (expected "${overlaySceneName}"), will create new overlay scene`);
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
          console.log(`[WorshipOBS] Created overlay scene: ${overlaySceneName} (${overlaySceneUuid})`);
        }
      }
    }

    // ── 2. Ensure browser source exists INSIDE the overlay scene ──
    const overlayUrl = `${getOverlayBaseUrlSync()}/bible-overlay-fullscreen.html`;

    let currentSourceName = WORSHIP_SOURCE_NAME;
    const regInput = await getInputBySlot(SLOT_INPUT);
    if (regInput) {
      const inputs = await obsService.getInputList();
      const found = inputs.find((i) => i.inputUuid === regInput.inputUuid);
      if (found) {
        currentSourceName = found.inputName;
        console.log(`[WorshipOBS] Found registered input "${currentSourceName}" via UUID ${regInput.inputUuid}`);
      }
    }

    let browserItemId: number | null = null;
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName: overlaySceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
      const existing = items.find(
        (item) => item.sourceName === currentSourceName || item.sourceName === WORSHIP_SOURCE_NAME
      );
      if (existing) {
        browserItemId = existing.sceneItemId;
        // Update URL
        let ensureUrl = overlayUrl;
        if (this._isLive && this._liveText) {
          const slide: BibleSlide = {
            id: "worship-live",
            text: this._liveText,
            reference: this._liveRef || "",
            verseRange: "",
            index: 0,
            total: 1,
          };
          const { themeForHash, customCss } = this.buildThemePayload(this._liveTheme);
          const packet = { slide, theme: themeForHash, live: true, blanked: this._isBlanked, timestamp: Date.now() };
          ensureUrl = `${overlayUrl}#data=${encodeURIComponent(JSON.stringify(packet))}`;
          await obsService.call("SetInputSettings", {
            inputName: existing.sourceName,
            inputSettings: { url: ensureUrl, width: canvas.width, height: canvas.height, css: customCss || "" },
          });
        } else {
          await obsService.call("SetInputSettings", {
            inputName: existing.sourceName,
            inputSettings: { url: ensureUrl, width: canvas.width, height: canvas.height, css: "" },
          });
        }
      }
    } catch { /* scene might be empty */ }

    if (browserItemId === null) {
      try {
        browserItemId = await obsService.createInput(
          overlaySceneName,
          WORSHIP_SOURCE_NAME,
          "browser_source",
          { url: overlayUrl, width: canvas.width, height: canvas.height, css: "", shutdown: false, restart_when_active: false }
        );
        const inputs = await obsService.getInputList();
        const createdInput = inputs.find((i) => i.inputName === WORSHIP_SOURCE_NAME);
        if (createdInput) {
          await registerInput(SLOT_INPUT, createdInput.inputUuid, WORSHIP_SOURCE_NAME, "browser_source");
        }
        console.log(`[WorshipOBS] Created browser source "${WORSHIP_SOURCE_NAME}" inside overlay scene (itemId: ${browserItemId})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists") || msg.includes("600")) {
          await obsService.call("SetInputSettings", {
            inputName: currentSourceName,
            inputSettings: { url: overlayUrl, width: canvas.width, height: canvas.height },
          });
          if (!regInput) {
            const inputs = await obsService.getInputList();
            const found = inputs.find((i) => i.inputName === currentSourceName || i.inputName === WORSHIP_SOURCE_NAME);
            if (found) {
              await registerInput(SLOT_INPUT, found.inputUuid, found.inputName, "browser_source");
            }
          }
          try {
            browserItemId = await obsService.createSceneItem(overlaySceneName, currentSourceName);
          } catch {
            const resp = await obsService.call("GetSceneItemList", { sceneName: overlaySceneName });
            const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
            const found = items.find((i) => i.sourceName === currentSourceName || i.sourceName === WORSHIP_SOURCE_NAME);
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
          positionX: 0, positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width, boundsHeight: canvas.height,
          boundsAlignment: 0, rotation: 0,
        });
        await this.moveSceneItemToTop(overlaySceneName, browserItemId);
      } catch { /* ok */ }
    }

    // ── 3. Ensure BG source exists inside the overlay scene ──
    await this.ensureBgSource(overlaySceneName, overlaySceneUuid);

    // ── 4. Nest the overlay scene into the target scene ──
    const finalSceneName = targetScene || overlaySceneName;

    if (targetScene) {
      const scenes = await obsService.getSceneList();
      if (!scenes.some((s) => s.sceneName === targetScene)) {
        await obsService.createScene(targetScene);
        console.log(`[WorshipOBS] Created target scene: ${targetScene}`);
      }

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
        nestedItemId = await obsService.createSceneItem(targetScene, overlaySceneName);
        console.log(`[WorshipOBS] Nested overlay scene "${overlaySceneName}" into "${targetScene}" (itemId: ${nestedItemId})`);
      }

      try {
        await obsService.setSceneItemTransform(targetScene, nestedItemId, {
          positionX: 0, positionY: 0,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvas.width, boundsHeight: canvas.height,
          boundsAlignment: 0, rotation: 0,
        });
        await this.moveSceneItemToTop(targetScene, nestedItemId);
      } catch { /* ok */ }

      this.sceneItemId = nestedItemId;
      this.currentSceneName = targetScene;
    } else {
      this.sceneItemId = browserItemId;
      this.currentSceneName = overlaySceneName;
    }

    await registerSceneItem(SLOT_ITEM, SLOT_SCENE, SLOT_INPUT, this.sceneItemId!, overlaySceneUuid ?? "");
    await this.setOverlayVisibilityForScenes([finalSceneName], true);
    console.log(`[WorshipOBS] ✓ Scene-based overlay ready: "${overlaySceneName}" → "${finalSceneName}"`);
    return { sceneName: finalSceneName, sceneItemId: this.sceneItemId! };
  }

  /** Create a background source behind the text overlay */
  private async ensureBgSource(sceneName: string, sceneUuid: string | null): Promise<void> {
    if (!obsService.isConnected) return;
    const canvas = await this.getCanvasSize();
    try {
      const resp = await obsService.call("GetSceneItemList", { sceneName });
      const items = (resp as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> }).sceneItems ?? [];
      const existing = items.find((item) => item.sourceName === WORSHIP_BG_SOURCE_NAME);
      if (existing) {
        this.bgSceneItemId = existing.sceneItemId;
        try {
          await obsService.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: existing.sceneItemId,
            sceneItemEnabled: true,
          });
        } catch {
          // Ignore scene-item enable failures; source still exists.
        }
        // Detect current kind from the input type
        try {
          const resp2 = await obsService.call("GetInputSettings", { inputName: WORSHIP_BG_SOURCE_NAME }) as {
            inputKind: string;
          };
          this._currentBgKind = resp2.inputKind === "image_source" ? "image" : "color";
        } catch {
          this._currentBgKind = "color";
        }
        await this.enforceBgPlacement(sceneName, existing.sceneItemId);
        return;
      }
    } catch { /* ok */ }

    const defaultColor = 0xFF000000; // opaque black
    try {
      const bgItemId = await obsService.createInput(
        sceneName, WORSHIP_BG_SOURCE_NAME, "color_source_v3",
        { color: defaultColor, width: canvas.width, height: canvas.height }
      );
      this.bgSceneItemId = bgItemId;
      this._currentBgKind = "color";
      const inputs = await obsService.getInputList();
      const bgInput = inputs.find((i) => i.inputName === WORSHIP_BG_SOURCE_NAME);
      if (bgInput) {
        await registerInput(SLOT_BG_INPUT, bgInput.inputUuid, WORSHIP_BG_SOURCE_NAME, "color_source_v3");
        await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, sceneUuid ?? "");
      }
      if (this.sceneItemId !== null) {
        try {
          const resp2 = await obsService.call("GetSceneItemList", { sceneName });
          const items2 = (resp2 as { sceneItems: Array<{ sceneItemId: number; sceneItemIndex: number }> }).sceneItems ?? [];
          const mainItem = items2.find((i) => i.sceneItemId === this.sceneItemId);
          if (mainItem) {
            await obsService.call("SetSceneItemIndex", {
              sceneName, sceneItemId: bgItemId,
              sceneItemIndex: Math.max(0, mainItem.sceneItemIndex - 1),
            });
          }
        } catch { /* ok */ }
      }
      await this.enforceBgPlacement(sceneName, bgItemId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("600")) {
        try {
          const bgItemId = await obsService.createSceneItem(sceneName, WORSHIP_BG_SOURCE_NAME);
          this.bgSceneItemId = bgItemId;
          this._currentBgKind = "color";
          await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, sceneUuid ?? "");
          await this.enforceBgPlacement(sceneName, bgItemId);
        } catch { /* ok */ }
      }
    }
  }

  private hexToObsColor(hex: string, opacity = 1): number {
    const clean = hex.replace("#", "");
    let r = 0, g = 0, b = 0;
    if (clean.length >= 6) {
      r = parseInt(clean.substring(0, 2), 16);
      g = parseInt(clean.substring(2, 4), 16);
      b = parseInt(clean.substring(4, 6), 16);
    }
    const a = Math.round(opacity * 255);
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

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
    if (hash === this._lastBgImageHash && this._lastBgImagePath) {
      return this._lastBgImagePath;
    }

    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) throw new Error("Invalid data URL — no comma found");

    const header = dataUrl.substring(0, commaIdx);
    const base64Data = dataUrl.substring(commaIdx + 1);

    const mimeMatch = header.match(/data:image\/(\w+)/);
    const ext = mimeMatch ? mimeMatch[1].replace("jpeg", "jpg") : "png";
    const fileName = `bg_${hash}.${ext}`;

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const absolutePath = await invoke<string>("save_bg_image", {
      fileName,
      fileData: Array.from(bytes),
    });

    this._lastBgImageHash = hash;
    this._lastBgImagePath = absolutePath;
    console.log(`[WorshipOBS] BG image saved to disk: ${absolutePath}`);
    return absolutePath;
  }

  /**
   * Recreate the BG source with a different OBS source type.
   */
  private async recreateBgSource(
    sceneName: string,
    kind: "color" | "image",
    settings: Record<string, unknown>
  ): Promise<void> {
    const canvas = await this.getCanvasSize();
    if (this.bgSceneItemId !== null) {
      try {
        await obsService.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: this.bgSceneItemId,
        });
      } catch { /* might already be gone */ }
      this.bgSceneItemId = null;
    }

    try {
      await obsService.call("RemoveInput", { inputName: WORSHIP_BG_SOURCE_NAME });
    } catch { /* might not exist */ }

    const inputKind = kind === "image" ? "image_source" : "color_source_v3";

    try {
      const bgItemId = await obsService.createInput(
        sceneName,
        WORSHIP_BG_SOURCE_NAME,
        inputKind,
        { ...settings, width: canvas.width, height: canvas.height }
      );
      this.bgSceneItemId = bgItemId;
      this._currentBgKind = kind;

      const inputs = await obsService.getInputList();
      const bgInput = inputs.find((i) => i.inputName === WORSHIP_BG_SOURCE_NAME);
      if (bgInput) {
        await registerInput(SLOT_BG_INPUT, bgInput.inputUuid, WORSHIP_BG_SOURCE_NAME, inputKind);
        const regScene = await getSceneBySlot(SLOT_SCENE);
        await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, regScene?.sceneUuid ?? "");
      }

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
      await this.enforceBgPlacement(sceneName, bgItemId);

      console.log(`[WorshipOBS] Recreated BG source as ${inputKind} (itemId: ${bgItemId})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("600")) {
        await obsService.call("SetInputSettings", {
          inputName: WORSHIP_BG_SOURCE_NAME,
          inputSettings: settings,
        });
        try {
          const bgItemId = await obsService.createSceneItem(sceneName, WORSHIP_BG_SOURCE_NAME);
          this.bgSceneItemId = bgItemId;
          this._currentBgKind = kind;
          await registerSceneItem(SLOT_BG_ITEM, SLOT_SCENE, SLOT_BG_INPUT, bgItemId, "");
          await this.enforceBgPlacement(sceneName, bgItemId);
        } catch { /* ok */ }
      } else {
        console.warn("[WorshipOBS] Failed to recreate BG source:", err);
      }
    }
  }

  /**
   * Push a worship slide to OBS.
   * Converts worship slide data to BibleSlide format for the shared overlay.
   */
  async pushSlide(
    text: string | null,
    reference: string,
    theme: BibleThemeSettings | null,
    live: boolean,
    blanked: boolean
  ): Promise<void> {
    this._liveText = text;
    this._liveRef = reference;
    this._liveTheme = theme;
    this._isLive = live;
    this._isBlanked = blanked;

    if (!obsService.isConnected) return;

    if (this.sceneItemId === null) {
      try {
        await this.ensureBrowserSource();
      } catch (err) {
        console.warn("[WorshipOBS] Failed to auto-create source:", err);
        return;
      }
    }

    // Convert to BibleSlide format (shared overlay)
    const slide: BibleSlide | null = text
      ? { id: "worship-live", text, reference, verseRange: "", index: 0, total: 1 }
      : null;

    try {
      const { themeForHash, customCss } = this.buildThemePayload(theme);

      const packet = { slide, theme: themeForHash, live, blanked, timestamp: Date.now() };
      const encoded = encodeURIComponent(JSON.stringify(packet));
      const base = getOverlayBaseUrlSync();
      const url = `${base}/bible-overlay-fullscreen.html#data=${encoded}`;

      const inputSettings: Record<string, unknown> = { url };
      inputSettings.css = customCss || "";

      let resolvedInputName = WORSHIP_SOURCE_NAME;
      const regInput = await getInputBySlot(SLOT_INPUT);
      if (regInput) {
        const inputs = await obsService.getInputList();
        const found = inputs.find((i) => i.inputUuid === regInput.inputUuid);
        if (found) resolvedInputName = found.inputName;
      }

      await obsService.call("SetInputSettings", { inputName: resolvedInputName, inputSettings });

      // Keep BG layered correctly even when OBS item order was changed manually.
      // BG source lives inside the overlay scene, not the target scene
      if (this.bgSceneItemId !== null) {
        await this.enforceBgPlacement(WORSHIP_SCENE_NAME, this.bgSceneItemId);
      }

      // ── Push BG source — fingerprint-based dedup ──
      if (theme) {
        try {
          const hasImage = !!(theme.backgroundImage && theme.backgroundImage.startsWith("data:"));
          const bgFingerprint = hasImage
            ? `image:${this._simpleHash(theme.backgroundImage)}`
            : `color:${(theme.backgroundColor || "#000000").toLowerCase()}:${theme.backgroundOpacity ?? 1}`;

          if (bgFingerprint !== this._lastBgFingerprint) {
            // BG source lives inside the overlay scene, not the target scene
            const bgSceneName = WORSHIP_SCENE_NAME;

            if (hasImage) {
              // ── IMAGE BACKGROUND ──
              const filePath = await this.saveBgImageToDisk(theme.backgroundImage);

              if (this._currentBgKind !== "image") {
                await this.recreateBgSource(bgSceneName, "image", { file: filePath });
              } else {
                let resolvedBgName = WORSHIP_BG_SOURCE_NAME;
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
                await this.recreateBgSource(bgSceneName, "color", { color: obsColor });
              } else if (this.bgSceneItemId !== null) {
                let resolvedBgName = WORSHIP_BG_SOURCE_NAME;
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
                await this.ensureBgSource(bgSceneName, null);
                this._currentBgKind = "color";
              }
            }

            this._lastBgFingerprint = bgFingerprint;
            console.log(`[WorshipOBS] BG updated → ${bgFingerprint}`);
          }
        } catch (bgErr) {
          console.warn("[WorshipOBS] Failed to update BG:", bgErr);
        }
      }
    } catch (err) {
      console.warn("[WorshipOBS] Failed to push slide:", err);
    }
  }

  async clearOverlay(sceneNames?: string[]): Promise<void> {
    this._liveText = null;
    this._liveRef = null;
    this._isLive = false;
    this._isBlanked = false;

    if (!obsService.isConnected) return;

    let targets = sceneNames?.filter(Boolean) ?? [];
    if (targets.length === 0) {
      try {
        const scenes = await obsService.getSceneList();
        targets = scenes.map((scene) => scene.sceneName);
      } catch {
        targets = [];
      }
    }

    await this.setOverlayVisibilityForScenes(targets, false);
  }

  async show(): Promise<void> {
    if (!obsService.isConnected || !this.currentSceneName || !this.sceneItemId) return;
    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName: this.currentSceneName,
        sceneItemId: this.sceneItemId,
        sceneItemEnabled: true,
      });
    } catch (err) {
      console.error("[WorshipOBS] Failed to show:", err);
    }
  }

  async hide(): Promise<void> {
    if (!obsService.isConnected || !this.currentSceneName || !this.sceneItemId) return;
    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName: this.currentSceneName,
        sceneItemId: this.sceneItemId,
        sceneItemEnabled: false,
      });
    } catch (err) {
      console.error("[WorshipOBS] Failed to hide:", err);
    }
  }

  getState() {
    return {
      sourceName: WORSHIP_SOURCE_NAME,
      sceneName: this.currentSceneName,
      sceneItemId: this.sceneItemId,
      isSetup: this.sceneItemId !== null,
    };
  }
}

export const worshipObsService = new WorshipObsService();
