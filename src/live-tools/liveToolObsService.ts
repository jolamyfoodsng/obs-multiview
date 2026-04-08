import { obsService } from "../services/obsService";
import { getOverlayBaseUrl } from "../services/overlayUrl";
import type { LiveToolOverlayPayload, LiveToolTemplate } from "./types";

const LIVE_TOOL_SOURCE = "⛪ OCS Live Tools";
const PREVIEW_LIVE_TOOL_SOURCE = "⛪ OCS Preview Live Tools";
const LIVE_TOOL_MEDIA_VIDEO_SOURCE = "⛪ OCS Live Tools Media Video";
const LIVE_TOOL_MEDIA_IMAGE_SOURCE = "⛪ OCS Live Tools Media Image";
const PREVIEW_LIVE_TOOL_MEDIA_VIDEO_SOURCE = "⛪ OCS Preview Live Tools Media Video";
const PREVIEW_LIVE_TOOL_MEDIA_IMAGE_SOURCE = "⛪ OCS Preview Live Tools Media Image";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

function getResources(live: boolean) {
  return live
    ? {
      overlaySource: LIVE_TOOL_SOURCE,
      videoSource: LIVE_TOOL_MEDIA_VIDEO_SOURCE,
      imageSource: LIVE_TOOL_MEDIA_IMAGE_SOURCE,
    }
    : {
      overlaySource: PREVIEW_LIVE_TOOL_SOURCE,
      videoSource: PREVIEW_LIVE_TOOL_MEDIA_VIDEO_SOURCE,
      imageSource: PREVIEW_LIVE_TOOL_MEDIA_IMAGE_SOURCE,
    };
}

function buildOverlayPayload(tool: LiveToolTemplate): LiveToolOverlayPayload {
  return {
    kind: tool.kind,
    label: tool.label,
    title: tool.title,
    subtitle: tool.subtitle,
    body: tool.body,
    cta: tool.cta,
    durationSeconds: tool.durationSeconds,
    backgroundColor: tool.backgroundColor,
    backgroundMediaUrl: tool.backgroundMediaUrl,
    lowerThird: tool.kind === "lower-third",
    timestamp: Date.now(),
  };
}

async function getTargetScene(live: boolean): Promise<string> {
  if (live) {
    return obsService.getCurrentProgramScene();
  }

  try {
    const studioMode = await obsService.getStudioModeEnabled();
    if (!studioMode) {
      await obsService.setStudioModeEnabled(true);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    return await obsService.getCurrentPreviewScene();
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Could not prepare OBS Preview.");
  }
}

async function switchSceneToTarget(sceneName: string, live: boolean): Promise<void> {
  if (live) {
    await obsService.setCurrentProgramScene(sceneName);
    return;
  }

  try {
    const studioMode = await obsService.getStudioModeEnabled();
    if (!studioMode) {
      await obsService.setStudioModeEnabled(true);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  } catch {
    // Let SetCurrentPreviewScene surface the final OBS error.
  }
  await obsService.setCurrentPreviewScene(sceneName);
}

async function ensureSceneItem(
  sceneName: string,
  sourceName: string,
  inputKind: string,
  inputSettings: Record<string, unknown>,
): Promise<number> {
  const inputs = await obsService.getInputList();
  const existingInput = inputs.find((input) => input.inputName === sourceName);
  let inputExists = Boolean(existingInput);

  if (existingInput && existingInput.inputKind !== inputKind) {
    try {
      await obsService.call("RemoveInput", { inputName: sourceName });
      inputExists = false;
    } catch {
      inputExists = true;
    }
  }

  if (inputExists) {
    await obsService.setInputSettings(sourceName, inputSettings);
  }

  const sceneItems = await obsService.getSceneItemList(sceneName);
  let sceneItem = sceneItems.find((item) => item.sourceName === sourceName);

  if (!sceneItem) {
    if (inputExists) {
      const sceneItemId = await obsService.createSceneItem(sceneName, sourceName);
      sceneItem = { sourceName, sceneItemId, inputKind };
    } else {
      const sceneItemId = await obsService.createInput(sceneName, sourceName, inputKind, inputSettings);
      sceneItem = { sourceName, sceneItemId, inputKind };
    }
  }

  const video = await obsService.getVideoSettings();
  await obsService.setSceneItemTransform(sceneName, sceneItem.sceneItemId, {
    positionX: 0,
    positionY: 0,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsWidth: video.baseWidth,
    boundsHeight: video.baseHeight,
    boundsAlignment: 0,
  });

  const updatedItems = await obsService.getSceneItemList(sceneName);
  const topIndex = Math.max(0, updatedItems.length - 1);
  await obsService.setSceneItemIndex(sceneName, sceneItem.sceneItemId, topIndex);
  await obsService.call("SetSceneItemEnabled", {
    sceneName,
    sceneItemId: sceneItem.sceneItemId,
    sceneItemEnabled: true,
  });
  return sceneItem.sceneItemId;
}

async function hideSource(sceneName: string, sourceName: string): Promise<void> {
  try {
    const items = await obsService.getSceneItemList(sceneName);
    const item = items.find((candidate) => candidate.sourceName === sourceName);
    if (!item) return;
    await obsService.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: false,
    });
  } catch {
    // Best-effort cleanup.
  }
}

