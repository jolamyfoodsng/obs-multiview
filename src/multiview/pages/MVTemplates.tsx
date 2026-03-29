/**
 * MVTemplates.tsx — Template Gallery
 *
 * v2: Uses TemplateDefinition from templates.ts.
 * Users browse templates by category, preview layout, and create a new layout from a template.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as db from "../mvStore";
import { TEMPLATE_LIBRARY, createLayoutFromTemplate } from "../templates";
import type { TemplateCategory, TemplateDefinition } from "../types";
import Icon from "../../components/Icon";

const CATEGORY_LABELS: Record<TemplateCategory | "all", string> = {
  all: "All Templates",
  sermon: "Sermon",
  worship: "Worship",
  announcement: "Announcement",
  ceremony: "Ceremony",
  "multi-camera": "Multi-Camera",
  youth: "Youth",
  kids: "Kids Church",
  custom: "Custom",
};

const CATEGORY_ICONS: Record<TemplateCategory | "all", string> = {
  all: "apps",
  sermon: "church",
  worship: "music_note",
  announcement: "campaign",
  ceremony: "celebration",
  "multi-camera": "videocam",
  youth: "groups",
  kids: "child_care",
  custom: "tune",
};

/** Region type → fill color for SVG preview */
function regionColor(type: string): string {
  switch (type) {
    case "obs-scene": return "#6c5ce7";
    case "video-input": return "#0078d4";
    case "image-overlay": return "#00bcd4";
    case "media": return "#9c27b0";
    case "browser": return "#ff5722";
    case "color": return "#78909c";
    default: return "#666";
  }
}

export function MVTemplates() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TemplateCategory | "all">("all");
  const [creating, setCreating] = useState<string | null>(null);

  const filtered =
    filter === "all"
      ? TEMPLATE_LIBRARY
      : TEMPLATE_LIBRARY.filter((t) => t.category === filter);

  const categories: (TemplateCategory | "all")[] = [
    "all",
    "sermon",
    "worship",
    "announcement",
    "ceremony",
    "multi-camera",
    "youth",
    "kids",
    "custom",
  ];

  // ── Create layout from template ──────────────────────────
  const handleUseTemplate = async (tpl: TemplateDefinition) => {
    setCreating(tpl.id);
    try {
      const layout = createLayoutFromTemplate(tpl);
      await db.saveLayout(layout);
      navigate(`/edit/${layout.id}`);
    } catch (err) {
      console.error("[MVTemplates] Failed to create layout from template:", err);
      setCreating(null);
    }
  };

  return (
    <div className="mv-page mv-templates">
      <header className="mv-page-header">
        <div>
          <h1 className="mv-page-title">Templates</h1>
          <p className="mv-page-subtitle">
            Pick a preset layout for your broadcast — instant, ready to use.
          </p>
        </div>

        <div className="mv-page-actions">
          <button
            className="mv-btn mv-btn--outline"
            type="button"
            onClick={() => navigate("/templates/themes")}
          >
            <Icon name="palette" size={16} />
            OBS Themes
          </button>
        </div>
      </header>

      {/* ── Category filter tabs ── */}
      <div className="mv-template-filters">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`mv-template-filter ${filter === cat ? "mv-template-filter--active" : ""}`}
            onClick={() => setFilter(cat)}
          >
            <Icon name={CATEGORY_ICONS[cat]} size={16} />
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* ── Template grid ── */}
      <div className="mv-template-grid">
        {filtered.map((tpl) => (
          <div key={tpl.id} className="mv-template-card" style={{ borderColor: tpl.accentColor + "40" }}>
            {/* Preview */}
            <div className="mv-template-preview" style={{ background: tpl.background.color }}>
              <svg
                viewBox={`0 0 ${tpl.canvas.width} ${tpl.canvas.height}`}
                className="mv-card-svg"
              >
                <rect width={tpl.canvas.width} height={tpl.canvas.height} fill={tpl.background.color} />
                {/* Safe frame hint */}
                {tpl.safeFrame.enabled && (
                  <rect
                    x={tpl.safeFrame.left}
                    y={tpl.safeFrame.top}
                    width={tpl.canvas.width - tpl.safeFrame.left - tpl.safeFrame.right}
                    height={tpl.canvas.height - tpl.safeFrame.top - tpl.safeFrame.bottom}
                    fill="none"
                    stroke="rgba(255,200,0,0.2)"
                    strokeWidth={3}
                    strokeDasharray="10,5"
                  />
                )}
                {tpl.regions.map((r) => (
                  <rect
                    key={r.id}
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill={regionColor(r.type)}
                    opacity={0.65}
                    rx={r.borderRadius || 4}
                  />
                ))}
              </svg>
            </div>

            {/* Info */}
            <div className="mv-template-info">
              <div className="mv-template-title-row">
                <Icon name={tpl.icon} size={18} style={{ color: tpl.accentColor }} />
                <span className="mv-template-name">{tpl.name}</span>
              </div>
              <p className="mv-template-desc">{tpl.description}</p>
              <div className="mv-template-tags">
                {tpl.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="mv-template-tag">{tag}</span>
                ))}
              </div>
            </div>

            {/* Action */}
            <button
              className="mv-btn mv-btn--primary mv-btn--sm mv-template-use-btn"
              onClick={() => handleUseTemplate(tpl)}
              disabled={creating === tpl.id}
            >
              {creating === tpl.id ? (
                <><span className="loading-spinner-sm" /> Creating...</>
              ) : (
                <><Icon name="add" size={16} /> Use Template</>
              )}
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mv-empty">
          <Icon name="search_off" size={48} style={{ opacity: 0.3 }} />
          <p>No templates in this category yet.</p>
        </div>
      )}
    </div>
  );
}
