/**
 * MVEditor.tsx — Multi-View Layout Editor
 *
 * 3-column layout:
 *   Left:   Region library (add regions by type)
 *   Center: Konva canvas (drag, resize, select regions)
 *   Right:  Inspector (edit selected region properties)
 *
 * Wraps content in EditorProvider for state management.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { LayoutId, OBSSceneRegion } from "../types";
import { regionTypeLabel, regionTypeIcon } from "../types";
import * as db from "../mvStore";
import { EditorProvider, useEditor } from "../editorStore";
import { MVCanvas } from "../components/MVCanvas";
import { MVRegionLibrary } from "../components/MVRegionLibrary";
import { MVInspector } from "../components/MVInspector";
import { MVEditorToolbar } from "../components/MVEditorToolbar";
import { MVContextMenu } from "../components/MVContextMenu";
import MVHistoryPanel from "../components/MVHistoryPanel";
import MVAudioPanel from "../components/MVAudioPanel";
import { obsService } from "../../services/obsService";
import { pushLayoutToOBS } from "../mvObsService";
import Icon from "../../components/Icon";

export function MVEditor() {
  const { layoutId } = useParams<{ layoutId: string }>();
  const navigate = useNavigate();
  const [initialLayout, setInitialLayout] = useState<
    Awaited<ReturnType<typeof db.getLayout>> | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (layoutId) {
          const layout = await db.getLayout(layoutId as LayoutId);
          if (!layout) {
            setError("Layout not found.");
            return;
          }
          setInitialLayout(layout);
        }
        // If no layoutId, MVEditorInner will create a fresh layout
      } catch (err) {
        console.error("[MVEditor] Failed to load layout:", err);
        setError("Failed to load layout.");
      } finally {
        setLoading(false);
      }
    })();
  }, [layoutId]);

  if (loading) {
    return (
      <div className="mv-page mv-editor-loading">
        <div className="loading-spinner" />
        <p>Loading editor...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mv-page mv-editor-error">
        <Icon name="error_outline" size={48} style={{ color: "var(--error)" }} />
        <p>{error}</p>
        <button
          className="mv-btn mv-btn--primary"
          onClick={() => navigate("/")}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <EditorProvider>
      <MVEditorInner layout={initialLayout ?? undefined} />
    </EditorProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner component (has access to EditorProvider context)
// ─────────────────────────────────────────────────────────────────────────────

function MVEditorInner({
  layout,
}: {
  layout?: Awaited<ReturnType<typeof db.getLayout>>;
}) {
  const { state, dispatch, save, snapshot, alignRegions, distributeRegions, lockAll, unlockAll, selectNextRegion, selectPrevRegion, renameRegion } = useEditor();
  const navigate = useNavigate();

  // Open the layout in the editor on mount
  useEffect(() => {
    if (layout && !state.layout) {
      dispatch({ type: "OPEN_LAYOUT", layout });
    }
  }, [layout, state.layout, dispatch]);

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; regionId: string | null } | null>(null);

  // ── Rename modal state ──
  const [renameModal, setRenameModal] = useState<{ regionId: string; currentName: string } | null>(null);

  // Listen for rename-region custom events (from keyboard shortcut or context menu)
  useEffect(() => {
    const onRename = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.regionId) {
        const region = state.layout?.regions.find((r) => r.id === detail.regionId);
        if (region) setRenameModal({ regionId: detail.regionId, currentName: region.name });
      }
    };
    window.addEventListener("mv:rename-region", onRename);
    return () => window.removeEventListener("mv:rename-region", onRename);
  }, [state.layout?.regions]);

  // ── Right-click handler for the editor canvas area ──
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Find the region under the cursor from the selection or nearest clicked
    const regionId = state.selectedRegionIds.length === 1 ? state.selectedRegionIds[0] : null;
    setCtxMenu({ x: e.clientX, y: e.clientY, regionId });
  }, [state.selectedRegionIds]);

  // ── Unsaved dot in document.title ──
  useEffect(() => {
    const name = state.layout?.name ?? "Multi-View Editor";
    const isDirty = state.undoStack.length > 0;
    document.title = isDirty ? `• ${name} — OBS Church Studio` : `${name} — OBS Church Studio`;
    return () => { document.title = "OBS Church Studio"; };
  }, [state.layout?.name, state.undoStack.length]);

  // ── Panel sizes & collapse state ──
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);
  const [bottomHeight, setBottomHeight] = useState(180);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [bottomTab, setBottomTab] = useState<"sources" | "history" | "audio">("sources");

  // ── Footer bar state ──
  const [targetSceneName, setTargetSceneName] = useState(state.layout?.name ?? "");
  const [obsScenes, setObsScenes] = useState<string[]>([]);
  const [pushing, setPushing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [obsConnected, setOBSConnected] = useState(obsService.status === "connected");
  // Track if layout is "dirty" (unsaved changes since last save) — push disabled while dirty
  const [layoutSaved, setLayoutSaved] = useState(true);

  // ── Toast notification state ──
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Mark dirty whenever undo stack changes (i.e. user made an edit)
  useEffect(() => {
    if (state.undoStack.length > 0) setLayoutSaved(false);
  }, [state.undoStack.length]);

  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setOBSConnected(s === "connected"));
    return unsub;
  }, []);

  useEffect(() => {
    if (state.layout?.name && !targetSceneName) setTargetSceneName(state.layout.name);
  }, [state.layout?.name]);

  useEffect(() => {
    if (!obsConnected) return;
    obsService.getSceneList().then((scenes) => {
      setObsScenes(scenes.map((s) => s.sceneName));
    }).catch(() => {});
  }, [obsConnected]);

  const handleSaveLayout = async () => {
    setSaving(true);
    try {
      await save();
      setLayoutSaved(true);
      showToast("Layout saved successfully", "success");
    } catch {
      showToast("Failed to save layout", "error");
    } finally { setSaving(false); }
  };

  const handlePushToOBS = async () => {
    if (!state.layout || !targetSceneName) return;
    setPushing(true);
    try {
      await save();
      setLayoutSaved(true);
      await pushLayoutToOBS(state.layout, targetSceneName, true, true);
      showToast(`Pushed to OBS scene "${targetSceneName}"`, "success");
    } catch (err) {
      console.error("[MVEditor] Push failed:", err);
      showToast("Failed to push to OBS", "error");
    } finally {
      setPushing(false);
    }
  };

  // ── Resize handlers ──
  const startResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;
    const onMove = (me: MouseEvent) => {
      const newW = Math.max(160, Math.min(500, startW + (me.clientX - startX)));
      setLeftWidth(newW);
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; };
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [leftWidth]);

  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (me: MouseEvent) => {
      const newW = Math.max(200, Math.min(600, startW - (me.clientX - startX)));
      setRightWidth(newW);
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; };
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightWidth]);

  const startResizeBottom = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomHeight;
    const onMove = (me: MouseEvent) => {
      const newH = Math.max(60, Math.min(400, startH - (me.clientY - startY)));
      setBottomHeight(newH);
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; };
    document.body.style.cursor = "ns-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [bottomHeight]);

  // ── Keyboard shortcuts (registry-based) ──────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept keys when user is focused on an input/textarea/select/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;

      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const key = e.key;

      // ── Delete / Backspace — always prevent default (stops browser back-navigation)
      // NOTE: MVCanvas handles Delete for assigned scenes (capture phase).
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        if (state.selectedRegionIds.length > 0) {
          const regions = state.layout?.regions ?? [];
          const hasAssigned = state.selectedRegionIds.some((id) => {
            const r = regions.find((rg) => rg.id === id);
            return r?.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName;
          });
          if (!hasAssigned) {
            dispatch({ type: "DELETE_REGIONS", regionIds: state.selectedRegionIds });
          }
        }
        return;
      }

      // ── Escape — deselect or navigate back
      if (key === "Escape") {
        if (state.selectedRegionIds.length > 0) {
          dispatch({ type: "DESELECT_ALL" });
        }
        return;
      }

      // ── Undo / Redo (Cmd+Z / Cmd+Shift+Z)
      if (meta && key.toLowerCase() === "z") {
        e.preventDefault();
        if (shift) { dispatch({ type: "REDO" }); }
        else { dispatch({ type: "UNDO" }); }
        return;
      }

      // ── Save (Cmd+S)
      if (meta && key.toLowerCase() === "s" && !shift) {
        e.preventDefault();
        save().then(() => {
          setLayoutSaved(true);
          showToast("Layout saved successfully", "success");
        });
        return;
      }

      // ── Push to OBS (Cmd+Shift+P)
      if (meta && shift && key.toLowerCase() === "p") {
        e.preventDefault();
        handlePushToOBS();
        return;
      }

      // ── Copy (Cmd+C)
      if (meta && key.toLowerCase() === "c" && !shift) {
        e.preventDefault();
        dispatch({ type: "COPY" });
        return;
      }

      // ── Cut (Cmd+X)
      if (meta && key.toLowerCase() === "x" && !shift) {
        e.preventDefault();
        if (state.selectedRegionIds.length > 0) {
          dispatch({ type: "COPY" });
          dispatch({ type: "DELETE_REGIONS", regionIds: state.selectedRegionIds });
        }
        return;
      }

      // ── Paste (Cmd+V)
      if (meta && key.toLowerCase() === "v" && !shift) {
        e.preventDefault();
        dispatch({ type: "SNAPSHOT" });
        dispatch({ type: "PASTE" });
        return;
      }

      // ── Select All (Cmd+A)
      if (meta && key.toLowerCase() === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL" });
        return;
      }

      // ── Duplicate (Cmd+D)
      if (meta && key.toLowerCase() === "d" && state.selectedRegionIds.length > 0) {
        e.preventDefault();
        dispatch({ type: "SNAPSHOT" });
        dispatch({ type: "DUPLICATE_REGIONS", regionIds: state.selectedRegionIds });
        return;
      }

      // ── Toggle Grid (Cmd+G)
      if (meta && key.toLowerCase() === "g" && !shift) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_GRID" });
        return;
      }

      // ── Toggle Snap (Cmd+Shift+S)
      if (meta && key.toLowerCase() === "s" && shift) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_SNAP" });
        return;
      }

      // ── Toggle Safe Frame (Cmd+')
      if (meta && key === "'") {
        e.preventDefault();
        dispatch({ type: "TOGGLE_SAFE_FRAME" });
        return;
      }

      // ── Reset Canvas (Cmd+Shift+R)
      if (meta && shift && key.toLowerCase() === "r") {
        e.preventDefault();
        // Dispatch a custom event that the toolbar picks up to show its confirmation modal
        window.dispatchEvent(new CustomEvent("mv:open-reset-modal"));
        return;
      }

      // ── Toggle Background Picker (Cmd+B)
      if (meta && key.toLowerCase() === "b" && !shift) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_BACKGROUND_PICKER" });
        return;
      }

      // ── Zoom In (Cmd+=)
      if (meta && (key === "=" || key === "+") && !shift) {
        e.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: Math.min(state.zoom + 0.1, 3) });
        return;
      }

      // ── Zoom Out (Cmd+-)
      if (meta && key === "-" && !shift) {
        e.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: Math.max(state.zoom - 0.1, 0.2) });
        return;
      }

      // ── Zoom to Fit (Cmd+0)
      if (meta && key === "0") {
        e.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: 1 });
        return;
      }

      // ── Lock / Unlock (Cmd+L)
      if (meta && key.toLowerCase() === "l" && !shift && state.selectedRegionIds.length > 0) {
        e.preventDefault();
        for (const id of state.selectedRegionIds) {
          dispatch({ type: "TOGGLE_LOCK", regionId: id });
        }
        return;
      }

      // ── Slot ordering (Cmd+] / Cmd+[ / Cmd+Shift+] / Cmd+Shift+[)
      if (meta && state.selectedRegionIds.length === 1) {
        const rid = state.selectedRegionIds[0];
        if (key === "]" && !shift) { e.preventDefault(); dispatch({ type: "SNAPSHOT" }); dispatch({ type: "REORDER_REGION", regionId: rid, direction: "up" }); return; }
        if (key === "[" && !shift) { e.preventDefault(); dispatch({ type: "SNAPSHOT" }); dispatch({ type: "REORDER_REGION", regionId: rid, direction: "down" }); return; }
        if (key === "]" && shift) { e.preventDefault(); dispatch({ type: "SNAPSHOT" }); dispatch({ type: "REORDER_REGION", regionId: rid, direction: "top" }); return; }
        if (key === "[" && shift) { e.preventDefault(); dispatch({ type: "SNAPSHOT" }); dispatch({ type: "REORDER_REGION", regionId: rid, direction: "bottom" }); return; }
      }

      // ── Arrow key nudging (with bounds clamping)
      if (key.startsWith("Arrow") && state.selectedRegionIds.length > 0 && !meta && !e.altKey) {
        e.preventDefault();
        const amount = shift ? 10 : 1;
        const dx = key === "ArrowLeft" ? -amount : key === "ArrowRight" ? amount : 0;
        const dy = key === "ArrowUp" ? -amount : key === "ArrowDown" ? amount : 0;
        if (dx !== 0 || dy !== 0) {
          snapshot();
          const sf = state.layout?.safeFrame;
          const canvas = state.layout?.canvas ?? { width: 1920, height: 1080 };
          const bL = sf?.enabled ? sf.left : 0;
          const bT = sf?.enabled ? sf.top : 0;
          const bR = sf?.enabled ? canvas.width - sf.right : canvas.width;
          const bB = sf?.enabled ? canvas.height - sf.bottom : canvas.height;
          for (const id of state.selectedRegionIds) {
            const region = state.layout?.regions.find((r) => r.id === id);
            if (region && !region.locked) {
              let nx = region.x + dx;
              let ny = region.y + dy;
              // Clamp to bounds
              nx = Math.max(bL, Math.min(bR - region.width, nx));
              ny = Math.max(bT, Math.min(bB - region.height, ny));
              dispatch({ type: "UPDATE_REGION", regionId: id, changes: { x: nx, y: ny } });
            }
          }
        }
        return;
      }

      // ── Alignment shortcuts (Cmd+Alt+Arrow)
      if (meta && e.altKey && !shift && key.startsWith("Arrow") && state.selectedRegionIds.length >= 2) {
        e.preventDefault();
        const axisMap: Record<string, "left" | "right" | "top" | "bottom"> = {
          ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom",
        };
        const axis = axisMap[key];
        if (axis) alignRegions(axis);
        return;
      }

      // ── Align center H (Cmd+Alt+H)
      if (meta && e.altKey && !shift && key.toLowerCase() === "h" && state.selectedRegionIds.length >= 2) {
        e.preventDefault();
        alignRegions("center-h");
        return;
      }

      // ── Align center V (Cmd+Alt+V)
      if (meta && e.altKey && !shift && key.toLowerCase() === "v" && state.selectedRegionIds.length >= 2) {
        e.preventDefault();
        alignRegions("center-v");
        return;
      }

      // ── Distribute H (Cmd+Shift+Alt+H)
      if (meta && e.altKey && shift && key.toLowerCase() === "h" && state.selectedRegionIds.length >= 3) {
        e.preventDefault();
        distributeRegions("horizontal");
        return;
      }

      // ── Distribute V (Cmd+Shift+Alt+V)
      if (meta && e.altKey && shift && key.toLowerCase() === "v" && state.selectedRegionIds.length >= 3) {
        e.preventDefault();
        distributeRegions("vertical");
        return;
      }

      // ── Tab / Shift+Tab — cycle region selection
      if (key === "Tab" && !meta && !e.altKey) {
        e.preventDefault();
        if (shift) { selectPrevRegion(); } else { selectNextRegion(); }
        return;
      }

      // ── Lock All (Cmd+Shift+L)
      if (meta && shift && key.toLowerCase() === "l") {
        e.preventDefault();
        lockAll();
        return;
      }

      // ── Unlock All (Cmd+Shift+U)
      if (meta && shift && key.toLowerCase() === "u") {
        e.preventDefault();
        unlockAll();
        return;
      }

      // ── F2 — Rename region
      if (key === "F2" && state.selectedRegionIds.length === 1) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("mv:rename-region", { detail: { regionId: state.selectedRegionIds[0] } }));
        return;
      }

      // ── New Layout (Cmd+N)
      if (meta && key.toLowerCase() === "n" && !shift) {
        e.preventDefault();
        navigate("/new");
        return;
      }

      // ── Close Editor (Cmd+W)
      if (meta && key.toLowerCase() === "w" && !shift) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("mv:close-editor"));
        return;
      }

      // ── Export Layout (Cmd+E)
      if (meta && key.toLowerCase() === "e" && !shift) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("mv:export-layout"));
        return;
      }

      // ── Import Layout (Cmd+I)
      if (meta && key.toLowerCase() === "i" && !shift) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("mv:import-layout"));
        return;
      }

      // ── Open Settings (Cmd+,)
      if (meta && key === ",") {
        e.preventDefault();
        navigate("/settings");
        return;
      }
    },
    [dispatch, state.selectedRegionIds, state.layout, state.zoom, save, snapshot, alignRegions, distributeRegions, lockAll, unlockAll, selectNextRegion, selectPrevRegion, navigate, handlePushToOBS, showToast]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!state.layout) {
    return (
      <div className="mv-page mv-editor-loading">
        <div className="loading-spinner" />
        <p>Initializing editor...</p>
      </div>
    );
  }

  return (
    <div className="mv-editor" onContextMenu={handleContextMenu}>
      {/* Toolbar (top bar) */}
      <MVEditorToolbar />

      <div className="mv-editor-body">
        {/* Left: Region Library (resizable) */}
        {!leftCollapsed ? (
          <>
            <div className="mv-region-library" style={{ width: leftWidth, minWidth: leftWidth }}>
              <MVRegionLibrary />
              <button className="mv-panel-collapse-btn mv-panel-collapse-btn--left" title="Collapse panel"
                onClick={() => setLeftCollapsed(true)}>
                <Icon name="chevron_left" size={20} />
              </button>
            </div>
            <div className="mv-resize-handle mv-resize-handle--v" onMouseDown={startResizeLeft} />
          </>
        ) : (
          <div className="mv-panel-collapsed mv-panel-collapsed--left">
            <button className="mv-panel-expand-btn" title="Expand panel" onClick={() => setLeftCollapsed(false)}>
              <Icon name="chevron_right" size={20} />
            </button>
          </div>
        )}

        {/* Center: Canvas + Active Sources */}
        <div className="mv-editor-center">
          <div className="mv-editor-canvas-wrap">
            <MVCanvas />
          </div>
          {!bottomCollapsed ? (
            <>
              <div className="mv-resize-handle mv-resize-handle--h" onMouseDown={startResizeBottom} />
              <div style={{ height: bottomHeight, flexShrink: 0, position: "relative", display: "flex", flexDirection: "column" }}>
                {/* Bottom panel tabs */}
                <div className="mv-bottom-tabs" role="tablist" aria-label="Bottom panels">
                  <button role="tab" aria-selected={bottomTab === "sources"}
                    className={`mv-bottom-tab${bottomTab === "sources" ? " mv-bottom-tab--active" : ""}`}
                    onClick={() => setBottomTab("sources")}>
                    <Icon name="playlist_play" size={16} /> Sources
                  </button>
                  <button role="tab" aria-selected={bottomTab === "history"}
                    className={`mv-bottom-tab${bottomTab === "history" ? " mv-bottom-tab--active" : ""}`}
                    onClick={() => setBottomTab("history")}>
                    <Icon name="history" size={16} /> History
                  </button>
                  <button role="tab" aria-selected={bottomTab === "audio"}
                    className={`mv-bottom-tab${bottomTab === "audio" ? " mv-bottom-tab--active" : ""}`}
                    onClick={() => setBottomTab("audio")}>
                    <Icon name="equalizer" size={16} /> Audio
                  </button>
                  <span style={{ flex: 1 }} />
                  <button className="mv-panel-collapse-btn mv-panel-collapse-btn--bottom" title="Collapse panel"
                    onClick={() => setBottomCollapsed(true)}>
                    <Icon name="expand_more" size={20} />
                  </button>
                </div>
                {/* Tab content */}
                <div style={{ flex: 1, overflow: "hidden" }}>
                  {bottomTab === "sources" && <ActiveSourcesPanel />}
                  {bottomTab === "history" && <MVHistoryPanel />}
                  {bottomTab === "audio" && <MVAudioPanel />}
                </div>
              </div>
            </>
          ) : (
            <div className="mv-panel-collapsed mv-panel-collapsed--bottom">
              <button className="mv-panel-expand-btn" title="Expand panel" onClick={() => setBottomCollapsed(false)}>
                <Icon name="expand_less" size={20} />
              </button>
              <span className="mv-panel-collapsed-label">
                {bottomTab === "sources" ? "Active Sources" : bottomTab === "history" ? "History" : "Audio"}
              </span>
            </div>
          )}

          {/* ── Canvas Footer Bar ── */}
          <div className="mv-canvas-footer">
            <div className="mv-canvas-footer-left">
              <Icon name="tv" size={16} style={{ opacity: 0.5 }} />
              <label className="mv-canvas-footer-label">Target OBS Scene</label>
              <input
                className="mv-canvas-footer-input"
                type="text"
                list="obs-scene-list"
                value={targetSceneName}
                onChange={(e) => setTargetSceneName(e.target.value)}
                placeholder="Scene name…"
              />
              <datalist id="obs-scene-list">
                {obsScenes.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="mv-canvas-footer-right">
              <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={handleSaveLayout} disabled={saving || !state.layout}>
                <Icon name={saving ? "hourglass_empty" : "save"} size={16} />
                {saving ? "Saving…" : "Save Layout"}
              </button>
              <button className="mv-btn mv-btn--primary mv-btn--sm" onClick={handlePushToOBS}
                disabled={pushing || !state.layout || !targetSceneName || !obsConnected || !layoutSaved}
                title={!layoutSaved ? "Save layout first before pushing to OBS" : "Push to OBS (⌘⇧P)"}>
                <Icon name={pushing ? "hourglass_empty" : "publish"} size={16} />
                {pushing ? "Pushing…" : "Push to OBS"}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Preview + Inspector (resizable) */}
        {!rightCollapsed ? (
          <>
            <div className="mv-resize-handle mv-resize-handle--v" onMouseDown={startResizeRight} />
            <div className="mv-editor-right" style={{ width: rightWidth, minWidth: rightWidth }}>
              <button className="mv-panel-collapse-btn mv-panel-collapse-btn--right" title="Collapse panel"
                onClick={() => setRightCollapsed(true)}>
                <Icon name="chevron_right" size={20} />
              </button>
              <MVPreviewPanel />
              <MVInspector />
            </div>
          </>
        ) : (
          <div className="mv-panel-collapsed mv-panel-collapsed--right">
            <button className="mv-panel-expand-btn" title="Expand panel" onClick={() => setRightCollapsed(false)}>
              <Icon name="chevron_left" size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`mv-toast mv-toast--${toast.type}`} onClick={() => setToast(null)}>
          <Icon name={toast.type === "success" ? "check_circle" : toast.type === "error" ? "error" : "info"} size={18} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <MVContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          regionId={(ctxMenu.regionId ?? null) as any}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Rename modal */}
      {renameModal && (
        <div className="mv-modal-backdrop" onClick={() => setRenameModal(null)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="mv-modal-title">Rename Region</h3>
            <input
              className="mv-input"
              type="text"
              defaultValue={renameModal.currentName}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) {
                    renameRegion(renameModal.regionId as any, val);
                  }
                  setRenameModal(null);
                }
                if (e.key === "Escape") setRenameModal(null);
              }}
            />
            <div className="mv-modal-actions" style={{ marginTop: 12 }}>
              <button className="mv-btn mv-btn--ghost" onClick={() => setRenameModal(null)}>Cancel</button>
              <button className="mv-btn mv-btn--primary" onClick={() => {
                const input = document.querySelector<HTMLInputElement>(".mv-modal .mv-input");
                const val = input?.value.trim();
                if (val) renameRegion(renameModal.regionId as any, val);
                setRenameModal(null);
              }}>Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview Panel — live OBS screenshot of the Multi-View scene
