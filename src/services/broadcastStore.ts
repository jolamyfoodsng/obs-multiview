/**
 * Broadcast Store — OBS Church Studio
 *
 * Central state for the 3-column broadcast control interface.
 * Uses React Context + useReducer for predictable, debuggable state.
 *
 * State slices:
 *   preview   — What the operator is preparing (not live)
 *   program   — What is currently live on OBS output
 *   queue     — Ordered service items to run through
 *   library   — Content items available to load
 *   system    — OBS health, stream status, connection
 *
 * Design principles:
 *   - Preview and Program are ALWAYS separate
 *   - Nothing goes live without an explicit TAKE action
 *   - Queue is ordered, supports reorder + insert
 *   - All state changes are through dispatched actions
 */

import type { StreamingPlatform } from "./streamQuality";

// ---------------------------------------------------------------------------
// Content Item — shared across library, queue, preview, program
// ---------------------------------------------------------------------------

export type ContentType =
    | "preset"
    | "bible"
    | "worship"
    | "media"
    | "lower-third"
    | "scene";

export interface ContentItem {
    /** Unique ID (UUID or deterministic key) */
    id: string;
    /** Display title */
    title: string;
    /** Content category */
    type: ContentType;
    /** Material icon name */
    icon: string;
    /** Optional subtitle (e.g. "John 3:16 KJV") */
    subtitle?: string;
    /** Optional thumbnail data URL */
    thumbnail?: string | null;
    /** Preset ID if type === "preset" */
    presetId?: string;
    /** OBS scene name if type === "scene" */
    sceneName?: string;
    /** Arbitrary metadata for the content */
    meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Queue Item — content item + queue-specific state
// ---------------------------------------------------------------------------

export interface QueueItem {
    /** Unique queue entry ID (different from content ID for duplicates) */
    queueId: string;
    /** The underlying content */
    content: ContentItem;
    /** Has this item been played? */
    played: boolean;
}

// ---------------------------------------------------------------------------
// System Status
// ---------------------------------------------------------------------------

export interface SystemStatus {
    /** OBS connection state */
    obsConnected: boolean;
    /** Current OBS program scene name */
    obsScene: string | null;
    /** Streaming active? */
    streaming: boolean;
    /** Recording active? */
    recording: boolean;
    /** Dropped frames in current session */
    droppedFrames: number;
    /** Output FPS */
    fps: number;
    /** CPU usage percentage (0-100) */
    cpuUsage: number;
    /** Stream health: good, warning, critical */
    streamHealth: "good" | "warning" | "critical" | "offline";
    /** Stream destination the guidance is based on */
    streamingPlatform: StreamingPlatform;
    /** Current output format label */
    streamFormatLabel: string;
    /** Current measured bitrate */
    currentBitrateKbps: number | null;
    /** Estimated safe upload capacity */
    estimatedUploadCapacityMbps: number | null;
    /** Current reconnect flag from OBS */
    reconnecting: boolean;
    /** Stream Check summary */
    overallStreamRiskTitle: string;
    /** Stream Check probable cause */
    streamProbableCause: string;
    /** Video quality status */
    videoQualityStatus: "good" | "warning" | "critical" | "offline";
    /** Video quality headline */
    videoQualityTitle: string;
    /** Video quality supporting text */
    videoQualityAdvice: string;
    /** Platform label used in UI */
    streamPlatformLabel: string;
    /** Platform helper used in UI */
    streamPlatformHelper: string;
}

// ---------------------------------------------------------------------------
// Transition Config
// ---------------------------------------------------------------------------

export type TransitionType = "cut" | "fade" | "stinger";

export interface TransitionState {
    type: TransitionType;
    /** Duration in ms (only for fade/stinger) */
    durationMs: number;
}

// ---------------------------------------------------------------------------
// Broadcast State — the entire store
// ---------------------------------------------------------------------------

export interface BroadcastState {
    /** Content loaded into preview (not live) */
    preview: ContentItem | null;
    /** Content currently live on program output */
    program: ContentItem | null;
    /** Ordered service queue */
    queue: QueueItem[];
    /** Index of the current live item in queue (-1 if none) */
    queueIndex: number;
    /** Transition configuration */
    transition: TransitionState;
    /** System health status */
    system: SystemStatus;
    /** Is a TAKE currently executing? (debounce) */
    takePending: boolean;
    /** Content library active tab */
    libraryTab: ContentType | "all";
    /** Content library search query */
    librarySearch: string;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const INITIAL_BROADCAST_STATE: BroadcastState = {
    preview: null,
    program: null,
    queue: [],
    queueIndex: -1,
    transition: {
        type: "cut",
        durationMs: 300,
    },
    system: {
        obsConnected: false,
        obsScene: null,
        streaming: false,
        recording: false,
        droppedFrames: 0,
        fps: 0,
        cpuUsage: 0,
        streamHealth: "offline",
        streamingPlatform: "custom",
        streamFormatLabel: "Waiting for OBS video settings",
        currentBitrateKbps: null,
        estimatedUploadCapacityMbps: null,
        reconnecting: false,
        overallStreamRiskTitle: "Off Air",
        streamProbableCause: "Start streaming to measure bitrate, upload headroom, and stability.",
        videoQualityStatus: "offline",
        videoQualityTitle: "Waiting for a live stream",
        videoQualityAdvice: "Stream Check becomes more accurate once OBS is live.",
        streamPlatformLabel: "Custom / Other",
        streamPlatformHelper: "General safe recommendations",
    },
    takePending: false,
    libraryTab: "all",
    librarySearch: "",
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type BroadcastAction =
    // Preview
    | { type: "LOAD_PREVIEW"; item: ContentItem }
    | { type: "CLEAR_PREVIEW" }
    // Program (only via TAKE or direct emergency)
    | { type: "TAKE" }
    | { type: "TAKE_COMPLETE" }
    | { type: "SET_PROGRAM"; item: ContentItem }
    // Queue
    | { type: "QUEUE_ADD"; item: ContentItem }
    | { type: "QUEUE_REMOVE"; queueId: string }
    | { type: "QUEUE_REORDER"; fromIndex: number; toIndex: number }
    | { type: "QUEUE_GO"; queueId: string }
    | { type: "QUEUE_NEXT" }
    | { type: "QUEUE_CLEAR" }
    // Transition
    | { type: "SET_TRANSITION"; transition: Partial<TransitionState> }
    // System
    | { type: "UPDATE_SYSTEM"; status: Partial<SystemStatus> }
    // Library
    | { type: "SET_LIBRARY_TAB"; tab: ContentType | "all" }
    | { type: "SET_LIBRARY_SEARCH"; query: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

let queueIdCounter = 0;
function nextQueueId(): string {
    return `q_${Date.now()}_${++queueIdCounter}`;
}

export function broadcastReducer(
    state: BroadcastState,
    action: BroadcastAction
): BroadcastState {
    switch (action.type) {
        // ── Preview ──
        case "LOAD_PREVIEW":
            return { ...state, preview: action.item };

        case "CLEAR_PREVIEW":
            return { ...state, preview: null };

        // ── TAKE: Preview → Program ──
        case "TAKE":
            if (state.takePending || !state.preview) return state;
            return {
                ...state,
                takePending: true,
                program: state.preview,
                // If the preview item is in the queue, advance queueIndex
                queueIndex: findQueueIndex(state.queue, state.preview),
            };

        case "TAKE_COMPLETE":
            return { ...state, takePending: false };

        case "SET_PROGRAM":
            return {
                ...state,
                program: action.item,
                queueIndex: findQueueIndex(state.queue, action.item),
            };

        // ── Queue ──
        case "QUEUE_ADD":
            return {
                ...state,
                queue: [
                    ...state.queue,
                    {
                        queueId: nextQueueId(),
                        content: action.item,
                        played: false,
                    },
                ],
            };

        case "QUEUE_REMOVE":
            return {
                ...state,
                queue: state.queue.filter((q) => q.queueId !== action.queueId),
            };

        case "QUEUE_REORDER": {
            const q = [...state.queue];
            const [moved] = q.splice(action.fromIndex, 1);
            q.splice(action.toIndex, 0, moved);
            return { ...state, queue: q };
        }

        case "QUEUE_GO": {
            const idx = state.queue.findIndex((q) => q.queueId === action.queueId);
            if (idx === -1) return state;
            const item = state.queue[idx].content;
            // Mark previous items as played
            const updatedQueue = state.queue.map((q, i) => ({
                ...q,
                played: i < idx ? true : q.played,
            }));
            return {
                ...state,
                preview: item,
                queue: updatedQueue,
                queueIndex: idx,
            };
        }

        case "QUEUE_NEXT": {
            const nextIdx = state.queueIndex + 1;
            if (nextIdx >= state.queue.length) return state;
            const nextItem = state.queue[nextIdx].content;
            return {
                ...state,
                preview: nextItem,
            };
        }

        case "QUEUE_CLEAR":
            return { ...state, queue: [], queueIndex: -1 };

        // ── Transition ──
        case "SET_TRANSITION":
            return {
                ...state,
                transition: { ...state.transition, ...action.transition },
            };

        // ── System ──
        case "UPDATE_SYSTEM":
            return {
                ...state,
                system: { ...state.system, ...action.status },
            };

        // ── Library ──
        case "SET_LIBRARY_TAB":
            return { ...state, libraryTab: action.tab };

        case "SET_LIBRARY_SEARCH":
            return { ...state, librarySearch: action.query };

        default:
            return state;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findQueueIndex(queue: QueueItem[], item: ContentItem): number {
    return queue.findIndex((q) => q.content.id === item.id);
}

// ---------------------------------------------------------------------------
// Default Content Library — built-in presets as content items
// ---------------------------------------------------------------------------

import { SUNDAY_SCENES } from "./layoutService";

export const BUILT_IN_PRESETS: ContentItem[] = [
    {
        id: "preset:full-pastor",
        title: "Full Pastor",
        type: "preset",
        icon: "person",
        subtitle: "Camera fills entire screen",
        presetId: "full-pastor",
        sceneName: SUNDAY_SCENES.FULL_PASTOR,
    },
    {
        id: "preset:scripture-view",
        title: "Scripture View",
        type: "preset",
        icon: "menu_book",
        subtitle: "Camera + Scripture side by side",
        presetId: "scripture-view",
        sceneName: SUNDAY_SCENES.SCRIPTURE_VIEW,
    },
    {
        id: "preset:worship",
        title: "Worship",
        type: "preset",
        icon: "music_note",
        subtitle: "Camera with lyrics overlay",
        presetId: "worship",
        sceneName: SUNDAY_SCENES.WORSHIP,
    },
    {
        id: "preset:pip",
        title: "Picture in Picture",
        type: "preset",
        icon: "picture_in_picture",
        subtitle: "Scripture fullscreen, camera in corner",
        presetId: "picture-in-picture",
        sceneName: SUNDAY_SCENES.SCRIPTURE_VIEW,
    },
    {
        id: "preset:full-scripture",
        title: "Full Scripture",
        type: "preset",
        icon: "auto_stories",
        subtitle: "Scripture fills entire screen",
        presetId: "fullscreen-scripture",
        sceneName: SUNDAY_SCENES.SCRIPTURE_VIEW,
    },
    {
        id: "preset:blank",
        title: "Blank Screen",
        type: "preset",
        icon: "visibility_off",
        subtitle: "Emergency — black screen",
        presetId: "blank",
    },
];

/**
 * Build the complete content library from built-ins + OBS scenes.
 */
export function buildContentLibrary(
    obsScenes: Array<{ sceneName: string }>
): ContentItem[] {
    const sceneItems: ContentItem[] = obsScenes
        .filter((s) => !s.sceneName.startsWith("Sunday -"))
        .map((s) => ({
            id: `scene:${s.sceneName}`,
            title: s.sceneName,
            type: "scene" as ContentType,
            icon: "videocam",
            subtitle: "OBS Scene",
            sceneName: s.sceneName,
        }));

    return [...BUILT_IN_PRESETS, ...sceneItems];
}
