/**
 * BibleSettingsPage.tsx — Comprehensive settings for the Bible module
 *
 * Configurable sections:
 * 1. Appearance — Dark / Light / System mode
 * 2. Default translation & theme
 * 3. Slide configuration
 * 4. Behaviour — auto-send, double-click
 * 5. Accessibility — reduce motion, high contrast, font scale
 * 6. Keyboard shortcuts reference
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBible } from "../bibleStore";
import { getBibleSettings, saveBibleSettings, getInstalledTranslations } from "../bibleDb";
import type { BibleTranslation } from "../types";
import {
  SHORTCUTS,
  shortcutLabel,
  getShortcutsByCategory,
  type ShortcutCategory,
} from "../../multiview/shortcuts";
import Icon from "../../components/Icon";

const FALLBACK_TRANSLATIONS: { value: string; label: string }[] = [
  { value: "KJV", label: "King James Version (KJV)" },
];

export default function BibleSettingsPage() {
  const navigate = useNavigate();
  const { state, dispatch, setTheme } = useBible();

  // ── Local state mirroring store for editing ──
  const [defaultTranslation, setDefaultTranslation] = useState(state.translation);
  const [defaultThemeId, setDefaultThemeId] = useState(state.activeThemeId);
  const [showVerseNumbers, setShowVerseNumbers] = useState(state.slideConfig.showVerseNumbers);
  const [maxLines, setMaxLines] = useState(state.slideConfig.maxLines);
  const [autoSend, setAutoSend] = useState(state.autoSendOnDoubleClick);
  const [colorMode, setColorMode] = useState(state.colorMode);
  const [reduceMotion, setReduceMotion] = useState(state.reduceMotion);
  const [highContrast, setHighContrast] = useState(state.highContrast);
  const [saved, setSaved] = useState(false);
  const [translations, setTranslations] = useState(FALLBACK_TRANSLATIONS);

  // Load saved settings on mount
  useEffect(() => {
    getBibleSettings().then((s) => {
      setDefaultTranslation((s.defaultTranslation as BibleTranslation) ?? "KJV");
      setDefaultThemeId(s.activeThemeId ?? "classic-dark");
      setColorMode(s.colorMode ?? "dark");
      setAutoSend(s.autoSendOnDoubleClick ?? true);
      setReduceMotion(s.reduceMotion ?? false);
      setHighContrast(s.highContrast ?? false);
    }).catch(console.error);

    // Load installed translations dynamically
    getInstalledTranslations().then((list) => {
      if (list.length > 0) {
        setTranslations(
          list.map((t) => ({ value: t.abbr, label: `${t.name} (${t.abbr})` }))
        );
      }
    }).catch(console.error);
  }, []);

  const handleSave = useCallback(async () => {
    // Apply changes to store
    dispatch({ type: "SET_TRANSLATION", translation: defaultTranslation });
    dispatch({
      type: "SET_SLIDE_CONFIG",
      config: { ...state.slideConfig, showVerseNumbers, maxLines },
    });
    dispatch({ type: "SET_COLOR_MODE", mode: colorMode });
    dispatch({ type: "SET_AUTO_SEND", enabled: autoSend });
    dispatch({ type: "SET_REDUCE_MOTION", enabled: reduceMotion });
    dispatch({ type: "SET_HIGH_CONTRAST", enabled: highContrast });
    setTheme(defaultThemeId);

    // Persist
    await saveBibleSettings({
      defaultTranslation,
      activeThemeId: defaultThemeId,
      slideConfig: { ...state.slideConfig, showVerseNumbers, maxLines },
      colorMode,
      autoSendOnDoubleClick: autoSend,
      reduceMotion,
      highContrast,
    });

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [defaultTranslation, defaultThemeId, showVerseNumbers, maxLines, colorMode, autoSend, reduceMotion, highContrast, dispatch, setTheme, state.slideConfig]);

  const handleBack = useCallback(() => {
    navigate("/bible");
  }, [navigate]);

  // Effective color mode (for live preview of the page)
  const effectiveColorMode = useMemo(() => {
    if (colorMode === "system") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return colorMode;
  }, [colorMode]);

  const rootClassName = useMemo(() => {
    const parts = ["bible-templates-page"];
    if (effectiveColorMode === "light") parts.push("light-mode");
    if (reduceMotion) parts.push("reduce-motion");
    if (highContrast) parts.push("high-contrast");
    return parts.join(" ");
  }, [effectiveColorMode, reduceMotion, highContrast]);

  return (
    <div className={rootClassName}>
      <div className="bible-templates-header">
        <button className="bible-templates-back-btn" onClick={handleBack}>
          <Icon name="arrow_back" size={20} />
          Back
        </button>
        <h1>
          <Icon name="settings" size={20} />
          Bible Settings
        </h1>
        <button className="bible-templates-create-btn" onClick={handleSave}>
          <Icon name="check" size={16} />
          {saved ? "Saved ✓" : "Save Settings"}
        </button>
      </div>

      <div className="b-scroll" style={{ flex: 1, overflow: "auto", padding: "0 24px 32px" }}>

        {/* ── 1. Appearance ── */}
        <div className="bible-settings-section">
          <h2 className="bible-settings-section-title">
            <Icon name="palette" size={20} />
            Appearance
          </h2>
          <label className="bible-settings-label">Colour Mode</label>
          <div className="bible-settings-color-mode-group">
            {(["dark", "light", "system"] as const).map((mode) => (
              <button
                key={mode}
                className={`bible-settings-color-mode-btn${colorMode === mode ? " active" : ""}`}
                onClick={() => setColorMode(mode)}
              >
                <Icon name={mode === "dark" ? "dark_mode" : mode === "light" ? "light_mode" : "settings_brightness"} size={20} />
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <p className="bible-settings-hint" style={{ marginTop: 8 }}>
            Controls the Bible interface colour scheme. &quot;System&quot; follows your OS preference.
          </p>
        </div>

        {/* ── 2. Translation ── */}
        <div className="bible-settings-section">
          <h2 className="bible-settings-section-title">
            <Icon name="translate" size={20} />
            Default Translation
          </h2>
          <label className="bible-settings-label">Translation</label>
          <select
            value={defaultTranslation}
            onChange={(e) => setDefaultTranslation(e.target.value as BibleTranslation)}
            className="bible-settings-select"
          >
            {translations.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <p className="bible-settings-hint" style={{ marginTop: 6 }}>
            Sets the default Bible translation used when the app starts.
          </p>
        </div>

        {/* ── 3. Default Theme ── */}
        <div className="bible-settings-section">
          <h2 className="bible-settings-section-title">
            <Icon name="brush" size={20} />
            Default Theme
          </h2>
          <label className="bible-settings-label">Active Theme</label>
          <select
            value={defaultThemeId}
            onChange={(e) => setDefaultThemeId(e.target.value)}
            className="bible-settings-select"
          >
            {state.themes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.hidden ? " (hidden)" : ""}</option>
            ))}
          </select>
          <p className="bible-settings-hint" style={{ marginTop: 6 }}>
            Choose the theme that will be active when the app launches.
          </p>
        </div>

        {/* ── 4. Slide Config ── */}
        <div className="bible-settings-section">
          <h2 className="bible-settings-section-title">
            <Icon name="view_carousel" size={20} />
            Slide Settings
          </h2>

          <div style={{ marginBottom: 12 }}>
            <label className="bible-settings-label">Max Lines Per Slide</label>
            <input
              type="number" min={1} max={10} value={maxLines}
              onChange={(e) => setMaxLines(Number(e.target.value))}
              className="bible-settings-input"
              style={{ maxWidth: 100 }}
            />
          </div>

          <label className="bible-settings-checkbox-row">
            <input
              type="checkbox" checked={showVerseNumbers}
              onChange={(e) => setShowVerseNumbers(e.target.checked)}
            />
            Show verse numbers inline
          </label>
        </div>

        {/* ── 5. Behaviour ── */}
        <div className="bible-settings-section">
          <h2 className="bible-settings-section-title">
            <Icon name="tune" size={20} />
            Behaviour
          </h2>

          <label className="bible-settings-checkbox-row">
            <input
              type="checkbox" checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
            />
            Auto-send verse on double-click
          </label>
          <p className="bible-settings-hint" style={{ marginLeft: 22 }}>
            When enabled, double-clicking a verse immediately sends it to OBS.
          </p>
        </div>

        {/* ── 6. Accessibility ── */}
        <div className="bible-settings-section">
          <h2 className="bible-settings-section-title">
            <Icon name="accessibility_new" size={20} />
            Accessibility
          </h2>

          <label className="bible-settings-checkbox-row">
            <input
              type="checkbox" checked={reduceMotion}
              onChange={(e) => setReduceMotion(e.target.checked)}
            />
            Reduce motion &amp; animations
          </label>
          <p className="bible-settings-hint" style={{ marginLeft: 22, marginBottom: 10 }}>
            Disables all CSS transitions and animations in the Bible interface.
          </p>

          <label className="bible-settings-checkbox-row">
            <input
              type="checkbox" checked={highContrast}
              onChange={(e) => setHighContrast(e.target.checked)}
            />
            High-contrast mode
          </label>
          <p className="bible-settings-hint" style={{ marginLeft: 22 }}>
            Increases contrast of borders, text, and controls for better readability.
          </p>
        </div>

        {/* ── 7. Keyboard Shortcuts Reference ── */}
        <div className="bible-settings-section" style={{ borderBottom: "none" }}>
          <h2 className="bible-settings-section-title">
            <Icon name="keyboard" size={20} />
            Keyboard Shortcuts
          </h2>
          <div className="bible-settings-shortcut-grid">
            {(Array.from(getShortcutsByCategory().entries()) as [ShortcutCategory, typeof SHORTCUTS[number][]][])
              .filter(([cat]) => cat === "bible")
              .flatMap(([, items]) =>
                items.map((s) => (
                  <div key={s.id} style={{ display: "contents" }}>
                    <kbd>{shortcutLabel(s.keys)}</kbd>
                    <span>{s.label}{s.description ? ` — ${s.description}` : ""}</span>
                  </div>
                ))
              )}
          </div>
        </div>

      </div>
    </div>
  );
}
