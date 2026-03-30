/**
 * DashboardPage.tsx — Service Hub Dashboard
 *
 * Landing page:
 *   - Editorial hero with primary Service Hub CTA
 *   - Service module shortcuts
 *   - Quick configuration tools
 *   - OBS dock card + live status summary
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { obsService } from "../services/obsService";
import { serviceStore, type ServiceState } from "../services/serviceStore";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import Icon from "../components/Icon";

/** Recently opened item */
interface RecentItem {
  path: string;
  label: string;
  icon: string;
  timestamp: number;
}

const RECENT_KEY = "obs-studio-recent-opened";
const MAX_RECENT = 6;

function getRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

export function trackRecentOpen(path: string, label: string, icon: string) {
  const items = getRecentItems();
  const filtered = items.filter((i) => i.path !== path);
  filtered.unshift({ path, label, icon, timestamp: Date.now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT)));
}

function formatServiceStatus(status: ServiceState["status"]): string {
  switch (status) {
    case "preparing":
      return "Preparing";
    case "preservice":
      return "Pre-Service";
    case "live":
      return "Live";
    case "ended":
      return "Completed";
    case "idle":
    default:
      return "Idle";
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [dockCopied, setDockCopied] = useState(false);
  const [serviceState, setServiceState] = useState<ServiceState>(() => serviceStore.getState());
  const [obsConnected, setObsConnected] = useState(() => obsService.isConnected);
  const [renderTimeMs, setRenderTimeMs] = useState<number | null>(null);

  // In dev, Vite serves the SPA at localhost:1420 (with SPA fallback routing)
  // so /dock works because Vite proxies it to dock.html via the multi-page config.
  // In production, the overlay HTTP server serves static files from dist/ —
  // we must use /dock.html explicitly because the server doesn't have Vite's
  // SPA-style routing for multi-page entries.
  const dockUrl = useMemo(() => {
    const isDev = window.location.protocol === "http:" && window.location.port === "1420";
    const base = isDev ? window.location.origin : getOverlayBaseUrlSync();
    // Dev: /dock (Vite handles it). Prod: /dock.html (static file).
    return isDev ? `${base}/dock` : `${base}/dock.html`;
  }, []);

  const handleCopyDockUrl = useCallback(() => {
    navigator.clipboard.writeText(dockUrl).then(() => {
      setDockCopied(true);
      setTimeout(() => setDockCopied(false), 2000);
    });
  }, [dockUrl]);

  useEffect(() => {
    return serviceStore.subscribe((state) => {
      setServiceState(state);
    });
  }, []);

  useEffect(() => {
    setObsConnected(obsService.isConnected);
    return obsService.onStatusChange((status) => {
      const connected = status === "connected";
      setObsConnected(connected);
      if (!connected) {
        setRenderTimeMs(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!obsConnected) {
      setRenderTimeMs(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof window.setTimeout> | null = null;

    const pollStats = async () => {
      try {
        const stats = await obsService.getStats();
        if (!cancelled) {
          setRenderTimeMs(stats.averageFrameRenderTime);
        }
      } catch {
        if (!cancelled) {
          setRenderTimeMs(null);
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(pollStats, 5000);
        }
      }
    };

    void pollStats();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [obsConnected]);

  const handleHeroClick = useCallback(() => {
    trackRecentOpen("/hub?mode=live", "Service Hub", "play_circle");
    navigate("/hub?mode=live");
  }, [navigate]);

  const handleModuleNav = useCallback(
    (path: string, label: string, icon: string) => {
      trackRecentOpen(path, label, icon);
      navigate(path);
    },
    [navigate]
  );

  const serviceActive =
    serviceState.status !== "idle" && serviceState.status !== "ended";

  const statusNotice = useMemo(() => {
    if (!obsConnected) {
      return {
        icon: "wifi_tethering",
        title: "Reconnect OBS",
        body: "OBS is currently disconnected. Reconnect to restore live module control and performance telemetry.",
      };
    }

    if (serviceActive) {
      return {
        icon: "bolt",
        title: "Service in Motion",
        body: `Tracking ${serviceState.stats.bibleVersesDisplayed} scripture cues, ${serviceState.stats.songsPlayed} songs, and ${serviceState.stats.lowerThirdsShown} live graphics in this session.`,
      };
    }

    return {
      icon: "info",
      title: "Ready for Direction",
      body: "Your environment is standing by. Open Service Hub to begin directing the next service.",
    };
  }, [obsConnected, serviceActive, serviceState.stats]);

  const renderTimeLabel = useMemo(() => {
    if (!obsConnected) return "Unavailable";
    if (renderTimeMs == null) return "Collecting";
    return renderTimeMs >= 10
      ? `${renderTimeMs.toFixed(0)} ms`
      : `${renderTimeMs.toFixed(1)} ms`;
  }, [obsConnected, renderTimeMs]);

  return (
    <div className="dash-page">
      <main className="dash-main">
        <div className="dash-glow" />
        <div className="dash-content">
    

          <section className="dash-modules-grid" aria-label="Service modules">
            <button
              className="dash-mod-card"
              onClick={() => handleModuleNav("/hub?mode=live&tab=bible", "Bible", "menu_book")}
            >
              <div className="dash-mod-icon dash-mod-icon--bible">
                <Icon name="menu_book" size={24} />
              </div>
              <div className="dash-mod-info">
                <h2>Display Scripture</h2>
                <p>Broadcast selected biblical texts to all active output displays with one click.</p>
              </div>
            </button>
            <button
              className="dash-mod-card"
              onClick={() => handleModuleNav("/hub?mode=live&tab=worship", "Worship", "music_note")}
            >
              <div className="dash-mod-icon dash-mod-icon--worship">
                <Icon name="music_note" size={10} style={{width:'12px', height:'12px'}} />
              </div>
              <div className="dash-mod-info">
                <h2>Start Song</h2>
                <p>Initiate the current setlist item and synchronize lyrics across the production network.</p>
              </div>
            </button>
            <button
              className="dash-mod-card"
              onClick={() => handleModuleNav("/hub?mode=live&tab=graphics", "Announcements", "campaign")}
            >
              <div className="dash-mod-icon dash-mod-icon--announce">
                <Icon name="campaign" size={24} />
              </div>
              <div className="dash-mod-info">
                <h2>Show Announcement</h2>
                <p>Push automated event slides or custom message overlays to the live stream.</p>
              </div>
            </button>
          </section>

          <section className="dash-home-grid">
            <div className="dash-home-primary">
              <section className="dash-section">
                <div className="dash-section-heading">
                  <span className="dash-section-rule" />
                  <h3>Quick Configuration</h3>
                </div>
                <div className="dash-action-list">
                  <button
                    className="dash-action-card"
                    onClick={() => handleModuleNav("/templates/studio", "Create New Layout", "grid_view")}
                  >
                    <div className="dash-action-copy">
                      <div className="dash-action-icon">
                        <Icon name="grid_view" size={18} />
                      </div>
                      <div>
                        <h4>Create New Layout</h4>
                        <p>Design a bespoke canvas for multi-screen projection.</p>
                      </div>
                    </div>
                    <Icon name="chevron_right" size={18} className="dash-action-chevron" />
                  </button>
                  <button
                    className="dash-action-card"
                    onClick={() => handleModuleNav("/hub/quick-merge", "Quick Merge", "merge_type")}
                  >
                    <div className="dash-action-copy">
                      <div className="dash-action-icon">
                        <Icon name="merge_type" size={18} />
                      </div>
                      <div>
                        <h4>Open Quick Merge</h4>
                        <p>Sync database updates with your local repository.</p>
                      </div>
                    </div>
                    <Icon name="chevron_right" size={18} className="dash-action-chevron" />
                  </button>
                </div>
              </section>
            </div>

            <aside className="dash-home-sidebar">
              <section className="dash-dock-card">
                <div className="dash-dock-backdrop">
                  <Icon name="dock" size={88} />
                </div>
                <div className="dash-dock-body">
                  <div className={`dash-dock-badge${obsConnected ? " is-live" : ""}`}>
                    <span className="dash-dock-badge-dot" />
                    <span>{obsConnected ? "Live Connection" : "OBS Offline"}</span>
                  </div>
                  <div className="dash-dock-copy">
                    <h3>OBS Browser Dock</h3>
                    <p>
                      Integrate your service controls directly into OBS. Copy the local URL below and paste it into a new Browser Dock in OBS.
                    </p>
                  </div>
                  <div className="dash-dock-endpoint">
                    <label>Localhost Endpoint</label>
                    <div className="dash-dock-url-row">
                      <input
                        className="dash-dock-url-input"
                        type="text"
                        readOnly
                        value={dockUrl}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        className="dash-dock-copy-btn"
                        onClick={handleCopyDockUrl}
                        title="Copy dock URL"
                      >
                        <Icon name={dockCopied ? "check" : "content_copy"} size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
              <section className="dash-status-card">
                <div className="dash-section-heading dash-section-heading--compact">
                  <span className="dash-section-rule" />
                  <h3>Hub Status</h3>
                </div>
                <div className="dash-status-list">
                  <div className="dash-status-row">
                    <span>Service State</span>
                    <strong>{formatServiceStatus(serviceState.status)}</strong>
                  </div>
                  <div className="dash-status-row">
                    <span>OBS Connection</span>
                    <strong>{obsConnected ? "Connected" : "Disconnected"}</strong>
                  </div>
                  <div className="dash-status-row">
                    <span>Render Time</span>
                    <strong>{renderTimeLabel}</strong>
                  </div>
                </div>
                <div className="dash-status-note">
                  <div className="dash-status-note-icon">
                    <Icon name={statusNotice.icon} size={16} />
                  </div>
                  <div>
                    <h4>{statusNotice.title}</h4>
                    <p>{statusNotice.body}</p>
                  </div>
                </div>
              </section>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}
