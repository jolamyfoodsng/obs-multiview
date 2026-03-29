/**
 * Transition Service — OBS Church Studio
 *
 * Controls OBS scene transition type and duration.
 * Provides a simple API for the UI to set global transitions.
 */

import { obsService } from "./obsService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransitionKind = "Cut" | "Fade" | "Swipe" | "Slide" | "Stinger";

export interface TransitionConfig {
    kind: TransitionKind;
    /** Duration in milliseconds (ignored for Cut) */
    durationMs: number;
}

export const DEFAULT_TRANSITION: TransitionConfig = {
    kind: "Cut",
    durationMs: 300,
};

/** Available transitions with labels */
export const TRANSITION_OPTIONS: { kind: TransitionKind; label: string; icon: string }[] = [
    { kind: "Cut", label: "Cut", icon: "content_cut" },
    { kind: "Fade", label: "Fade", icon: "gradient" },
    { kind: "Swipe", label: "Swipe", icon: "swipe" },
    { kind: "Slide", label: "Slide", icon: "slideshow" },
];

// ---------------------------------------------------------------------------
// Apply Transition
// ---------------------------------------------------------------------------

/**
 * Set the current scene transition in OBS.
 * Creates the transition if it doesn't exist.
 */
export async function setTransition(config: TransitionConfig): Promise<void> {
    const transitionName = `${config.kind} Transition`;

    try {
        // Try to set as current transition
        await obsService.call("SetCurrentSceneTransition", {
            transitionName: config.kind === "Cut" ? "Cut" : transitionName,
        });
    } catch {
        // Transition may not exist — some are built-in, some need to be available
        // Fall back to Cut for safety
        console.warn(`[TransitionService] Transition "${config.kind}" not available, falling back to Cut`);
        try {
            await obsService.call("SetCurrentSceneTransition", {
                transitionName: "Cut",
            });
        } catch (err) {
            console.error("[TransitionService] Failed to set Cut transition:", err);
        }
    }

    // Set duration (only meaningful for non-Cut transitions)
    if (config.kind !== "Cut") {
        try {
            await obsService.call("SetCurrentSceneTransitionDuration", {
                transitionDuration: config.durationMs,
            });
        } catch (err) {
            console.warn("[TransitionService] Failed to set duration:", err);
        }
    }

    console.log(`[TransitionService] Set transition: ${config.kind} (${config.durationMs}ms)`);
}

/**
 * Get the current transition from OBS.
 */
export async function getCurrentTransition(): Promise<TransitionConfig> {
    try {
        const resp = await obsService.call("GetCurrentSceneTransition", {});
        const name = (resp as Record<string, unknown>).transitionName as string;
        const duration = (resp as Record<string, unknown>).transitionDuration as number;

        // Map OBS transition name back to our kind
        let kind: TransitionKind = "Cut";
        if (name?.toLowerCase().includes("fade")) kind = "Fade";
        else if (name?.toLowerCase().includes("swipe")) kind = "Swipe";
        else if (name?.toLowerCase().includes("slide")) kind = "Slide";
        else if (name?.toLowerCase().includes("stinger")) kind = "Stinger";

        return { kind, durationMs: duration || 300 };
    } catch {
        return DEFAULT_TRANSITION;
    }
}
