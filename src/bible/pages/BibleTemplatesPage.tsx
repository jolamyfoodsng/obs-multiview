/**
 * BibleTemplatesPage.tsx — Bible Theme Gallery page
 *
 * Browse built-in and custom themes, create new ones.
 */

import { useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBible } from "../bibleStore";
import { deleteCustomTheme } from "../bibleDb";
import type { BibleTheme } from "../types";
import BibleThemeEditor from "../components/BibleThemeEditor";
import Icon from "../../components/Icon";

export default function BibleTemplatesPage() {
  const navigate = useNavigate();
  const { state, dispatch, setTheme } = useBible();
  const [editingTheme, setEditingTheme] = useState<BibleTheme | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Track the theme that was active when the page loaded — for cancel/revert
  const previousThemeId = useRef(state.activeThemeId);

  // Track which theme the user has selected (highlighted) but NOT yet applied
  // Initially set to the current active theme
  const [selectedThemeId, setSelectedThemeId] = useState(state.activeThemeId);

  const builtinThemes = state.themes.filter((t) => t.source === "builtin");
  const customThemes = state.themes.filter((t) => t.source === "custom");
  const hiddenThemes = state.themes.filter((t) => t.hidden);

  // ── Colour-mode class (mirrors BibleHome) ──
  const effectiveColorMode = useMemo(() => {
    if (state.colorMode === "system") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return state.colorMode;
  }, [state.colorMode]);

  const rootClassName = useMemo(() => {
    const parts = ["bible-templates-page"];
    if (effectiveColorMode === "light") parts.push("light-mode");
    if (state.reduceMotion) parts.push("reduce-motion");
    if (state.highContrast) parts.push("high-contrast");
    return parts.join(" ");
  }, [effectiveColorMode, state.reduceMotion, state.highContrast]);

  /** Double-click: apply theme immediately and return */
  const applyThemeAndReturn = (themeId: string) => {
    setTheme(themeId);
    navigate("/bible");
  };

  /** Single-click: select/highlight the theme (preview only, NOT applied yet) */
  const selectThemePreview = (themeId: string) => {
    setSelectedThemeId(themeId);
  };

  /** Save = apply selected theme and go back */
  const handleSave = () => {
    if (selectedThemeId) {
      setTheme(selectedThemeId);
    }
    navigate("/bible");
  };

  /** Cancel = revert to previously active theme and go back */
  const handleCancel = () => {
    setTheme(previousThemeId.current);
    navigate("/bible");
  };

  const handleDelete = async (theme: BibleTheme) => {
    if (theme.source === "builtin") return;
    if (!confirm(`Delete theme "${theme.name}"?`)) return;

    await deleteCustomTheme(theme.id);
    dispatch({ type: "DELETE_THEME", id: theme.id });
  };

  if (isCreating || editingTheme) {
    return (
      <BibleThemeEditor
        editTheme={editingTheme}
        onSave={() => {
          setEditingTheme(null);
          setIsCreating(false);
        }}
        onCancel={() => {
          setEditingTheme(null);
          setIsCreating(false);
        }}
      />
    );
  }

  return (
    <div className={rootClassName}>
      <div className="bible-templates-header">
        <button className="bible-templates-back-btn" onClick={handleCancel}>
          <Icon name="arrow_back" size={20} />
          Back
        </button>
        <h1><Icon name="palette" size={20} />Bible Themes</h1>
        <button
          className="bible-templates-create-btn"
          onClick={() => setIsCreating(true)}
        >
          <Icon name="add" size={16} /> Create Theme
        </button>
      </div>

      {/* Built-in Themes */}
      <section className="bible-templates-section">
        <h2>Built-in Themes</h2>
        <div className="bible-templates-grid">
          {builtinThemes.map((theme) => (
            <div
              key={theme.id}
              className={`bible-template-card ${
                theme.id === selectedThemeId ? "active" : ""
              }`}
              onClick={() => selectThemePreview(theme.id)}
              onDoubleClick={() => applyThemeAndReturn(theme.id)}
            >
              <div
                className="bible-template-preview"
                style={{
                  backgroundColor: theme.settings.backgroundColor,
                  backgroundImage: theme.settings.backgroundImage ? `url(${theme.settings.backgroundImage})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  color: theme.settings.fontColor,
                  fontFamily: theme.settings.fontFamily,
                }}
              >
                <span
                  style={{
                    textShadow: theme.settings.textShadow,
                    fontSize: "14px",
                    fontWeight: theme.settings.fontWeight,
                  }}
                >
                  For God so loved the world...
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: theme.settings.refFontColor,
                    marginTop: "4px",
                  }}
                >
                  John 3:16 (KJV)
                </span>
              </div>
              <div className="bible-template-info">
                <h3>{theme.name}</h3>
                <p>{theme.description}</p>
                <div className="bible-template-meta">
                  <span className="bible-template-type">
                    {theme.templateType}
                  </span>
                </div>
              </div>
              <div className="bible-template-actions">
                <button
                  className={`bible-template-btn ${
                    theme.id === selectedThemeId ? "active" : ""
                  }`}
                  onClick={(e) => { e.stopPropagation(); selectThemePreview(theme.id); }}
                >
                  <Icon name={theme.id === selectedThemeId ? "check_circle" : "radio_button_unchecked"} size={14} />
                  {theme.id === selectedThemeId ? "Selected" : "Select"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Custom Themes */}
      <section className="bible-templates-section">
        <h2>Custom Themes ({customThemes.length})</h2>
        {customThemes.length === 0 ? (
          <div className="bible-templates-empty">
            <Icon name="brush" size={32} style={{ opacity: 0.3 }} />
            <p>No custom themes yet</p>
            <p>
              Click "Create Theme" to design your own overlay style.
            </p>
          </div>
        ) : (
          <div className="bible-templates-grid">
            {customThemes.map((theme) => (
              <div
                key={theme.id}
                className={`bible-template-card ${
                  theme.id === selectedThemeId ? "active" : ""
                }`}
                onClick={() => selectThemePreview(theme.id)}
                onDoubleClick={() => applyThemeAndReturn(theme.id)}
              >
                <div
                  className="bible-template-preview"
                  style={{
                    backgroundColor: theme.settings.backgroundColor,
                    backgroundImage: theme.settings.backgroundImage ? `url(${theme.settings.backgroundImage})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    color: theme.settings.fontColor,
                    fontFamily: theme.settings.fontFamily,
                  }}
                >
                  <span
                    style={{
                      textShadow: theme.settings.textShadow,
                      fontSize: "14px",
                      fontWeight: theme.settings.fontWeight,
                    }}
                  >
                    For God so loved the world...
                  </span>
                </div>
                <div className="bible-template-info">
                  <h3>{theme.name}</h3>
                  <p>{theme.description}</p>
                </div>
                <div className="bible-template-actions">
                  <button
                    className={`bible-template-btn ${
                      theme.id === selectedThemeId ? "active" : ""
                    }`}
                    onClick={(e) => { e.stopPropagation(); selectThemePreview(theme.id); }}
                  >
                    <Icon name={theme.id === selectedThemeId ? "check_circle" : "radio_button_unchecked"} size={14} />
                    {theme.id === selectedThemeId ? "Selected" : "Select"}
                  </button>
                  <button
                    className="bible-template-btn edit"
                    onClick={(e) => { e.stopPropagation(); setEditingTheme(theme); }}
                  >
                    <Icon name="edit" size={14} /> Edit
                  </button>
                  <button
                    className="bible-template-btn delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(theme); }}
                  >
                    <Icon name="delete" size={14} /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Hidden Themes */}
      {hiddenThemes.length > 0 && (
        <section className="bible-templates-section">
          <h2>Hidden Themes ({hiddenThemes.length})</h2>
          <div className="bible-templates-grid">
            {hiddenThemes.map((theme) => (
              <div key={theme.id} className="bible-template-card" style={{ opacity: 0.5 }}>
                <div
                  className="bible-template-preview"
                  style={{
                    backgroundColor: theme.settings.backgroundColor,
                    backgroundImage: theme.settings.backgroundImage ? `url(${theme.settings.backgroundImage})` : undefined,
                    backgroundSize: "cover", backgroundPosition: "center",
                    color: theme.settings.fontColor, fontFamily: theme.settings.fontFamily,
                  }}
                >
                  <span style={{ textShadow: theme.settings.textShadow, fontSize: "14px", fontWeight: theme.settings.fontWeight }}>
                    For God so loved the world...
                  </span>
                </div>
                <div className="bible-template-info">
                  <h3>{theme.name}</h3>
                  <p style={{ fontStyle: "italic", color: "var(--b-text-3)" }}>Hidden from theme picker</p>
                </div>
                <div className="bible-template-actions">
                  <button
                    className="bible-template-btn"
                    onClick={() => dispatch({ type: "UPDATE_THEME", theme: { ...theme, hidden: false } })}
                  >
                    <Icon name="visibility" size={14} /> Unhide
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Save / Cancel footer */}
      <div className="bible-templates-footer">
        <button className="bible-templates-footer-btn cancel" onClick={handleCancel}>
          <Icon name="close" size={16} />
          Cancel
        </button>
        <button className="bible-templates-footer-btn save" onClick={handleSave}>
          <Icon name="check" size={16} />
          Save &amp; Return
        </button>
      </div>
    </div>
  );
}
