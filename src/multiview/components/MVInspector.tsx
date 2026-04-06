/**
 * MVInspector.tsx — Right panel: Property editor for selected region
 *
 * v3: Content-type aware editing with Bible/Worship theme selectors,
 *     font controls, and locked width/height fields.
 */

import { useState, useEffect } from "react";
import { useEditor } from "../editorStore";
import { regionTypeLabel, regionTypeIcon, type Region, type RegionConstraints } from "../types";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { DEFAULT_THEME_SETTINGS, type BibleTheme, type BibleThemeSettings } from "../../bible/types";
import { getCustomThemes, saveCustomTheme } from "../../bible/bibleDb";
import { LT_THEMES, LT_BIBLE_THEMES, LT_WORSHIP_THEMES, LT_GENERAL_THEMES, getLTThemeById } from "../../lowerthirds/themes";
import type { LowerThirdTheme, LTVariable } from "../../lowerthirds/types";
import Icon from "../../components/Icon";

// ─────────────────────────────────────────────────────────────────────────────
// Content type that a slot can hold
// ─────────────────────────────────────────────────────────────────────────────

type SlotContentType = "obs" | "bible" | "worship" | "lower-third";

// ─────────────────────────────────────────────────────────────────────────────
// Dummy worship themes (mirroring Bible theme structure)
// ─────────────────────────────────────────────────────────────────────────────

const WORSHIP_THEMES: BibleTheme[] = [
  {
    id: "worship-classic", name: "Classic Worship",
    description: "Traditional worship lyrics display with dark background.",
    source: "builtin", templateType: "fullscreen",
    settings: {
      ...DEFAULT_THEME_SETTINGS,
      fontFamily: '"CMG Sans", sans-serif', fontSize: 52, fontWeight: "bold",
      fontColor: "#FFFFFF", lineHeight: 1.7, textAlign: "center",
      textShadow: "0 2px 12px rgba(0,0,0,0.8)", textOutline: false,
      textOutlineColor: "#000000", textOutlineWidth: 0, textTransform: "none",
      refFontSize: 22, refFontColor: "#aaaaaa", refFontWeight: "normal", refPosition: "bottom",
      backgroundColor: "#0a0a14", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1,
      logoUrl: "", logoPosition: "bottom-right", logoSize: 60,
      padding: 80, safeArea: 50, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "",
      lowerThirdSize: "medium", animation: "fade", animationDuration: 500,
    },
    createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "worship-modern", name: "Modern Worship",
    description: "Bold modern lyrics with slide-up animation.",
    source: "builtin", templateType: "fullscreen",
    settings: {
      ...DEFAULT_THEME_SETTINGS,
      fontFamily: '"CMG Sans Bold", "CMG Sans", sans-serif', fontSize: 56, fontWeight: "bold",
      fontColor: "#FFFFFF", lineHeight: 1.6, textAlign: "center",
      textShadow: "0 4px 20px rgba(0,0,0,0.9)", textOutline: true,
      textOutlineColor: "rgba(0,0,0,0.3)", textOutlineWidth: 1, textTransform: "uppercase",
      refFontSize: 20, refFontColor: "#d4af37", refFontWeight: "bold", refPosition: "bottom",
      backgroundColor: "#000000", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1,
      logoUrl: "", logoPosition: "bottom-right", logoSize: 60,
      padding: 100, safeArea: 60, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "",
      lowerThirdSize: "medium", animation: "slide-up", animationDuration: 600,
    },
    createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "worship-minimal", name: "Minimal Worship",
    description: "Clean minimal lyrics for projectors.",
    source: "builtin", templateType: "fullscreen",
    settings: {
      ...DEFAULT_THEME_SETTINGS,
      fontFamily: '"CMG Sans Light", "CMG Sans", sans-serif', fontSize: 44, fontWeight: "light",
      fontColor: "#333333", lineHeight: 1.5, textAlign: "center",
      textShadow: "none", textOutline: false,
      textOutlineColor: "#000000", textOutlineWidth: 0, textTransform: "none",
      refFontSize: 18, refFontColor: "#888888", refFontWeight: "normal", refPosition: "bottom",
      backgroundColor: "#f8f8f8", backgroundImage: "", backgroundVideo: "", backgroundOpacity: 1,
      logoUrl: "", logoPosition: "bottom-right", logoSize: 50,
      padding: 80, safeArea: 50, borderRadius: 0, boxBackground: "transparent", boxOpacity: 0, boxBackgroundImage: "",
      lowerThirdSize: "medium", animation: "fade", animationDuration: 300,
    },
    createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
];

// ── Font families ──
const FONT_FAMILIES = [
  { label: "CMG Sans", value: '"CMG Sans", sans-serif' },
  { label: "CMG Sans Bold", value: '"CMG Sans Bold", "CMG Sans", sans-serif' },
  { label: "CMG Sans Light", value: '"CMG Sans Light", "CMG Sans", sans-serif' },
  { label: "Inter", value: '"Inter", sans-serif' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
];

// ── Responsive font sizing ──
const MAX_FONT_SIZE = 150;
const MIN_FONT_SIZE = 16;

function computeResponsiveFontSize(slotW: number, slotH: number, baseFontSize: number): number {
  const scale = Math.min(slotW / 1920, slotH / 1080);
  const scaled = Math.round(baseFontSize * scale);
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, scaled));
}

