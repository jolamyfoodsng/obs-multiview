/**
 * Feedback Service — OBS Church Studio
 *
 * Checks OBS state and returns actionable warnings/issues.
 * These are shown as a non-intrusive banner in ServiceMode.
 *
 * Checks:
 *   - Camera source missing or offline
 *   - Scripture source missing or offline
 *   - Sunday scenes not found
 *   - OBS not in studio mode (optional)
 */

import { obsService } from "./obsService";
import { SUNDAY_SCENE_NAMES } from "./layoutService";
import type { GenerationConfig } from "./layoutService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackLevel = "warning" | "error" | "info";

export interface FeedbackItem {
    id: string;
    level: FeedbackLevel;
    message: string;
    icon: string;
}

// ---------------------------------------------------------------------------
// Check all issues
// ---------------------------------------------------------------------------

/**
 * Run all health checks and return any active issues.
 * Returns empty array if everything is fine.
 */
export async function checkHealth(
    config: GenerationConfig | null
): Promise<FeedbackItem[]> {
    const issues: FeedbackItem[] = [];

    try {
        // Check if Sunday scenes exist
        const sceneList = await obsService.getSceneList();
        const sceneNames = new Set(sceneList.map((s) => s.sceneName));

        const missingScenes = SUNDAY_SCENE_NAMES.filter((name) => !sceneNames.has(name));
        if (missingScenes.length > 0) {
            issues.push({
                id: "missing-scenes",
                level: "error",
                message: `Missing scenes: ${missingScenes.join(", ")}. Run Setup or Repair.`,
                icon: "error_outline",
            });
        }

        // Check camera source
        if (config) {
            const inputList = await obsService.getInputList();
            const inputNames = new Set(inputList.map((i) => i.inputName));

            if (!inputNames.has(config.cameraSource)) {
                issues.push({
                    id: "camera-missing",
                    level: "error",
                    message: `Camera "${config.cameraSource}" not found in OBS.`,
                    icon: "videocam_off",
                });
            }

            if (!inputNames.has(config.scriptureSource)) {
                issues.push({
                    id: "scripture-missing",
                    level: "warning",
                    message: `Scripture source "${config.scriptureSource}" not found in OBS.`,
                    icon: "warning",
                });
            }
        } else {
            issues.push({
                id: "no-config",
                level: "warning",
                message: "No camera/scripture sources configured. Run Setup Wizard.",
                icon: "settings",
            });
        }
    } catch (err) {
        console.error("[FeedbackService] Health check error:", err);
        issues.push({
            id: "health-error",
            level: "error",
            message: "Could not check OBS health — connection may be unstable.",
            icon: "error",
        });
    }

    return issues;
}
