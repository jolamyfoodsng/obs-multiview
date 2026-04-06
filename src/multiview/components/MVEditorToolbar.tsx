/**
 * MVEditorToolbar.tsx — Top toolbar for the layout editor
 *
 * Layout name, zoom controls, undo/redo, grid/snap toggles, save, Apply to OBS.
 * v2: Reset Canvas button + delete-with-confirmation for assigned scenes.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useEditor } from "../editorStore";
import { pushLayoutToOBS, isOBSReady, goLive, ensureTransition } from "../mvObsService";
import type { OBSSceneRegion, MVTransitionConfig } from "../types";
import { DEFAULT_TRANSITION_CONFIG, MV_TRANSITION_OPTIONS } from "../types";
import { MVMenuBar, buildEditorMenus } from "./MVMenuBar";
import { tooltipWithShortcut } from "../shortcuts";
import { downloadLayoutJSON, promptImportLayout } from "../mvStore";

export function MVEditorToolbar() {
  const navigate = useNavigate();
  const { state, dispatch, save, undo, redo, deleteSelected, duplicateSelected, unassignSceneFromRegion, resetCanvas, alignRegions, distributeRegions, lockAll, unlockAll } = useEditor();
  const layout = state.layout;

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(layout?.name ?? "Untitled Layout");
  const nameRef = useRef<HTMLInputElement>(null);

  // OBS sync state
  const [syncing, setSyncing] = useState(false);
  const obsReady = isOBSReady();

  // ── Delete confirmation modal ──
  const [deleteModal, setDeleteModal] = useState<{ regionId: string; sceneName: string } | null>(null);

  // ── Reset confirmation modal ──
  const [showResetModal, setShowResetModal] = useState(false);

  const lastSavedRef = useRef<string>(layout?.updatedAt ?? "");

  // Track last saved timestamp
  const markSaved = useCallback(() => {
    lastSavedRef.current = new Date().toISOString();
  }, []);

  const isDirty = useCallback(() => {
    if (!layout) return false;
    return layout.updatedAt > lastSavedRef.current;
  }, [layout]);

  // Update ref when layout is first opened
  useEffect(() => {
    if (layout?.updatedAt && !lastSavedRef.current) {
      lastSavedRef.current = layout.updatedAt;
    }
  }, [layout?.updatedAt]);

  // ── Undo confirmation modal ──
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);

  // ── Live scene confirmation modal (Apply to OBS) ──
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  // ── Transition controls ──
  const transitionConfig: MVTransitionConfig = layout?.transition ?? DEFAULT_TRANSITION_CONFIG;
  const [showTransitionPicker, setShowTransitionPicker] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [liveResult, setLiveResult] = useState<{ success: boolean; error?: string } | null>(null);
  const transitionPickerRef = useRef<HTMLDivElement>(null);

  // Close transition picker when clicking outside
  useEffect(() => {
    if (!showTransitionPicker) return;
    const onClick = (e: MouseEvent) => {
      if (transitionPickerRef.current && !transitionPickerRef.current.contains(e.target as Node)) {
        setShowTransitionPicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showTransitionPicker]);

  // Update transition config on the layout
  const setTransitionConfig = useCallback((changes: Partial<MVTransitionConfig>) => {
    if (!layout) return;
    const newConfig: MVTransitionConfig = { ...transitionConfig, ...changes };
    dispatch({ type: "UPDATE_LAYOUT", changes: { transition: newConfig, updatedAt: new Date().toISOString() } });
    // Also configure OBS immediately if connected
    if (obsReady) {
      ensureTransition(newConfig).catch(() => {});
    }
  }, [layout, transitionConfig, dispatch, obsReady]);

  // ── Go Live confirmation modal ──
  const [showGoLiveConfirm, setShowGoLiveConfirm] = useState(false);

  // ── Go Live handler (only called after confirmation) ──
  const doGoLive = useCallback(async () => {
    if (goingLive || !obsReady) return;
    setShowGoLiveConfirm(false);
    setGoingLive(true);
    setLiveResult(null);
    try {
      const result = await goLive(transitionConfig);
      setLiveResult(result);
      if (result.success) {
        setTimeout(() => setLiveResult(null), 3000);
      }
    } catch (err) {
      setLiveResult({ success: false, error: err instanceof Error ? err.message : "Failed to go live" });
    } finally {
      setGoingLive(false);
    }
  }, [goingLive, obsReady, transitionConfig]);

  /** Show confirmation modal before going live */
  const handleGoLive = useCallback(() => {
    if (goingLive || !obsReady) return;
    setShowGoLiveConfirm(true);
  }, [goingLive, obsReady]);

  // ── Keyboard Shortcuts modal ──
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // ── Listen for Cmd+Shift+R keyboard shortcut (dispatched by MVEditor) ──
  useEffect(() => {
    const onOpenReset = () => setShowResetModal(true);
    window.addEventListener("mv:open-reset-modal", onOpenReset);
    return () => window.removeEventListener("mv:open-reset-modal", onOpenReset);
  }, []);

  useEffect(() => {
    if (editingName && nameRef.current) nameRef.current.focus();
  }, [editingName]);

  const commitName = () => {
    setEditingName(false);
    if (layout && nameValue.trim()) {
      dispatch({
        type: "UPDATE_LAYOUT",
        changes: { name: nameValue.trim(), updatedAt: new Date().toISOString() },
      });
      save();
    }
  };

  const zoomIn = () => dispatch({ type: "SET_ZOOM", zoom: Math.min(state.zoom + 0.1, 3) });
  const zoomOut = () => dispatch({ type: "SET_ZOOM", zoom: Math.max(state.zoom - 0.1, 0.2) });
  const zoomFit = () => dispatch({ type: "SET_ZOOM", zoom: 1 });

  const canUndo = state.undoStack.length > 0;
  const canRedo = state.redoStack.length > 0;
  const hasSelection = state.selectedRegionIds.length > 0;
  const hasAssignedScenes = (layout?.regions ?? []).some(
    (r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName
  );

  // Check if selected region is an assigned OBS scene (needs confirmation)
  const getSelectedAssignedScene = useCallback((): { regionId: string; sceneName: string } | null => {
    if (state.selectedRegionIds.length !== 1) return null;
    const regions = layout?.regions ?? [];
    const r = regions.find((rg) => rg.id === state.selectedRegionIds[0]);
    if (!r) return null;
    if (r.type === "obs-scene" && (r as OBSSceneRegion).sceneName) {
      return { regionId: r.id, sceneName: (r as OBSSceneRegion).sceneName };
    }
    return null;
  }, [state.selectedRegionIds, layout?.regions]);

  // ── Handle delete with confirmation for assigned scenes ──
  const handleDelete = useCallback(() => {
    const assigned = getSelectedAssignedScene();
    if (assigned) {
      setDeleteModal(assigned);
    } else {
      deleteSelected();
    }
  }, [getSelectedAssignedScene, deleteSelected]);

  // ── Apply to OBS (used by live confirm modal) ──
  const doApplyToOBS = useCallback(async () => {
    if (!layout || syncing) return;
    setSyncing(true);
    try {
      await save();
      await pushLayoutToOBS(layout);
    } catch (err) {
      console.error("[MVToolbar] Apply failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [layout, syncing, save]);

  // ── Export/Import handlers ──
  const handleExportLayout = useCallback(() => {
    if (!layout) return;
    downloadLayoutJSON(layout);
  }, [layout]);

  const handleImportLayout = useCallback(async () => {
    try {
      const imported = await promptImportLayout();
      navigate(`/edit/${imported.id}`);
    } catch (err) {
      console.warn("[MVToolbar] Import cancelled or failed:", err);
    }
  }, [navigate]);

  // ── Listen for custom events from keyboard shortcuts ──
  useEffect(() => {
    const onExport = () => handleExportLayout();
    const onImport = () => { handleImportLayout(); };
    const onClose = () => {
      navigate("/");
    };
    window.addEventListener("mv:export-layout", onExport);
    window.addEventListener("mv:import-layout", onImport);
    window.addEventListener("mv:close-editor", onClose);
    return () => {
      window.removeEventListener("mv:export-layout", onExport);
      window.removeEventListener("mv:import-layout", onImport);
      window.removeEventListener("mv:close-editor", onClose);
    };
  }, [handleExportLayout, handleImportLayout, isDirty, navigate]);

  // ── Build menu bar ──
  const hasMultiSelection = state.selectedRegionIds.length >= 2;

  const editorMenus = buildEditorMenus({
    save: async () => { await save(); markSaved(); },
    undo,
    redo,
    cut: () => {
      if (hasSelection) {
        dispatch({ type: "COPY" });
        dispatch({ type: "DELETE_REGIONS", regionIds: state.selectedRegionIds });
      }
    },
    copy: () => dispatch({ type: "COPY" }),
    paste: () => { dispatch({ type: "SNAPSHOT" }); dispatch({ type: "PASTE" }); },
    duplicate: duplicateSelected,
    deleteSelected: handleDelete,
    selectAll: () => dispatch({ type: "SELECT_ALL" }),
    deselectAll: () => dispatch({ type: "DESELECT_ALL" }),
    toggleGrid: () => dispatch({ type: "TOGGLE_GRID" }),
    toggleSnap: () => dispatch({ type: "TOGGLE_SNAP" }),
    toggleSafeFrame: () => dispatch({ type: "TOGGLE_SAFE_FRAME" }),
    zoomIn,
    zoomOut,
    zoomFit,
    goBack: () => {
      navigate("/");
    },
    openShortcuts: () => setShowShortcutsModal(true),
    exportLayout: handleExportLayout,
    importLayout: handleImportLayout,
    lockAll,
    unlockAll,
    alignLeft: () => alignRegions("left"),
    alignRight: () => alignRegions("right"),
    alignTop: () => alignRegions("top"),
    alignBottom: () => alignRegions("bottom"),
    alignCenterH: () => alignRegions("center-h"),
    alignCenterV: () => alignRegions("center-v"),
    distributeH: () => distributeRegions("horizontal"),
    distributeV: () => distributeRegions("vertical"),
    canUndo,
    canRedo,
    hasSelection,
    hasMultiSelection,
    hasClipboard: state.clipboard.length > 0,
    gridOn: state.showGrid,
    snapOn: state.snapEnabled,
    safeFrameOn: state.showSafeFrame,
  });

  return (
    <div className="mv-editor-toolbar" role="toolbar" aria-label="Editor toolbar">
      {/* Menu Bar */}
      <MVMenuBar menus={editorMenus} className="mv-toolbar-menubar" />

      {/* Left: Name */}
      <div className="mv-toolbar-left">
        {editingName ? (
          <input
            ref={nameRef}
            className="mv-toolbar-name-input"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <button
            className="mv-toolbar-name"
            onClick={() => { setNameValue(layout?.name ?? ""); setEditingName(true); }}
            title="Click to rename"
          >
            {layout?.name ?? "Untitled Layout"}
            <Icon name="edit" size={14} style={{ marginLeft: 4, opacity: 0.5 }} />
          </button>
        )}

        <span className="mv-toolbar-sep" />
        <span className="mv-toolbar-meta">
          {layout?.canvas.label} · {layout?.regions.length ?? 0} regions
        </span>
      </div>

      {/* Center: Tools */}
      <div className="mv-toolbar-center">
        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Undo", "undo")} disabled={!canUndo} onClick={() => {
          // Show confirmation if there are assigned scenes (undo might remove a scene drag)
          const hasAssigned = (layout?.regions ?? []).some(
            (r) => r.type === "obs-scene" && !!(r as OBSSceneRegion).sceneName
          );
          if (hasAssigned && canUndo) {
            setShowUndoConfirm(true);
          } else {
            undo();
          }
        }}>
          <Icon name="undo" size={20} />
        </button>
        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Redo", "redo")} disabled={!canRedo} onClick={redo}>
          <Icon name="redo" size={20} />
        </button>

        <span className="mv-toolbar-sep" />

        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Duplicate", "duplicate")} disabled={!hasSelection} onClick={duplicateSelected}>
          <Icon name="content_copy" size={20} />
        </button>
        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Delete", "delete")} disabled={!hasSelection} onClick={handleDelete}>
          <Icon name="delete" size={20} />
        </button>

        <span className="mv-toolbar-sep" />

        <button className={`mv-toolbar-btn ${state.showGrid ? "mv-toolbar-btn--active" : ""}`}
          title={tooltipWithShortcut("Toggle Grid", "toggle-grid")} onClick={() => dispatch({ type: "TOGGLE_GRID" })}>
          <Icon name="grid_on" size={20} />
        </button>
        <button className={`mv-toolbar-btn ${state.snapEnabled ? "mv-toolbar-btn--active" : ""}`}
          title={tooltipWithShortcut("Toggle Snap", "toggle-snap")} onClick={() => dispatch({ type: "TOGGLE_SNAP" })}>
          <Icon name="grid_4x4" size={20} />
        </button>
        <button className={`mv-toolbar-btn ${state.showSafeFrame ? "mv-toolbar-btn--active" : ""}`}
          title={tooltipWithShortcut("Toggle Safe Frame", "toggle-safe-frame")} onClick={() => dispatch({ type: "TOGGLE_SAFE_FRAME" })}>
          <Icon name="crop_free" size={20} />
        </button>
        <button className={`mv-toolbar-btn ${state.showBackgroundPicker ? "mv-toolbar-btn--active" : ""}`}
          title={tooltipWithShortcut("Background Settings", "toggle-background")} onClick={() => dispatch({ type: "TOGGLE_BACKGROUND_PICKER" })}>
          <Icon name="wallpaper" size={20} />
        </button>

        <span className="mv-toolbar-sep" />

        {/* Reset Canvas */}
        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Reset Canvas", "reset-canvas")} onClick={() => setShowResetModal(true)}>
          <Icon name="restart_alt" size={20} />
        </button>

        <span className="mv-toolbar-sep" />

        {/* Alignment tools (visible when 2+ selected) */}
        {state.selectedRegionIds.length >= 2 && (
          <>
            <button className="mv-toolbar-btn" title={tooltipWithShortcut("Align Left", "align-left")} onClick={() => alignRegions("left")}>
              <Icon name="align_horizontal_left" size={20} />
            </button>
            <button className="mv-toolbar-btn" title={tooltipWithShortcut("Align Center H", "align-center-h")} onClick={() => alignRegions("center-h")}>
              <Icon name="align_horizontal_center" size={20} />
            </button>
            <button className="mv-toolbar-btn" title={tooltipWithShortcut("Align Right", "align-right")} onClick={() => alignRegions("right")}>
              <Icon name="align_horizontal_right" size={20} />
            </button>
            <button className="mv-toolbar-btn" title={tooltipWithShortcut("Align Top", "align-top")} onClick={() => alignRegions("top")}>
              <Icon name="align_vertical_top" size={20} />
            </button>
            <button className="mv-toolbar-btn" title={tooltipWithShortcut("Align Center V", "align-center-v")} onClick={() => alignRegions("center-v")}>
              <Icon name="align_vertical_center" size={20} />
            </button>
            <button className="mv-toolbar-btn" title={tooltipWithShortcut("Align Bottom", "align-bottom")} onClick={() => alignRegions("bottom")}>
              <Icon name="align_vertical_bottom" size={20} />
            </button>
            {state.selectedRegionIds.length >= 3 && (
              <>
                <span className="mv-toolbar-sep" />
                <button className="mv-toolbar-btn" title={tooltipWithShortcut("Distribute Horizontally", "distribute-h")} onClick={() => distributeRegions("horizontal")}>
                  <Icon name="horizontal_distribute" size={20} />
                </button>
                <button className="mv-toolbar-btn" title={tooltipWithShortcut("Distribute Vertically", "distribute-v")} onClick={() => distributeRegions("vertical")}>
                  <Icon name="vertical_distribute" size={20} />
                </button>
              </>
            )}
            <span className="mv-toolbar-sep" />
          </>
        )}
      </div>

      {/* Right: Zoom + Live */}
      <div className="mv-toolbar-right">
        {/* OBS Connection Badge */}
        <div className={`mv-obs-badge ${obsReady ? "mv-obs-badge--connected" : "mv-obs-badge--disconnected"}`} title={obsReady ? "OBS Connected" : "OBS Disconnected"}>
          <span className={`mv-obs-badge-dot ${obsReady ? "mv-obs-badge-dot--on" : ""}`} />
          <span className="mv-obs-badge-label">{obsReady ? "OBS" : "OBS Off"}</span>
        </div>

        <span className="mv-toolbar-sep" />
        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Zoom Out", "zoom-out")} onClick={zoomOut}>
          <Icon name="remove" size={20} />
        </button>
        <button className="mv-toolbar-zoom" title={tooltipWithShortcut("Zoom to Fit", "zoom-fit")} onClick={zoomFit}>
          {Math.round(state.zoom * 100)}%
        </button>
        <button className="mv-toolbar-btn" title={tooltipWithShortcut("Zoom In", "zoom-in")} onClick={zoomIn}>
          <Icon name="add" size={20} />
        </button>

        <span className="mv-toolbar-sep" />

        {/* ── Transition Picker ── */}
        <div className="mv-transition-group" ref={transitionPickerRef}>
          <button
            className={`mv-toolbar-btn mv-transition-toggle ${showTransitionPicker ? "mv-toolbar-btn--active" : ""}`}
            title={`Transition: ${transitionConfig.kind} (${transitionConfig.durationMs}ms)`}
            onClick={() => setShowTransitionPicker((p) => !p)}
          >
            <Icon name={MV_TRANSITION_OPTIONS.find((o) => o.kind === transitionConfig.kind)?.icon ?? "swap_horiz"} size={16} />
            <span className="mv-transition-label">{transitionConfig.kind}</span>
            <Icon name={showTransitionPicker ? "expand_less" : "expand_more"} size={14} style={{ opacity: 0.5 }} />
          </button>

          {showTransitionPicker && (
            <div className="mv-transition-picker">
              <div className="mv-transition-picker-header">Scene Transition</div>

              {/* Transition type buttons */}
              <div className="mv-transition-types">
                {MV_TRANSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    className={`mv-transition-type-btn ${transitionConfig.kind === opt.kind ? "mv-transition-type-btn--active" : ""}`}
                    onClick={() => {
                      setTransitionConfig({
                        kind: opt.kind,
                        durationMs: opt.kind === "Cut" ? 0 : (transitionConfig.durationMs || 500),
                      });
                    }}
                  >
                    <Icon name={opt.icon} size={20} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* Duration slider (only for non-Cut) */}
              {transitionConfig.kind !== "Cut" && (
                <div className="mv-transition-duration">
                  <label className="mv-transition-duration-label">
                    Duration: <strong>{transitionConfig.durationMs}ms</strong>
                  </label>
                  <input
                    type="range"
                    className="mv-transition-duration-slider"
                    min={100}
                    max={2000}
                    step={50}
                    value={transitionConfig.durationMs}
                    onChange={(e) => setTransitionConfig({ durationMs: Number(e.target.value) })}
                  />
                  <div className="mv-transition-duration-presets">
                    {[300, 500, 750, 1000, 1500].map((ms) => (
                      <button
                        key={ms}
                        className={`mv-transition-preset-btn ${transitionConfig.durationMs === ms ? "mv-transition-preset-btn--active" : ""}`}
                        onClick={() => setTransitionConfig({ durationMs: ms })}
                      >
                        {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── GO LIVE (intentionally very subtle — critical broadcast action) ── */}
        <button
          className={`mv-btn mv-btn--sm mv-btn--go-live ${goingLive ? "mv-btn--go-live-active" : ""}`}
          onClick={handleGoLive}
          disabled={!obsReady || goingLive || !hasAssignedScenes}
          title={!obsReady ? "Not connected to OBS" : !hasAssignedScenes ? "Apply to OBS first" : `Transition Preview → Program (${transitionConfig.kind} ${transitionConfig.durationMs}ms)`}
        >
          {goingLive ? (
            <>
              <span className="loading-spinner-sm" />
            </>
          ) : (
            <>
              <Icon name="cell_tower" size={20} />
              Live
            </>
          )}
        </button>

        {/* Live result feedback */}
        {liveResult && (
          <span className={`mv-toolbar-sync-msg ${liveResult.success ? "mv-toolbar-sync-msg--ok" : "mv-toolbar-sync-msg--err"}`}>
            <Icon name={liveResult.success ? "check_circle" : "error"} size={14} />
            {liveResult.success ? "🔴 Live!" : (liveResult.error || "Failed")}
          </span>
        )}
      </div>

      {/* ── Delete Confirmation Modal (toolbar) ── */}
      {deleteModal && (
        <div className="mv-modal-backdrop" onClick={() => setDeleteModal(null)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon"><Icon name="warning" size={20} /></div>
            <h3 className="mv-modal-title">Remove Scene?</h3>
            <p className="mv-modal-text">
              Are you sure you want to remove <strong>"{deleteModal.sceneName}"</strong> from this slot?
              The slot will remain but the scene will be unassigned.
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button className="mv-btn mv-btn--danger"
                onClick={() => { unassignSceneFromRegion(deleteModal.regionId as any); setDeleteModal(null); }}>
                Remove Scene
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Canvas Confirmation Modal ── */}
      {showResetModal && (
        <div className="mv-modal-backdrop" onClick={() => setShowResetModal(false)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon"><Icon name="restart_alt" size={20} /></div>
            <h3 className="mv-modal-title">Reset Canvas?</h3>
            <p className="mv-modal-text">
              This will unassign all scenes from every slot and reset the canvas to its default state. This action can be undone.
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setShowResetModal(false)}>Cancel</button>
              <button className="mv-btn mv-btn--danger"
                onClick={() => { resetCanvas(); setShowResetModal(false); }}>
                <Icon name="restart_alt" size={16} />
                Reset Canvas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Undo Confirmation Modal ── */}
      {showUndoConfirm && (
        <div className="mv-modal-backdrop" onClick={() => setShowUndoConfirm(false)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon"><Icon name="undo" size={20} /></div>
            <h3 className="mv-modal-title">Undo Changes?</h3>
            <p className="mv-modal-text">
              Are you sure you want to undo? This may remove scene assignments from the canvas.
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setShowUndoConfirm(false)}>Cancel</button>
              <button className="mv-btn mv-btn--primary"
                onClick={() => { undo(); setShowUndoConfirm(false); }}>
                <Icon name="undo" size={16} />
                Undo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Scene Confirmation Modal (Apply to OBS) ── */}
      {showLiveConfirm && (
        <div className="mv-modal-backdrop" onClick={() => setShowLiveConfirm(false)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon">
              <Icon name="cell_tower" size={20} style={{ color: "#ef4444" }} />
            </div>
            <h3 className="mv-modal-title">Scene Is Currently Live</h3>
            <p className="mv-modal-text">
              The scene <strong>"MV: {layout?.name || "Untitled"}"</strong> is currently the <em>live Program output</em>.
              Applying changes may cause a brief disruption to the broadcast. A staging scene will be used to minimise impact, but viewers may notice a momentary flicker.
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setShowLiveConfirm(false)}>Cancel</button>
              <button className="mv-btn mv-btn--danger"
                onClick={() => { setShowLiveConfirm(false); doApplyToOBS(); }}>
                <Icon name="cast_connected" size={16} />
                Apply Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Go Live Confirmation Modal ── */}
      {showGoLiveConfirm && (
        <div className="mv-modal-backdrop" onClick={() => setShowGoLiveConfirm(false)}>
          <div className="mv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mv-modal-icon">
              <Icon name="warning" size={36} style={{ color: "#ef4444" }} />
            </div>
            <h3 className="mv-modal-title">Switch Live Output?</h3>
            <p className="mv-modal-text">
              This will <strong>immediately transition the Preview scene to the live Program output</strong> using
              a <strong>{transitionConfig.kind}</strong> transition
              {transitionConfig.kind !== "Cut" ? ` (${transitionConfig.durationMs}ms)` : ""}.
            </p>
            <p className="mv-modal-text" style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
              ⚠ If you are currently streaming or recording, your audience will see this change in real time.
              Make sure the Preview scene is exactly how you want it before proceeding.
            </p>
            <div className="mv-modal-actions">
              <button className="mv-btn mv-btn--ghost" onClick={() => setShowGoLiveConfirm(false)}>Cancel</button>
              <button className="mv-btn mv-btn--danger" onClick={doGoLive}>
                <Icon name="cell_tower" size={16} />
                Yes, Go Live
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Keyboard Shortcuts Reference Modal ── */}
      {showShortcutsModal && <ShortcutsReferenceModal onClose={() => setShowShortcutsModal(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard Shortcuts Reference Modal
// ---------------------------------------------------------------------------

import { getShortcutsByCategory, CATEGORY_LABELS, shortcutLabel as fmtShortcut } from "../shortcuts";
import Icon from "../../components/Icon";

function ShortcutsReferenceModal({ onClose }: { onClose: () => void }) {
  const grouped = getShortcutsByCategory();
  const [search, setSearch] = useState("");

  return (
    <div className="mv-modal-backdrop" onClick={onClose}>
      <div className="mv-modal mv-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mv-shortcuts-header">
          <h3 className="mv-modal-title">Keyboard Shortcuts</h3>
          <div className="mv-shortcuts-search-wrap">
            <input
              className="mv-shortcuts-search"
              type="text"
              placeholder="Search shortcuts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search keyboard shortcuts"
              autoFocus
            />
            {search && (
              <button
                type="button"
                className="mv-inline-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear shortcut search"
                title="Clear shortcut search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <button className="mv-toolbar-btn" onClick={onClose} title="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="mv-shortcuts-body">
          {Array.from(grouped.entries()).map(([cat, items]) => {
            const filtered = search
              ? items.filter((s) =>
                  s.label.toLowerCase().includes(search.toLowerCase()) ||
                  (s.description ?? "").toLowerCase().includes(search.toLowerCase())
                )
              : items;
            if (filtered.length === 0) return null;
            return (
              <div key={cat} className="mv-shortcuts-group">
                <h4 className="mv-shortcuts-group-title">{CATEGORY_LABELS[cat]}</h4>
                {filtered.map((s) => (
                  <div key={s.id} className="mv-shortcuts-row">
                    <span className="mv-shortcuts-label">{s.label}</span>
                    {s.description && <span className="mv-shortcuts-desc">{s.description}</span>}
                    <span className="mv-shortcuts-keys">{fmtShortcut(s.keys)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
