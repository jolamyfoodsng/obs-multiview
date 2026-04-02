/**
 * DockPage.tsx — OBS Browser Dock Control Panel
 *
 * The dock keeps Bible and Worship production controls, while the Ministry
 * section restores lower-third speaker/sermon/event control inside OBS.
 */

import { useState, useEffect, useCallback } from "react";
import { dockClient, type DockStateMessage } from "../services/dockBridge";
import { dockObsClient, type DockObsStatus } from "./dockObsClient";
import { DOCK_TABS, type DockTab, type DockStagedItem } from "./dockTypes";
import DockMinistryTab from "./tabs/DockMinistryTab";
import DockBibleTab from "./tabs/DockBibleTab";
import DockMediaTab from "./tabs/DockMediaTab";
import DockWorshipTab from "./tabs/DockWorshipTab";
import { useAppTheme } from "../hooks/useAppTheme";
import {
  type DockProductionSettingsPayload,
  getDefaultDockProductionSettings,
  loadDockProductionSettings,
} from "../services/productionSettings";
import type { VoiceBibleSnapshot } from "../services/voiceBibleTypes";
import "./dock.css";
import "./dock-theme.css";
import Icon from "./DockIcon";

const DOCK_SHELL_PREFS_KEY = "ocs-dock-shell-preferences";
const DOCK_STAGED_ITEM_KEY = "ocs-dock-staged-item";

interface DockShellPreferences {
  activeTab?: DockTab;
}

function loadDockStagedItem(): DockStagedItem | null {
  try {
    const raw = localStorage.getItem(DOCK_STAGED_ITEM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DockStagedItem | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.type !== "string" || typeof parsed.label !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDockStagedItem(item: DockStagedItem | null): void {
  try {
    if (!item) {
      localStorage.removeItem(DOCK_STAGED_ITEM_KEY);
      return;
    }
    localStorage.setItem(DOCK_STAGED_ITEM_KEY, JSON.stringify(item));
  } catch {
    // ignore OBS CEF storage failures
  }
}

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

function loadDockShellPreferences(): DockShellPreferences {
  try {
    const raw = localStorage.getItem(DOCK_SHELL_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DockShellPreferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDockShellPreferences(next: DockShellPreferences): void {
  try {
    localStorage.setItem(DOCK_SHELL_PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore OBS CEF storage failures
  }
}

export default function DockPage() {
  const shellPreferences = loadDockShellPreferences();
  const { effective, setTheme } = useAppTheme();
  const [activeTab, setActiveTab] = useState<DockTab>(shellPreferences.activeTab ?? "bible");
  const [obsConnected, setObsConnected] = useState(false);
  const [obsError, setObsError] = useState("");
  const [staged, setStaged] = useState<DockStagedItem | null>(() => loadDockStagedItem());
  const [appConnected, setAppConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [obsUrlInput, setObsUrlInput] = useState("ws://localhost:4455");
  const [obsPwInput, setObsPwInput] = useState("");
  const [productionSettings, setProductionSettings] = useState<DockProductionSettingsPayload>(
    getDefaultDockProductionSettings(),
  );
  const [voiceBible, setVoiceBible] = useState<VoiceBibleSnapshot | null>(null);

  useEffect(() => {
    saveDockShellPreferences({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    saveDockStagedItem(staged);
  }, [staged]);

  useEffect(() => {
    void loadDockProductionSettings().then(setProductionSettings).catch(() => { });
  }, []);

  useEffect(() => {
    dockClient.init();
    void dockObsClient.connect();

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
                  _dockLive: true,
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
                  _dockLive: true,
                },
              };
            }
            if (recovered.lowerThird) {
              setActiveTab("ministry");
              return {
                type: "speaker",
                label: recovered.lowerThird.name || "Lower Third",
                subtitle: recovered.lowerThird.role || "",
                data: {
                  name: recovered.lowerThird.name,
                  role: recovered.lowerThird.role,
                  _recovered: true,
                  _dockLive: true,
                },
              };
            }
            return null;
          });
        }).catch((error) => {
          console.warn("[Dock] Failed to recover live state:", error);
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
          setAppConnected(true);
          const payload = msg.payload as Record<string, unknown>;
          if (!dockObsClient.isConnected && typeof payload.obsConnected === "boolean") {
            setObsConnected(payload.obsConnected);
          }
          if (isDockProductionSettingsPayload(payload.productionSettings)) {
            setProductionSettings(payload.productionSettings);
          }
          if (payload.voiceBible) {
            setVoiceBible(payload.voiceBible as VoiceBibleSnapshot);
          }
          break;
        }
        default:
          break;
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
  }, []);

  const handleManualConnect = useCallback(async () => {
    setObsError("");
    await dockObsClient.connect(obsUrlInput, obsPwInput || undefined);
  }, [obsPwInput, obsUrlInput]);

  const activeTabDef = DOCK_TABS.find((tab) => tab.id === activeTab) ?? DOCK_TABS[0];
  const nextTheme = effective === "dark" ? "light" : "dark";
  const themeToggleLabel = nextTheme === "dark" ? "Switch to dark mode" : "Switch to light mode";
  const themeToggleIcon = nextTheme === "dark" ? "moon" : "sun";

  return (
    <div className="dock-root">
      <div className="dock-shell-header">
        <div className="dock-shell-status">
          <div className="dock-shell-titleline">
            <span className="dock-shell-titleline__app">OBS Studio</span>
            <span className="dock-shell-titleline__divider">/</span>
            <span className="dock-shell-titleline__section">{activeTabDef.label}</span>
          </div>

          <div className="dock-shell-status__right">
            <button
              type="button"
              className="dock-shell-icon-btn dock-shell-icon-btn--theme"
              onClick={() => setTheme(nextTheme)}
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
            >
              <Icon name={themeToggleIcon} size={14} />
            </button>
            <button
              type="button"
              className={`dock-shell-icon-btn${showSettings ? " dock-shell-icon-btn--active" : ""}`}
              onClick={() => setShowSettings((value) => !value)}
              aria-label="Open OBS connection settings"
              title="OBS connection settings"
            >
              <Icon name="settings" size={14} />
            </button>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="dock-settings-panel">
          <div className="dock-settings-panel__header">
            <div className="dock-settings-panel__title">OBS WebSocket</div>
            <div className="dock-settings-panel__caption">Connect the dock directly to your OBS session.</div>
          </div>
          {obsError && (
            <div className="dock-error-msg">
              <Icon name="error" size={14} />
              {obsError}
            </div>
          )}
          <div className="dock-settings-form">
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
            <button type="button" className="dock-btn dock-btn--preview dock-btn--block" onClick={handleManualConnect}>
              <Icon name="link" size={16} />
              {obsConnected ? "Reconnect" : "Connect"}
            </button>
          </div>
          <div className="dock-settings-panel__hint">
            Make sure OBS → Tools → WebSocket Server Settings is enabled.
          </div>
        </div>
      )}

      <div className="dock-content">
        {activeTab === "ministry" && (
          <DockMinistryTab
            staged={staged}
            onStage={handleStage}
          />
        )}
        {activeTab === "bible" && (
          <DockBibleTab
            staged={staged}
            onStage={handleStage}
            productionDefaults={productionSettings.bible}
            initialVoiceBible={voiceBible}
            appConnected={appConnected}
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

      <div className="dock-bottom-nav">
        {DOCK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`dock-bottom-nav__item${activeTab === tab.id ? " dock-bottom-nav__item--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
