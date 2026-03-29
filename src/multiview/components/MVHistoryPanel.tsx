/**
 * MVHistoryPanel.tsx — Audit Log / History Panel
 *
 * Tracks editor actions with timestamps and provides:
 *  - Chronological action log with human-readable descriptions
 *  - Filtering by action category
 *  - Clear history
 *  - Export log as JSON
 *
 * Uses a simple in-memory store with React state sync.
 */

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import Icon from "../../components/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: number;
  timestamp: string;       // ISO string
  action: string;          // The reducer action type
  description: string;     // Human-readable text
  category: HistoryCategory;
  detail?: string;         // Optional extra info
}

export type HistoryCategory = "layout" | "region" | "selection" | "view" | "save" | "obs" | "other";

// ---------------------------------------------------------------------------
// Action → human label map
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, { desc: string; cat: HistoryCategory }> = {
  OPEN_LAYOUT:               { desc: "Opened layout",                  cat: "layout" },
  CLOSE_LAYOUT:              { desc: "Closed layout",                  cat: "layout" },
  UPDATE_LAYOUT:             { desc: "Updated layout properties",      cat: "layout" },
  SET_BACKGROUND:            { desc: "Changed background",             cat: "layout" },
  UPDATE_SAFE_FRAME:         { desc: "Updated safe-frame settings",    cat: "layout" },
  ADD_REGION:                { desc: "Added region",                   cat: "region" },
  ADD_OBS_SCENE:             { desc: "Added OBS scene as region",      cat: "region" },
  ASSIGN_SCENE_TO_REGION:    { desc: "Assigned scene to region",       cat: "obs" },
  UNASSIGN_SCENE_FROM_REGION:{ desc: "Unassigned scene from region",   cat: "obs" },
  UPDATE_REGION:             { desc: "Updated region",                 cat: "region" },
  DELETE_REGIONS:            { desc: "Deleted region(s)",              cat: "region" },
  DUPLICATE_REGIONS:         { desc: "Duplicated region(s)",           cat: "region" },
  REORDER_REGION:            { desc: "Reordered region",               cat: "region" },
  TOGGLE_LOCK:               { desc: "Toggled region lock",            cat: "region" },
  TOGGLE_VISIBILITY:         { desc: "Toggled region visibility",      cat: "region" },
  SELECT_REGION:             { desc: "Selected region",                cat: "selection" },
  SELECT_ALL:                { desc: "Selected all regions",           cat: "selection" },
  DESELECT_ALL:              { desc: "Deselected all",                 cat: "selection" },
  SELECT_NEXT_REGION:        { desc: "Selected next region",           cat: "selection" },
  SELECT_PREV_REGION:        { desc: "Selected previous region",       cat: "selection" },
  COPY:                      { desc: "Copied region(s)",               cat: "region" },
  PASTE:                     { desc: "Pasted region(s)",               cat: "region" },
  UNDO:                      { desc: "Undo",                           cat: "layout" },
  REDO:                      { desc: "Redo",                           cat: "layout" },
  SNAPSHOT:                  { desc: "Snapshot (undo checkpoint)",     cat: "layout" },
  SET_ZOOM:                  { desc: "Changed zoom",                   cat: "view" },
  SET_PAN:                   { desc: "Panned canvas",                  cat: "view" },
  TOGGLE_SAFE_FRAME:         { desc: "Toggled safe-frame",             cat: "view" },
  TOGGLE_GRID:               { desc: "Toggled grid",                   cat: "view" },
  TOGGLE_SNAP:               { desc: "Toggled snap",                   cat: "view" },
  TOGGLE_BACKGROUND_PICKER:  { desc: "Toggled background picker",     cat: "view" },
  SET_DRAGGING:              { desc: "Set dragging state",             cat: "view" },
  SET_RESIZING:              { desc: "Set resizing state",             cat: "view" },
  RESET_CANVAS:              { desc: "Reset canvas to defaults",       cat: "layout" },
  ALIGN_REGIONS:             { desc: "Aligned regions",                cat: "region" },
  DISTRIBUTE_REGIONS:        { desc: "Distributed regions",            cat: "region" },
  LOCK_ALL:                  { desc: "Locked all regions",             cat: "region" },
  UNLOCK_ALL:                { desc: "Unlocked all regions",           cat: "region" },
  RENAME_REGION:             { desc: "Renamed region",                 cat: "region" },
  // Custom entries (not from reducer)
  LAYOUT_SAVED:              { desc: "Layout saved",                   cat: "save" },
  OBS_CONNECTED:             { desc: "Connected to OBS",               cat: "obs" },
  OBS_DISCONNECTED:          { desc: "Disconnected from OBS",          cat: "obs" },
  LAYOUT_EXPORTED:           { desc: "Exported layout",                cat: "save" },
  LAYOUT_IMPORTED:           { desc: "Imported layout",                cat: "save" },
};

// ---------------------------------------------------------------------------
// Actions we skip (too noisy)
// ---------------------------------------------------------------------------