export function MVInspector() {
  const { state, updateRegion } = useEditor();

  const regions = state.layout?.regions ?? [];
  const selected = regions.filter((r) => state.selectedRegionIds.includes(r.id));

  // Per-region transient UI state (only for content type switching & theme picker visibility)
  const [contentTypes, setContentTypes] = useState<Record<string, SlotContentType>>({});
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [changingType, setChangingType] = useState(false);
  const [customThemes, setCustomThemes] = useState<BibleTheme[]>([]);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [editingSettings, setEditingSettings] = useState<BibleThemeSettings | null>(null);
  const [editingThemeName, setEditingThemeName] = useState("");

  // Load custom themes from IndexedDB
  useEffect(() => {
    let cancelled = false;
    getCustomThemes().then((themes) => { if (!cancelled) setCustomThemes(themes); }).catch(() => {});
    return () => { cancelled = true; };
  }, [showThemePicker, themeEditorOpen]);

  if (selected.length === 0) {
    return (
      <div className="mv-inspector mv-inspector--empty">
        <Icon name="touch_app" size={32} style={{ opacity: 0.25 }} />
        <p>Select a slot to edit its properties</p>
      </div>
    );
  }

  if (selected.length > 1) {
    return (
      <div className="mv-inspector mv-inspector--multi">
        <div className="mv-inspector-header">
          <Icon name="select_all" size={20} />
          <span>{selected.length} slots selected</span>
        </div>
        <p className="mv-inspector-hint">Select a single slot to edit properties.</p>
      </div>
    );
  }

  const region = selected[0];
  const con = region.constraints;
  const rid = region.id;

  const update = (changes: Partial<Region>) => { updateRegion(region.id, changes); };

  // Content type for this region — detect from name if slot already has content
  const isBibleAssigned = region.name?.startsWith("Bible:");
  const isWorshipAssigned = region.name?.startsWith("Worship:");
  const isLTAssigned = region.name?.startsWith("LT:");
  const hasSceneAssigned = region.type === "obs-scene" && !!(region as any).sceneName;
  const isSlotFilled = isBibleAssigned || isWorshipAssigned || isLTAssigned || hasSceneAssigned;

  // Infer locked content type from what's assigned
  const inferredType: SlotContentType = isBibleAssigned ? "bible" : isWorshipAssigned ? "worship" : isLTAssigned ? "lower-third" : "obs";
  const contentType: SlotContentType = isSlotFilled ? inferredType : (contentTypes[rid] ?? "obs");
  const setContentType = (type: SlotContentType) => {
    // If switching away from current content, disconnect (clear all theme/scene data)
    if (isSlotFilled && type !== inferredType) {
      update({
        name: region.slotLabel || regionTypeLabel(region.type),
        themeId: undefined,
        themeSettings: undefined,
        fontOverrides: undefined,
        sceneName: undefined,
        sceneIndex: undefined,
      } as any);
    }
    setContentTypes((prev) => ({ ...prev, [rid]: type }));
    setChangingType(false);
    if ((type === "bible" || type === "worship") && !region.themeId) {
      // Auto-assign the first theme when switching content type
      const defaults = type === "bible" ? BUILTIN_THEMES : WORSHIP_THEMES;
      const theme = defaults[0];
      const fs = computeResponsiveFontSize(region.width, region.height, theme.settings.fontSize);
      update({
        name: `${type === "bible" ? "Bible" : "Worship"}: ${theme.name}`,
        themeId: theme.id,
        themeSettings: { ...theme.settings },
        fontOverrides: { fontSize: fs, textTransform: theme.settings.textTransform || "none", fontFamily: theme.settings.fontFamily },
      } as any);
    }
    if (type === "lower-third" && !region.themeId) {
      // Auto-assign the first LT theme
      const ltTheme = LT_THEMES[0];
      const defaults: Record<string, string> = {};
      ltTheme.variables.forEach((v) => { defaults[v.key] = v.defaultValue; });
      update({
        name: `LT: ${ltTheme.name}`,
        themeId: ltTheme.id,
        ltValues: defaults,
      } as any);
    }
  };

  // Disconnect: clear all content and revert to empty slot
  const disconnectContent = () => {
    update({
      name: region.slotLabel || regionTypeLabel(region.type),
      themeId: undefined,
      themeSettings: undefined,
      fontOverrides: undefined,
      sceneName: undefined,
      sceneIndex: undefined,
    } as any);
    setContentTypes((prev) => ({ ...prev, [rid]: "obs" }));
    setChangingType(false);
  };

  // Select a theme — persists immediately to region
  const selectTheme = (theme: BibleTheme) => {
    const fs = computeResponsiveFontSize(region.width, region.height, theme.settings.fontSize);
    update({
      name: `${contentType === "bible" ? "Bible" : "Worship"}: ${theme.name}`,
      themeId: theme.id,
      themeSettings: { ...theme.settings },
      fontOverrides: { fontSize: fs, textTransform: theme.settings.textTransform || "none", fontFamily: theme.settings.fontFamily },
    } as any);
    setShowThemePicker(false);
  };

  // Read theme state from region (persisted)
  const allThemes = contentType === "bible" ? [...BUILTIN_THEMES, ...customThemes] : WORSHIP_THEMES;
  const currentTheme = region.themeId
    ? allThemes.find((t) => t.id === region.themeId)
      // Also check persisted themeSettings directly (custom theme may have been saved with region data)
      ?? (region.themeSettings ? { id: region.themeId, name: region.name?.replace(/^(Bible|Worship):\s*/, "") ?? "Custom", description: "Custom theme", source: "custom" as const, templateType: "fullscreen" as const, settings: region.themeSettings, createdAt: "", updatedAt: "" } : null)
    : null;
  const currentFont = region.fontOverrides ?? {};
  const themeList = allThemes;

  return (
    <div className="mv-inspector" role="complementary" aria-label="Slot inspector">
      {/* ── Header ── */}
      <div className="mv-inspector-header">
        <Icon name={regionTypeIcon(region.type)} size={20} />
        <span>{regionTypeLabel(region.type)}</span>
        {region.slotLabel && <span className="mv-inspector-slot-label">{region.slotLabel}</span>}
      </div>

      {/* ── Constraint indicators ── */}
      {con && (con.lockPosition || con.lockSize || con.lockDelete) && (
        <div className="mv-inspector-constraints">
          {con.lockPosition && <span className="mv-constraint-badge" title="Position locked by template"><Icon name="push_pin" size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />Position Locked</span>}
          {con.lockSize && <span className="mv-constraint-badge" title="Size locked by template"><Icon name="straighten" size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />Size Locked</span>}
          {con.lockDelete && <span className="mv-constraint-badge" title="Cannot be deleted"><Icon name="lock" size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />Protected</span>}
        </div>
      )}

      {/* ── Content Type Selector (locked when slot is filled) ── */}
      <div className="mv-inspector-section">
        <h4 className="mv-inspector-section-title">Content Type</h4>
        {isSlotFilled && !changingType ? (
          <div className="mv-content-type-locked">
            <span className="mv-content-type-badge">
              <Icon name={contentType === "obs" ? "videocam" : contentType === "bible" ? "menu_book" : contentType === "lower-third" ? "subtitles" : "music_note"} size={14} />
              {contentType === "obs" ? "OBS Scene" : contentType === "bible" ? "Bible" : contentType === "lower-third" ? "Lower Third" : "Worship"}
            </span>
            <button className="mv-btn mv-btn--ghost mv-btn--xs" onClick={disconnectContent}
              title="Remove content and revert to empty slot">
              <Icon name="link_off" size={14} /> Disconnect
            </button>
          </div>
        ) : (
          <div className="mv-content-type-selector">
            <button className={`mv-content-type-btn ${contentType === "obs" ? "mv-content-type-btn--active" : ""}`} onClick={() => setContentType("obs")}>
              <Icon name="videocam" size={16} /> OBS
            </button>
            <button className={`mv-content-type-btn ${contentType === "bible" ? "mv-content-type-btn--active" : ""}`} onClick={() => setContentType("bible")}>
              <Icon name="menu_book" size={16} /> Bible
            </button>
            <button className={`mv-content-type-btn ${contentType === "worship" ? "mv-content-type-btn--active" : ""}`} onClick={() => setContentType("worship")}>
              <Icon name="music_note" size={16} /> Worship
            </button>
            <button className={`mv-content-type-btn ${contentType === "lower-third" ? "mv-content-type-btn--active" : ""}`} onClick={() => setContentType("lower-third")}>
              <Icon name="subtitles" size={16} /> LT
            </button>
          </div>
        )}
      </div>

      {/* ── Name ── */}
      <div className="mv-inspector-section">
        <label className="mv-field-label">Name</label>
        <input className="mv-field-input" type="text" value={region.name} onChange={(e) => update({ name: e.target.value })} />
      </div>

      {/* ── Theme + Font Controls (BEFORE Transform for Bible/Worship) ── */}
      {contentType === "obs" && <TypeFields region={region} update={update} />}

      {(contentType === "bible" || contentType === "worship") && (
        <ThemePanel
          contentType={contentType}
          currentTheme={currentTheme}
          themeList={themeList}
          showThemePicker={showThemePicker}
          setShowThemePicker={setShowThemePicker}
          selectTheme={selectTheme}
          currentFont={currentFont}
          onFontSizeChange={(v) => update({ fontOverrides: { ...currentFont, fontSize: v } } as any)}
          onTextTransformChange={(v) => update({ fontOverrides: { ...currentFont, textTransform: v } } as any)}
          onFontFamilyChange={(v) => update({ fontOverrides: { ...currentFont, fontFamily: v } } as any)}
          onTextAlignChange={(v) => update({ fontOverrides: { ...currentFont, textAlign: v } } as any)}
          onVerticalAlignChange={(v) => update({ fontOverrides: { ...currentFont, verticalAlign: v } } as any)}
          onEditTheme={() => {
            if (currentTheme) {
              setEditingSettings({ ...currentTheme.settings });
              setEditingThemeName(currentTheme.name);
              setThemeEditorOpen(true);
            }
          }}
        />
      )}

      {/* ── Lower Third Theme + Variable Controls ── */}
      {contentType === "lower-third" && (
        <LTInspectorPanel region={region} update={update} />
      )}

      {/* ── Inline Theme Editor Modal ── */}
      {themeEditorOpen && editingSettings && (
        <div className="mv-modal-backdrop" onClick={() => setThemeEditorOpen(false)}>
          <div className="mv-modal mv-modal--lg" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflow: "auto" }}>
            <div className="mv-modal-header-row">
              <h3 className="mv-modal-title" style={{ margin: 0 }}>
                <Icon name="palette" size={20} style={{ marginRight: 8, verticalAlign: "middle" }} />
                Edit Theme: {editingThemeName}
              </h3>
              <button className="mv-modal-close" onClick={() => setThemeEditorOpen(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* Theme preview */}
            <div style={{ margin: "16px 0", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
              <div style={{
                background: editingSettings.backgroundColor,
                color: editingSettings.fontColor,
                fontFamily: editingSettings.fontFamily,
                fontSize: 18,
                fontWeight: editingSettings.fontWeight as any,
                lineHeight: editingSettings.lineHeight,
                textAlign: editingSettings.textAlign as "left" | "center" | "right",
                textShadow: editingSettings.textShadow,
                textTransform: editingSettings.textTransform as any,
                padding: 24,
                minHeight: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                For God so loved the world, that he gave his only begotten Son.
              </div>
            </div>

            <div className="mv-field-grid" style={{ gap: 12 }}>
              {/* Background Color */}
              <div className="mv-field">
                <label className="mv-field-label">Background</label>
                <input type="color" value={editingSettings.backgroundColor}
                  onChange={(e) => setEditingSettings({ ...editingSettings, backgroundColor: e.target.value })}
                  style={{ width: "100%", height: 32, cursor: "pointer", border: "none", borderRadius: 4 }} />
              </div>
              {/* Font Color */}
              <div className="mv-field">
                <label className="mv-field-label">Font Color</label>
                <input type="color" value={editingSettings.fontColor}
                  onChange={(e) => setEditingSettings({ ...editingSettings, fontColor: e.target.value })}
                  style={{ width: "100%", height: 32, cursor: "pointer", border: "none", borderRadius: 4 }} />
              </div>
              {/* Font Size */}
              <div className="mv-field">
                <label className="mv-field-label">Font Size: {editingSettings.fontSize}px</label>
                <input type="range" className="mv-slider" min={16} max={150} step={1}
                  value={editingSettings.fontSize}
                  onChange={(e) => setEditingSettings({ ...editingSettings, fontSize: parseInt(e.target.value) })} />
              </div>
              {/* Line Height */}
              <div className="mv-field">
                <label className="mv-field-label">Line Height: {editingSettings.lineHeight}</label>
                <input type="range" className="mv-slider" min={1} max={3} step={0.1}
                  value={editingSettings.lineHeight}
                  onChange={(e) => setEditingSettings({ ...editingSettings, lineHeight: parseFloat(e.target.value) })} />
              </div>
              {/* Font Family */}
              <div className="mv-field">
                <label className="mv-field-label">Font Family</label>
                <select className="mv-field-input" value={editingSettings.fontFamily}
                  onChange={(e) => setEditingSettings({ ...editingSettings, fontFamily: e.target.value })}>
                  {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              {/* Font Weight */}
              <div className="mv-field">
                <label className="mv-field-label">Font Weight</label>
                <select className="mv-field-input" value={editingSettings.fontWeight}
                  onChange={(e) => setEditingSettings({ ...editingSettings, fontWeight: e.target.value as "light" | "normal" | "bold" })}>
                  <option value="light">Light</option>
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </div>
              {/* Text Align */}
              <div className="mv-field">
                <label className="mv-field-label">Text Align</label>
                <div className="mv-text-transform-btns">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button key={a} className={`mv-text-transform-btn ${editingSettings.textAlign === a ? "mv-text-transform-btn--active" : ""}`}
                      onClick={() => setEditingSettings({ ...editingSettings, textAlign: a })}>
                      <Icon name={a === "left" ? "format_align_left" : a === "center" ? "format_align_center" : "format_align_right"} size={16} />
                    </button>
                  ))}
                </div>
              </div>
              {/* Text Transform */}
              <div className="mv-field">
                <label className="mv-field-label">Text Case</label>
                <div className="mv-text-transform-btns">
                  <button className={`mv-text-transform-btn ${editingSettings.textTransform === "none" ? "mv-text-transform-btn--active" : ""}`} onClick={() => setEditingSettings({ ...editingSettings, textTransform: "none" })}>Aa</button>
                  <button className={`mv-text-transform-btn ${editingSettings.textTransform === "uppercase" ? "mv-text-transform-btn--active" : ""}`} onClick={() => setEditingSettings({ ...editingSettings, textTransform: "uppercase" })}>AA</button>
                  <button className={`mv-text-transform-btn ${editingSettings.textTransform === "lowercase" ? "mv-text-transform-btn--active" : ""}`} onClick={() => setEditingSettings({ ...editingSettings, textTransform: "lowercase" })}>aa</button>
                </div>
              </div>
              {/* Text Shadow */}
              <div className="mv-field">
                <label className="mv-field-label">Text Shadow</label>
                <input className="mv-field-input" type="text" value={editingSettings.textShadow}
                  onChange={(e) => setEditingSettings({ ...editingSettings, textShadow: e.target.value })}
                  placeholder="e.g. 0 2px 12px rgba(0,0,0,0.8)" />
              </div>
              {/* Ref Font Color */}
              <div className="mv-field">
                <label className="mv-field-label">Reference Color</label>
                <input type="color" value={editingSettings.refFontColor}
                  onChange={(e) => setEditingSettings({ ...editingSettings, refFontColor: e.target.value })}
                  style={{ width: "100%", height: 32, cursor: "pointer", border: "none", borderRadius: 4 }} />
              </div>
              {/* Padding */}
              <div className="mv-field">
                <label className="mv-field-label">Padding: {editingSettings.padding}px</label>
                <input type="range" className="mv-slider" min={0} max={200} step={5}
                  value={editingSettings.padding}
                  onChange={(e) => setEditingSettings({ ...editingSettings, padding: parseInt(e.target.value) })} />
              </div>
            </div>

            <div className="mv-modal-actions" style={{ marginTop: 16 }}>
              <button className="mv-btn mv-btn--ghost" onClick={() => setThemeEditorOpen(false)}>Cancel</button>
              <button className="mv-btn mv-btn--primary" onClick={async () => {
                // Apply edited settings to the region
                update({
                  themeSettings: { ...editingSettings },
                } as any);
                // If this is a custom theme, also save back to DB
                if (currentTheme && currentTheme.source === "custom") {
                  await saveCustomTheme({ ...currentTheme, settings: editingSettings, updatedAt: new Date().toISOString() });
                }
                setThemeEditorOpen(false);
              }}>
                <Icon name="save" size={16} /> Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Transform ── */}
      <div className="mv-inspector-section">
        <h4 className="mv-inspector-section-title">Transform</h4>
        <div className="mv-field-grid">
          <FieldNum label="X" value={region.x} onChange={(v) => update({ x: v })} disabled={con?.lockPosition} />
          <FieldNum label="Y" value={region.y} onChange={(v) => update({ y: v })} disabled={con?.lockPosition} />
          <FieldNum label="W" value={region.width} onChange={(v) => update({ width: v })} min={20} disabled={true} />
          <FieldNum label="H" value={region.height} onChange={(v) => update({ height: v })} min={20} disabled={true} />
          <FieldNum label="Rotation" value={region.rotation} onChange={(v) => update({ rotation: v })} min={0} max={360} disabled={!isStyleEditable(con, "rotation")} />
          <FieldNum label="Opacity" value={region.opacity} onChange={(v) => update({ opacity: v })} min={0} max={1} step={0.05} disabled={!isStyleEditable(con, "opacity")} />
        </div>
      </div>

      {/* ── Appearance ── */}
      <div className="mv-inspector-section">
        <h4 className="mv-inspector-section-title">Appearance</h4>
        <div className="mv-field-grid">
          <FieldNum label="Border Radius" value={region.borderRadius} onChange={(v) => update({ borderRadius: v })} min={0} disabled={!isStyleEditable(con, "borderRadius")} />
          <FieldNum label="Z-Index" value={region.zIndex} onChange={(v) => update({ zIndex: v })} min={1} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ThemePanel — Bible/Worship theme selector + font controls
// ═══════════════════════════════════════════════════════════════════════════

function ThemePanel({ contentType, currentTheme, themeList, showThemePicker, setShowThemePicker, selectTheme, currentFont, onFontSizeChange, onTextTransformChange, onFontFamilyChange, onTextAlignChange, onVerticalAlignChange, onEditTheme }: {
  contentType: "bible" | "worship";
  currentTheme: BibleTheme | null;
  themeList: BibleTheme[];
  showThemePicker: boolean;
  setShowThemePicker: (v: boolean) => void;
  selectTheme: (theme: BibleTheme) => void;
  currentFont: { fontSize?: number; textTransform?: string; fontFamily?: string; textAlign?: string; verticalAlign?: "top" | "center" | "bottom" };
  onFontSizeChange: (v: number) => void;
  onTextTransformChange: (v: string) => void;
  onFontFamilyChange: (v: string) => void;
  onTextAlignChange: (v: string) => void;
  onVerticalAlignChange: (v: "top" | "center" | "bottom") => void;
  onEditTheme?: () => void;
}) {
  const label = contentType === "bible" ? "Bible" : "Worship";
  const icon = contentType === "bible" ? "menu_book" : "music_note";

  return (
    <>
      {/* ── Theme Selector ── */}
      <div className="mv-inspector-section">
        <h4 className="mv-inspector-section-title">
          <Icon name={icon} size={16} style={{ marginRight: 4 }} />
          {label} Theme
        </h4>

        {currentTheme ? (
          <div className="mv-theme-current" onClick={() => setShowThemePicker(true)}>
            <div className="mv-theme-preview" style={{
              background: currentTheme.settings.backgroundColor,
              color: currentTheme.settings.fontColor,
              fontFamily: currentTheme.settings.fontFamily,
              fontSize: 12, padding: 8, borderRadius: 6,
              textAlign: currentTheme.settings.textAlign as "left" | "center" | "right",
              minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {currentTheme.name}
            </div>
            <div className="mv-theme-current-info">
              <span className="mv-theme-current-name">{currentTheme.name}</span>
              <span className="mv-theme-current-desc">{currentTheme.description}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {onEditTheme && (
                <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={(e) => { e.stopPropagation(); onEditTheme(); }}
                  title="Edit theme settings">
                  <Icon name="edit" size={14} />
                </button>
              )}
              <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={(e) => { e.stopPropagation(); setShowThemePicker(true); }}>Change</button>
            </div>
          </div>
        ) : (
          <button className="mv-btn mv-btn--ghost" onClick={() => setShowThemePicker(true)} style={{ width: "100%" }}>
            <Icon name="palette" size={16} /> Select Theme
          </button>
        )}

        {/* Theme picker modal */}
        {showThemePicker && (
          <div className="mv-theme-picker-backdrop" onClick={() => setShowThemePicker(false)}>
            <div className="mv-theme-picker-modal" onClick={(e) => e.stopPropagation()}>
              <div className="mv-theme-picker-header">
                <h3>{label} Themes</h3>
                <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={() => setShowThemePicker(false)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
              <div className="mv-theme-picker-section">
                <h4 className="mv-theme-picker-section-title">Built-in</h4>
                <div className="mv-theme-grid">
                  {themeList.filter((t) => t.source === "builtin").map((theme) => (
                    <button key={theme.id} className={`mv-theme-card ${currentTheme?.id === theme.id ? "mv-theme-card--active" : ""}`} onClick={() => selectTheme(theme)}>
                      <div className="mv-theme-card-preview" style={{
                        background: theme.settings.backgroundColor,
                        color: theme.settings.fontColor,
                        fontFamily: theme.settings.fontFamily,
                        fontSize: 10, padding: 6,
                        textAlign: theme.settings.textAlign as "left" | "center" | "right",
                      }}>Aa</div>
                      <span className="mv-theme-card-name">{theme.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mv-theme-picker-section">
                <h4 className="mv-theme-picker-section-title">Custom</h4>
                {themeList.filter((t) => t.source === "custom").length === 0 ? (
                  <p className="mv-theme-picker-empty">No custom themes yet. Create one in the {label} Templates page.</p>
                ) : (
                  <div className="mv-theme-grid">
                    {themeList.filter((t) => t.source === "custom").map((theme) => (
                      <button key={theme.id} className={`mv-theme-card ${currentTheme?.id === theme.id ? "mv-theme-card--active" : ""}`} onClick={() => selectTheme(theme)}>
                        <div className="mv-theme-card-preview" style={{
                          background: theme.settings.backgroundColor,
                          color: theme.settings.fontColor,
                          fontFamily: theme.settings.fontFamily,
                          fontSize: 10, padding: 6,
                          textAlign: theme.settings.textAlign as "left" | "center" | "right",
                        }}>Aa</div>
                        <span className="mv-theme-card-name">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Font Controls ── */}
      {currentTheme && (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Font Controls</h4>
          <div className="mv-field">
            <label className="mv-field-label">Font Size: {currentFont.fontSize ?? currentTheme.settings.fontSize}px</label>
            <input type="range" className="mv-slider" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1}
              value={currentFont.fontSize ?? currentTheme.settings.fontSize}
              onChange={(e) => onFontSizeChange(parseInt(e.target.value))} />
          </div>
          <div className="mv-field" style={{ marginTop: 8 }}>
            <label className="mv-field-label">Text Case</label>
            <div className="mv-text-transform-btns">
              <button className={`mv-text-transform-btn ${(currentFont.textTransform ?? "none") === "none" ? "mv-text-transform-btn--active" : ""}`} onClick={() => onTextTransformChange("none")} title="Normal">Aa</button>
              <button className={`mv-text-transform-btn ${(currentFont.textTransform ?? "none") === "uppercase" ? "mv-text-transform-btn--active" : ""}`} onClick={() => onTextTransformChange("uppercase")} title="UPPERCASE">AA</button>
              <button className={`mv-text-transform-btn ${(currentFont.textTransform ?? "none") === "lowercase" ? "mv-text-transform-btn--active" : ""}`} onClick={() => onTextTransformChange("lowercase")} title="lowercase">aa</button>
              <button className={`mv-text-transform-btn ${(currentFont.textTransform ?? "none") === "capitalize" ? "mv-text-transform-btn--active" : ""}`} onClick={() => onTextTransformChange("capitalize")} title="Capitalize">Ab</button>
            </div>
          </div>
          <div className="mv-field" style={{ marginTop: 8 }}>
            <label className="mv-field-label">Font Family</label>
            <select className="mv-field-input" value={currentFont.fontFamily ?? currentTheme.settings.fontFamily}
              onChange={(e) => onFontFamilyChange(e.target.value)}>
              {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="mv-field" style={{ marginTop: 8 }}>
            <label className="mv-field-label">Text Align</label>
            <div className="mv-text-transform-btns">
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} className={`mv-text-transform-btn ${(currentFont.textAlign ?? currentTheme.settings.textAlign ?? "center") === a ? "mv-text-transform-btn--active" : ""}`} onClick={() => onTextAlignChange(a)} title={a.charAt(0).toUpperCase() + a.slice(1)}>
                  <Icon name={a === "left" ? "format_align_left" : a === "center" ? "format_align_center" : "format_align_right"} size={16} />
                </button>
              ))}
            </div>
          </div>
          <div className="mv-field" style={{ marginTop: 8 }}>
            <label className="mv-field-label">Vertical Align</label>
            <div className="mv-text-transform-btns">
              {(["top", "center", "bottom"] as const).map((a) => (
                <button key={a} className={`mv-text-transform-btn ${(currentFont.verticalAlign ?? "center") === a ? "mv-text-transform-btn--active" : ""}`} onClick={() => onVerticalAlignChange(a)} title={a.charAt(0).toUpperCase() + a.slice(1)}>
                  <Icon name={a === "top" ? "vertical_align_top" : a === "center" ? "vertical_align_center" : "vertical_align_bottom"} size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LTInspectorPanel — Lower-third theme picker + variable inputs for sidebar
// ═══════════════════════════════════════════════════════════════════════════

function LTInspectorPanel({ region, update }: { region: Region; update: (changes: Partial<Region>) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const currentLTTheme = region.themeId ? getLTThemeById(region.themeId) : null;
  const ltValues: Record<string, string> = (region as any).ltValues ?? {};

  const selectLTTheme = (theme: LowerThirdTheme) => {
    const defaults: Record<string, string> = {};
    theme.variables.forEach((v) => { defaults[v.key] = v.defaultValue; });
    update({
      name: `LT: ${theme.name}`,
      themeId: theme.id,
      ltValues: defaults,
    } as any);
    setShowPicker(false);
  };

  const updateLTValue = (key: string, value: string) => {
    update({ ltValues: { ...ltValues, [key]: value } } as any);
  };


  const ltEnabled: boolean = (region as any).ltEnabled !== false;
  const ltBgColor: string = (region as any).ltBgColor ?? "";
  const ltSize: string = (region as any).ltSize ?? "medium";


  const filteredThemes = searchTerm.trim()
    ? LT_THEMES.filter((t) =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.tags.some((tag) => tag.includes(searchTerm.toLowerCase()))
      )
    : null;

  const renderLTGrid = (themes: LowerThirdTheme[]) => (
    <div className="mv-theme-grid">
      {themes.map((t) => (
        <button
          key={t.id}
          className={`mv-theme-card ${currentLTTheme?.id === t.id ? "mv-theme-card--active" : ""}`}
          onClick={() => selectLTTheme(t)}
        >
          <div className="mv-theme-card-preview" style={{ background: t.accentColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={t.icon} size={16} style={{ color: "#fff" }} />
          </div>
          <span className="mv-theme-card-name">{t.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* ── LT Theme Selector ── */}
      <div className="mv-inspector-section">
        <h4 className="mv-inspector-section-title">
          <Icon name="subtitles" size={16} style={{ marginRight: 4 }} />
          Lower Third Theme
        </h4>

        {currentLTTheme ? (
          <div className="mv-theme-current" onClick={() => setShowPicker(true)}>
            <div className="mv-theme-preview" style={{
              background: currentLTTheme.accentColor,
              display: "flex", alignItems: "center", justifyContent: "center",
              minHeight: 48, borderRadius: 6,
            }}>
              <Icon name={currentLTTheme.icon} size={20} style={{ color: "#fff" }} />
            </div>
            <div className="mv-theme-current-info">
              <span className="mv-theme-current-name">{currentLTTheme.name}</span>
              <span className="mv-theme-current-desc">{currentLTTheme.description}</span>
            </div>
            <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}>Change</button>
          </div>
        ) : (
          <button className="mv-btn mv-btn--ghost" onClick={() => setShowPicker(true)} style={{ width: "100%" }}>
            <Icon name="palette" size={16} /> Select Theme
          </button>
        )}

        {/* LT Theme picker modal */}
        {showPicker && (
          <div className="mv-theme-picker-backdrop" onClick={() => setShowPicker(false)}>
            <div className="mv-theme-picker-modal" onClick={(e) => e.stopPropagation()}>
              <div className="mv-theme-picker-header">
                <h3>Lower Third Themes</h3>
                <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={() => setShowPicker(false)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
              <div className="mv-inline-search" style={{ margin: "0 12px 8px" }}>
                <input
                  type="text"
                  className="mv-field-input"
                  placeholder="Search themes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search lower third themes"
                  autoFocus
                />
                {searchTerm && (
                  <button
                    type="button"
                    className="mv-inline-search-clear"
                    onClick={() => setSearchTerm("")}
                    aria-label="Clear lower third theme search"
                    title="Clear lower third theme search"
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
              {filteredThemes ? (
                <div className="mv-theme-picker-section">
                  <h4 className="mv-theme-picker-section-title">Results ({filteredThemes.length})</h4>
                  {filteredThemes.length > 0 ? renderLTGrid(filteredThemes) : (
                    <p className="mv-theme-picker-empty">No themes match "{searchTerm}"</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="mv-theme-picker-section">
                    <h4 className="mv-theme-picker-section-title">Bible / Scripture ({LT_BIBLE_THEMES.length})</h4>
                    {renderLTGrid(LT_BIBLE_THEMES)}
                  </div>
                  <div className="mv-theme-picker-section">
                    <h4 className="mv-theme-picker-section-title">Worship ({LT_WORSHIP_THEMES.length})</h4>
                    {renderLTGrid(LT_WORSHIP_THEMES)}
                  </div>
                  <div className="mv-theme-picker-section">
                    <h4 className="mv-theme-picker-section-title">General ({LT_GENERAL_THEMES.length})</h4>
                    {renderLTGrid(LT_GENERAL_THEMES)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── LT Variable Inputs ── */}
      {currentLTTheme && currentLTTheme.variables.length > 0 && (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Content Fields</h4>
          {currentLTTheme.variables.map((v: LTVariable) => (
            <div key={v.key} className="mv-field" style={{ marginBottom: 6 }}>
              <label className="mv-field-label">{v.label}</label>
              {v.type === "color" ? (
                <input
                  type="color"
                  className="mv-field-input"
                  value={ltValues[v.key] || v.defaultValue}
                  onChange={(e) => updateLTValue(v.key, e.target.value)}
                  style={{ height: 32, padding: 2 }}
                />
              ) : v.type === "select" && v.options ? (
                <select
                  className="mv-field-input"
                  value={ltValues[v.key] || v.defaultValue}
                  onChange={(e) => updateLTValue(v.key, e.target.value)}
                >
                  {v.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={v.type === "number" ? "number" : "text"}
                  className="mv-field-input"
                  value={ltValues[v.key] || ""}
                  placeholder={v.placeholder}
                  onChange={(e) => updateLTValue(v.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── LT Controls: On/Off, Background Color, Size ── */}
      {currentLTTheme && (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Lower Third Controls</h4>

          {/* On/Off Toggle */}
          <div className="mv-field" style={{ marginBottom: 8 }}>
            <label className="mv-field-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={ltEnabled}
                onChange={(e) => update({ ltEnabled: e.target.checked } as any)}
                style={{ accentColor: "var(--success, #00E676)" }}
              />
              {ltEnabled ? "Enabled — visible on OBS" : "Disabled — hidden on OBS"}
            </label>
          </div>

          {/* Background Color Override */}
          <div className="mv-field" style={{ marginBottom: 8 }}>
            <label className="mv-field-label">Background Color Override</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="color"
                value={ltBgColor || "#000000"}
                onChange={(e) => update({ ltBgColor: e.target.value } as any)}
                style={{ width: 36, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                className="mv-field-input"
                type="text"
                value={ltBgColor}
                placeholder="e.g. #1a1a2e (empty = theme default)"
                onChange={(e) => update({ ltBgColor: e.target.value } as any)}
                style={{ flex: 1 }}
              />
              {ltBgColor && (
                <button
                  className="mv-btn mv-btn--ghost mv-btn--xs"
                  onClick={() => update({ ltBgColor: "" } as any)}
                  title="Reset to theme default"
                >
                  <Icon name="restart_alt" size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Size Selector */}
          <div className="mv-field">
            <label className="mv-field-label">Size</label>
            <div className="mv-text-transform-btns">
              {(["small", "medium", "large", "xl", "2xl"] as const).map((s) => (
                <button
                  key={s}
                  className={`mv-text-transform-btn ${ltSize === s ? "mv-text-transform-btn--active" : ""}`}
                  onClick={() => update({ ltSize: s } as any)}
                  title={s.toUpperCase()}
                  style={{ fontSize: 11, textTransform: "uppercase", padding: "4px 6px" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isStyleEditable(con: RegionConstraints | undefined, style: string): boolean {
  if (!con) return true;
  return con.editableStyles.includes(style as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Number field component
// ─────────────────────────────────────────────────────────────────────────────

function FieldNum({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className={`mv-field ${disabled ? "mv-field--disabled" : ""}`}>
      <label className="mv-field-label">{label}</label>
      <input
        className="mv-field-input mv-field-input--num"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          let v = parseFloat(e.target.value);
          if (isNaN(v)) v = 0;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onChange(v);
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-specific fields
// ─────────────────────────────────────────────────────────────────────────────

function TypeFields({
  region,
  update,
}: {
  region: Region;
  update: (changes: Partial<Region>) => void;
}) {
  switch (region.type) {
    case "obs-scene":
      return (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">OBS Scene</h4>
          <label className="mv-field-label">Scene Name</label>
          <input
            className="mv-field-input"
            type="text"
            value={region.sceneName}
            readOnly
            style={{ opacity: 0.7 }}
          />
        </div>
      );

    case "video-input":
      return (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Video Input</h4>
          <label className="mv-field-label">OBS Input Name</label>
          <input
            className="mv-field-input"
            type="text"
            value={region.inputName}
            placeholder="e.g. Camera 1"
            onChange={(e) => update({ inputName: e.target.value } as Partial<Region>)}
          />
        </div>
      );

    case "color":
      return (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Color Fill</h4>
          <label className="mv-field-label">Color</label>
          <input
            className="mv-field-input"
            type="color"
            value={region.color}
            onChange={(e) => update({ color: e.target.value } as Partial<Region>)}
          />
        </div>
      );

    case "image-overlay":
      return (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Image Overlay</h4>
          <label className="mv-field-label">Source URL / Path</label>
          <input
            className="mv-field-input"
            type="text"
            value={region.src}
            placeholder="Image URL or path"
            onChange={(e) => update({ src: e.target.value } as Partial<Region>)}
          />
          {region.src && (
            <div style={{ marginTop: 8, borderRadius: 6, overflow: "hidden", background: "#000" }}>
              <img
                src={region.src}
                alt="Preview"
                style={{ width: "100%", height: "auto", display: "block", maxHeight: 120, objectFit: "contain" }}
              />
            </div>
          )}
        </div>
      );

    case "media":
      return (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Video Source</h4>
          <label className="mv-field-label">File Path / URL</label>
          <input
            className="mv-field-input"
            type="text"
            value={region.src}
            placeholder="Video file path"
            onChange={(e) => update({ src: e.target.value } as Partial<Region>)}
          />
          <div className="mv-field" style={{ marginTop: 6 }}>
            <label className="mv-field-label">
              <input
                type="checkbox"
                checked={region.loop}
                onChange={(e) => update({ loop: e.target.checked } as Partial<Region>)}
                style={{ marginRight: 6 }}
              />
              Loop
            </label>
          </div>
        </div>
      );

    case "browser":
      return (
        <div className="mv-inspector-section">
          <h4 className="mv-inspector-section-title">Browser Source</h4>
          <label className="mv-field-label">URL</label>
          <input
            className="mv-field-input"
            type="text"
            value={region.url}
            placeholder="https://..."
            onChange={(e) => update({ url: e.target.value } as Partial<Region>)}
          />
        </div>
      );

    default:
      return null;
  }
}
