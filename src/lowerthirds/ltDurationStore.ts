/**
 * ltDurationStore.ts — Duration + Auto-Clear Timer Engine
 *
 * Singleton store that manages:
 *   - Active lower third tracking (what's currently showing)
 *   - Countdown timer with auto-clear on expiry
 *   - Pin / unpin (infinite duration)
 *   - "Until next LT" mode (clears previous when new one shows)
 *   - "Until scene changes" mode (subscribes to OBS scene change events)
 *   - Global defaults per LT type with localStorage persistence
 *   - Re-show Last support
 *   - OBS disconnect handling (pauses timers)
 *
 * This is a plain TypeScript singleton (not React context) so it can be
 * used from both LowerThirdsModule and SpeakerModule without nesting.
 * React components subscribe via `subscribe()` and get notified on changes.
 */

import { obsService } from "../services/obsService";
import type {
  LTExitStyle,
  LTType,
  LTDurationConfig,
  LTGlobalDefaults,
  LTActiveState,
} from "./types";
import {
  LT_DEFAULT_GLOBAL_DEFAULTS,
  LT_DEFAULT_ACTIVE_STATE,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// localStorage keys
// ─────────────────────────────────────────────────────────────────────────────

const LS_GLOBAL_DEFAULTS = "ocs-lt-global-defaults";
const LS_DURATION_CONFIGS = "ocs-lt-duration-configs";

// ─────────────────────────────────────────────────────────────────────────────
// Types for callbacks
// ─────────────────────────────────────────────────────────────────────────────

export type LTDurationListener = () => void;

export type LTAutoClearCallback = (exitStyle: LTExitStyle) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// LTDurationStore — singleton
// ─────────────────────────────────────────────────────────────────────────────

class LTDurationStore {
  // ── State ─────────────────────────────────────────────────────────────
  private _activeState: LTActiveState = { ...LT_DEFAULT_ACTIVE_STATE };
  private _globalDefaults: LTGlobalDefaults;
  private _durationConfigs: Record<string, LTDurationConfig> = {};

  // ── Timer ─────────────────────────────────────────────────────────────
  private _timerInterval: ReturnType<typeof setInterval> | null = null;
  private _isPaused = false;

  // ── Subscribers ───────────────────────────────────────────────────────
  private _listeners: Set<LTDurationListener> = new Set();

  // ── OBS scene change unsubscribe ──────────────────────────────────────
  private _sceneChangeUnsub: (() => void) | null = null;

  // ── Auto-clear callback (provided by component) ──────────────────────
  private _autoClearCallback: LTAutoClearCallback | null = null;

  // ── OBS connection tracking ───────────────────────────────────────────
  private _obsConnectionUnsub: (() => void) | null = null;

  constructor() {
    // Load global defaults from localStorage
    this._globalDefaults = this._loadGlobalDefaults();
    // Load per-LT duration configs from localStorage
    this._durationConfigs = this._loadDurationConfigs();
    // Subscribe to OBS connection status
    this._setupObsConnectionTracking();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Getters
  // ═══════════════════════════════════════════════════════════════════════

  get activeState(): LTActiveState {
    return { ...this._activeState };
  }

  get globalDefaults(): LTGlobalDefaults {
    return { ...this._globalDefaults };
  }

  get isActive(): boolean {
    return this._activeState.activeLowerThirdId !== null;
  }

  get isTimerRunning(): boolean {
    return this._timerInterval !== null && !this._isPaused;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Subscribe / Notify
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   */
  subscribe(listener: LTDurationListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify() {
    this._listeners.forEach((fn) => fn());
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Auto-clear callback registration
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Register the callback that performs the actual OBS blank/clear.
   * This is called by the component (LT or Speaker module) so the
   * duration store doesn't need to know about OBS service directly.
   */
  setAutoClearCallback(cb: LTAutoClearCallback) {
    this._autoClearCallback = cb;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Per-LT Duration Config CRUD
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get the effective duration config for a given LT.
   * If `useDefaults` is true or no config exists, returns global defaults.
   */
  getConfigForLT(ltId: string, ltType: LTType = "generic"): LTDurationConfig {
    const saved = this._durationConfigs[ltId];
    if (saved && !saved.useDefaults) {
      return { ...saved };
    }
    // Use global defaults
    return {
      durationSeconds: this._globalDefaults.durations[ltType],
      triggerMode: this._globalDefaults.triggerMode,
      exitStyle: this._globalDefaults.exitStyle,
      useDefaults: true,
      isPinned: false,
    };
  }

  /**
   * Save a duration config for a specific LT.
   */
  setConfigForLT(ltId: string, config: LTDurationConfig) {
    this._durationConfigs[ltId] = { ...config };
    this._saveDurationConfigs();
    this._notify();
  }

  /**
   * Remove a saved config for a specific LT (reverts to defaults).
   */
  removeConfigForLT(ltId: string) {
    delete this._durationConfigs[ltId];
    this._saveDurationConfigs();
    this._notify();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Global Defaults
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update global defaults (partial merge).
   */
  setGlobalDefaults(patch: Partial<LTGlobalDefaults>) {
    this._globalDefaults = { ...this._globalDefaults, ...patch };
    if (patch.durations) {
      this._globalDefaults.durations = {
        ...this._globalDefaults.durations,
        ...patch.durations,
      };
    }
    this._saveGlobalDefaults();
    this._notify();
  }

  /**
   * Reset global defaults to factory values.
   */
  resetGlobalDefaults() {
    this._globalDefaults = { ...LT_DEFAULT_GLOBAL_DEFAULTS, durations: { ...LT_DEFAULT_GLOBAL_DEFAULTS.durations } };
    this._saveGlobalDefaults();
    this._notify();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Show / Clear / Pin / Re-show — Core Timer Logic
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Called when a lower third goes live.
   * Starts the timer based on config.
   */
  show(params: {
    ltId: string;
    label: string;
    subtitle: string;
    themeId: string;
    values: Record<string, string>;
    ltType?: LTType;
    config?: LTDurationConfig;
  }) {
    const { ltId, label, subtitle, themeId, values, ltType = "generic" } = params;
    const config = params.config || this.getConfigForLT(ltId, ltType);

    // If "until next LT" mode is active on the previous one, auto-clear it first
    if (
      this._activeState.activeLowerThirdId &&
      this._activeState.activeLowerThirdId !== ltId &&
      this._activeState.triggerMode === "untilNext"
    ) {
      this._performAutoClear();
    }

    // Stop any existing timer
    this._stopTimer();

    // Unsubscribe from previous scene change listener
    this._unsubSceneChange();

    // Calculate effective duration
    const effectiveDuration = config.isPinned ? 0 : config.durationSeconds;

    // Update active state
    this._activeState = {
      activeLowerThirdId: ltId,
      activeLabel: label,
      activeSubtitle: subtitle,
      activeThemeId: themeId,
      shownAt: Date.now(),
      totalDuration: effectiveDuration,
      remainingSeconds: effectiveDuration,
      isPinned: config.isPinned,
      triggerMode: config.triggerMode,
      exitStyle: config.exitStyle,
      isVisible: true,
      lastShownLowerThirdId: ltId,
      lastShownValues: { ...values },
      lastShownThemeId: themeId,
    };

    // Start timer if timed + not pinned
    if (config.triggerMode === "timed" && !config.isPinned && effectiveDuration > 0) {
      this._startTimer(effectiveDuration);
    }

    // Subscribe to scene changes if needed
    if (config.triggerMode === "untilSceneChange") {
      this._subscribeSceneChange();
    }

    this._notify();
  }

  /**
   * Called when user manually clears (Clear Now button or clear action).
   */
  clear() {
    this._stopTimer();
    this._unsubSceneChange();

    // Snapshot for re-show before clearing
    if (this._activeState.activeLowerThirdId) {
      this._activeState.lastShownLowerThirdId = this._activeState.activeLowerThirdId;
    }

    this._activeState = {
      ...LT_DEFAULT_ACTIVE_STATE,
      lastShownLowerThirdId: this._activeState.lastShownLowerThirdId,
      lastShownValues: this._activeState.lastShownValues,
      lastShownThemeId: this._activeState.lastShownThemeId,
    };

    this._notify();
  }

  /**
   * Toggle pin state of the active LT.
   */
  togglePin() {
    if (!this._activeState.activeLowerThirdId) return;

    this._activeState.isPinned = !this._activeState.isPinned;

    if (this._activeState.isPinned) {
      // Pinning — stop the timer
      this._stopTimer();
      this._activeState.remainingSeconds = 0;
      this._activeState.totalDuration = 0;
    } else {
      // Unpinning — restart timer with the saved duration config
      const config = this.getConfigForLT(this._activeState.activeLowerThirdId);
      if (config.triggerMode === "timed" && config.durationSeconds > 0) {
        this._activeState.totalDuration = config.durationSeconds;
        this._activeState.remainingSeconds = config.durationSeconds;
        this._startTimer(config.durationSeconds);
      }
    }

    this._notify();
  }

  /**
   * Returns the last-shown LT info for re-show.
   */
  getLastShown(): { id: string | null; values: Record<string, string>; themeId: string | null } {
    return {
      id: this._activeState.lastShownLowerThirdId,
      values: { ...this._activeState.lastShownValues },
      themeId: this._activeState.lastShownThemeId,
    };
  }

  /**
   * Called when content is edited while live (updates label/subtitle without restarting timer).
   */
  updateLiveContent(label: string, subtitle: string, values: Record<string, string>) {
    if (!this._activeState.activeLowerThirdId) return;

    this._activeState.activeLabel = label;
    this._activeState.activeSubtitle = subtitle;
    this._activeState.lastShownValues = { ...values };

    this._notify();
  }

  /**
   * Called when visibility is toggled (hidden/visible) without clearing.
   */
  setVisible(visible: boolean) {
    this._activeState.isVisible = visible;

    if (!visible) {
      // Pause timer while hidden
      this._pauseTimer();
    } else {
      // Resume timer when visible again
      this._resumeTimer();
    }

    this._notify();
  }

  /**
   * Called on section/tab change to auto-clear if enabled.
   */
  onSectionChange() {
    if (this._globalDefaults.autoClearOnSectionChange && this._activeState.activeLowerThirdId) {
      this._performAutoClear();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Timer internals
  // ═══════════════════════════════════════════════════════════════════════

  private _startTimer(durationSeconds: number) {
    this._stopTimer();
    this._isPaused = false;

    this._activeState.remainingSeconds = durationSeconds;

    this._timerInterval = setInterval(() => {
      if (this._isPaused) return;

      this._activeState.remainingSeconds = Math.max(0, this._activeState.remainingSeconds - 1);
      this._notify();

      if (this._activeState.remainingSeconds <= 0) {
        this._stopTimer();
        this._performAutoClear();
      }
    }, 1000);
  }

  private _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    this._isPaused = false;
  }

  private _pauseTimer() {
    this._isPaused = true;
  }

  private _resumeTimer() {
    if (this._timerInterval && this._isPaused) {
      this._isPaused = false;
    }
  }

  /**
   * Perform auto-clear: call the registered callback with the exit style,
   * then reset active state.
   */
  private async _performAutoClear() {
    const exitStyle = this._activeState.exitStyle;

    // Snapshot for re-show
    const snapshot = {
      lastShownLowerThirdId: this._activeState.activeLowerThirdId,
      lastShownValues: { ...this._activeState.lastShownValues },
      lastShownThemeId: this._activeState.lastShownThemeId,
    };

    // Stop timer + scene subscription
    this._stopTimer();
    this._unsubSceneChange();

    if (this._autoClearCallback) {
      try {
        await this._autoClearCallback(exitStyle);
      } catch (err) {
        console.warn("[LT-Duration] Auto-clear callback failed:", err);
      }
    }

    // Reset active state, keep re-show info
    this._activeState = {
      ...LT_DEFAULT_ACTIVE_STATE,
      lastShownLowerThirdId: snapshot.lastShownLowerThirdId,
      lastShownValues: snapshot.lastShownValues,
      lastShownThemeId: snapshot.lastShownThemeId,
    };

    this._notify();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OBS Scene Change subscription
  // ═══════════════════════════════════════════════════════════════════════

  private _subscribeSceneChange() {
    this._unsubSceneChange();

    try {
      this._sceneChangeUnsub = obsService.on("CurrentProgramSceneChanged", () => {
        if (
          this._activeState.activeLowerThirdId &&
          this._activeState.triggerMode === "untilSceneChange"
        ) {
          this._performAutoClear();
        }
      });
    } catch (err) {
      console.warn("[LT-Duration] Failed to subscribe to scene changes:", err);
    }
  }

  private _unsubSceneChange() {
    if (this._sceneChangeUnsub) {
      this._sceneChangeUnsub();
      this._sceneChangeUnsub = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OBS Connection tracking (pause timer on disconnect)
  // ═══════════════════════════════════════════════════════════════════════

  private _setupObsConnectionTracking() {
    this._obsConnectionUnsub = obsService.onStatusChange((status) => {
      if (status !== "connected") {
        // OBS disconnected — pause timer
        if (this._timerInterval && !this._isPaused) {
          this._pauseTimer();
          this._notify();
        }
      } else {
        // OBS reconnected — resume timer if it was paused due to disconnect
        if (this._isPaused && this._timerInterval) {
          this._resumeTimer();
          this._notify();
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // localStorage persistence
  // ═══════════════════════════════════════════════════════════════════════

  private _loadGlobalDefaults(): LTGlobalDefaults {
    try {
      const raw = localStorage.getItem(LS_GLOBAL_DEFAULTS);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...LT_DEFAULT_GLOBAL_DEFAULTS,
          ...parsed,
          durations: {
            ...LT_DEFAULT_GLOBAL_DEFAULTS.durations,
            ...(parsed.durations || {}),
          },
        };
      }
    } catch (err) {
      console.warn("[LT-Duration] Failed to load global defaults:", err);
    }
    return { ...LT_DEFAULT_GLOBAL_DEFAULTS, durations: { ...LT_DEFAULT_GLOBAL_DEFAULTS.durations } };
  }

  private _saveGlobalDefaults() {
    try {
      localStorage.setItem(LS_GLOBAL_DEFAULTS, JSON.stringify(this._globalDefaults));
    } catch (err) {
      console.warn("[LT-Duration] Failed to save global defaults:", err);
    }
  }

  private _loadDurationConfigs(): Record<string, LTDurationConfig> {
    try {
      const raw = localStorage.getItem(LS_DURATION_CONFIGS);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn("[LT-Duration] Failed to load duration configs:", err);
    }
    return {};
  }

  private _saveDurationConfigs() {
    try {
      localStorage.setItem(LS_DURATION_CONFIGS, JSON.stringify(this._durationConfigs));
    } catch (err) {
      console.warn("[LT-Duration] Failed to save duration configs:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════════════════

  destroy() {
    this._stopTimer();
    this._unsubSceneChange();
    if (this._obsConnectionUnsub) {
      this._obsConnectionUnsub();
      this._obsConnectionUnsub = null;
    }
    this._listeners.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const ltDurationStore = new LTDurationStore();
