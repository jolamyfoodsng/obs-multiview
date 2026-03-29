import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MVLayout } from "../types";
import * as db from "../mvStore";
import { TEMPLATE_LIBRARY } from "../templates";
import { obsService, type OBSInput, type OBSScene } from "../../services/obsService";
import Icon from "../../components/Icon";

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(sinceTs: number | null, nowTs: number): string {
  if (!sinceTs) return "00h 00m";
  const totalMinutes = Math.max(0, Math.floor((nowTs - sinceTs) / 60000));
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hrs).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
}

function formatConnectedAt(sinceTs: number | null): string {
  if (!sinceTs) return "Not connected";
  return new Date(sinceTs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MVDashboard() {
  const navigate = useNavigate();

  const [layouts, setLayouts] = useState<MVLayout[]>([]);
  const [loadingLayouts, setLoadingLayouts] = useState(true);

  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const [currentScene, setCurrentScene] = useState<string | null>(null);
  const [obsScenes, setObsScenes] = useState<OBSScene[]>([]);
  const [videoInputs, setVideoInputs] = useState<OBSInput[]>([]);

  const [connectedAt, setConnectedAt] = useState<number | null>(
    obsService.status === "connected" ? Date.now() : null,
  );
  const [lastNowTick, setLastNowTick] = useState(Date.now());

  const [checkState, setCheckState] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [checkMessage, setCheckMessage] = useState<string>("");

  const websocketUrl = useMemo(() => db.getSettings().obsUrl, []);

  const loadLayouts = useCallback(async () => {
    setLoadingLayouts(true);
    try {
      const all = await db.getUserLayouts();
      setLayouts(all);
    } catch {
      setLayouts([]);
    } finally {
      setLoadingLayouts(false);
    }
  }, []);

  const refreshObsState = useCallback(async () => {
    if (!obsService.isConnected) {
      setCurrentScene(null);
      setObsScenes([]);
      setVideoInputs([]);
      return;
    }

    const [scene, scenes, inputs] = await Promise.all([
      obsService.getCurrentProgramScene().catch(() => null),
      obsService.getSceneList().catch(() => [] as OBSScene[]),
      obsService.getInputList().catch(() => [] as OBSInput[]),
    ]);

    setCurrentScene(scene);
    setObsScenes(scenes);
    setVideoInputs(
      inputs.filter((input) =>
        [
          "dshow_input",
          "v4l2_input",
          "av_capture_input",
          "window_capture",
          "screen_capture",
        ].includes(input.inputKind) ||
        [
          "dshow_input",
          "v4l2_input",
          "av_capture_input",
        ].includes(input.unversionedInputKind),
      ),
    );
  }, []);

  useEffect(() => {
    loadLayouts();
  }, [loadLayouts]);

  useEffect(() => {
    const unsubscribe = obsService.onStatusChange((status) => {
      const connected = status === "connected";
      setObsConnected(connected);
      if (connected) {
        setConnectedAt(Date.now());
      } else {
        setConnectedAt(null);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!obsConnected) {
      setCurrentScene(null);
      setObsScenes([]);
      setVideoInputs([]);
      return;
    }

    refreshObsState();
    const timer = setInterval(refreshObsState, 5000);
    return () => clearInterval(timer);
  }, [obsConnected, refreshObsState]);

  useEffect(() => {
    const timer = setInterval(() => setLastNowTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const runPreServiceCheck = useCallback(async () => {
    setCheckState("running");
    setCheckMessage("Running checks…");
    try {
      await Promise.all([refreshObsState(), loadLayouts()]);
      if (obsService.isConnected) {
        setCheckState("ok");
        setCheckMessage("Pre-service check passed.");
      } else {
        setCheckState("error");
        setCheckMessage("OBS is not connected.");
      }
    } catch {
      setCheckState("error");
      setCheckMessage("Pre-service check failed.");
    }
  }, [loadLayouts, refreshObsState]);

  const recentLayouts = useMemo(() => layouts.slice(0, 4), [layouts]);
  const recentTemplates = useMemo(() => TEMPLATE_LIBRARY.slice(0, 4), []);

  const activeLayout = recentLayouts[0]?.name ?? "No layout selected";
  const engineStatus = obsConnected ? "Ready" : "Offline";

  return (
    <div className="mv-page mv-dashboard-v2">
      <main className="mv-dashboard-v2-shell">
        <section className="mv-dash-status-head">
          <div>
            <h1 className="mv-dash-status-title">System Status</h1>
            <p className="mv-dash-status-subtitle">
              Monitor your broadcast engine and prepare for service.
            </p>
          </div>
          <div className="mv-dash-health-chip">
            <span className="mv-dash-health-dot" />
            <span>{obsConnected ? "System Healthy" : "System Attention Needed"}</span>
          </div>
        </section>

        <section className="mv-dash-grid">
          <div className="mv-dash-grid-main">
            <article className="mv-dash-card mv-dash-quick-card mv-dash-quick-card--primary">
              <h2 className="mv-dash-card-title">Quick Actions</h2>

              <div className="mv-dash-quick-actions">
                <button className="mv-dash-primary-btn" onClick={() => navigate("/service-hub")}>
                  <Icon name="rocket_launch" size={20} />
                  Open Service Control Hub
                </button>

                <button className="mv-dash-secondary-btn" onClick={runPreServiceCheck}>
                  <Icon name="playlist_play" size={20} />
                  {checkState === "running" ? "Running Pre-Service Check" : "Run Pre-Service Check"}
                </button>

                <button className="mv-dash-secondary-btn" onClick={() => navigate("/new")}>
                  <Icon name="add_box" size={20} />
                  Create New Layout
                </button>
              </div>

              <div className="mv-dash-module-shortcuts">
                <div className="mv-dash-module-shortcuts-title">Live Module Shortcuts</div>
                <div className="mv-dash-module-shortcuts-grid">
                  <button
                    className="mv-dash-tertiary-btn"
                    onClick={() => navigate("/hub?mode=live&tab=bible")}
                    title="Open Bible in Service Hub"
                  >
                    <Icon name="menu_book" size={20} />
                    Open Bible
                  </button>

                  <button
                    className="mv-dash-tertiary-btn"
                    onClick={() => navigate("/hub?mode=live&tab=worship")}
                    title="Open Worship in Service Hub"
                  >
                    <Icon name="music_note" size={20} />
                    Open Worship
                  </button>

                  <button
                    className="mv-dash-tertiary-btn"
                    onClick={() => navigate("/hub?mode=live&tab=graphics")}
                    title="Create announcement in Graphics"
                  >
                    <Icon name="campaign" size={20} />
                    Create Announcement
                  </button>
                </div>
              </div>

              {checkMessage && (
                <div className={`mv-dash-check-note is-${checkState}`}>
                  {checkMessage}
                </div>
              )}
            </article>
          </div>

          <aside className="mv-dash-grid-side mv-dash-grid-side--status">
            <article className="mv-dash-card">
              <div className="mv-dash-card-head">
                <div className="mv-dash-card-title-wrap">
                  <div className="mv-dash-icon-ring">
                    <Icon name="wifi_tethering" size={20} />
                  </div>
                  <div>
                    <h2 className="mv-dash-card-title">OBS Connection</h2>
                    <p className="mv-dash-card-meta">WebSocket</p>
                  </div>
                </div>
                <div className={`mv-dash-conn-pill${obsConnected ? " is-on" : ""}`}>
                  <span className="mv-dash-conn-dot" />
                  <span>{obsConnected ? "Connected" : "Disconnected"}</span>
                </div>
              </div>

              <div className="mv-dash-stat-grid">
                <div className="mv-dash-stat-box">
                  <div className="mv-dash-stat-label">WebSocket URL</div>
                  <div className="mv-dash-stat-value mono">{websocketUrl}</div>
                </div>
                <div className="mv-dash-stat-box">
                  <div className="mv-dash-stat-label">Last Connected</div>
                  <div className="mv-dash-stat-value mono">{formatConnectedAt(connectedAt)}</div>
                </div>
                <div className="mv-dash-stat-box">
                  <div className="mv-dash-stat-label">Session Duration</div>
                  <div className="mv-dash-stat-value mono">{formatDuration(connectedAt, lastNowTick)}</div>
                </div>
              </div>

              <div className="mv-dash-card-actions">
                <button
                  className="mv-dash-link-btn"
                  disabled={!obsConnected}
                  onClick={() => {
                    obsService.disconnect().catch(() => {
                      // no-op
                    });
                  }}
                >
                  <Icon name="power_settings_new" size={20} />
                  Disconnect
                </button>
              </div>
            </article>

            <article className="mv-dash-card">
              <h2 className="mv-dash-card-title inline-title">
                <Icon name="monitor_heart" size={20} />
                Readiness Monitor
              </h2>

              <div className="mv-dash-readiness-grid">
                <div className="mv-dash-ready-box">
                  <div className="mv-dash-ready-label">Active Scene</div>
                  <div className="mv-dash-ready-value">{currentScene ?? "Not Available"}</div>
                  <div className="mv-dash-ready-meta">{obsScenes.length} scenes detected</div>
                </div>

                <div className="mv-dash-ready-box">
                  <div className="mv-dash-ready-label">Active Layout</div>
                  <div className="mv-dash-ready-value">{activeLayout}</div>
                  <div className="mv-dash-ready-meta">
                    {loadingLayouts ? "Loading layouts…" : `${layouts.length} layouts available`}
                  </div>
                </div>

                <div className="mv-dash-ready-box">
                  <div className="mv-dash-ready-label">Engine Status</div>
                  <div className={`mv-dash-ready-value ${obsConnected ? "is-ok" : "is-warn"}`}>
                    {engineStatus}
                  </div>
                  <div className="mv-dash-ready-meta">{videoInputs.length} video inputs online</div>
                </div>
              </div>
            </article>
          </aside>
        </section>

        <section className="mv-dash-section">
          <div className="mv-dash-section-head">
            <h2>Recent Templates</h2>
            <button className="mv-dash-view-all" onClick={() => navigate("/resources")}>
              View All
              <Icon name="arrow_forward" size={20} />
            </button>
          </div>

          <div className="mv-dash-template-grid">
            {recentTemplates.map((template) => (
              <button
                key={template.id}
                className="mv-dash-template-card"
                onClick={() => navigate("/resources")}
                title={`Open templates and use ${template.name}`}
              >
                <div
                  className="mv-dash-template-preview"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${template.accentColor}33 0%, var(--surface-dark) 100%)`,
                  }}
                >
                  <div className="mv-dash-template-overlay" />
                  <span className="mv-dash-template-chip">{template.category}</span>
                </div>
                <div className="mv-dash-template-body">
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="mv-dash-section">
          <div className="mv-dash-section-head">
            <h2>Recent Layouts</h2>
            <button className="mv-dash-view-all" onClick={() => navigate("/")}>
              Refresh
              <Icon name="refresh" size={20} />
            </button>
          </div>

          <div className="mv-dash-layout-grid">
            {loadingLayouts && (
              <div className="mv-dash-empty">Loading recent layouts…</div>
            )}

            {!loadingLayouts && recentLayouts.length === 0 && (
              <div className="mv-dash-empty">
                No layouts yet. Create one to get started.
              </div>
            )}

            {!loadingLayouts && recentLayouts.map((layout) => (
              <button
                key={layout.id}
                className="mv-dash-layout-card"
                onClick={() => navigate(`/edit/${layout.id}`)}
                title={`Open ${layout.name}`}
              >
                <div className="mv-dash-layout-top">
                  <h3>{layout.name}</h3>
                  <span>{layout.regions.length} regions</span>
                </div>
                <div className="mv-dash-layout-meta">Updated {timeAgo(layout.updatedAt)}</div>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
