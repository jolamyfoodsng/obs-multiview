/**
 * AppShell.tsx — Top-level navigation shell
 *
 * Switched from sidebar to a top navigation bar (header tabs).
 * The header persists across all pages; full-screen routes bypass it.
 *
 * When a service is active (preparing/preservice/live), the normal
 * nav tabs are hidden and replaced with a service-mode bar:
 *   Logo circle + Cancel + Go Live / End Service
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { obsService } from "./services/obsService";
import { serviceStore } from "./services/serviceStore";
import {
  SHORTCUTS,
  shortcutLabel,
  type ShortcutCategory,
} from "./multiview/shortcuts";
import { useServiceStore } from "./hooks/useServiceStore";
import { AppLogo } from "./components/AppLogo";
import { useAppTheme } from "./hooks/useAppTheme";
import { ServiceCompletedModal } from "./components/ServiceCompletedModal";
import Icon from "./components/Icon";

// ---------------------------------------------------------------------------
// Menu dropdown types & data
// ---------------------------------------------------------------------------

interface MenuDropdownItem {
  label?: string;
  icon?: string;
  action?: () => void;
  divider?: boolean;
  shortcut?: string;
}

interface MenuDropdownDef {
  triggerLabel: string;
  triggerIcon: string;
  items: MenuDropdownItem[];
}

/**
 * Inline dropdown used by the service-mode menu bar.
 * Opens on click, closes on outside click or Escape.
 */
