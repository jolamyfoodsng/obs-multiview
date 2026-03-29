/**
 * dock-main.tsx — Standalone entry point for the OBS Browser Dock.
 *
 * This file is the entry for dock.html, which OBS loads directly in its
 * Custom Browser Dock feature. It renders DockPage without any of the
 * main app infrastructure (no HashRouter, no Tauri gates, no splash screen).
 *
 * URL in OBS: http://127.0.0.1:<overlay-port>/dock.html
 */

import React from "react";
import ReactDOM from "react-dom/client";
import DockPage from "./DockPage";
import { dockClient } from "../services/dockBridge";
import "./dock.css";

// Initialize BroadcastChannel before React renders so child components
// can immediately send/receive messages in their first useEffect cycle.
dockClient.init();

const el = document.getElementById("dock-root");
if (el) {
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <DockPage />
    </React.StrictMode>
  );
}
