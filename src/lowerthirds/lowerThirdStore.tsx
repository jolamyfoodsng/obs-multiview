/**
 * lowerThirdStore.tsx — React Context + useReducer state for Lower Thirds
 *
 * Provides LowerThirdProvider and useLowerThird() hook.
 * Manages theme selection, variable values, and OBS source state.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
  type Dispatch,
} from "react";
import type { LowerThirdTheme, LTObsSource, LTSize, LTCustomStyle, LTFontSize, LTPosition, LTAnimationIn } from "./types";
import { getLTThemeById } from "./themes";
import { lowerThirdObsService } from "./lowerThirdObsService";
import { obsService } from "../services/obsService";
import { LT_DEFAULT_CUSTOM_STYLE } from "./types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface LTStoreState {
  /** Currently selected theme */
  selectedTheme: LowerThirdTheme | null;
  /** Current variable values */
  values: Record<string, string>;
  /** Current size option */
  size: LTSize;
  /** Independent font size override */
  fontSize: LTFontSize;
  /** Position on screen */
  position: LTPosition;
  /** Custom X/Y for drag (percentage 0-100) */
  customX: number;
  customY: number;
  /** Animation in type */
  animationIn: LTAnimationIn;
  /** Custom style overrides */
  customStyles: LTCustomStyle;
  /** Known OBS LT sources */
  obsSources: LTObsSource[];
  /** All real OBS scenes */
  obsScenes: { sceneName: string; sceneIndex: number; sceneUuid?: string }[];
  /** Whether we're currently sending to OBS */
  isSending: boolean;
  /** Whether overlay is live on OBS */
  isLive: boolean;
  /** Last error */
  error: string | null;
  /** Whether sources are being refreshed */
  isRefreshing: boolean;
  /** Timestamp of last successful send */
  lastSentAt: number | null;
}

