import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_THEMES, canonicalizeLowerThirdThemeId, type ThemeLike } from "../../lowerthirds/themes";
import DockLTThemePicker from "../components/DockLTThemePicker";
import { dockObsClient, type DockLTThemeRef } from "../dockObsClient";
import type { DockStagedItem } from "../dockTypes";
import Icon from "../DockIcon";

const STORAGE_KEY = "ocs-dock-animated-lt-slots";
const SLOT_COUNT = 10;

interface AnimatedLTSlot {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  meta: string;
  themeId: string | null;
}

interface AnimatedLTStageData extends AnimatedLTSlot {
  slotId: string;
  ltTheme?: DockLTThemeRef | null;
  _dockLive?: boolean;
}

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

function createDefaultSlots(): AnimatedLTSlot[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => ({
    id: `lt-slot-${index + 1}`,
    label: `Slot ${index + 1}`,
    title: "",
    subtitle: "",
    meta: "",
    themeId: null,
  }));
}

function loadSlots(): AnimatedLTSlot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSlots();
    const parsed = JSON.parse(raw) as AnimatedLTSlot[];
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultSlots();

    const defaults = createDefaultSlots();
    return defaults.map((slot, index) => {
      const stored = parsed[index];
      if (!stored || typeof stored !== "object") return slot;
      return {
        id: typeof stored.id === "string" ? stored.id : slot.id,
        label: typeof stored.label === "string" ? stored.label : slot.label,
        title: typeof stored.title === "string" ? stored.title : "",
        subtitle: typeof stored.subtitle === "string" ? stored.subtitle : "",
        meta: typeof stored.meta === "string" ? stored.meta : "",
        themeId: typeof stored.themeId === "string" ? stored.themeId : null,
      };
    });
  } catch {
    return createDefaultSlots();
  }
}

function saveSlots(slots: AnimatedLTSlot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // ignore dock storage failures
  }
}

function resolveThemeRef(themeId: string | null): DockLTThemeRef | null {
  if (!themeId) return null;
  const canonicalId = canonicalizeLowerThirdThemeId(themeId);
  const theme = ALL_THEMES.find((item) => item.id === canonicalId && item.html && item.css);
  if (!theme?.html || !theme.css) return null;
  return {
    id: theme.id,
    html: theme.html,
    css: theme.css,
  };
}

function buildAnimatedValues(slot: AnimatedLTSlot): Record<string, string> {
  const title = slot.title.trim();
  const subtitle = slot.subtitle.trim();
  const meta = slot.meta.trim();
  const label = slot.label.trim();

  return {
    name: title,
    title,
    headline: title,
    heading: title,
    keyword: title,
    text: title,
    label: label || title,
    subtitle,
    subline: subtitle,
    role: subtitle,
    details: subtitle || meta,
    description: meta,
    meta,
    line1: title,
    line2: subtitle || meta,
    scripture: meta,
    quote: title,
  };
}

function buildStageItem(slot: AnimatedLTSlot, live: boolean): DockStagedItem {
  const theme = resolveThemeRef(slot.themeId);
  const subtitleParts = [slot.subtitle.trim(), slot.meta.trim()].filter(Boolean);
  return {
    type: "animated-lt",
    label: slot.title.trim() || slot.label.trim() || "Animated Lower Third",
    subtitle: subtitleParts.join(" • "),
    data: {
      ...slot,
      slotId: slot.id,
      ltTheme: theme,
      _dockLive: live,
    } satisfies AnimatedLTStageData,
  };
}

function stageMatchesSlot(staged: DockStagedItem | null, slotId: string): staged is DockStagedItem & { data: AnimatedLTStageData } {
  if (!staged || staged.type !== "animated-lt" || !staged.data || typeof staged.data !== "object") return false;
  return (staged.data as AnimatedLTStageData).slotId === slotId;
}

function shortThemeName(theme: ThemeLike | null | undefined): string {
  if (!theme) return "No theme";
  return (theme.name || theme.id).replace(/\s+/g, " ").trim();
}

