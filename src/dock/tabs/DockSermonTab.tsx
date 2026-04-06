/**
 * DockSermonTab.tsx — Sermon tab for the OBS Browser Dock
 *
 * Allows entering a sermon title, series, speaker, and adding sermon points/quotes.
 * Points can be staged and sent to OBS as lower third overlays.
 *
 * Features:
 *   - Save / load message details + points to localStorage
 *   - Attribution field (auto-filled from speaker name for quotes)
 *   - Pinned message card above points list
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { DockStagedItem, DockSermonPoint } from "../dockTypes";
import { dockObsClient, type DockLTThemeRef } from "../dockObsClient";
import DockLTThemePicker from "../components/DockLTThemePicker";
import Icon from "../DockIcon";

const STORAGE_KEY = "ocs-dock-sermon";

interface SermonData {
  title: string;
  series: string;
  speaker: string;
  points: DockSermonPoint[];
}

function loadSermon(): SermonData {
  // Try dock-local storage first
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as SermonData;
      if (data.title || data.speaker || data.points?.length > 0) return data;
    }
  } catch { /* ignore */ }

  // Fall back to centralized mv-settings
  try {
    const raw = localStorage.getItem("mv-settings");
    if (raw) {
      const settings = JSON.parse(raw);
      if (settings.sermonTitle || settings.sermonSpeaker || (Array.isArray(settings.sermonPoints) && settings.sermonPoints.length > 0)) {
        return {
          title: settings.sermonTitle || "",
          series: settings.sermonSeries || "",
          speaker: settings.sermonSpeaker || "",
          points: Array.isArray(settings.sermonPoints) ? settings.sermonPoints : [],
        };
      }
    }
  } catch { /* ignore */ }

  return { title: "", series: "", speaker: "", points: [] };
}

function saveSermon(data: SermonData): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/**
 * Sync sermon data to the centralized mv-settings in localStorage.
 * This ensures sermon notes saved in the dock are visible in the main app's Settings.
 */
function syncSermonToMvSettings(data: SermonData): void {
  try {
    const raw = localStorage.getItem("mv-settings");
    const settings = raw ? JSON.parse(raw) : {};
    settings.sermonTitle = data.title;
    settings.sermonSeries = data.series;
    settings.sermonSpeaker = data.speaker;
    settings.sermonPoints = data.points;
    localStorage.setItem("mv-settings", JSON.stringify(settings));
  } catch { /* ignore — localStorage may not be shared in OBS CEF */ }
}

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

let nextId = Date.now();

