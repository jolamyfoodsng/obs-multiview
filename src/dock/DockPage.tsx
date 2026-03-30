/**
 * DockPage.tsx — OBS Browser Dock Control Panel
 *
 * This page is loaded inside OBS's "Custom Browser Dock" feature.
 * It communicates with the main Tauri app via BroadcastChannel
 * (dockBridge/dockClient) for state sync and library data, while
 * overlay actions go straight to OBS through dockObsClient.
 *
 * URL: http://127.0.0.1:<overlay-port>/dock.html
 *   or in development: http://localhost:5173/dock
 *
 * Tabs:
 *   Speaker — select saved speaker profiles → lower third
 *   Bible   — book/chapter/verse picker → bible overlay
 *   Sermon  — sermon title + points/quotes → lower third
 *   Event   — event details → lower third
 *   Worship — song lyrics controller → worship overlay
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { dockClient, type DockStateMessage } from "../services/dockBridge";
import { dockObsClient, type DockObsStatus } from "./dockObsClient";
import { DOCK_TABS, type DockTab, type DockStagedItem } from "./dockTypes";
import DockSpeakerTab from "./tabs/DockSpeakerTab";
import DockBibleTab from "./tabs/DockBibleTab";
import DockSermonTab from "./tabs/DockSermonTab";
import DockEventTab from "./tabs/DockEventTab";
import DockWorshipTab from "./tabs/DockWorshipTab";
import DockMediaTab from "./tabs/DockMediaTab";
import DockMinistryTab from "./tabs/DockMinistryTab";
import { useAppTheme } from "../hooks/useAppTheme";
import "./dock.css";
import "./dock-theme.css";
import Icon from "./DockIcon";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DockPage() {
  const { effective, setTheme } = useAppTheme();
  const [activeTab, setActiveTab] = useState<DockTab>("ministry");
  const [obsConnected, setObsConnected] = useState(false);
  const [obsError, setObsError] = useState("");
  const [staged, setStaged] = useState<DockStagedItem | null>(null);
  const [appConnected, setAppConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [obsUrlInput, setObsUrlInput] = useState("ws://localhost:4455");
  const [obsPwInput, setObsPwInput] = useState("");

  /** Synchronous guard to prevent double-click from firing the action twice */
  const sendingRef = useRef(false);

  // ── Initialize dock client + direct OBS connection ──
  useEffect(() => {
    // BroadcastChannel client (works if same browser process as main app)
    dockClient.init();

    // Direct OBS WebSocket connection (works always)
    dockObsClient.connect();

    const unsubObs = dockObsClient.onStatusChange((s: DockObsStatus, err?: string) => {
      setObsConnected(s === "connected");
      setObsError(s === "error" ? (err || "Connection failed") : "");
      if (s === "connected") {
        setShowSettings(false);
        // Recover live state from OBS on connect (handles app restart)
        dockObsClient.recoverLiveState().then((recovered) => {
          // Only restore if nothing is currently staged by the user
          setStaged((current) => {
            if (current) return current; // User already staged something — don't override
            if (recovered.bible) {
              setActiveTab("bible");
              return {
                type: "bible" as const,
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
                type: "worship" as const,
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
            if (recovered.lowerThird) {
              setActiveTab("ministry");
              return {
                type: "speaker" as const,
                label: recovered.lowerThird.name,
                subtitle: recovered.lowerThird.role,
                data: {
                  name: recovered.lowerThird.name,
                  role: recovered.lowerThird.role,
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

    const unsub = dockClient.onState((msg: DockStateMessage) => {
      switch (msg.type) {
        case "state:pong":
          setAppConnected(true);
          break;
        case "state:obs-status":
          // If we're already connected directly, don't override
          if (!dockObsClient.isConnected) {
            setObsConnected((msg.payload as { connected: boolean }).connected);
          }
          break;
        case "state:update": {
          const s = msg.payload as Record<string, unknown>;
          if (!dockObsClient.isConnected && typeof s.obsConnected === "boolean") {
            setObsConnected(s.obsConnected);
          }
          setAppConnected(true);
          break;
        }
      }
    });

    // Periodically ping to check connection
    const pingInterval = setInterval(() => {
      dockClient.sendCommand({ type: "ping", timestamp: Date.now() });
    }, 5000);

    // Request initial state
    dockClient.sendCommand({ type: "request-state", timestamp: Date.now() });

    return () => {
      unsub();
      unsubObs();
      clearInterval(pingInterval);
      dockObsClient.disconnect();
    };
  }, []);

  // ── Stage handler (used by all tabs) ──
  const handleStage = useCallback((item: DockStagedItem | null) => {
    setStaged(item);
    setActionError("");
  }, []);

  // ── Manual OBS connect ──
  const handleManualConnect = useCallback(async () => {
    setObsError("");
    await dockObsClient.connect(obsUrlInput, obsPwInput || undefined);
  }, [obsUrlInput, obsPwInput]);

  // ── Action: Send to Preview ──
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
          book: string; chapter: number; verse: number; translation: string;
          theme?: string; verseText?: string; overlayMode?: "fullscreen" | "lower-third";
          ltTheme?: import("./dockObsClient").DockLTThemeRef;
          bibleThemeSettings?: Record<string, unknown>;
        };
        await dockObsClient.pushBible(bibleData, false);
      } else if (staged.type === "worship") {
        const d = staged.data as Record<string, unknown>;
        const song = d.song as { title: string; artist: string } | undefined;
        await dockObsClient.pushWorshipLyrics({
          sectionText: (d.sectionText as string) ?? "",
          sectionLabel: (d.sectionLabel as string) ?? staged.label ?? "",
          songTitle: song?.title ?? "",
          artist: (d.artist as string) ?? "",
          overlayMode: (d.overlayMode as "fullscreen" | "lower-third") ?? "lower-third",
          ltTheme: d.ltTheme as import("./dockObsClient").DockLTThemeRef | undefined,
          bibleThemeSettings: d.bibleThemeSettings as Record<string, unknown> | undefined,
        }, false);
      } else if (staged.type === "speaker" || staged.type === "sermon" || staged.type === "event") {
        const d = staged.data as Record<string, unknown>;
        const pointObj = d.point as { text?: string } | undefined;
        const pointText = typeof d.point === "string" ? d.point : (pointObj?.text ?? "");
        await dockObsClient.pushLowerThird({
          name: (d.name as string) ?? staged.label,
          role: (d.role as string) ?? staged.subtitle ?? "",
          title: (d.title as string) ?? pointText ?? "",
          series: (d.series as string) ?? "",
          speaker: (d.speaker as string) ?? "",
          point: pointText,
          date: (d.date as string) ?? "",
          location: (d.location as string) ?? "",
          description: (d.description as string) ?? "",
          subtitle: (d.subtitle as string) ?? staged.subtitle ?? "",
          ltTheme: d.ltTheme as import("./dockObsClient").DockLTThemeRef | undefined,
          context: staged.type,
        }, false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Dock] Send preview failed:", msg);
      setActionError(msg);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [staged]);

  // ── Action: Go Live ──
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
          book: string; chapter: number; verse: number; translation: string;
          theme?: string; verseText?: string; overlayMode?: "fullscreen" | "lower-third";
          ltTheme?: import("./dockObsClient").DockLTThemeRef;
          bibleThemeSettings?: Record<string, unknown>;
        };
        await dockObsClient.pushBible(bibleData, true);
      } else if (staged.type === "worship") {
        const d = staged.data as Record<string, unknown>;
        const song = d.song as { title: string; artist: string } | undefined;
        await dockObsClient.pushWorshipLyrics({
          sectionText: (d.sectionText as string) ?? "",
          sectionLabel: (d.sectionLabel as string) ?? staged.label ?? "",
          songTitle: song?.title ?? "",
          artist: (d.artist as string) ?? "",
          overlayMode: (d.overlayMode as "fullscreen" | "lower-third") ?? "lower-third",
          ltTheme: d.ltTheme as import("./dockObsClient").DockLTThemeRef | undefined,
          bibleThemeSettings: d.bibleThemeSettings as Record<string, unknown> | undefined,
        }, true);
      } else if (staged.type === "speaker" || staged.type === "sermon" || staged.type === "event") {
        const d = staged.data as Record<string, unknown>;
        const pointObj = d.point as { text?: string } | undefined;
        const pointText = typeof d.point === "string" ? d.point : (pointObj?.text ?? "");
        await dockObsClient.pushLowerThird({
          name: (d.name as string) ?? staged.label,
          role: (d.role as string) ?? staged.subtitle ?? "",
          title: (d.title as string) ?? pointText ?? "",
          series: (d.series as string) ?? "",
          speaker: (d.speaker as string) ?? "",
          point: pointText,
          date: (d.date as string) ?? "",
          location: (d.location as string) ?? "",
          description: (d.description as string) ?? "",
          subtitle: (d.subtitle as string) ?? staged.subtitle ?? "",
          ltTheme: d.ltTheme as import("./dockObsClient").DockLTThemeRef | undefined,
          context: staged.type,
        }, true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Dock] Go live failed:", msg);
      setActionError(msg);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [staged]);

  // ── Action: Clear ──
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
        } else if (staged.type === "speaker" || staged.type === "sermon" || staged.type === "event") {
          await dockObsClient.clearLowerThirds();
        }
      }
      setStaged(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Dock] Clear failed:", msg);
      setActionError(msg);
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

  return (
    <div className="dock-root">
      {/* ── Status bar (clickable to show settings) ── */}
      <div className="dock-status-bar" onClick={() => setShowSettings((v) => !v)} style={{ cursor: "pointer" }}>
        <div className="dock-status-bar__left">
          <div
            className={`dock-status-dot ${obsConnected ? "dock-status-dot--connected" : "dock-status-dot--disconnected"
              }`}
          />
          <span className="dock-status-label">
            {obsConnected ? "OBS Connected" : "OBS Disconnected"}
          </span>
          {!obsConnected && (
            <Icon name="settings" size={10} style={{ opacity: 0.5, marginLeft: 2 }} />
          )}
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

      {/* ── OBS Connection Settings Panel ── */}
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
              onChange={(e) => setObsUrlInput(e.target.value)}
            />
            <input
              className="dock-input"
              type="password"
              placeholder="Password (optional)"
              value={obsPwInput}
              onChange={(e) => setObsPwInput(e.target.value)}
            />
            <button
              className="dock-btn dock-btn--preview"
              onClick={handleManualConnect}
              style={{ width: "100%" }}
            >
              <Icon name="link" size={20} />
              {obsConnected ? "Reconnect" : "Connect"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--dock-text-dim)", marginTop: 6 }}>
            Make sure OBS → Tools → WebSocket Server Settings is enabled.
          </div>
        </div>
      )}

      {/* ── Tab navigation ── */}
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

      {/* ── Tab content (scrollable) ── */}
      <div className="dock-content">
        {activeTab === "ministry" && (
          <DockMinistryTab staged={staged} onStage={handleStage} />

        )}
        {activeTab === "speaker" && (
          <DockSpeakerTab staged={staged} onStage={handleStage} />
        )}
        {activeTab === "bible" && (
          <DockBibleTab staged={staged} onStage={handleStage} />
        )}
        {activeTab === "sermon" && (
          <DockSermonTab staged={staged} onStage={handleStage} />
        )}
        {activeTab === "event" && (
          <DockEventTab staged={staged} onStage={handleStage} />
        )}
        {activeTab === "worship" && (
          <DockWorshipTab staged={staged} onStage={handleStage} />
        )}
        {activeTab === "media" && (
          <DockMediaTab staged={staged} onStage={handleStage} />
        )}
      </div>

      {/* ── Staged item (above footer) — hidden on Media tab ── */}
      {staged && activeTab !== "media" && (
        <div className="dock-staged">
          <div className="dock-staged__header">
            <span className="dock-staged__badge">
              <Icon name="fiber_manual_record" size={10} />
              Ready
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Show translation for Bible items */}
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

      {/* ── Action error feedback ── */}
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

      {/* ── Footer action buttons — hidden on Media tab (it has its own inline controls) ── */}
      {activeTab !== "media" && (
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
