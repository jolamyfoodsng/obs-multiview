/**
 * ltVersionHistory.ts — Version History Store for Lower Thirds
 *
 * Captures snapshots of lower-third content whenever the user edits values.
 * Stores: timestamp, themeId, themeName, values, durationConfig.
 * Persists to localStorage. Groups snapshots by time proximity.
 *
 * Features:
 *   - Debounced capture (captures after N seconds of inactivity)
 *   - Max history entries (prunes oldest)
 *   - Restore a snapshot
 *   - Subscribe pattern for React components
 */

import type { LTDurationConfig, LTExitStyle } from "./types";
import { LT_DEFAULT_DURATION_CONFIG } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LTVersionSnapshot {
  /** Unique ID */
  id: string;
  /** When this snapshot was created */
  timestamp: number;
  /** Theme ID at time of snapshot */
  themeId: string;
  /** Theme name for display */
  themeName: string;
  /** Theme accent color for visual indicator */
  themeAccent: string;
  /** All variable values at time of snapshot */
  values: Record<string, string>;
  /** Duration config at time of snapshot */
  durationConfig: {
    durationSeconds: number;
    exitStyle: LTExitStyle;
    useDefaults: boolean;
  };
  /** First text value (for preview subtitle) */
  previewText: string;
  /** Preset ID this snapshot belongs to */
  presetId: string;
}

export interface LTVersionGroup {
  /** Label for this group (e.g. "Just now", "5 minutes ago", "Today 2:30 PM") */
  label: string;
  /** Snapshots in this group, newest first */
  snapshots: LTVersionSnapshot[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "service-hub.lt.version-history";
const MAX_ENTRIES = 100;
const DEBOUNCE_MS = 3000; // 3 seconds of inactivity before capturing

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `vh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatTimeLabel(ts: number): string {
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);

  if (diff < 30) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;

  const date = new Date(ts);
  const today = new Date();
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isToday) return `Today ${timeStr}`;
  if (isYesterday) return `Yesterday ${timeStr}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${timeStr}`;
}

/**
 * Group snapshots by time proximity.
 * Groups are: "Just now" (< 1 min), then by time label.
 */
function groupSnapshots(snapshots: LTVersionSnapshot[]): LTVersionGroup[] {
  if (snapshots.length === 0) return [];

  const groups: LTVersionGroup[] = [];
  const labelMap = new Map<string, LTVersionSnapshot[]>();

  for (const snap of snapshots) {
    const label = formatTimeLabel(snap.timestamp);
    if (!labelMap.has(label)) labelMap.set(label, []);
    labelMap.get(label)!.push(snap);
  }

  for (const [label, snaps] of labelMap) {
    groups.push({ label, snapshots: snaps });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Version History Store — Singleton
// ---------------------------------------------------------------------------

class LTVersionHistoryStore {
  private _history: LTVersionSnapshot[] = [];
  private _listeners: Set<() => void> = new Set();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingSnapshot: Omit<LTVersionSnapshot, "id" | "timestamp"> | null = null;

  constructor() {
    this._load();
  }

  // ── Persistence ──

  private _load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this._history = parsed
          .filter(
            (s: unknown): s is LTVersionSnapshot =>
              !!s &&
              typeof s === "object" &&
              typeof (s as any).id === "string" &&
              typeof (s as any).timestamp === "number" &&
              typeof (s as any).themeId === "string",
          )
          .slice(0, MAX_ENTRIES);
      }
    } catch {
      // ignore
    }
  }

  private _save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._history.slice(0, MAX_ENTRIES)));
    } catch {
      // ignore
    }
  }

  // ── Subscribe pattern ──

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }

  // ── Public API ──

  /** Get all snapshots, newest first */
  get snapshots(): LTVersionSnapshot[] {
    return this._history;
  }

  /** Get snapshots grouped by time */
  get groups(): LTVersionGroup[] {
    return groupSnapshots(this._history);
  }

  /** Get snapshots filtered by preset ID */
  getForPreset(presetId: string): LTVersionSnapshot[] {
    return this._history.filter((s) => s.presetId === presetId);
  }

  /** Get grouped snapshots for a specific preset */
  getGroupsForPreset(presetId: string): LTVersionGroup[] {
    return groupSnapshots(this.getForPreset(presetId));
  }

  /**
   * Record a content change (debounced).
   * Call this on every keystroke / value change.
   * A snapshot is only captured after DEBOUNCE_MS of inactivity.
   */
  recordChange(data: {
    themeId: string;
    themeName: string;
    themeAccent: string;
    values: Record<string, string>;
    durationConfig?: LTDurationConfig;
    presetId: string;
  }): void {
    // Extract first non-empty text value as preview text
    const previewText =
      Object.values(data.values).find((v) => v && v.trim().length > 0) || "";

    this._pendingSnapshot = {
      themeId: data.themeId,
      themeName: data.themeName,
      themeAccent: data.themeAccent,
      values: { ...data.values },
      durationConfig: {
        durationSeconds: data.durationConfig?.durationSeconds ?? LT_DEFAULT_DURATION_CONFIG.durationSeconds,
        exitStyle: data.durationConfig?.exitStyle ?? LT_DEFAULT_DURATION_CONFIG.exitStyle,
        useDefaults: data.durationConfig?.useDefaults ?? true,
      },
      previewText,
      presetId: data.presetId,
    };

    // Clear previous debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    // Set new debounce timer
    this._debounceTimer = setTimeout(() => {
      this._commitPending();
    }, DEBOUNCE_MS);
  }

  private _commitPending(): void {
    if (!this._pendingSnapshot) return;

    const snapshot: LTVersionSnapshot = {
      id: generateId(),
      timestamp: Date.now(),
      ...this._pendingSnapshot,
    };

    // Check if this is actually different from the most recent snapshot
    const latest = this._history[0];
    if (
      latest &&
      latest.themeId === snapshot.themeId &&
      latest.presetId === snapshot.presetId &&
      JSON.stringify(latest.values) === JSON.stringify(snapshot.values)
    ) {
      // No actual change — skip
      this._pendingSnapshot = null;
      return;
    }

    this._history.unshift(snapshot);

    // Prune to max entries
    if (this._history.length > MAX_ENTRIES) {
      this._history = this._history.slice(0, MAX_ENTRIES);
    }

    this._pendingSnapshot = null;
    this._save();
    this._notify();
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this._history = [];
    this._save();
    this._notify();
  }

  /**
   * Clear history for a specific preset
   */
  clearForPreset(presetId: string): void {
    this._history = this._history.filter((s) => s.presetId !== presetId);
    this._save();
    this._notify();
  }

  /**
   * Delete a specific snapshot
   */
  deleteSnapshot(id: string): void {
    this._history = this._history.filter((s) => s.id !== id);
    this._save();
    this._notify();
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const ltVersionHistory = new LTVersionHistoryStore();
