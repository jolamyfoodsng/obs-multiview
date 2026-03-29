/**
 * Multi-View Editor Store — React Context + useReducer
 *
 * Manages the canvas editor state: open layout, selection, undo/redo, zoom.
 * v2: Template-driven editing with background, safe frame, region constraints.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
  type Dispatch,
} from "react";
import { nanoid } from "nanoid";
import {
  INITIAL_EDITOR_STATE,
  DEFAULT_CONSTRAINTS,
  createDefaultRegion,
  migrateLayout,
  type EditorState,
  type MVLayout,
  type Region,
  type RegionId,
  type RegionType,
  type BackgroundConfig,
  type SafeFrameConfig,
} from "./types";
import { saveLayout } from "./mvStore";
import { saveRecoverySnapshot, clearRecoverySnapshot } from "./mvStore";
import { recordAction } from "./components/MVHistoryPanel";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AlignAxis = "left" | "right" | "top" | "bottom" | "center-h" | "center-v";
export type DistributeAxis = "horizontal" | "vertical";

export type EditorAction =
  | { type: "OPEN_LAYOUT"; layout: MVLayout }
  | { type: "CLOSE_LAYOUT" }
  | { type: "UPDATE_LAYOUT"; changes: Partial<MVLayout> }
  | { type: "SET_BACKGROUND"; background: Partial<BackgroundConfig> }
  | { type: "UPDATE_SAFE_FRAME"; changes: Partial<SafeFrameConfig> }
  | { type: "ADD_REGION"; regionType: RegionType }
  | { type: "ADD_OBS_SCENE"; sceneName: string; sceneIndex: number }
  | { type: "ASSIGN_SCENE_TO_REGION"; regionId: RegionId; sceneName: string; sceneIndex: number }
  | { type: "UNASSIGN_SCENE_FROM_REGION"; regionId: RegionId }
  | { type: "UPDATE_REGION"; regionId: RegionId; changes: Partial<Region> }
  | { type: "DELETE_REGIONS"; regionIds: RegionId[] }
  | { type: "DUPLICATE_REGIONS"; regionIds: RegionId[] }
  | { type: "REORDER_REGION"; regionId: RegionId; direction: "up" | "down" | "top" | "bottom" }
  | { type: "TOGGLE_LOCK"; regionId: RegionId }
  | { type: "TOGGLE_VISIBILITY"; regionId: RegionId }
  | { type: "SELECT_REGION"; regionId: RegionId; additive: boolean }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "SELECT_NEXT_REGION" }
  | { type: "SELECT_PREV_REGION" }
  | { type: "COPY" }
  | { type: "PASTE" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SNAPSHOT" }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_PAN"; panX: number; panY: number }
  | { type: "TOGGLE_SAFE_FRAME" }
  | { type: "TOGGLE_GRID" }
  | { type: "TOGGLE_SNAP" }
  | { type: "TOGGLE_BACKGROUND_PICKER" }
  | { type: "SET_DRAGGING"; value: boolean }
  | { type: "SET_RESIZING"; value: boolean }
  | { type: "RESET_CANVAS" }
  | { type: "ALIGN_REGIONS"; axis: AlignAxis }
  | { type: "DISTRIBUTE_REGIONS"; axis: DistributeAxis }
  | { type: "LOCK_ALL" }
  | { type: "UNLOCK_ALL" }
  | { type: "RENAME_REGION"; regionId: RegionId; name: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const MAX_UNDO = 50;

function maxZ(regions: Region[]): number {
  return regions.length > 0 ? Math.max(...regions.map((r) => r.zIndex)) : 0;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "OPEN_LAYOUT": {
      const migrated = migrateLayout(action.layout);
      return { ...INITIAL_EDITOR_STATE, layout: migrated, showSafeFrame: migrated.safeFrame?.visible ?? true };
    }

    case "CLOSE_LAYOUT":
      return INITIAL_EDITOR_STATE;

    case "UPDATE_LAYOUT":
      if (!state.layout) return state;
      return { ...state, layout: { ...state.layout, ...action.changes, updatedAt: new Date().toISOString() } };

    case "SET_BACKGROUND":
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          background: { ...state.layout.background, ...action.background },
          backgroundColor: action.background.color ?? state.layout.background.color,
          updatedAt: new Date().toISOString(),
        },
      };

    case "UPDATE_SAFE_FRAME":
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          safeFrame: { ...state.layout.safeFrame, ...action.changes },
          updatedAt: new Date().toISOString(),
        },
      };

    case "ADD_REGION": {
      if (!state.layout) return state;
      const id = nanoid(10) as RegionId;
      const newRegion = createDefaultRegion(action.regionType, id, state.layout.canvas, state.layout.safeFrame);
      newRegion.zIndex = maxZ(state.layout.regions) + 1;
      return {
        ...state,
        layout: { ...state.layout, regions: [...state.layout.regions, newRegion], updatedAt: new Date().toISOString() },
        selectedRegionIds: [id],
      };
    }

    case "ADD_OBS_SCENE": {
      if (!state.layout) return state;
      const id = nanoid(10) as RegionId;
      const c = state.layout.canvas;
      const sf = state.layout.safeFrame;
      const cx = sf.enabled ? sf.left : Math.round(c.width * 0.1);
      const cy = sf.enabled ? sf.top : Math.round(c.height * 0.1);
      const cw = sf.enabled ? c.width - sf.left - sf.right : Math.round(c.width * 0.4);
      const ch = sf.enabled ? c.height - sf.top - sf.bottom : Math.round(c.height * 0.4);
      const newRegion: Region = {
        id, type: "obs-scene", name: action.sceneName,
        x: cx + Math.round(cw * 0.05), y: cy + Math.round(ch * 0.05),
        width: Math.round(cw * 0.6), height: Math.round(ch * 0.6),
        rotation: 0, zIndex: maxZ(state.layout.regions) + 1, opacity: 1,
        locked: false, visible: true, borderRadius: 0,
        sceneName: action.sceneName, sceneIndex: action.sceneIndex,
        constraints: { ...DEFAULT_CONSTRAINTS },
      };
      return {
        ...state,
        layout: { ...state.layout, regions: [...state.layout.regions, newRegion], updatedAt: new Date().toISOString() },
        selectedRegionIds: [id],
      };
    }

    case "ASSIGN_SCENE_TO_REGION": {
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => {
            if (r.id !== action.regionId) return r;
            // Assign OBS scene to this region — change its type to obs-scene
            return {
              ...r,
              type: "obs-scene" as const,
              name: action.sceneName,
              sceneName: action.sceneName,
              sceneIndex: action.sceneIndex,
            } as Region;
          }),
          updatedAt: new Date().toISOString(),
        },
        selectedRegionIds: [action.regionId],
      };
    }

    case "UNASSIGN_SCENE_FROM_REGION": {
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => {
            if (r.id !== action.regionId) return r;
            // Revert to empty obs-scene slot (keep position/size/constraints)
            // Also clear any Bible/Worship theme data
            return {
              ...r,
              type: "obs-scene" as const,
              name: r.slotLabel || "Empty Slot",
              sceneName: "",
              sceneIndex: -1,
              thumbnail: undefined,
              themeId: undefined,
              themeSettings: undefined,
              fontOverrides: undefined,
            } as Region;
          }),
          updatedAt: new Date().toISOString(),
        },
        selectedRegionIds: [action.regionId],
      };
    }

    case "UPDATE_REGION": {
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => {
            if (r.id !== action.regionId) return r;
            const changes = { ...action.changes };
            const con = r.constraints;
            if (con?.lockPosition) { delete changes.x; delete changes.y; }
            // lockSize no longer blocks width/height — edge resizing is allowed
            // but min/max constraints are still enforced
            if (changes.width !== undefined && con) {
              if (con.minWidth) changes.width = Math.max(con.minWidth, changes.width as number);
              if (con.maxWidth) changes.width = Math.min(con.maxWidth, changes.width as number);
            }
            if (changes.height !== undefined && con) {
              if (con.minHeight) changes.height = Math.max(con.minHeight, changes.height as number);
              if (con.maxHeight) changes.height = Math.min(con.maxHeight, changes.height as number);
            }
            return { ...r, ...changes } as Region;
          }),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    case "DELETE_REGIONS": {
      if (!state.layout) return state;
      const ids = new Set(action.regionIds);
      const deletable = state.layout.regions.filter((r) => ids.has(r.id) && !r.constraints?.lockDelete);
      const deleteIds = new Set(deletable.map((r) => r.id));
      if (deleteIds.size === 0) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.filter((r) => !deleteIds.has(r.id)),
          updatedAt: new Date().toISOString(),
        },
        selectedRegionIds: state.selectedRegionIds.filter((id) => !deleteIds.has(id)),
      };
    }

    case "DUPLICATE_REGIONS": {
      if (!state.layout) return state;
      const newRegions: Region[] = [];
      const newIds: RegionId[] = [];
      for (const rid of action.regionIds) {
        const orig = state.layout.regions.find((r) => r.id === rid);
        if (orig) {
          const newId = nanoid(10) as RegionId;
          newIds.push(newId);
          newRegions.push({
            ...orig, id: newId, name: `${orig.name} Copy`,
            x: orig.x + 20, y: orig.y + 20,
            zIndex: maxZ(state.layout.regions) + newRegions.length + 1,
            constraints: { ...DEFAULT_CONSTRAINTS },
          });
        }
      }
      return {
        ...state,
        layout: { ...state.layout, regions: [...state.layout.regions, ...newRegions], updatedAt: new Date().toISOString() },
        selectedRegionIds: newIds,
      };
    }

    case "REORDER_REGION": {
      if (!state.layout) return state;
      const regions = [...state.layout.regions].sort((a, b) => a.zIndex - b.zIndex);
      const idx = regions.findIndex((r) => r.id === action.regionId);
      if (idx === -1) return state;
      let newIdx = idx;
      if (action.direction === "up") newIdx = Math.min(idx + 1, regions.length - 1);
      else if (action.direction === "down") newIdx = Math.max(idx - 1, 0);
      else if (action.direction === "top") newIdx = regions.length - 1;
      else if (action.direction === "bottom") newIdx = 0;
      const [moved] = regions.splice(idx, 1);
      regions.splice(newIdx, 0, moved);
      const reindexed = regions.map((r, i) => ({ ...r, zIndex: i + 1 }));
      return { ...state, layout: { ...state.layout, regions: reindexed, updatedAt: new Date().toISOString() } };
    }

    case "TOGGLE_LOCK": {
      if (!state.layout) return state;
      return { ...state, layout: { ...state.layout, regions: state.layout.regions.map((r) => r.id === action.regionId ? { ...r, locked: !r.locked } : r) } };
    }

    case "TOGGLE_VISIBILITY": {
      if (!state.layout) return state;
      return { ...state, layout: { ...state.layout, regions: state.layout.regions.map((r) => r.id === action.regionId ? { ...r, visible: !r.visible } : r) } };
    }

    case "SELECT_REGION":
      if (action.additive) {
        const has = state.selectedRegionIds.includes(action.regionId);
        return { ...state, selectedRegionIds: has ? state.selectedRegionIds.filter((id) => id !== action.regionId) : [...state.selectedRegionIds, action.regionId] };
      }
      return { ...state, selectedRegionIds: [action.regionId] };

    case "SELECT_ALL":
      return { ...state, selectedRegionIds: state.layout?.regions.map((r) => r.id) ?? [] };

    case "DESELECT_ALL":
      return { ...state, selectedRegionIds: [] };

    case "COPY":
      if (!state.layout) return state;
      return { ...state, clipboard: state.layout.regions.filter((r) => state.selectedRegionIds.includes(r.id)) };

    case "PASTE": {
      if (!state.layout || state.clipboard.length === 0) return state;
      const pasted: Region[] = [];
      const pastedIds: RegionId[] = [];
      for (const orig of state.clipboard) {
        const newId = nanoid(10) as RegionId;
        pastedIds.push(newId);
        pasted.push({ ...orig, id: newId, name: `${orig.name} Copy`, x: orig.x + 20, y: orig.y + 20, zIndex: maxZ(state.layout.regions) + pasted.length + 1, constraints: { ...DEFAULT_CONSTRAINTS } });
      }
      return { ...state, layout: { ...state.layout, regions: [...state.layout.regions, ...pasted], updatedAt: new Date().toISOString() }, selectedRegionIds: pastedIds };
    }

    case "SNAPSHOT":
      if (!state.layout) return state;
      return { ...state, undoStack: [...state.undoStack.slice(-MAX_UNDO), state.layout], redoStack: [] };

    case "UNDO": {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return { ...state, undoStack: state.undoStack.slice(0, -1), redoStack: state.layout ? [...state.redoStack, state.layout] : state.redoStack, layout: prev, selectedRegionIds: [] };
    }

    case "REDO": {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return { ...state, redoStack: state.redoStack.slice(0, -1), undoStack: state.layout ? [...state.undoStack, state.layout] : state.undoStack, layout: next, selectedRegionIds: [] };
    }

    case "SET_ZOOM": return { ...state, zoom: Math.max(0.1, Math.min(3, action.zoom)) };
    case "SET_PAN": return { ...state, panX: action.panX, panY: action.panY };
    case "TOGGLE_SAFE_FRAME": return { ...state, showSafeFrame: !state.showSafeFrame };
    case "TOGGLE_GRID": return { ...state, showGrid: !state.showGrid };
    case "TOGGLE_SNAP": return { ...state, snapEnabled: !state.snapEnabled };
    case "TOGGLE_BACKGROUND_PICKER": return { ...state, showBackgroundPicker: !state.showBackgroundPicker };
    case "SET_DRAGGING": return { ...state, isDragging: action.value };
    case "SET_RESIZING": return { ...state, isResizing: action.value };

    case "RESET_CANVAS": {
      if (!state.layout) return state;
      // Unassign every scene, reset all regions, and restore default background
      const resetRegions = state.layout.regions.map((r) => {
        if (r.type === "obs-scene") {
          return { ...r, sceneName: "", sceneIndex: -1, name: r.slotLabel || "Empty Slot", thumbnail: undefined } as Region;
        }
        return r;
      });
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: resetRegions,
          background: {
            type: "color",
            color: "#0a0a14",
            objectFit: "cover",
            loop: true,
            opacity: 1,
          },
          updatedAt: new Date().toISOString(),
        },
        selectedRegionIds: [],
      };
    }

    case "SELECT_NEXT_REGION": {
      if (!state.layout || state.layout.regions.length === 0) return state;
      const sorted = [...state.layout.regions].sort((a, b) => a.zIndex - b.zIndex);
      if (state.selectedRegionIds.length === 0) {
        return { ...state, selectedRegionIds: [sorted[0].id] };
      }
      const currentId = state.selectedRegionIds[0];
      const idx = sorted.findIndex((r) => r.id === currentId);
      const nextIdx = (idx + 1) % sorted.length;
      return { ...state, selectedRegionIds: [sorted[nextIdx].id] };
    }

    case "SELECT_PREV_REGION": {
      if (!state.layout || state.layout.regions.length === 0) return state;
      const sorted = [...state.layout.regions].sort((a, b) => a.zIndex - b.zIndex);
      if (state.selectedRegionIds.length === 0) {
        return { ...state, selectedRegionIds: [sorted[sorted.length - 1].id] };
      }
      const currentId = state.selectedRegionIds[0];
      const idx = sorted.findIndex((r) => r.id === currentId);
      const prevIdx = (idx - 1 + sorted.length) % sorted.length;
      return { ...state, selectedRegionIds: [sorted[prevIdx].id] };
    }

    case "ALIGN_REGIONS": {
      if (!state.layout || state.selectedRegionIds.length < 2) return state;
      const sel = state.layout.regions.filter((r) => state.selectedRegionIds.includes(r.id));
      if (sel.length < 2) return state;
      let aligned: Map<RegionId, Partial<Region>> = new Map();
      switch (action.axis) {
        case "left": { const minX = Math.min(...sel.map((r) => r.x)); sel.forEach((r) => aligned.set(r.id, { x: minX })); break; }
        case "right": { const maxRight = Math.max(...sel.map((r) => r.x + r.width)); sel.forEach((r) => aligned.set(r.id, { x: maxRight - r.width })); break; }
        case "top": { const minY = Math.min(...sel.map((r) => r.y)); sel.forEach((r) => aligned.set(r.id, { y: minY })); break; }
        case "bottom": { const maxBottom = Math.max(...sel.map((r) => r.y + r.height)); sel.forEach((r) => aligned.set(r.id, { y: maxBottom - r.height })); break; }
        case "center-h": { const avgCx = sel.reduce((s, r) => s + r.x + r.width / 2, 0) / sel.length; sel.forEach((r) => aligned.set(r.id, { x: Math.round(avgCx - r.width / 2) })); break; }
        case "center-v": { const avgCy = sel.reduce((s, r) => s + r.y + r.height / 2, 0) / sel.length; sel.forEach((r) => aligned.set(r.id, { y: Math.round(avgCy - r.height / 2) })); break; }
      }
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => aligned.has(r.id) ? { ...r, ...aligned.get(r.id)! } as Region : r),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    case "DISTRIBUTE_REGIONS": {
      if (!state.layout || state.selectedRegionIds.length < 3) return state;
      const sel = state.layout.regions.filter((r) => state.selectedRegionIds.includes(r.id));
      if (sel.length < 3) return state;
      const distributed: Map<RegionId, Partial<Region>> = new Map();
      if (action.axis === "horizontal") {
        const sorted = [...sel].sort((a, b) => a.x - b.x);
        const totalWidth = sorted.reduce((s, r) => s + r.width, 0);
        const totalSpace = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width - sorted[0].x;
        const gap = (totalSpace - totalWidth) / (sorted.length - 1);
        let x = sorted[0].x;
        sorted.forEach((r, i) => {
          if (i > 0) distributed.set(r.id, { x: Math.round(x) });
          x += r.width + gap;
        });
      } else {
        const sorted = [...sel].sort((a, b) => a.y - b.y);
        const totalHeight = sorted.reduce((s, r) => s + r.height, 0);
        const totalSpace = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height - sorted[0].y;
        const gap = (totalSpace - totalHeight) / (sorted.length - 1);
        let y = sorted[0].y;
        sorted.forEach((r, i) => {
          if (i > 0) distributed.set(r.id, { y: Math.round(y) });
          y += r.height + gap;
        });
      }
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => distributed.has(r.id) ? { ...r, ...distributed.get(r.id)! } as Region : r),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    case "LOCK_ALL": {
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => ({ ...r, locked: true }) as Region),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    case "UNLOCK_ALL": {
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) => ({ ...r, locked: false }) as Region),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    case "RENAME_REGION": {
      if (!state.layout) return state;
      return {
        ...state,
        layout: {
          ...state.layout,
          regions: state.layout.regions.map((r) =>
            r.id === action.regionId ? { ...r, name: action.name } as Region : r
          ),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    default: return state;
  }
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  openLayout: (layout: MVLayout) => void;
  closeLayout: () => void;
  addRegion: (type: RegionType) => void;
  addOBSScene: (sceneName: string, sceneIndex: number) => void;
  assignSceneToRegion: (regionId: RegionId, sceneName: string, sceneIndex: number) => void;
  unassignSceneFromRegion: (regionId: RegionId) => void;
  updateRegion: (id: RegionId, changes: Partial<Region>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  selectRegion: (id: RegionId, additive?: boolean) => void;
  deselectAll: () => void;
  setBackground: (bg: Partial<BackgroundConfig>) => void;
  updateSafeFrame: (changes: Partial<SafeFrameConfig>) => void;
  resetCanvas: () => void;
  alignRegions: (axis: AlignAxis) => void;
  distributeRegions: (axis: DistributeAxis) => void;
  lockAll: () => void;
  unlockAll: () => void;
  selectNextRegion: () => void;
  selectPrevRegion: () => void;
  renameRegion: (id: RegionId, name: string) => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => void;
  save: () => Promise<void>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wrap dispatch to also record actions in the audit log
  const dispatch: Dispatch<EditorAction> = useCallback((action: EditorAction) => {
    rawDispatch(action);
    // Build detail string for certain actions
    let detail: string | undefined;
    if ("regionId" in action && action.regionId) detail = `Region: ${action.regionId}`;
    if ("sceneName" in action && action.sceneName) detail = `Scene: ${action.sceneName}`;
    if ("axis" in action && action.axis) detail = `Axis: ${action.axis}`;
    if ("direction" in action && action.direction) detail = `Direction: ${action.direction}`;
    if ("regionType" in action && action.regionType) detail = `Type: ${action.regionType}`;
    if ("name" in action && typeof action.name === "string") detail = `Name: ${action.name}`;
    recordAction(action.type, detail);
  }, []);

  const save = useCallback(async () => {
    if (state.layout) {
      await saveLayout(state.layout);
      clearRecoverySnapshot();
      recordAction("LAYOUT_SAVED", `Layout: ${state.layout.name}`);
      console.log("[MV Editor] Saved layout:", state.layout.id);
    }
  }, [state.layout]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { save(); }, 1000);
  }, [save]);

  // ── Periodic auto-save every 60s + recovery snapshot every 30s ──
  useEffect(() => {
    const periodicSave = setInterval(() => {
      if (state.layout) {
        save();
      }
    }, 60_000);

    const recoveryInterval = setInterval(() => {
      if (state.layout) {
        saveRecoverySnapshot(state.layout);
      }
    }, 30_000);

    return () => {
      clearInterval(periodicSave);
      clearInterval(recoveryInterval);
    };
  }, [state.layout, save]);

  const openLayout = useCallback((layout: MVLayout) => { dispatch({ type: "OPEN_LAYOUT", layout }); }, []);
  const closeLayout = useCallback(() => { save(); dispatch({ type: "CLOSE_LAYOUT" }); }, [save]);
  const snapshot = useCallback(() => { dispatch({ type: "SNAPSHOT" }); }, []);

  const addRegion = useCallback((type: RegionType) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "ADD_REGION", regionType: type }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const addOBSScene = useCallback((sceneName: string, sceneIndex: number) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "ADD_OBS_SCENE", sceneName, sceneIndex }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const assignSceneToRegion = useCallback((regionId: RegionId, sceneName: string, sceneIndex: number) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "ASSIGN_SCENE_TO_REGION", regionId, sceneName, sceneIndex }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const unassignSceneFromRegion = useCallback((regionId: RegionId) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "UNASSIGN_SCENE_FROM_REGION", regionId }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const updateRegion = useCallback((id: RegionId, changes: Partial<Region>) => {
    dispatch({ type: "UPDATE_REGION", regionId: id, changes }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const deleteSelected = useCallback(() => {
    if (state.selectedRegionIds.length > 0) {
      dispatch({ type: "SNAPSHOT" }); dispatch({ type: "DELETE_REGIONS", regionIds: state.selectedRegionIds }); scheduleAutoSave();
    }
  }, [state.selectedRegionIds, scheduleAutoSave]);

  const duplicateSelected = useCallback(() => {
    if (state.selectedRegionIds.length > 0) {
      dispatch({ type: "SNAPSHOT" }); dispatch({ type: "DUPLICATE_REGIONS", regionIds: state.selectedRegionIds }); scheduleAutoSave();
    }
  }, [state.selectedRegionIds, scheduleAutoSave]);

  const selectRegion = useCallback((id: RegionId, additive = false) => { dispatch({ type: "SELECT_REGION", regionId: id, additive }); }, []);
  const deselectAll = useCallback(() => { dispatch({ type: "DESELECT_ALL" }); }, []);

  const setBackground = useCallback((bg: Partial<BackgroundConfig>) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "SET_BACKGROUND", background: bg }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const updateSafeFrame = useCallback((changes: Partial<SafeFrameConfig>) => {
    dispatch({ type: "UPDATE_SAFE_FRAME", changes }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const resetCanvas = useCallback(() => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "RESET_CANVAS" }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const alignRegions = useCallback((axis: AlignAxis) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "ALIGN_REGIONS", axis }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const distributeRegions = useCallback((axis: DistributeAxis) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "DISTRIBUTE_REGIONS", axis }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const lockAll = useCallback(() => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "LOCK_ALL" }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const unlockAll = useCallback(() => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "UNLOCK_ALL" }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const selectNextRegion = useCallback(() => { dispatch({ type: "SELECT_NEXT_REGION" }); }, []);
  const selectPrevRegion = useCallback(() => { dispatch({ type: "SELECT_PREV_REGION" }); }, []);

  const renameRegion = useCallback((id: RegionId, name: string) => {
    dispatch({ type: "SNAPSHOT" }); dispatch({ type: "RENAME_REGION", regionId: id, name }); scheduleAutoSave();
  }, [scheduleAutoSave]);

  const undo = useCallback(() => { dispatch({ type: "UNDO" }); scheduleAutoSave(); }, [scheduleAutoSave]);
  const redo = useCallback(() => { dispatch({ type: "REDO" }); scheduleAutoSave(); }, [scheduleAutoSave]);

  return (
    <EditorContext.Provider value={{ state, dispatch, openLayout, closeLayout, addRegion, addOBSScene, assignSceneToRegion, unassignSceneFromRegion, updateRegion, deleteSelected, duplicateSelected, selectRegion, deselectAll, setBackground, updateSafeFrame, resetCanvas, alignRegions, distributeRegions, lockAll, unlockAll, selectNextRegion, selectPrevRegion, renameRegion, undo, redo, snapshot, save }}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside <EditorProvider>");
  return ctx;
}
