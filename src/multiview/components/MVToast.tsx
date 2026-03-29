/**
 * MVToast.tsx — Lightweight toast notification system
 *
 * Usage:
 *   import { useToast, ToastContainer } from "./MVToast";
 *   const toast = useToast();
 *   toast.show("Layout saved!", "success");
 *
 * Place <ToastContainer /> once in the app shell.
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import Icon from "../../components/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  icon?: string;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, icon?: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: log to console if outside provider
    return { show: (msg, type) => console.log(`[Toast:${type ?? "info"}]`, msg) };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider + Container
// ---------------------------------------------------------------------------

const TOAST_DURATION = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, type: ToastType = "info", icon?: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, icon }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Toast container — fixed bottom-right */}
      {toasts.length > 0 && (
        <div className="mv-toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`mv-toast mv-toast--${t.type}`} onClick={() => dismiss(t.id)}>
              <Icon name={t.icon ?? defaultIcon(t.type)} size={20} className="mv-toast-icon" />
              <span className="mv-toast-msg">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function defaultIcon(type: ToastType): string {
  switch (type) {
    case "success": return "check_circle";
    case "error": return "error";
    case "warning": return "warning";
    case "info": return "info";
  }
}
