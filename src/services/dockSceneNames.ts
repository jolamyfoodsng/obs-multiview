export const DOCK_PREVIEW_STAGE_SUFFIX = "__OCS_Dock_Preview";

const DOCK_OVERLAY_SCENE_NAMES = new Set([
  "\u26ea OCS Bible",
  "\u26ea OCS Preview Bible",
  "\u26ea OCS Worship",
  "\u26ea OCS Preview Worship",
]);

export function isDockOverlaySceneName(sceneName: string): boolean {
  const trimmed = sceneName.trim();
  return DOCK_OVERLAY_SCENE_NAMES.has(trimmed);
}

export function isDockUtilitySceneName(sceneName: string): boolean {
  const trimmed = sceneName.trim();
  return Boolean(trimmed) && (
    isDockOverlaySceneName(trimmed) ||
    trimmed.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)
  );
}

export function isUserSelectableObsScene(sceneName: string): boolean {
  const trimmed = sceneName.trim();
  return Boolean(trimmed) && !isDockUtilitySceneName(trimmed);
}

export function normalizeDockStageBaseScene(sceneName: string): string {
  const trimmed = sceneName.trim();
  if (!trimmed.endsWith(DOCK_PREVIEW_STAGE_SUFFIX)) return trimmed;
  return trimmed.slice(0, -DOCK_PREVIEW_STAGE_SUFFIX.length).trim();
}
