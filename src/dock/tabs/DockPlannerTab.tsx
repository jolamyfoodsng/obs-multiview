import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dockClient, type DockStateMessage } from "../../services/dockBridge";
import { dockObsClient } from "../dockObsClient";
import type { DockStagedItem } from "../dockTypes";
import Icon from "../DockIcon";
import {
  createServicePlanItem,
  type ServicePlan,
  type ServicePlanItem,
  type ServicePlannerSnapshot,
} from "../../service-planner/types";

interface DockPlannerTabProps {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  initialSnapshot?: ServicePlannerSnapshot | null;
}

function isPlannerSnapshot(value: unknown): value is ServicePlannerSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ServicePlannerSnapshot>;
  return Array.isArray(candidate.plans);
}

function planDateLabel(date: string): string {
  if (!date) return "No date";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function cueKindLabel(type: ServicePlanItem["type"]): string {
  if (type === "bible") return "Bible";
  if (type === "worship") return "Song";
  if (type === "sermon") return "Sermon";
  return "Media";
}

function mediaPayload(payload: Record<string, unknown>): { filePath: string; fileName: string } | null {
  const filePath = typeof payload.filePath === "string" ? payload.filePath : "";
  const fileName = typeof payload.fileName === "string" ? payload.fileName : "";
  if (!filePath || !fileName) return null;
  return { filePath, fileName };
}

export default function DockPlannerTab({ staged: _staged, onStage, initialSnapshot }: DockPlannerTabProps) {
  const [snapshot, setSnapshot] = useState<ServicePlannerSnapshot | null>(initialSnapshot ?? null);
  const [activePlanId, setActivePlanId] = useState(initialSnapshot?.activePlan?.id ?? "");
  const [filter, setFilter] = useState("");
  const [editingCueId, setEditingCueId] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftSubtitle, setDraftSubtitle] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [quickPoint, setQuickPoint] = useState("");
  const [actionError, setActionError] = useState("");
  const [sending, setSending] = useState(false);
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!initialSnapshot) return;
    setSnapshot(initialSnapshot);
    setActivePlanId((current) => current || initialSnapshot.activePlan?.id || "");
  }, [initialSnapshot]);

  useEffect(() => {
    dockClient.sendCommand({ type: "request-service-plans", timestamp: Date.now() });
    const unsub = dockClient.onState((msg: DockStateMessage) => {
      if (msg.type !== "state:service-plans" || !isPlannerSnapshot(msg.payload)) return;
      const payload = msg.payload as ServicePlannerSnapshot;
      setSnapshot(payload);
      setActivePlanId((current) => current || payload.activePlan?.id || payload.plans[0]?.id || "");
    });
    return unsub;
  }, []);

  const plans = snapshot?.plans ?? [];
  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? snapshot?.activePlan ?? plans[0] ?? null,
    [activePlanId, plans, snapshot?.activePlan],
  );
  const selectedCue = activePlan?.items.find((item) => item.id === activePlan.selectedItemId) ?? activePlan?.items[0] ?? null;
  const selectedIndex = activePlan && selectedCue ? activePlan.items.findIndex((item) => item.id === selectedCue.id) : -1;
  const nextCue = activePlan && selectedIndex >= 0 ? activePlan.items[selectedIndex + 1] ?? null : null;
  const filteredItems = useMemo(() => {
    if (!activePlan) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return activePlan.items;
    return activePlan.items.filter((item) =>
      [item.type, item.label, item.subtitle, item.notes].some((value) => String(value ?? "").toLowerCase().includes(q)),
    );
  }, [activePlan, filter]);

  const savePlan = useCallback((plan: ServicePlan) => {
    setSnapshot((current) => {
      const plans = current?.plans ?? [];
      const nextPlans = plans.some((candidate) => candidate.id === plan.id)
        ? plans.map((candidate) => candidate.id === plan.id ? plan : candidate)
        : [plan, ...plans];
      return {
        plans: nextPlans,
        activePlan: plan.status === "active" ? plan : current?.activePlan ?? plan,
      };
    });
    dockClient.sendCommand({
      type: "service-plan:save",
      commandId: `planner-${Date.now()}`,
      payload: plan,
      timestamp: Date.now(),
    });
  }, []);

  const patchActivePlan = useCallback((patch: Partial<ServicePlan>) => {
    if (!activePlan) return;
    savePlan({ ...activePlan, ...patch, updatedAt: Date.now() });
  }, [activePlan, savePlan]);

  const patchCue = useCallback((cueId: string, patch: Partial<ServicePlanItem>) => {
    if (!activePlan) return;
    savePlan({
      ...activePlan,
      items: activePlan.items.map((item) =>
        item.id === cueId ? { ...item, ...patch, updatedAt: Date.now() } : item,
      ),
      updatedAt: Date.now(),
    });
  }, [activePlan, savePlan]);

  const startEditCue = useCallback((cue: ServicePlanItem) => {
    setEditingCueId(cue.id);
    setDraftLabel(cue.label);
    setDraftSubtitle(cue.subtitle ?? "");
    setDraftNotes(cue.notes ?? "");
  }, []);

  const commitEditCue = useCallback(() => {
    if (!editingCueId) return;
    patchCue(editingCueId, {
      label: draftLabel.trim() || "Untitled cue",
      subtitle: draftSubtitle.trim(),
      notes: draftNotes.trim(),
    });
    setEditingCueId("");
  }, [draftLabel, draftNotes, draftSubtitle, editingCueId, patchCue]);

  const sendCue = useCallback(async (cue: ServicePlanItem, live: boolean) => {
    setActionError("");
    setSending(true);
    try {
      if (!dockObsClient.isConnected) {
        await dockObsClient.connect();
      }
      const payload = cue.payloadSnapshot ?? {};
      if (cue.type === "bible") {
        await dockObsClient.pushBible(payload as Parameters<typeof dockObsClient.pushBible>[0], live);
      } else if (cue.type === "worship") {
        await dockObsClient.pushWorshipLyrics(payload as Parameters<typeof dockObsClient.pushWorshipLyrics>[0], live);
      } else if (cue.type === "sermon") {
        await dockObsClient.pushSermonCue(payload as Parameters<typeof dockObsClient.pushSermonCue>[0], live);
      } else {
        const media = mediaPayload(payload);
        if (!media) throw new Error("This media cue is missing a file path.");
        await dockObsClient.pushMedia(media.filePath, media.fileName, live);
      }

      onStage({
        type: cue.type,
        label: cue.label,
        subtitle: cue.subtitle,
        data: {
          ...payload,
          plannerCueId: cue.id,
          plannerLive: live,
        },
      });

      if (activePlan) {
        const completed = live
          ? Array.from(new Set([...(activePlan.completedItemIds ?? []), cue.id]))
          : activePlan.completedItemIds ?? [];
        savePlan({
          ...activePlan,
          selectedItemId: cue.id,
          completedItemIds: completed,
          lastSentItemId: cue.id,
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
      console.warn("[DockPlannerTab] Cue send failed:", err);
    } finally {
      setSending(false);
    }
  }, [activePlan, onStage, savePlan]);

  const previewCue = useCallback((cue: ServicePlanItem) => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      void sendCue(cue, false);
    }, 210);
  }, [sendCue]);

  const programCue = useCallback((cue: ServicePlanItem) => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void sendCue(cue, true);
  }, [sendCue]);

  const moveSelection = useCallback((direction: -1 | 1) => {
    if (!activePlan || activePlan.items.length === 0) return;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), activePlan.items.length - 1);
    const next = activePlan.items[nextIndex];
    if (!next) return;
    patchActivePlan({ selectedItemId: next.id });
  }, [activePlan, patchActivePlan, selectedIndex]);

  const addQuickPoint = useCallback(() => {
    if (!activePlan || !quickPoint.trim()) return;
    const cue = createServicePlanItem({
      type: "sermon",
      sourceKind: "sermon-point",
      label: quickPoint.trim().slice(0, 80),
      payloadSnapshot: {
        text: quickPoint.trim(),
        itemType: "point",
        overlayMode: "lower-third",
      },
      lastResolvedAt: Date.now(),
    });
    savePlan({
      ...activePlan,
      items: [...activePlan.items, cue],
      selectedItemId: cue.id,
      updatedAt: Date.now(),
    });
    setQuickPoint("");
  }, [activePlan, quickPoint, savePlan]);

  if (!activePlan) {
    return (
      <div className="dock-module dock-planner">
        <div className="dock-planner-empty">
          <Icon name="event_note" size={22} />
          <div className="dock-planner-empty__title">No active service plan</div>
          <div className="dock-planner-empty__body">
            Create a plan in the main app, then it will appear here for live operation.
          </div>
          <button
            type="button"
            className="dock-btn dock-btn--preview dock-btn--block"
            onClick={() => dockClient.sendCommand({ type: "request-service-plans", timestamp: Date.now() })}
          >
            Refresh planner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dock-module dock-planner">
      <div className="dock-planner-header">
        <div>
          <div className="dock-section-label">Service Planner</div>
          <div className="dock-planner-title">{activePlan.title}</div>
          <div className="dock-planner-meta">
            {planDateLabel(activePlan.serviceDate)} · {activePlan.items.length} cues
          </div>
        </div>
        <select
          className="dock-planner-select"
          value={activePlan.id}
          onChange={(event) => setActivePlanId(event.target.value)}
          aria-label="Select service plan"
        >
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>{plan.title}</option>
          ))}
        </select>
      </div>

      <div className="dock-planner-now">
        <div>
          <div className="dock-planner-now__label">Current</div>
          <div className="dock-planner-now__title">{selectedCue?.label ?? "No cue selected"}</div>
          <div className="dock-planner-now__meta">
            {selectedCue ? `${cueKindLabel(selectedCue.type)} · ${selectedCue.subtitle || "Snapshot cue"}` : "Select a cue below"}
          </div>
        </div>
        <div className="dock-planner-now__actions">
          <button type="button" onClick={() => moveSelection(-1)} disabled={selectedIndex <= 0}>
            Prev
          </button>
          <button type="button" onClick={() => moveSelection(1)} disabled={!nextCue}>
            Next
          </button>
        </div>
      </div>

      <div className="dock-search-field dock-planner-search">
        <Icon name="search" size={14} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter cues..."
          aria-label="Filter planner cues"
        />
        {filter && (
          <button type="button" onClick={() => setFilter("")} aria-label="Clear planner filter">
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      <div className="dock-planner-cues" aria-label="Service plan cues">
        {filteredItems.length === 0 && (
          <div className="dock-planner-empty dock-planner-empty--compact">No cues match this filter.</div>
        )}
        {filteredItems.map((cue, index) => {
          const isSelected = activePlan.selectedItemId === cue.id || (!activePlan.selectedItemId && index === 0);
          const isCompleted = activePlan.completedItemIds?.includes(cue.id);
          return (
            <div
              key={cue.id}
              role="button"
              tabIndex={0}
              className={`dock-planner-cue${isSelected ? " dock-planner-cue--active" : ""}${isCompleted ? " dock-planner-cue--done" : ""}`}
              onClick={() => previewCue(cue)}
              onDoubleClick={() => programCue(cue)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  previewCue(cue);
                }
              }}
            >
              <span className="dock-planner-cue__index">{activePlan.items.findIndex((item) => item.id === cue.id) + 1}</span>
              <span className="dock-planner-cue__body">
                <span className="dock-planner-cue__top">
                  <span className={`dock-planner-cue__type dock-planner-cue__type--${cue.type}`}>
                    {cueKindLabel(cue.type)}
                  </span>
                  {isCompleted && <span className="dock-planner-cue__done">Done</span>}
                </span>
                <span className="dock-planner-cue__title">{cue.label}</span>
                <span className="dock-planner-cue__subtitle">{cue.subtitle || cue.notes || "Snapshot cue"}</span>
              </span>
              <button
                type="button"
                className="dock-planner-cue__edit"
                aria-label={`Edit ${cue.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  startEditCue(cue);
                }}
              >
                <Icon name="edit" size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="dock-planner-footer">
        <div className="dock-planner-hint">
          Click previews · Double-click Program · Next/Prev moves selection
        </div>
        <div className="dock-planner-quickadd">
          <input
            value={quickPoint}
            onChange={(event) => setQuickPoint(event.target.value)}
            placeholder="Quick point cue..."
            aria-label="Quick point cue"
          />
          <button type="button" onClick={addQuickPoint} disabled={!quickPoint.trim()}>
            Add
          </button>
        </div>
        {actionError && <div className="dock-error-msg">{actionError}</div>}
        {sending && <div className="dock-planner-sending">Sending cue...</div>}
      </div>

      {editingCueId && (
        <div className="dock-modal-backdrop" role="presentation">
          <div className="dock-modal dock-planner-edit-modal" role="dialog" aria-modal="true" aria-label="Edit cue">
            <div className="dock-modal__header">
              <div>
                <div className="dock-section-label">Planner cue</div>
                <div className="dock-modal__title">Edit cue</div>
              </div>
              <button type="button" className="dock-modal__close" onClick={() => setEditingCueId("")} aria-label="Close">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-planner-edit-form">
              <label>
                <span>Label</span>
                <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
              </label>
              <label>
                <span>Subtitle</span>
                <input value={draftSubtitle} onChange={(event) => setDraftSubtitle(event.target.value)} />
              </label>
              <label>
                <span>Notes</span>
                <textarea value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} rows={4} />
              </label>
            </div>
            <div className="dock-modal__actions">
              <button type="button" className="dock-btn dock-btn--ghost" onClick={() => setEditingCueId("")}>Cancel</button>
              <button type="button" className="dock-btn dock-btn--preview" onClick={commitEditCue}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
