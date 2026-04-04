import { normalizeDockStageBaseScene } from "./dockSceneNames";
import { obsService } from "./obsService";

export function getDisplaySceneName(sceneName: string): string {
  return normalizeDockStageBaseScene(sceneName);
}

export async function getRawProgramScene(fallback = ""): Promise<string> {
  try {
    const sceneName = await obsService.getCurrentProgramScene();
    return sceneName || fallback;
  } catch {
    return fallback;
  }
}

export async function getRawPreviewScene(fallback = ""): Promise<string> {
  try {
    const previewScene = await obsService.getCurrentPreviewScene().catch(() => "");
    if (previewScene) {
      return previewScene;
    }

    const studioModeEnabled = await obsService.getStudioModeEnabled().catch(() => false);
    if (!studioModeEnabled) {
      await obsService.setStudioModeEnabled(true).catch(() => undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      const stagedPreviewScene = await obsService.getCurrentPreviewScene().catch(() => "");
      if (stagedPreviewScene) {
        return stagedPreviewScene;
      }
    }

    return fallback;
  } catch {
    return fallback;
  }
}
