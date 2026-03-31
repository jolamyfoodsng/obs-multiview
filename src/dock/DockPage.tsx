/**
 * DockPage.tsx — OBS Browser Dock Control Panel
 *
 * Pre-release production mode keeps the dock focused on Bible and Worship.
 * Theme defaults come from the main app's Production Theme Settings page,
 * while the dock remains the only live control surface for preview/program.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { dockClient, type DockStateMessage } from "../services/dockBridge";
import { dockObsClient, type DockObsStatus } from "./dockObsClient";
import { DOCK_TABS, type DockTab, type DockStagedItem } from "./dockTypes";
import DockBibleTab from "./tabs/DockBibleTab";
import DockMediaTab from "./tabs/DockMediaTab";
import DockWorshipTab from "./tabs/DockWorshipTab";
import { useAppTheme } from "../hooks/useAppTheme";
import {
  type DockProductionSettingsPayload,
  getDefaultDockProductionSettings,
  loadDockProductionSettings,
} from "../services/productionSettings";
import "./dock.css";
import "./dock-theme.css";
import Icon from "./DockIcon";

function isDockProductionSettingsPayload(value: unknown): value is DockProductionSettingsPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DockProductionSettingsPayload>;
  return Boolean(
    candidate.bible &&
    candidate.worship &&
    candidate.bible.fullscreenTheme &&
    candidate.bible.lowerThirdTheme &&
    candidate.worship.fullscreenTheme &&
    candidate.worship.lowerThirdTheme,
  );
}

export default function DockPage() {
  const { effective, setTheme } = useAppTheme();
  const [activeTab, setActiveTab] = useState<DockTab>("bible");
  const [obsConnected, setObsConnected] = useState(false);
  const [obsError, setObsError] = useState("");
  const [staged, setStaged] = useState<DockStagedItem | null>(null);
  const [appConnected, setAppConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [obsUrlInput, setObsUrlInput] = useState("ws://localhost:4455");
  const [obsPwInput, setObsPwInput] = useState("");
  const [productionSettings, setProductionSettings] = useState<DockProductionSettingsPayload>(
    getDefaultDockProductionSettings(),
  );

  const sendingRef = useRef(false);

  useEffect(() => {
    void loadDockProductionSettings().then(setProductionSettings).catch(() => {});
  }, []);

  useEffect(() => {
    dockClient.init();
    dockObsClient.connect();

    const unsubObs = dockObsClient.onStatusChange((status: DockObsStatus, err?: string) => {
      setObsConnected(status === "connected");
      setObsError(status === "error" ? (err || "Connection failed") : "");

      if (status === "connected") {
        setShowSettings(false);
        dockObsClient.recoverLiveState().then((recovered) => {
          setStaged((current) => {
            if (current) return current;
            if (recovered.bible) {
              setActiveTab("bible");
              return {
                type: "bible",
                label: recovered.bible.reference || "Bible Verse",
                subtitle: recovered.bible.text || "",
                data: {
                  book: "",
                  chapter: 0,
                  verse: 0,
                  translation: "",
                  verseText: recovered.bible.text,
                  overlayMode: recovered.bible.overlayMode,
                  _recovered: true,
                },
              };
            }
            if (recovered.worship) {
              setActiveTab("worship");
              return {
                type: "worship",
                label: recovered.worship.sectionLabel || "Worship",
                subtitle: recovered.worship.songTitle || "",
                data: {
                  sectionText: recovered.worship.sectionText,
                  sectionLabel: recovered.worship.sectionLabel,
                  song: { title: recovered.worship.songTitle, artist: recovered.worship.artist },
                  overlayMode: recovered.worship.overlayMode,
                  _recovered: true,
                },
              };
            }
            return null;
          });
        }).catch((err) => {
          console.warn("[Dock] Failed to recover live state:", err);
        });
      }
    });

    const unsubState = dockClient.onState((msg: DockStateMessage) => {
      switch (msg.type) {
        case "state:pong":
          setAppConnected(true);
          break;
        case "state:obs-status":
          if (!dockObsClient.isConnected) {
            setObsConnected((msg.payload as { connected: boolean }).connected);
          }
          break;
        case "state:update": {
          const payload = msg.payload as Record<string, unknown>;
          if (!dockObsClient.isConnected && typeof payload.obsConnected === "boolean") {
            setObsConnected(payload.obsConnected);
          }
          if (isDockProductionSettingsPayload(payload.productionSettings)) {
            setProductionSettings(payload.productionSettings);
          }
          setAppConnected(true);
          break;
        }
      }
    });

    const pingInterval = window.setInterval(() => {
      dockClient.sendCommand({ type: "ping", timestamp: Date.now() });
    }, 5000);

    dockClient.sendCommand({ type: "request-state", timestamp: Date.now() });

    return () => {
      unsubObs();
      unsubState();
      window.clearInterval(pingInterval);
      dockObsClient.disconnect();
    };
  }, []);

  const handleStage = useCallback((item: DockStagedItem | null) => {
    setStaged(item);
    setActionError("");
  }, []);

  const handleManualConnect = useCallback(async () => {
    setObsError("");
    await dockObsClient.connect(obsUrlInput, obsPwInput || undefined);
  }, [obsPwInput, obsUrlInput]);

  const handleSendPreview = useCallback(async () => {
    if (!staged || sendingRef.current) return;
    sendingRef.current = true;
    setActionError("");
    setSending(true);

    try {
      if (!dockObsClient.isConnected) {
        setActionError("Not connected to OBS. Click the status bar to configure.");
        setShowSettings(true);
        return;
      }

      if (staged.type === "bible") {
        const bibleData = staged.data as {
          book: string;
          chapter: number;
          verse: number;
          translation: string;
          theme?: string;
          verseText?: string;
          overlayMode?: "fullscreen" | "lower-third";
          bibleThemeSettings?: Record<string, unknown>;
        };
        await dockObsClient.pushBible(bibleData, false);
      } else if (staged.type === "worship") {
        const payload = staged.data as Record<string, unknown>;
        const song = payload.song as { title: string; artist: string } | undefined;
        await dockObsClient.pushWorshipLyrics({
          sectionText: (payload.sectionText as string) ?? "",
          sectionLabel: (payload.sectionLabel as string) ?? staged.label ?? "",
          songTitle: song?.title ?? "",
          artist: (payload.artist as string) ?? "",
          overlayMode: (payload.overlayMode as "fullscreen" | "lower-third") ?? "lower-third",
          bibleThemeSettings: payload.bibleThemeSettings as Record<string, unknown> | undefined,
        }, false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Dock] Send preview failed:", message);
      setActionError(message);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [staged]);

  const handleGoLive = useCallback(async () => {
    if (!staged || sendingRef.current) return;
    sendingRef.current = true;
    setActionError("");
    setSending(true);

    try {
      if (!dockObsClient.isConnected) {
        setActionError("Not connected to OBS. Click the status bar to configure.");
        setShowSettings(true);
        return;
      }

      if (staged.type === "bible") {
        const bibleData = staged.data as {
          book: string;
          chapter: number;
          verse: number;
          translation: string;
          theme?: string;
          verseText?: string;
          overlayMode?: "fullscreen" | "lower-third";
          bibleThemeSettings?: Record<string, unknown>;
        };
        await dockObsClient.pushBible(bibleData, true);
      } else if (staged.type === "worship") {
        const payload = staged.data as Record<string, unknown>;
        const song = payload.song as { title: string; artist: string } | undefined;
        await dockObsClient.pushWorshipLyrics({
          sectionText: (payload.sectionText as string) ?? "",
          sectionLabel: (payload.sectionLabel as string) ?? staged.label ?? "",
          songTitle: song?.title ?? "",
          artist: (payload.artist as string) ?? "",
          overlayMode: (payload.overlayMode as "fullscreen" | "lower-third") ?? "lower-third",
          bibleThemeSettings: payload.bibleThemeSettings as Record<string, unknown> | undefined,
        }, true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Dock] Go live failed:", message);
      setActionError(message);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [staged]);

  const handleClear = useCallback(async () => {
    if (!staged || sendingRef.current) return;
    sendingRef.current = true;
    setActionError("");
    setSending(true);

    try {
      if (dockObsClient.isConnected) {
        if (staged.type === "bible") {
          await dockObsClient.clearBible();
        } else if (staged.type === "worship") {
          await dockObsClient.clearWorshipLyrics();
        }
      }
      setStaged(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Dock] Clear failed:", message);
      setActionError(message);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [staged]);

  const stagedSubtitleStyle =
    staged?.type === "bible" && staged.subtitle
      ? {
          fontSize:
            staged.subtitle.length > 260
              ? "8px"
              : staged.subtitle.length > 180
                ? "8.5px"
                : staged.subtitle.length > 120
                  ? "9px"
                  : "9.5px",
          lineHeight: 1.45,
          whiteSpace: "normal" as const,
        }
      : undefined;

  const showStagedControls = activeTab !== "media";

  return (
    <div className="dock-root">
      <div className="dock-status-bar" onClick={() => setShowSettings((value) => !value)} style={{ cursor: "pointer" }}>
        <div className="dock-status-bar__left">
          <div className={`dock-status-dot ${obsConnected ? "dock-status-dot--connected" : "dock-status-dot--disconnected"}`} />
          <span className="dock-status-label">{obsConnected ? "OBS Connected" : "OBS Disconnected"}</span>
          {!obsConnected && <Icon name="settings" size={10} style={{ opacity: 0.5, marginLeft: 2 }} />}
        </div>
        <div className="dock-status-bar__right">
          <div
            className="dock-theme-switch"
            role="group"
            aria-label="Dock color mode"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`dock-theme-switch__btn${effective === "light" ? " dock-theme-switch__btn--active" : ""}`}
              onClick={() => setTheme("light")}
              aria-pressed={effective === "light"}
              title="Use light mode"
            >
              Light
            </button>
            <button
              type="button"
              className={`dock-theme-switch__btn${effective === "dark" ? " dock-theme-switch__btn--active" : ""}`}
              onClick={() => setTheme("dark")}
              aria-pressed={effective === "dark"}
              title="Use dark mode"
            >
              Dark
            </button>
          </div>
          {appConnected && (
            <span className="dock-status-label" style={{ color: "var(--dock-green, #4ade80)", fontSize: 8 }}>
              Synced
            </span>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="dock-settings-panel">
          <div className="dock-section-label" style={{ marginTop: 0 }}>OBS WebSocket Connection</div>
          {obsError && (
            <div className="dock-error-msg">
              <Icon name="error" size={14} />
              {obsError}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              className="dock-input"
              placeholder="ws://localhost:4455"
              value={obsUrlInput}
              onChange={(event) => setObsUrlInput(event.target.value)}
            />
            <input
              className="dock-input"
              type="password"
              placeholder="Password (optional)"
              value={obsPwInput}
              onChange={(event) => setObsPwInput(event.target.value)}
            />
            <button className="dock-btn dock-btn--preview" onClick={handleManualConnect} style={{ width: "100%" }}>
              <Icon name="link" size={20} />
              {obsConnected ? "Reconnect" : "Connect"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--dock-text-dim)", marginTop: 6 }}>
            Make sure OBS → Tools → WebSocket Server Settings is enabled.
          </div>
        </div>
      )}

      <div className="dock-tabs">
        {DOCK_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`dock-tab${activeTab === tab.id ? " dock-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon name={tab.icon} size={20} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="dock-content">
        {activeTab === "bible" && (
          <DockBibleTab
            staged={staged}
            onStage={handleStage}
            productionDefaults={productionSettings.bible}
          />
        )}
        {activeTab === "worship" && (
          <DockWorshipTab
            staged={staged}
            onStage={handleStage}
            productionDefaults={productionSettings.worship}
          />
        )}
        {activeTab === "media" && (
          <DockMediaTab
            staged={staged}
            onStage={handleStage}
          />
        )}
      </div>

      {showStagedControls && staged && (
        <div className="dock-staged">
          <div className="dock-staged__header">
            <span className="dock-staged__badge">
              <Icon name="fiber_manual_record" size={10} />
              Ready
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {staged.type === "bible" && typeof (staged.data as Record<string, unknown>).translation === "string" && (
                <span style={{ fontSize: 9, color: "var(--dock-text-dim)", fontWeight: 500 }}>
                  {(staged.data as Record<string, string>).translation}
                </span>
              )}
              <button className="dock-staged__clear" onClick={handleClear}>
                <Icon name="close" size={12} />
                Clear
              </button>
            </div>
          </div>
          <div className="dock-staged__label">{staged.label}</div>
          {staged.subtitle && <div className="dock-staged__sub" style={stagedSubtitleStyle}>{staged.subtitle}</div>}
        </div>
      )}

      {actionError && (
        <div className="dock-action-error">
          <Icon name="warning" size={14} />
          <span style={{ flex: 1 }}>{actionError}</span>
          <button
            onClick={() => setActionError("")}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {showStagedControls && (
        <div className="dock-footer">
          <button
            className="dock-btn dock-btn--preview"
            onClick={handleSendPreview}
            disabled={!staged || sending}
          >
            <Icon name={sending ? "hourglass_empty" : "visibility"} size={20} />
            {sending ? "Sending..." : "Send to Preview"}
          </button>
          <button
            className="dock-btn dock-btn--live"
            onClick={handleGoLive}
            disabled={!staged || sending}
          >
            <Icon name={sending ? "hourglass_empty" : "cast"} size={20} />
            {sending ? "Sending..." : "Go Live"}
          </button>
        </div>
      )}
    </div>
  );
}
