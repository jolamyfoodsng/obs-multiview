import { obsService } from "../services/obsService";
import type {
  PreServiceCountdownStep,
  PreServiceMediaStep,
  PreServiceSceneStep,
  PreServiceStep,
  PreServiceTransition,
} from "./types";

/* ═══════════════════════════════════════════════════════════════════
   SINGLE-SCENE PRE-SERVICE ENGINE
   ═══════════════════════════════════════════════════════════════════
   All pre-service steps live as sources (overlays) inside ONE OBS scene
   called OCS_PreService.  The engine creates/updates each source,
   hides them all, then shows only the active source at any time.
   When a step's countdown finishes the source is hidden and the next
   source is revealed — no scene switching needed.
   ═══════════════════════════════════════════════════════════════════ */

const PRESERVICE_SCENE = "OCS_PreService";

/* ── helpers ── */

const IMAGE_EXT = /\.(png|jpg|jpeg|gif|bmp|svg|webp|tiff)$/i;

function isImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url);
}

function toLocalPath(url: string): string {
  if (url.startsWith("file:///")) return url.slice(7);
  if (url.startsWith("file://"))  return url.slice(7);
  return url;
}

function toTransitionName(transition: PreServiceTransition | undefined): string {
  if (transition === "fade") return "Fade";
  return "Cut";
}

async function setTransition(transition: PreServiceTransition | undefined): Promise<void> {
  if (!obsService.isConnected) return;
  try {
    await obsService.call("SetCurrentSceneTransition", {
      transitionName: toTransitionName(transition),
    });
    if (transition === "fade") {
      await obsService.call("SetCurrentSceneTransitionDuration", {
        transitionDuration: 350,
      });
    }
  } catch {
    // Non-fatal
  }
}

/* ── Scene helpers ── */

async function ensureScene(sceneName: string): Promise<void> {
  const scenes = await obsService.getSceneList();
  if (scenes.some((s) => s.sceneName === sceneName)) return;
  await obsService.createScene(sceneName);
}

async function stretchToCanvas(sceneName: string, sceneItemId: number): Promise<void> {
  try {
    const video = await obsService.getVideoSettings();
    await obsService.setSceneItemTransform(sceneName, sceneItemId, {
      positionX: 0,
      positionY: 0,
      boundsType: "OBS_BOUNDS_STRETCH",
      boundsWidth: video.baseWidth,
      boundsHeight: video.baseHeight,
      boundsAlignment: 0,
    });
  } catch (err) {
    console.warn("[OCS] Could not stretch source to canvas:", err);
  }
}

/**
 * Create or update a source in the pre-service scene.
 * Returns the sceneItemId so we can enable/disable it.
 */
async function ensureSource(
  sourceName: string,
  inputKind: string,
  inputSettings: Record<string, unknown>,
): Promise<number> {
  await ensureScene(PRESERVICE_SCENE);

  const inputs = await obsService.getInputList();
  const sourceExists = inputs.some((inp) => inp.inputName === sourceName);

  let sceneItemId: number;

  if (!sourceExists) {
    sceneItemId = await obsService.createInput(
      PRESERVICE_SCENE, sourceName, inputKind, inputSettings,
    );
  } else {
    const resp = await obsService.call("GetSceneItemList", {
      sceneName: PRESERVICE_SCENE,
    }) as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> };

    const existing = resp.sceneItems.find((i) => i.sourceName === sourceName);
    if (existing) {
      sceneItemId = existing.sceneItemId;
    } else {
      sceneItemId = await obsService.createSceneItem(PRESERVICE_SCENE, sourceName);
    }

    await obsService.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings,
    });
  }

  await stretchToCanvas(PRESERVICE_SCENE, sceneItemId);
  return sceneItemId;
}

/** Enable or disable a scene item in OCS_PreService */
async function setSourceEnabled(sceneItemId: number, enabled: boolean): Promise<void> {
  try {
    await obsService.call("SetSceneItemEnabled", {
      sceneName: PRESERVICE_SCENE,
      sceneItemId,
      sceneItemEnabled: enabled,
    });
  } catch {
    // Non-fatal
  }
}

/** Track step indices for on-the-fly source creation */
let nextAutoIndex = 0;

/* ═══════════════════════════════════════════════════════════════════
   Source name convention — unique per step so they can coexist
   ═══════════════════════════════════════════════════════════════════ */

function sourceNameForStep(step: PreServiceStep, index: number): string {
  const safe = (step.label || step.type).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
  return `OCS_PS_${String(index).padStart(2, "0")}_${safe}`;
}

/* ═══════════════════════════════════════════════════════════════════
   Source creation per step type
   ═══════════════════════════════════════════════════════════════════ */

