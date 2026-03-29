/**
 * serviceStore.ts — Global service state management
 *
 * Tracks the lifecycle of a church service:
 *   idle → preparing → preservice → live → ended
 *
 * Stores:
 *   - Scene mappings (main scene, worship, slides, etc.)
 *   - Service stats (bible verses shown, songs played, duration)
 *   - Service metadata (name, start time)
 */

// ── Types ──

export type ServiceStatus = "idle" | "preparing" | "preservice" | "live" | "ended";

export interface SceneMapping {
  /** Required: main camera / live scene */
  mainScene: string;
  /** Required: pre-service countdown scene */
  preServiceScene: string;
  /** Required: clean camera / stage feed */
  cleanCameraScene: string;
  /** Optional: worship scene */
  worshipScene: string;
  /** Optional: slides / ProPresenter feed */
  slidesScene: string;
}

export interface ServiceStats {
  bibleVersesDisplayed: number;
  songsPlayed: number;
  lowerThirdsShown: number;
}

export interface ServiceState {
  status: ServiceStatus;
  serviceName: string;
  sceneMapping: SceneMapping;
  stats: ServiceStats;
  startTime: number | null;
  endTime: number | null;
  /** Default layout type: "lower-third" | "fullscreen" */
  defaultLayout: "lower-third" | "fullscreen";
}

// ── Storage Keys ──

const SERVICE_STATE_KEY = "ocs-service-state";
const SCENE_MAPPING_KEY = "ocs-scene-mapping";

// ── Default Values ──

const DEFAULT_SCENE_MAPPING: SceneMapping = {
  mainScene: "",
  preServiceScene: "",
  cleanCameraScene: "",
  worshipScene: "",
  slidesScene: "",
};

const DEFAULT_STATS: ServiceStats = {
  bibleVersesDisplayed: 0,
  songsPlayed: 0,
  lowerThirdsShown: 0,
};

const DEFAULT_STATE: ServiceState = {
  status: "idle",
  serviceName: "",
  sceneMapping: { ...DEFAULT_SCENE_MAPPING },
  stats: { ...DEFAULT_STATS },
  startTime: null,
  endTime: null,
  defaultLayout: "lower-third",
};

// ── Singleton Store ──

type Listener = (state: ServiceState) => void;

class ServiceStore {
  private state: ServiceState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = this.loadState();
  }

  // ── State access ──

  getState(): ServiceState {
    return { ...this.state };
  }

  get status(): ServiceStatus {
    return this.state.status;
  }

  get sceneMapping(): SceneMapping {
    return { ...this.state.sceneMapping };
  }

  get stats(): ServiceStats {
    return { ...this.state.stats };
  }

  // ── Subscribe ──

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const snapshot = this.getState();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  // ── Persistence ──

  private loadState(): ServiceState {
    try {
      const raw = localStorage.getItem(SERVICE_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ServiceState>;
        return { ...DEFAULT_STATE, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_STATE };
  }

  private saveState() {
    try {
      localStorage.setItem(SERVICE_STATE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore
    }
  }

  /** Load stored scene mapping (persisted across sessions) */
  loadSceneMapping(): SceneMapping {
    try {
      const raw = localStorage.getItem(SCENE_MAPPING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SceneMapping>;
        return { ...DEFAULT_SCENE_MAPPING, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_SCENE_MAPPING };
  }

  /** Persist scene mapping for reuse across services */
  saveSceneMapping(mapping: SceneMapping) {
    try {
      localStorage.setItem(SCENE_MAPPING_KEY, JSON.stringify(mapping));
    } catch {
      // ignore
    }
  }

  // ── Actions ──

  /** Start preparing a new service (open the Start Service modal) */
  prepareService(serviceName: string, sceneMapping: SceneMapping, defaultLayout: "lower-third" | "fullscreen") {
    this.state = {
      ...DEFAULT_STATE,
      status: "preparing",
      serviceName,
      sceneMapping,
      defaultLayout,
      stats: { ...DEFAULT_STATS },
      startTime: null,
      endTime: null,
    };
    this.saveSceneMapping(sceneMapping);
    this.saveState();
    this.notify();
  }

  /** Move to pre-service stage */
  startPreService() {
    this.state.status = "preservice";
    this.saveState();
    this.notify();
  }

  /** Go live — service officially starts */
  goLive() {
    this.state.status = "live";
    this.state.startTime = Date.now();
    this.saveState();
    this.notify();
  }

  /** End the service */
  endService() {
    this.state.status = "ended";
    this.state.endTime = Date.now();
    this.saveState();
    this.notify();
  }

  /** Reset back to idle */
  reset() {
    this.state = { ...DEFAULT_STATE };
    this.saveState();
    this.notify();
  }

  // ── Stat Tracking ──

  trackBibleVerse() {
    this.state.stats.bibleVersesDisplayed++;
    this.saveState();
    this.notify();
  }

  trackSongPlayed() {
    this.state.stats.songsPlayed++;
    this.saveState();
    this.notify();
  }

  trackLowerThird() {
    this.state.stats.lowerThirdsShown++;
    this.saveState();
    this.notify();
  }

  /** Get formatted duration string */
  getFormattedDuration(): string {
    const start = this.state.startTime;
    const end = this.state.endTime ?? Date.now();
    if (!start) return "0m";
    const diff = end - start;
    const mins = Math.floor(diff / 60_000);
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours > 0) return `${hours}h ${remainMins}m`;
    return `${remainMins}m`;
  }
}

export const serviceStore = new ServiceStore();
