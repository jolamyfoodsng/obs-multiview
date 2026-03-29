/**
 * MVSceneSync.tsx — Scenes & Output Sync Page
 *
 * Maps Multi-View layouts to OBS scene slots and pushes them.
 * Each "slot" represents an OBS scene that will be created/updated
 * with the assigned layout's regions as sources.
 *
 * Features:
 *  - Sync status indicator (connected/disconnected)
 *  - Managed scene list (scenes created by OBS Church Studio)
 *  - Scene conflict detection (renamed/missing scenes)
 *  - Re-link, rename, delete managed scenes
 *  - Slot-based push workflow
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import { getUserLayouts } from "../mvStore";
import { obsService } from "../../services/obsService";
import {
  pushLayoutToOBS,
  pushAllSlotsToOBS,
  isOBSReady,
  getOBSScenes,
  type SceneSlot,
  type SyncResult,
} from "../mvObsService";
import {
  getAllScenes,
  type RegisteredScene,
} from "../../services/obsRegistry";
import type { MVLayout, LayoutId } from "../types";
import Icon from "../../components/Icon";

interface SlotUI extends SceneSlot {
  _uid: string;
  _status?: "idle" | "syncing" | "synced" | "error";
  _error?: string;
}

/** Check if a managed scene still exists in OBS (may have been renamed) */
interface ManagedSceneStatus extends RegisteredScene {
  existsInObs: boolean;
  currentName?: string;
}

