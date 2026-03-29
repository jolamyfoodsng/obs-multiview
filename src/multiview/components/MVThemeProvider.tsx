/**
 * MVThemeProvider.tsx — Theme system for dark/light/system modes + high contrast
 *
 * Reads the theme from MVSettings and applies CSS classes to <html>.
 * Also listens to system preference changes for "system" mode.
 */

import { useEffect } from "react";
import { getSettings } from "../mvStore";

/** Resolve effective theme ("dark" | "light") from settings */
function resolveTheme(pref: "dark" | "light" | "system"): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref;
}

/** Apply theme classes to <html> element */
function applyTheme(theme: "dark" | "light", highContrast: boolean): void {
  const root = document.documentElement;
  root.classList.remove("mv-theme-dark", "mv-theme-light", "mv-high-contrast");
  root.classList.add(`mv-theme-${theme}`);
  if (highContrast) root.classList.add("mv-high-contrast");
}

/**
 * Hook that syncs theme settings to the DOM.
 * Call this once in MVShell or App root.
 */
export function useThemeSync(): void {
  useEffect(() => {
    const settings = getSettings();
    const effective = resolveTheme(settings.theme);
    applyTheme(effective, settings.highContrast);

    // Listen for system theme changes (only matters if pref === "system")
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const s = getSettings();
      if (s.theme === "system") {
        applyTheme(resolveTheme("system"), s.highContrast);
      }
    };
    mq.addEventListener("change", handler);

    // Also listen for storage events (settings changed from another tab/component)
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "mv-settings") {
        const s = getSettings();
        applyTheme(resolveTheme(s.theme), s.highContrast);
      }
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      mq.removeEventListener("change", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
}

/**
 * Re-apply theme right now (call after settings update).
 * This is synchronous and immediate.
 */
export function refreshTheme(): void {
  const settings = getSettings();
  const effective = resolveTheme(settings.theme);
  applyTheme(effective, settings.highContrast);
}
