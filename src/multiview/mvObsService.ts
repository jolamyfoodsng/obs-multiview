/**
 * mvObsService.ts — Multi-View ↔ OBS Scene Sync
 *
 * Translates an MVLayout into a real OBS scene and sets it as the Preview source.
 *
 * Region type → OBS source mapping:
 *   obs-scene     → existing OBS scene (added as nested scene item)
 *   video-input   → existing input (by inputName)
 *   image-overlay → image_source
 *   media         → ffmpeg_source
 *   browser       → browser_source
 *   color         → color_source_v3
 */

import { obsService } from "../services/obsService";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import type { MVLayout, Region, RegionId, MVTransitionConfig } from "./types";
import { DEFAULT_TRANSITION_CONFIG } from "./types";
import { getLTThemeById } from "../lowerthirds/themes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  sceneName: string;
  errors: string[];
  /** Region IDs that were successfully synced */
  synced: RegionId[];
  /** Region IDs that failed */
  failed: RegionId[];
  /** Whether the scene was set as preview */
  setAsPreview: boolean;
  /** If the target scene was live, the staging scene used instead */
  stagingScene?: string;
  /** Sources that were updated in-place (not re-created) */
  updatedInPlace: string[];
}

export interface SceneSlot {
  /** OBS scene name to create/update */
  obsSceneName: string;
  /** Layout ID to sync into this scene */
  layoutId: string | null;
  /** Layout name (for display) */
  layoutName?: string;
  /** Last sync timestamp (ISO) */
  lastSyncedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique OBS source name for a region within a layout */
function obsSourceName(layoutName: string, region: Region): string {
  const clean = (layoutName || "Untitled").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Layout";
  const label = region.name || region.type || "region";
  return `MV_${clean}_${label}_${region.id}`.substring(0, 80);
}

/**
 * Try to remove an existing OBS input by name. Silent on failure.
 * This is needed before re-creating inputs on re-apply.
 */
async function tryRemoveInput(inputName: string): Promise<void> {
  if (!inputName || !inputName.trim()) return; // Don't send empty names to OBS
  try {
    await obsService.call("RemoveInput", { inputName });
    console.log(`[MV→OBS] Removed existing input: "${inputName}"`);
  } catch {
    // Input may not exist — that's fine
  }
}

/**
 * Robust helper that creates (or re-uses) an OBS input and returns its sceneItemId.
 *
 * Strategy:
 *  1. Try `createInput` — works when no input with that name exists yet.
 *  2. If that fails (input already exists), update its settings and add it to the scene.
 *  3. If *that* fails too, nuke the old input and create fresh.
 *
 * Returns the sceneItemId (≥ 0) on success, or -1 after pushing to `errors`.
 */
async function createOrUpdateInput(
  sceneName: string,
  inputName: string,
  inputKind: string,
  settings: Record<string, unknown>,
  errors: string[],
  label: string,
): Promise<number> {
  // Attempt 1 — fresh create
  try {
    return await obsService.createInput(sceneName, inputName, inputKind, settings);
  } catch {
    // Likely "input already exists"
  }

  // Attempt 2 — update existing input & add to scene
  try {
    await obsService.setInputSettings(inputName, settings);
    return await obsService.createSceneItem(sceneName, inputName);
  } catch {
    // Source may be stale or belong to a different kind — remove & retry
  }

  // Attempt 3 — remove + recreate
  try {
    await tryRemoveInput(inputName);
    return await obsService.createInput(sceneName, inputName, inputKind, settings);
  } catch (err) {
    errors.push(`${label}: Failed to create ${inputKind} source — ${err instanceof Error ? err.message : String(err)}`);
    return -1;
  }
}

/**
 * Convert region canvas coordinates → OBS SceneItemTransform.
 */
function regionToTransform(region: Region) {
  return {
    positionX: region.x,
    positionY: region.y,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsWidth: region.width,
    boundsHeight: region.height,
    boundsAlignment: 0,
    rotation: region.rotation,
  };
}

// ---------------------------------------------------------------------------
// Core Sync Function
// ---------------------------------------------------------------------------

/**
 * Push an MVLayout to OBS as a scene, then set it as the Preview source.
 *
 * Smart-apply logic:
 *  - If the target scene is currently the live Program scene, creates a staging
 *    scene (suffixed "__staging") instead, to avoid disrupting the live output.
 *  - Before blowing away existing items, checks if any sources already exist in
 *    the scene; if an existing source matches by name, we update its settings
 *    and transform in-place instead of recreating.
 *  - Only creates new sources for items that don't exist yet.
 *  - Only removes items that are no longer in the layout.
 *
 * @param layout       The layout to sync
 * @param sceneName    OBS scene name to create/update (defaults to "MV: {layout.name}")
 * @param clearFirst   If true, removes items that are no longer in the layout
 * @param setPreview   If true, sets the scene as Preview (requires Studio Mode)
 */
export async function pushLayoutToOBS(
  layout: MVLayout,
  sceneName?: string,
  clearFirst = true,
  setPreview = true
): Promise<SyncResult> {
  const requestedScene = sceneName || `MV: ${layout.name || "Untitled"}`;
  const errors: string[] = [];
  const synced: RegionId[] = [];
  const failed: RegionId[] = [];
  const updatedInPlace: string[] = [];
  let setAsPreview = false;
  let stagingScene: string | undefined;

  if (!requestedScene.trim()) {
    return {
      success: false,
      sceneName: "",
      errors: ["Target scene name is empty"],
      synced: [],
      failed: layout.regions.map((r) => r.id),
      setAsPreview: false,
      updatedInPlace: [],
    };
  }

  try {
    // ── 0. Check if target scene is the live Program scene ──
    let targetScene = requestedScene;
    try {
      const programScene = await obsService.getCurrentProgramScene();
      if (programScene === requestedScene) {
        // Don't modify the live scene — push to a staging copy instead
        stagingScene = `${requestedScene}__staging`;
        targetScene = stagingScene;
        console.log(
          `[MV→OBS] Target "${requestedScene}" is currently LIVE — using staging scene "${targetScene}"`
        );
      }
    } catch {
      // Can't determine program scene — proceed with target
    }

    // ── 1. Ensure the target scene exists ──
    const scenes = await obsService.getSceneList();
    const sceneExists = scenes.some((s) => s.sceneName === targetScene);

    if (!sceneExists) {
      await obsService.createScene(targetScene);
      console.log(`[MV→OBS] Created scene: "${targetScene}"`);
    }

    // ── 1b. Build a map of existing items in the scene ──
    const existingItems = sceneExists
      ? await obsService.getSceneItemList(targetScene)
      : [];
    /** Map: sourceName → { sceneItemId, inputKind } */
    const existingMap = new Map<string, { sceneItemId: number; inputKind: string }>();
    for (const item of existingItems) {
      existingMap.set(item.sourceName, { sceneItemId: item.sceneItemId, inputKind: item.inputKind });
    }

    // ── 1c. Build set of desired source names so we can remove stale ones ──
    const desiredSources = new Set<string>();

    // Background source name
    const bgSourceName = `MV_${(layout.name || "Untitled").replace(/[^a-zA-Z0-9 _-]/g, "").trim()}_BG`;
    if (layout.background) desiredSources.add(bgSourceName);

    // Region source names
    const sorted = [...layout.regions]
      .filter((r) => r.visible)
      .sort((a, b) => a.zIndex - b.zIndex);
    for (const region of sorted) {
      if (region.type === "obs-scene") {
        // Bible / Worship / Lower Third themed slots use overlay scene wrapper
        const isThemedSlot = (region.name?.startsWith("Bible:") || region.name?.startsWith("Worship:")) && region.themeSettings;
        const isLTSlot = region.name?.startsWith("LT:") && region.themeId;
        if (isThemedSlot || isLTSlot) {
          // Track the overlay scene name (which is what appears in the target scene)
          const srcName = obsSourceName(layout.name, region);
          desiredSources.add(`OCS MV: ${srcName}`);
        } else if (region.sceneName) {
          desiredSources.add(region.sceneName);
        }
      } else if (region.type === "video-input") {
        if (region.inputName) desiredSources.add(region.inputName);
      } else {
        desiredSources.add(obsSourceName(layout.name, region));
      }
    }

    // ── 1d. Remove items no longer in the layout ──
    if (clearFirst) {
      for (const item of existingItems) {
        if (!desiredSources.has(item.sourceName)) {
          try {
            await obsService.call("RemoveSceneItem", {
              sceneName: targetScene,
              sceneItemId: item.sceneItemId,
            });
            console.log(`[MV→OBS] Removed stale item "${item.sourceName}" (#${item.sceneItemId})`);
          } catch (err) {
            console.warn(`[MV→OBS] Failed to remove stale item ${item.sceneItemId}:`, err);
          }
        }
      }
    }

    // ── 2. Push background ──
    /** Track background scene item ID for z-order reordering */
    let bgSceneItemId = -1;
    if (layout.background) {
      const bg = layout.background;
      try {
        const existingBg = existingMap.get(bgSourceName);

        if (bg.type === "color") {
          const hex = (bg.color || "#0a0a14").replace("#", "");
          const r = parseInt(hex.substring(0, 2), 16) || 0;
          const g = parseInt(hex.substring(2, 4), 16) || 0;
          const b2 = parseInt(hex.substring(4, 6), 16) || 0;
          const obsColor = 0xFF000000 + (b2 << 16) + (g << 8) + r;
          const settings = { color: obsColor, width: layout.canvas.width, height: layout.canvas.height };

          let bgItemId: number;
          if (existingBg && existingBg.inputKind === "color_source_v3") {
            // Update in-place
            await obsService.setInputSettings(bgSourceName, settings);
            bgItemId = existingBg.sceneItemId;
            updatedInPlace.push(bgSourceName);
            console.log(`[MV→OBS] Updated background color in-place: "${bgSourceName}"`);
          } else {
            if (existingBg) {
              // Kind mismatch — remove old, create new
              try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existingBg.sceneItemId }); } catch { /* */ }
            }
            bgItemId = await createOrUpdateInput(targetScene, bgSourceName, "color_source_v3", settings, errors, "Background");
          }
          if (bgItemId >= 0) {
            bgSceneItemId = bgItemId;
            await obsService.setSceneItemTransform(targetScene, bgItemId, {
              positionX: 0, positionY: 0,
              boundsType: "OBS_BOUNDS_STRETCH",
              boundsWidth: layout.canvas.width, boundsHeight: layout.canvas.height,
              boundsAlignment: 0, rotation: 0,
            });
          }
        } else if (bg.type === "image" && (bg.filePath || bg.imageSrc)) {
          const imgPath = bg.filePath || bg.imageSrc || "";
          if (!imgPath || imgPath.startsWith("data:")) {
            console.warn("[MV→OBS] Background image is a data URL — OBS requires a file path. Skipping.");
          } else {
            const settings = { file: imgPath };
            let bgItemId: number;
            if (existingBg && existingBg.inputKind === "image_source") {
              await obsService.setInputSettings(bgSourceName, settings);
              bgItemId = existingBg.sceneItemId;
              updatedInPlace.push(bgSourceName);
            } else {
              if (existingBg) { try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existingBg.sceneItemId }); } catch { /* */ } }
              bgItemId = await createOrUpdateInput(targetScene, bgSourceName, "image_source", settings, errors, "Background");
            }
            if (bgItemId >= 0) {
              bgSceneItemId = bgItemId;
              await obsService.setSceneItemTransform(targetScene, bgItemId, {
                positionX: 0, positionY: 0,
                boundsType: "OBS_BOUNDS_STRETCH",
                boundsWidth: layout.canvas.width, boundsHeight: layout.canvas.height,
                boundsAlignment: 0, rotation: 0,
              });
            }
          }
        } else if (bg.type === "video" && (bg.filePath || bg.videoSrc)) {
          const videoPath = bg.filePath || bg.videoSrc || "";
          if (!videoPath || videoPath.startsWith("data:")) {
            console.warn("[MV→OBS] Background video is a data URL — OBS requires a file path. Skipping.");
            errors.push("Background video: file not saved to disk. Re-upload the video to fix.");
          } else {
            const settings = { local_file: videoPath, looping: bg.loop, is_local_file: true };
            let bgItemId: number;
            if (existingBg && existingBg.inputKind === "ffmpeg_source") {
              await obsService.setInputSettings(bgSourceName, settings);
              bgItemId = existingBg.sceneItemId;
              updatedInPlace.push(bgSourceName);
            } else {
              if (existingBg) { try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existingBg.sceneItemId }); } catch { /* */ } }
              bgItemId = await createOrUpdateInput(targetScene, bgSourceName, "ffmpeg_source", settings, errors, "Background");
            }
            if (bgItemId >= 0) {
              bgSceneItemId = bgItemId;
              await obsService.setSceneItemTransform(targetScene, bgItemId, {
                positionX: 0, positionY: 0,
                boundsType: "OBS_BOUNDS_STRETCH",
                boundsWidth: layout.canvas.width, boundsHeight: layout.canvas.height,
                boundsAlignment: 0, rotation: 0,
              });
            }
          }
        }
      } catch (bgTopErr) {
        errors.push(`Background: ${bgTopErr instanceof Error ? bgTopErr.message : String(bgTopErr)}`);
      }
    }

    // 3. Create/update each region as an OBS source
    /** Collect { sceneItemId, area, zIndex } for z-order reordering in step 4b */
    const itemsToReorder: { sceneItemId: number; area: number; zIndex: number }[] = [];

    for (const region of sorted) {
      try {
        const srcName = obsSourceName(layout.name, region);
        let sceneItemId: number;

        switch (region.type) {
          // ── OBS Scene (nested scene as source) ──
          // Also handles Bible / Worship themed slots (created as browser_source)
          case "obs-scene": {
            const isBibleSlot = region.name?.startsWith("Bible:");
            const isWorshipSlot = region.name?.startsWith("Worship:");
            const isThemedSlot = isBibleSlot || isWorshipSlot;

            if (isThemedSlot && region.themeSettings) {
              // ── Bible / Worship → browser_source wrapped in overlay scene ──
              const ts = region.themeSettings;
              const fo = region.fontOverrides;
              const templateType = ts.borderRadius > 0 || ts.boxBackground !== "transparent"
                ? "lower-third" : "fullscreen";
              const overlayUrl = `${getOverlayBaseUrlSync()}/bible-overlay-${templateType}.html`;

              // Build dummy slide data so the overlay shows a placeholder on first load
              const dummySlide = {
                live: true,
                slide: {
                  id: "mv-preview",
                  text: isBibleSlot
                    ? "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
                    : "Jesus loves you so much.",
                  reference: isBibleSlot ? "John 3:16 (KJV)" : "",
                  index: 0,
                  total: 1,
                },
              };
              const urlWithData = `${overlayUrl}#data=${encodeURIComponent(JSON.stringify(dummySlide))}`;

              // Build CSS vars that the overlay HTML reads
              const cssVars = [
                `--font-family: ${fo?.fontFamily ?? ts.fontFamily};`,
                `--font-size: ${fo?.fontSize ?? ts.fontSize}px;`,
                `--font-weight: ${ts.fontWeight};`,
                `--font-color: ${ts.fontColor};`,
                `--line-height: ${ts.lineHeight};`,
                `--text-align: ${fo?.textAlign ?? ts.textAlign};`,
                `--text-shadow: ${ts.textShadow};`,
                `--text-transform: ${fo?.textTransform ?? ts.textTransform ?? "none"};`,
                `--outline-width: ${ts.textOutline ? (ts.textOutlineWidth || 2) + "px" : "0px"};`,
                `--outline-color: ${ts.textOutline ? ts.textOutlineColor : "transparent"};`,
                `--ref-font-size: ${ts.refFontSize}px;`,
                `--ref-font-weight: ${ts.refFontWeight};`,
                `--ref-font-color: ${ts.refFontColor};`,
                `--bg-color: ${ts.backgroundColor};`,
                `--bg-opacity: ${ts.backgroundOpacity ?? 1};`,
                `--padding: ${ts.padding}px;`,
                `--safe-area: ${ts.safeArea}px;`,
                `--anim-duration: ${ts.animationDuration}ms;`,
                // Lower-third box styling
                `--box-background: ${ts.boxBackground || "rgba(0,0,0,0.75)"};`,
                `--border-radius: ${ts.borderRadius || 0}px;`,
              ].join(" ");
              let customCSS = `:root { ${cssVars} }`;

              // Inject background image via CSS if present (data: URLs can't go in URL hash)
              if (ts.backgroundImage && ts.backgroundImage.startsWith("data:")) {
                customCSS += ` :root { --bg-image: url(${ts.backgroundImage}); }`;
              }
              // Inject box background image for lower-third
              if (ts.boxBackgroundImage && ts.boxBackgroundImage.startsWith("data:")) {
                customCSS += ` :root { --box-bg-image: url(${ts.boxBackgroundImage}); }`;
              }

              const browserSettings = {
                url: urlWithData,
                width: region.width,
                height: region.height,
                css: customCSS,
              };

              // Create/update the overlay scene and browser source inside it
              const overlaySceneName = `OCS MV: ${srcName}`;
              const allScenes = await obsService.getSceneList();
              if (!allScenes.some((s) => s.sceneName === overlaySceneName)) {
                await obsService.call("CreateScene", { sceneName: overlaySceneName });
                console.log(`[MV→OBS] Created overlay scene "${overlaySceneName}"`);
              }

              // Check if browser source exists inside the overlay scene
              let overlayItems: { sourceName: string; sceneItemId: number; inputKind: string }[] = [];
              try {
                overlayItems = (await obsService.call("GetSceneItemList", { sceneName: overlaySceneName }) as {
                  sceneItems: { sourceName: string; sceneItemId: number; inputKind: string }[];
                }).sceneItems;
              } catch { /* empty scene */ }

              const existingInOverlay = overlayItems.find((si) => si.sourceName === srcName);
              if (existingInOverlay) {
                // Update existing browser source settings
                await obsService.setInputSettings(srcName, browserSettings);
              } else {
                // Remove any stale items in the overlay scene
                for (const si of overlayItems) {
                  try { await obsService.call("RemoveSceneItem", { sceneName: overlaySceneName, sceneItemId: si.sceneItemId }); } catch { /* */ }
                }
                // Create browser source inside overlay scene
                const bsItemId = await createOrUpdateInput(overlaySceneName, srcName, "browser_source", browserSettings, errors, `Region "${region.name}"`);
                if (bsItemId >= 0) {
                  await obsService.setSceneItemTransform(overlaySceneName, bsItemId, {
                    positionX: 0, positionY: 0,
                    boundsType: "OBS_BOUNDS_STRETCH",
                    boundsWidth: 1920, boundsHeight: 1080,
                    boundsAlignment: 0, rotation: 0,
                  });
                }
              }

              // Nest the overlay scene into the target scene
              const existing = existingMap.get(overlaySceneName);
              if (existing) {
                sceneItemId = existing.sceneItemId;
                updatedInPlace.push(overlaySceneName);
              } else {
                // Remove stale direct browser source if it exists from old architecture
                const staleDirect = existingMap.get(srcName);
                if (staleDirect) {
                  try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: staleDirect.sceneItemId }); } catch { /* */ }
                }
                try {
                  sceneItemId = await obsService.createSceneItem(targetScene, overlaySceneName);
                } catch (nestErr) {
                  errors.push(`Region "${region.name}": Failed to nest overlay scene — ${nestErr instanceof Error ? nestErr.message : String(nestErr)}`);
                  failed.push(region.id);
                  continue;
                }
              }
              console.log(`[MV→OBS] Created scene-wrapped browser_source for themed slot "${region.name}" with theme CSS`);
              break;
            }

            // ── Lower Third (LT:) → browser_source wrapped in overlay scene ──
            const isLTSlot = region.name?.startsWith("LT:") && region.themeId;
            if (isLTSlot) {
              const ltTheme = getLTThemeById(region.themeId!);
              if (!ltTheme) {
                errors.push(`Region "${region.name}": Lower third theme "${region.themeId}" not found`);
                failed.push(region.id);
                continue;
              }

              const ltValues: Record<string, string> = (region as any).ltValues ?? {};
              const ltEnabled: boolean = (region as any).ltEnabled !== false; // default on
              const ltBgColor: string = (region as any).ltBgColor ?? "";
              const ltSize: string = (region as any).ltSize ?? "medium"; // small | medium | large | xl | 2xl

              // Size multiplier for the overlay
              const sizeScale: Record<string, number> = {
                small: 0.7,
                medium: 1.0,
                large: 1.3,
                xl: 1.6,
                "2xl": 2.0,
              };
              const scale = sizeScale[ltSize] ?? 1.0;

              // Build overlay URL with theme data
              const overlayUrl = `${getOverlayBaseUrlSync()}/lower-third-overlay.html`;
              const payload = {
                themeId: ltTheme.id,
                html: ltTheme.html,
                css: ltTheme.css,
                values: ltValues,
                live: ltEnabled,
                blanked: !ltEnabled,
                scale,
                bgColorOverride: ltBgColor || undefined,
                timestamp: Date.now(),
              };
              const urlWithData = `${overlayUrl}#data=${encodeURIComponent(JSON.stringify(payload))}`;

              const browserSettings = {
                url: urlWithData,
                width: region.width,
                height: region.height,
                css: "",
              };

              // Create/update the overlay scene and browser source inside it
              const ltOverlaySceneName = `OCS MV: ${srcName}`;
              const allScenes2 = await obsService.getSceneList();
              if (!allScenes2.some((s) => s.sceneName === ltOverlaySceneName)) {
                await obsService.call("CreateScene", { sceneName: ltOverlaySceneName });
                console.log(`[MV→OBS] Created LT overlay scene "${ltOverlaySceneName}"`);
              }

              // Check if browser source exists inside the overlay scene
              let ltOverlayItems: { sourceName: string; sceneItemId: number; inputKind: string }[] = [];
              try {
                ltOverlayItems = (await obsService.call("GetSceneItemList", { sceneName: ltOverlaySceneName }) as {
                  sceneItems: { sourceName: string; sceneItemId: number; inputKind: string }[];
                }).sceneItems;
              } catch { /* empty scene */ }

              const existingLtInOverlay = ltOverlayItems.find((si) => si.sourceName === srcName);
              if (existingLtInOverlay) {
                await obsService.setInputSettings(srcName, browserSettings);
              } else {
                // Remove stale items in the overlay scene
                for (const si of ltOverlayItems) {
                  try { await obsService.call("RemoveSceneItem", { sceneName: ltOverlaySceneName, sceneItemId: si.sceneItemId }); } catch { /* */ }
                }
                // Create browser source inside overlay scene
                const bsItemId = await createOrUpdateInput(ltOverlaySceneName, srcName, "browser_source", browserSettings, errors, `Region "${region.name}"`);
                if (bsItemId >= 0) {
                  await obsService.setSceneItemTransform(ltOverlaySceneName, bsItemId, {
                    positionX: 0, positionY: 0,
                    boundsType: "OBS_BOUNDS_STRETCH",
                    boundsWidth: 1920, boundsHeight: 1080,
                    boundsAlignment: 0, rotation: 0,
                  });
                }
              }

              // Nest the overlay scene into the target scene
              const existing = existingMap.get(ltOverlaySceneName);
              if (existing) {
                sceneItemId = existing.sceneItemId;
                updatedInPlace.push(ltOverlaySceneName);
              } else {
                // Remove stale direct browser source if it exists from old architecture
                const staleDirect = existingMap.get(srcName);
                if (staleDirect) {
                  try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: staleDirect.sceneItemId }); } catch { /* */ }
                }
                try {
                  sceneItemId = await obsService.createSceneItem(targetScene, ltOverlaySceneName);
                } catch (nestErr) {
                  errors.push(`Region "${region.name}": Failed to nest LT overlay scene — ${nestErr instanceof Error ? nestErr.message : String(nestErr)}`);
                  failed.push(region.id);
                  continue;
                }
              }
              console.log(`[MV→OBS] Created scene-wrapped browser_source for LT slot "${region.name}" (theme: ${ltTheme.name}, size: ${ltSize})`);
              break;
            }

            // ── Standard OBS nested scene ──
            const sName = region.sceneName;
            if (!sName) {
              console.log(`[MV→OBS] Skipping region "${region.name}": no scene assigned`);
              continue;
            }
            // Check if this scene is already in our target
            const existingScene = existingMap.get(sName);
            if (existingScene) {
              sceneItemId = existingScene.sceneItemId;
              updatedInPlace.push(sName);
              console.log(`[MV→OBS] Reusing existing scene item "${sName}" (#${sceneItemId})`);
            } else {
              try {
                sceneItemId = await obsService.createSceneItem(targetScene, sName);
              } catch {
                try {
                  await obsService.createScene(sName);
                  console.log(`[MV→OBS] Auto-created missing scene "${sName}"`);
                  sceneItemId = await obsService.createSceneItem(targetScene, sName);
                } catch (createErr) {
                  errors.push(`Region "${region.name}": Failed to create scene "${sName}" — ${createErr instanceof Error ? createErr.message : String(createErr)}`);
                  failed.push(region.id);
                  continue;
                }
              }
            }
            break;
          }

          // ── Video Input (existing OBS input) ──
          case "video-input": {
            const inputName = region.inputName;
            if (!inputName) {
              errors.push(`Region "${region.name}": No input name specified`);
              failed.push(region.id);
              continue;
            }
            const existingInput = existingMap.get(inputName);
            if (existingInput) {
              sceneItemId = existingInput.sceneItemId;
              updatedInPlace.push(inputName);
            } else {
              try {
                sceneItemId = await obsService.createSceneItem(targetScene, inputName);
              } catch {
                errors.push(`Region "${region.name}": Input "${inputName}" not found in OBS`);
                failed.push(region.id);
                continue;
              }
            }
            break;
          }

          // ── Color Source ──
          case "color": {
            const hex = region.color.replace("#", "");
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            const obsColor = 0xFF000000 + (b << 16) + (g << 8) + r;
            const settings = { color: obsColor, width: region.width, height: region.height };
            const existing = existingMap.get(srcName);
            if (existing && existing.inputKind === "color_source_v3") {
              await obsService.setInputSettings(srcName, settings);
              sceneItemId = existing.sceneItemId;
              updatedInPlace.push(srcName);
            } else {
              if (existing) { try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existing.sceneItemId }); } catch { /* */ } }
              const id = await createOrUpdateInput(targetScene, srcName, "color_source_v3", settings, errors, `Region "${region.name}"`);
              if (id < 0) { failed.push(region.id); continue; }
              sceneItemId = id;
            }
            break;
          }

          // ── Image Source ──
          case "image-overlay": {
            const filePath = region.filePath || region.src;
            if (!filePath) {
              console.log(`[MV→OBS] Skipping region "${region.name}": no image source`);
              continue;
            }
            if (filePath.startsWith("data:")) {
              console.warn(`[MV→OBS] Region "${region.name}": image is a data URL. Re-upload to save to disk.`);
              errors.push(`"${region.name}": image not saved to disk. Re-upload to fix.`);
              failed.push(region.id);
              continue;
            }
            const imgSettings = { file: filePath, unload: false };
            const existing = existingMap.get(srcName);
            if (existing && existing.inputKind === "image_source") {
              await obsService.setInputSettings(srcName, imgSettings);
              sceneItemId = existing.sceneItemId;
              updatedInPlace.push(srcName);
            } else {
              if (existing) { try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existing.sceneItemId }); } catch { /* */ } }
              const id = await createOrUpdateInput(targetScene, srcName, "image_source", imgSettings, errors, `Region "${region.name}"`);
              if (id < 0) { failed.push(region.id); continue; }
              sceneItemId = id;
            }
            break;
          }

          // ── Media (Video) Source ──
          case "media": {
            const filePath = region.filePath || region.src;
            if (!filePath) {
              console.log(`[MV→OBS] Skipping region "${region.name}": no media source`);
              continue;
            }
            if (filePath.startsWith("data:")) {
              console.warn(`[MV→OBS] Region "${region.name}": media is a data URL. Re-upload to save to disk.`);
              errors.push(`"${region.name}": media not saved to disk. Re-upload to fix.`);
              failed.push(region.id);
              continue;
            }
            const mediaSettings = { local_file: filePath, looping: region.loop, is_local_file: true };
            const existing = existingMap.get(srcName);
            if (existing && existing.inputKind === "ffmpeg_source") {
              await obsService.setInputSettings(srcName, mediaSettings);
              sceneItemId = existing.sceneItemId;
              updatedInPlace.push(srcName);
            } else {
              if (existing) { try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existing.sceneItemId }); } catch { /* */ } }
              const id = await createOrUpdateInput(targetScene, srcName, "ffmpeg_source", mediaSettings, errors, `Region "${region.name}"`);
              if (id < 0) { failed.push(region.id); continue; }
              sceneItemId = id;
            }
            break;
          }

          // ── Browser Source ──
          case "browser": {
            const url = region.url;
            if (!url) {
              console.log(`[MV→OBS] Skipping region "${region.name}": no URL set`);
              continue;
            }
            const browserSettings = { url, width: region.width, height: region.height };
            const existing = existingMap.get(srcName);
            if (existing && existing.inputKind === "browser_source") {
              await obsService.setInputSettings(srcName, browserSettings);
              sceneItemId = existing.sceneItemId;
              updatedInPlace.push(srcName);
            } else {
              if (existing) { try { await obsService.call("RemoveSceneItem", { sceneName: targetScene, sceneItemId: existing.sceneItemId }); } catch { /* */ } }
              const id = await createOrUpdateInput(targetScene, srcName, "browser_source", browserSettings, errors, `Region "${region.name}"`);
              if (id < 0) { failed.push(region.id); continue; }
              sceneItemId = id;
            }
            break;
          }

          default: {
            const unknown = region as Region;
            errors.push(`Region "${unknown.name}": Unsupported type "${unknown.type}"`);
            failed.push(unknown.id);
            continue;
          }
        }

        // 4. Set transform (position + size) and ensure item is enabled/visible
        const transform = regionToTransform(region);
        await obsService.setSceneItemTransform(targetScene, sceneItemId, transform);

        // Ensure the scene item is visible (some sources may be disabled by default)
        try {
          await obsService.call("SetSceneItemEnabled", {
            sceneName: targetScene,
            sceneItemId,
            sceneItemEnabled: true,
          });
        } catch { /* item already enabled */ }

        // 4b. Apply opacity via Color Correction filter if not 100%
        if (region.opacity < 1) {
          const filterName = `__mv_opacity_${region.id}`;
          const filterSettings = { opacity: region.opacity };
          try {
            // Try to update existing filter first
            await obsService.call("SetSourceFilterSettings", {
              sourceName: srcName,
              filterName,
              filterSettings,
            });
          } catch {
            // Filter doesn't exist yet — create it
            try {
              await obsService.call("CreateSourceFilter", {
                sourceName: srcName,
                filterName,
                filterKind: "color_filter_v2",
                filterSettings,
              });
            } catch (filterErr) {
              console.warn(`[MV→OBS] Could not set opacity filter for "${region.name}":`, filterErr);
            }
          }
        } else {
          // Remove opacity filter if region is fully opaque
          const filterName = `__mv_opacity_${region.id}`;
          try {
            await obsService.call("RemoveSourceFilter", { sourceName: srcName, filterName });
          } catch { /* filter doesn't exist, that's fine */ }
        }

        synced.push(region.id);
        itemsToReorder.push({
          sceneItemId,
          area: region.width * region.height,
          zIndex: region.zIndex,
        });
        console.log(`[MV→OBS] Synced region "${region.name}" → item #${sceneItemId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Region "${region.name}": ${msg}`);
        failed.push(region.id);
      }
    }

    // ── 4b. Reorder scene items so overlays render on top in OBS ──
    //
    // OBS renders sources bottom-to-top: index 0 = bottom (behind everything),
    // highest index = top (in front of everything).
    //
    // Strategy: background always at index 0, then regions sorted by area
    // descending (biggest at bottom, smallest overlays at top). This ensures
    // small logos/overlays aren't hidden behind full-screen regions.
    //
    try {
      // Sort: biggest area first → they get the lowest indices (bottom of stack)
      const reorderSorted = [...itemsToReorder].sort((a, b) => b.area - a.area);

      // Background always goes to index 0 (very bottom)
      if (bgSceneItemId >= 0) {
        try {
          await obsService.setSceneItemIndex(targetScene, bgSceneItemId, 0);
          console.log(`[MV→OBS] Z-order: background → index 0 (bottom)`);
        } catch (err) {
          console.warn("[MV→OBS] Failed to reorder background:", err);
        }
      }

      // Regions: assign indices starting from 1 (or 0 if no background)
      const startIndex = bgSceneItemId >= 0 ? 1 : 0;
      for (let i = 0; i < reorderSorted.length; i++) {
        const item = reorderSorted[i];
        const targetIndex = startIndex + i;
        try {
          await obsService.setSceneItemIndex(targetScene, item.sceneItemId, targetIndex);
          console.log(`[MV→OBS] Z-order: item #${item.sceneItemId} (area ${item.area}) → index ${targetIndex}`);
        } catch (err) {
          console.warn(`[MV→OBS] Failed to reorder item #${item.sceneItemId}:`, err);
        }
      }

      console.log(`[MV→OBS] ✓ Z-order set: ${bgSceneItemId >= 0 ? "BG → " : ""}${reorderSorted.map((it) => `#${it.sceneItemId}`).join(" → ")} (bottom to top)`);
    } catch (err) {
      console.warn("[MV→OBS] Z-order reordering failed (non-fatal):", err);
    }

    // 5. Set the assembled scene as Preview source
    if (setPreview) {
      try {
        // Ensure Studio Mode is enabled (required for preview)
        const studioMode = await obsService.getStudioModeEnabled();
        if (!studioMode) {
          await obsService.setStudioModeEnabled(true);
          console.log("[MV→OBS] Enabled Studio Mode for preview");
        }
        await obsService.setCurrentPreviewScene(targetScene);
        setAsPreview = true;
        console.log(`[MV→OBS] Set "${targetScene}" as Preview source`);

        // Auto-configure transition so "Go Live" is ready immediately
        try {
          await ensureTransition(layout.transition);
        } catch {
          // Non-fatal: transition will still default to whatever OBS has
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to set as preview: ${msg}`);
        console.warn("[MV→OBS] Could not set preview scene:", err);
      }
    }

    return { success: failed.length === 0, sceneName: targetScene, errors, synced, failed, setAsPreview, stagingScene, updatedInPlace };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      sceneName: requestedScene,
      errors: [`Scene-level error: ${msg}`],
      synced,
      failed: layout.regions.map((r) => r.id),
      setAsPreview: false,
      updatedInPlace: [],
    };
  }
}

/**
 * Push multiple layouts to OBS at once (Scenes & Output Sync).
 * Each slot maps a layout to a specific OBS scene name.
 */
export async function pushAllSlotsToOBS(
  slots: SceneSlot[],
  layouts: Map<string, MVLayout>
): Promise<{ results: SyncResult[]; totalErrors: number }> {
  const results: SyncResult[] = [];
  let totalErrors = 0;

  for (const slot of slots) {
    if (!slot.layoutId || !slot.obsSceneName.trim()) continue;
    const layout = layouts.get(slot.layoutId);
    if (!layout) {
      results.push({
        success: false,
        sceneName: slot.obsSceneName,
        errors: [`Layout "${slot.layoutId}" not found`],
        synced: [],
        failed: [],
        setAsPreview: false,
        updatedInPlace: [],
      });
      totalErrors++;
      continue;
    }

    const result = await pushLayoutToOBS(layout, slot.obsSceneName, true, false);
    results.push(result);
    totalErrors += result.errors.length;
  }

  return { results, totalErrors };
}

/**
 * Check if OBS is connected and available for sync.
 */
export function isOBSReady(): boolean {
  return obsService.status === "connected";
}

/**
 * Get current OBS scene list (for the sync page).
 */
export async function getOBSScenes(): Promise<string[]> {
  try {
    const scenes = await obsService.getSceneList();
    return scenes.map((s) => s.sceneName);
  } catch {
    return [];
  }
}

/**
 * Switch OBS program output to a scene.
 */
export async function switchToScene(sceneName: string): Promise<void> {
  await obsService.setCurrentProgramScene(sceneName);
}

/**
 * Set an OBS scene as the Preview source.
 * Enables Studio Mode if not already active.
 */
export async function setPreviewScene(sceneName: string): Promise<void> {
  const studioMode = await obsService.getStudioModeEnabled();
  if (!studioMode) {
    await obsService.setStudioModeEnabled(true);
  }
  await obsService.setCurrentPreviewScene(sceneName);
}

/**
 * Get a screenshot of what's currently on Program output.
 */
export async function getProgramScreenshot(width = 320): Promise<string | null> {
  try {
    const scene = await obsService.getCurrentProgramScene();
    return obsService.getSourceScreenshot(scene, width);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transition System
// ---------------------------------------------------------------------------

/**
 * Map our transition kind to the OBS built-in transition name.
 * OBS ships with these transitions by default — no plugins needed.
 */
function obsTransitionName(kind: MVTransitionConfig["kind"]): string {
  switch (kind) {
    case "Cut":   return "Cut";
    case "Fade":  return "Fade";
    case "Swipe": return "Swipe";
    case "Slide": return "Slide";
    default:      return "Fade";
  }
}

/**
 * Configure the active OBS transition to match the layout's settings.
 * Called automatically before going live. Creates/selects the transition
 * and sets the duration — the user never has to touch OBS.
 */
export async function ensureTransition(config?: MVTransitionConfig): Promise<void> {
  const c = config ?? DEFAULT_TRANSITION_CONFIG;
  const name = obsTransitionName(c.kind);

  try {
    await obsService.call("SetCurrentSceneTransition", { transitionName: name });
  } catch {
    // Transition might not exist in this OBS install — try "Fade" as fallback
    console.warn(`[MV→OBS] Transition "${name}" not available, falling back to Fade`);
    try {
      await obsService.call("SetCurrentSceneTransition", { transitionName: "Fade" });
    } catch {
      // Last resort: Cut always exists
      try {
        await obsService.call("SetCurrentSceneTransition", { transitionName: "Cut" });
      } catch (err) {
        console.error("[MV→OBS] Failed to set any transition:", err);
      }
      return;
    }
  }

  // Set duration (only meaningful for non-Cut)
  if (c.kind !== "Cut" && c.durationMs > 0) {
    try {
      await obsService.call("SetCurrentSceneTransitionDuration", {
        transitionDuration: c.durationMs,
      });
    } catch (err) {
      console.warn("[MV→OBS] Failed to set transition duration:", err);
    }
  }

  console.log(`[MV→OBS] Transition configured: ${name} (${c.durationMs}ms)`);
}

/**
 * Go Live — transition the Preview scene to Program output with animation.
 *
 * This is the "magic button" that makes switching smooth:
 *  1. Ensures Studio Mode is active
 *  2. Sets the transition type + duration from layout config
 *  3. Triggers the studio mode transition (Preview → Program)
 *
 * The whole thing happens in one click — no need to touch OBS.
 */
export async function goLive(transitionConfig?: MVTransitionConfig): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Ensure Studio Mode
    const studioMode = await obsService.getStudioModeEnabled();
    if (!studioMode) {
      await obsService.setStudioModeEnabled(true);
      console.log("[MV→OBS] Enabled Studio Mode for Go Live");
    }

    // 2. Configure transition
    await ensureTransition(transitionConfig);

    // 3. Trigger the transition (Preview → Program)
    await obsService.call("TriggerStudioModeTransition", {});
    console.log("[MV→OBS] 🔴 GO LIVE — transition triggered");

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[MV→OBS] Go Live failed:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Get the list of available transitions from OBS.
 * Useful for populating the transition picker with only transitions
 * that are actually installed.
 */
export async function getAvailableTransitions(): Promise<string[]> {
  try {
    const resp = await obsService.call("GetSceneTransitionList", {});
    const transitions = (resp as Record<string, unknown>).transitions as Array<{ transitionName: string }>;
    return transitions.map((t) => t.transitionName);
  } catch {
    return ["Cut", "Fade"];
  }
}
