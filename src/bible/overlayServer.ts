/**
 * overlayServer.ts — Local WebSocket + HTTP server for Bible overlays
 *
 * Runs inside the Tauri app (renderer process) using a simple approach:
 * Since we can't run a real HTTP server from the renderer, we use a
 * "shared state" approach:
 *
 * 1. The Bible module writes current slide data to a well-known JSON file
 *    OR uses BroadcastChannel for same-origin overlay windows
 * 2. For OBS Browser Sources, we write to localStorage + use a polling
 *    endpoint served by Vite's dev server (or Tauri's asset protocol)
 *
 * For production: The overlay HTML files poll a JSON file or use
 * the Tauri localhost server.
 *
 * This module manages the overlay state and broadcasts it.
 */

import type { BibleSlide, BibleThemeSettings } from "./types";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";

// ---------------------------------------------------------------------------
// Overlay data packet (what gets sent to overlay HTML)
// ---------------------------------------------------------------------------

export interface OverlayPacket {
  slide: BibleSlide | null;
  theme: BibleThemeSettings | null;
  live: boolean;
  blanked: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Singleton overlay broadcaster
// ---------------------------------------------------------------------------

class OverlayBroadcaster {
  private channel: BroadcastChannel | null = null;
  private currentPacket: OverlayPacket = {
    slide: null,
    theme: null,
    live: false,
    blanked: false,
    timestamp: Date.now(),
  };
  private listeners = new Set<(packet: OverlayPacket) => void>();

  constructor() {
    // Use BroadcastChannel for same-origin overlay windows
    try {
      this.channel = new BroadcastChannel("obs-church-studio-bible-overlay");
    } catch {
      console.warn("BroadcastChannel not available");
    }
  }

  /**
   * Update the current overlay state and broadcast to all listeners.
   */
  send(packet: Partial<OverlayPacket>) {
    this.currentPacket = {
      ...this.currentPacket,
      ...packet,
      timestamp: Date.now(),
    };

    // Broadcast via BroadcastChannel
    try {
      this.channel?.postMessage(this.currentPacket);
    } catch {
      // Channel might be closed
    }

    // Store in localStorage for polling-based overlays
    try {
      localStorage.setItem(
        "bible-overlay-data",
        JSON.stringify(this.currentPacket)
      );
    } catch {
      // Storage might be full
    }

    // Notify internal listeners
    for (const listener of this.listeners) {
      try {
        listener(this.currentPacket);
      } catch (e) {
        console.error("Overlay listener error:", e);
      }
    }
  }

  /**
   * Send a slide update.
   */
  pushSlide(
    slide: BibleSlide | null,
    theme: BibleThemeSettings | null,
    live: boolean,
    blanked: boolean
  ) {
    this.send({ slide, theme, live, blanked });
  }

  /**
   * Clear the overlay (show nothing).
   */
  clear() {
    this.send({ slide: null, live: false, blanked: false });
  }

  /**
   * Blank the screen (keep content but hide it).
   */
  blank() {
    this.send({ blanked: true });
  }

  /**
   * Unblank the screen.
   */
  unblank() {
    this.send({ blanked: false });
  }

  /**
   * Get the current overlay state.
   */
  getCurrent(): OverlayPacket {
    return { ...this.currentPacket };
  }

  /**
   * Subscribe to overlay updates.
   */
  subscribe(listener: (packet: OverlayPacket) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get the URL for the overlay that OBS should load.
   */
  getOverlayUrl(templateType: "fullscreen" | "lower-third" = "fullscreen"): string {
    // In dev, served by Vite; in production, by Tauri's embedded localhost server
    const base = getOverlayBaseUrlSync();
    return `${base}/bible-overlay-${templateType}.html`;
  }

  destroy() {
    this.channel?.close();
    this.listeners.clear();
  }
}

// Singleton
export const overlayBroadcaster = new OverlayBroadcaster();
