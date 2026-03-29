/**
 * BibleThemeEditor.tsx — Holyrics Pro-style visual theme editor
 *
 * Layout (matches bible-theme-view.html):
 *   HEADER  — Back / Editor title / Export / Save / Apply to Live
 *   LEFT    — Theme list sidebar (My Themes) with search
 *   CENTER  — Canvas preview (checkerboard BG, 16:9 frame, safe-area)
 *   RIGHT   — Collapsible property panels (Typography, Layout, Overlays, Transition)
 *   BOTTOM  — Background gallery strip (Images / Solids / Gradients)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { nanoid } from "nanoid";
import { useBible } from "../bibleStore";
import { saveCustomTheme } from "../bibleDb";
import type { BibleTheme, BibleThemeSettings, BibleTemplateType } from "../types";
import { DEFAULT_THEME_SETTINGS } from "../types";
import Icon from "../../components/Icon";

const BIBLE_THEME_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"] as const;
const BIBLE_THEME_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/bmp"] as const;
const BIBLE_THEME_IMAGE_ACCEPT = [...BIBLE_THEME_IMAGE_MIME_TYPES, ...BIBLE_THEME_IMAGE_EXTENSIONS].join(",");

function hasAllowedBibleThemeImageExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = filename.slice(dot).toLowerCase();
  return BIBLE_THEME_IMAGE_EXTENSIONS.includes(ext as (typeof BIBLE_THEME_IMAGE_EXTENSIONS)[number]);
}

/** When switching to lower-third, auto-clear main bg to transparent */
function autoTransparentForLowerThird(
  newType: BibleTemplateType,
  setter: React.Dispatch<React.SetStateAction<BibleThemeSettings>>
) {
  if (newType === "lower-third") {
    setter((prev) => ({
      ...prev,
      backgroundColor: "transparent",
      backgroundImage: "",
      backgroundOpacity: 1,
    }));
  }
}

const FONT_OPTIONS = [
  { label: "CMG Sans", value: '"CMG Sans", sans-serif' },
  { label: "CMG Sans Bold", value: '"CMG Sans Bold", "CMG Sans", sans-serif' },
  { label: "CMG Sans Condensed", value: '"CMG Sans Condensed", "CMG Sans", sans-serif' },
  { label: "CMG Sans Caps", value: '"CMG Sans Caps", "CMG Sans", sans-serif' },
  { label: "CMG Sans Light", value: '"CMG Sans Light", "CMG Sans", sans-serif' },
  { label: "CMG Sans Rounded", value: '"CMG Sans Rounded", "CMG Sans", sans-serif' },
  { label: "CMG Sans Slab", value: '"CMG Sans Slab", "CMG Sans", sans-serif' },
  { label: "CMG Sans Outline", value: '"CMG Sans Outline", "CMG Sans", sans-serif' },
  { label: "CMG Sans Wide", value: '"CMG Sans Wide", "CMG Sans", sans-serif' },
  { label: "Inter", value: '"Inter", "Segoe UI", sans-serif' },
  { label: "Georgia (Serif)", value: '"Georgia", "Times New Roman", serif' },
  { label: "Roboto Slab", value: '"Roboto Slab", Georgia, serif' },
  { label: "Merriweather", value: '"Merriweather", Georgia, serif' },
  { label: "Open Sans", value: '"Open Sans", "Helvetica Neue", sans-serif' },
  { label: "System Default", value: "system-ui, sans-serif" },
];

