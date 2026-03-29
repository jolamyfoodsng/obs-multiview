import { type CSSProperties, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { deleteCustomTheme, getCustomThemes, saveCustomTheme } from "../../bible/bibleDb";
import { DEFAULT_THEME_SETTINGS, type BibleTheme, type BibleThemeSettings } from "../../bible/types";
import Icon from "../../components/Icon";

const OBS_THEME_FONT_OPTIONS = [
  '"CMG Sans", sans-serif',
  '"CMG Sans Bold", "CMG Sans", sans-serif',
  '"CMG Sans Light", "CMG Sans", sans-serif',
  '"Inter", "Segoe UI", sans-serif',
  '"Georgia", "Times New Roman", serif',
  '"Merriweather", Georgia, serif',
  'system-ui, sans-serif',
];

const BUILTIN_FULLSCREEN_THEMES = BUILTIN_THEMES.filter(
  (theme) => theme.templateType === "fullscreen",
);

function clamp01(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const raw = color.trim();
  const fallback = { r: 0, g: 0, b: 0 };
  if (!raw.startsWith("#")) return fallback;
  const hex = raw.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    return fallback;
  }
  if (hex.length < 6) return fallback;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
  return fallback;
}

function toRgba(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha, 1)})`;
}

function buildSoftShadeGradient(color: string, opacity: number): string {
  const level = clamp01(opacity, DEFAULT_THEME_SETTINGS.fullscreenShadeOpacity);
  return `linear-gradient(180deg, ${toRgba(color, level * 0.62)} 0%, ${toRgba(color, level)} 100%)`;
}

function toCssFontWeight(weight: BibleThemeSettings["fontWeight"]): CSSProperties["fontWeight"] {
  if (weight === "light") return 300;
  if (weight === "bold") return 700;
  return 400;
}

function cloneThemeSettings(settings: BibleThemeSettings): BibleThemeSettings {
  const raw = JSON.parse(JSON.stringify(settings)) as Partial<BibleThemeSettings>;
  return {
    ...DEFAULT_THEME_SETTINGS,
    ...raw,
  };
}

function mergeObsThemes(customThemes: BibleTheme[]): BibleTheme[] {
  const mergedById = new Map<string, BibleTheme>();
  for (const theme of BUILTIN_FULLSCREEN_THEMES) {
    mergedById.set(theme.id, theme);
  }
  for (const theme of customThemes) {
    if (theme.templateType !== "fullscreen") continue;
    mergedById.set(theme.id, theme);
  }
  return Array.from(mergedById.values());
}

export function MVObsThemes() {
  const navigate = useNavigate();
  const bgUploadRef = useRef<HTMLInputElement | null>(null);

  const [obsThemes, setObsThemes] = useState<BibleTheme[]>(BUILTIN_FULLSCREEN_THEMES);
  const [selectedObsThemeId, setSelectedObsThemeId] = useState<string>(
    BUILTIN_FULLSCREEN_THEMES[0]?.id ?? "classic-dark",
  );
  const [obsThemeName, setObsThemeName] = useState("");
  const [obsThemeDescription, setObsThemeDescription] = useState("");
  const [obsThemeDraft, setObsThemeDraft] = useState<BibleThemeSettings | null>(null);
  const [obsThemeBusy, setObsThemeBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmDeleteTheme, setConfirmDeleteTheme] = useState<BibleTheme | null>(null);

  const selectedObsTheme = useMemo(
    () => obsThemes.find((theme) => theme.id === selectedObsThemeId) ?? null,
    [obsThemes, selectedObsThemeId],
  );

  const obsThemeBackgroundStyle = useMemo(() => {
    if (!obsThemeDraft) {
      return { background: "#111827" } as CSSProperties;
    }
    return {
      backgroundColor: obsThemeDraft.backgroundColor,
      backgroundImage: obsThemeDraft.backgroundImage
        ? `url(${obsThemeDraft.backgroundImage})`
        : undefined,
      backgroundSize: "cover",
      backgroundPosition: "center",
      opacity: clamp01(obsThemeDraft.backgroundOpacity, DEFAULT_THEME_SETTINGS.backgroundOpacity),
    } as CSSProperties;
  }, [obsThemeDraft]);

  const obsThemeShadeStyle = useMemo(() => {
    if (!obsThemeDraft || obsThemeDraft.fullscreenShadeEnabled === false) {
      return { display: "none" } as CSSProperties;
    }
    return {
      backgroundImage: buildSoftShadeGradient(
        obsThemeDraft.fullscreenShadeColor || DEFAULT_THEME_SETTINGS.fullscreenShadeColor,
        clamp01(
          obsThemeDraft.fullscreenShadeOpacity,
          DEFAULT_THEME_SETTINGS.fullscreenShadeOpacity,
        ),
      ),
    } as CSSProperties;
  }, [obsThemeDraft]);

  const loadObsThemes = useCallback(async () => {
    try {
      const customThemes = await getCustomThemes();
      const merged = mergeObsThemes(customThemes);
      setObsThemes(merged);
      setSelectedObsThemeId((prev) => {
        if (merged.some((theme) => theme.id === prev)) return prev;
        return merged[0]?.id ?? "classic-dark";
      });
    } catch (error) {
      console.warn("[MVObsThemes] Failed to load OBS themes:", error);
      setObsThemes(BUILTIN_FULLSCREEN_THEMES);
      setSelectedObsThemeId(BUILTIN_FULLSCREEN_THEMES[0]?.id ?? "classic-dark");
    }
  }, []);

  useEffect(() => {
    void loadObsThemes();
  }, [loadObsThemes]);

  useEffect(() => {
    if (!selectedObsTheme) {
      setObsThemeName("");
      setObsThemeDescription("");
      setObsThemeDraft(null);
      return;
    }
    setObsThemeName(selectedObsTheme.name);
    setObsThemeDescription(selectedObsTheme.description ?? "");
    setObsThemeDraft(cloneThemeSettings(selectedObsTheme.settings));
  }, [selectedObsTheme]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const updateObsThemeDraft = (patch: Partial<BibleThemeSettings>) => {
    setObsThemeDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleObsBackgroundUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateObsThemeDraft({ backgroundImage: reader.result });
        setToastMessage(`Background loaded: ${file.name}. Save theme to apply.`);
      }
    };
    reader.onerror = () => {
      setToastMessage("Could not read selected image.");
    };
    reader.readAsDataURL(file);
  };

  const handleCreateObsTheme = async () => {
    setObsThemeBusy(true);
    try {
      const now = new Date().toISOString();
      const id = `obs-theme-${Date.now()}`;
      const newTheme: BibleTheme = {
        id,
        name: "New Fullscreen Theme",
        description: "Custom fullscreen theme for Bible and Worship.",
        source: "custom",
        templateType: "fullscreen",
        settings: cloneThemeSettings(DEFAULT_THEME_SETTINGS),
        createdAt: now,
        updatedAt: now,
      };
      await saveCustomTheme(newTheme);
      await loadObsThemes();
      setSelectedObsThemeId(id);
      window.dispatchEvent(new Event("obs-themes-updated"));
      setToastMessage("Created new OBS theme.");
    } catch (error) {
      console.error("[MVObsThemes] Failed to create OBS theme:", error);
      setToastMessage("Could not create OBS theme.");
    } finally {
      setObsThemeBusy(false);
    }
  };

  const handleSaveObsTheme = async () => {
    if (!obsThemeDraft) {
      setToastMessage("Select a theme to edit.");
      return;
    }

    setObsThemeBusy(true);
    try {
      const now = new Date().toISOString();
      const isBuiltin = selectedObsTheme?.source === "builtin";
      const themeId = isBuiltin
        ? `obs-theme-${Date.now()}`
        : (selectedObsTheme?.id ?? `obs-theme-${Date.now()}`);

      const themeToSave: BibleTheme = {
        id: themeId,
        name: obsThemeName.trim() || "Custom Theme",
        description: obsThemeDescription.trim() || "Custom fullscreen OBS theme.",
        source: "custom",
        templateType: "fullscreen",
        settings: cloneThemeSettings(obsThemeDraft),
        createdAt: !isBuiltin && selectedObsTheme ? selectedObsTheme.createdAt : now,
        updatedAt: now,
      };

      await saveCustomTheme(themeToSave);
      await loadObsThemes();
      setSelectedObsThemeId(themeToSave.id);
      window.dispatchEvent(new Event("obs-themes-updated"));
      setToastMessage(
        isBuiltin
          ? `Saved as custom theme "${themeToSave.name}".`
          : `Saved theme "${themeToSave.name}".`,
      );
    } catch (error) {
      console.error("[MVObsThemes] Failed to save OBS theme:", error);
      setToastMessage("Could not save OBS theme.");
    } finally {
      setObsThemeBusy(false);
    }
  };

  const handleDeleteObsTheme = async (themeToDelete: BibleTheme) => {
    if (themeToDelete.source === "builtin") {
      setToastMessage("Built-in themes cannot be deleted.");
      return;
    }

    setObsThemeBusy(true);
    try {
      await deleteCustomTheme(themeToDelete.id);
      await loadObsThemes();
      window.dispatchEvent(new Event("obs-themes-updated"));
      setToastMessage(`Deleted theme "${themeToDelete.name}".`);
    } catch (error) {
      console.error("[MVObsThemes] Failed to delete OBS theme:", error);
      setToastMessage("Could not delete OBS theme.");
    } finally {
      setObsThemeBusy(false);
      setConfirmDeleteTheme(null);
    }
  };

  return (
    <div className="tpldash-page">
      <aside className="tpldash-sidebar">
        <div className="tpldash-sidebar-top">
          <div>
            <h1 className="tpldash-brand-title">OBS Helper</h1>
            <p className="tpldash-brand-subtitle">Sunday Service</p>
          </div>

          <nav className="tpldash-module-nav" aria-label="Template module navigation">
            <button className="tpldash-module-link" type="button" onClick={() => navigate("/service-hub")}>
              <Icon name="church" size={20} />
              <span>Services</span>
            </button>

            <button className="tpldash-module-link" type="button" onClick={() => navigate("/hub?mode=live&tab=worship")}>
              <Icon name="music_note" size={20} />
              <span>Lyrics</span>
            </button>

            <button className="tpldash-module-link" type="button" onClick={() => navigate("/hub?mode=live&tab=bible")}>
              <Icon name="menu_book" size={20} />
              <span>Scripture</span>
            </button>

            <button className="tpldash-module-link" type="button" onClick={() => navigate("/resources")}>
              <Icon name="volunteer_activism" size={20} />
              <span>Giving</span>
            </button>

            <button className="tpldash-module-link is-active" type="button" aria-current="page">
              <Icon name="palette" size={20} />
              <span>OBS Themes</span>
            </button>

            <button className="tpldash-module-link" type="button" onClick={() => navigate("/hub?mode=live&tab=graphics")}>
              <Icon name="campaign" size={20} />
              <span>Announcements</span>
            </button>
          </nav>
        </div>

        <div className="tpldash-sidebar-bottom">
          <button className="tpldash-go-live-btn" type="button" onClick={() => navigate("/hub?mode=live")}>
            <Icon name="videocam" size={20} />
            <span>Go Live</span>
          </button>
        </div>
      </aside>

      <main className="tpldash-main">
        <section className="tpldash-center">
          <header className="tpldash-header">
            <div>
              <h2 className="tpldash-title">OBS Output Themes</h2>
              <p className="tpldash-subtitle">Manage Bible and Worship fullscreen themes sent to OBS.</p>
            </div>

            <div className="tpldash-header-actions">
              <button className="tpldash-action-btn" type="button" onClick={() => navigate("/resources")}>
                <Icon name="arrow_back" size={20} />
                <span>Back</span>
              </button>              <button className="tpldash-action-btn" type="button" onClick={() => { void loadObsThemes(); }} disabled={obsThemeBusy}>
                <Icon name="refresh" size={20} />
                <span>Reload</span>
              </button>

              <button className="tpldash-action-btn" type="button" onClick={() => { void handleCreateObsTheme(); }} disabled={obsThemeBusy}>
                <Icon name="add" size={20} />
                <span>New Theme</span>
              </button>
            </div>
          </header>

          <section className="tpldash-obs-theme-section" style={{ marginTop: 0 }}>
            <input
              ref={bgUploadRef}
              type="file"
              accept="image/*"
              onChange={handleObsBackgroundUpload}
              style={{ display: "none" }}
            />

            <div className="tpldash-obs-theme-layout">
              <div className="tpldash-obs-theme-list">
                {obsThemes.map((theme) => (
                  <button
                    key={theme.id}
                    className={`tpldash-obs-theme-item${theme.id === selectedObsThemeId ? " is-active" : ""}`}
                    type="button"
                    onClick={() => setSelectedObsThemeId(theme.id)}
                  >
                    <div
                      className="tpldash-obs-theme-item-preview"
                      style={{
                        backgroundColor: theme.settings.backgroundColor,
                        backgroundImage: theme.settings.backgroundImage ? `url(${theme.settings.backgroundImage})` : undefined,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    <div className="tpldash-obs-theme-item-meta">
                      <span>{theme.name}</span>
                      <small>{theme.source === "builtin" ? "Built-in" : "Custom"}</small>
                    </div>
                  </button>
                ))}
              </div>

              <div className="tpldash-obs-theme-editor">
                {!obsThemeDraft ? (
                  <div className="tpldash-empty" style={{ marginTop: 0 }}>
                    <Icon name="palette" size={20} />
                    <p>Select a theme to edit.</p>
                  </div>
                ) : (
                  <>
                    <div className="tpldash-obs-theme-preview" style={{ position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: 0, zIndex: 0, ...obsThemeBackgroundStyle }} />
                      <div style={{ position: "absolute", inset: 0, zIndex: 1, ...obsThemeShadeStyle }} />
                      <span
                        style={{
                          position: "relative",
                          zIndex: 2,
                          fontFamily: obsThemeDraft.fontFamily,
                          fontSize: `${Math.min(38, Math.max(16, obsThemeDraft.fontSize * 0.5))}px`,
                          fontWeight: toCssFontWeight(obsThemeDraft.fontWeight),
                          color: obsThemeDraft.fontColor,
                          textShadow: obsThemeDraft.textShadow,
                          textTransform: obsThemeDraft.textTransform,
                        }}
                      >
                        For God so loved the world...
                      </span>
                    </div>

                    <div className="tpldash-obs-theme-form">
                      <label className="tpldash-input-label">
                        Theme Name
                        <input className="tpldash-input" value={obsThemeName} onChange={(e) => setObsThemeName(e.target.value)} />
                      </label>

                      <label className="tpldash-input-label">
                        Description
                        <textarea
                          className="tpldash-input tpldash-input--textarea"
                          value={obsThemeDescription}
                          onChange={(e) => setObsThemeDescription(e.target.value)}
                        />
                      </label>

                      <div className="tpldash-obs-theme-grid">
                        <label className="tpldash-input-label">
                          Font Family
                          <select
                            className="tpldash-input"
                            value={obsThemeDraft.fontFamily}
                            onChange={(e) => updateObsThemeDraft({ fontFamily: e.target.value })}
                          >
                            {OBS_THEME_FONT_OPTIONS.map((font) => (
                              <option key={font} value={font}>{font}</option>
                            ))}
                          </select>
                        </label>

                        <label className="tpldash-input-label">
                          Text Case
                          <select
                            className="tpldash-input"
                            value={obsThemeDraft.textTransform}
                            onChange={(e) => updateObsThemeDraft({ textTransform: e.target.value as BibleThemeSettings["textTransform"] })}
                          >
                            <option value="none">Normal</option>
                            <option value="uppercase">UPPERCASE</option>
                            <option value="lowercase">lowercase</option>
                            <option value="capitalize">Capitalize</option>
                          </select>
                        </label>

                        <label className="tpldash-input-label">
                          Font Weight
                          <select
                            className="tpldash-input"
                            value={obsThemeDraft.fontWeight}
                            onChange={(e) => updateObsThemeDraft({ fontWeight: e.target.value as BibleThemeSettings["fontWeight"] })}
                          >
                            <option value="light">Light</option>
                            <option value="normal">Regular</option>
                            <option value="bold">Bold</option>
                          </select>
                        </label>

                        <label className="tpldash-input-label">
                          Font Size ({obsThemeDraft.fontSize}px)
                          <input
                            className="tpldash-duration-slider"
                            type="range"
                            min={18}
                            max={110}
                            value={obsThemeDraft.fontSize}
                            onChange={(e) => updateObsThemeDraft({ fontSize: Number(e.target.value) })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Font Color
                          <input
                            className="tpldash-theme-color-input"
                            type="color"
                            value={obsThemeDraft.fontColor}
                            onChange={(e) => updateObsThemeDraft({ fontColor: e.target.value })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Background Color
                          <input
                            className="tpldash-theme-color-input"
                            type="color"
                            value={obsThemeDraft.backgroundColor}
                            onChange={(e) => updateObsThemeDraft({ backgroundColor: e.target.value })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Background Opacity ({Math.round(clamp01(obsThemeDraft.backgroundOpacity, 1) * 100)}%)
                          <input
                            className="tpldash-duration-slider"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={clamp01(obsThemeDraft.backgroundOpacity, 1)}
                            onChange={(e) => updateObsThemeDraft({ backgroundOpacity: Number(e.target.value) })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Dark Shade Opacity ({Math.round(clamp01(obsThemeDraft.fullscreenShadeOpacity, DEFAULT_THEME_SETTINGS.fullscreenShadeOpacity) * 100)}%)
                          <input
                            className="tpldash-duration-slider"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={clamp01(obsThemeDraft.fullscreenShadeOpacity, DEFAULT_THEME_SETTINGS.fullscreenShadeOpacity)}
                            onChange={(e) => updateObsThemeDraft({ fullscreenShadeOpacity: Number(e.target.value) })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Dark Shade Color
                          <input
                            className="tpldash-theme-color-input"
                            type="color"
                            value={obsThemeDraft.fullscreenShadeColor || DEFAULT_THEME_SETTINGS.fullscreenShadeColor}
                            onChange={(e) => updateObsThemeDraft({ fullscreenShadeColor: e.target.value })}
                          />
                        </label>
                      </div>

                      <label className="tpldash-input-label">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={obsThemeDraft.fullscreenShadeEnabled !== false}
                            onChange={(e) => updateObsThemeDraft({ fullscreenShadeEnabled: e.target.checked })}
                          />
                          Enable Soft Dark Overlay (Fullscreen)
                        </span>
                      </label>

                      <label className="tpldash-input-label">
                        Background Image URL (optional)
                        <input
                          className="tpldash-input"
                          placeholder="https://... or data:image/..."
                          value={obsThemeDraft.backgroundImage}
                          onChange={(e) => updateObsThemeDraft({ backgroundImage: e.target.value })}
                        />
                      </label>

                      <div className="tpldash-obs-theme-actions">
                        <button
                          className="tpldash-theme-save-btn"
                          type="button"
                          onClick={() => bgUploadRef.current?.click()}
                          disabled={obsThemeBusy}
                        >
                          <Icon name="upload" size={20} />
                          <span>Upload BG</span>
                        </button>

                        <button
                          className="tpldash-theme-delete-btn"
                          type="button"
                          onClick={() => updateObsThemeDraft({ backgroundImage: "" })}
                          disabled={!obsThemeDraft.backgroundImage || obsThemeBusy}
                        >
                          <Icon name="image_not_supported" size={20} />
                          <span>Clear BG</span>
                        </button>
                      </div>

                      <div className="tpldash-obs-theme-actions">
                        <button
                          className="tpldash-theme-delete-btn"
                          type="button"
                          onClick={() => {
                            if (!selectedObsTheme || selectedObsTheme.source === "builtin") {
                              setToastMessage("Built-in themes cannot be deleted.");
                              return;
                            }
                            setConfirmDeleteTheme(selectedObsTheme);
                          }}
                          disabled={obsThemeBusy || selectedObsTheme?.source === "builtin"}
                        >
                          <Icon name="delete" size={20} />
                          <span>Delete</span>
                        </button>

                        <button
                          className="tpldash-theme-save-btn"
                          type="button"
                          onClick={() => { void handleSaveObsTheme(); }}
                          disabled={obsThemeBusy}
                        >
                          <Icon name="save" size={20} />
                          <span>{selectedObsTheme?.source === "builtin" ? "Save as Custom" : "Save Theme"}</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {toastMessage && (
            <div className="tpldash-toast" role="status" aria-live="polite">
              <Icon name="check_circle" size={20} />
              <span>{toastMessage}</span>
              <button
                className="tpldash-toast-close"
                type="button"
                onClick={() => setToastMessage(null)}
                aria-label="Dismiss notification"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          )}

          {confirmDeleteTheme && (
            <div className="end-confirm-backdrop" onClick={() => setConfirmDeleteTheme(null)}>
              <div className="end-confirm-modal" onClick={(event) => event.stopPropagation()}>
                <h2>Delete Theme?</h2>
                <p>
                  Are you sure you want to delete <strong>{confirmDeleteTheme.name}</strong>? This cannot be undone.
                </p>
                <div className="end-confirm-actions">
                  <button
                    type="button"
                    className="end-confirm-btn-cancel"
                    onClick={() => setConfirmDeleteTheme(null)}
                    disabled={obsThemeBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="end-confirm-btn-end"
                    onClick={() => { void handleDeleteObsTheme(confirmDeleteTheme); }}
                    disabled={obsThemeBusy}
                  >
                    Delete Theme
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
