/**
 * DockSpeakerTab.tsx — Speaker tab for the OBS Browser Dock
 *
 * Shows saved speaker profiles, lets the user select one,
 * stage it in the preview area, and send it to OBS as a lower third.
 *
 * Speakers are persisted to the dock's own localStorage so they work
 * even when the dock runs inside OBS's embedded CEF browser (which
 * doesn't share localStorage with the main Tauri app).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { DockStagedItem } from "../dockTypes";
import { dockObsClient, type DockLTThemeRef } from "../dockObsClient";
import DockLTThemePicker from "../components/DockLTThemePicker";
import Icon from "../DockIcon";

const STORAGE_KEY = "ocs-dock-speakers";

interface SpeakerProfile {
  name: string;
  role: string;
}

/**
 * Load speakers from the best available source:
 *   1. Centralized mv-settings.pastorSpeakers (shared with main app)
 *   2. Dock-local ocs-dock-speakers (legacy / dock-only additions)
 *   3. Fetch from overlay server dock-speakers.json (OBS CEF cross-process)
 *
 * Merges all sources, deduplicating by name.
 */
function loadSpeakers(): SpeakerProfile[] {
  const speakers: SpeakerProfile[] = [];
  const seen = new Set<string>();

  const addUnique = (list: SpeakerProfile[]) => {
    for (const sp of list) {
      const key = sp.name.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        speakers.push(sp);
      }
    }
  };

  // 1. Try centralized mv-settings (main app's settings store)
  try {
    const raw = localStorage.getItem("mv-settings");
    if (raw) {
      const settings = JSON.parse(raw);
      if (Array.isArray(settings.pastorSpeakers)) {
        addUnique(
          settings.pastorSpeakers
            .filter((s: unknown) => s && typeof s === "object" && typeof (s as SpeakerProfile).name === "string")
            .map((s: SpeakerProfile) => ({ name: s.name.trim(), role: (s.role || "").trim() }))
            .filter((s: SpeakerProfile) => s.name)
        );
      }
      // Also try legacy pastorNames field
      if (typeof settings.pastorNames === "string" && settings.pastorNames.trim()) {
        addUnique(
          settings.pastorNames
            .split(",")
            .map((n: string) => n.trim())
            .filter(Boolean)
            .map((name: string) => ({ name, role: "" }))
        );
      }
    }
  } catch { /* ignore */ }

  // 2. Try dock-local storage (speakers added directly in the dock)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as SpeakerProfile[];
      addUnique(arr.filter((s) => s.name.trim()));
    }
  } catch { /* ignore */ }

  return speakers;
}

/**
 * Load speakers asynchronously from the overlay server's dock data.
 * Used when localStorage is not shared (OBS CEF cross-process).
 */
async function loadSpeakersFromServer(): Promise<SpeakerProfile[]> {
  try {
    const res = await fetch("/uploads/dock-speakers.json");
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) {
      return data
        .filter((s: unknown) => s && typeof s === "object" && typeof (s as SpeakerProfile).name === "string")
        .map((s: SpeakerProfile) => ({ name: s.name.trim(), role: (s.role || "").trim() }))
        .filter((s: SpeakerProfile) => s.name);
    }
  } catch { /* ignore */ }
  return [];
}

function saveSpeakers(speakers: SpeakerProfile[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(speakers)); } catch { /* ignore */ }
}

/**
 * Sync a speaker to the centralized mv-settings.pastorSpeakers in localStorage.
 * This ensures speakers added in the dock are visible in the main app's Settings.
 */
function syncSpeakerToMvSettings(name: string, role: string): void {
  try {
    const raw = localStorage.getItem("mv-settings");
    const settings = raw ? JSON.parse(raw) : {};
    const existing: SpeakerProfile[] = Array.isArray(settings.pastorSpeakers) ? settings.pastorSpeakers : [];
    const key = name.trim().toLowerCase();
    if (!key) return;
    if (existing.some((sp) => sp.name.trim().toLowerCase() === key)) return;

    const updated = [...existing, { name: name.trim(), role: role.trim() }];
    settings.pastorSpeakers = updated;
    settings.pastorNames = updated.map((sp: SpeakerProfile) => sp.name).join("\n");
    localStorage.setItem("mv-settings", JSON.stringify(settings));
  } catch { /* ignore — localStorage may not be shared in OBS CEF */ }
}

/**
 * Remove a speaker from the centralized mv-settings.pastorSpeakers in localStorage.
 */
function removeSpeakerFromMvSettings(name: string): void {
  try {
    const raw = localStorage.getItem("mv-settings");
    if (!raw) return;
    const settings = JSON.parse(raw);
    const existing: SpeakerProfile[] = Array.isArray(settings.pastorSpeakers) ? settings.pastorSpeakers : [];
    const key = name.trim().toLowerCase();
    if (!key) return;

    const updated = existing.filter((sp) => sp.name.trim().toLowerCase() !== key);
    if (updated.length === existing.length) return; // Nothing removed
    settings.pastorSpeakers = updated;
    settings.pastorNames = updated.map((sp: SpeakerProfile) => sp.name).join("\n");
    localStorage.setItem("mv-settings", JSON.stringify(settings));
  } catch { /* ignore */ }
}

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

/** Get initials from a name (e.g. "John Smith" → "JS") */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

