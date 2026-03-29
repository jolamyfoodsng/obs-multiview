/**
 * useAppTheme.ts — Centralized dark/light mode for the entire app
 *
 * Reads the preference from localStorage and applies the class to <html>.
 * All CSS variables in App.css inherit from :root / :root.light automatically.
 *
 * Usage: Call `useAppTheme()` once in App.tsx root.
 * To change theme: `setAppTheme("dark" | "light" | "system")`
 */

import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "obs-church-studio.theme-preference";

type ThemePref = "dark" | "light" | "system";

function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref;
}

function loadPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch {
    // ignore
  }
  return "dark";
}

function applyToDOM(effective: "dark" | "light") {
  const root = document.documentElement;
  if (effective === "light") {
    root.classList.add("light");
  } else {
    root.classList.remove("light");
  }
}

/** Immediately apply on module load (prevents flash) */
applyToDOM(resolveTheme(loadPref()));

// ---------- External store for cross-component reactivity ----------

let currentPref: ThemePref = loadPref();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentPref;
}

export function setAppTheme(pref: ThemePref) {
  currentPref = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore
  }
  applyToDOM(resolveTheme(pref));
  listeners.forEach((cb) => cb());
}

export function getEffectiveTheme(): "dark" | "light" {
  return resolveTheme(currentPref);
}

// ---------- React hook ----------

export function useAppTheme() {
  const pref = useSyncExternalStore(subscribe, getSnapshot);
  const effective = resolveTheme(pref);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      if (currentPref === "system") {
        applyToDOM(resolveTheme("system"));
        listeners.forEach((cb) => cb());
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Re-apply on pref changes
  useEffect(() => {
    applyToDOM(effective);
  }, [effective]);

  return {
    /** The user's saved preference: "dark" | "light" | "system" */
    preference: pref,
    /** The resolved/effective theme applied to the DOM */
    effective,
    /** Change the theme preference */
    setTheme: setAppTheme,
  };
}