// ─────────────────────────────────────────────────────────────────────────────

function MVPreviewPanel() {
  const { state } = useEditor();
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [obsConnected, setOBSConnected] = useState(obsService.status === "connected");

  const sceneName = state.layout?.name ?? "";

  // Subscribe to OBS connection status reactively
  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setOBSConnected(s === "connected"));
    return unsub;
  }, []);

  useEffect(() => {
    if (!sceneName || !obsConnected) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const dataUrl = await obsService.getSourceScreenshot(sceneName, 640);
        if (dataUrl && !cancelled) setImgSrc(dataUrl);
      } catch { /* OBS not ready or scene doesn't exist yet */ }
    };
    poll();
    const iv = setInterval(poll, 800);
    return () => { cancelled = true; clearInterval(iv); };
  }, [sceneName, obsConnected]);

  return (
    <div className="mv-preview-panel">
      <div className="mv-preview-header">
        <Icon name="monitor" size={16} />
        <span>Live Preview</span>
        {sceneName && <span className="mv-panel-badge">{sceneName}</span>}
      </div>
      <div className="mv-preview-viewport">
        {imgSrc ? (
          <img ref={imgRef} src={imgSrc} alt="MV Preview" className="mv-preview-img" />
        ) : (
          <div className="mv-preview-placeholder">
            <Icon name="videocam_off" size={32} style={{ opacity: 0.3 }} />
            <span>Connect to OBS to see live preview</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Active Sources Panel — shows all assigned OBS scenes below the canvas
// ─────────────────────────────────────────────────────────────────────────────

function ActiveSourcesPanel() {
  const { state, dispatch, updateRegion } = useEditor();
  const regions = state.layout?.regions ?? [];

  // Only show regions that have a real source assigned (including Bible/Worship themed slots)
  const activeSources = regions.filter((r) => {
    // Bible/Worship themed slots count as active
    const isThemed = (r.name?.startsWith("Bible:") || r.name?.startsWith("Worship:")) && !!r.themeSettings;
    if (isThemed) return true;
    if (r.type === "obs-scene") {
      return !!(r as OBSSceneRegion).sceneName;
    }
    if (r.type === "color") return true;
    if (r.type === "image-overlay" || r.type === "media" || r.type === "browser") {
      return !!(r as any).src || !!(r as any).url;
    }
    return false;
  });

  if (activeSources.length === 0) {
    return (
      <div className="mv-active-sources mv-active-sources--empty">
        <Icon name="info" size={16} style={{ opacity: 0.3 }} />
        <span>No active sources. Drag OBS scenes onto the canvas frames above.</span>
      </div>
    );
  }

  return (
    <div className="mv-active-sources">
      <div className="mv-active-sources-header">
        <Icon name="playlist_play" size={16} />
        <span>Active Sources</span>
        <span className="mv-panel-badge">{activeSources.length}</span>
      </div>
      <div className="mv-active-sources-list">
        {activeSources.map((region) => {
          const isSelected = state.selectedRegionIds.includes(region.id);
          const sceneInfo = region.type === "obs-scene" ? (region as OBSSceneRegion).sceneName : null;
          const isBible = region.name?.startsWith("Bible:");
          const isWorship = region.name?.startsWith("Worship:");
          const sourceIcon = isBible ? "menu_book" : isWorship ? "music_note" : regionTypeIcon(region.type);

          return (
            <div
              key={region.id}
              className={`mv-active-source-item ${isSelected ? "mv-active-source-item--selected" : ""}`}
              onClick={() => dispatch({ type: "SELECT_REGION", regionId: region.id, additive: false })}
            >
              <Icon name={sourceIcon} size={18} className="mv-active-source-icon" />
              <div className="mv-active-source-info">
                <span className="mv-active-source-name">
                  {region.name || sceneInfo || regionTypeLabel(region.type)}
                </span>
                <span className="mv-active-source-meta">
                  {region.slotLabel && <span className="mv-active-source-slot">{region.slotLabel}</span>}
                  <span>{region.width}×{region.height}</span>
                  <span>({region.x}, {region.y})</span>
                  <span>z:{region.zIndex}</span>
                  {region.opacity < 1 && <span>{Math.round(region.opacity * 100)}%</span>}
                  {region.locked && <span><Icon name="lock" size={14} style={{ verticalAlign: "middle" }} /></span>}
                </span>
              </div>
              {/* Inline opacity slider */}
              <div className="mv-active-source-opacity" title={`Opacity: ${Math.round(region.opacity * 100)}%`}>
                <input type="range" min={0} max={1} step={0.05} value={region.opacity}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); updateRegion(region.id, { opacity: parseFloat(e.target.value) }); }}
                  style={{ width: 50, height: 14, accentColor: "var(--primary, #6c5ce7)" }}
                />
              </div>
              <div className="mv-active-source-actions">
                <button
                  className="mv-slot-action"
                  title="Move Up (Z-Order)"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "SNAPSHOT" }); dispatch({ type: "REORDER_REGION", regionId: region.id, direction: "up" }); }}
                >
                  <Icon name="arrow_upward" size={14} />
                </button>
                <button
                  className="mv-slot-action"
                  title="Move Down (Z-Order)"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "SNAPSHOT" }); dispatch({ type: "REORDER_REGION", regionId: region.id, direction: "down" }); }}
                >
                  <Icon name="arrow_downward" size={14} />
                </button>
                <button
                  className="mv-slot-action"
                  title={region.visible ? "Hide" : "Show"}
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_VISIBILITY", regionId: region.id }); }}
                >
                  <Icon name={region.visible ? "visibility" : "visibility_off"} size={20} />
                </button>
                <button
                  className="mv-slot-action"
                  title={region.locked ? "Unlock" : "Lock"}
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_LOCK", regionId: region.id }); }}
                >
                  <Icon name={region.locked ? "lock" : "lock_open"} size={20} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
