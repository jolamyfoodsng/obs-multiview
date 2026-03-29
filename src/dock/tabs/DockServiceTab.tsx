/**
 * DockServiceTab.tsx — Service Plan Checklist for the OBS Dock
 *
 * Loads service plans from the overlay server (synced as dock-service-plans.json).
 * The user selects a plan and works through it as an ordered checklist
 * during a live service.
 */

import { useState, useEffect, useCallback } from "react";
import Icon from "../DockIcon";

// ---------------------------------------------------------------------------
// Types (mirrored from servicePlanDb – dock can't import Tauri modules)
// ---------------------------------------------------------------------------

interface ServicePlanItem {
  id: string;
  type: string;
  label: string;
  details: string;
  durationSec?: number;
  completed?: boolean;
  meta?: Record<string, unknown>;
}

interface ServicePlan {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: ServicePlanItem[];
  notes?: string;
}

const TYPE_ICONS: Record<string, string> = {
  media: "play_circle",
  worship: "music_note",
  bible: "auto_stories",
  speaker: "person",
  sermon: "record_voice_over",
  prayer: "self_improvement",
  offering: "volunteer_activism",
  announcement: "campaign",
  custom: "edit_note",
};

function iconFor(type: string): string {
  return TYPE_ICONS[type] ?? "radio_button_unchecked";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DockServiceTab() {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [activePlan, setActivePlan] = useState<ServicePlan | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // ── Load plans from the overlay server ──
  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/uploads/dock-service-plans.json");
      if (!res.ok) { setPlans([]); return; }
      const data = await res.json();
      if (Array.isArray(data)) {
        setPlans(data as ServicePlan[]);
      }
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Toggle item checked ──
  const toggleCheck = useCallback((itemId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // ── Plan selection view ──
  if (!activePlan) {
    return (
      <div className="dock-service-tab">
        <div className="dock-section-label">Load Service Plan</div>

        {loading && (
          <div className="dock-service-empty">
            <Icon name="sync" size={20} className="dock-spin" />
            <span>Loading plans…</span>
          </div>
        )}

        {!loading && plans.length === 0 && (
          <div className="dock-service-empty">
            <Icon name="playlist_add" size={28} style={{ opacity: 0.3 }} />
            <span>No service plans found.<br/>Create one in OBS Church Studio → Dashboard.</span>
            <button className="dock-btn dock-btn--preview" onClick={loadPlans} style={{ marginTop: 8, width: "100%" }}>
              <Icon name="refresh" size={20} />
              Refresh
            </button>
          </div>
        )}

        {!loading && plans.length > 0 && (
          <div className="dock-service-list">
            {plans.map((plan) => (
              <button
                key={plan.id}
                className="dock-service-plan-btn"
                onClick={() => { setActivePlan(plan); setCheckedIds(new Set()); }}
              >
                <Icon name="assignment" size={16} />
                <div className="dock-service-plan-info">
                  <span className="dock-service-plan-name">{plan.name}</span>
                  <span className="dock-service-plan-meta">
                    {plan.items.length} items · {new Date(plan.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <Icon name="chevron_right" size={14} style={{ opacity: 0.4 }} />
              </button>
            ))}
            <button className="dock-btn dock-btn--preview" onClick={loadPlans} style={{ marginTop: 6, width: "100%" }}>
              <Icon name="refresh" size={20} />
              Refresh
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Active plan checklist view ──
  const completedCount = checkedIds.size;
  const totalCount = activePlan.items.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="dock-service-tab">
      {/* Header */}
      <div className="dock-service-header">
        <button className="dock-service-back" onClick={() => setActivePlan(null)}>
          <Icon name="arrow_back" size={14} />
        </button>
        <div className="dock-service-header-info">
          <span className="dock-service-header-name">{activePlan.name}</span>
          <span className="dock-service-header-progress">
            {completedCount}/{totalCount} · {progressPct}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="dock-service-progress-bar">
        <div className="dock-service-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Checklist */}
      <div className="dock-service-checklist">
        {activePlan.items.map((item, idx) => {
          const checked = checkedIds.has(item.id);
          return (
            <button
              key={item.id}
              className={`dock-service-item${checked ? " dock-service-item--done" : ""}`}
              onClick={() => toggleCheck(item.id)}
            >
              <span className="dock-service-item-num">{idx + 1}</span>
              <Icon name={checked ? "check_circle" : iconFor(item.type)} size={14} className="dock-service-item-icon" />
              <div className="dock-service-item-text">
                <span className="dock-service-item-label">{item.label}</span>
                {item.details && (
                  <span className="dock-service-item-details">{item.details}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Reset */}
      {completedCount > 0 && (
        <button
          className="dock-btn dock-btn--preview"
          onClick={() => setCheckedIds(new Set())}
          style={{ marginTop: 8, width: "100%" }}
        >
          <Icon name="replay" size={20} />
          Reset Checklist
        </button>
      )}
    </div>
  );
}
