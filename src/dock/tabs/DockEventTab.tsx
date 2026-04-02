/**
 * DockEventTab.tsx — Event tab for the OBS Browser Dock
 *
 * Lets the user create and select events, edit details,
 * and stage event graphics for display on OBS.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { DockStagedItem, DockEvent } from "../dockTypes";
import { dockObsClient, type DockLTThemeRef } from "../dockObsClient";
import DockLTThemePicker from "../components/DockLTThemePicker";
import Icon from "../DockIcon";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

let nextEventId = 1;

export default function DockEventTab({ staged, onStage }: Props) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [events, setEvents] = useState<DockEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<DockLTThemeRef | null>(null);
  const isProgramLive =
    staged?.type === "event" &&
    Boolean((staged.data as Record<string, unknown> | undefined)?._dockLive);

  // Quick-add form
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    const ev: DockEvent = {
      id: `evt-${nextEventId++}`,
      name: newName.trim(),
      date: newDate.trim(),
      location: newLocation.trim(),
      description: newDescription.trim(),
    };
    setEvents((prev) => [...prev, ev]);
    setNewName("");
    setNewDate("");
    setNewLocation("");
    setNewDescription("");
  }, [newName, newDate, newLocation, newDescription]);

  const pushEvent = useCallback(async (
    ev: DockEvent,
    live: boolean,
    themeOverride?: DockLTThemeRef | null,
  ) => {
    setSelectedId(ev.id);
    onStage({
      type: "event",
      label: ev.name,
      subtitle: ev.date ? `${ev.date}${ev.location ? ` • ${ev.location}` : ""}` : ev.location || undefined,
      data: { ...ev, ltTheme: themeOverride ?? selectedTheme, _dockLive: live },
    });

    if (!dockObsClient.isConnected) return;

    try {
      await dockObsClient.pushLowerThird({
        name: ev.name,
        title: ev.name,
        date: ev.date,
        location: ev.location,
        description: ev.description,
        subtitle: ev.date ? `${ev.date}${ev.location ? ` • ${ev.location}` : ""}` : ev.location || undefined,
        ltTheme: themeOverride ?? selectedTheme ?? undefined,
        context: "event",
      }, live);
    } catch (err) {
      console.warn(`[DockEventTab] ${live ? "Go live" : "Send preview"} failed:`, err);
    }
  }, [onStage, selectedTheme]);

  const handleSelectTheme = useCallback(
    (theme: DockLTThemeRef) => {
      setSelectedTheme(theme);
      if (selectedId) {
        const ev = events.find((e) => e.id === selectedId);
        if (ev) {
          void pushEvent(ev, isProgramLive, theme);
        }
      }
    },
    [events, isProgramLive, pushEvent, selectedId]
  );

  const handleSelect = useCallback((ev: DockEvent) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void pushEvent(ev, false);
    }, 220);
  }, [pushEvent]);

  const handleGoLiveEvent = useCallback((ev: DockEvent) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void pushEvent(ev, true);
  }, [pushEvent]);

  const handleRemove = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  return (
    <>
      {/* Event list */}
      <div className="dock-section-label">Events</div>

      {events.length === 0 && (
        <div className="dock-empty" style={{ padding: 16 }}>
          <Icon name="event" size={20} />
          <div className="dock-empty__title">No Events</div>
          <div className="dock-empty__text">
            Add an event below to display on screen.
          </div>
        </div>
      )}

      {events.map((ev) => (
        <div
          key={ev.id}
          className={`dock-card${selectedId === ev.id ? " dock-card--active" : ""}`}
          onClick={() => handleSelect(ev)}
          onDoubleClick={() => handleGoLiveEvent(ev)}
        >
          <div className="dock-row dock-row--between">
            <div>
              <div className="dock-card__title">{ev.name}</div>
              <div className="dock-card__subtitle">
                {ev.date && <span>{ev.date}</span>}
                {ev.date && ev.location && <span> • </span>}
                {ev.location && <span>{ev.location}</span>}
              </div>
            </div>
            <button
              className="dock-staged__clear"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(ev.id);
              }}
              title="Remove"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {ev.description && (
            <div className="dock-card__subtitle" style={{ marginTop: 4 }}>
              {ev.description}
            </div>
          )}
        </div>
      ))}

      {/* Quick-add form */}
      <div className="dock-spacer" />
      <div className="dock-section-label">Add Event</div>
      <input
        className="dock-input"
        placeholder="Event Name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <div className="dock-row" style={{ gap: 6, marginBottom: 6 }}>
        <input
          className="dock-input"
          placeholder="Date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="dock-input"
          placeholder="Location"
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <input
        className="dock-input"
        placeholder="Description (optional)"
        value={newDescription}
        onChange={(e) => setNewDescription(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <button
        className="dock-btn dock-btn--preview"
        onClick={handleAdd}
        disabled={!newName.trim()}
        style={{ width: "100%" }}
      >
        <Icon name="add" size={20} />
        Add Event
      </button>

      {/* Theme picker */}
      <DockLTThemePicker
        selectedThemeId={selectedTheme?.id ?? null}
        onSelect={handleSelectTheme}
        label="Event Theme"
        tags={["event", "announcement", "highlight", "reminder", "date", "celebration"]}
      />

      {/* Staged preview */}
      {staged && staged.type === "event" && (
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