export function MVSceneSync() {
  const navigate = useNavigate();

  const [layouts, setLayouts] = useState<MVLayout[]>([]);
  const [slots, setSlots] = useState<SlotUI[]>([]);
  const [obsConnected, setObsConnected] = useState(isOBSReady());
  const [obsScenes, setObsScenes] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    ok: number;
    err: number;
    results: SyncResult[];
  } | null>(null);

  // Managed scenes from registry
  const [managedScenes, setManagedScenes] = useState<ManagedSceneStatus[]>([]);
  const [managedLoading, setManagedLoading] = useState(true);

  // Load layouts from IndexedDB
  useEffect(() => {
    getUserLayouts().then(setLayouts);
  }, []);

  // Track OBS connection
  useEffect(() => {
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
    return unsub;
  }, []);

  // Fetch existing OBS scenes when connected
  useEffect(() => {
    if (obsConnected) {
      getOBSScenes().then(setObsScenes).catch(() => setObsScenes([]));
    } else {
      setObsScenes([]);
    }
  }, [obsConnected]);

  // Load managed scenes from registry and cross-check with OBS
  const loadManagedScenes = useCallback(async () => {
    setManagedLoading(true);
    try {
      const registered = await getAllScenes();
      const status: ManagedSceneStatus[] = registered.map((s) => ({
        ...s,
        existsInObs: obsScenes.includes(s.sceneName),
        currentName: obsScenes.includes(s.sceneName) ? s.sceneName : undefined,
      }));
      setManagedScenes(status);
    } catch {
      setManagedScenes([]);
    } finally {
      setManagedLoading(false);
    }
  }, [obsScenes]);

  useEffect(() => {
    loadManagedScenes();
  }, [loadManagedScenes]);

  // Delete a managed scene from OBS
  const deleteManagedScene = useCallback(async (scene: ManagedSceneStatus) => {
    if (!obsConnected || !scene.existsInObs) return;
    try {
      await obsService.call("RemoveScene", { sceneName: scene.sceneName });
      // Refresh
      const scenes = await getOBSScenes().catch(() => [] as string[]);
      setObsScenes(scenes);
    } catch (err) {
      console.error("[SceneSync] Failed to delete scene:", err);
    }
  }, [obsConnected]);

  // Rename a managed scene in OBS
  const renameManagedScene = useCallback(async (scene: ManagedSceneStatus, newName: string) => {
    if (!obsConnected || !scene.existsInObs || !newName.trim()) return;
    try {
      await obsService.call("SetSceneName", { sceneName: scene.sceneName, newSceneName: newName.trim() });
      const scenes = await getOBSScenes().catch(() => [] as string[]);
      setObsScenes(scenes);
    } catch (err) {
      console.error("[SceneSync] Failed to rename scene:", err);
    }
  }, [obsConnected]);

  // ── Slot Management ────────────────────────────────────────

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        _uid: nanoid(8),
        obsSceneName: `MV Scene ${prev.length + 1}`,
        layoutId: null,
        _status: "idle",
      },
    ]);
  };

  const updateSlot = (uid: string, changes: Partial<SlotUI>) => {
    setSlots((prev) =>
      prev.map((s) => (s._uid === uid ? { ...s, ...changes } : s))
    );
  };

  const removeSlot = (uid: string) => {
    setSlots((prev) => prev.filter((s) => s._uid !== uid));
  };

  // ── Sync Single Slot ─────────────────────────────────────

  const syncSlot = useCallback(
    async (slot: SlotUI) => {
      if (!slot.layoutId || !slot.obsSceneName.trim()) return;

      const layout = layouts.find((l) => l.id === slot.layoutId);
      if (!layout) return;

      updateSlot(slot._uid, { _status: "syncing", _error: undefined });

      try {
        const result = await pushLayoutToOBS(layout, slot.obsSceneName);
        if (result.success) {
          updateSlot(slot._uid, {
            _status: "synced",
            lastSyncedAt: new Date().toISOString(),
            layoutName: layout.name,
          });
        } else {
          updateSlot(slot._uid, {
            _status: "error",
            _error: result.errors.join("; "),
          });
        }
      } catch (err) {
        updateSlot(slot._uid, {
          _status: "error",
          _error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [layouts]
  );

  // ── Sync All Slots ──────────────────────────────────────

  const syncAll = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setBatchResult(null);

    // Mark all as syncing
    setSlots((prev) =>
      prev.map((s) => ({
        ...s,
        _status: s.layoutId && s.obsSceneName.trim() ? "syncing" as const : s._status,
        _error: undefined,
      }))
    );

    const layoutMap = new Map<string, MVLayout>();
    layouts.forEach((l) => layoutMap.set(l.id, l));

    const validSlots = slots.filter(
      (s) => s.layoutId && s.obsSceneName.trim()
    );

    const { results, totalErrors } = await pushAllSlotsToOBS(
      validSlots.map((s) => ({
        obsSceneName: s.obsSceneName,
        layoutId: s.layoutId,
        layoutName: s.layoutName,
      })),
      layoutMap
    );

    // Update each slot status based on results
    const resultMap = new Map<string, SyncResult>();
    results.forEach((r) => resultMap.set(r.sceneName, r));

    setSlots((prev) =>
      prev.map((s) => {
        const r = resultMap.get(s.obsSceneName);
        if (!r) return { ...s, _status: "idle" as const };
        return {
          ...s,
          _status: r.success ? ("synced" as const) : ("error" as const),
          _error: r.success ? undefined : r.errors.join("; "),
          lastSyncedAt: r.success ? new Date().toISOString() : s.lastSyncedAt,
        };
      })
    );

    setBatchResult({
      ok: results.filter((r) => r.success).length,
      err: totalErrors,
      results,
    });
    setSyncing(false);

    // Refresh OBS scenes list
    getOBSScenes().then(setObsScenes).catch(() => {});
  }, [syncing, slots, layouts]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="mv-page">
      <div className="mv-scene-sync">
        {/* Header */}
        <div className="mv-scene-sync-header">
          <div>
            <h2 className="mv-page-title">Scenes & Output Sync</h2>
            <p className="mv-page-desc">
              Map your layouts to OBS scenes, then push them all at once.
            </p>
          </div>

          <div className="mv-scene-sync-actions">
            {/* Sync Status Indicator */}
            <div
              className="mv-sync-status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 4,
                background: obsConnected ? "rgba(0, 230, 118, 0.08)" : "rgba(231, 72, 86, 0.08)",
                border: `2px solid ${obsConnected ? "rgba(0, 230, 118, 0.2)" : "rgba(231, 72, 86, 0.2)"}`,
                fontSize: 12,
                fontWeight: 600,
                color: obsConnected ? "var(--success)" : "var(--error)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: obsConnected ? "var(--success)" : "var(--error)",
                }}
              />
              {obsConnected ? "OBS Connected" : "OBS Disconnected"}
            </div>

            <button
              className="mv-btn mv-btn--outline"
              onClick={addSlot}
            >
              <Icon name="add" size={16} />
              Add Scene Slot
            </button>

            <button
              className={`mv-btn ${obsConnected ? "mv-btn--obs" : "mv-btn--outline"}`}
              disabled={
                !obsConnected ||
                syncing ||
                slots.filter((s) => s.layoutId && s.obsSceneName.trim()).length === 0
              }
              onClick={syncAll}
            >
              {syncing ? (
                <>
                  <span className="loading-spinner-sm" />
                  Syncing...
                </>
              ) : (
                <>
                  <Icon name="cloud_upload" size={16} />
                  Push All to OBS
                </>
              )}
            </button>
          </div>
        </div>

        {/* Batch Result */}
        {batchResult && (
          <div
            className={`mv-scene-sync-result ${
              batchResult.err === 0
                ? "mv-scene-sync-result--ok"
                : "mv-scene-sync-result--err"
            }`}
          >
            <Icon name={batchResult.err === 0 ? "check_circle" : "warning"} size={20} />
            {batchResult.err === 0
              ? `Successfully synced ${batchResult.ok} scene${batchResult.ok !== 1 ? "s" : ""} to OBS`
              : `${batchResult.ok} succeeded, ${batchResult.err} error${batchResult.err !== 1 ? "s" : ""}`}
            <button
              className="mv-btn mv-btn--sm mv-btn--outline"
              onClick={() => setBatchResult(null)}
              style={{ marginLeft: "auto" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Managed Scenes — scenes created by OBS Church Studio */}
        {!managedLoading && managedScenes.length > 0 && (
          <div style={{
            background: "var(--surface-dark)",
            border: "2px solid var(--border)",
            borderRadius: 6,
            padding: 16,
            marginBottom: 8,
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="verified" size={16} style={{ color: "var(--primary)" }} />
              Managed by OBS Church Studio
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>
                ({managedScenes.length} scene{managedScenes.length !== 1 ? "s" : ""})
              </span>
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {managedScenes.map((scene) => (
                <div
                  key={scene.slot}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "var(--bg-dark)",
                    borderRadius: 4,
                    border: `2px solid ${scene.existsInObs ? "var(--border)" : "rgba(231, 72, 86, 0.3)"}`,
                  }}
                >
                  {/* Status dot */}
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: scene.existsInObs ? "var(--success)" : "var(--error)",
                      flexShrink: 0,
                    }}
                  />
                  {/* Scene info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {scene.sceneName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {scene.existsInObs ? "Active in OBS" : "⚠ Not found in OBS — may have been renamed or deleted"}
                      {" · "}Slot: {scene.slot}
                    </div>
                  </div>
                  {/* Actions */}
                  {scene.existsInObs && obsConnected && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        className="mv-btn mv-btn--sm mv-btn--outline"
                        title="Rename scene in OBS"
                        onClick={() => {
                          const newName = prompt("Rename scene:", scene.sceneName);
                          if (newName && newName !== scene.sceneName) {
                            renameManagedScene(scene, newName);
                          }
                        }}
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        className="mv-btn mv-btn--sm mv-btn--outline"
                        title="Delete scene from OBS"
                        style={{ color: "var(--error)" }}
                        onClick={() => {
                          if (confirm(`Delete "${scene.sceneName}" from OBS?`)) {
                            deleteManagedScene(scene);
                          }
                        }}
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Existing OBS Scenes */}
        {obsScenes.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>
            <strong>All OBS scenes:</strong>{" "}
            {obsScenes.join(", ")}
          </div>
        )}

        {/* Slots */}
        <div className="mv-scene-slots">
          {slots.map((slot, idx) => (
            <div key={slot._uid} className="mv-scene-slot">
              <div className="mv-scene-slot-number">{idx + 1}</div>

              <div className="mv-scene-slot-body">
                {/* Scene Name */}
                <input
                  className="mv-scene-slot-name"
                  placeholder="OBS Scene Name"
                  value={slot.obsSceneName}
                  onChange={(e) =>
                    updateSlot(slot._uid, { obsSceneName: e.target.value })
                  }
                />

                {/* Layout Picker */}
                <div className="mv-scene-slot-layout">
                  <select
                    value={slot.layoutId ?? ""}
                    onChange={(e) =>
                      updateSlot(slot._uid, {
                        layoutId: (e.target.value || null) as LayoutId | null,
                        layoutName:
                          layouts.find((l) => l.id === e.target.value)?.name ??
                          undefined,
                        _status: "idle",
                      })
                    }
                  >
                    <option value="">— Select Layout —</option>
                    {layouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.regions.length} regions)
                      </option>
                    ))}
                  </select>

                  {slot.layoutId && (
                    <button
                      className="mv-btn mv-btn--sm mv-btn--outline"
                      onClick={() =>
                        navigate(`/edit/${slot.layoutId}`)
                      }
                      title="Edit this layout"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Status */}
              <div
                className={`mv-scene-slot-status ${
                  slot._status === "synced"
                    ? "mv-scene-slot-status--synced"
                    : slot._status === "error"
                    ? "mv-scene-slot-status--error"
                    : ""
                }`}
              >
                {slot._status === "syncing" && (
                  <>
                    <span className="loading-spinner-sm" />
                    Syncing
                  </>
                )}
                {slot._status === "synced" && (
                  <>
                    <Icon name="check_circle" size={20} />
                    Synced
                  </>
                )}
                {slot._status === "error" && (
                  <>
                    <Icon name="error" size={20} />
                    {slot._error ?? "Error"}
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="mv-scene-slot-actions">
                <button
                  className="mv-scene-slot-action"
                  title="Sync this scene"
                  disabled={
                    !obsConnected ||
                    !slot.layoutId ||
                    !slot.obsSceneName.trim() ||
                    slot._status === "syncing"
                  }
                  onClick={() => syncSlot(slot)}
                >
                  <Icon name="cloud_upload" size={20} />
                </button>
                <button
                  className="mv-scene-slot-action mv-scene-slot-action--danger"
                  title="Remove slot"
                  onClick={() => removeSlot(slot._uid)}
                >
                  <Icon name="close" size={20} />
                </button>
              </div>
            </div>
          ))}

          {slots.length === 0 && (
            <div className="mv-scene-empty-slot" onClick={addSlot}>
              <Icon name="add_circle_outline" size={20} />
              Add your first scene slot to get started
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