/* ── Collapsible panel section ─────────────────────────── */
function PanelSection({
  icon, iconColor, title, defaultOpen = false, children,
}: {
  icon: string; iconColor?: string; title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "10px 14px", display: "flex", alignItems: "center",
          justifyContent: "space-between", background: "transparent", border: "none",
          cursor: "pointer", color: "var(--text-primary)", fontSize: 13, fontWeight: 600,
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={icon} size={18} style={{ color: iconColor ?? "var(--primary)" }} />
          {title}
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={18} style={{ color: "var(--text-muted)" }} />
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10, background: "rgba(0,0,0,0.15)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>
      {children}
    </label>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}

/* ── Main component ────────────────────────────────────── */
interface Props {
  editTheme?: BibleTheme | null;
  onSave?: (theme: BibleTheme) => void;
  onCancel?: () => void;
}

export default function BibleThemeEditor({ editTheme, onSave, onCancel }: Props) {
  const { state, dispatch } = useBible();

  const [name, setName] = useState(editTheme?.name ?? "My Theme");
  const [description, setDescription] = useState(editTheme?.description ?? "");
  const [templateType, setTemplateType] = useState<BibleTemplateType>(editTheme?.templateType ?? "fullscreen");
  const [settings, setSettings] = useState<BibleThemeSettings>(
    editTheme ? { ...DEFAULT_THEME_SETTINGS, ...editTheme.settings } : { ...DEFAULT_THEME_SETTINGS }
  );
  const [bgTab, setBgTab] = useState<"images" | "solids" | "gradients">("images");
  const [themeFilter, setThemeFilter] = useState("");

  const update = useCallback((key: keyof BibleThemeSettings, value: string | number | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const bgFileRef = useRef<HTMLInputElement>(null);

  const handleTemplateTypeChange = useCallback((newType: BibleTemplateType) => {
    setTemplateType(newType);
    autoTransparentForLowerThird(newType, setSettings);
  }, []);

  const handleBgImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isImageMime = file.type.startsWith("image/");
    const isAllowedExt = hasAllowedBibleThemeImageExtension(file.name);
    if (!isImageMime && !isAllowedExt) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        // For lower-third templates, image goes to box background, not main background
        if (templateType === "lower-third") {
          update("boxBackgroundImage", reader.result);
        } else {
          update("backgroundImage", reader.result);
        }
      }
    };
    reader.readAsDataURL(file);
  }, [update, templateType]);

  const handleSave = async () => {
    const now = new Date().toISOString();
    const theme: BibleTheme = {
      id: editTheme?.id ?? nanoid(),
      name, description, source: "custom", templateType, settings,
      createdAt: editTheme?.createdAt ?? now, updatedAt: now,
    };
    await saveCustomTheme(theme);
    if (editTheme) { dispatch({ type: "UPDATE_THEME", theme }); } else { dispatch({ type: "ADD_THEME", theme }); }
    dispatch({ type: "SET_ACTIVE_THEME", themeId: theme.id });
    onSave?.(theme);
  };

  // ── Keyboard shortcuts ──
  // Ctrl+S = Save theme, Ctrl+Enter = Save & Apply to Live, Escape = Back/Cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const loadTheme = (theme: BibleTheme) => {
    setName(theme.name);
    setDescription(theme.description ?? "");
    setTemplateType(theme.templateType);
    setSettings({ ...theme.settings });
  };

  const filteredThemes = themeFilter
    ? state.themes.filter((t) => t.name.toLowerCase().includes(themeFilter.toLowerCase()))
    : state.themes;

  const SOLID_PRESETS = ["#000000", "#0b0d14", "#1a1a2e", "#16213e", "#0f3460", "#1e3a5f", "#2d2d2d", "#3a0ca3"];
  const GRADIENT_PRESETS = [
    "linear-gradient(135deg, #1a1a2e, #16213e)",
    "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
    "linear-gradient(135deg, #3a0ca3, #1e3a5f)",
    "linear-gradient(135deg, #141e30, #243b55)",
    "linear-gradient(135deg, #2c3e50, #3498db)",
    "linear-gradient(to right, #232526, #414345)",
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-dark)", border: "1px solid var(--border)",
    color: "var(--text-primary)", fontSize: 12, borderRadius: "var(--radius)", padding: "5px 8px",
    outline: "none", fontFamily: "inherit",
  };
  const selectStyle: React.CSSProperties = { ...inputStyle };

  const rangeWrap = (label: string, value: number | string, unit: string = "") => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 2 }}>
      <span>{label}</span>
      <span style={{ color: "var(--primary)" }}>{value}{unit}</span>
    </div>
  );

  return (
    <div className="theme-editor">
      {/* HEADER */}
      <div className="theme-editor-header">
        <h2>
          <Icon name="brush" size={18} style={{ color: "var(--primary)" }} />
          {editTheme ? "Edit Theme" : "Create Theme"}
        </h2>
        <div className="theme-editor-actions">
          <button className="theme-editor-btn cancel" onClick={onCancel} title="Escape">
            <Icon name="arrow_back" size={20} /> Back
          </button>
          <button className="theme-editor-btn save" onClick={handleSave} title="⌘S / Ctrl+S">
            <Icon name="save" size={20} /> Save Theme
          </button>
          <button className="theme-editor-btn apply" onClick={handleSave} title="⌘Enter / Ctrl+Enter">
            <Icon name="play_circle" size={20} /> Apply to Live
          </button>
        </div>
      </div>

      {/* BODY: 3 columns */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* LEFT: Theme List */}
        <aside style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--bg-dark)", borderRight: "1px solid var(--border)" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>My Themes</span>
            <button
              onClick={() => { setName("New Theme"); setDescription(""); setSettings({ ...DEFAULT_THEME_SETTINGS }); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}
              title="New Theme"
            >
              <Icon name="add_circle" size={18} />
            </button>
          </div>
          <div style={{ padding: "8px 10px", position: "relative" }}>
            <Icon name="search" size={16} style={{ position: "absolute", left: 16, top: 14, color: "var(--text-muted)" }} />
            <input
              type="text" placeholder="Filter themes..." value={themeFilter}
              onChange={(e) => setThemeFilter(e.target.value)}
              style={{ ...inputStyle, paddingLeft: 30, fontSize: 11 }}
            />
          </div>
          <div className="b-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredThemes.map((theme) => {
              const isActive = theme.id === state.activeThemeId;
              const bgImg = theme.settings.backgroundImage;
              return (
                <div
                  key={theme.id} onClick={() => loadTheme(theme)}
                  style={{ cursor: "pointer", borderRadius: "var(--radius-lg)", overflow: "hidden", border: isActive ? "2px solid var(--primary)" : "1px solid var(--border)", opacity: isActive ? 1 : 0.75, transition: "all 0.12s" }}
                >
                  <div style={{
                    height: 56, width: "100%", position: "relative",
                    backgroundImage: bgImg ? `url(${bgImg})` : undefined,
                    backgroundSize: "cover", backgroundPosition: "center",
                    backgroundColor: bgImg ? undefined : theme.settings.backgroundColor,
                  }}>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: theme.settings.fontColor, fontFamily: theme.settings.fontFamily, fontSize: 11, fontWeight: theme.settings.fontWeight as React.CSSProperties["fontWeight"], textShadow: theme.settings.textShadow, opacity: 0.8 }}>Be still...</span>
                    </div>
                  </div>
                  <div style={{ padding: "6px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-dark)" }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>{theme.name}</span>
                    {isActive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>
            {state.themes.length} themes
          </div>
        </aside>

        {/* CENTER: Canvas */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", background: "var(--bg-dark)" }}>
          {/* Canvas area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, overflow: "hidden", position: "relative" }}>
            {/* Checkerboard */}
            <div style={{ position: "absolute", inset: 0, opacity: 0.06, zIndex: 0, backgroundImage: "linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px" }} />
            {/* Name & template inputs */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, zIndex: 10, width: "100%", maxWidth: 700 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Theme Name</FieldLabel>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>Template Type</FieldLabel>
                <select value={templateType} onChange={(e) => handleTemplateTypeChange(e.target.value as BibleTemplateType)} style={selectStyle}>
                  <option value="fullscreen">Fullscreen</option>
                  <option value="lower-third">Lower Third</option>
                </select>
              </div>
            </div>
            {/* 16:9 Preview Frame */}
            <div style={{ width: "100%", maxWidth: 700, aspectRatio: "16/9", background: "#000", position: "relative", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden", zIndex: 10 }}>
              {/* BG layer */}
              <div style={{ position: "absolute", inset: 0, zIndex: 0, backgroundColor: settings.backgroundColor, backgroundImage: settings.backgroundImage ? `url(${settings.backgroundImage})` : undefined, backgroundSize: "cover", backgroundPosition: "center", opacity: settings.backgroundOpacity }} />
              {/* Safe area outline */}
              <div style={{ position: "absolute", inset: "8%", border: "1px dashed rgba(22,198,12,0.25)", pointerEvents: "none", zIndex: 15 }}>
                <span style={{ position: "absolute", top: 0, right: 0, fontSize: 8, color: "var(--success)", padding: "1px 4px", background: "rgba(0,0,0,0.5)" }}>SAFE AREA</span>
              </div>
              {/* Text content */}
              <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: templateType === "lower-third" ? "flex-end" : "center", padding: templateType === "lower-third" ? "0 8% 10%" : "10%", textAlign: "center" }}>
                <div style={{ padding: `${settings.padding * 0.4}px`, background: templateType === "lower-third" ? settings.boxBackground : "transparent", backgroundImage: templateType === "lower-third" && settings.boxBackgroundImage ? `url(${settings.boxBackgroundImage})` : undefined, backgroundSize: "cover", backgroundPosition: "center", borderRadius: `${settings.borderRadius}px`, width: templateType === "lower-third" ? "85%" : "auto" }}>
                  {settings.refPosition === "top" && (
                    <div style={{ fontSize: `${settings.refFontSize * 0.35}px`, color: settings.refFontColor, fontWeight: settings.refFontWeight, marginBottom: 8, textAlign: settings.textAlign as React.CSSProperties["textAlign"] }}>
                      Genesis 1:1 | KJV
                    </div>
                  )}
                  <div style={{ fontFamily: settings.fontFamily, fontSize: `${settings.fontSize * 0.35}px`, fontWeight: settings.fontWeight, color: settings.fontColor, lineHeight: settings.lineHeight, textAlign: settings.textAlign as React.CSSProperties["textAlign"], textShadow: settings.textShadow || "0 4px 12px rgba(0,0,0,0.8)", WebkitTextStroke: settings.textOutline ? `${settings.textOutlineWidth * 0.3}px ${settings.textOutlineColor}` : undefined, letterSpacing: "0.02em", textTransform: settings.textTransform as React.CSSProperties["textTransform"] }}>
                    In the beginning God created the heaven and the earth.
                  </div>
                  {settings.refPosition !== "top" && (
                    <div style={{ fontSize: `${settings.refFontSize * 0.35}px`, color: settings.refFontColor, fontWeight: settings.refFontWeight, marginTop: 12, letterSpacing: "0.15em", textTransform: "uppercase", textAlign: settings.textAlign as React.CSSProperties["textAlign"] }}>
                      Genesis 1:1 | KJV
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: Background Gallery */}
          <div style={{ height: 160, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--surface-dark)", borderTop: "1px solid var(--border)", zIndex: 10 }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.15)" }}>
              <div style={{ display: "flex", gap: 16 }}>
                {(["images", "solids", "gradients"] as const).map((tab) => (
                  <button key={tab} onClick={() => setBgTab(tab)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500, color: bgTab === tab ? "var(--text-primary)" : "var(--text-muted)", borderBottom: bgTab === tab ? "2px solid var(--primary)" : "2px solid transparent", paddingBottom: 6, textTransform: "capitalize", fontFamily: "inherit" }}>{tab}</button>
                ))}
              </div>
              <button onClick={() => bgFileRef.current?.click()} style={{ background: "var(--primary)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                <Icon name="upload" size={14} /> Upload Media
              </button>
              <input ref={bgFileRef} type="file" accept={BIBLE_THEME_IMAGE_ACCEPT} style={{ display: "none" }} onChange={handleBgImageUpload} />
            </div>
            <div className="b-scroll" style={{ flex: 1, padding: 10, overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", display: "flex", gap: 10 }}>
              {bgTab === "images" && (
                <>
                  {/* Show box background image for lower-third, main bg for fullscreen */}
                  {templateType === "lower-third" && settings.boxBackgroundImage && (
                    <div style={{ display: "inline-block", width: 130, height: 90, borderRadius: "var(--radius)", overflow: "hidden", border: "2px solid var(--primary)", cursor: "pointer", flexShrink: 0, position: "relative" }}>
                      <img src={settings.boxBackgroundImage} alt="Box BG" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <span style={{ position: "absolute", top: 4, right: 4, fontSize: 8, background: "rgba(0,0,0,0.7)", color: "#fff", padding: "1px 4px", borderRadius: 2 }}>Box BG</span>
                    </div>
                  )}
                  {templateType !== "lower-third" && settings.backgroundImage && (
                    <div style={{ display: "inline-block", width: 130, height: 90, borderRadius: "var(--radius)", overflow: "hidden", border: "2px solid var(--primary)", cursor: "pointer", flexShrink: 0, position: "relative" }}>
                      <img src={settings.backgroundImage} alt="Current" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <span style={{ position: "absolute", top: 4, right: 4, fontSize: 8, background: "rgba(0,0,0,0.7)", color: "#fff", padding: "1px 4px", borderRadius: 2 }}>Active</span>
                    </div>
                  )}
                  <div onClick={() => { if (templateType === "lower-third") { update("boxBackgroundImage", ""); } else { update("backgroundImage", ""); } }} style={{ display: "inline-flex", width: 130, height: 90, borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)", cursor: "pointer", flexShrink: 0, background: "#000", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 }}>
                    <Icon name="no_photography" size={24} style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>No Background</span>
                  </div>
                  <div onClick={() => bgFileRef.current?.click()} style={{ display: "inline-flex", width: 130, height: 90, borderRadius: "var(--radius)", border: "1px dashed var(--border)", cursor: "pointer", flexShrink: 0, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4, background: "transparent" }}>
                    <Icon name="add_photo_alternate" size={24} style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>Upload</span>
                  </div>
                </>
              )}
              {bgTab === "solids" && SOLID_PRESETS.map((color) => (
                <div key={color} onClick={() => { update("backgroundColor", color); update("backgroundImage", ""); }} style={{ display: "inline-block", width: 130, height: 90, borderRadius: "var(--radius)", overflow: "hidden", cursor: "pointer", flexShrink: 0, background: color, border: settings.backgroundColor === color && !settings.backgroundImage ? "2px solid var(--primary)" : "1px solid var(--border)" }} />
              ))}
              {bgTab === "gradients" && GRADIENT_PRESETS.map((grad) => (
                <div key={grad} onClick={() => { update("backgroundColor", "#000"); update("backgroundImage", ""); }} style={{ display: "inline-block", width: 130, height: 90, borderRadius: "var(--radius)", overflow: "hidden", cursor: "pointer", flexShrink: 0, background: grad, border: "1px solid var(--border)" }} />
              ))}
            </div>
          </div>
        </main>

        {/* RIGHT: Property Panels */}
        <aside className="b-scroll" style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--bg-dark)", borderLeft: "1px solid var(--border)", overflowY: "auto" }}>

          {/* Typography */}
          <PanelSection icon="text_fields" iconColor="#7c3aed" title="Typography" defaultOpen>
            <div>
              <FieldLabel>Font Family</FieldLabel>
              <select value={settings.fontFamily} onChange={(e) => update("fontFamily", e.target.value)} style={selectStyle}>
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <FieldRow>
              <div>
                <FieldLabel>Size (px)</FieldLabel>
                <input type="number" value={settings.fontSize} onChange={(e) => update("fontSize", Number(e.target.value))} style={inputStyle} />
              </div>
              <div>
                <FieldLabel>Weight</FieldLabel>
                <select value={settings.fontWeight} onChange={(e) => update("fontWeight", e.target.value)} style={selectStyle}>
                  <option value="light">Light</option>
                  <option value="normal">Regular</option>
                  <option value="bold">Bold</option>
                  <option value="900">Black</option>
                </select>
              </div>
            </FieldRow>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div>
                  <FieldLabel>Fill</FieldLabel>
                  <input type="color" value={settings.fontColor} onChange={(e) => update("fontColor", e.target.value)} style={{ width: 40, height: 28, border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", background: "transparent", padding: 2 }} />
                </div>
                <div>
                  <FieldLabel>Ref Color</FieldLabel>
                  <input type="color" value={settings.refFontColor} onChange={(e) => update("refFontColor", e.target.value)} style={{ width: 40, height: 28, border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", background: "transparent", padding: 2 }} />
                </div>
              </div>
              <div style={{ flex: 1, marginLeft: 16 }}>
                {rangeWrap("Leading", settings.lineHeight)}
                <input type="range" min="1" max="3" step="0.1" value={settings.lineHeight} onChange={(e) => update("lineHeight", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
              </div>
            </div>
            <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <FieldLabel>Text Shadow</FieldLabel>
                <input type="checkbox" checked={!!settings.textShadow} onChange={(e) => update("textShadow", e.target.checked ? "0 4px 12px rgba(0,0,0,0.8)" : "")} style={{ accentColor: "var(--primary)", width: 14, height: 14 }} />
              </div>
              {settings.textShadow && (
                <input type="text" value={settings.textShadow} onChange={(e) => update("textShadow", e.target.value)} placeholder="0 2px 8px rgba(0,0,0,0.6)" style={{ ...inputStyle, fontSize: 10 }} />
              )}
            </div>
            <div>
              <FieldLabel>Text Align</FieldLabel>
              <div style={{ display: "flex", gap: 4 }}>
                {(["left", "center", "right"] as const).map((a) => (
                  <button key={a} onClick={() => update("textAlign", a)} style={{ flex: 1, padding: "4px 0", background: settings.textAlign === a ? "rgba(var(--primary-rgb),0.15)" : "var(--surface-hover)", border: settings.textAlign === a ? "1px solid var(--primary)" : "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", color: settings.textAlign === a ? "var(--primary)" : "var(--text-muted)", fontSize: 10, fontWeight: 600, textTransform: "capitalize", fontFamily: "inherit" }}>{a}</button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Text Case</FieldLabel>
              <div style={{ display: "flex", gap: 4 }}>
                {([
                  { value: "none", label: "Aa", title: "Normal" },
                  { value: "uppercase", label: "AA", title: "UPPERCASE" },
                  { value: "lowercase", label: "aa", title: "lowercase" },
                  { value: "capitalize", label: "Aa.", title: "Title Case" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => update("textTransform", opt.value)}
                    title={opt.title}
                    style={{
                      flex: 1, padding: "4px 0",
                      background: settings.textTransform === opt.value ? "rgba(var(--primary-rgb),0.15)" : "var(--surface-hover)",
                      border: settings.textTransform === opt.value ? "1px solid var(--primary)" : "1px solid var(--border)",
                      borderRadius: "var(--radius)", cursor: "pointer",
                      color: settings.textTransform === opt.value ? "var(--primary)" : "var(--text-muted)",
                      fontSize: 10, fontWeight: 700, fontFamily: "inherit",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <FieldRow>
              <div>
                <FieldLabel>Ref Size ({settings.refFontSize}px)</FieldLabel>
                <input type="range" min="8" max="40" value={settings.refFontSize} onChange={(e) => update("refFontSize", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
              </div>
              <div>
                <FieldLabel>Ref Position</FieldLabel>
                <select value={settings.refPosition} onChange={(e) => update("refPosition", e.target.value)} style={selectStyle}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
              </div>
            </FieldRow>
          </PanelSection>

          {/* Layout */}
          <PanelSection icon="layers" iconColor="var(--success)" title="Layout">
            <div>
              <FieldLabel>Template</FieldLabel>
              <select value={templateType} onChange={(e) => handleTemplateTypeChange(e.target.value as BibleTemplateType)} style={selectStyle}>
                <option value="fullscreen">Fullscreen</option>
                <option value="lower-third">Lower Third</option>
              </select>
            </div>
            <div>
              {rangeWrap("Padding", settings.padding, "px")}
              <input type="range" min="0" max="150" value={settings.padding} onChange={(e) => update("padding", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
            </div>
            <div>
              {rangeWrap("Safe Area", settings.safeArea, "px")}
              <input type="range" min="0" max="100" value={settings.safeArea} onChange={(e) => update("safeArea", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
            </div>
            <div>
              {rangeWrap("Border Radius", settings.borderRadius, "px")}
              <input type="range" min="0" max="30" value={settings.borderRadius} onChange={(e) => update("borderRadius", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
            </div>
            {templateType === "lower-third" && (
              <div>
                <FieldLabel>Box Background</FieldLabel>
                <input type="text" value={settings.boxBackground} onChange={(e) => update("boxBackground", e.target.value)} placeholder="rgba(0,0,0,0.7)" style={inputStyle} />
              </div>
            )}
          </PanelSection>

          {/* Overlays */}
          <PanelSection icon="blur_on" iconColor="var(--warning)" title="Overlays">
            <div>
              <FieldLabel>Background Color</FieldLabel>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-dark)", padding: 4, borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <input type="color" value={settings.backgroundColor} onChange={(e) => update("backgroundColor", e.target.value)} style={{ width: 24, height: 24, borderRadius: "var(--radius)", cursor: "pointer", background: "transparent", border: "none" }} />
                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{settings.backgroundColor}</span>
              </div>
            </div>
            <div>
              {rangeWrap("Background Opacity", `${Math.round(settings.backgroundOpacity * 100)}`, "%")}
              <input type="range" min="0" max="1" step="0.05" value={settings.backgroundOpacity} onChange={(e) => update("backgroundOpacity", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <FieldLabel>Text Outline</FieldLabel>
                <input type="checkbox" checked={settings.textOutline} onChange={(e) => update("textOutline", e.target.checked)} style={{ accentColor: "var(--primary)", width: 14, height: 14 }} />
              </div>
              {settings.textOutline && (
                <FieldRow>
                  <div>
                    <FieldLabel>Outline Color</FieldLabel>
                    <input type="color" value={settings.textOutlineColor} onChange={(e) => update("textOutlineColor", e.target.value)} style={{ width: 40, height: 24, border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", background: "transparent" }} />
                  </div>
                  <div>
                    <FieldLabel>Width ({settings.textOutlineWidth}px)</FieldLabel>
                    <input type="range" min="0" max="5" step="0.5" value={settings.textOutlineWidth} onChange={(e) => update("textOutlineWidth", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--primary)" }} />
                  </div>
                </FieldRow>
              )}
            </div>
          </PanelSection>

          {/* Transition */}
          <PanelSection icon="animation" iconColor="var(--text-muted)" title="Transition">
            <FieldRow>
              <div>
                <FieldLabel>Animation In</FieldLabel>
                <select value={settings.animation} onChange={(e) => update("animation", e.target.value)} style={selectStyle}>
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="slide-up">Slide Up</option>
                  <option value="slide-left">Slide Left</option>
                  <option value="scale-in">Scale In</option>
                  <option value="reveal-bg-then-text">Reveal Background + Text</option>
                </select>
              </div>
              <div>
                <FieldLabel>Duration</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="range" min="100" max="1500" step="50" value={settings.animationDuration} onChange={(e) => update("animationDuration", Number(e.target.value))} style={{ flex: 1, accentColor: "var(--primary)" }} />
                  <span style={{ fontSize: 9, color: "var(--text-muted)", width: 30 }}>{settings.animationDuration}ms</span>
                </div>
              </div>
            </FieldRow>
          </PanelSection>

        </aside>
      </div>
    </div>
  );
}
