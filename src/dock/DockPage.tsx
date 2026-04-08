/**
 * DockPage.tsx — OBS Browser Dock Control Panel
 *
 * The dock keeps Bible and Worship production controls, while the Ministry
 * section restores lower-third speaker/sermon/event control inside OBS.
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
import { installDockTextShortcuts } from "./dockTextShortcuts";
import "./dock.css";
import "./dock-theme.css";
import Icon from "./DockIcon";

const DOCK_SHELL_PREFS_KEY = "ocs-dock-shell-preferences";
const DOCK_STAGED_ITEM_KEY = "ocs-dock-staged-item";
const DOCK_PRODUCTION_HISTORY_KEY = "ocs-dock-production-history";
const DOCK_PRODUCTION_FAVORITES_KEY = "ocs-dock-production-favorites";
const DOCK_PRODUCTION_HISTORY_LIMIT = 12;

interface DockShellPreferences {
  activeTab?: DockTab;
}

interface DockProductionHistoryEntry {
  id: string;
  kind: "bible" | "worship";
  label: string;
  subtitle: string;
  translation: string;
  item: DockStagedItem;
  savedAt: number;
}

function getProductionStageData(item: DockStagedItem): Record<string, unknown> {
  return item.data && typeof item.data === "object" ? (item.data as Record<string, unknown>) : {};
}

function createProductionHistoryEntry(item: DockStagedItem): DockProductionHistoryEntry | null {
  if (item.type !== "bible" && item.type !== "worship") return null;

  const data = getProductionStageData(item);
  if (item.type === "worship") {
    const song = data.song && typeof data.song === "object" ? (data.song as Record<string, unknown>) : {};
    const label = typeof song.title === "string" && song.title.trim()
      ? song.title.trim()
      : typeof item.subtitle === "string" && item.subtitle.trim()
        ? item.subtitle.trim()
        : item.label.trim() || "Worship Song";
    const sectionLabel = typeof data.sectionLabel === "string" ? data.sectionLabel.trim() : "";
    const sectionText = typeof data.sectionText === "string" ? data.sectionText.trim() : "";
    const subtitle = [sectionLabel, sectionText].filter(Boolean).join(" · ");
    const identityParts = [
      song.id,
      label,
    ].map((part) => String(part ?? "").trim()).filter(Boolean);

    return {
      id: `worship:${identityParts.join("|") || label}`,
      kind: "worship",
      label,
      subtitle,
      translation: "",
      item,
      savedAt: Date.now(),
    };
  }

  const label = typeof item.label === "string" && item.label.trim()
    ? item.label.trim()
    : typeof data.referenceLabel === "string" && data.referenceLabel.trim()
      ? data.referenceLabel.trim()
      : "Bible Verse";
  const subtitle = typeof item.subtitle === "string"
    ? item.subtitle.trim()
    : typeof data.verseText === "string"
      ? data.verseText.trim()
      : "";
  const translation = typeof data.translation === "string" && data.translation.trim()
    ? data.translation.trim()
    : "";
  const identityParts = [
    data.book,
    data.chapter,
    data.verse,
    data.verseEnd,
    data.translation,
    label,
  ].map((part) => String(part ?? "").trim()).filter(Boolean);

  return {
    id: `bible:${identityParts.join("|") || label}`,
    kind: "bible",
    label,
    subtitle,
    translation,
    item,
    savedAt: Date.now(),
  };
}

function isProductionHistoryEntry(value: unknown): value is DockProductionHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<DockProductionHistoryEntry>;
  const itemType = entry.item && typeof entry.item === "object" ? entry.item.type : "";
  return Boolean(
    typeof entry.id === "string" &&
    typeof entry.label === "string" &&
    (itemType === "bible" || itemType === "worship") &&
    entry.item &&
    typeof entry.item === "object" &&
    (entry.kind === "bible" || entry.kind === "worship" || entry.kind === undefined),
  );
}

function normalizeProductionHistoryEntry(entry: DockProductionHistoryEntry): DockProductionHistoryEntry {
  const normalized: DockProductionHistoryEntry = entry.kind
    ? entry
    : {
        ...entry,
        kind: entry.item.type === "worship" ? "worship" : "bible",
      };

  if (normalized.kind !== "worship") return normalized;

  const data = getProductionStageData(normalized.item);
  const song = data.song && typeof data.song === "object" ? (data.song as Record<string, unknown>) : {};
  const label = typeof song.title === "string" && song.title.trim()
    ? song.title.trim()
    : normalized.label.trim();
  const identityParts = [
    song.id,
    label,
  ].map((part) => String(part ?? "").trim()).filter(Boolean);

  return {
    ...normalized,
    id: `worship:${identityParts.join("|") || label || normalized.id.replace(/^worship:/, "")}`,
    label: label || normalized.label,
  };
}

function loadProductionHistoryEntries(key: string): DockProductionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .filter(isProductionHistoryEntry)
      .map(normalizeProductionHistoryEntry)
      .reduce<DockProductionHistoryEntry[]>((entries, entry) => upsertProductionHistoryEntry(entries, entry), [])
      .slice(0, DOCK_PRODUCTION_HISTORY_LIMIT);
    return normalized;
  } catch {
    return [];
  }
}

function saveProductionHistoryEntries(key: string, entries: DockProductionHistoryEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, DOCK_PRODUCTION_HISTORY_LIMIT)));
  } catch {
    // ignore OBS CEF storage failures
  }
}

function upsertProductionHistoryEntry(
  entries: DockProductionHistoryEntry[],
  entry: DockProductionHistoryEntry,
): DockProductionHistoryEntry[] {
  return [
    entry,
    ...entries.filter((candidate) => candidate.id !== entry.id),
  ].slice(0, DOCK_PRODUCTION_HISTORY_LIMIT);
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
  const productionHistoryRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<DockTab>(shellPreferences.activeTab ?? "bible");
  const [obsConnected, setObsConnected] = useState(false);
  const [obsError, setObsError] = useState("");
  const [staged, setStaged] = useState<DockStagedItem | null>(() => loadDockStagedItem());
  const [appConnected, setAppConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProductionHistory, setShowProductionHistory] = useState(false);
  const [productionHistory, setProductionHistory] = useState<DockProductionHistoryEntry[]>(() =>
    loadProductionHistoryEntries(DOCK_PRODUCTION_HISTORY_KEY),
  );
  const [productionFavorites, setProductionFavorites] = useState<DockProductionHistoryEntry[]>(() =>
    loadProductionHistoryEntries(DOCK_PRODUCTION_FAVORITES_KEY),
  );
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

  useEffect(() => installDockTextShortcuts(), []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      if (!productionHistoryRef.current?.contains(event.target as Node)) {
        setShowProductionHistory(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

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
    const productionEntry = item ? createProductionHistoryEntry(item) : null;
    if (productionEntry) {
      setProductionHistory((current) => {
        const next = upsertProductionHistoryEntry(current, productionEntry);
        saveProductionHistoryEntries(DOCK_PRODUCTION_HISTORY_KEY, next);
        return next;
      });
    }
    setStaged(item);
  }, []);

  const handleRestoreProductionEntry = useCallback((entry: DockProductionHistoryEntry) => {
    setStaged(entry.item);
    setActiveTab(entry.kind === "worship" ? "worship" : "bible");
    setShowProductionHistory(false);
  }, []);

  const handleToggleProductionFavorite = useCallback((entry?: DockProductionHistoryEntry) => {
    const nextEntry = entry ?? (staged ? createProductionHistoryEntry(staged) : null);
    if (!nextEntry) {
      setShowProductionHistory(true);
      return;
    }

    setProductionFavorites((current) => {
      const isFavorite = current.some((candidate) => candidate.id === nextEntry.id);
      const next = isFavorite
        ? current.filter((candidate) => candidate.id !== nextEntry.id)
        : upsertProductionHistoryEntry(current, nextEntry);
      saveProductionHistoryEntries(DOCK_PRODUCTION_FAVORITES_KEY, next);
      return next;
    });
  }, [staged]);

  const handleManualConnect = useCallback(async () => {
    setObsError("");
    await dockObsClient.connect(obsUrlInput, obsPwInput || undefined);
  }, [obsPwInput, obsUrlInput]);

  const activeTabDef = DOCK_TABS.find((tab) => tab.id === activeTab) ?? DOCK_TABS[0];
  const nextTheme = effective === "dark" ? "light" : "dark";
  const themeToggleLabel = nextTheme === "dark" ? "Switch to dark mode" : "Switch to light mode";
  const themeToggleIcon = nextTheme === "dark" ? "moon" : "sun";
  const currentProductionEntry = staged ? createProductionHistoryEntry(staged) : null;
  const currentProductionFavorite = Boolean(
    currentProductionEntry && productionFavorites.some((entry) => entry.id === currentProductionEntry.id),
  );
  const favoriteToggleLabel = currentProductionFavorite ? "Remove current item from favorites" : "Favorite current item";

  const renderProductionHistoryEntry = (entry: DockProductionHistoryEntry, context: "history" | "favorites") => {
    const isFavorite = productionFavorites.some((favorite) => favorite.id === entry.id);
    const typeLabel = entry.kind === "worship" ? "Song" : "Verse";

    return (
      <div className="dock-shell-history-item" key={`${context}-${entry.id}`}>
        <button
          type="button"
          className="dock-shell-history-item__main"
          onClick={() => handleRestoreProductionEntry(entry)}
        >
          <span className="dock-shell-history-item__label">{entry.label}</span>
          <span className="dock-shell-history-item__meta">
            {typeLabel}
            {entry.translation ? ` · ${entry.translation}` : ""}
            {" · "}
            {entry.subtitle || "Restore item"}
          </span>
        </button>
        <button
          type="button"
          className={`dock-shell-history-item__favorite${isFavorite ? " dock-shell-history-item__favorite--active" : ""}`}
          onClick={() => handleToggleProductionFavorite(entry)}
          aria-label={isFavorite ? `Remove ${entry.label} from favorites` : `Favorite ${entry.label}`}
          title={isFavorite ? "Remove favorite" : "Favorite item"}
        >
          <Icon name={isFavorite ? "star" : "star_border"} size={12} />
        </button>
      </div>
    );
  };

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
            <div className="dock-shell-history" ref={productionHistoryRef}>
              <button
                type="button"
                className={`dock-shell-icon-btn${showProductionHistory ? " dock-shell-icon-btn--active" : ""}`}
                onClick={() => setShowProductionHistory((value) => !value)}
                aria-label="Open production history"
                title="Production history"
              >
                <Icon name="history" size={14} />
              </button>

              {showProductionHistory && (
                <div className="dock-shell-history-menu" role="dialog" aria-label="Production history">
                  <div className="dock-shell-history-menu__header">
                    <div>
                      <div className="dock-shell-history-menu__eyebrow">Dock</div>
                      <div className="dock-shell-history-menu__title">History</div>
                    </div>
                    <button
                      type="button"
                      className="dock-shell-history-menu__close"
                      onClick={() => setShowProductionHistory(false)}
                      aria-label="Close production history"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>

                  {productionFavorites.length > 0 && (
                    <div className="dock-shell-history-section">
                      <div className="dock-shell-history-section__label">Favorites</div>
                      <div className="dock-shell-history-list">
                        {productionFavorites.map((entry) => renderProductionHistoryEntry(entry, "favorites"))}
                      </div>
                    </div>
                  )}

                  {productionHistory.length > 0 && (
                    <div className="dock-shell-history-section">
                      <div className="dock-shell-history-section__label">Recent</div>
                      <div className="dock-shell-history-list">
                        {productionHistory.map((entry) => renderProductionHistoryEntry(entry, "history"))}
                      </div>
                    </div>
                  )}

                  {productionFavorites.length === 0 && productionHistory.length === 0 && (
                    <div className="dock-shell-history-empty">
                      <div className="dock-shell-history-empty__title">No history yet</div>
                      <div className="dock-shell-history-empty__body">
                        Stage Bible verses or worship songs and they will appear here.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`dock-shell-icon-btn${currentProductionFavorite ? " dock-shell-icon-btn--active" : ""}`}
              onClick={() => handleToggleProductionFavorite()}
              aria-label={favoriteToggleLabel}
              title={favoriteToggleLabel}
              disabled={!currentProductionEntry}
            >
              <Icon name={currentProductionFavorite ? "star" : "star_border"} size={14} />
            </button>

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