export default function DockSpeakerTab({ staged, onStage }: Props) {
  const loaded = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [speakers, setSpeakers] = useState<SpeakerProfile[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<DockLTThemeRef | null>(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [showForm, setShowForm] = useState(false);
  const isProgramLive =
    staged?.type === "speaker" &&
    Boolean((staged.data as Record<string, unknown> | undefined)?._dockLive);

  // Load speakers from all sources on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    // Load from localStorage (both centralized and dock-local)
    const localSpeakers = loadSpeakers();
    setSpeakers(localSpeakers);

    // Also try loading from the overlay server (for OBS CEF cross-process)
    if (localSpeakers.length === 0) {
      loadSpeakersFromServer().then((serverSpeakers) => {
        if (serverSpeakers.length > 0) {
          setSpeakers((current) => {
            if (current.length > 0) return current; // Already loaded
            return serverSpeakers;
          });
        }
      });
    }
  }, []);

  // Persist whenever speakers change (after initial load)
  const updateSpeakers = useCallback((next: SpeakerProfile[]) => {
    setSpeakers(next);
    saveSpeakers(next);
  }, []);

  const handleAddSpeaker = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const role = newRole.trim();
    const next = [...speakers, { name, role }];
    updateSpeakers(next);
    syncSpeakerToMvSettings(name, role);
    setNewName("");
    setNewRole("");
    setShowForm(false);
  }, [newName, newRole, speakers, updateSpeakers]);

  const handleRemoveSpeaker = useCallback((idx: number) => {
    const removed = speakers[idx];
    const next = speakers.filter((_, i) => i !== idx);
    updateSpeakers(next);
    if (removed) removeSpeakerFromMvSettings(removed.name);
    if (selectedIdx === idx) {
      setSelectedIdx(null);
      onStage(null);
    } else if (selectedIdx !== null && selectedIdx > idx) {
      setSelectedIdx(selectedIdx - 1);
    }
  }, [speakers, selectedIdx, onStage, updateSpeakers]);

  const pushSpeaker = useCallback(async (
    idx: number,
    live: boolean,
    themeOverride?: DockLTThemeRef | null,
  ) => {
    const sp = speakers[idx];
    if (!sp) return;
    setSelectedIdx(idx);
    onStage({
      type: "speaker",
      label: sp.name,
      subtitle: sp.role,
      data: { ...sp, ltTheme: themeOverride ?? selectedTheme, _dockLive: live },
    });

    if (!dockObsClient.isConnected) return;

    try {
      await dockObsClient.pushLowerThird({
        name: sp.name,
        role: sp.role,
        subtitle: sp.role,
        ltTheme: themeOverride ?? selectedTheme ?? undefined,
        context: "speaker",
      }, live);
    } catch (err) {
      console.warn(`[DockSpeakerTab] ${live ? "Go live" : "Send preview"} failed:`, err);
    }
  }, [onStage, selectedTheme, speakers]);

  const handleSelectTheme = useCallback((theme: DockLTThemeRef) => {
    setSelectedTheme(theme);
    if (selectedIdx !== null && speakers[selectedIdx]) {
      void pushSpeaker(selectedIdx, isProgramLive, theme);
    }
  }, [isProgramLive, pushSpeaker, selectedIdx, speakers]);

  const handleSelect = useCallback((idx: number) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void pushSpeaker(idx, false);
    }, 220);
  }, [pushSpeaker]);

  const handleGoLiveSpeaker = useCallback((idx: number) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void pushSpeaker(idx, true);
  }, [pushSpeaker]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  return (
    <>
      <div className="dock-section-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Speakers</span>
        <button
          className="dock-btn dock-btn--preview"
          style={{ padding: "3px 8px", fontSize: 10 }}
          onClick={() => setShowForm(!showForm)}
          title={showForm ? "Cancel" : "Add speaker"}
        >
          <Icon name={showForm ? "close" : "person_add"} size={12} />
          {showForm ? " Cancel" : " Add"}
        </button>
      </div>

      {/* Inline add-speaker form */}
      {showForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <input
            className="dock-input"
            placeholder="Speaker Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddSpeaker(); }}
            autoFocus
          />
          <input
            className="dock-input"
            placeholder="Role / Title (optional)"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddSpeaker(); }}
          />
          <button
            className="dock-btn dock-btn--live"
            style={{ width: "100%", fontSize: 11 }}
            onClick={handleAddSpeaker}
            disabled={!newName.trim()}
          >
            <Icon name="check" size={14} />
            Save Speaker
          </button>
        </div>
      )}

      {speakers.length === 0 && !showForm && (
        <div className="dock-empty">
          <Icon name="person_off" size={20} />
          <div className="dock-empty__title">No Speakers Added</div>
          <div className="dock-empty__text">
            Click "+ Add" above to create speaker profiles.
          </div>
        </div>
      )}

      {speakers.map((sp, i) => (
        <div
          key={`${sp.name}-${i}`}
          className={`dock-speaker-item${selectedIdx === i ? " dock-speaker-item--active" : ""}`}
          onClick={() => handleSelect(i)}
          onDoubleClick={() => handleGoLiveSpeaker(i)}
        >
          <div className="dock-speaker-avatar">{initials(sp.name)}</div>
          <div className="dock-speaker-info">
            <div className="dock-speaker-name">{sp.name}</div>
            {sp.role && <div className="dock-speaker-role">{sp.role}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {selectedIdx === i && (
              <Icon name="check_circle" size={18} style={{ color: "var(--dock-accent)" }} />
            )}
            <button
              className="dock-staged__clear"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveSpeaker(i);
              }}
              title="Remove speaker"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      ))}

      {/* Theme picker */}
      <DockLTThemePicker
        selectedThemeId={selectedTheme?.id ?? null}
        onSelect={handleSelectTheme}
        label="Speaker Theme"
        tags={["speaker", "pastor", "minister", "guest", "name", "title"]}
      />

      {/* Staged preview */}
      {staged && staged.type === "speaker" && (
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
