/**
 * MVShell.tsx — Multi-View Editor Shell
 *
 * Top-level layout for the /multiview/* routes.
 * Sidebar navigation + OBS status + routed content area.
 */

import { useState, useEffect } from "react";
import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import { MVDashboard } from "./pages/MVDashboard";
import { MVEditor } from "./pages/MVEditor";
import { MVTemplates } from "./pages/MVTemplates";
import { MVSettings } from "./pages/MVSettings";
import { MVSceneSync } from "./pages/MVSceneSync";
import { obsService } from "../services/obsService";
import { ToastProvider } from "./components/MVToast";
import { useThemeSync } from "./components/MVThemeProvider";
import "./mv.css";
import Icon from "../components/Icon";

const NAV_ITEMS = [
  { to: "/multiview/dashboard", icon: "dashboard", label: "Dashboard" },
  { to: "/multiview/scenes", icon: "cast_connected", label: "Scenes & Output" },
  { to: "/multiview/templates", icon: "auto_awesome_mosaic", label: "Templates" },
  { to: "/multiview/settings", icon: "settings", label: "Settings" },
] as const;

export function MVShell() {
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  useThemeSync();

  useEffect(() => {
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
    return unsub;
  }, []);

  return (
    <ToastProvider>
    <div className="mv-shell" role="application" aria-label="Multi-View Editor">
      {/* Skip navigation link for keyboard users */}
      <a className="mv-skip-link" href="#mv-main-content">Skip to content</a>

      {/* ── Sidebar ── */}
      <nav className="mv-sidebar" aria-label="Multi-View navigation">
        <div className="mv-sidebar-brand" aria-hidden="true">
          <Icon name="grid_view" size={24} />
          <span className="mv-sidebar-title">Multi-View</span>
        </div>

        {/* OBS Status */}
        <div className="mv-sidebar-obs-status" role="status" aria-live="polite" aria-label={obsConnected ? "OBS Connected" : "OBS Disconnected"}>
          <span
            className={`mv-obs-dot ${obsConnected ? "mv-obs-dot--connected" : ""}`}
            aria-hidden="true"
          />
          <span className="mv-obs-label">
            {obsConnected ? "OBS Connected" : "OBS Disconnected"}
          </span>
        </div>

        <div className="mv-sidebar-nav" role="list">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="listitem"
              className={({ isActive }) =>
                `mv-nav-item ${isActive ? "mv-nav-item--active" : ""}`
              }
              aria-current={undefined} // react-router sets aria-current="page" automatically
            >
              <Icon name={item.icon} size={20} className="mv-nav-icon" />
              <span className="mv-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="mv-sidebar-footer">
          <NavLink to="/" className="mv-nav-item mv-nav-item--back">
            <Icon name="arrow_back" size={20} className="mv-nav-icon" />
            <span className="mv-nav-label">Back to Switcher</span>
          </NavLink>
        </div>
      </nav>

      {/* ── Content Area ── */}
      <main id="mv-main-content" className="mv-content" role="main">
        <Routes>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<MVDashboard />} />
          <Route path="edit/:layoutId" element={<MVEditor />} />
          <Route path="new" element={<MVEditor />} />
          <Route path="scenes" element={<MVSceneSync />} />
          <Route path="templates" element={<MVTemplates />} />
          <Route path="settings" element={<MVSettings />} />
        </Routes>
      </main>
    </div>
    </ToastProvider>
  );
}