const SKIP_ACTIONS = new Set([
  "SNAPSHOT",
  "SET_DRAGGING",
  "SET_RESIZING",
  "SET_PAN",
  "SET_ZOOM",
  "SELECT_REGION",
  "DESELECT_ALL",
  "SELECT_ALL",
  "SELECT_NEXT_REGION",
  "SELECT_PREV_REGION",
]);

// ---------------------------------------------------------------------------
// History Store (singleton, in-memory)
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;
let _entries: HistoryEntry[] = [];
let _nextId = 1;
let _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((fn) => fn());
}

/** Record an action into the audit log */
export function recordAction(
  actionType: string,
  detail?: string
) {
  if (SKIP_ACTIONS.has(actionType)) return;

  const meta = ACTION_LABELS[actionType];
  const entry: HistoryEntry = {
    id: _nextId++,
    timestamp: new Date().toISOString(),
    action: actionType,
    description: meta?.desc ?? actionType.replace(/_/g, " ").toLowerCase(),
    category: meta?.cat ?? "other",
    detail,
  };
  _entries = [entry, ..._entries].slice(0, MAX_ENTRIES);
  _notify();
}

/** Clear the entire log */
export function clearHistory() {
  _entries = [];
  _nextId = 1;
  _notify();
}

/** Export the log as a downloadable JSON file */
export function exportHistory() {
  const blob = new Blob([JSON.stringify(_entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Hook to subscribe to history entries */
function useHistoryEntries(): HistoryEntry[] {
  return useSyncExternalStore(
    (cb) => {
      _listeners.add(cb);
      return () => { _listeners.delete(cb); };
    },
    () => _entries
  );
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<HistoryCategory, { label: string; icon: string; color: string }> = {
  layout:    { label: "Layout",    icon: "dashboard",       color: "#6c5ce7" },
  region:    { label: "Region",    icon: "crop_free",       color: "#00b894" },
  selection: { label: "Select",    icon: "select_all",      color: "#fdcb6e" },
  view:      { label: "View",      icon: "visibility",      color: "#74b9ff" },
  save:      { label: "Save",      icon: "save",            color: "#55efc4" },
  obs:       { label: "OBS",       icon: "videocam",        color: "#e17055" },
  other:     { label: "Other",     icon: "more_horiz",      color: "#b2bec3" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MVHistoryPanel() {
  const entries = useHistoryEntries();
  const [filter, setFilter] = useState<HistoryCategory | "all">("all");
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = filter === "all"
    ? entries
    : entries.filter((e) => e.category === filter);

  const formatTime = useCallback((iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, []);

  // auto-scroll when new entries arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  return (
    <div className="mv-history-panel" role="log" aria-label="Action history">
      {/* Header */}
      <div className="mv-history-header">
        <div className="mv-history-title">
          <Icon name="history" size={18} />
          <span>History</span>
          <span className="mv-history-count">{entries.length}</span>
        </div>
        <div className="mv-history-actions">
          <button
            className="mv-btn mv-btn--ghost mv-btn--xs"
            title="Export log"
            onClick={exportHistory}
            disabled={entries.length === 0}
          >
            <Icon name="download" size={16} />
          </button>
          <button
            className="mv-btn mv-btn--ghost mv-btn--xs"
            title="Clear history"
            onClick={clearHistory}
            disabled={entries.length === 0}
          >
            <Icon name="delete_sweep" size={16} />
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mv-history-filters" role="tablist" aria-label="Filter by category">
        <button
          role="tab"
          aria-selected={filter === "all"}
          className={`mv-history-chip${filter === "all" ? " mv-history-chip--active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {(Object.keys(CATEGORY_META) as HistoryCategory[]).map((cat) => (
          <button
            key={cat}
            role="tab"
            aria-selected={filter === cat}
            className={`mv-history-chip${filter === cat ? " mv-history-chip--active" : ""}`}
            onClick={() => setFilter(cat)}
          >
            {CATEGORY_META[cat].label}
          </button>
        ))}
      </div>

      {/* Entry list */}
      <div className="mv-history-list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="mv-history-empty">
            <Icon name="receipt_long" size={40} style={{ opacity: 0.3 }} />
            <p>No actions recorded yet.</p>
            <p style={{ fontSize: 12, opacity: 0.6 }}>Actions will appear here as you edit.</p>
          </div>
        ) : (
          filtered.map((entry) => {
            const meta = CATEGORY_META[entry.category];
            return (
              <div key={entry.id} className="mv-history-entry" role="listitem">
                <Icon name={meta.icon} size={16} className="mv-history-entry-icon" style={{ color: meta.color }} />
                <div className="mv-history-entry-body">
                  <span className="mv-history-entry-desc">{entry.description}</span>
                  {entry.detail && (
                    <span className="mv-history-entry-detail">{entry.detail}</span>
                  )}
                </div>
                <span className="mv-history-entry-time">{formatTime(entry.timestamp)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
