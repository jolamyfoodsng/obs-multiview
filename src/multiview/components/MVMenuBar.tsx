/**
 * MVMenuBar.tsx — Application Menu Bar
 *
 * Native-style menu bar with File | Edit | View | Help dropdowns.
 * Each item shows the action label and keyboard shortcut.
 * Works both inside the editor (dispatches to EditorProvider)
 * and on shell pages (navigation actions only).
 */

import { useState, useRef, useEffect } from "react";
import { shortcutLabel, SHORTCUT_MAP } from "../shortcuts";
import Icon from "../../components/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MenuItem {
  label?: string;
  shortcutId?: string;
  icon?: string;
  action?: () => void;
  disabled?: boolean;
  divider?: boolean;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MVMenuBarProps {
  /** Menu groups — caller decides which actions are available */
  menus?: MenuGroup[];
  /** Extra class on root element */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MVMenuBar({ menus, className }: MVMenuBarProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (openIdx === null) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenIdx(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openIdx]);

  // Close on Escape
  useEffect(() => {
    if (openIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openIdx]);

  if (!menus || menus.length === 0) return null;

  return (
    <div className={`mv-menubar ${className ?? ""}`} ref={barRef}>
      {menus.map((menu, idx) => (
        <div key={menu.label} className="mv-menubar-item">
          <button
            className={`mv-menubar-trigger ${openIdx === idx ? "mv-menubar-trigger--active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpenIdx(openIdx === idx ? null : idx);
            }}
            onMouseEnter={() => {
              if (openIdx !== null) setOpenIdx(idx);
            }}
          >
            {menu.label}
          </button>

          {openIdx === idx && (
            <div className="mv-menubar-dropdown">
              {menu.items.map((item, i) =>
                item.divider ? (
                  <div key={`d-${i}`} className="mv-menubar-divider" />
                ) : (
                  <button
                    key={item.label}
                    className={`mv-menubar-action ${item.disabled ? "mv-menubar-action--disabled" : ""}`}
                    disabled={item.disabled}
                    onClick={() => {
                      item.action?.();
                      setOpenIdx(null);
                    }}
                  >
                    <span className="mv-menubar-action-label">
                      {item.icon && (
                        <Icon name={item.icon} size={20} className="mv-menubar-action-icon" />
                      )}
                      {item.label}
                    </span>
                    {item.shortcutId && SHORTCUT_MAP.has(item.shortcutId) && (
                      <span className="mv-menubar-shortcut">
                        {shortcutLabel(SHORTCUT_MAP.get(item.shortcutId)!.keys)}
                      </span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-built menu factory for the editor
// ---------------------------------------------------------------------------

export interface EditorMenuActions {
  save: () => void;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
  deselectAll: () => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleSafeFrame: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  goBack: () => void;
  openShortcuts: () => void;
  exportLayout: () => void;
  importLayout: () => void;
  lockAll: () => void;
  unlockAll: () => void;
  alignLeft: () => void;
  alignRight: () => void;
  alignTop: () => void;
  alignBottom: () => void;
  alignCenterH: () => void;
  alignCenterV: () => void;
  distributeH: () => void;
  distributeV: () => void;
  // state flags
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasMultiSelection: boolean;
  hasClipboard: boolean;
  gridOn: boolean;
  snapOn: boolean;
  safeFrameOn: boolean;
}

export function buildEditorMenus(a: EditorMenuActions): MenuGroup[] {
  return [
    {
      label: "File",
      items: [
        { label: "Save", shortcutId: "save", icon: "save", action: a.save },
        { divider: true },
        { label: "Export Layout…", shortcutId: "export-layout", icon: "file_download", action: a.exportLayout },
        { label: "Import Layout…", shortcutId: "import-layout", icon: "file_upload", action: a.importLayout },
        { divider: true },
        { label: "Back to Dashboard", icon: "arrow_back", action: a.goBack },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcutId: "undo", icon: "undo", action: a.undo, disabled: !a.canUndo },
        { label: "Redo", shortcutId: "redo", icon: "redo", action: a.redo, disabled: !a.canRedo },
        { divider: true },
        { label: "Cut", shortcutId: "cut", icon: "content_cut", action: a.cut, disabled: !a.hasSelection },
        { label: "Copy", shortcutId: "copy", icon: "content_copy", action: a.copy, disabled: !a.hasSelection },
        { label: "Paste", shortcutId: "paste", icon: "content_paste", action: a.paste, disabled: !a.hasClipboard },
        { label: "Duplicate", shortcutId: "duplicate", icon: "content_copy", action: a.duplicate, disabled: !a.hasSelection },
        { divider: true },
        { label: "Delete", shortcutId: "delete", icon: "delete", action: a.deleteSelected, disabled: !a.hasSelection },
        { divider: true },
        { label: "Select All", shortcutId: "select-all", icon: "select_all", action: a.selectAll },
        { label: "Deselect All", shortcutId: "deselect", action: a.deselectAll },
        { divider: true },
        { label: "Lock All Regions", shortcutId: "lock-all", icon: "lock", action: a.lockAll },
        { label: "Unlock All Regions", shortcutId: "unlock-all", icon: "lock_open", action: a.unlockAll },
      ],
    },
    {
      label: "View",
      items: [
        { label: a.gridOn ? "✓ Grid" : "Grid", shortcutId: "toggle-grid", icon: "grid_on", action: a.toggleGrid },
        { label: a.snapOn ? "✓ Snap to Grid" : "Snap to Grid", shortcutId: "toggle-snap", icon: "grid_4x4", action: a.toggleSnap },
        { label: a.safeFrameOn ? "✓ Safe Frame" : "Safe Frame", shortcutId: "toggle-safe-frame", icon: "crop_free", action: a.toggleSafeFrame },
        { divider: true },
        { label: "Zoom In", shortcutId: "zoom-in", icon: "zoom_in", action: a.zoomIn },
        { label: "Zoom Out", shortcutId: "zoom-out", icon: "zoom_out", action: a.zoomOut },
        { label: "Zoom to Fit", shortcutId: "zoom-fit", icon: "fit_screen", action: a.zoomFit },
      ],
    },
    {
      label: "Arrange",
      items: [
        { label: "Align Left", shortcutId: "align-left", icon: "align_horizontal_left", action: a.alignLeft, disabled: !a.hasMultiSelection },
        { label: "Align Right", shortcutId: "align-right", icon: "align_horizontal_right", action: a.alignRight, disabled: !a.hasMultiSelection },
        { label: "Align Top", shortcutId: "align-top", icon: "align_vertical_top", action: a.alignTop, disabled: !a.hasMultiSelection },
        { label: "Align Bottom", shortcutId: "align-bottom", icon: "align_vertical_bottom", action: a.alignBottom, disabled: !a.hasMultiSelection },
        { divider: true },
        { label: "Align Center H", shortcutId: "align-center-h", icon: "align_horizontal_center", action: a.alignCenterH, disabled: !a.hasMultiSelection },
        { label: "Align Center V", shortcutId: "align-center-v", icon: "align_vertical_center", action: a.alignCenterV, disabled: !a.hasMultiSelection },
        { divider: true },
        { label: "Distribute Horizontally", shortcutId: "distribute-h", icon: "horizontal_distribute", action: a.distributeH, disabled: !(a.hasMultiSelection) },
        { label: "Distribute Vertically", shortcutId: "distribute-v", icon: "vertical_distribute", action: a.distributeV, disabled: !(a.hasMultiSelection) },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", icon: "keyboard", action: a.openShortcuts },
      ],
    },
  ];
}