async function createMediaSource(
  step: PreServiceMediaStep,
  sourceName: string,
): Promise<number> {
  const localPath = toLocalPath(step.mediaUrl);

  if (isImageUrl(step.mediaUrl)) {
    return ensureSource(sourceName, "image_source", { file: localPath });
  }

  return ensureSource(sourceName, "ffmpeg_source", {
    local_file: localPath,
    is_local_file: true,
    looping: true,
    restart_on_activate: true,
    close_when_inactive: false,
    hw_decode: true,
  });
}

async function createCountdownSource(
  step: PreServiceCountdownStep,
  sourceName: string,
): Promise<number> {
  const payload = {
    label: step.label,
    seconds: step.seconds,
    theme: step.theme || "classic",
    timestamp: Date.now(),
  };
  const { getOverlayBaseUrlSync } = await import("../services/overlayUrl");
  const encoded = encodeURIComponent(JSON.stringify(payload));
  const url = `${getOverlayBaseUrlSync()}/pre-service-countdown.html#data=${encoded}`;

  return ensureSource(sourceName, "browser_source", {
    url,
    width: 1920,
    height: 1080,
    css: "",
    shutdown: false,
    restart_when_active: false,
  });
}

async function createSceneSourceRef(
  targetSceneName: string,
): Promise<number> {
  await ensureScene(PRESERVICE_SCENE);
  await ensureScene(targetSceneName);

  const resp = await obsService.call("GetSceneItemList", {
    sceneName: PRESERVICE_SCENE,
  }) as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> };

  const existing = resp.sceneItems.find((i) => i.sourceName === targetSceneName);
  if (existing) return existing.sceneItemId;

  const sceneItemId = await obsService.createSceneItem(PRESERVICE_SCENE, targetSceneName);
  await stretchToCanvas(PRESERVICE_SCENE, sceneItemId);
  return sceneItemId;
}

/* ═══════════════════════════════════════════════════════════════════
   Step-item tracking (maps step id → sceneItemId)
   ═══════════════════════════════════════════════════════════════════ */

const stepItemMap = new Map<string, { sceneItemId: number; sourceName: string }>();
let activeStepId: string | null = null;
let sceneOnProgram = false;

/**
 * Set up all steps as sources in OCS_PreService.
 * Call this once when the sequence starts.
 */
export async function setupPreServiceScene(steps: readonly PreServiceStep[]): Promise<void> {
  if (!obsService.isConnected) throw new Error("OBS is not connected");

  await ensureScene(PRESERVICE_SCENE);
  stepItemMap.clear();
  activeStepId = null;
  sceneOnProgram = false;
  nextAutoIndex = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === "goLive") {
      continue;
    }
    const sourceName = sourceNameForStep(step, i);
    let sceneItemId: number;

    if (step.type === "media") {
      sceneItemId = await createMediaSource(step, sourceName);
    } else if (step.type === "countdown") {
      sceneItemId = await createCountdownSource(step, sourceName);
    } else {
      sceneItemId = await createSceneSourceRef(step.sceneName);
    }

    // Start all sources hidden
    await setSourceEnabled(sceneItemId, false);
    stepItemMap.set(step.id, { sceneItemId, sourceName });
  }
}

/**
 * Activate a step — show its source and hide the previously active one.
 * Switches to OCS_PreService on the first call.
 */