export default function DockSermonTab({ staged, onStage }: Props) {
  const loaded = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState("");
  const [series, setSeries] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [points, setPoints] = useState<DockSermonPoint[]>([]);
  const [newPointText, setNewPointText] = useState("");
  const [newPointAttribution, setNewPointAttribution] = useState("");
  const [newPointType, setNewPointType] = useState<"point" | "quote">("point");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<DockLTThemeRef | null>(null);
  const [saved, setSaved] = useState(false);
  const [messageSaved, setMessageSaved] = useState(false);
  const [editingMessage, setEditingMessage] = useState(false);
  const stagedSermonData =
    staged?.type === "sermon" ? (staged.data as Record<string, unknown>) : null;
  const isProgramLive =
    staged?.type === "sermon" &&
    Boolean(stagedSermonData?._dockLive);
  const isMessageSelected =
    staged?.type === "sermon" &&
    !stagedSermonData?.point &&
    staged.label === title;

  // ── Load persisted data on mount ──
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const data = loadSermon();
    setTitle(data.title);
    setSeries(data.series);
    setSpeaker(data.speaker);
    setPoints(data.points);
    if (data.title || data.series || data.speaker) setMessageSaved(true);
  }, []);

  // ── Save handler ──
  const handleSave = useCallback(() => {
    const data = { title, series, speaker, points };
    saveSermon(data);
    syncSermonToMvSettings(data);
    setSaved(true);
    setMessageSaved(true);
    setEditingMessage(false);
    setTimeout(() => setSaved(false), 2000);

    // Auto-stage the message title so Send to Preview / Go Live become enabled
    if (title.trim()) {
      onStage({
        type: "sermon",
        label: title,
        subtitle: [series, speaker].filter(Boolean).join(" • ") || undefined,
        data: { title, series, speaker, ltTheme: selectedTheme },
      });
    }
  }, [title, series, speaker, points, onStage, selectedTheme]);

  // ── Auto-fill attribution from speaker for quotes ──
  useEffect(() => {
    if (newPointType === "quote" && speaker && !newPointAttribution) {
      setNewPointAttribution(speaker);
    }
  }, [newPointType, speaker, newPointAttribution]);

  const handleAddPoint = useCallback(() => {
    if (!newPointText.trim()) return;
    const point: DockSermonPoint = {
      id: `sp-${nextId++}`,
      text: newPointText.trim(),
      type: newPointType,
      attribution: newPointType === "quote" ? (newPointAttribution.trim() || speaker || undefined) : undefined,
    };
    setPoints((prev) => [...prev, point]);
    setNewPointText("");
    setNewPointAttribution("");
  }, [newPointText, newPointType, newPointAttribution, speaker]);

  const pushSermonMessage = useCallback(async (
    live: boolean,
    themeOverride?: DockLTThemeRef | null,
  ) => {
    if (!title.trim()) return;
    setSelectedId(null);
    onStage({
      type: "sermon",
      label: title,
      subtitle: [series, speaker].filter(Boolean).join(" • ") || undefined,
      data: { title, series, speaker, ltTheme: themeOverride ?? selectedTheme, _dockLive: live },
    });

    if (!dockObsClient.isConnected) return;

    try {
      await dockObsClient.pushLowerThird({
        title,
        name: title,
        series,
        speaker,
        subtitle: [series, speaker].filter(Boolean).join(" • "),
        ltTheme: themeOverride ?? selectedTheme ?? undefined,
        context: "sermon",
      }, live);
    } catch (err) {
      console.warn(`[DockSermonTab] ${live ? "Go live" : "Send preview"} failed:`, err);
    }
  }, [onStage, selectedTheme, series, speaker, title]);

  const pushSermonPoint = useCallback(async (
    point: DockSermonPoint,
    live: boolean,
    themeOverride?: DockLTThemeRef | null,
  ) => {
    setSelectedId(point.id);
    onStage({
      type: "sermon",
      label: point.type === "quote" ? `"${point.text}"` : point.text,
      subtitle: point.attribution
        ? `${point.type === "quote" ? "Quote" : "Point"} — ${point.attribution}`
        : `${point.type === "quote" ? "Quote" : "Point"} — ${title || "Untitled Message"}`,
      data: { point, title, series, speaker, ltTheme: themeOverride ?? selectedTheme, _dockLive: live },
    });

    if (!dockObsClient.isConnected) return;

    try {
      await dockObsClient.pushLowerThird({
        title: point.text,
        point: point.text,
        series,
        speaker,
        subtitle: point.attribution
          ? `${point.type === "quote" ? "Quote" : "Point"} — ${point.attribution}`
          : `${point.type === "quote" ? "Quote" : "Point"} — ${title || "Untitled Message"}`,
        ltTheme: themeOverride ?? selectedTheme ?? undefined,
        context: "sermon",
      }, live);
    } catch (err) {
      console.warn(`[DockSermonTab] ${live ? "Go live" : "Send preview"} failed:`, err);
    }
  }, [onStage, selectedTheme, series, speaker, title]);

  const handleSelectTheme = useCallback(
    (theme: DockLTThemeRef) => {
      setSelectedTheme(theme);
      if (selectedId) {
        const point = points.find((p) => p.id === selectedId);
        if (point) {
          void pushSermonPoint(point, isProgramLive, theme);
        }
      } else if (staged?.type === "sermon" && !stagedSermonData?.point && title.trim()) {
        void pushSermonMessage(isProgramLive, theme);
      }
    },
    [isProgramLive, points, pushSermonMessage, pushSermonPoint, selectedId, staged, stagedSermonData, title]
  );

  const handleSelectPoint = useCallback(
    (point: DockSermonPoint) => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        void pushSermonPoint(point, false);
      }, 220);
    },
    [pushSermonPoint]
  );

  const handleGoLivePoint = useCallback((point: DockSermonPoint) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void pushSermonPoint(point, true);
  }, [pushSermonPoint]);

  const handleSelectMessage = useCallback(() => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void pushSermonMessage(false);
    }, 220);
  }, [pushSermonMessage]);

  const handleGoLiveMessage = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void pushSermonMessage(true);
  }, [pushSermonMessage]);

  const handleRemovePoint = useCallback((id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const handleClearAll = useCallback(() => {
    setTitle("");
    setSeries("");
    setSpeaker("");
    setPoints([]);
    setSelectedId(null);
    setMessageSaved(false);
    localStorage.removeItem(STORAGE_KEY);
    syncSermonToMvSettings({ title: "", series: "", speaker: "", points: [] });
  }, []);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  return (
    <>
      {/* Message details form — show when editing or no saved message */}
      {(!messageSaved || editingMessage) && (
        <>
          <div className="dock-section-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{editingMessage ? "Edit Message" : "Message Details"}</span>
            <div style={{ display: "flex", gap: 4 }}>
              {editingMessage && (
                <button
                  className="dock-btn dock-btn--preview"
                  style={{ padding: "3px 8px", fontSize: 10 }}
                  onClick={() => setEditingMessage(false)}
                  title="Cancel edit"
                >
                  <Icon name="close" size={12} />
                  Cancel
                </button>
              )}
              {(title || series || speaker || points.length > 0) && (
                <button
                  className="dock-btn dock-btn--preview"
                  style={{ padding: "3px 8px", fontSize: 10 }}
                  onClick={handleClearAll}
                  title="Clear all"
                >
                  <Icon name="delete_outline" size={12} />
                </button>
              )}
              <button
                className="dock-btn dock-btn--live"
                style={{ padding: "3px 10px", fontSize: 10 }}
                onClick={handleSave}
                title="Save to local storage"
              >
                {/* <Icon name={saved ? "check" : "save"} size={12} /> */}
                {saved ? " Saved!" : " Save"}
              </button>
            </div>
          </div>

          <input
            className="dock-input"
            placeholder="Message Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <input
            className="dock-input"
            placeholder="Series Name (optional)"
            value={series}
            onChange={(e) => setSeries(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <input
            className="dock-input"
            placeholder="Speaker / Lead Pastor"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        </>
      )}

      {/* Pinned message card (shows when saved and NOT editing) */}
      {messageSaved && title && !editingMessage && (
        <div
          className={`dock-sermon-pinned${isMessageSelected ? " dock-card--active" : ""}`}
          style={{ position: "relative", cursor: "pointer" }}
          onClick={handleSelectMessage}
          onDoubleClick={handleGoLiveMessage}
        >
          <Icon name="church" size={16} style={{ color: "var(--dock-accent, #6c63ff)" }} />
          <div className="dock-sermon-pinned__info" style={{ flex: 1 }}>
            <div className="dock-sermon-pinned__title">{title}</div>
            {series && <div className="dock-sermon-pinned__meta">{series}</div>}
            {speaker && <div className="dock-sermon-pinned__meta">
              <Icon name="person" size={10} /> {speaker}
            </div>}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button
              className="dock-btn dock-btn--preview"
              style={{ padding: "3px 8px", fontSize: 10 }}
              onClick={(event) => {
                event.stopPropagation();
                setEditingMessage(true);
              }}
              title="Edit message details"
            >
              <Icon name="edit" size={12} />
              Edit
            </button>
            <button
              className="dock-btn dock-btn--preview"
              style={{ padding: "3px 8px", fontSize: 10 }}
              onClick={(event) => {
                event.stopPropagation();
                handleClearAll();
              }}
              title="Clear all"
            >
              <Icon name="delete_outline" size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Sermon points list */}
      <div className="dock-section-label">Sermon Points & Quotes</div>

      {points.length === 0 && (
        <div className="dock-empty" style={{ padding: 16 }}>
          <Icon name="format_quote" size={20} />
          <div className="dock-empty__text">
            Add sermon points or quotes to display on screen.
          </div>
        </div>
      )}

      {points.map((point) => (
        <div
          key={point.id}
          className={`dock-sermon-point${selectedId === point.id ? " dock-sermon-point--active" : ""}`}
          onClick={() => handleSelectPoint(point)}
          onDoubleClick={() => handleGoLivePoint(point)}
        >
          <div
            className={`dock-sermon-point__icon dock-sermon-point__icon--${point.type}`}
          >
            <Icon name={point.type === "quote" ? "format_quote" : "push_pin"} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dock-sermon-point__text">
              {point.type === "quote" ? `"${point.text}"` : point.text}
            </div>
            {point.attribution && (
              <div style={{ fontSize: 10, color: "var(--dock-text-dim)", marginTop: 2 }}>
                — {point.attribution}
              </div>
            )}
          </div>
          <button
            className="dock-staged__clear"
            onClick={(e) => {
              e.stopPropagation();
              handleRemovePoint(point.id);
            }}
            title="Remove"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}

      {/* Add new point form */}
      <div className="dock-spacer" />
      <div className="dock-row" style={{ gap: 4, marginBottom: 6 }}>
        <button
          className={`dock-theme-pill${newPointType === "point" ? " dock-theme-pill--active" : ""}`}
          onClick={() => { setNewPointType("point"); setNewPointAttribution(""); }}
        >
          Point
        </button>
        <button
          className={`dock-theme-pill${newPointType === "quote" ? " dock-theme-pill--active" : ""}`}
          onClick={() => setNewPointType("quote")}
        >
          Quote
        </button>
      </div>
      <div className="dock-row" style={{ gap: 6, marginBottom: newPointType === "quote" ? 6 : 0 }}>
        <input
          className="dock-input"
          style={{ flex: 1 }}
          placeholder={newPointType === "quote" ? "Enter a quote..." : "Enter a point..."}
          value={newPointText}
          onChange={(e) => setNewPointText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddPoint();
          }}
        />
        <button
          className="dock-btn dock-btn--preview"
          style={{ flex: "none", padding: "8px 12px" }}
          onClick={handleAddPoint}
          disabled={!newPointText.trim()}
        >
          <Icon name="add" size={20} />
        </button>
      </div>
      {/* Attribution field (shown for quotes) */}
      {newPointType === "quote" && (
        <input
          className="dock-input"
          placeholder="Attribution (e.g. Pastor Name)"
          value={newPointAttribution}
          onChange={(e) => setNewPointAttribution(e.target.value)}
          style={{ marginBottom: 0 }}
        />
      )}

      {/* Theme picker */}
      <DockLTThemePicker
        selectedThemeId={selectedTheme?.id ?? null}
        onSelect={handleSelectTheme}
        label="Sermon Theme"
        tags={["sermon", "sermon title", "title", "point", "quote", "scripture", "keyword"]}
      />

      {/* Staged preview */}
      {staged && staged.type === "sermon" && (
        <>
          <div className="dock-spacer" />
          <div className="dock-preview">
            <div className="dock-preview__header">
              <span className="dock-preview__badge">
                <Icon name="fiber_manual_record" size={10} />
                {isProgramLive ? "Live" : "Preview"}
              </span>
            </div>
            <div className="dock-preview__ref">{staged.label}</div>
            {staged.subtitle && <div className="dock-preview__text">{staged.subtitle}</div>}
          </div>
        </>
      )}
    </>
  );
}
