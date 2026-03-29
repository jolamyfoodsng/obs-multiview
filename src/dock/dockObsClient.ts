/**
 * dockObsClient.ts — Lightweight OBS WebSocket client for the dock page.
 *
 * The dock runs in OBS's embedded CEF browser (or a separate browser tab),
 * which is a different process from the main Tauri app. BroadcastChannel
 * does NOT work cross-process, so the dock must talk to OBS directly.
 *
 * Strategy (dedicated overlay scenes):
 *   1. Connect to OBS WebSocket.
 *   2. Bible / Worship fullscreen: create a dedicated scene
 *      (e.g. "⛪ OCS Bible") containing the background + browser overlay
 *      sources. Then add that scene as a nested "scene source" into the
 *      user's current Preview or Program scene.
 *   3. Lower-thirds / Ticker: create a browser source directly in the
 *      user's scene (overlays are lightweight, no BG needed).
 *   4. "Send to Preview" → Auto-enable Studio Mode if off, then push
 *      overlay to Preview scene. Hide overlay in Program to prevent
 *      the global URL update from leaking across.
 *   5. "Go Live"         → push overlay to the current Program scene.
 *      Hide overlay in Preview to prevent cross-contamination.
 *   6. "Clear"           → blank / hide the overlay source.
 *
 * Connection params are resolved in this order:
 *   1. URL query params: ?obsUrl=ws://...&obsPassword=...
 *   2. localStorage key "mv-settings" (works if same origin)
 *   3. Default: ws://localhost:4455 with no password
 */

import OBSWebSocket from "obs-websocket-js";
import { ALL_THEMES, type ThemeLike } from "../lowerthirds/themes";
import { getWorshipLTFavorites } from "../services/favoriteThemes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DockObsStatus = "disconnected" | "connecting" | "connected" | "error";

type StatusCallback = (status: DockObsStatus, error?: string) => void;

/** A minimal theme shape used by the dock for lower-third overlays */
export interface DockLTThemeRef {
  id: string;
  html: string;
  css: string;
}

/** Source names the dock creates as overlays in the user's scenes */
const DOCK_LT_SOURCE = "⛪ OCS Lower Third";
const DOCK_BIBLE_SOURCE = "⛪ OCS Bible Overlay";
const DOCK_WORSHIP_SOURCE = "⛪ OCS Worship Lyrics";
const DOCK_TICKER_SOURCE = "⛪ OCS Ticker";
const DOCK_PREVIEW_LT_SOURCE = "⛪ OCS Preview Lower Third";
const DOCK_PREVIEW_BIBLE_SOURCE = "⛪ OCS Preview Bible Overlay";
const DOCK_PREVIEW_WORSHIP_SOURCE = "⛪ OCS Preview Worship Lyrics";
const DOCK_PREVIEW_TICKER_SOURCE = "⛪ OCS Preview Ticker";
/** Media player source for playing uploaded/library media */
const DOCK_MEDIA_VIDEO_SOURCE = "⛪ OCS Media Video";
const DOCK_MEDIA_IMAGE_SOURCE = "⛪ OCS Media Image";
const DOCK_PREVIEW_MEDIA_VIDEO_SOURCE = "⛪ OCS Preview Media Video";
const DOCK_PREVIEW_MEDIA_IMAGE_SOURCE = "⛪ OCS Preview Media Image";
/** Background source placed BEHIND fullscreen overlays to prevent flash/twitch between slides */
const DOCK_FS_BG_SOURCE = "⛪ OCS Fullscreen BG";
const DOCK_PREVIEW_FS_BG_SOURCE = "⛪ OCS Preview Fullscreen BG";
/** Scene-local fullscreen background source prefix used in Preview/Program target scenes */
const DOCK_FS_TARGET_BG_PREFIX = "⛪ OCS Fullscreen Scene BG";
const DOCK_PREVIEW_FS_TARGET_BG_PREFIX = "⛪ OCS Preview Fullscreen Scene BG";
/** Dedicated OBS scenes that hold the overlay sources in isolation */
const DOCK_BIBLE_SCENE = "⛪ OCS Bible";
const DOCK_WORSHIP_SCENE = "⛪ OCS Worship";
const DOCK_PREVIEW_BIBLE_SCENE = "⛪ OCS Preview Bible";
const DOCK_PREVIEW_WORSHIP_SCENE = "⛪ OCS Preview Worship";
const DOCK_PREVIEW_STAGE_SUFFIX = "__OCS_Dock_Preview";

interface DockResourceNames {
  ltSource: string;
  bibleSource: string;
  worshipSource: string;
  tickerSource: string;
  mediaVideoSource: string;
  mediaImageSource: string;
  fsBgSource: string;
  fsTargetBgPrefix: string;
  bibleScene: string;
  worshipScene: string;
}

const LIVE_DOCK_RESOURCES: DockResourceNames = {
  ltSource: DOCK_LT_SOURCE,
  bibleSource: DOCK_BIBLE_SOURCE,
  worshipSource: DOCK_WORSHIP_SOURCE,
  tickerSource: DOCK_TICKER_SOURCE,
  mediaVideoSource: DOCK_MEDIA_VIDEO_SOURCE,
  mediaImageSource: DOCK_MEDIA_IMAGE_SOURCE,
  fsBgSource: DOCK_FS_BG_SOURCE,
  fsTargetBgPrefix: DOCK_FS_TARGET_BG_PREFIX,
  bibleScene: DOCK_BIBLE_SCENE,
  worshipScene: DOCK_WORSHIP_SCENE,
};

const PREVIEW_DOCK_RESOURCES: DockResourceNames = {
  ltSource: DOCK_PREVIEW_LT_SOURCE,
  bibleSource: DOCK_PREVIEW_BIBLE_SOURCE,
  worshipSource: DOCK_PREVIEW_WORSHIP_SOURCE,
  tickerSource: DOCK_PREVIEW_TICKER_SOURCE,
  mediaVideoSource: DOCK_PREVIEW_MEDIA_VIDEO_SOURCE,
  mediaImageSource: DOCK_PREVIEW_MEDIA_IMAGE_SOURCE,
  fsBgSource: DOCK_PREVIEW_FS_BG_SOURCE,
  fsTargetBgPrefix: DOCK_PREVIEW_FS_TARGET_BG_PREFIX,
  bibleScene: DOCK_PREVIEW_BIBLE_SCENE,
  worshipScene: DOCK_PREVIEW_WORSHIP_SCENE,
};

function getDockResources(live: boolean): DockResourceNames {
  return live ? LIVE_DOCK_RESOURCES : PREVIEW_DOCK_RESOURCES;
}

function getAllDockResources(): DockResourceNames[] {
  return [LIVE_DOCK_RESOURCES, PREVIEW_DOCK_RESOURCES];
}

// ---------------------------------------------------------------------------
// Built-in lower-third theme (embedded so dock works without the main app)
// ---------------------------------------------------------------------------

const DEFAULT_LT_THEME = {
  id: "dock-default-lt",
  html: `<div class="lt pos-bl in-up">
  <div class="panel speaker-panel" style="--bg:rgba(18,18,24,.92);--fg:#fff;--accent:#6c63ff;--bd:rgba(255,255,255,.12);">
    <div class="v-divider"></div>
    <div class="col">
      <p class="name-line">{{name}}</p>
      <p class="role-line">{{role}}</p>
    </div>
  </div>
</div>`,
  css: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.lt { position: fixed; z-index: 40; pointer-events: none; }
.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }

.pos-bl { left: 40px; bottom: 32px; }

.panel {
  background: var(--bg, rgba(18,18,24,.92));
  color: var(--fg, #fff);
  border: 1px solid var(--bd, rgba(255,255,255,.12));
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.28);
  backdrop-filter: blur(12px);
}

.col { display: flex; flex-direction: column; min-width: 0; }

.speaker-panel {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 420px;
  max-width: min(900px, calc(100vw - 80px));
  padding: 20px 28px;
}

