/**
 * useBroadcastStore — React Context + useReducer for broadcast state.
 *
 * Wraps broadcastStore.ts reducer in a React provider.
 * All broadcast components use this hook to read state and dispatch actions.
 */

import {
    createContext,
    useContext,
    useReducer,
    useCallback,
    useRef,
    type ReactNode,
    type Dispatch,
} from "react";
import {
    broadcastReducer,
    INITIAL_BROADCAST_STATE,
    type BroadcastState,
    type BroadcastAction,
    type ContentItem,
    type TransitionState,
    type SystemStatus,
    type ContentType,
} from "../services/broadcastStore";
import { obsService } from "../services/obsService";
import {
    applyPreset,
    type PresetId,
    DEFAULT_PRESET_OPTIONS,
} from "../services/presetService";
import { setTransition as obsSetTransition } from "../services/transitionService";
import type { GenerationConfig } from "../services/layoutService";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BroadcastContextValue {
    state: BroadcastState;
    dispatch: Dispatch<BroadcastAction>;
    /** Load a content item into preview */
    loadPreview: (item: ContentItem) => Promise<void>;
    /** Execute TAKE: push preview → program (with OBS side effects) */
    executeTake: () => Promise<void>;
    /** Quick-cut: load + take in one step (for emergency) */
    quickCut: (item: ContentItem) => Promise<void>;
    /** Add item to service queue */
    addToQueue: (item: ContentItem) => void;
    /** Advance to next queue item (loads into preview) */
    nextInQueue: () => void;
    /** Update transition config */
    setTransition: (t: Partial<TransitionState>) => void;
    /** Update system status */
    updateSystem: (s: Partial<SystemStatus>) => void;
    /** Set library tab filter */
    setLibraryTab: (tab: ContentType | "all") => void;
    /** Set library search query */
    setLibrarySearch: (query: string) => void;
}

const BroadcastContext = createContext<BroadcastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface BroadcastProviderProps {
    children: ReactNode;
    config: GenerationConfig | null;
}

export function BroadcastProvider({ children, config }: BroadcastProviderProps) {
    const [state, dispatch] = useReducer(broadcastReducer, INITIAL_BROADCAST_STATE);
    const takeDebounceRef = useRef(false);
    const configRef = useRef(config);
    configRef.current = config;

    const loadPreview = useCallback(async (item: ContentItem) => {
        dispatch({ type: "LOAD_PREVIEW", item });

        // Also set this as the OBS preview scene (Studio Mode)
        const sceneName = item.sceneName;
        if (sceneName) {
            try {
                // Enable Studio Mode if not already on
                const studioStatus = await obsService.call("GetStudioModeEnabled", {}) as { studioModeEnabled: boolean };
                if (!studioStatus.studioModeEnabled) {
                    await obsService.call("SetStudioModeEnabled", { studioModeEnabled: true });
                }
                // Set the preview scene in OBS
                await obsService.call("SetCurrentPreviewScene", { sceneName });
                console.log(`[Broadcast] OBS preview set to: "${sceneName}"`);
            } catch (err) {
                console.warn("[Broadcast] Failed to set OBS preview scene:", err);
            }
        }
    }, []);

    /**
     * TAKE — the core broadcast action.
     * 1. Apply the preview content to OBS (preset or scene switch)
     * 2. Move preview → program in state
     * 3. Debounce to prevent accidental double-take
     */
    const executeTake = useCallback(async () => {
        if (takeDebounceRef.current) {
            console.warn("[Broadcast] TAKE blocked — debounce active");
            return;
        }
        if (!state.preview) {
            console.warn("[Broadcast] TAKE blocked — nothing in preview");
            return;
        }

        takeDebounceRef.current = true;
        dispatch({ type: "TAKE" });

        try {
            const item = state.preview;

            // Set OBS transition type before switching
            if (state.transition.type === "fade") {
                await obsSetTransition({ kind: "Fade", durationMs: state.transition.durationMs });
            } else {
                await obsSetTransition({ kind: "Cut", durationMs: 0 });
            }

            // Apply the content to OBS
            if (item.presetId && configRef.current) {
                await applyPreset(
                    item.presetId as PresetId,
                    configRef.current.cameraSource,
                    configRef.current.scriptureSource,
                    DEFAULT_PRESET_OPTIONS
                );
            } else if (item.sceneName) {
                await obsService.setCurrentProgramScene(item.sceneName);
            }

            console.log(`[Broadcast] TAKE executed: "${item.title}"`);
        } catch (err) {
            console.error("[Broadcast] TAKE failed:", err);
        } finally {
            dispatch({ type: "TAKE_COMPLETE" });
            // Debounce: block another TAKE for 500ms
            setTimeout(() => {
                takeDebounceRef.current = false;
            }, 500);
        }
    }, [state.preview, state.transition]);

    const quickCut = useCallback(async (item: ContentItem) => {
        dispatch({ type: "LOAD_PREVIEW", item });
        // Allow state to update, then take
        setTimeout(async () => {
            takeDebounceRef.current = false; // Override debounce for emergency
            dispatch({ type: "TAKE" });

            try {
                await obsSetTransition({ kind: "Cut", durationMs: 0 });

                if (item.presetId && configRef.current) {
                    await applyPreset(
                        item.presetId as PresetId,
                        configRef.current.cameraSource,
                        configRef.current.scriptureSource,
                        DEFAULT_PRESET_OPTIONS
                    );
                } else if (item.sceneName) {
                    await obsService.setCurrentProgramScene(item.sceneName);
                }
            } catch (err) {
                console.error("[Broadcast] Quick cut failed:", err);
            } finally {
                dispatch({ type: "TAKE_COMPLETE" });
                setTimeout(() => { takeDebounceRef.current = false; }, 500);
            }
        }, 50);
    }, []);

    const addToQueue = useCallback((item: ContentItem) => {
        dispatch({ type: "QUEUE_ADD", item });
    }, []);

    const nextInQueue = useCallback(() => {
        dispatch({ type: "QUEUE_NEXT" });
    }, []);

    const setTransitionCb = useCallback((t: Partial<TransitionState>) => {
        dispatch({ type: "SET_TRANSITION", transition: t });
    }, []);

    const updateSystem = useCallback((s: Partial<SystemStatus>) => {
        dispatch({ type: "UPDATE_SYSTEM", status: s });
    }, []);

    const setLibraryTab = useCallback((tab: ContentType | "all") => {
        dispatch({ type: "SET_LIBRARY_TAB", tab });
    }, []);

    const setLibrarySearch = useCallback((query: string) => {
        dispatch({ type: "SET_LIBRARY_SEARCH", query });
    }, []);

    return (
        <BroadcastContext.Provider
            value={{
                state,
                dispatch,
                loadPreview,
                executeTake,
                quickCut,
                addToQueue,
                nextInQueue,
                setTransition: setTransitionCb,
                updateSystem,
                setLibraryTab,
                setLibrarySearch,
            }}
        >
            {children}
        </BroadcastContext.Provider>
    );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBroadcastStore(): BroadcastContextValue {
    const ctx = useContext(BroadcastContext);
    if (!ctx) {
        throw new Error("useBroadcastStore must be used inside <BroadcastProvider>");
    }
    return ctx;
}