export default function DockAnimatedLTTab({ staged, onStage }: Props) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPushSignatureRef = useRef("");
  const [slots, setSlots] = useState<AnimatedLTSlot[]>(() => loadSlots());
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    saveSlots(slots);
  }, [slots]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const selectedSlot = slots[selectedIndex] ?? slots[0];
  const selectedTheme = useMemo(() => resolveThemeRef(selectedSlot?.themeId ?? null), [selectedSlot?.themeId]);
  const selectedThemeMeta = useMemo(
    () => ALL_THEMES.find((theme) => theme.id === canonicalizeLowerThirdThemeId(selectedSlot?.themeId ?? "")),
    [selectedSlot?.themeId],
  );
  const isSelectedSlotLive = selectedSlot ? stageMatchesSlot(staged, selectedSlot.id) && Boolean((staged.data as AnimatedLTStageData)._dockLive) : false;
  const isSelectedSlotStaged = selectedSlot ? stageMatchesSlot(staged, selectedSlot.id) : false;

  const patchSlot = useCallback((index: number, patch: Partial<AnimatedLTSlot>) => {
    setSlots((current) => current.map((slot, slotIndex) => (
      slotIndex === index ? { ...slot, ...patch } : slot
    )));
  }, []);

  const clearPendingSlotClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const pushSlot = useCallback(async (
    index: number,
    live: boolean,
    themeOverride?: DockLTThemeRef | null,
  ) => {
    const slot = slots[index];
    if (!slot) return;
    const values = buildAnimatedValues(slot);
    const hasPrimaryText = Boolean(values.title || values.line1 || values.headline);
    if (!hasPrimaryText) return;

    const nextStage = buildStageItem(slot, live);
    if (themeOverride) {
      (nextStage.data as AnimatedLTStageData).ltTheme = themeOverride;
    }
    onStage(nextStage);

    if (!dockObsClient.isConnected) {
      await dockObsClient.connect();
    }
    if (!dockObsClient.isConnected) return;

    try {
      await dockObsClient.pushLowerThird({
        name: values.label || values.title,
        title: values.title,
        subtitle: values.subtitle,
        description: values.meta,
        ltTheme: themeOverride ?? selectedTheme ?? undefined,
        context: "custom",
        values,
      }, live);
    } catch (err) {
      console.warn(`[DockAnimatedLTTab] ${live ? "Program" : "Preview"} push failed:`, err);
    }
  }, [onStage, selectedTheme, slots]);

  const handleSelectSlot = useCallback((index: number) => {
    setSelectedIndex(index);
    clearPendingSlotClick();
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void pushSlot(index, false);
    }, 220);
  }, [clearPendingSlotClick, pushSlot]);

  const handleGoLiveSlot = useCallback((index: number) => {
    setSelectedIndex(index);
    clearPendingSlotClick();
    void pushSlot(index, true);
  }, [clearPendingSlotClick, pushSlot]);

  const handlePreviewCurrent = useCallback(() => {
    clearPendingSlotClick();
    void pushSlot(selectedIndex, false);
  }, [clearPendingSlotClick, pushSlot, selectedIndex]);

  const handleProgramCurrent = useCallback(() => {
    clearPendingSlotClick();
    void pushSlot(selectedIndex, true);
  }, [clearPendingSlotClick, pushSlot, selectedIndex]);

  const handleResetCurrent = useCallback(() => {
    clearPendingSlotClick();
    const currentSlot = slots[selectedIndex];
    if (!currentSlot) return;

    patchSlot(selectedIndex, {
      title: "",
      subtitle: "",
      meta: "",
    });

    if (stageMatchesSlot(staged, currentSlot.id)) {
      onStage(null);
      if (dockObsClient.isConnected) {
        void dockObsClient.clearLowerThirds().catch((err) => {
          console.warn("[DockAnimatedLTTab] Reset clear failed:", err);
        });
      }
    }
  }, [clearPendingSlotClick, onStage, patchSlot, selectedIndex, slots, staged]);

  const handleSelectTheme = useCallback((theme: DockLTThemeRef) => {
    patchSlot(selectedIndex, { themeId: theme.id });
    const currentSlot = slots[selectedIndex];
    if (currentSlot && stageMatchesSlot(staged, currentSlot.id)) {
      void pushSlot(selectedIndex, Boolean((staged.data as AnimatedLTStageData)._dockLive), theme);
    }
  }, [patchSlot, pushSlot, selectedIndex, slots, staged]);

  const selectedValuesSignature = useMemo(() => {
    if (!selectedSlot) return "";
    return JSON.stringify({
      slotId: selectedSlot.id,
      label: selectedSlot.label,
      title: selectedSlot.title,
      subtitle: selectedSlot.subtitle,
      meta: selectedSlot.meta,
      themeId: selectedSlot.themeId,
      live: isSelectedSlotLive,
    });
  }, [selectedSlot, isSelectedSlotLive]);

  useEffect(() => {
    if (!selectedSlot || !isSelectedSlotStaged) return;
    const hasPrimaryText = Boolean(selectedSlot.title.trim());
    if (!hasPrimaryText) return;
    if (autoPushSignatureRef.current === selectedValuesSignature) return;
    autoPushSignatureRef.current = selectedValuesSignature;
    const timer = window.setTimeout(() => {
      void pushSlot(selectedIndex, isSelectedSlotLive);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isSelectedSlotLive, isSelectedSlotStaged, pushSlot, selectedIndex, selectedSlot, selectedValuesSignature]);

  return (
    <>
      <div className="dock-section-label">Animated LT Slots</div>

      <div className="dock-animated-lt__slots">
        {slots.map((slot, index) => {
          const active = index === selectedIndex;
          const stagedHere = stageMatchesSlot(staged, slot.id);
          const status = stagedHere
            ? ((staged?.data as AnimatedLTStageData)._dockLive ? "Live" : "Preview")
            : "";
          return (
            <button
              key={slot.id}
              type="button"
              className={`dock-animated-lt__slot${active ? " dock-animated-lt__slot--active" : ""}${stagedHere ? " dock-animated-lt__slot--staged" : ""}`}
              onClick={() => handleSelectSlot(index)}
              onDoubleClick={() => handleGoLiveSlot(index)}
              title={slot.title || slot.label}
            >
              <span className="dock-animated-lt__slot-index">{index + 1}</span>
              <span className="dock-animated-lt__slot-body">
                <span className="dock-animated-lt__slot-title">{slot.title.trim() || slot.label}</span>
                <span className="dock-animated-lt__slot-subtitle">{slot.subtitle.trim() || slot.meta.trim() || "Click to edit"}</span>
              </span>
              {status && <span className={`dock-animated-lt__slot-status${(staged?.data as AnimatedLTStageData)._dockLive ? " is-live" : ""}`}>{status}</span>}
            </button>
          );
        })}
      </div>

      {selectedSlot ? (
        <>
          <div className="dock-section-label">Slot Editor</div>

          <div className="dock-animated-lt__editor">
            <div className="dock-console-grid">
              <label className="dock-console-control">
                <span className="dock-section-label">Label</span>
                <input
                  className="dock-input dock-animated-lt__input"
                  value={selectedSlot.label}
                  onChange={(event) => patchSlot(selectedIndex, { label: event.target.value })}
                  placeholder="Slot name or kicker"
                />
              </label>
              <label className="dock-console-control">
                <span className="dock-section-label">Meta</span>
                <input
                  className="dock-input dock-animated-lt__input"
                  value={selectedSlot.meta}
                  onChange={(event) => patchSlot(selectedIndex, { meta: event.target.value })}
                  placeholder="Date, scripture, supporting text"
                />
              </label>
            </div>

            <label className="dock-console-control">
              <span className="dock-section-label">Headline</span>
              <input
                className="dock-input dock-animated-lt__input"
                value={selectedSlot.title}
                onChange={(event) => patchSlot(selectedIndex, { title: event.target.value })}
                placeholder="Main line"
              />
            </label>

            <label className="dock-console-control">
              <span className="dock-section-label">Subline</span>
              <textarea
                className="dock-input dock-animated-lt__textarea"
                value={selectedSlot.subtitle}
                onChange={(event) => patchSlot(selectedIndex, { subtitle: event.target.value })}
                placeholder="Secondary line"
                rows={3}
              />
            </label>

            <DockLTThemePicker
              selectedThemeId={selectedSlot.themeId}
              onSelect={handleSelectTheme}
              label="Animated LT Theme"
            />

            <div className="dock-preview dock-preview--animated-lt">
              <div className="dock-preview__header">
                <span className="dock-preview__badge">
                  <Icon name="subtitles" size={10} />
                  {isSelectedSlotLive ? "Live" : isSelectedSlotStaged ? "Preview" : "Ready"}
                </span>
                <span className="dock-animated-lt__theme-note">{shortThemeName(selectedThemeMeta)}</span>
              </div>
              <div className="dock-preview__ref">{selectedSlot.title.trim() || "Animated lower third"}</div>
              {selectedSlot.subtitle.trim() && <div className="dock-preview__text">{selectedSlot.subtitle.trim()}</div>}
              {!selectedSlot.subtitle.trim() && selectedSlot.meta.trim() && (
                <div className="dock-preview__text">{selectedSlot.meta.trim()}</div>
              )}
            </div>
          </div>

          <div className="dock-console-action-row">
            <button
              type="button"
              className="dock-btn dock-btn--preview"
              onClick={handlePreviewCurrent}
              disabled={!selectedSlot.title.trim()}
            >
              <Icon name="preview" size={14} />
              Preview
            </button>
            <button
              type="button"
              className="dock-btn dock-btn--live"
              onClick={handleProgramCurrent}
              disabled={!selectedSlot.title.trim()}
            >
              <Icon name="play_arrow" size={14} />
              Program
            </button>
            <button
              type="button"
              className="dock-btn dock-btn--ghost"
              onClick={handleResetCurrent}
            >
              <Icon name="clear" size={14} />
              Reset Slot
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
