/**
 * ServicePlanBuilder.tsx — Service Plan Builder
 *
 * Lets users create and edit a structured service plan.
 * Users add items in order: welcome media, worship, bible, speaker, etc.
 * Plans are saved to IndexedDB and synced to the dock for loading.
 */

import { useState, useEffect, useCallback } from "react";
import {
  type ServicePlan,
  type ServicePlanItem,
  type ServicePlanItemType,
  getAllPlans,
  savePlan,
  deletePlan,
  duplicatePlan,
  createEmptyPlan,
  createPlanItem,
  planItemIcon,
  planItemTypeLabel,
} from "../services/servicePlanDb";
import Icon from "./Icon";

// ---------------------------------------------------------------------------
// Item type options for the "Add Item" menu
// ---------------------------------------------------------------------------

const ITEM_TYPES: { type: ServicePlanItemType; label: string; icon: string }[] = [
  { type: "media", label: "Welcome Media", icon: "play_circle" },
  { type: "worship", label: "Worship Song", icon: "music_note" },
  { type: "bible", label: "Bible Reading", icon: "auto_stories" },
  { type: "speaker", label: "Speaker", icon: "person" },
  { type: "sermon", label: "Sermon Point", icon: "record_voice_over" },
  { type: "prayer", label: "Prayer", icon: "self_improvement" },
  { type: "offering", label: "Offering / Giving", icon: "volunteer_activism" },
  { type: "announcement", label: "Announcement", icon: "campaign" },
  { type: "custom", label: "Custom Item", icon: "edit_note" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServicePlanBuilder() {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [activePlan, setActivePlan] = useState<ServicePlan | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");

  // ── Load plans ──
  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = useCallback(async () => {
    const all = await getAllPlans();
    setPlans(all);
  }, []);

  // ── Create plan ──
  const handleCreatePlan = useCallback(async () => {
    const name = newPlanName.trim() || "Sunday Service";
    const plan = createEmptyPlan(name);
    await savePlan(plan);
    setNewPlanName("");
    setShowNewPlan(false);
    await loadPlans();
    setActivePlan(plan);
  }, [newPlanName, loadPlans]);

  // ── Delete plan ──
  const handleDeletePlan = useCallback(async (id: string) => {
    if (!confirm("Delete this service plan?")) return;
    await deletePlan(id);
    if (activePlan?.id === id) setActivePlan(null);
    await loadPlans();
  }, [activePlan, loadPlans]);

  // ── Duplicate plan ──
  const handleDuplicatePlan = useCallback(async (id: string) => {
    const dupe = await duplicatePlan(id);
    if (dupe) {
      await loadPlans();
      setActivePlan(dupe);
    }
  }, [loadPlans]);

  // ── Add item ──
  const handleAddItem = useCallback(async (type: ServicePlanItemType) => {
    if (!activePlan) return;
    const label = planItemTypeLabel(type);
    const item = createPlanItem(type, label);
    const updated: ServicePlan = {
      ...activePlan,
      items: [...activePlan.items, item],
    };
    await savePlan(updated);
    setActivePlan(updated);
    setShowAddMenu(false);
    setEditingItemId(item.id);
    await loadPlans();
  }, [activePlan, loadPlans]);

  // ── Update item ──
  const handleUpdateItem = useCallback(async (itemId: string, patch: Partial<ServicePlanItem>) => {
    if (!activePlan) return;
    const updated: ServicePlan = {
      ...activePlan,
      items: activePlan.items.map((it) =>
        it.id === itemId ? { ...it, ...patch } : it
      ),
    };
    await savePlan(updated);
    setActivePlan(updated);
    await loadPlans();
  }, [activePlan, loadPlans]);

  // ── Remove item ──
  const handleRemoveItem = useCallback(async (itemId: string) => {
    if (!activePlan) return;
    const updated: ServicePlan = {
      ...activePlan,
      items: activePlan.items.filter((it) => it.id !== itemId),
    };
    await savePlan(updated);
    setActivePlan(updated);
    await loadPlans();
  }, [activePlan, loadPlans]);

  // ── Move item up/down ──
  const handleMoveItem = useCallback(async (itemId: string, direction: "up" | "down") => {
    if (!activePlan) return;
    const idx = activePlan.items.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= activePlan.items.length) return;
    const items = [...activePlan.items];
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    const updated: ServicePlan = { ...activePlan, items };
    await savePlan(updated);
    setActivePlan(updated);
    await loadPlans();
  }, [activePlan, loadPlans]);

  // ── Plan list view ──
  if (!activePlan) {
    return (
      <div className="splan-section">
        <div className="splan-header">
          <h3 className="dash-modules-heading">
            <Icon name="assignment" size={20} />
            Service Plans
          </h3>
          <button
            className="splan-new-btn"
            onClick={() => setShowNewPlan(true)}
          >
            <Icon name="add" size={20} />
            New Plan
          </button>
        </div>

        {/* New plan form */}
        {showNewPlan && (
          <div className="splan-new-form">
            <input
              className="splan-input"
              placeholder="Service name (e.g. Sunday Morning)"
              value={newPlanName}
              onChange={(e) => setNewPlanName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreatePlan(); }}
              autoFocus
            />
            <div className="splan-new-form-actions">
              <button className="splan-btn splan-btn--secondary" onClick={() => setShowNewPlan(false)}>
                Cancel
              </button>
              <button className="splan-btn splan-btn--primary" onClick={handleCreatePlan}>
                Create
              </button>
            </div>
          </div>
        )}

        {/* Plan list */}
        {plans.length === 0 && !showNewPlan && (
          <div className="splan-empty">
            <Icon name="playlist_add" size={20} />
            <p>No service plans yet. Create one to organize your service flow.</p>
          </div>
        )}

        <div className="splan-list">
          {plans.map((plan) => (
            <div key={plan.id} className="splan-card" onClick={() => setActivePlan(plan)}>
              <div className="splan-card-info">
                <h4 className="splan-card-name">{plan.name}</h4>
                <p className="splan-card-meta">
                  {plan.items.length} items · Updated {new Date(plan.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="splan-card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="splan-icon-btn"
                  onClick={() => handleDuplicatePlan(plan.id)}
                  title="Duplicate"
                >
                  <Icon name="content_copy" size={20} />
                </button>
                <button
                  className="splan-icon-btn splan-icon-btn--danger"
                  onClick={() => handleDeletePlan(plan.id)}
                  title="Delete"
                >
                  <Icon name="delete" size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Plan editor view ──
  return (
    <div className="splan-section">
      <div className="splan-header">
        <button
          className="splan-back-btn"
          onClick={() => setActivePlan(null)}
        >
          <Icon name="arrow_back" size={20} />
          Back to Plans
        </button>
        <h3 className="dash-modules-heading" style={{ flex: 1 }}>
          {activePlan.name}
        </h3>
        <span className="splan-item-count">
          {activePlan.items.length} items
        </span>
      </div>

      {/* Items list */}
      <div className="splan-items">
        {activePlan.items.length === 0 && (
          <div className="splan-empty">
            <Icon name="playlist_add" size={20} />
            <p>No items yet. Use the "Add Item" button below to build your service flow.</p>
          </div>
        )}

        {activePlan.items.map((item, idx) => (
          <div key={item.id} className="splan-item">
            <div className="splan-item-order">{idx + 1}</div>
            <div className={`splan-item-icon splan-item-icon--${item.type}`}>
              <Icon name={planItemIcon(item.type)} size={20} />
            </div>
            <div className="splan-item-content">
              {editingItemId === item.id ? (
                <>
                  <input
                    className="splan-input splan-input--sm"
                    value={item.label}
                    onChange={(e) => handleUpdateItem(item.id, { label: e.target.value })}
                    placeholder="Item name"
                    autoFocus
                  />
                  <input
                    className="splan-input splan-input--sm"
                    value={item.details}
                    onChange={(e) => handleUpdateItem(item.id, { details: e.target.value })}
                    placeholder="Details (e.g. song name, verse reference, speaker)"
                    onKeyDown={(e) => { if (e.key === "Enter") setEditingItemId(null); }}
                  />
                  <button
                    className="splan-btn splan-btn--xs"
                    onClick={() => setEditingItemId(null)}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <span className="splan-item-label">{item.label}</span>
                  {item.details && (
                    <span className="splan-item-details">{item.details}</span>
                  )}
                </>
              )}
            </div>
            <div className="splan-item-actions">
              <button
                className="splan-icon-btn"
                onClick={() => setEditingItemId(editingItemId === item.id ? null : item.id)}
                title="Edit"
              >
                <Icon name="edit" size={20} />
              </button>
              <button
                className="splan-icon-btn"
                onClick={() => handleMoveItem(item.id, "up")}
                disabled={idx === 0}
                title="Move up"
              >
                <Icon name="arrow_upward" size={20} />
              </button>
              <button
                className="splan-icon-btn"
                onClick={() => handleMoveItem(item.id, "down")}
                disabled={idx === activePlan.items.length - 1}
                title="Move down"
              >
                <Icon name="arrow_downward" size={20} />
              </button>
              <button
                className="splan-icon-btn splan-icon-btn--danger"
                onClick={() => handleRemoveItem(item.id)}
                title="Remove"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add item button + menu */}
      <div className="splan-add-wrap">
        <button
          className="splan-add-btn"
          onClick={() => setShowAddMenu(!showAddMenu)}
        >
          <Icon name="add_circle" size={20} />
          Add Item
        </button>

        {showAddMenu && (
          <div className="splan-add-menu">
            {ITEM_TYPES.map((opt) => (
              <button
                key={opt.type}
                className="splan-add-menu-item"
                onClick={() => handleAddItem(opt.type)}
              >
                <Icon name={opt.icon} size={20} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