export async function activateStep(
  step: PreServiceStep,
  _durationSeconds: number,
): Promise<void> {
  if (!obsService.isConnected) throw new Error("OBS is not connected");

  // Ensure the scene exists (auto-create if not found)
  await ensureScene(PRESERVICE_SCENE);

  // Hide the previously active source
  if (activeStepId && stepItemMap.has(activeStepId)) {
    const prev = stepItemMap.get(activeStepId)!;
    await setSourceEnabled(prev.sceneItemId, false);
  }

  // Platform-only go live steps do not render an OBS source.
  if (step.type === "goLive") {
    activeStepId = null;
    return;
  }

  // Auto-create the source on-the-fly if setupPreServiceScene was not called
  if (!stepItemMap.has(step.id)) {
    const idx = nextAutoIndex++;
    const sourceName = sourceNameForStep(step, idx);
    let sceneItemId: number;

    if (step.type === "media") {
      sceneItemId = await createMediaSource(step as PreServiceMediaStep, sourceName);
    } else if (step.type === "countdown") {
      sceneItemId = await createCountdownSource(step as PreServiceCountdownStep, sourceName);
    } else {
      sceneItemId = await createSceneSourceRef((step as PreServiceSceneStep).sceneName);
    }

    await setSourceEnabled(sceneItemId, false);
    stepItemMap.set(step.id, { sceneItemId, sourceName });
  }

  // Show the new source
  const entry = stepItemMap.get(step.id);
  if (entry) {
    // For countdown sources, update the browser URL with a fresh timestamp
    if (step.type === "countdown") {
      const payload = {
        label: step.label,
        seconds: (step as PreServiceCountdownStep).seconds,
        theme: (step as PreServiceCountdownStep).theme || "classic",
        timestamp: Date.now(),
      };
      const { getOverlayBaseUrlSync } = await import("../services/overlayUrl");
      const encoded = encodeURIComponent(JSON.stringify(payload));
      const url = `${getOverlayBaseUrlSync()}/pre-service-countdown.html#data=${encoded}`;
      await obsService.call("SetInputSettings", {
        inputName: entry.sourceName,
        inputSettings: { url },
      });
    }

    await setSourceEnabled(entry.sceneItemId, true);
    activeStepId = step.id;

    // For video sources, force playback restart
    if (step.type === "media" && !isImageUrl((step as PreServiceMediaStep).mediaUrl)) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        await obsService.call("TriggerMediaInputAction", {
          inputName: entry.sourceName,
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        });
      } catch {
        // Non-fatal
      }
    }
  }

  // Switch to OCS_PreService on the first activation
  if (!sceneOnProgram) {
    await setTransition(step.transition);

    try {
      const studioMode = await obsService.getStudioModeEnabled();
      if (!studioMode) {
        await obsService.setStudioModeEnabled(true);
      }
      await obsService.setCurrentPreviewScene(PRESERVICE_SCENE);
    } catch {
      await obsService.setCurrentProgramScene(PRESERVICE_SCENE);
    }
    sceneOnProgram = true;
  }

  // Extra restart for video after scene is settled
  if (step.type === "media" && entry && !isImageUrl((step as PreServiceMediaStep).mediaUrl)) {
    try {
      await new Promise((r) => setTimeout(r, 150));
      await obsService.call("TriggerMediaInputAction", {
        inputName: entry.sourceName,
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
      });
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Deactivate (hide) a step's source after its countdown/duration completes.
 */
export async function deactivateStep(step: PreServiceStep): Promise<void> {
  const entry = stepItemMap.get(step.id);
  if (entry) {
    await setSourceEnabled(entry.sceneItemId, false);
  }
  if (activeStepId === step.id) {
    activeStepId = null;
  }
}

/**
 * Clean up: hide all sources and reset tracking.
 * Called when the sequence is stopped/reset.
 */
export async function teardownPreServiceScene(): Promise<void> {
  for (const [, entry] of stepItemMap) {
    try {
      await setSourceEnabled(entry.sceneItemId, false);
    } catch {
      // Non-fatal
    }
  }
  stepItemMap.clear();
  activeStepId = null;
  sceneOnProgram = false;
  nextAutoIndex = 0;
}

/* ═══════════════════════════════════════════════════════════════════
   Legacy public API — kept for backwards compatibility
   ═══════════════════════════════════════════════════════════════════ */

/**
 * @deprecated Use setupPreServiceScene + activateStep instead.
 */
export async function runPreServiceStep(
  step: PreServiceStep,
  durationSeconds: number,
): Promise<void> {
  await activateStep(step, durationSeconds);
}

/**
 * @deprecated Use setupPreServiceScene + activateStep instead.
 */
export async function runPreServiceStepToPreview(
  step: PreServiceStep,
  durationSeconds: number,
): Promise<void> {
  await activateStep(step, durationSeconds);
}

export async function runGoLive(mainSceneName: string): Promise<void> {
  if (!obsService.isConnected) throw new Error("OBS is not connected");

  // Hide all pre-service sources
  await teardownPreServiceScene();

  // Switch to the main live scene
  await setTransition("cut");
  await obsService.setCurrentProgramScene(mainSceneName);
}

/**
 * Trigger the Studio Mode transition — moves Preview → Program.
 */

export async function triggerGoLiveTransition(): Promise<void> {
  if (!obsService.isConnected) throw new Error("OBS is not connected");

  try {
    const studioMode = await obsService.getStudioModeEnabled();
    if (!studioMode) return;
    await obsService.call("TriggerStudioModeTransition", {});
  } catch (err) {
    console.warn("[OCS] TriggerStudioModeTransition failed:", err);
    throw new Error("Failed to transition to live. Check OBS Studio Mode.");
  }
}

export async function listAvailableScenes(): Promise<string[]> {
  if (!obsService.isConnected) return [];
  const scenes = await obsService.getSceneList();
  return scenes.map((scene) => scene.sceneName);
}
