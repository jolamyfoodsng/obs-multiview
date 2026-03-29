/**
 * OBS WebSocket Service — OBS Church Studio
 *
 * Singleton service wrapping obs-websocket-js v5.
 * Handles connection lifecycle, error classification, and all OBS API calls.
 *
 * Why a class? We need exactly ONE WebSocket connection shared across the
 * entire app. A singleton avoids duplicate connections and makes cleanup
 * deterministic.
 */

import OBSWebSocket from "obs-websocket-js";
import {
  registerScene,
  registerInput,
  registerSceneItem,
  getSceneBySlot,
  getInputBySlot,
  getSceneItemBySlot,
} from "./obsRegistry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface OBSScene {
  sceneIndex: number;
  sceneName: string;
  sceneUuid: string;
}

export interface OBSInput {
  inputKind: string;
  inputName: string;
  inputUuid: string;
  unversionedInputKind: string;
}

export interface SceneItemTransform {
  positionX?: number;
  positionY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
  boundsType?: string;
  boundsWidth?: number;
  boundsHeight?: number;
  boundsAlignment?: number;
}

export interface VideoSettings {
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export interface OBSStats {
  cpuUsage: number;
  memoryUsage: number;
  availableDiskSpace: number;
  activeFps: number;
  averageFrameRenderTime: number;
  renderSkippedFrames: number;
  renderTotalFrames: number;
  outputSkippedFrames: number;
  outputTotalFrames: number;
}

export type StatusChangeCallback = (
  status: ConnectionStatus,
  error?: string
) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class OBSService {
  private obs: OBSWebSocket;
  private _status: ConnectionStatus = "disconnected";
  private _error: string | null = null;
  private listeners: Set<StatusChangeCallback> = new Set();
  private connectLock = false; // Prevent concurrent connect attempts
  private autoReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUrl = "ws://localhost:4455";
  private lastPassword?: string;

  constructor() {
    this.obs = new OBSWebSocket();

    // When OBS closes the connection (e.g. user quits OBS), update state safely
    this.obs.on("ConnectionClosed", () => {
      console.log("[OBSService] Connection closed by OBS");
      this.connectLock = false; // Reset lock so we can reconnect later
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });

    this.obs.on("ConnectionError" as never, () => {
      console.log("[OBSService] Connection error event");
      this.connectLock = false;
      this.setStatus("error", "WebSocket connection lost");
      this.scheduleReconnect();
    });
  }

  /** Schedule an auto-reconnect attempt with exponential backoff */
  private scheduleReconnect(): void {
    if (!this.autoReconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = 5000; // 5s fixed interval
    console.log(`[OBSService] Auto-reconnect in ${delay}ms...`);
    this.reconnectTimer = setTimeout(async () => {
      if (this._status === "connected") return;
      try {
        await this.connect(this.lastUrl, this.lastPassword);
      } catch {
        // Will trigger another reconnect via ConnectionClosed/Error
      }
    }, delay);
  }

  /** Enable or disable auto-reconnect */
  setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
    if (!enabled && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Status management
  // -------------------------------------------------------------------------

  get status(): ConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status === "connected";
  }

  get error(): string | null {
    return this._error;
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(cb: StatusChangeCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(status: ConnectionStatus, error?: string): void {
    this._status = status;
    this._error = error ?? null;
    this.listeners.forEach((cb) => cb(status, error));
  }

  // -------------------------------------------------------------------------
  // Connection — SAFE: lock + disconnect-first + timeout
  // -------------------------------------------------------------------------

  /**
   * Connect to OBS WebSocket server.
   *
   * Safety guards:
   * 1. connectLock prevents concurrent connect attempts
   * 2. Always disconnects cleanly before reconnecting
   * 3. 5s timeout prevents hangs
   */
  async connect(
    url: string = "ws://localhost:4455",
    password?: string
  ): Promise<void> {
    // Guard: prevent concurrent connect attempts
    if (this.connectLock) {
      console.warn("[OBSService] Connect already in progress — ignoring");
      return;
    }

    // Guard: disconnect cleanly before reconnecting
    if (this._status === "connected") {
      console.log("[OBSService] Already connected — disconnecting first");
      await this.safeDisconnect();
    }

    // Save connection params for auto-reconnect
    this.lastUrl = url;
    this.lastPassword = password;
    this.autoReconnect = true;

    this.connectLock = true;
    this.setStatus("connecting");

    try {
      // Race between connect and 5s timeout
      const connectPromise = this.obs.connect(url, password, {
        rpcVersion: 1,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out (5s)")), 5000)
      );

      const result = await Promise.race([connectPromise, timeoutPromise]);
      console.log(
        "[OBSService] Connected — negotiated RPC version:",
        (result as { negotiatedRpcVersion: number }).negotiatedRpcVersion
      );
      this.setStatus("connected");

      // Safety: ensure OBS has at least one scene to prevent crashes
      await this.ensureSafeState();
    } catch (err: unknown) {
      const message = this.classifyConnectionError(err);
      console.error("[OBSService] Connection failed:", message);
      this.setStatus("error", message);
      throw new Error(message);
    } finally {
      this.connectLock = false;
    }
  }

  /** Cleanly disconnect from OBS. */
  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.connectLock = false;
    await this.safeDisconnect();
  }

  /** Internal safe disconnect — never throws, never crashes. */
  private async safeDisconnect(): Promise<void> {
    try {
      await this.obs.disconnect();
    } catch {
      // Ignore errors during disconnect — socket may already be closed
    }
    this.setStatus("disconnected");
    console.log("[OBSService] Disconnected");
  }

  // -------------------------------------------------------------------------
  // Phase 3 — Data Fetching
  // -------------------------------------------------------------------------

  /**
   * GetSceneList — returns all scenes in OBS.
   * OBS returns scenes in reverse order (bottom → top), so we reverse
   * to get a natural top → bottom ordering.
   */
  async getSceneList(): Promise<OBSScene[]> {
    this.ensureConnected();
    const response = await this.obs.call("GetSceneList");
    const scenes = (response.scenes as unknown as OBSScene[]).reverse();
    console.log("[OBSService] Scenes:", scenes.map((s) => s.sceneName));
    return scenes;
  }

  /**
   * GetInputList — returns all inputs (sources) globally.
   * inputKind filters are optional; passing undefined returns ALL inputs.
   */
  async getInputList(): Promise<OBSInput[]> {
    this.ensureConnected();
    const response = await this.obs.call("GetInputList");
    const inputs = response.inputs as unknown as OBSInput[];
    console.log("[OBSService] Inputs:", inputs.map((i) => i.inputName));
    return inputs;
  }

  /**
   * GetCurrentProgramScene — which scene is currently live on Program output.
   */
  async getCurrentProgramScene(): Promise<string> {
    this.ensureConnected();
    const response = await this.obs.call("GetCurrentProgramScene");
    const sceneName = response.sceneName as string;
    console.log("[OBSService] Current program scene:", sceneName);
    return sceneName;
  }

  /**
   * GetCurrentPreviewScene — which scene is loaded in the Preview output.
   * Only available when OBS is in Studio Mode.
   */
  async getCurrentPreviewScene(): Promise<string> {
    this.ensureConnected();
    const response = await this.obs.call("GetCurrentPreviewScene");
    const sceneName = response.sceneName as string;
    console.log("[OBSService] Current preview scene:", sceneName);
    return sceneName;
  }

  /**
   * SetCurrentPreviewScene — load a scene into Preview output.
   * Only available when OBS is in Studio Mode.
   */
  async setCurrentPreviewScene(sceneName: string): Promise<void> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    await this.obs.call("SetCurrentPreviewScene", { sceneName });
    console.log("[OBSService] Set preview scene:", sceneName);
  }

  /**
   * SetStudioModeEnabled — enable or disable Studio Mode.
   */
  async setStudioModeEnabled(enabled: boolean): Promise<void> {
    this.ensureConnected();
    await this.obs.call("SetStudioModeEnabled", { studioModeEnabled: enabled });
    console.log(`[OBSService] Studio mode ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * GetStudioModeEnabled — check if Studio Mode is active.
   */
  async getStudioModeEnabled(): Promise<boolean> {
    this.ensureConnected();
    const response = await this.obs.call("GetStudioModeEnabled");
    return response.studioModeEnabled as boolean;
  }

  /**
   * GetVideoSettings — returns canvas/output resolution.
   * Needed to set a source transform to fill the entire canvas.
   */
  async getVideoSettings(): Promise<VideoSettings> {
    this.ensureConnected();
    const response = await this.obs.call("GetVideoSettings");
    return {
      baseWidth: response.baseWidth as number,
      baseHeight: response.baseHeight as number,
      outputWidth: response.outputWidth as number,
      outputHeight: response.outputHeight as number,
    };
  }

  /**
   * GetStats — returns OBS performance / system statistics.
   * Available in obs-websocket 5.x via the GetStats request.
   */
  async getStats(): Promise<OBSStats> {
    this.ensureConnected();
    const r = await this.obs.call("GetStats");
    return {
      cpuUsage: r.cpuUsage as number,
      memoryUsage: r.memoryUsage as number,
      availableDiskSpace: r.availableDiskSpace as number,
      activeFps: r.activeFps as number,
      averageFrameRenderTime: r.averageFrameRenderTime as number,
      renderSkippedFrames: r.renderSkippedFrames as number,
      renderTotalFrames: r.renderTotalFrames as number,
      outputSkippedFrames: r.outputSkippedFrames as number,
      outputTotalFrames: r.outputTotalFrames as number,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 4 — Scene Creation
  // -------------------------------------------------------------------------

  /**
   * CreateScene — creates a new scene in OBS.
   * Throws if the scene already exists (OBS returns error 601).
   */
  async createScene(sceneName: string): Promise<void> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    await this.obs.call("CreateScene", { sceneName });
    console.log(`[OBSService] Created scene: "${sceneName}"`);
  }

  /**
   * CreateSceneItem — adds an existing input/source to a scene.
   *
   * @returns The sceneItemId (integer) needed for transforms.
   *
   * Why sourceName? In obs-websocket v5, CreateSceneItem expects
   * `sourceName` — the name of the input/source to reference.
   */
  async createSceneItem(
    sceneName: string,
    sourceName: string
  ): Promise<number> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    this.requireString(sourceName, "sourceName");
    const response = await this.obs.call("CreateSceneItem", {
      sceneName,
      sourceName,
      sceneItemEnabled: true,
    });
    const id = response.sceneItemId as number;
    console.log(
      `[OBSService] Added "${sourceName}" to "${sceneName}" → sceneItemId: ${id}`
    );
    return id;
  }

  /**
   * SetSceneItemTransform — positions/scales a scene item.
   *
   * Sends the transform properties exactly as given.
   * Callers are responsible for providing the correct combination
   * of scale, crop, bounds, and position for their use case.
   */
  async setSceneItemTransform(
    sceneName: string,
    sceneItemId: number,
    transform: SceneItemTransform
  ): Promise<void> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    await this.obs.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: transform as unknown as Record<string, never>,
    });
    console.log(
      `[OBSService] Set transform for item ${sceneItemId} in "${sceneName}"`
    );
  }

  /**
   * GetSceneItemTransform — read the current transform of a scene item.
   * Returns sourceWidth/sourceHeight (native resolution), current scale, crop, bounds, etc.
   */
  async getSceneItemTransform(
    sceneName: string,
    sceneItemId: number
  ): Promise<Record<string, unknown>> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    const response = await this.obs.call("GetSceneItemTransform", {
      sceneName,
      sceneItemId,
    } as never);
    return (response as Record<string, unknown>).sceneItemTransform as Record<string, unknown>;
  }

  /**
   * GetSourceScreenshot — capture a screenshot of any source/scene.
   *
   * @param sourceName  The input or scene name to screenshot.
   * @param imageWidth  Optional width (OBS preserves aspect ratio).
   * @returns           A `data:image/png;base64,...` string for `<img src>`, or null on error.
   */
  async getSourceScreenshot(
    sourceName: string,
    imageWidth?: number
  ): Promise<string | null> {
    try {
      this.ensureConnected();
      this.requireString(sourceName, "sourceName");
      const params: Record<string, unknown> = {
        sourceName,
        imageFormat: "png",
      };
      if (imageWidth) params.imageWidth = imageWidth;
      const resp = await this.obs.call("GetSourceScreenshot" as never, params as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (resp as any).imageData as string;
    } catch {
      // Source may be offline, not rendering, etc. — don't spam errors
      return null;
    }
  }

  /**
   * Generic call pass-through for advanced OBS requests.
   * Used by layoutService for calls like GetSceneItemId.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call(requestType: string, requestData?: Record<string, any>): Promise<any> {
    this.ensureConnected();
    this.requireString(requestType, "requestType");
    // Defensively strip null/undefined string values from request data
    // to prevent obs-websocket SIGSEGV crashes on strlen(NULL)
    if (requestData) {
      for (const [key, value] of Object.entries(requestData)) {
        if (value === null || value === undefined) {
          throw new Error(`OBS request "${requestType}": parameter "${key}" is null/undefined`);
        }
        if (typeof value === "string" && value.trim() === "" && ["sceneName", "sourceName", "inputName", "sceneUuid", "inputUuid"].includes(key)) {
          throw new Error(`OBS request "${requestType}": required string "${key}" is empty`);
        }
      }
    }
    return this.obs.call(requestType as never, requestData as never);
  }

  /**
   * Subscribe to raw OBS WebSocket events. Returns an unsubscribe function.
   * Useful for audio monitoring, scene change events, etc.
   */
  on(event: string, handler: (...args: any[]) => void): () => void {
    this.obs.on(event as never, handler as never);
    return () => { this.obs.off(event as never, handler as never); };
  }

  /**
   * SetCurrentProgramScene — switch the live output to a scene.
   */
  async setCurrentProgramScene(sceneName: string): Promise<void> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    await this.obs.call("SetCurrentProgramScene", { sceneName });
    console.log(`[OBSService] Switched program to: "${sceneName}"`);
  }

  // -------------------------------------------------------------------------
  // Phase 5 — Layout Engine Helpers
  // -------------------------------------------------------------------------

  /**
   * SetInputSettings — update settings on an existing input/source.
   * Used for color sources (color), image sources (file), etc.
   */
  async setInputSettings(
    inputName: string,
    inputSettings: Record<string, unknown>,
    overlay = true
  ): Promise<void> {
    this.ensureConnected();
    this.requireString(inputName, "inputName");
    await this.obs.call("SetInputSettings", {
      inputName,
      inputSettings: inputSettings as never,
      overlay,
    } as never);
    console.log(
      `[OBSService] SetInputSettings "${inputName}":`,
      inputSettings
    );
  }

  /**
   * CreateInput — create a new input/source and add it to a scene in one call.
   * Returns the sceneItemId for transforms.
   *
   * @param sceneName  Scene to add the input to
   * @param inputName  Name for the new input
   * @param inputKind  OBS input kind (e.g. "color_source_v3", "image_source")
   * @param inputSettings  Initial settings for the input
   */
  async createInput(
    sceneName: string,
    inputName: string,
    inputKind: string,
    inputSettings: Record<string, unknown> = {}
  ): Promise<number> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    this.requireString(inputName, "inputName");
    this.requireString(inputKind, "inputKind");
    const response = await this.obs.call("CreateInput", {
      sceneName,
      inputName,
      inputKind,
      inputSettings: inputSettings as never,
      sceneItemEnabled: true,
    } as never);
    const id = (response as Record<string, unknown>).sceneItemId as number;
    console.log(
      `[OBSService] CreateInput "${inputName}" (${inputKind}) in "${sceneName}" → sceneItemId: ${id}`
    );
    return id;
  }

  /**
   * GetSceneItemList — list all scene items in a scene.
   * Returns array of { sceneItemId, sourceName, inputKind, ... }
   */
  async getSceneItemList(
    sceneName: string
  ): Promise<Array<{ sceneItemId: number; sourceName: string; inputKind: string }>> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    const response = await this.obs.call("GetSceneItemList", { sceneName });
    const items = (response as Record<string, unknown>).sceneItems as Array<{
      sceneItemId: number;
      sourceName: string;
      inputKind: string;
    }>;
    console.log(
      `[OBSService] SceneItems in "${sceneName}":`,
      items.map((i) => `${i.sourceName} (#${i.sceneItemId})`)
    );
    return items;
  }

  /**
   * SetSceneItemIndex — reorder a scene item's z-index.
   * index=0 is bottom layer, higher = closer to top.
   */
  async setSceneItemIndex(
    sceneName: string,
    sceneItemId: number,
    sceneItemIndex: number
  ): Promise<void> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    await this.obs.call("SetSceneItemIndex", {
      sceneName,
      sceneItemId,
      sceneItemIndex,
    } as never);
    console.log(
      `[OBSService] SetSceneItemIndex item #${sceneItemId} in "${sceneName}" → index ${sceneItemIndex}`
    );
  }

  // -------------------------------------------------------------------------
  // Registry-aware creation methods
  // -------------------------------------------------------------------------

  /**
   * Create a scene and register it in the OBS registry.
   * Returns the sceneUuid for future reference.
   *
   * @param sceneName  Name for the new scene
   * @param slot       Registry slot identifier (e.g. "bible-overlay", "mv-layout-3")
   */
  async createSceneRegistered(
    sceneName: string,
    slot: string
  ): Promise<{ sceneName: string; sceneUuid: string }> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    this.requireString(slot, "slot");

    await this.obs.call("CreateScene", { sceneName });
    console.log(`[OBSService] Created scene: "${sceneName}"`);

    // Fetch the scene UUID from OBS
    const scenes = await this.getSceneList();
    const created = scenes.find((s) => s.sceneName === sceneName);
    if (!created) {
      throw new Error(`Scene "${sceneName}" was created but not found in scene list`);
    }

    // Register in persistent registry
    await registerScene(slot, created.sceneUuid, sceneName);

    return { sceneName, sceneUuid: created.sceneUuid };
  }

  /**
   * Create an input (source) and register it in the OBS registry.
   * Returns the sceneItemId and inputUuid.
   *
   * @param sceneName      Scene to add the input to
   * @param inputName      Name for the new input
   * @param inputKind      OBS input kind (e.g. "browser_source")
   * @param inputSettings  Initial settings
   * @param sceneSlot      Registry slot for the parent scene
   * @param inputSlot      Registry slot for this input
   */
  async createInputRegistered(
    sceneName: string,
    inputName: string,
    inputKind: string,
    inputSettings: Record<string, unknown>,
    sceneSlot: string,
    inputSlot: string
  ): Promise<{ sceneItemId: number; inputUuid: string }> {
    this.ensureConnected();
    this.requireString(sceneName, "sceneName");
    this.requireString(inputName, "inputName");
    this.requireString(inputKind, "inputKind");

    const sceneItemId = await this.createInput(sceneName, inputName, inputKind, inputSettings);

    // Fetch the input UUID from OBS
    const inputs = await this.getInputList();
    const created = inputs.find((i) => i.inputName === inputName);
    if (!created) {
      throw new Error(`Input "${inputName}" was created but not found in input list`);
    }

    // Get the scene UUID
    const scenes = await this.getSceneList();
    const parentScene = scenes.find((s) => s.sceneName === sceneName);
    const sceneUuid = parentScene?.sceneUuid ?? "";

    // Register input and scene item in persistent registry
    await registerInput(inputSlot, created.inputUuid, inputName, inputKind);
    await registerSceneItem(
      `${sceneSlot}:${inputSlot}`,
      sceneSlot,
      inputSlot,
      sceneItemId,
      sceneUuid
    );

    return { sceneItemId, inputUuid: created.inputUuid };
  }

  /**
   * Add an existing input to a scene and register the scene item.
   *
   * @param sceneName    Scene to add the source to
   * @param sourceName   Name of the existing source
   * @param sceneSlot    Registry slot for the parent scene
   * @param inputSlot    Registry slot for the input
   */
  async createSceneItemRegistered(
    sceneName: string,
    sourceName: string,
    sceneSlot: string,
    inputSlot: string
  ): Promise<number> {
    const sceneItemId = await this.createSceneItem(sceneName, sourceName);

    // Get the scene UUID
    const scenes = await this.getSceneList();
    const parentScene = scenes.find((s) => s.sceneName === sceneName);
    const sceneUuid = parentScene?.sceneUuid ?? "";

    await registerSceneItem(
      `${sceneSlot}:${inputSlot}`,
      sceneSlot,
      inputSlot,
      sceneItemId,
      sceneUuid
    );

    return sceneItemId;
  }

  /**
   * Look up a registered scene by slot and verify it still exists in OBS.
   * Returns the current scene name (which may have been renamed by the user).
   */
  async findRegisteredScene(
    slot: string
  ): Promise<{ sceneName: string; sceneUuid: string } | null> {
    const reg = await getSceneBySlot(slot);
    if (!reg) return null;

    try {
      const scenes = await this.getSceneList();
      const found = scenes.find((s) => s.sceneUuid === reg.sceneUuid);
      if (found) {
        return { sceneName: found.sceneName, sceneUuid: found.sceneUuid };
      }
    } catch {
      // Not connected or error — return null
    }

    return null;
  }

  /**
   * Look up a registered input by slot and verify it still exists in OBS.
   * Returns the current input name (which may have been renamed).
   */
  async findRegisteredInput(
    slot: string
  ): Promise<{ inputName: string; inputUuid: string } | null> {
    const reg = await getInputBySlot(slot);
    if (!reg) return null;

    try {
      const inputs = await this.getInputList();
      const found = inputs.find((i) => i.inputUuid === reg.inputUuid);
      if (found) {
        return { inputName: found.inputName, inputUuid: found.inputUuid };
      }
    } catch {
      // Not connected or error
    }

    return null;
  }

  /**
   * Look up a registered scene item by slot.
   */
  async findRegisteredSceneItem(
    slot: string
  ): Promise<{ sceneItemId: number; sceneUuid: string } | null> {
    const reg = await getSceneItemBySlot(slot);
    if (!reg) return null;
    return { sceneItemId: reg.sceneItemId, sceneUuid: reg.sceneUuid };
  }

  // -------------------------------------------------------------------------
  // Safety: ensure OBS is in a non-crashing state
  // -------------------------------------------------------------------------

  /**
   * Ensure OBS has at least one scene with one source.
   * OBS can crash (SIGSEGV) if the app tries to query scenes/sources
   * when none exist. This creates a "Default" scene with a black color
   * source if needed.
   */
  private async ensureSafeState(): Promise<void> {
    try {
      const response = await this.obs.call("GetSceneList");
      const scenes = response.scenes as unknown as OBSScene[];
      if (scenes.length > 0) return; // OBS has scenes — safe

      console.warn("[OBSService] OBS has no scenes — creating a default scene to prevent crashes");

      // Create a default scene
      const defaultSceneName = "Default Scene";
      await this.obs.call("CreateScene", { sceneName: defaultSceneName });

      // Add a black color source so the scene isn't completely empty
      await this.obs.call("CreateInput", {
        sceneName: defaultSceneName,
        inputName: "Black Background",
        inputKind: "color_source_v3",
        inputSettings: { color: 0xff000000 },
        sceneItemEnabled: true,
      } as never);

      // Set the default scene as program
      await this.obs.call("SetCurrentProgramScene", { sceneName: defaultSceneName });

      console.log(`[OBSService] Created "${defaultSceneName}" with a black color source`);
    } catch (err) {
      // Non-fatal — log and continue
      console.warn("[OBSService] ensureSafeState failed (non-fatal):", err);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private ensureConnected(): void {
    if (this._status !== "connected") {
      throw new Error("Not connected to OBS. Call connect() first.");
    }
  }

  /**
   * Guard: throw if any required string parameter is null, undefined, or empty.
   * Prevents sending empty strings to obs-websocket which can cause a SIGSEGV
   * (null-pointer crash in the obs-websocket C++ strlen call).
   */
  private requireString(value: unknown, paramName: string): asserts value is string {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      throw new Error(`Required parameter "${paramName}" is empty or missing`);
    }
    if (typeof value !== "string") {
      throw new Error(`Required parameter "${paramName}" must be a string, got ${typeof value}`);
    }
  }

  /**
   * Classify the raw error from obs-websocket-js into a user-friendly message.
   */
  private classifyConnectionError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();

    if (lower.includes("econnrefused") || lower.includes("connect failed")) {
      return "Connection refused — is OBS running with WebSocket server enabled on this port?";
    }
    if (
      lower.includes("authentication") ||
      lower.includes("auth") ||
      lower.includes("password")
    ) {
      return "Authentication failed — check your WebSocket server password in OBS → Tools → WebSocket Server Settings.";
    }
    if (lower.includes("timeout") || lower.includes("timed out")) {
      return "Connection timed out — verify OBS is running and the port is correct.";
    }
    // Fallback: show the raw error
    return `Connection error: ${raw}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const obsService = new OBSService();