const initialState: LTStoreState = {
  selectedTheme: null,
  values: {},
  size: "lg" as LTSize,
  fontSize: "md" as LTFontSize,
  position: "bottom-left" as LTPosition,
  customX: 2.5,
  customY: 92,
  animationIn: "slide-left" as LTAnimationIn,
  customStyles: { ...LT_DEFAULT_CUSTOM_STYLE },
  obsSources: [],
  obsScenes: [],
  isSending: false,
  isLive: false,
  error: null,
  isRefreshing: false,
  lastSentAt: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type LTAction =
  | { type: "SELECT_THEME"; theme: LowerThirdTheme }
  | { type: "SET_VALUE"; key: string; value: string }
  | { type: "SET_VALUES"; values: Record<string, string> }
  | { type: "SET_SIZE"; size: LTSize }
  | { type: "SET_FONT_SIZE"; fontSize: LTFontSize }
  | { type: "SET_POSITION"; position: LTPosition }
  | { type: "SET_CUSTOM_POS"; x: number; y: number }
  | { type: "SET_ANIMATION_IN"; animationIn: LTAnimationIn }
  | { type: "SET_CUSTOM_STYLE"; patch: Partial<LTCustomStyle> }
  | { type: "RESET_CUSTOM_STYLES" }
  | { type: "RESET_VALUES" }
  | { type: "SET_SOURCES"; sources: LTObsSource[] }
  | { type: "SET_SCENES"; scenes: { sceneName: string; sceneIndex: number; sceneUuid?: string }[] }
  | { type: "SET_SENDING"; sending: boolean }
  | { type: "SET_LIVE"; live: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_REFRESHING"; refreshing: boolean }
  | { type: "SET_LAST_SENT"; ts: number }
  | { type: "CLEAR" };

function reducer(state: LTStoreState, action: LTAction): LTStoreState {
  switch (action.type) {
    case "SELECT_THEME": {
      // When selecting a theme, initialize variable values with defaults
      // and sync custom styles from the theme's accent color
      const defaults: Record<string, string> = {};
      for (const v of action.theme.variables) {
        defaults[v.key] = v.defaultValue;
      }
      return {
        ...state,
        selectedTheme: action.theme,
        values: defaults,
        customStyles: {
          ...LT_DEFAULT_CUSTOM_STYLE,
          bgColor: "",
          textColor: "",
          accentColor: action.theme.accentColor || "",
          bgImage: "",
          bgImageOpacity: 1,
          heightPx: 0,
        },
        error: null,
      };
    }
    case "SET_VALUE":
      return { ...state, values: { ...state.values, [action.key]: action.value } };
    case "SET_VALUES":
      return { ...state, values: { ...state.values, ...action.values } };
    case "SET_SIZE":
      return { ...state, size: action.size };
    case "SET_FONT_SIZE":
      return { ...state, fontSize: action.fontSize };
    case "SET_POSITION":
      return { ...state, position: action.position };
    case "SET_CUSTOM_POS":
      return { ...state, customX: action.x, customY: action.y, position: "custom" as LTPosition };
    case "SET_ANIMATION_IN":
      return { ...state, animationIn: action.animationIn };
    case "SET_CUSTOM_STYLE":
      return { ...state, customStyles: { ...state.customStyles, ...action.patch } };
    case "RESET_CUSTOM_STYLES":
      return { ...state, customStyles: { ...LT_DEFAULT_CUSTOM_STYLE } };
    case "RESET_VALUES": {
      if (!state.selectedTheme) return state;
      const defaults: Record<string, string> = {};
      for (const v of state.selectedTheme.variables) {
        defaults[v.key] = v.defaultValue;
      }
      return { ...state, values: defaults };
    }
    case "SET_SOURCES":
      return { ...state, obsSources: action.sources };
    case "SET_SCENES":
      return { ...state, obsScenes: action.scenes };
    case "SET_SENDING":
      return { ...state, isSending: action.sending };
    case "SET_LIVE":
      return { ...state, isLive: action.live };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_REFRESHING":
      return { ...state, isRefreshing: action.refreshing };
    case "SET_LAST_SENT":
      return { ...state, lastSentAt: action.ts };
    case "CLEAR":
      return { ...initialState };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface LTContextValue {
  state: LTStoreState;
  dispatch: Dispatch<LTAction>;

  // Convenience actions
  selectTheme: (themeId: string) => void;
  setValue: (key: string, value: string) => void;
  setValues: (values: Record<string, string>) => void;
  setSize: (size: LTSize) => void;
  setFontSize: (fontSize: LTFontSize) => void;
  setPosition: (position: LTPosition) => void;
  setCustomPos: (x: number, y: number) => void;
  setAnimationIn: (animationIn: LTAnimationIn) => void;
  setCustomStyle: (patch: Partial<LTCustomStyle>) => void;
  resetCustomStyles: () => void;
  resetValues: () => void;
  refreshSources: () => Promise<void>;
  refreshScenes: () => Promise<void>;
  sendToAll: () => Promise<void>;
  sendToSpecific: (sourceName: string) => Promise<void>;
  sendToScene: (sceneName: string) => Promise<void>;
  blankAll: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const LTContext = createContext<LTContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function LowerThirdProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Restore live state from service on mount
  useEffect(() => {
    const liveState = lowerThirdObsService.getLiveState();
    if (liveState.themeId) {
      const theme = getLTThemeById(liveState.themeId);
      if (theme) {
        dispatch({ type: "SELECT_THEME", theme });
        if (Object.keys(liveState.values).length > 0) {
          dispatch({ type: "SET_VALUES", values: liveState.values });
        }
        if (liveState.size) {
          dispatch({ type: "SET_SIZE", size: liveState.size });
        }
        if (liveState.customStyles) {
          dispatch({ type: "SET_CUSTOM_STYLE", patch: liveState.customStyles });
        }
        dispatch({ type: "SET_LIVE", live: liveState.isLive });
      }
    }
  }, []);

  // Refresh sources + scenes when OBS connection changes
  useEffect(() => {
    const unsubscribe = obsService.onStatusChange((status) => {
      if (status === "connected") {
        refreshSources();
        refreshScenes();
      } else {
        dispatch({ type: "SET_SOURCES", sources: [] });
        dispatch({ type: "SET_SCENES", scenes: [] });
      }
    });
    // Initial check
    if (obsService.isConnected) {
      refreshSources();
      refreshScenes();
    }
    return unsubscribe;
  }, []);

  const selectTheme = useCallback((themeId: string) => {
    const theme = getLTThemeById(themeId);
    if (theme) {
      dispatch({ type: "SELECT_THEME", theme });
    }
  }, []);

  const setValue = useCallback((key: string, value: string) => {
    dispatch({ type: "SET_VALUE", key, value });
  }, []);

  const setValues = useCallback((values: Record<string, string>) => {
    dispatch({ type: "SET_VALUES", values });
  }, []);

  const setSize = useCallback((size: LTSize) => {
    dispatch({ type: "SET_SIZE", size });
  }, []);

  const setFontSize = useCallback((fontSize: LTFontSize) => {
    dispatch({ type: "SET_FONT_SIZE", fontSize });
  }, []);

  const setPosition = useCallback((position: LTPosition) => {
    dispatch({ type: "SET_POSITION", position });
  }, []);

  const setCustomPos = useCallback((x: number, y: number) => {
    dispatch({ type: "SET_CUSTOM_POS", x, y });
  }, []);

  const setAnimationIn = useCallback((animationIn: LTAnimationIn) => {
    dispatch({ type: "SET_ANIMATION_IN", animationIn });
  }, []);

  const setCustomStyle = useCallback((patch: Partial<LTCustomStyle>) => {
    dispatch({ type: "SET_CUSTOM_STYLE", patch });
  }, []);

  const resetCustomStyles = useCallback(() => {
    dispatch({ type: "RESET_CUSTOM_STYLES" });
  }, []);

  const resetValues = useCallback(() => {
    dispatch({ type: "RESET_VALUES" });
  }, []);

  const refreshSources = useCallback(async () => {
    dispatch({ type: "SET_REFRESHING", refreshing: true });
    try {
      const sources = await lowerThirdObsService.discoverSources();
      dispatch({ type: "SET_SOURCES", sources });
    } catch (err) {
      console.warn("[LT-Store] Failed to refresh sources:", err);
    } finally {
      dispatch({ type: "SET_REFRESHING", refreshing: false });
    }
  }, []);

  const refreshScenes = useCallback(async () => {
    try {
      const scenes = await lowerThirdObsService.discoverScenes();
      dispatch({ type: "SET_SCENES", scenes });
    } catch (err) {
      console.warn("[LT-Store] Failed to refresh scenes:", err);
    }
  }, []);

  const sendToAll = useCallback(async () => {
    if (!state.selectedTheme) return;
    dispatch({ type: "SET_SENDING", sending: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const result = await lowerThirdObsService.pushToAll(
        state.selectedTheme,
        state.values,
        true,
        false,
        state.size,
        state.customStyles,
        state.fontSize,
        state.position,
        state.customX,
        state.customY,
        state.animationIn,
      );
      dispatch({ type: "SET_LIVE", live: true });
      dispatch({ type: "SET_LAST_SENT", ts: Date.now() });
      if (result.failed.length > 0) {
        dispatch({
          type: "SET_ERROR",
          error: `Failed to push to: ${result.failed.join(", ")}`,
        });
      }
      // Refresh sources to get updated state
      await refreshSources();
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", error: err.message || "Failed to send" });
    } finally {
      dispatch({ type: "SET_SENDING", sending: false });
    }
  }, [state.selectedTheme, state.values, state.size, state.customStyles, state.fontSize, state.position, state.customX, state.customY, state.animationIn, refreshSources]);

  const sendToSpecific = useCallback(async (sourceName: string) => {
    if (!state.selectedTheme) return;
    dispatch({ type: "SET_SENDING", sending: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      await lowerThirdObsService.sendToSpecific(
        sourceName,
        state.selectedTheme,
        state.values,
        state.size,
        state.customStyles,
        state.fontSize,
        state.position,
        state.customX,
        state.customY,
        state.animationIn,
      );
      dispatch({ type: "SET_LIVE", live: true });
      dispatch({ type: "SET_LAST_SENT", ts: Date.now() });
      await refreshSources();
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", error: err.message || "Failed to send" });
    } finally {
      dispatch({ type: "SET_SENDING", sending: false });
    }
  }, [state.selectedTheme, state.values, state.size, state.customStyles, state.fontSize, state.position, state.customX, state.customY, state.animationIn, refreshSources]);

  const sendToScene = useCallback(async (sceneName: string) => {
    if (!state.selectedTheme) return;
    dispatch({ type: "SET_SENDING", sending: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      await lowerThirdObsService.pushToScene(
        sceneName,
        state.selectedTheme,
        state.values,
        true,
        false,
        state.size,
        state.customStyles,
        state.fontSize,
        state.position,
        state.customX,
        state.customY,
        state.animationIn,
      );
      dispatch({ type: "SET_LIVE", live: true });
      dispatch({ type: "SET_LAST_SENT", ts: Date.now() });
      await refreshSources();
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", error: err.message || "Failed to send to scene" });
    } finally {
      dispatch({ type: "SET_SENDING", sending: false });
    }
  }, [state.selectedTheme, state.values, state.size, state.customStyles, state.fontSize, state.position, state.customX, state.customY, state.animationIn, refreshSources]);

  const blankAll = useCallback(async () => {
    dispatch({ type: "SET_SENDING", sending: true });
    try {
      await lowerThirdObsService.blankAll();
      dispatch({ type: "SET_LIVE", live: false });
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", error: err.message || "Failed to blank" });
    } finally {
      dispatch({ type: "SET_SENDING", sending: false });
    }
  }, []);

  const clearAll = useCallback(async () => {
    dispatch({ type: "SET_SENDING", sending: true });
    try {
      await lowerThirdObsService.clearAll();
      dispatch({ type: "SET_LIVE", live: false });
      dispatch({ type: "CLEAR" });
      await refreshSources();
    } catch (err: any) {
      dispatch({ type: "SET_ERROR", error: err.message || "Failed to clear" });
    } finally {
      dispatch({ type: "SET_SENDING", sending: false });
    }
  }, [refreshSources]);

  const value: LTContextValue = {
    state,
    dispatch,
    selectTheme,
    setValue,
    setValues,
    setSize,
    setFontSize,
    setPosition,
    setCustomPos,
    setAnimationIn,
    setCustomStyle,
    resetCustomStyles,
    resetValues,
    refreshSources,
    refreshScenes,
    sendToAll,
    sendToSpecific,
    sendToScene,
    blankAll,
    clearAll,
  };

  return <LTContext.Provider value={value}>{children}</LTContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLowerThird(): LTContextValue {
  const ctx = useContext(LTContext);
  if (!ctx) {
    throw new Error("useLowerThird must be used within a LowerThirdProvider");
  }
  return ctx;
}