.v-divider {
  width: 5px;
  min-width: 5px;
  height: 72px;
  border-radius: 2px;
  background: var(--accent, #6c63ff);
}

.name-line {
  font-size: clamp(28px, 2.2vw, 52px);
  font-weight: 700;
  line-height: 1.1;
}

.role-line {
  margin-top: 6px;
  font-size: clamp(18px, 1.4vw, 32px);
  font-weight: 400;
  line-height: 1.2;
  opacity: .8;
}`,
};

function normalizeThemeToken(value: string): string {
  return value.trim().toLowerCase();
}

function cleanWorshipObsLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed && !/^verse\s+\d+$/i.test(trimmed) ? trimmed : "";
}

function isLikelyCustomTheme(theme: ThemeLike): boolean {
  const signature = `${theme.id} ${theme.name || ""} ${(theme.tags || []).join(" ")} ${theme.category || ""}`.toLowerCase();
  return signature.includes("custom") || signature.includes("user");
}

function matchesThemeHints(theme: ThemeLike, hints: string[]): boolean {
  if (hints.length === 0) return true;

  const tagList = (theme.tags || []).map(normalizeThemeToken);
  const signature = `${theme.id} ${theme.name || ""} ${theme.category || ""} ${tagList.join(" ")}`.toLowerCase();

  return hints.some((hint) => {
    if (!hint) return false;
    if (signature.includes(hint)) return true;
    return tagList.some((tag) => tag === hint || tag.includes(hint) || hint.includes(tag));
  });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class DockObsClient {
  private obs = new OBSWebSocket();
  private _status: DockObsStatus = "disconnected";
  private _error = "";
  private listeners = new Set<StatusCallback>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _url = "ws://localhost:4455";
  private _password: string | undefined;
  /** Track last overlay mode per source so we can force-reload when switching HTML files */
  private _lastOverlayMode: Record<string, string> = {};
  /** Guard: only the current OBS instance can change status */
  private _obsGeneration = 0;

  /** Cached branding data loaded from the dock JSON file */
  private _brandingCache: { logoFileName: string; brandColor: string; churchName: string } | null = null;
  /** Cache scene-local fullscreen background payloads so repeated slide pushes do not reload them */
  private _lastTargetBgSignature: Record<string, string> = {};
  /** Cache fullscreen browser-source config so verse changes do not force source reloads */
  private _lastFullscreenSourceSignature: Record<string, string> = {};

  get status() { return this._status; }
  get isConnected() { return this._status === "connected"; }
  get error() { return this._error; }
  get url() { return this._url; }

  constructor() {
    // Load branding settings from dock JSON file (fire-and-forget)
    this._loadBranding();
  }

  // ── Branding ──

  /** Load branding from the dock JSON file served by the overlay server */
  private async _loadBranding(): Promise<void> {
    try {
      const res = await fetch("/uploads/dock-branding.json");
      if (!res.ok) return;
      const data = await res.json();
      this._brandingCache = {
        logoFileName: data.brandLogoFileName || "",
        brandColor: data.brandColor || "",
        churchName: data.churchName || "",
      };
      console.log("[DockOBS] Loaded branding:", this._brandingCache);
    } catch {
      // Branding file doesn't exist yet or server not ready — ignore
    }
  }

  /** Get the resolved logo URL for lower-third overlays */
  private _getLogoUrl(): string {
    if (!this._brandingCache?.logoFileName) return "";
    return `${window.location.origin}/uploads/${encodeURIComponent(this._brandingCache.logoFileName)}`;
  }

  // ── Status ──

  private setStatus(s: DockObsStatus, error = "") {
    this._status = s;
    this._error = error;
    this.listeners.forEach((cb) => cb(s, error));
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── Resolve connection params ──

  private resolveParams(url?: string, password?: string) {
    if (url) {
      this._url = url;
      this._password = password;
      return;
    }

    // 1. URL query params
    try {
      const params = new URLSearchParams(window.location.search);
      const qUrl = params.get("obsUrl");
      const qPw = params.get("obsPassword");
      if (qUrl) {
        this._url = qUrl;
        this._password = qPw || undefined;
        console.log("[DockOBS] Using connection from URL params:", this._url);
        return;
      }
    } catch { /* ignore */ }

    // 2. localStorage
    try {
      const stored = localStorage.getItem("mv-settings");
      if (stored) {
        const s = JSON.parse(stored);
        if (s.obsUrl) {
          this._url = s.obsUrl;
          this._password = s.obsPassword || undefined;
          console.log("[DockOBS] Using connection from localStorage:", this._url);
          return;
        }
      }
    } catch { /* ignore */ }

    // 3. Default
    this._url = "ws://localhost:4455";
    this._password = undefined;
    console.log("[DockOBS] Using default connection:", this._url);
  }

  // ── Connection ──

  async connect(url?: string, password?: string) {
    this.resolveParams(url, password);

    if (this._status === "connecting") return;
    this.setStatus("connecting");

    // Increment generation — any callbacks from a prior OBS instance are stale
    const gen = ++this._obsGeneration;

    // Disconnect old instance before creating a new one
    try { await this.obs.disconnect(); } catch { /* ignore */ }

    try {
      this.obs = new OBSWebSocket();

      // Guard: only fire status changes if this is still the current generation
      this.obs.on("ConnectionClosed", () => {
        if (this._obsGeneration !== gen) return; // stale instance — ignore
        this.setStatus("disconnected", "Connection closed");
        this.scheduleReconnect();
      });
      this.obs.on("ConnectionError" as never, () => {
        if (this._obsGeneration !== gen) return; // stale instance — ignore
        this.setStatus("error", "Connection error");
        this.scheduleReconnect();
      });

      const result = await Promise.race([
        this.obs.connect(this._url, this._password, { rpcVersion: 1 }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("Connection timed out (5s)")), 5000)
        ),
      ]);

      // Verify this connect attempt is still the current one
      if (this._obsGeneration !== gen) return;

      console.log("[DockOBS] Connected, RPC:", (result as { negotiatedRpcVersion: number }).negotiatedRpcVersion);
      this.setStatus("connected");
    } catch (err) {
      if (this._obsGeneration !== gen) return; // stale — ignore
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[DockOBS] Connect failed:", msg);
      this.setStatus("error", msg);
      this.scheduleReconnect();
    }
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { await this.obs.disconnect(); } catch { /* ignore */ }
    this.setStatus("disconnected");
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._status !== "connected") {
        await this.connect(this._url, this._password);
      }
    }, 5000);
  }

  // ── OBS API helpers ──

  async call(requestType: string, requestData?: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected) throw new Error("Not connected to OBS");
    return this.obs.call(requestType as never, requestData as never);
  }

  // ── Scene helpers ──

  /**
   * Get the target scene name.
   *   live=true  → current Program scene
   *   live=false → current Preview scene (Studio Mode).
   *               If Studio Mode is off, auto-enables it so that
   *               "Send to Preview" NEVER touches Program.
   *
   * Returns { sceneName, studioMode }.
   */
  private async getTargetScene(live: boolean): Promise<{ sceneName: string; studioMode: boolean }> {
    if (live) {
      const resp = await this.call("GetCurrentProgramScene") as { currentProgramSceneName: string; sceneName?: string };
      return { sceneName: resp.currentProgramSceneName || resp.sceneName || "", studioMode: false };
    }

    // Try preview first (Studio Mode)
    try {
      const sm = await this.call("GetStudioModeEnabled") as { studioModeEnabled: boolean };
      if (sm.studioModeEnabled) {
        const resp = await this.call("GetCurrentPreviewScene") as { currentPreviewSceneName: string; sceneName?: string };
        return { sceneName: resp.currentPreviewSceneName || resp.sceneName || "", studioMode: true };
      }
    } catch { /* Studio Mode not available */ }

    // Studio Mode is OFF — auto-enable it so Preview ≠ Program.
    // Without Studio Mode, "Send to Preview" would fall back to
    // Program which is exactly the bug we're preventing.
    try {
      await this.call("SetStudioModeEnabled", { studioModeEnabled: true });
      console.log("[DockOBS] Auto-enabled Studio Mode for Send to Preview");

      // Give OBS a moment to set up Preview after enabling Studio Mode
      await new Promise((r) => setTimeout(r, 150));

      const resp = await this.call("GetCurrentPreviewScene") as { currentPreviewSceneName: string; sceneName?: string };
      return { sceneName: resp.currentPreviewSceneName || resp.sceneName || "", studioMode: true };
    } catch (err) {
      console.warn("[DockOBS] Failed to auto-enable Studio Mode:", err);
    }

    // Absolute fallback — should not be reached
    const resp = await this.call("GetCurrentProgramScene") as { currentProgramSceneName: string; sceneName?: string };
    return { sceneName: resp.currentProgramSceneName || resp.sceneName || "", studioMode: false };
  }

  private isDockManagedSourceName(sourceName: string): boolean {
    const managedNames = new Set([
      LIVE_DOCK_RESOURCES.ltSource,
      LIVE_DOCK_RESOURCES.bibleSource,
      LIVE_DOCK_RESOURCES.worshipSource,
      LIVE_DOCK_RESOURCES.tickerSource,
      LIVE_DOCK_RESOURCES.mediaVideoSource,
      LIVE_DOCK_RESOURCES.mediaImageSource,
      LIVE_DOCK_RESOURCES.fsBgSource,
      LIVE_DOCK_RESOURCES.bibleScene,
      LIVE_DOCK_RESOURCES.worshipScene,
      PREVIEW_DOCK_RESOURCES.ltSource,
      PREVIEW_DOCK_RESOURCES.bibleSource,
      PREVIEW_DOCK_RESOURCES.worshipSource,
      PREVIEW_DOCK_RESOURCES.tickerSource,
      PREVIEW_DOCK_RESOURCES.mediaVideoSource,
      PREVIEW_DOCK_RESOURCES.mediaImageSource,
      PREVIEW_DOCK_RESOURCES.fsBgSource,
      PREVIEW_DOCK_RESOURCES.bibleScene,
      PREVIEW_DOCK_RESOURCES.worshipScene,
    ]);

    return (
      managedNames.has(sourceName) ||
      sourceName.startsWith(LIVE_DOCK_RESOURCES.fsTargetBgPrefix) ||
      sourceName.startsWith(PREVIEW_DOCK_RESOURCES.fsTargetBgPrefix) ||
      sourceName.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)
    );
  }

  private getPreviewStagingSceneName(sceneName: string): string {
    const trimmed = sceneName.trim() || "Scene";
    return `${trimmed}${DOCK_PREVIEW_STAGE_SUFFIX}`;
  }

  private async ensurePreviewTargetScene(previewSceneName: string): Promise<string> {
    const { sceneName: programSceneName } = await this.getTargetScene(true);
    if (
      !previewSceneName.trim() ||
      !programSceneName.trim() ||
      previewSceneName !== programSceneName
    ) {
      return previewSceneName;
    }

    const stagingSceneName = this.getPreviewStagingSceneName(programSceneName);
    await this.syncPreviewStagingScene(programSceneName, stagingSceneName);
    try {
      await this.call("SetCurrentPreviewScene", { sceneName: stagingSceneName });
    } catch { /* ignore */ }
    return stagingSceneName;
  }

  private async syncPreviewStagingScene(sourceSceneName: string, stagingSceneName: string): Promise<void> {
    await this.ensureDedicatedScene(stagingSceneName);

    try {
      const existing = await this.call("GetSceneItemList", { sceneName: stagingSceneName }) as {
        sceneItems: Array<{ sceneItemId: number }>;
      };
      for (const item of existing.sceneItems) {
        try {
          await this.call("RemoveSceneItem", {
            sceneName: stagingSceneName,
            sceneItemId: item.sceneItemId,
          });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    const sourceResp = await this.call("GetSceneItemList", { sceneName: sourceSceneName }) as {
      sceneItems: Array<{
        sourceName: string;
        sceneItemId: number;
        sceneItemIndex: number;
        sceneItemEnabled?: boolean;
      }>;
    };

    const sourceItems = sourceResp.sceneItems
      .filter((item) => !this.isDockManagedSourceName(item.sourceName))
      .sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);

    const cloned: Array<{ sceneItemId: number; sceneItemIndex: number }> = [];

    for (const item of sourceItems) {
      try {
        const created = await this.call("CreateSceneItem", {
          sceneName: stagingSceneName,
          sourceName: item.sourceName,
          sceneItemEnabled: item.sceneItemEnabled ?? true,
        }) as { sceneItemId: number };

        cloned.push({
          sceneItemId: created.sceneItemId,
          sceneItemIndex: item.sceneItemIndex,
        });

        try {
          const transformResp = await this.call("GetSceneItemTransform", {
            sceneName: sourceSceneName,
            sceneItemId: item.sceneItemId,
          }) as { sceneItemTransform?: Record<string, unknown> } & Record<string, unknown>;
          const transform = transformResp.sceneItemTransform ?? transformResp;
          await this.call("SetSceneItemTransform", {
            sceneName: stagingSceneName,
            sceneItemId: created.sceneItemId,
            sceneItemTransform: transform,
          });
        } catch { /* ignore */ }
      } catch (err) {
        console.warn(`[DockOBS] Failed to clone scene item "${item.sourceName}" into preview staging scene:`, err);
      }
    }

    for (const item of cloned) {
      try {
        await this.call("SetSceneItemIndex", {
          sceneName: stagingSceneName,
          sceneItemId: item.sceneItemId,
          sceneItemIndex: item.sceneItemIndex,
        });
      } catch { /* ignore */ }
    }
  }

  // ── Source provisioning ──

  /**
   * Ensure a browser source exists in the given scene.
   * If it doesn't exist, create it and position at (0,0) fullscreen.
   * Then move it to the TOP of the z-order so it acts as an overlay.
   * Returns the sceneItemId.
   */
  private async ensureOverlaySource(
    sceneName: string,
    sourceName: string,
    width = 1920,
    height = 1080,
    enable = true,
  ): Promise<number> {
    // 1. Check if the source already exists in this scene
    const resp = await this.call("GetSceneItemList", { sceneName }) as {
      sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
    };

    let sceneItemId: number | null = null;
    const existing = resp.sceneItems.find((i) => i.sourceName === sourceName);

    if (existing) {
      sceneItemId = existing.sceneItemId;
    } else {
      // 2. Check if the input already exists globally (from another scene)
      let inputExists = false;
      try {
        const inputs = await this.call("GetInputList") as {
          inputs: Array<{ inputName: string; inputKind: string }>;
        };
        inputExists = inputs.inputs.some((i) => i.inputName === sourceName);
      } catch { /* ignore */ }

      if (inputExists) {
        // Add existing input as a scene item reference
        const created = await this.call("CreateSceneItem", {
          sceneName,
          sourceName,
          sceneItemEnabled: true,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
        console.log(`[DockOBS] Added existing source "${sourceName}" to scene "${sceneName}" (itemId ${sceneItemId})`);
      } else {
        // Create brand new browser source
        const created = await this.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind: "browser_source",
          inputSettings: {
            url: "about:blank",
            width,
            height,
            css: "",
            shutdown: false,
            restart_when_active: false,
          },
          sceneItemEnabled: true,
        }) as { sceneItemId: number };
        sceneItemId = created.sceneItemId;
        console.log(`[DockOBS] Created browser source "${sourceName}" in scene "${sceneName}" (itemId ${sceneItemId})`);
      }

      // Position at (0,0) fullscreen
      try {
        await this.call("SetSceneItemTransform", {
          sceneName,
          sceneItemId,
          sceneItemTransform: {
            positionX: 0,
            positionY: 0,
            boundsType: "OBS_BOUNDS_SCALE_INNER",
            boundsWidth: width,
            boundsHeight: height,
          },
        });
      } catch (err) {
        console.warn(`[DockOBS] Failed to set transform for "${sourceName}":`, err);
      }
    }

    // 3. Move to top of z-order.
    // In OBS, larger scene-item indices are higher in the Sources stack.
    try {
      const updated = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };
      const topIndex = Math.max(0, updated.sceneItems.length - 1);
      const currentItem = updated.sceneItems.find((i) => i.sceneItemId === sceneItemId);
      if (currentItem && currentItem.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId,
          sceneItemIndex: topIndex,
        });
        console.log(`[DockOBS] Moved "${sourceName}" to top (index ${topIndex})`);
      }
    } catch (err) {
      console.warn(`[DockOBS] Failed to reorder "${sourceName}":`, err);
    }

    // 4. Make sure it's enabled/visible (only if requested)
    if (enable) {
      try {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: sceneItemId!,
          sceneItemEnabled: true,
        });
      } catch { /* ignore */ }
    }

    return sceneItemId!;
  }

  // ── Dedicated overlay scene management ──

  /**
   * Ensure a dedicated OBS scene exists for an overlay type.
   * The scene contains the overlay's browser source + background source,
   * kept in isolation from the user's own scenes.
   *
   * @returns the scene name (already existing or freshly created)
   */
  private async ensureDedicatedScene(dedicatedSceneName: string): Promise<string> {
    try {
      const resp = await this.call("GetSceneList") as {
        scenes: Array<{ sceneName: string; sceneIndex: number }>;
      };
      const exists = resp.scenes.some((s) => s.sceneName === dedicatedSceneName);
      if (!exists) {
        await this.call("CreateScene", { sceneName: dedicatedSceneName });
        console.log(`[DockOBS] Created dedicated scene "${dedicatedSceneName}"`);
      }
    } catch (err) {
      // Scene might already exist — OBS returns error code 601
      console.warn(`[DockOBS] ensureDedicatedScene "${dedicatedSceneName}":`, err);
    }
    return dedicatedSceneName;
  }

  private getTargetFullscreenBgSourceName(
    sceneName: string,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): string {
    const normalized = sceneName.replace(/\s+/g, " ").trim() || "Scene";
    return `${resources.fsTargetBgPrefix} - ${normalized}`;
  }

  /**
   * Add a dedicated overlay scene as a nested "scene source" into the
   * user's target scene, positioned fullscreen on top.
   *
   * This means the user's scene references our dedicated scene, which in
   * turn contains the browser source + background. Updating the browser
   * source URL happens inside the dedicated scene — the user's scene just
   * shows it through the scene reference.
   *
   * @param targetScene  The user's scene (Preview or Program)
   * @param dedicatedScene  Our dedicated scene (e.g. "⛪ OCS Bible")
   * @param enable  Whether to enable (show) the scene source
   */
  private async ensureSceneSourceInTarget(
    targetScene: string,
    dedicatedScene: string,
    enable: boolean,
  ): Promise<number> {
    // Check if the dedicated scene already exists as a source in the target
    const resp = await this.call("GetSceneItemList", { sceneName: targetScene }) as {
      sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
    };
    let sceneItemId: number | null = null;
    const existing = resp.sceneItems.find((i) => i.sourceName === dedicatedScene);

    if (existing) {
      sceneItemId = existing.sceneItemId;
    } else {
      // Add the dedicated scene as a "scene source" (nested scene)
      const created = await this.call("CreateSceneItem", {
        sceneName: targetScene,
        sourceName: dedicatedScene,
        sceneItemEnabled: enable,
      }) as { sceneItemId: number };
      sceneItemId = created.sceneItemId;
      console.log(`[DockOBS] Added scene source "${dedicatedScene}" to "${targetScene}" (itemId ${sceneItemId})`);

      // Position fullscreen at (0,0)
      try {
        await this.call("SetSceneItemTransform", {
          sceneName: targetScene,
          sceneItemId,
          sceneItemTransform: {
            positionX: 0,
            positionY: 0,
            boundsType: "OBS_BOUNDS_SCALE_INNER",
            boundsWidth: 1920,
            boundsHeight: 1080,
          },
        });
      } catch { /* ignore */ }
    }

    // Move to top of z-order in the target scene.
    try {
      const updated = await this.call("GetSceneItemList", { sceneName: targetScene }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };
      const topIndex = Math.max(0, updated.sceneItems.length - 1);
      const currentItem = updated.sceneItems.find((i) => i.sceneItemId === sceneItemId);
      if (currentItem && currentItem.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName: targetScene,
          sceneItemId: sceneItemId!,
          sceneItemIndex: topIndex,
        });
      }
    } catch { /* ignore */ }

    // Enable/disable
    try {
      await this.call("SetSceneItemEnabled", {
        sceneName: targetScene,
        sceneItemId: sceneItemId!,
        sceneItemEnabled: enable,
      });
    } catch { /* ignore */ }

    return sceneItemId!;
  }

  /**
   * Hide a dedicated scene source in the given target scene.
   */
  private async hideSceneSource(targetScene: string, dedicatedScene: string): Promise<void> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName: targetScene }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const item = resp.sceneItems.find((i) => i.sourceName === dedicatedScene);
      if (item) {
        await this.call("SetSceneItemEnabled", {
          sceneName: targetScene,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: false,
        });
      }
    } catch { /* ignore */ }
  }

  /**
   * When sending to Preview (live=false), hide the overlay source/scene in
   * the Program scene so the global URL change doesn't show on Program.
   * When sending to Program (live=true), hide it in the Preview scene.
   *
   * This is critical because `SetInputSettings` (which sets the URL on a
   * browser source) is a GLOBAL operation — it updates the source in EVERY
   * scene that references it. So we must disable the source in the opposite
   * scene to prevent cross-contamination.
   */
  private async hideInOppositeScene(
    live: boolean,
    sourceNames: string[],
    dedicatedScenes: string[] = [],
    includeFullscreenTargetBg = false,
    targetSceneName?: string,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    try {
      // Get the OPPOSITE scene
      const { sceneName: oppositeScene } = await this.getTargetScene(!live);
      if (!oppositeScene) return;
      if (targetSceneName && oppositeScene === targetSceneName) {
        console.log(`[DockOBS] Skipping opposite-scene hide because "${oppositeScene}" is also the target scene`);
        return;
      }

      for (const src of sourceNames) {
        await this.hideOverlaySource(oppositeScene, src);
      }
      for (const ds of dedicatedScenes) {
        await this.hideSceneSource(oppositeScene, ds);
      }
      if (includeFullscreenTargetBg) {
        await this.hideFullscreenBg(oppositeScene, resources);
      }
    } catch { /* ignore */ }
  }

  private async removeSceneItemBySource(sceneName: string, sourceName: string): Promise<void> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const items = resp.sceneItems.filter((item) => item.sourceName === sourceName);
      for (const item of items) {
        await this.call("RemoveSceneItem", {
          sceneName,
          sceneItemId: item.sceneItemId,
        });
      }
    } catch { /* ignore */ }
  }

  private async removeInputIfExists(inputName: string): Promise<void> {
    try {
      await this.call("RemoveInput", { inputName });
    } catch { /* ignore */ }
  }

  private async removeSceneIfExists(sceneName: string): Promise<void> {
    try {
      await this.call("RemoveScene", { sceneName });
    } catch { /* ignore */ }
  }

  /**
   * Strip large data-URI fields from theme settings before URL encoding.
   *
   * `logoUrl` and `backgroundImage` data URIs can be 50 KB–500 KB+, which
   * blows past OBS / CEF URL length limits when JSON-stringified into the
   * URL hash fragment.  We replace them with sentinel values (e.g.
   * `__FROM_CSS__`) and inject them into the browser source via OBS's
   * `css` input-setting, where there is no length limit.
   *
   * The overlay HTML reads the CSS custom properties as a fallback.
   */
  private stripThemeDataUris(
    themeSettings: Record<string, unknown> | null | undefined,
  ): { cleanSettings: Record<string, unknown> | null; css: string } {
    if (!themeSettings) return { cleanSettings: null, css: "" };

    const clean = { ...themeSettings };
    const cssRules: string[] = [];

    // --- logoUrl ---
    const logoUrl = clean.logoUrl as string | undefined;
    if (logoUrl && logoUrl.startsWith("data:")) {
      cssRules.push(`--logo-data-uri: url(${logoUrl});`);
      clean.logoUrl = "__FROM_CSS__";
    }

    // --- backgroundImage ---
    const bgImage = clean.backgroundImage as string | undefined;
    if (bgImage && bgImage.startsWith("data:")) {
      // Deliver image data via OBS custom CSS so it works in the dock for
      // both fullscreen and lower-third themes without relying on a file path.
      cssRules.push(`--bg-image: url(${bgImage});`);
      clean.backgroundImage = "__FROM_CSS__";
    }

    // --- boxBackgroundImage ---
    const boxBgImage = clean.boxBackgroundImage as string | undefined;
    if (boxBgImage && boxBgImage.startsWith("data:")) {
      cssRules.push(`--box-bg-image: url(${boxBgImage});`);
      clean.boxBackgroundImage = "__FROM_CSS__";
    }

    const css = cssRules.length ? `:root { ${cssRules.join(" ")} }` : "";
    return { cleanSettings: clean, css };
  }

  /**
   * Update a browser source URL in OBS.
   * Optionally forces a reload by briefly blanking the source first,
   * which is needed when switching between different overlay HTML files
   * (e.g. fullscreen → lower-third) on the same source.
   *
   * @param css  Optional CSS to inject into the browser source via
   *             OBS `SetInputSettings`. Used to deliver large data URIs
   *             (logos, box backgrounds) that would exceed URL-hash limits.
   */
  private async setBrowserSourceUrl(inputName: string, url: string, forceReload = false, css?: string): Promise<void> {
    if (forceReload) {
      // Blank → wait → set new URL → forces OBS CEF to fully reload
      try {
        await this.call("SetInputSettings", { inputName, inputSettings: { url: "about:blank" } });
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const inputSettings: Record<string, unknown> = { url };
    if (css !== undefined) inputSettings.css = css;
    await this.call("SetInputSettings", {
      inputName,
      inputSettings,
    });
  }

  private buildFullscreenBackgroundUrl(
    themeSettings?: Record<string, unknown> | null,
  ): string {
    const packet = {
      theme: themeSettings ?? null,
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(packet));
    return `${this.getOverlayBaseUrl()}/bible-overlay-bg.html#data=${encoded}`;
  }

  private prepareDedicatedLowerThirdTheme(
    themeSettings: Record<string, unknown> | null | undefined,
  ): {
    overlayTheme: Record<string, unknown> | null;
    backgroundTheme: Record<string, unknown> | null;
  } {
    if (!themeSettings) {
      return { overlayTheme: null, backgroundTheme: null };
    }

    const source = { ...themeSettings };
    const bgColor = String(source.backgroundColor || "").trim().toLowerCase();
    const bgImage = String(source.backgroundImage || "").trim();
    const hasExplicitBackground =
      Boolean(bgImage) ||
      (Boolean(bgColor) &&
        bgColor !== "transparent" &&
        bgColor !== "#000" &&
        bgColor !== "#000000" &&
        bgColor !== "rgba(0,0,0,0)" &&
        bgColor !== "rgba(0, 0, 0, 0)");

    return {
      overlayTheme: {
        ...source,
        backgroundColor: "transparent",
        backgroundImage: "",
        backgroundOpacity: 1,
        fullscreenShadeEnabled: false,
        fullscreenShadeOpacity: 0,
      },
      backgroundTheme: hasExplicitBackground ? source : null,
    };
  }

  /**
   * Hide (disable) an overlay source in a scene, if it exists.
   */
  private async hideOverlaySource(sceneName: string, sourceName: string): Promise<void> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const item = resp.sceneItems.find((i) => i.sourceName === sourceName);
      if (item) {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: false,
        });
      }
    } catch { /* ignore */ }
  }

  // ── Fullscreen background source helpers ──

  /**
   * Ensure a fullscreen background source exists BEHIND the overlay source.
   * For image backgrounds → OBS `image_source`.
   * For solid colors → OBS `color_source_v3`.
   * The source is placed at z-index 0 (bottom) of the overlay stack so
   * that when the foreground browser source briefly blanks during URL
   * changes, the viewer sees the theme background instead of a flash.
   */
  private async ensureFullscreenBg(
    sceneName: string,
    themeSettings: Record<string, unknown> | null | undefined,
    enable = true,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    if (!themeSettings) return;

    const bgColor = (themeSettings.backgroundColor as string) || "#000000";
    const bgImage = (themeSettings.backgroundImage as string) || "";

    // Skip sentinel values that indicate the background is handled elsewhere
    if (bgImage === "__BG_SOURCE__" || bgImage === "__FROM_CSS__" || bgImage === "__FROM_LOCALSTORAGE__") {
      await this.hideFullscreenBg(sceneName, resources);
      return;
    }

    // Data-URI images are rendered directly inside the browser overlay via
    // injected CSS custom properties, so no separate OBS BG source is needed.
    if (bgImage.startsWith("data:")) {
      await this.hideFullscreenBg(sceneName, resources);
      return;
    }

    const hasImage = bgImage && !bgImage.startsWith("data:") && bgImage.startsWith("http");

    if (hasImage) {
      // Use an image_source
      await this._ensureBgImageSource(sceneName, bgImage, enable, resources);
    } else {
      // Use a color_source_v3 with the theme's backgroundColor
      await this._ensureBgColorSource(sceneName, bgColor, enable, resources);
    }
  }

  /**
   * Ensure the user's actual Preview/Program scene also contains a static
   * background layer behind the nested Bible/Worship scene source. This keeps
   * scene switches from briefly revealing the underlying camera/content.
   */
  private async ensureFullscreenTargetBg(
    targetScene: string,
    overlaySourceName: string,
    themeSettings: Record<string, unknown> | null | undefined,
    enable = true,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    if (!themeSettings) {
      await this.hideFullscreenBg(targetScene, resources);
      return;
    }

    const sourceName = this.getTargetFullscreenBgSourceName(targetScene, resources);
    const { cleanSettings, css } = this.stripThemeDataUris(themeSettings);
    const signature = JSON.stringify({
      theme: cleanSettings ?? null,
      css: css || "",
    });
    const url = this.buildFullscreenBackgroundUrl(cleanSettings);

    await this.ensureOverlaySource(targetScene, sourceName, 1920, 1080, enable);
    if (this._lastTargetBgSignature[sourceName] !== signature) {
      await this.setBrowserSourceUrl(sourceName, url, false, css || undefined);
      this._lastTargetBgSignature[sourceName] = signature;
    }
    await this._positionSceneLocalBgBelowSource(targetScene, sourceName, overlaySourceName);
  }

  /**
   * Create or update an OBS `image_source` for the fullscreen background.
   */
  private async _ensureBgImageSource(
    sceneName: string,
    imageUrl: string,
    enable: boolean,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    const sourceName = resources.fsBgSource;

    // Check if source already exists globally
    let inputExists = false;
    try {
      const inputs = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string; inputKind: string }>;
      };
      const existing = inputs.inputs.find((i) => i.inputName === sourceName);
      if (existing) {
        inputExists = true;
        // Update the image URL
        if (existing.inputKind === "image_source") {
          await this.call("SetInputSettings", {
            inputName: sourceName,
            inputSettings: { file: imageUrl },
          });
        } else {
          // Wrong source type — remove and recreate
          try { await this.call("RemoveInput", { inputName: sourceName }); } catch { /* ignore */ }
          inputExists = false;
        }
      }
    } catch { /* ignore */ }

    // Ensure it's in the scene
    const resp = await this.call("GetSceneItemList", { sceneName }) as {
      sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
    };
    let sceneItem = resp.sceneItems.find((i) => i.sourceName === sourceName);

    if (!sceneItem) {
      if (inputExists) {
        const created = await this.call("CreateSceneItem", {
          sceneName,
          sourceName,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItem = { sourceName, sceneItemId: created.sceneItemId };
      } else {
        const created = await this.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind: "image_source",
          inputSettings: { file: imageUrl },
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItem = { sourceName, sceneItemId: created.sceneItemId };
      }

      // Position fullscreen
      try {
        await this.call("SetSceneItemTransform", {
          sceneName,
          sceneItemId: sceneItem.sceneItemId,
          sceneItemTransform: {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_SCALE_INNER",
            boundsWidth: 1920, boundsHeight: 1080,
          },
        });
      } catch { /* ignore */ }
    }

    // Move to JUST below the overlay source (find the overlay, put BG right below it)
    await this._positionBgBelowOverlays(sceneName, sceneItem.sceneItemId, resources);

    if (enable) {
      try {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: sceneItem.sceneItemId,
          sceneItemEnabled: true,
        });
      } catch { /* ignore */ }
    }
  }

  /**
   * Create or update an OBS `color_source_v3` for the fullscreen background.
   */
  private async _ensureBgColorSource(
    sceneName: string,
    bgColor: string,
    enable: boolean,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    const sourceName = resources.fsBgSource;

    // Convert CSS hex color to OBS ABGR integer (OBS color format)
    const obsColor = this._cssColorToObsColor(bgColor);

    let inputExists = false;
    try {
      const inputs = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string; inputKind: string }>;
      };
      const existing = inputs.inputs.find((i) => i.inputName === sourceName);
      if (existing) {
        inputExists = true;
        if (existing.inputKind === "color_source_v3") {
          await this.call("SetInputSettings", {
            inputName: sourceName,
            inputSettings: { color: obsColor, width: 1920, height: 1080 },
          });
        } else {
          try { await this.call("RemoveInput", { inputName: sourceName }); } catch { /* ignore */ }
          inputExists = false;
        }
      }
    } catch { /* ignore */ }

    const resp = await this.call("GetSceneItemList", { sceneName }) as {
      sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
    };
    let sceneItem = resp.sceneItems.find((i) => i.sourceName === sourceName);

    if (!sceneItem) {
      if (inputExists) {
        const created = await this.call("CreateSceneItem", {
          sceneName,
          sourceName,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItem = { sourceName, sceneItemId: created.sceneItemId };
      } else {
        const created = await this.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind: "color_source_v3",
          inputSettings: { color: obsColor, width: 1920, height: 1080 },
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItem = { sourceName, sceneItemId: created.sceneItemId };
      }

      // Position fullscreen
      try {
        await this.call("SetSceneItemTransform", {
          sceneName,
          sceneItemId: sceneItem.sceneItemId,
          sceneItemTransform: {
            positionX: 0, positionY: 0,
            boundsType: "OBS_BOUNDS_SCALE_INNER",
            boundsWidth: 1920, boundsHeight: 1080,
          },
        });
      } catch { /* ignore */ }
    }

    await this._positionBgBelowOverlays(sceneName, sceneItem.sceneItemId, resources);

    if (enable) {
      try {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: sceneItem.sceneItemId,
          sceneItemEnabled: true,
        });
      } catch { /* ignore */ }
    }
  }

  /**
   * Position the background source just below the lowest visible overlay in
   * the OBS source stack, so it sits behind all overlays but above normal
   * scene content.
   */
  private async _positionBgBelowOverlays(
    sceneName: string,
    bgSceneItemId: number,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };

      const overlayNames = new Set([
        resources.bibleSource,
        resources.worshipSource,
        resources.ltSource,
        resources.tickerSource,
      ]);
      const overlayItems = resp.sceneItems.filter((i) => overlayNames.has(i.sourceName));

      if (overlayItems.length === 0) return;

      // Put the background directly beneath the lowest overlay item while
      // keeping it above the rest of the scene content.
      const lowestOverlayIndex = Math.min(...overlayItems.map((i) => i.sceneItemIndex));
      const targetIndex = Math.max(0, lowestOverlayIndex - 1);

      const bgItem = resp.sceneItems.find((i) => i.sceneItemId === bgSceneItemId);
      if (bgItem && bgItem.sceneItemIndex !== targetIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: bgSceneItemId,
          sceneItemIndex: targetIndex,
        });
      }
    } catch { /* ignore */ }
  }

  /**
   * Place a scene-local fullscreen background directly beneath the nested
   * fullscreen scene source in the user's target scene.
   */
  private async _positionSceneLocalBgBelowSource(
    sceneName: string,
    bgSourceName: string,
    overlaySourceName: string,
  ): Promise<void> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };

      const overlayItem = resp.sceneItems.find((item) => item.sourceName === overlaySourceName);
      const bgItem = resp.sceneItems.find((item) => item.sourceName === bgSourceName);
      if (!overlayItem || !bgItem) return;

      const topIndex = Math.max(0, resp.sceneItems.length - 1);
      if (overlayItem.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: overlayItem.sceneItemId,
          sceneItemIndex: topIndex,
        });
      }

      const refreshed = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };
      const refreshedOverlay = refreshed.sceneItems.find((item) => item.sourceName === overlaySourceName);
      const refreshedBg = refreshed.sceneItems.find((item) => item.sourceName === bgSourceName);
      if (!refreshedOverlay || !refreshedBg) return;

      const desiredBgIndex = Math.max(0, refreshedOverlay.sceneItemIndex - 1);
      if (refreshedBg.sceneItemIndex !== desiredBgIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: refreshedBg.sceneItemId,
          sceneItemIndex: desiredBgIndex,
        });
      }
    } catch { /* ignore */ }
  }

  /**
   * Convert a CSS color (#RRGGBB or #RGB) to OBS's ABGR integer format.
   */
  private _cssColorToObsColor(cssColor: string): number {
    const hex = cssColor.replace("#", "");
    let r = 0, g = 0, b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    // OBS uses ABGR format: 0xAABBGGRR
    return (0xFF << 24 | b << 16 | g << 8 | r) >>> 0;
  }

  /**
   * Hide the fullscreen background source in a scene.
   */
  private async hideFullscreenBg(
    sceneName: string,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    await this.hideOverlaySource(sceneName, resources.fsBgSource);
    await this.hideOverlaySource(sceneName, this.getTargetFullscreenBgSourceName(sceneName, resources));
  }

  // ── Theme resolution helpers ──

  private resolveLTTheme(
    theme: DockLTThemeRef | undefined,
    context: "speaker" | "sermon" | "event" | "worship" | "bible" | "ticker",
  ): DockLTThemeRef {
    if (theme) return theme;

    const contextHints: Record<typeof context, string[]> = {
      speaker: ["speaker", "pastor", "minister", "guest", "name", "title"],
      sermon: ["sermon", "sermon title", "title", "point", "quote", "scripture", "keyword"],
      event: ["event", "announcement", "highlight", "reminder", "date", "celebration"],
      worship: ["worship", "lyrics", "song", "chorus", "verse", "music"],
      bible: ["bible", "scripture", "verse", "reference", "word"],
      ticker: ["ticker", "news", "announcement", "headline"],
    };

    const categoryHint =
      context === "worship" ? "worship" : context === "bible" ? "bible" : "";

    const hints = contextHints[context].map(normalizeThemeToken);
    const favoriteIds = getWorshipLTFavorites();

    let list = ALL_THEMES.filter((t) => t.html && t.css);
    if (categoryHint) {
      list = list.filter((t) => normalizeThemeToken(String(t.category || "")) === categoryHint);
    }
    list = list.filter((t) => matchesThemeHints(t, hints));

    const favoriteMatches = list.filter((t) => favoriteIds.has(t.id));
    const customMatches = list.filter((t) => isLikelyCustomTheme(t));
    const fallback = favoriteMatches[0] ?? customMatches[0] ?? list[0];

    if (!fallback) return DEFAULT_LT_THEME;
    return {
      id: fallback.id,
      html: fallback.html || DEFAULT_LT_THEME.html,
      css: fallback.css || DEFAULT_LT_THEME.css,
    };
  }

  // ── Overlay URL builders ──

  private getOverlayBaseUrl(): string {
    return window.location.origin;
  }

  private getFullscreenOverlayPageUrl(): string {
    return `${this.getOverlayBaseUrl()}/bible-overlay-fullscreen.html`;
  }

  private publishFullscreenOverlayPacket(packet: {
    slide: Record<string, unknown> | null;
    theme: Record<string, unknown> | null;
    live: boolean;
    blanked: boolean;
    timestamp: number;
  }): void {
    try {
      localStorage.setItem("bible-overlay-data", JSON.stringify(packet));
    } catch { /* ignore */ }

    try {
      const bc = new BroadcastChannel("obs-church-studio-bible-overlay");
      bc.postMessage(packet);
      bc.close();
    } catch { /* ignore */ }
  }

  /**
   * Build a lower-third overlay URL with proper theme HTML/CSS payload.
   *
   * NOTE: The `live` param here is ignored — we ALWAYS send `live: true`
   * to the overlay HTML so it renders visibly. Which OBS scene the source
   * lives in (Preview vs Program) is controlled by the caller; the overlay
   * itself should never self-hide based on `live`. Hiding is done via
   * `blanked: true` or by calling `hideOverlaySource`.
   */
  private buildLowerThirdUrl(
    values: Record<string, string>,
    _live: boolean,
    blanked: boolean,
    theme?: DockLTThemeRef,
  ): string {
    const t = theme ?? DEFAULT_LT_THEME;
    const payload = {
      themeId: t.id,
      html: t.html,
      css: t.css,
      values,
      live: true,
      blanked,
      size: "xl",
      scale: 1,
      widthPct: 65,
      fontScale: 1,
      fontSizeScale: 1,
      position: "bottom-left",
      animationIn: "slide-left",
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${this.getOverlayBaseUrl()}/lower-third-overlay.html#data=${encoded}`;
  }

  /**
   * Build a bible overlay URL.
   * Supports both fullscreen and lower-third overlay modes.
   *
   * NOTE: Always sends `live: true` to the overlay so it renders.
   * Hiding is handled by `slide: null` or `blanked: true`.
   */
  private buildBibleUrl(
    slide: Record<string, unknown> | null,
    _live: boolean,
    blanked: boolean,
    themeSettings?: Record<string, unknown> | null,
    overlayMode: "fullscreen" | "lower-third" = "fullscreen",
  ): string {
    const packet = {
      slide,
      theme: themeSettings ?? null,
      live: true,
      blanked,
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(packet));
    const overlayFile = overlayMode === "lower-third" ? "bible-overlay-lower-third.html" : "bible-overlay-fullscreen.html";
    return `${this.getOverlayBaseUrl()}/${overlayFile}#data=${encoded}`;
  }

  private buildBibleSlide(
    text: string,
    reference: string,
    verseRange = "",
  ): Record<string, unknown> {
    return {
      id: `dock-bible-${Date.now()}`,
      text,
      reference,
      verseRange,
      index: 0,
      total: 1,
    };
  }

  /**
   * Build a Bible verse as a lower-third using the generic LT overlay.
   *
   * NOTE: Always sends `live: true` to the overlay so it renders.
   */
  private buildBibleLowerThirdUrl(
    verseText: string,
    reference: string,
    _live: boolean,
    blanked: boolean,
    theme?: DockLTThemeRef,
  ): string {
    const t = theme ?? DEFAULT_LT_THEME;
    const payload = {
      themeId: t.id,
      html: t.html,
      css: t.css,
      values: {
        name: verseText,
        role: reference,
        text: verseText,
        verseText,
        reference,
        quote: verseText,
        title: reference,
        subtitle: verseText,
        headline: reference,
        details: verseText,
        line1: verseText,
        line2: reference,
        label: reference,
      },
      live: true,
      blanked,
      size: "xl",
      scale: 1,
      widthPct: 65,
      fontScale: 1,
      fontSizeScale: 1,
      position: "bottom-left",
      animationIn: "slide-left",
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${this.getOverlayBaseUrl()}/lower-third-overlay.html#data=${encoded}`;
  }

  // ── Clear all overlays ──

  /**
   * Hide ALL overlay sources in the current scene(s) except the ones
   * that are about to be shown. This ensures that switching from e.g.
   * a fullscreen Bible overlay to a lower-third speaker overlay doesn't
   * leave the previous overlay visible.
   *
   * @param keepSources  Source/scene names that should NOT be hidden
   *                     (because they're about to be updated).
   *                     Pass `null` or `[]` to hide ALL.
   * @param sceneName    The target scene name — hides sources there.
   */
  async clearAllOverlays(
    keepSources: string | string[] | null = null,
    sceneName?: string,
    resources: DockResourceNames = LIVE_DOCK_RESOURCES,
  ): Promise<void> {
    const keepSet = new Set(
      keepSources == null ? [] : Array.isArray(keepSources) ? keepSources : [keepSources],
    );

    const ALL_OVERLAY_SOURCES = [
      resources.ltSource,
      resources.bibleSource,
      resources.worshipSource,
      resources.tickerSource,
      resources.fsBgSource,
    ];

    /** Dedicated overlay scenes (shown as nested scene sources in user's scenes) */
    const ALL_DEDICATED_SCENES = [
      resources.bibleScene,
      resources.worshipScene,
    ];

    const toHide = ALL_OVERLAY_SOURCES.filter((s) => !keepSet.has(s));
    const scenesToHide = ALL_DEDICATED_SCENES.filter((s) => !keepSet.has(s));

    // Collect scene names to clear: the provided scene + fallback to program/preview
    const scenes = new Set<string>();
    if (sceneName) scenes.add(sceneName);

    try {
      const { sceneName: prog } = await this.getTargetScene(true);
      if (prog) scenes.add(prog);
    } catch { /* ignore */ }
    try {
      const { sceneName: prev } = await this.getTargetScene(false);
      if (prev) scenes.add(prev);
    } catch { /* ignore */ }

    for (const scene of scenes) {
      for (const src of toHide) {
        await this.hideOverlaySource(scene, src);
      }
      if (!keepSet.has(resources.fsBgSource)) {
        await this.hideOverlaySource(scene, this.getTargetFullscreenBgSourceName(scene, resources));
      }
      // Also hide dedicated scene sources (nested scenes) in user's scenes
      for (const ds of scenesToHide) {
        await this.hideSceneSource(scene, ds);
      }
    }

    console.log(`[DockOBS] Cleared overlays (kept: ${[...keepSet].join(", ") || "none"}) in scenes: ${[...scenes].join(", ")}`);
  }

  // ── High-level actions ──

  /**
   * Push a Bible verse to OBS as an overlay.
   *
   * **Fullscreen mode**: Creates a dedicated "⛪ OCS Bible" scene with
   * a background source + browser overlay. That scene is added as a
   * nested scene-source into the user's target scene (Preview or Program).
   *
   * **Lower-third mode**: Uses a direct browser source in the user's
   * scene (lightweight, no background needed).
   *
   * @param live  false = Send to Preview scene, true = Go Live (Program scene)
   */
  async pushBible(data: {
    book: string;
    chapter: number;
    verse: number;
    translation: string;
    theme?: string;
    verseText?: string;
    overlayMode?: "fullscreen" | "lower-third";
    ltTheme?: DockLTThemeRef;
    bibleThemeSettings?: Record<string, unknown> | null;
  }, live: boolean): Promise<void> {
    const resources = getDockResources(live);
    const target = await this.getTargetScene(live);
    let sceneName = target.sceneName;
    const studioMode = target.studioMode;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");
    if (!live) {
      sceneName = await this.ensurePreviewTargetScene(sceneName);
    }

    // Only enable the source if going live OR Studio Mode is on (so
    // Preview is a separate scene). When Studio Mode is off and
    // live=false the target IS Program — we just pre-load the URL but
    // keep the source hidden so it doesn't appear on air.
    const shouldEnable = live || studioMode;

    const ref = `${data.book} ${data.chapter}:${data.verse}`;
    const mode = data.overlayMode ?? "fullscreen";

    // Detect overlay-mode switch → force CEF to fully reload the new HTML file
    const prevMode = this._lastOverlayMode[resources.bibleSource];
    const modeChanged = prevMode !== undefined && prevMode !== mode;
    this._lastOverlayMode[resources.bibleSource] = mode;

    let url: string;
    let themeCss = "";
    if (mode === "lower-third") {
      if (data.bibleThemeSettings) {
        const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(data.bibleThemeSettings);
        const keepSources = [resources.bibleScene, resources.bibleSource];

        await this.clearAllOverlays(keepSources, sceneName, resources);
        await this.ensureDedicatedScene(resources.bibleScene);
        await this.ensureOverlaySource(resources.bibleScene, resources.bibleSource, 1920, 1080, true);
        await this.hideFullscreenBg(resources.bibleScene, resources);
        await this.ensureSceneSourceInTarget(sceneName, resources.bibleScene, shouldEnable);
        await this.hideFullscreenBg(sceneName, resources);

        const { cleanSettings, css } = this.stripThemeDataUris(overlayTheme);
        themeCss = css;
        url = this.buildBibleUrl(
          this.buildBibleSlide(data.verseText || ref, `${ref} (${data.translation})`),
          live,
          false,
          cleanSettings,
          "lower-third",
        );
      } else {
        // ── Lower-third: direct browser source in user's scene ──
        await this.clearAllOverlays(resources.bibleSource, sceneName, resources);
        await this.ensureOverlaySource(sceneName, resources.bibleSource, 1920, 1080, shouldEnable);

        const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, "bible");
        url = this.buildBibleLowerThirdUrl(
          data.verseText || ref,
          `${ref} (${data.translation})`,
          live,
          false,
          resolvedLTTheme,
        );
        // Hide BG + dedicated scene if it was previously shown
        await this.hideFullscreenBg(sceneName, resources);
        await this.hideSceneSource(sceneName, resources.bibleScene);
      }
    } else {
      // ── Fullscreen: dedicated scene approach ──
      // Clear all OTHER overlays — keep the Bible scene, its overlay source, and its BG
      await this.clearAllOverlays([resources.bibleScene, resources.bibleSource, resources.fsBgSource], sceneName, resources);

      // 1. Ensure the dedicated Bible scene exists
      await this.ensureDedicatedScene(resources.bibleScene);

      // 2. Inside the dedicated scene, ensure BG + overlay sources exist
      await this.ensureOverlaySource(resources.bibleScene, resources.bibleSource, 1920, 1080, true);
      await this.ensureFullscreenBg(resources.bibleScene, data.bibleThemeSettings as Record<string, unknown> | null, true, resources);

      // 3. Add the dedicated scene as a nested scene-source in the user's target scene
      await this.ensureSceneSourceInTarget(sceneName, resources.bibleScene, shouldEnable);
      await this.ensureFullscreenTargetBg(
        sceneName,
        resources.bibleScene,
        data.bibleThemeSettings as Record<string, unknown> | null,
        shouldEnable,
        resources,
      );

      // Fullscreen Bible overlay — strip data URIs to stay within URL limits
      const { cleanSettings, css } = this.stripThemeDataUris(data.bibleThemeSettings);
      themeCss = css;
      const slide = {
        id: `dock-${data.book}-${data.chapter}-${data.verse}`,
        reference: `${ref} (${data.translation})`,
        text: data.verseText || ref,
        verseRange: String(data.verse),
        index: 0,
        total: 1,
      };
      const packet = {
        slide,
        theme: cleanSettings ?? null,
        live: true,
        blanked: false,
        timestamp: Date.now(),
      };
      this.publishFullscreenOverlayPacket(packet);
      url = this.getFullscreenOverlayPageUrl();
    }

    // CRITICAL: Hide the overlay in the OPPOSITE scene BEFORE setting the URL.
    // setBrowserSourceUrl uses SetInputSettings which is a GLOBAL operation —
    // it changes the URL for every instance of this source across ALL scenes.
    // We must hide the source in the opposite scene FIRST so the global URL
    // change doesn't render on the wrong output (e.g. "Send to Preview"
    // must not flash on Program).
    if (mode === "lower-third") {
      if (data.bibleThemeSettings) {
        if (live) {
          await this.hideInOppositeScene(
            live,
            [resources.bibleSource],
            [resources.bibleScene],
            false,
            sceneName,
            resources,
          );
        }
      } else {
        if (live) {
          await this.hideInOppositeScene(live, [resources.bibleSource, resources.fsBgSource], [], false, sceneName, resources);
        }
      }
    } else {
      if (live) {
        await this.hideInOppositeScene(live, [resources.bibleSource], [resources.bibleScene], true, sceneName, resources);
      }
    }

    if (mode === "fullscreen") {
      const sourceSignature = JSON.stringify({
        url,
        css: themeCss || "",
      });
      if (modeChanged || this._lastFullscreenSourceSignature[resources.bibleSource] !== sourceSignature) {
        await this.setBrowserSourceUrl(resources.bibleSource, url, modeChanged, themeCss || undefined);
        this._lastFullscreenSourceSignature[resources.bibleSource] = sourceSignature;
      }
    } else {
      await this.setBrowserSourceUrl(resources.bibleSource, url, modeChanged, themeCss || undefined);
    }

    console.log(`[DockOBS] Bible "${ref}" (${mode}) → scene "${sceneName}" (${live ? "Program" : "Preview"})`);
  }

  /**
   * Clear the Bible overlay.
   * Sends a blanked URL first (triggers exit animation in the overlay HTML),
   * waits for the animation to finish, then hides the OBS source.
   */
  async clearBible(): Promise<void> {
    for (const resources of getAllDockResources()) {
      const lastMode = this._lastOverlayMode[resources.bibleSource] ?? "fullscreen";
      const url = lastMode === "lower-third"
        ? this.buildBibleUrl(null, false, true, null, "lower-third")
        : this.buildBibleUrl(null, false, true, null);
      try { await this.setBrowserSourceUrl(resources.bibleSource, url); } catch { /* ignore */ }
    }

    // Wait for exit animation before hiding the source
    await new Promise((r) => setTimeout(r, 800));

    const scenes = new Set<string>();
    try {
      const { sceneName: progScene } = await this.getTargetScene(true);
      if (progScene) scenes.add(progScene);
    } catch { /* ignore */ }
    try {
      const { sceneName: prevScene } = await this.getTargetScene(false);
      if (prevScene) scenes.add(prevScene);
    } catch { /* ignore */ }

    for (const resources of getAllDockResources()) {
      for (const sceneName of scenes) {
        await this.hideOverlaySource(sceneName, resources.bibleSource);
        await this.hideFullscreenBg(sceneName, resources);
        await this.hideSceneSource(sceneName, resources.bibleScene);
        await this.removeSceneItemBySource(sceneName, resources.bibleSource);
        await this.removeSceneItemBySource(sceneName, resources.bibleScene);
        await this.removeSceneItemBySource(sceneName, this.getTargetFullscreenBgSourceName(sceneName, resources));
      }
      await this.removeSceneIfExists(resources.bibleScene);
      await this.removeInputIfExists(resources.bibleSource);
    }

    console.log("[DockOBS] Bible cleared");
  }

  /**
   * Push a lower-third to OBS as an overlay in the current scene.
   * @param live  false = Send to Preview scene, true = Go Live (Program scene)
   */
  async pushLowerThird(data: {
    name?: string;
    role?: string;
    title?: string;
    subtitle?: string;
    series?: string;
    speaker?: string;
    point?: string;
    date?: string;
    location?: string;
    description?: string;
    ltTheme?: DockLTThemeRef;
    context?: "speaker" | "sermon" | "event";
  }, live: boolean): Promise<void> {
    const resources = getDockResources(live);
    const target = await this.getTargetScene(live);
    let sceneName = target.sceneName;
    const studioMode = target.studioMode;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");
    if (!live) {
      sceneName = await this.ensurePreviewTargetScene(sceneName);
    }

    const shouldEnable = live || studioMode;

    // Clear all OTHER overlays first so previous overlay doesn't persist
    await this.clearAllOverlays(resources.ltSource, sceneName, resources);

    // Ensure overlay source exists in target scene (auto-creates if needed)
    await this.ensureOverlaySource(sceneName, resources.ltSource, 1920, 1080, shouldEnable);

    const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, data.context ?? "speaker");

    // Build a comprehensive values map so the overlay's {{variable}} substitution
    // can replace ALL placeholders — regardless of which theme is chosen.
    const values: Record<string, string> = {};
    const ctx = data.context ?? "speaker";
    if (ctx === "speaker") {
      const nm = data.name || "";
      const rl = data.role || data.subtitle || "";
      Object.assign(values, {
        name: nm,
        title: rl,
        role: rl,
        subtitle: rl,
        headline: nm,
        subline: rl,
        label: nm,
        details: rl,
        line1: nm,
        line2: rl,
      });
    } else if (ctx === "sermon") {
      const msgTitle = data.title || data.point || "";
      const seriesName = data.series || "";
      const speakerName = data.speaker || data.name || "";
      Object.assign(values, {
        name: msgTitle,
        title: msgTitle,
        headline: msgTitle,
        subtitle: seriesName || speakerName,
        subline: seriesName || speakerName,
        role: speakerName,
        series: seriesName,
        speaker: speakerName,
        point: data.point || "",
        label: msgTitle,
        details: seriesName ? `${seriesName} • ${speakerName}` : speakerName,
        line1: msgTitle,
        line2: seriesName ? `${seriesName} • ${speakerName}` : speakerName,
      });
    } else if (ctx === "event") {
      const evName = data.name || data.title || "";
      const evDate = data.date || "";
      const evLoc = data.location || "";
      const evDesc = data.description || data.subtitle || "";
      const sub = [evDate, evLoc].filter(Boolean).join(" • ") || evDesc;
      Object.assign(values, {
        name: evName,
        title: evName,
        headline: evName,
        subtitle: sub,
        subline: sub,
        role: sub,
        date: evDate,
        location: evLoc,
        description: evDesc,
        label: evName,
        details: evDesc || sub,
        line1: evName,
        line2: sub,
      });
    }

    // ── Inject church logo from brand settings ──
    const logoUrl = this._getLogoUrl();
    if (logoUrl) {
      values.logoUrl = logoUrl;
    }

    const url = this.buildLowerThirdUrl(values, live, false, resolvedLTTheme);

    // Hide in opposite scene BEFORE setting URL — global URL change must not leak
    if (live) {
      await this.hideInOppositeScene(live, [resources.ltSource], [], false, sceneName, resources);
    }

    await this.setBrowserSourceUrl(resources.ltSource, url);

    const displayLabel = values.name || values.title || "(untitled)";
    console.log(`[DockOBS] LT "${displayLabel}" → scene "${sceneName}" (${live ? "Program" : "Preview"})`);
  }

  /**
   * Clear all lower-third overlays.
   * Sends a blanked URL first (triggers exit animation), waits, then hides.
   */
  async clearLowerThirds(): Promise<void> {
    const url = this.buildLowerThirdUrl({}, false, true);
    for (const resources of getAllDockResources()) {
      try { await this.setBrowserSourceUrl(resources.ltSource, url); } catch { /* ignore */ }
    }

    // Wait for exit animation before hiding the source
    await new Promise((r) => setTimeout(r, 800));

    const scenes = new Set<string>();
    try {
      const { sceneName: progScene } = await this.getTargetScene(true);
      if (progScene) scenes.add(progScene);
    } catch { /* ignore */ }
    try {
      const { sceneName: prevScene } = await this.getTargetScene(false);
      if (prevScene) scenes.add(prevScene);
    } catch { /* ignore */ }

    for (const resources of getAllDockResources()) {
      for (const sceneName of scenes) {
        await this.hideOverlaySource(sceneName, resources.ltSource);
        await this.removeSceneItemBySource(sceneName, resources.ltSource);
      }
      await this.removeInputIfExists(resources.ltSource);
    }

    console.log("[DockOBS] LT cleared");
  }

  // ── Worship lyrics overlay ──

  /**
   * Build a worship lyrics fullscreen overlay URL.
   * Uses the Bible fullscreen overlay to display lyrics in a large format.
   *
   * NOTE: Always sends `live: true` to the overlay so it renders.
   */
  private buildWorshipFullscreenUrl(
    sectionText: string,
    sectionLabel: string,
    _songTitle: string,
    _artist: string,
    _live: boolean,
    blanked: boolean,
    themeSettings?: Record<string, unknown> | null,
  ): string {
    const cleanedLabel = cleanWorshipObsLabel(sectionLabel);
    const slide = sectionText ? {
      id: `dock-worship-${Date.now()}`,
      reference: "",
      text: sectionText,
      verseRange: cleanedLabel,
      index: 0,
      total: 1,
    } : null;
    const packet = {
      slide,
      theme: themeSettings ?? null,
      live: true,
      blanked,
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(packet));
    return `${this.getOverlayBaseUrl()}/bible-overlay-fullscreen.html#data=${encoded}`;
  }

  /**
   * Build a worship lyrics overlay URL (lower-third mode).
   * Uses the lower-third overlay with theme variables mapped to worship data.
   *
   * NOTE: Always sends `live: true` to the overlay so it renders.
   */
  private buildWorshipLyricsUrl(
    sectionText: string,
    sectionLabel: string,
    _songTitle: string,
    _artist: string,
    _live: boolean,
    blanked: boolean,
    theme?: DockLTThemeRef,
  ): string {
    const t = theme ?? DEFAULT_LT_THEME;
    const cleanedLabel = cleanWorshipObsLabel(sectionLabel);

    // Build variable values that worship themes expect
    const lines = sectionText.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
    const line1 = lines[0] ?? (sectionText || "Worship");
    const line2 = lines.slice(1).join(" ").trim();
    const songInfo = cleanedLabel || "";

    const values: Record<string, string> = {
      name: line1,
      role: cleanedLabel,
      // Standard worship theme variables
      line1,
      line2: line2 || line1,
      lyrics: sectionText || line1,
      verseText: sectionText || line1,
      songName: line1,
      artist: "",
      songInfo: songInfo || line2 || line1,
      title: line1,
      subtitle: line2 || "Worship",
      text: sectionText || line1,
      body: sectionText || line1,
      headline: line1,
      details: line2 || "Worship Service",
      quote: sectionText || line1,
      reference: cleanedLabel,
      referenceText: cleanedLabel,
      song: line1,
      meta: songInfo || "Worship",
      label: cleanedLabel,
    };

    const payload = {
      themeId: t.id,
      html: t.html,
      css: t.css,
      values,
      live: true,
      blanked,
      size: "xl",
      scale: 1,
      widthPct: 65,
      fontScale: 1,
      fontSizeScale: 1,
      position: "bottom-left",
      animationIn: "slide-left",
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${this.getOverlayBaseUrl()}/lower-third-overlay.html#data=${encoded}`;
  }

  /**
   * Push worship lyrics to OBS as an overlay in the current scene.
   * Supports both fullscreen and lower-third overlay modes.
   */
  async pushWorshipLyrics(data: {
    sectionText: string;
    sectionLabel: string;
    songTitle: string;
    artist?: string;
    overlayMode?: "fullscreen" | "lower-third";
    ltTheme?: DockLTThemeRef;
    bibleThemeSettings?: Record<string, unknown> | null;
  }, live: boolean): Promise<void> {
    const resources = getDockResources(live);
    const target = await this.getTargetScene(live);
    let sceneName = target.sceneName;
    const studioMode = target.studioMode;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");
    if (!live) {
      sceneName = await this.ensurePreviewTargetScene(sceneName);
    }

    const shouldEnable = live || studioMode;

    const mode = data.overlayMode ?? "lower-third";
    const prevMode = this._lastOverlayMode[resources.worshipSource];
    const modeChanged = prevMode !== undefined && prevMode !== mode;
    this._lastOverlayMode[resources.worshipSource] = mode;

    let url: string;
    let themeCss = "";

    if (mode === "fullscreen") {
      // ── Fullscreen: dedicated scene approach ──
      // Keep the Worship scene, its overlay source, and its BG
      await this.clearAllOverlays([resources.worshipScene, resources.worshipSource, resources.fsBgSource], sceneName, resources);

      // 1. Ensure the dedicated Worship scene exists
      await this.ensureDedicatedScene(resources.worshipScene);

      // 2. Inside the dedicated scene, ensure BG + overlay sources exist
      await this.ensureOverlaySource(resources.worshipScene, resources.worshipSource, 1920, 1080, true);
      await this.ensureFullscreenBg(resources.worshipScene, data.bibleThemeSettings as Record<string, unknown> | null, true, resources);

      // 3. Add the dedicated scene as a nested scene-source in the user's target scene
      await this.ensureSceneSourceInTarget(sceneName, resources.worshipScene, shouldEnable);
      await this.ensureFullscreenTargetBg(
        sceneName,
        resources.worshipScene,
        data.bibleThemeSettings as Record<string, unknown> | null,
        shouldEnable,
        resources,
      );

      // Strip data URIs to stay within URL-hash limits
      const { cleanSettings, css } = this.stripThemeDataUris(data.bibleThemeSettings);
      themeCss = css;
      const cleanedLabel = cleanWorshipObsLabel(data.sectionLabel);
      const slide = data.sectionText ? {
        id: `dock-worship-${Date.now()}`,
        reference: "",
        text: data.sectionText,
        verseRange: cleanedLabel,
        index: 0,
        total: 1,
      } : null;
      const packet = {
        slide,
        theme: cleanSettings ?? null,
        live: true,
        blanked: false,
        timestamp: Date.now(),
      };
      this.publishFullscreenOverlayPacket(packet);
      url = this.getFullscreenOverlayPageUrl();
    } else {
      if (data.bibleThemeSettings) {
        const { overlayTheme } = this.prepareDedicatedLowerThirdTheme(data.bibleThemeSettings);
        const keepSources = [resources.worshipScene, resources.worshipSource];

        await this.clearAllOverlays(keepSources, sceneName, resources);
        await this.ensureDedicatedScene(resources.worshipScene);
        await this.ensureOverlaySource(resources.worshipScene, resources.worshipSource, 1920, 1080, true);
        await this.hideFullscreenBg(resources.worshipScene, resources);
        await this.ensureSceneSourceInTarget(sceneName, resources.worshipScene, shouldEnable);
        await this.hideFullscreenBg(sceneName, resources);

        const { cleanSettings, css } = this.stripThemeDataUris(overlayTheme);
        themeCss = css;
        url = this.buildBibleUrl(
          this.buildBibleSlide(
            data.sectionText,
            cleanWorshipObsLabel(data.sectionLabel),
          ),
          live,
          false,
          cleanSettings,
          "lower-third",
        );
      } else {
        // ── Lower-third: direct browser source in user's scene ──
        await this.clearAllOverlays(resources.worshipSource, sceneName, resources);
        await this.ensureOverlaySource(sceneName, resources.worshipSource, 1920, 1080, shouldEnable);

        const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, "worship");
        url = this.buildWorshipLyricsUrl(
          data.sectionText,
          data.sectionLabel,
          data.songTitle,
          data.artist || "",
          live,
          false,
          resolvedLTTheme,
        );
        // Hide dedicated scene + BG if previously shown
        await this.hideFullscreenBg(sceneName, resources);
        await this.hideSceneSource(sceneName, resources.worshipScene);
      }
    }

    // Hide in opposite scene BEFORE setting URL — global URL change must not leak
    if (mode === "fullscreen") {
      if (live) {
        await this.hideInOppositeScene(live, [resources.worshipSource], [resources.worshipScene], true, sceneName, resources);
      }
    } else {
      if (data.bibleThemeSettings) {
        if (live) {
          await this.hideInOppositeScene(
            live,
            [resources.worshipSource],
            [resources.worshipScene],
            false,
            sceneName,
            resources,
          );
        }
      } else {
        if (live) {
          await this.hideInOppositeScene(live, [resources.worshipSource], [], false, sceneName, resources);
        }
      }
    }

    if (mode === "fullscreen") {
      const sourceSignature = JSON.stringify({
        url,
        css: themeCss || "",
      });
      if (modeChanged || this._lastFullscreenSourceSignature[resources.worshipSource] !== sourceSignature) {
        await this.setBrowserSourceUrl(resources.worshipSource, url, modeChanged, themeCss || undefined);
        this._lastFullscreenSourceSignature[resources.worshipSource] = sourceSignature;
      }
    } else {
      await this.setBrowserSourceUrl(resources.worshipSource, url, modeChanged, themeCss || undefined);
    }

    console.log(`[DockOBS] Worship "${data.sectionLabel}" (${mode}) → scene "${sceneName}" (${live ? "Program" : "Preview"})`);
  }

  /**
   * Clear the worship lyrics overlay.
   * Sends a blanked URL first (triggers exit animation), waits, then hides.
   * Uses the correct blank format (fullscreen vs lower-third) based on
   * what mode was last pushed.
   */
  async clearWorshipLyrics(): Promise<void> {
    for (const resources of getAllDockResources()) {
      const lastMode = this._lastOverlayMode[resources.worshipSource] ?? "lower-third";
      const url = lastMode === "fullscreen"
        ? this.buildWorshipFullscreenUrl("", "", "", "", false, true)
        : this.buildBibleUrl(null, false, true, null, "lower-third");
      try { await this.setBrowserSourceUrl(resources.worshipSource, url); } catch { /* ignore */ }
    }

    // Wait for exit animation before hiding the source
    await new Promise((r) => setTimeout(r, 800));

    const scenes = new Set<string>();
    try {
      const { sceneName: progScene } = await this.getTargetScene(true);
      if (progScene) scenes.add(progScene);
    } catch { /* ignore */ }
    try {
      const { sceneName: prevScene } = await this.getTargetScene(false);
      if (prevScene) scenes.add(prevScene);
    } catch { /* ignore */ }

    for (const resources of getAllDockResources()) {
      for (const sceneName of scenes) {
        await this.hideOverlaySource(sceneName, resources.worshipSource);
        await this.hideFullscreenBg(sceneName, resources);
        await this.hideSceneSource(sceneName, resources.worshipScene);
        await this.removeSceneItemBySource(sceneName, resources.worshipSource);
        await this.removeSceneItemBySource(sceneName, resources.worshipScene);
        await this.removeSceneItemBySource(sceneName, this.getTargetFullscreenBgSourceName(sceneName, resources));
      }
      await this.removeSceneIfExists(resources.worshipScene);
      await this.removeInputIfExists(resources.worshipSource);
    }

    console.log("[DockOBS] Worship lyrics cleared");
  }

  // ── Ticker overlay ──

  /**
   * Build a ticker overlay URL using the lower-third overlay renderer.
   * Maps badge + tickerText to the theme's template variables.
   *
   * NOTE: Always sends `live: true` to the overlay so it renders.
   */
  private buildTickerUrl(
    badge: string,
    tickerText: string,
    _live: boolean,
    blanked: boolean,
    theme?: DockLTThemeRef,
  ): string {
    const t = theme ?? DEFAULT_LT_THEME;
    const payload = {
      themeId: t.id,
      html: t.html,
      css: t.css,
      values: {
        badge: badge || "Church News",
        tickerText: tickerText || "",
        name: badge || "Church News",
        role: tickerText || "",
        title: badge,
        subtitle: tickerText,
        text: tickerText,
        headline: badge,
        details: tickerText,
        line1: badge,
        line2: tickerText,
      },
      live: true,
      blanked,
      size: "xl",
      scale: 1,
      widthPct: 100,
      fontScale: 1,
      fontSizeScale: 1,
      position: "bottom-center",
      animationIn: "slide-up",
      timestamp: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${this.getOverlayBaseUrl()}/lower-third-overlay.html#data=${encoded}`;
  }

  /**
   * Push a ticker to OBS as an overlay in the current scene.
   * @param live  false = Send to Preview scene, true = Go Live (Program scene)
   */
  async pushTicker(data: {
    badge: string;
    tickerText: string;
    ltTheme?: DockLTThemeRef;
  }, live: boolean): Promise<void> {
    const resources = getDockResources(live);
    const target = await this.getTargetScene(live);
    let sceneName = target.sceneName;
    const studioMode = target.studioMode;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");
    if (!live) {
      sceneName = await this.ensurePreviewTargetScene(sceneName);
    }

    const shouldEnable = live || studioMode;

    // Clear all OTHER overlays first so previous overlay doesn't persist
    await this.clearAllOverlays(resources.tickerSource, sceneName, resources);

    await this.ensureOverlaySource(sceneName, resources.tickerSource, 1920, 1080, shouldEnable);
    const resolvedLTTheme = this.resolveLTTheme(data.ltTheme, "ticker");

    const url = this.buildTickerUrl(
      data.badge,
      data.tickerText,
      live,
      false,
      resolvedLTTheme,
    );

    // Hide in opposite scene BEFORE setting URL — global URL change must not leak
    if (live) {
      await this.hideInOppositeScene(live, [resources.tickerSource], [], false, sceneName, resources);
    }

    await this.setBrowserSourceUrl(resources.tickerSource, url);

    console.log(`[DockOBS] Ticker "${data.badge}" → scene "${sceneName}" (${live ? "Program" : "Preview"})`);
  }

  // ── State Recovery ──

  /**
   * Scan OBS for currently-active overlay sources created by the dock.
   * Parses the URL hash of each source to reconstruct what's currently live.
   * Call this on app start to restore the staged/live state after a restart.
   */
  async recoverLiveState(): Promise<{
    bible: { reference: string; text: string; overlayMode: string } | null;
    worship: { sectionLabel: string; sectionText: string; songTitle: string; artist: string; overlayMode: string } | null;
    lowerThird: { name: string; role: string } | null;
  }> {
    const result: {
      bible: { reference: string; text: string; overlayMode: string } | null;
      worship: { sectionLabel: string; sectionText: string; songTitle: string; artist: string; overlayMode: string } | null;
      lowerThird: { name: string; role: string } | null;
    } = { bible: null, worship: null, lowerThird: null };

    if (!this.isConnected) return result;

    const sourcesToCheck = [
      { name: DOCK_BIBLE_SOURCE, type: "bible" as const },
      { name: DOCK_WORSHIP_SOURCE, type: "worship" as const },
      { name: DOCK_LT_SOURCE, type: "lowerThird" as const },
    ];

    for (const { name, type } of sourcesToCheck) {
      try {
        // Check if the input exists at all
        const resp = await this.call("GetInputSettings", { inputName: name }) as {
          inputSettings: { url?: string };
        };
        const url = resp.inputSettings?.url || "";
        if (!url || url === "about:blank" || !url.includes("#data=")) continue;

        // Check if the source is currently enabled in any scene
        let isEnabled = false;
        try {
          // Check program scene
          const { sceneName } = await this.getTargetScene(true);
          if (sceneName) {
            const items = await this.call("GetSceneItemList", { sceneName }) as {
              sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemEnabled: boolean }>;
            };
            const item = items.sceneItems.find((i) => i.sourceName === name);
            if (item) {
              // Get enabled state
              const enabledResp = await this.call("GetSceneItemEnabled", {
                sceneName,
                sceneItemId: item.sceneItemId,
              }) as { sceneItemEnabled: boolean };
              isEnabled = enabledResp.sceneItemEnabled;
            }
          }
        } catch { /* ignore */ }

        if (!isEnabled) continue;

        // Parse the URL hash data
        const encoded = url.split("#data=")[1];
        if (!encoded) continue;

        const data = JSON.parse(decodeURIComponent(encoded));
        if (data.blanked) continue; // Source exists but is blanked — treat as cleared

        if (type === "bible") {
          // Fullscreen bible has data.slide, LT bible has data.values
          if (data.slide) {
            result.bible = {
              reference: data.slide.reference || "",
              text: data.slide.text || "",
              overlayMode: url.includes("lower-third") ? "lower-third" : "fullscreen",
            };
          } else if (data.values) {
            result.bible = {
              reference: data.values.reference || data.values.role || "",
              text: data.values.name || data.values.text || "",
              overlayMode: "lower-third",
            };
          }
        } else if (type === "worship") {
          if (data.slide) {
            // Fullscreen worship (uses bible fullscreen overlay)
            const ref = (data.slide.reference || "").split(" · ");
            result.worship = {
              sectionLabel: ref[1] || data.slide.verseRange || "",
              sectionText: data.slide.text || "",
              songTitle: (ref[0] || "").split(" — ")[0] || "",
              artist: (ref[0] || "").split(" — ")[1] || "",
              overlayMode: "fullscreen",
            };
          } else if (data.values) {
            // LT worship
            result.worship = {
              sectionLabel: data.values.label || data.values.role || "",
              sectionText: data.values.lyrics || data.values.text || data.values.name || "",
              songTitle: data.values.songName || data.values.title || "",
              artist: data.values.artist || "",
              overlayMode: "lower-third",
            };
          }
        } else if (type === "lowerThird") {
          if (data.values) {
            result.lowerThird = {
              name: data.values.name || "",
              role: data.values.role || "",
            };
          }
        }
      } catch (err) {
        console.warn(`[DockOBS] Failed to recover state for "${name}":`, err);
      }
    }

    console.log("[DockOBS] Recovered live state:", result);
    return result;
  }

  // ── Media playback ──

  /**
   * Push a media file to OBS using native sources (ffmpeg_source for video,
   * image_source for images) instead of a browser source.
   * @param filePath  Absolute local file path (e.g. ~/Documents/OBSChurchStudio/uploads/video.mp4)
   * @param fileName  Human-readable name for logging
   * @param live      false = Preview scene, true = Program scene (Go Live)
   */
  async pushMedia(filePath: string, fileName: string, live: boolean): Promise<void> {
    const resources = getDockResources(live);
    const target = await this.getTargetScene(live);
    let sceneName = target.sceneName;
    if (!sceneName) throw new Error("Could not determine the current OBS scene.");
    if (!live) {
      sceneName = await this.ensurePreviewTargetScene(sceneName);
    }
    // Always enable — the user explicitly asked to play this media
    const shouldEnable = true;

    // Detect type from file extension
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext);

    if (isImage) {
      // ── Image: use image_source ──
      // Hide video source if it was previously active
      await this._hideMediaSource(sceneName, resources.mediaVideoSource);

      await this._ensureNativeMediaSource(
        sceneName, resources.mediaImageSource, "image_source",
        { file: filePath },
        shouldEnable,
      );
    } else {
      // ── Video / Audio: use ffmpeg_source ──
      // Hide image source if it was previously active
      await this._hideMediaSource(sceneName, resources.mediaImageSource);

      await this._ensureNativeMediaSource(
        sceneName, resources.mediaVideoSource, "ffmpeg_source",
        {
          local_file: filePath,
          looping: true,
          is_local_file: true,
          restart_on_activate: true,
        },
        shouldEnable,
      );

      // Restart video playback (source may already exist with old media)
      try {
        await this.call("TriggerMediaInputAction", {
          inputName: resources.mediaVideoSource,
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        });
      } catch { /* source may not exist yet on first play — ignore */ }
    }

    console.log(`[DockOBS] Media "${fileName}" (${isImage ? "image" : "video"}) pushed to ${live ? "Program" : "Preview"} scene "${sceneName}" — path: ${filePath}`);
  }

  /**
   * Create or update a native OBS source (ffmpeg_source or image_source)
   * for the media player, position it fullscreen, and move it to the top.
   */
  private async _ensureNativeMediaSource(
    sceneName: string,
    sourceName: string,
    inputKind: string,
    inputSettings: Record<string, unknown>,
    enable: boolean,
  ): Promise<void> {
    // 1. Check if source already exists globally
    let inputExists = false;
    try {
      const inputs = await this.call("GetInputList") as {
        inputs: Array<{ inputName: string; inputKind: string }>;
      };
      const existing = inputs.inputs.find((i) => i.inputName === sourceName);
      if (existing) {
        inputExists = true;
        if (existing.inputKind === inputKind) {
          // Same kind — just update settings
          await this.call("SetInputSettings", {
            inputName: sourceName,
            inputSettings,
          });
        } else {
          // Wrong kind (e.g. was browser_source, now ffmpeg_source) — remove & recreate
          try { await this.call("RemoveInput", { inputName: sourceName }); } catch { /* ignore */ }
          inputExists = false;
        }
      }
    } catch { /* ignore */ }

    // 2. Ensure it's in the target scene
    const resp = await this.call("GetSceneItemList", { sceneName }) as {
      sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
    };
    let sceneItem = resp.sceneItems.find((i) => i.sourceName === sourceName);

    if (!sceneItem) {
      if (inputExists) {
        const created = await this.call("CreateSceneItem", {
          sceneName,
          sourceName,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItem = { sourceName, sceneItemId: created.sceneItemId };
      } else {
        const created = await this.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind,
          inputSettings,
          sceneItemEnabled: enable,
        }) as { sceneItemId: number };
        sceneItem = { sourceName, sceneItemId: created.sceneItemId };
      }
    }

    // 3. Position fullscreen at (0,0) — always apply to keep it correct.
    //    Use OBS_BOUNDS_STRETCH so media fills the entire canvas regardless
    //    of its native resolution.  We query the actual canvas size so it
    //    works with any OBS output resolution.
    try {
      let canvasW = 1920;
      let canvasH = 1080;
      try {
        const video = await this.call("GetVideoSettings") as {
          baseWidth: number;
          baseHeight: number;
        };
        if (video.baseWidth && video.baseHeight) {
          canvasW = video.baseWidth;
          canvasH = video.baseHeight;
        }
      } catch { /* fall back to 1920×1080 */ }

      await this.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId: sceneItem.sceneItemId,
        sceneItemTransform: {
          positionX: 0,
          positionY: 0,
          scaleX: 1,
          scaleY: 1,
          boundsType: "OBS_BOUNDS_STRETCH",
          boundsWidth: canvasW,
          boundsHeight: canvasH,
          boundsAlignment: 0,
        },
      });
    } catch { /* ignore */ }

    // 4. Move to top of z-order
    try {
      const updated = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemIndex: number }>;
      };
      const topIndex = Math.max(0, updated.sceneItems.length - 1);
      const currentItem = updated.sceneItems.find((i) => i.sceneItemId === sceneItem!.sceneItemId);
      if (currentItem && currentItem.sceneItemIndex !== topIndex) {
        await this.call("SetSceneItemIndex", {
          sceneName,
          sceneItemId: sceneItem.sceneItemId,
          sceneItemIndex: topIndex,
        });
      }
    } catch { /* ignore */ }

    // 5. Enable / disable
    try {
      await this.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: sceneItem.sceneItemId,
        sceneItemEnabled: enable,
      });
    } catch { /* ignore */ }
  }

  /**
   * Hide a single media source in the given scene.
   */
  private async _hideMediaSource(sceneName: string, sourceName: string): Promise<void> {
    try {
      const resp = await this.call("GetSceneItemList", { sceneName }) as {
        sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
      };
      const item = resp.sceneItems.find((i) => i.sourceName === sourceName);
      if (item) {
        await this.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: false,
        });
      }
    } catch { /* ignore */ }
  }

  /**
   * Stop / hide both media player sources (video + image).
   */
  async clearMedia(): Promise<void> {
    const sources = [DOCK_MEDIA_VIDEO_SOURCE, DOCK_MEDIA_IMAGE_SOURCE];

    for (const src of sources) {
      try {
        const { sceneName: progScene } = await this.getTargetScene(true);
        if (progScene) await this.hideOverlaySource(progScene, src);
      } catch { /* ignore */ }
      try {
        const { sceneName: prevScene } = await this.getTargetScene(false);
        if (prevScene) await this.hideOverlaySource(prevScene, src);
      } catch { /* ignore */ }
    }

    console.log("[DockOBS] Media cleared");
  }

  /**
   * Clear the ticker overlay.
   */
  async clearTicker(): Promise<void> {
    const url = this.buildTickerUrl("", "", false, true);
    try { await this.setBrowserSourceUrl(DOCK_TICKER_SOURCE, url); } catch { /* ignore */ }

    try {
      const { sceneName: progScene } = await this.getTargetScene(true);
      if (progScene) {
        await this.hideOverlaySource(progScene, DOCK_TICKER_SOURCE);
        await this.removeSceneItemBySource(progScene, DOCK_TICKER_SOURCE);
      }
    } catch { /* ignore */ }
    try {
      const { sceneName: prevScene } = await this.getTargetScene(false);
      if (prevScene) {
        await this.hideOverlaySource(prevScene, DOCK_TICKER_SOURCE);
        await this.removeSceneItemBySource(prevScene, DOCK_TICKER_SOURCE);
      }
    } catch { /* ignore */ }

    await this.removeInputIfExists(DOCK_TICKER_SOURCE);

    console.log("[DockOBS] Ticker cleared");
  }
}

export const dockObsClient = new DockObsClient();
