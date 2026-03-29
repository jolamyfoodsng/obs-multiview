/**
 * useLayoutStore — React Context providing global layout state.
 *
 * All Layout Settings UI controls bind to this state.
 * The ServiceMode overlay reads/writes via useLayoutStore().
 * When autoSync is on, a useEffect in ServiceMode pushes every change to OBS.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { type LayoutState, DEFAULT_LAYOUT_STATE } from "../services/layoutEngine";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface LayoutStoreContextValue {
    state: LayoutState;
    updateLayout: (partial: Partial<LayoutState>) => void;
    resetLayout: () => void;
}

const LayoutStoreContext = createContext<LayoutStoreContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function LayoutStoreProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<LayoutState>(DEFAULT_LAYOUT_STATE);

    const updateLayout = useCallback((partial: Partial<LayoutState>) => {
        console.log("[LayoutStore] Update:", partial);
        setState((prev) => ({ ...prev, ...partial }));
    }, []);

    const resetLayout = useCallback(() => {
        console.log("[LayoutStore] Reset to defaults");
        setState(DEFAULT_LAYOUT_STATE);
    }, []);

    return (
        <LayoutStoreContext.Provider value={{ state, updateLayout, resetLayout }}>
            {children}
        </LayoutStoreContext.Provider>
    );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLayoutStore(): LayoutStoreContextValue {
    const ctx = useContext(LayoutStoreContext);
    if (!ctx) {
        throw new Error("useLayoutStore must be used inside <LayoutStoreProvider>");
    }
    return ctx;
}