function MenuDropdown({ def }: { def: MenuDropdownDef }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="app-topnav-dropdown-wrap" ref={ref}>
      <button
        className={`app-topnav-menu-item${open ? " app-topnav-menu-item--open" : ""}`}
        role="menuitem"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={def.triggerIcon} size={16} />
        <span>{def.triggerLabel}</span>
        <Icon name="expand_more" size={14} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div className="app-topnav-dropdown">
          {def.items.map((item, i) =>
            item.divider ? (
              <div key={`d-${i}`} className="app-topnav-dropdown-divider" />
            ) : (
              <button
                key={item.label}
                className="app-topnav-dropdown-action"
                onClick={() => { item.action?.(); setOpen(false); }}
              >
                {item.icon && (
                  <Icon name={item.icon} size={16} />
                )}
                <span>{item.label}</span>
                {item.shortcut && (
                  <kbd className="app-topnav-dropdown-kbd">{item.shortcut}</kbd>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

const NAV_ITEMS: ReadonlyArray<{ to: string; icon: string; label: string; end?: boolean }> = [
  { to: "/", icon: "home", label: "Home", end: true },
  { to: "/service-planner", icon: "event_note", label: "Planner" },
  { to: "/resources", icon: "library_books", label: "Resources" },
  { to: "/speech-to-scripture", icon: "mic", label: "Speech" },
  { to: "/production/themes", icon: "palette", label: "Themes" },
  { to: "/settings", icon: "settings", label: "Settings" },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [, setObsConnected] = useState(obsService.status === "connected");
  const { effective, setTheme } = useAppTheme();
  const svc = useServiceStore();

  const isServiceActive = svc.status !== "idle" && svc.status !== "ended";
  const isServiceEnded = svc.status === "ended";
  const currentSectionLabel = useMemo(() => {
    if (location.pathname.startsWith("/resources")) return "Resources";
    if (location.pathname.startsWith("/service-planner")) return "Service Planner";
    if (location.pathname.startsWith("/speech-to-scripture")) return "Speech to Scripture";
    if (location.pathname.startsWith("/production/themes")) return "Production Themes";
    if (location.pathname.startsWith("/settings")) return "Settings";
    if (location.pathname.startsWith("/dev")) return "Developer";
    return "Production Home";
  }, [location.pathname]);

  // ── End-service confirmation modal ──
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // ── Shortcuts modal ──
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Tab definitions for the shortcuts modal
  type ShortcutsTab = "dashboard" | "bible" | "graphics" | "ticker";
  const SHORTCUTS_TABS: { key: ShortcutsTab; label: string; icon: string; categories: ShortcutCategory[] }[] = [
    { key: "dashboard", label: "Dashboard", icon: "dashboard", categories: ["navigation", "file", "edit", "selection", "view", "canvas", "slots", "alignment"] },
    { key: "bible", label: "Bible", icon: "menu_book", categories: ["bible"] },
    { key: "graphics", label: "Graphics", icon: "palette", categories: ["lowerthirds", "quickmerge", "worship"] },
    { key: "ticker", label: "Ticker", icon: "text_rotation_none", categories: ["ticker"] },
  ];
  const [shortcutsTab, setShortcutsTab] = useState<ShortcutsTab>("dashboard");

  useEffect(() => {
    const unsub = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
    return unsub;
  }, []);

  // Full-screen routes (no header): editor, new layout, standalone bible
  const isEditorRoute =
    location.pathname.startsWith("/edit/") ||
    location.pathname.startsWith("/bible") ||
    location.pathname === "/new";

  // ── Service actions ──

  // ── Cancel confirmation modal ──
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleCancelService = useCallback(() => {
    setShowCancelConfirm(true);
  }, []);

  const handleConfirmCancel = useCallback(() => {
    setShowCancelConfirm(false);
    serviceStore.reset();
    navigate("/");
  }, [navigate]);

  const handleGoLive = useCallback(async () => {
    const mapping = serviceStore.sceneMapping;
    if (mapping.mainScene) {
      try {
        await obsService.setCurrentProgramScene(mapping.mainScene);
      } catch (e) {
        console.warn("[AppShell] Failed to switch OBS scene:", e);
      }
    }
    serviceStore.goLive();
    navigate("/");
  }, [navigate]);

  const handleEndServiceConfirm = useCallback(() => {
    serviceStore.endService();
    setShowEndConfirm(false);
  }, []);

  // ── Completed modal actions ──
  const handleStartNew = useCallback(() => {
    serviceStore.reset();
    navigate("/");
    // Small delay so dashboard renders, then open modal
    setTimeout(() => {
      // The dashboard will handle showing the modal via its own state
    }, 100);
  }, [navigate]);

  const handleReturnDashboard = useCallback(() => {
    serviceStore.reset();
    navigate("/");
  }, [navigate]);

  if (isEditorRoute) {
    return <Outlet />;
  }

  return (
    <div className="app-shell">
      {/* ── Top Navigation Header ── */}
      <header className={`app-topnav${isServiceActive ? " app-topnav--service-mode" : ""}`}>
        <div className="app-topnav-left">
          <div className="app-topnav-brand">
            <div className="app-topnav-logo">
              <AppLogo alt="OBS Church Studio" />
            </div>
            <div className="app-topnav-brand-copy">
              <span className="app-topnav-title">OBS Church Studio</span>
              {!isServiceActive && (
                <span className="app-topnav-section-label">{currentSectionLabel}</span>
              )}
            </div>
          </div>

          {!isServiceActive && (
            <>
              <div className="app-topnav-divider" />
              <nav className="app-topnav-tabs" role="tablist">
                {NAV_ITEMS.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) =>
                      `app-topnav-tab${isActive ? " is-active" : ""}`
                    }
                    role="tab"
                  >
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </nav>
            </>
          )}

          {/* Persistent menu items (visible in all modes) */}
          {isServiceActive && (
            <>
              <div className="app-topnav-divider" />
              <nav className="app-topnav-menu" role="menubar">
                <MenuDropdown def={{
                  triggerLabel: "File",
                  triggerIcon: "folder_open",
                  items: [
                    { label: "Production Home", icon: "home", shortcut: "⌘D", action: () => navigate("/") },
                    { label: "Settings", icon: "settings", shortcut: "⌘,", action: () => navigate("/settings") },
                    { divider: true },
                    { label: "Songs", icon: "music_note", shortcut: "⌘T", action: () => navigate("/resources") },
                    { label: "Production Themes", icon: "palette", shortcut: "⌘⇧T", action: () => navigate("/production/themes") },
                  ],
                }} />
                <MenuDropdown def={{
                  triggerLabel: "New",
                  triggerIcon: "add",
                  items: [
                    { label: "Theme Preset", icon: "palette", shortcut: "⌘N", action: () => navigate("/production/themes") },
                    { label: "Song Entry", icon: "music_note", shortcut: "⌘1", action: () => navigate("/resources") },
                    { label: "Bible Setup", icon: "menu_book", shortcut: "⌘2", action: () => navigate("/settings") },
                  ],
                }} />
                <button className="app-topnav-menu-item" role="menuitem" title="Keyboard shortcuts" onClick={() => setShowShortcuts(true)}>
                  <Icon name="keyboard" size={16} />
                  <span>Shortcuts</span>
                </button>
                <button className="app-topnav-menu-item" role="menuitem" title="Help & documentation">
                  <Icon name="help_outline" size={16} />
                  <span>Help</span>
                </button>
              </nav>
            </>
          )}
        </div>

        {/* Service-mode controls → top-right */}
        {isServiceActive && (
          <div className="app-topnav-right">
            <div className="service-nav-right">
              <button
                className="service-nav-btn service-nav-btn--cancel"
                onClick={handleCancelService}
              >
                Cancel
              </button>

              {(svc.status === "preparing" || svc.status === "preservice") && (
                <button
                  className="service-nav-btn service-nav-btn--go-live"
                  onClick={handleGoLive}
                >
                  <Icon name="play_arrow" size={20} />
                  Go Live
                </button>
              )}

              {svc.status === "live" && (
                <button
                  className="service-nav-btn service-nav-btn--end"
                  onClick={() => setShowEndConfirm(true)}
                >
                  <Icon name="stop" size={20} />
                  End Service
                </button>
              )}
            </div>
          </div>
        )}

        {!isServiceActive && (
          <div className="app-topnav-right">
            {/* OBS Status */}


            {/* Theme Toggle */}
            <button
              className="app-topnav-theme-btn"
              onClick={() => setTheme(effective === "dark" ? "light" : "dark")}
              title={`Switch to ${effective === "dark" ? "light" : "dark"} mode`}
            >
              <Icon name={effective === "dark" ? "light_mode" : "dark_mode"} size={20} />
            </button>

            <button
              className="app-topnav-icon-btn"
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              onClick={() => setShowShortcuts(true)}
            >
              <Icon name="keyboard" size={18} />
            </button>
          </div>
        )}
      </header>

      {/* ── Content Area ── */}
      <main className="app-content">
        <Outlet />
      </main>

      {/* ── End Service Confirmation ── */}
      {showEndConfirm && (
        <div className="end-confirm-backdrop" onClick={() => setShowEndConfirm(false)}>
          <div className="end-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>End Service?</h2>
            <p>Are you sure you want to end the current service? This cannot be undone.</p>
            <div className="end-confirm-actions">
              <button
                className="end-confirm-btn-cancel"
                onClick={() => setShowEndConfirm(false)}
              >
                Keep Going
              </button>
              <button className="end-confirm-btn-end" onClick={handleEndServiceConfirm}>
                End Service
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Service Confirmation ── */}
      {showCancelConfirm && (
        <div className="end-confirm-backdrop" onClick={() => setShowCancelConfirm(false)}>
          <div className="end-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Cancel Service?</h2>
            <p>Are you sure you want to cancel? All pre-service progress will be lost and you'll return to the dashboard.</p>
            <div className="end-confirm-actions">
              <button
                className="end-confirm-btn-cancel"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep Going
              </button>
              <button className="end-confirm-btn-end" onClick={handleConfirmCancel}>
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Service Completed Modal ── */}
      <ServiceCompletedModal
        open={isServiceEnded}
        duration={svc.getFormattedDuration()}
        bibleVerses={svc.stats.bibleVersesDisplayed}
        songsPlayed={svc.stats.songsPlayed}
        lowerThirds={svc.stats.lowerThirdsShown}
        onStartNew={handleStartNew}
        onDashboard={handleReturnDashboard}
      />

      {/* ── Keyboard Shortcuts Modal (Tabbed) ── */}
      {showShortcuts && (
        <div className="end-confirm-backdrop" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-head">
              <h2>Keyboard Shortcuts</h2>
              <button className="shortcuts-modal-close" onClick={() => setShowShortcuts(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div className="shortcuts-modal-tabs">
              {SHORTCUTS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`shortcuts-modal-tab${shortcutsTab === tab.key ? " is-active" : ""}`}
                  onClick={() => setShortcutsTab(tab.key)}
                >
                  <Icon name={tab.icon} size={14} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="shortcuts-modal-body">
              {(() => {
                const activeTab = SHORTCUTS_TABS.find((t) => t.key === shortcutsTab)!;
                return activeTab.categories.map((cat) => {
                  const items = SHORTCUTS.filter((s) => s.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <div className="shortcuts-modal-section" key={cat}>
                      <h4>{
                        cat === "navigation" ? "Navigation" :
                          cat === "file" ? "File" :
                            cat === "edit" ? "Edit" :
                              cat === "selection" ? "Selection" :
                                cat === "view" ? "View & Zoom" :
                                  cat === "canvas" ? "Canvas & Grid" :
                                    cat === "slots" ? "Slots" :
                                      cat === "alignment" ? "Alignment" :
                                        cat === "bible" ? "Bible" :
                                          cat === "lowerthirds" ? "Lower Thirds" :
                                            cat === "quickmerge" ? "Quick Merge" :
                                              cat === "worship" ? "Speaker" :
                                                cat === "ticker" ? "Ticker" : cat
                      }</h4>
                      {items.map((s) => (
                        <div className="shortcuts-modal-row" key={s.id}>
                          <span>{s.label}</span>
                          <kbd>{shortcutLabel(s.keys)}</kbd>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
