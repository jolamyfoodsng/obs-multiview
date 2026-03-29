 /**
 * shortcuts.ts — Centralized Keyboard Shortcut Registry
 *
 * Single source of truth for every keyboard shortcut in the app.
 * Provides:
 *   - Platform detection (⌘ on macOS, Ctrl on Windows/Linux)
 *   - Human-readable labels for tooltips ("⌘Z", "Ctrl+Z")
 *   - Categorized shortcut list for the shortcuts reference page
 *   - Matcher function for keydown handlers
 */

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? navigator.userAgent);

/** Modifier key name for display */
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
export const SHIFT = "⇧";
export const ALT_KEY = isMac ? "⌥" : "Alt";

// ---------------------------------------------------------------------------
// Shortcut categories
// ---------------------------------------------------------------------------

export type ShortcutCategory =
  | "file"
  | "edit"
  | "selection"
  | "view"
  | "canvas"
  | "slots"
  | "alignment"
  | "navigation"
  | "bible"
  | "worship"
  | "lowerthirds"
  | "quickmerge"
  | "ticker";

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  file: "File",
  edit: "Edit",
  selection: "Selection",
  view: "View & Zoom",
  canvas: "Canvas & Grid",
  slots: "Slots",
  alignment: "Alignment & Distribution",
  navigation: "Navigation",
  bible: "Bible",
  worship: "Worship",
  lowerthirds: "Lower Thirds",
  quickmerge: "Quick Merge",
  ticker: "Ticker",
};

// ---------------------------------------------------------------------------
// Shortcut definition
// ---------------------------------------------------------------------------

export interface ShortcutDef {
  /** Unique action ID */
  id: string;
  /** Human label shown in menus / shortcuts page */
  label: string;
  /** Category for grouping */
  category: ShortcutCategory;
  /** Keyboard binding */
  keys: ShortcutKeys;
  /** Short description for the shortcuts page */
  description?: string;
  /** Only active in the editor (not on dashboard, settings, etc.) */
  editorOnly?: boolean;
}

export interface ShortcutKeys {
  /** Requires Cmd/Ctrl */
  meta?: boolean;
  /** Requires Shift */
  shift?: boolean;
  /** Requires Alt/Option */
  alt?: boolean;
  /** The key value (e.g. "z", "Delete", "ArrowUp", "Escape", "=", "-", "0") */
  key: string;
}

// ---------------------------------------------------------------------------
// Helper: human-readable label for a shortcut key combo
// ---------------------------------------------------------------------------

export function shortcutLabel(keys: ShortcutKeys): string {
  const parts: string[] = [];
  if (keys.meta) parts.push(MOD_KEY);
  if (keys.alt) parts.push(ALT_KEY);
  if (keys.shift) parts.push(SHIFT);

  // Pretty-print the key
  const k = keys.key;
  const pretty: Record<string, string> = {
    Delete: "⌫",
    Backspace: "⌫",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    " ": "Space",
    Enter: "↵",
    "=": "+",
    "-": "−",
    "[": "[",
    "]": "]",
  };
  parts.push(pretty[k] ?? k.toUpperCase());

  return isMac ? parts.join("") : parts.join("+");
}

// ---------------------------------------------------------------------------
// Helper: does a KeyboardEvent match a ShortcutKeys binding?
// ---------------------------------------------------------------------------

export function matchesShortcut(e: KeyboardEvent, keys: ShortcutKeys): boolean {
  const meta = e.metaKey || e.ctrlKey;
  if (!!keys.meta !== meta) return false;
  if (!!keys.shift !== e.shiftKey) return false;
  if (!!keys.alt !== e.altKey) return false;
  return e.key.toLowerCase() === keys.key.toLowerCase();
}

// ---------------------------------------------------------------------------
// Tooltip helper: "Action Name (⌘Z)"
// ---------------------------------------------------------------------------

export function tooltipWithShortcut(label: string, shortcutId: string): string {
  const def = SHORTCUT_MAP.get(shortcutId);
  if (!def) return label;
  return `${label} (${shortcutLabel(def.keys)})`;
}

// ---------------------------------------------------------------------------
// The Registry
// ---------------------------------------------------------------------------