async function hideManagedSources(sceneName: string): Promise<void> {
  const items = await obsService.getSceneItemList(sceneName);
  await Promise.all(items.map(async (item) => {
    if (!item.sourceName.includes("OCS")) return;
    try {
      await obsService.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: false,
      });
    } catch {
      // Best-effort safety action.
    }
  }));
}

async function pushTemplate(tool: LiveToolTemplate, live: boolean): Promise<void> {
  const resources = getResources(live);
  const sceneName = await getTargetScene(live);
  if (!sceneName) throw new Error("Could not determine OBS target scene.");

  await hideSource(sceneName, resources.videoSource);
  await hideSource(sceneName, resources.imageSource);

  const baseUrl = await getOverlayBaseUrl();
  const payload = buildOverlayPayload(tool);
  const url = `${baseUrl}/live-tool-overlay.html#data=${encodeURIComponent(JSON.stringify(payload))}`;
  await ensureSceneItem(sceneName, resources.overlaySource, "browser_source", {
    url,
    width: 1920,
    height: 1080,
    css: "",
    shutdown: false,
    restart_when_active: false,
  });
}

async function pushMediaLoop(tool: LiveToolTemplate, live: boolean): Promise<void> {
  if (!tool.backgroundMediaPath) {
    await pushTemplate({
      ...tool,
      title: tool.title || "Select media in Edit",
      subtitle: tool.subtitle || "No media is attached to this Live Tool yet.",
      kind: "fullscreen",
    }, live);
    return;
  }

  const resources = getResources(live);
  const sceneName = await getTargetScene(live);
  if (!sceneName) throw new Error("Could not determine OBS target scene.");
  await hideSource(sceneName, resources.overlaySource);

  const fileName = tool.backgroundMediaName || tool.backgroundMediaPath;
  const image = isImageFile(fileName);
  if (image) {
    await hideSource(sceneName, resources.videoSource);
    await ensureSceneItem(sceneName, resources.imageSource, "image_source", {
      file: tool.backgroundMediaPath,
    });
    return;
  }

  await hideSource(sceneName, resources.imageSource);
  await ensureSceneItem(sceneName, resources.videoSource, "ffmpeg_source", {
    local_file: tool.backgroundMediaPath,
    is_local_file: true,
    looping: true,
    restart_on_activate: true,
    close_when_inactive: false,
    hw_decode: true,
  });
  try {
    await obsService.call("TriggerMediaInputAction", {
      inputName: resources.videoSource,
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
    });
  } catch {
    // Non-fatal.
  }
}

async function runSafetyAction(tool: LiveToolTemplate, live: boolean): Promise<void> {
  const sceneName = await getTargetScene(live);
  if (!sceneName) throw new Error("Could not determine OBS target scene.");

  if (tool.action === "hide-overlays") {
    await hideManagedSources(sceneName);
    return;
  }

  if (tool.action === "mute-mic" && tool.sourceName) {
    await obsService.call("SetInputMute", {
      inputName: tool.sourceName,
      inputMuted: true,
    });
    return;
  }

  if (tool.action === "mute-mic") {
    throw new Error("Choose a mic source in Edit before using Mute Mic.");
  }

  if (tool.action === "safe-scene" && tool.sceneName) {
    await switchSceneToTarget(tool.sceneName, live);
    return;
  }

  if (tool.action === "safe-scene") {
    throw new Error("Choose a safe OBS scene in Edit before using Safe Scene.");
  }

  await pushTemplate(tool, live);
}

export async function sendLiveToolToObs(tool: LiveToolTemplate, live: boolean): Promise<void> {
  if (!obsService.isConnected) {
    throw new Error("OBS is not connected.");
  }

  if (tool.kind === "scene" && tool.sceneName) {
    await switchSceneToTarget(tool.sceneName, live);
    return;
  }

  if (tool.kind === "scene") {
    throw new Error("Choose an OBS scene in Edit before using this tool.");
  }

  if (tool.kind === "media-loop") {
    await pushMediaLoop(tool, live);
    return;
  }

  if (tool.kind === "safety-action") {
    await runSafetyAction(tool, live);
    return;
  }

  await pushTemplate(tool, live);
}

export async function clearLiveToolTarget(live: boolean): Promise<void> {
  if (!obsService.isConnected) return;
  const resources = getResources(live);
  const sceneName = await getTargetScene(live);
  if (!sceneName) return;
  await hideSource(sceneName, resources.overlaySource);
  await hideSource(sceneName, resources.videoSource);
  await hideSource(sceneName, resources.imageSource);
}

export async function clearAllLiveTools(): Promise<void> {
  await Promise.all([clearLiveToolTarget(false), clearLiveToolTarget(true)]);
}
