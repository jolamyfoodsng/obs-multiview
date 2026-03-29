/**
 * overlayUrl.ts — Overlay base URL for OBS browser sources
 *
 * In production, the Tauri app runs a tiny HTTP server on localhost
 * that serves overlay HTML files. OBS browser sources can't access
 * Tauri's internal protocol (tauri:// or https://tauri.localhost),
 * so we need a real localhost URL.
 *
 * In development (Vite dev server), we just use window.location.origin
 * since Vite already serves the public/ files.
 */

import { invoke } from "@tauri-apps/api/core";

let _cachedBaseUrl: string | null = null;

/**
 * Get the base URL for overlay HTML files that OBS can access.
 *
 * - Production: http://127.0.0.1:<port> (served by Tauri's embedded HTTP server)
 * - Development: http://localhost:1420 (served by Vite)
 */
export async function getOverlayBaseUrl(): Promise<string> {
  if (_cachedBaseUrl) return _cachedBaseUrl;

  try {
    const port = await invoke<number>("get_overlay_port");
    if (port > 0) {
      _cachedBaseUrl = `http://127.0.0.1:${port}`;
      console.log(`[OverlayURL] Using overlay server at ${_cachedBaseUrl}`);
      return _cachedBaseUrl;
    }
  } catch (err) {
    console.warn("[OverlayURL] Failed to get overlay port from Tauri, falling back to window.location.origin:", err);
  }

  // Fallback: use current origin (works in dev with Vite)
  _cachedBaseUrl = window.location.origin;
  return _cachedBaseUrl;
}

/**
 * Synchronous getter — returns the cached base URL.
 * Returns window.location.origin if not yet resolved.
 * Call getOverlayBaseUrl() first to ensure it's initialized.
 */
export function getOverlayBaseUrlSync(): string {
  return _cachedBaseUrl || window.location.origin;
}

/**
 * Initialize the overlay URL cache. Call this once at app startup.
 */
export async function initOverlayUrl(): Promise<void> {
  await getOverlayBaseUrl();
}