export const SHORTCUTS: readonly ShortcutDef[] = [
  // ── File ──
  { id: "save", label: "Save", category: "file", keys: { meta: true, key: "s" }, editorOnly: true },
  { id: "push-to-obs", label: "Push to OBS", category: "file", keys: { meta: true, shift: true, key: "p" }, editorOnly: true, description: "Push layout to OBS" },
  { id: "export-layout", label: "Export Layout", category: "file", keys: { meta: true, key: "e" }, editorOnly: true, description: "Export current layout as JSON" },
  { id: "import-layout", label: "Import Layout", category: "file", keys: { meta: true, key: "i" }, description: "Import a layout from JSON file" },
  { id: "new-layout", label: "New Layout", category: "file", keys: { meta: true, key: "n" }, description: "Create a new blank layout" },
  { id: "close-editor", label: "Close Editor", category: "file", keys: { meta: true, key: "w" }, editorOnly: true, description: "Save and return to dashboard" },

  // ── Edit ──
  { id: "undo", label: "Undo", category: "edit", keys: { meta: true, key: "z" }, editorOnly: true },
  { id: "redo", label: "Redo", category: "edit", keys: { meta: true, shift: true, key: "z" }, editorOnly: true },
  { id: "cut", label: "Cut", category: "edit", keys: { meta: true, key: "x" }, editorOnly: true, description: "Cut selected regions to clipboard" },
  { id: "copy", label: "Copy", category: "edit", keys: { meta: true, key: "c" }, editorOnly: true, description: "Copy selected regions to clipboard" },
  { id: "paste", label: "Paste", category: "edit", keys: { meta: true, key: "v" }, editorOnly: true, description: "Paste regions from clipboard" },
  { id: "duplicate", label: "Duplicate", category: "edit", keys: { meta: true, key: "d" }, editorOnly: true, description: "Duplicate selected regions" },
  { id: "delete", label: "Delete", category: "edit", keys: { key: "Delete" }, editorOnly: true, description: "Delete selected regions" },
  { id: "delete-backspace", label: "Delete (Backspace)", category: "edit", keys: { key: "Backspace" }, editorOnly: true, description: "Delete selected regions" },
  { id: "rename-region", label: "Rename Region", category: "edit", keys: { key: "F2" }, editorOnly: true, description: "Rename selected region" },

  // ── Selection ──
  { id: "select-all", label: "Select All", category: "selection", keys: { meta: true, key: "a" }, editorOnly: true },
  { id: "deselect", label: "Deselect All", category: "selection", keys: { key: "Escape" }, editorOnly: true },
  { id: "cycle-next", label: "Select Next Region", category: "selection", keys: { key: "Tab" }, editorOnly: true, description: "Cycle selection to next region" },
  { id: "cycle-prev", label: "Select Previous Region", category: "selection", keys: { shift: true, key: "Tab" }, editorOnly: true, description: "Cycle selection to previous region" },

  // ── View & Zoom ──
  { id: "zoom-in", label: "Zoom In", category: "view", keys: { meta: true, key: "=" }, editorOnly: true },
  { id: "zoom-out", label: "Zoom Out", category: "view", keys: { meta: true, key: "-" }, editorOnly: true },
  { id: "zoom-fit", label: "Zoom to Fit", category: "view", keys: { meta: true, key: "0" }, editorOnly: true },

  // ── Canvas & Grid ──
  { id: "toggle-grid", label: "Toggle Grid", category: "canvas", keys: { meta: true, key: "g" }, editorOnly: true },
  { id: "toggle-snap", label: "Toggle Snap", category: "canvas", keys: { meta: true, shift: true, key: "s" }, editorOnly: true, description: "Toggle snap-to-grid" },
  { id: "toggle-safe-frame", label: "Toggle Safe Frame", category: "canvas", keys: { meta: true, key: "'" }, editorOnly: true },
  { id: "reset-canvas", label: "Reset Canvas", category: "canvas", keys: { meta: true, shift: true, key: "r" }, editorOnly: true, description: "Unassign all scenes and reset background" },
  { id: "toggle-background", label: "Background Settings", category: "canvas", keys: { meta: true, key: "b" }, editorOnly: true, description: "Open background picker" },

  // ── Slots ──
  { id: "bring-forward", label: "Bring Forward", category: "slots", keys: { meta: true, key: "]" }, editorOnly: true },
  { id: "send-backward", label: "Send Backward", category: "slots", keys: { meta: true, key: "[" }, editorOnly: true },
  { id: "bring-to-front", label: "Bring to Front", category: "slots", keys: { meta: true, shift: true, key: "]" }, editorOnly: true },
  { id: "send-to-back", label: "Send to Back", category: "slots", keys: { meta: true, shift: true, key: "[" }, editorOnly: true },
  { id: "lock-region", label: "Lock / Unlock", category: "slots", keys: { meta: true, key: "l" }, editorOnly: true },
  { id: "lock-all", label: "Lock All Regions", category: "slots", keys: { meta: true, shift: true, key: "l" }, editorOnly: true, description: "Lock every region on the canvas" },
  { id: "unlock-all", label: "Unlock All Regions", category: "slots", keys: { meta: true, shift: true, key: "u" }, editorOnly: true, description: "Unlock every region on the canvas" },

  // ── Alignment & Distribution ──
  { id: "align-left", label: "Align Left", category: "alignment", keys: { meta: true, alt: true, key: "ArrowLeft" }, editorOnly: true, description: "Align selected regions to the left" },
  { id: "align-right", label: "Align Right", category: "alignment", keys: { meta: true, alt: true, key: "ArrowRight" }, editorOnly: true, description: "Align selected regions to the right" },
  { id: "align-top", label: "Align Top", category: "alignment", keys: { meta: true, alt: true, key: "ArrowUp" }, editorOnly: true, description: "Align selected regions to the top" },
  { id: "align-bottom", label: "Align Bottom", category: "alignment", keys: { meta: true, alt: true, key: "ArrowDown" }, editorOnly: true, description: "Align selected regions to the bottom" },
  { id: "align-center-h", label: "Align Center Horizontally", category: "alignment", keys: { meta: true, alt: true, key: "h" }, editorOnly: true, description: "Align centers horizontally" },
  { id: "align-center-v", label: "Align Center Vertically", category: "alignment", keys: { meta: true, alt: true, key: "v" }, editorOnly: true, description: "Align centers vertically" },
  { id: "distribute-h", label: "Distribute Horizontally", category: "alignment", keys: { meta: true, shift: true, alt: true, key: "h" }, editorOnly: true, description: "Evenly distribute horizontally" },
  { id: "distribute-v", label: "Distribute Vertically", category: "alignment", keys: { meta: true, shift: true, alt: true, key: "v" }, editorOnly: true, description: "Evenly distribute vertically" },

  // ── Nudge (arrow keys) ──
  { id: "nudge-left", label: "Move Left", category: "edit", keys: { key: "ArrowLeft" }, editorOnly: true, description: "Nudge selection 1px left" },
  { id: "nudge-right", label: "Move Right", category: "edit", keys: { key: "ArrowRight" }, editorOnly: true, description: "Nudge selection 1px right" },
  { id: "nudge-up", label: "Move Up", category: "edit", keys: { key: "ArrowUp" }, editorOnly: true, description: "Nudge selection 1px up" },
  { id: "nudge-down", label: "Move Down", category: "edit", keys: { key: "ArrowDown" }, editorOnly: true, description: "Nudge selection 1px down" },
  { id: "nudge-left-big", label: "Move Left ×10", category: "edit", keys: { shift: true, key: "ArrowLeft" }, editorOnly: true, description: "Nudge selection 10px left" },
  { id: "nudge-right-big", label: "Move Right ×10", category: "edit", keys: { shift: true, key: "ArrowRight" }, editorOnly: true, description: "Nudge selection 10px right" },
  { id: "nudge-up-big", label: "Move Up ×10", category: "edit", keys: { shift: true, key: "ArrowUp" }, editorOnly: true, description: "Nudge selection 10px up" },
  { id: "nudge-down-big", label: "Move Down ×10", category: "edit", keys: { shift: true, key: "ArrowDown" }, editorOnly: true, description: "Nudge selection 10px down" },

  // ── Navigation ──
  { id: "go-back", label: "Back to Dashboard", category: "navigation", keys: { key: "Escape" }, description: "Return to dashboard (when nothing selected)" },
  { id: "open-settings", label: "Open Settings", category: "navigation", keys: { meta: true, key: "," }, description: "Open application settings" },
  { id: "global-search", label: "Global Search", category: "navigation", keys: { meta: true, key: "k" }, description: "Open global search modal" },

  // ── Bible ──
  { id: "bible-next-verse", label: "Next Verse", category: "bible", keys: { key: "ArrowRight" }, description: "Navigate to the next verse" },
  { id: "bible-prev-verse", label: "Previous Verse", category: "bible", keys: { key: "ArrowLeft" }, description: "Navigate to the previous verse" },
  { id: "bible-next-chapter", label: "Next Chapter", category: "bible", keys: { shift: true, key: "ArrowRight" }, description: "Jump to next chapter" },
  { id: "bible-prev-chapter", label: "Previous Chapter", category: "bible", keys: { shift: true, key: "ArrowLeft" }, description: "Jump to previous chapter" },
  { id: "bible-send-verse", label: "Send Verse to OBS", category: "bible", keys: { key: "Enter" }, description: "Double-click or click and press Enter to send verse to OBS" },
  { id: "bible-switch-theme", label: "Switch Theme (1–9)", category: "bible", keys: { meta: true, key: "1" }, description: "Switch to Nth Bible theme (⌘1–9)" },
  { id: "bible-toggle-fav", label: "Toggle Favourite", category: "bible", keys: { meta: true, key: "d" }, description: "Add/remove current verse from favourites" },
  { id: "bible-blank", label: "Blank / Unblank", category: "bible", keys: { key: "b" }, description: "Blank or unblank the screen" },
  { id: "bible-clear", label: "Clear OBS Output", category: "bible", keys: { key: "Escape" }, description: "Clear current Bible output from OBS" },
  { id: "bible-smart-search", label: "Smart Search", category: "bible", keys: { meta: true, key: "k" }, description: "Open Bible smart search" },

  // ── Worship ──
  { id: "worship-next-slide", label: "Next Slide", category: "worship", keys: { key: "ArrowRight" }, description: "Advance to next lyrics slide" },
  { id: "worship-prev-slide", label: "Previous Slide", category: "worship", keys: { key: "ArrowLeft" }, description: "Go back to previous slide" },
  { id: "worship-blackout", label: "Blackout", category: "worship", keys: { key: "b" }, description: "Toggle blackout on worship display" },
  { id: "worship-clear", label: "Clear Display", category: "worship", keys: { key: "c" }, description: "Clear lyrics from display" },
  { id: "worship-theme-cycle", label: "Switch Theme (1–4)", category: "worship", keys: { key: "1" }, description: "Quick-switch worship theme" },

  // ── Lower Thirds ──
  { id: "lt-send-all", label: "Send All", category: "lowerthirds", keys: { meta: true, key: "Enter" }, description: "Send all lower-third fields to OBS" },
  { id: "lt-clear-all", label: "Clear All", category: "lowerthirds", keys: { key: "Escape" }, description: "Clear all lower-third outputs" },

  // ── Quick Merge ──
  { id: "qm-apply-preview", label: "Apply to Preview", category: "quickmerge", keys: { meta: true, shift: true, key: "p" }, description: "Build composition and load into preview" },
  { id: "qm-take-live", label: "Take Live", category: "quickmerge", keys: { meta: true, key: "Enter" }, description: "Build composition and go live" },

  // ── Ticker ──
  { id: "ticker-start-stop", label: "Start / Stop Ticker", category: "ticker", keys: { meta: true, shift: true, key: "t" }, description: "Toggle ticker on/off" },
  { id: "ticker-add-message", label: "Add Message", category: "ticker", keys: { meta: true, key: "Enter" }, description: "Add current text to ticker queue" },
  { id: "ticker-clear-all", label: "Clear All Messages", category: "ticker", keys: { meta: true, shift: true, key: "Backspace" }, description: "Remove all ticker messages" },
] as const;

// ---------------------------------------------------------------------------
// Fast lookup map
// ---------------------------------------------------------------------------

export const SHORTCUT_MAP: ReadonlyMap<string, ShortcutDef> = new Map(
  SHORTCUTS.map((s) => [s.id, s])
);

// ---------------------------------------------------------------------------
// Grouped by category (for shortcuts reference page)
// ---------------------------------------------------------------------------

export function getShortcutsByCategory(): Map<ShortcutCategory, ShortcutDef[]> {
  const map = new Map<ShortcutCategory, ShortcutDef[]>();
  for (const s of SHORTCUTS) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return map;
}
