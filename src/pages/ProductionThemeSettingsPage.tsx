import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import type { BibleTheme } from "../bible/types";
import { deleteCustomTheme } from "../bible/bibleDb";
import ThemeCreatorModal from "./ThemeCreatorModal";
import { dockBridge } from "../services/dockBridge";
import {
  type DockProductionSettingsPayload,
  type ProductionSettings,
  getDefaultProductionSettings,
  getProductionSettings,
  loadAvailableProductionThemes,
  resolveProductionSettings,
  saveProductionSettings,
  syncProductionSettingsToDock,
} from "../services/productionSettings";

type StatusTone = "success" | "error";

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

function toPlainSettings(payload: DockProductionSettingsPayload): ProductionSettings {
  return {
    updatedAt: payload.updatedAt,
    bible: {
      defaultMode: payload.bible.defaultMode,
      fullscreenThemeId: payload.bible.fullscreenTheme.id,
      lowerThirdThemeId: payload.bible.lowerThirdTheme.id,
    },
    worship: {
      defaultMode: payload.worship.defaultMode,
      fullscreenThemeId: payload.worship.fullscreenTheme.id,
      lowerThirdThemeId: payload.worship.lowerThirdTheme.id,
    },
  };
}

function alignSettingsToThemes(
  settings: ProductionSettings,
  themes: BibleTheme[],
): ProductionSettings {
  return toPlainSettings(resolveProductionSettings(settings, themes));
}

function themeCategories(theme: BibleTheme): string {
  const categories = theme.categories?.length ? theme.categories : theme.category ? [theme.category] : [];
  return categories.length > 0 ? categories.join(", ") : "uncategorized";
}

export default function ProductionThemeSettingsPage() {
  const [themes, setThemes] = useState<BibleTheme[]>([]);
  const [settings, setSettings] = useState<ProductionSettings>(getDefaultProductionSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [editingTheme, setEditingTheme] = useState<BibleTheme | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [storedSettings, availableThemes] = await Promise.all([
        getProductionSettings(),
        loadAvailableProductionThemes(),
      ]);

      setThemes(availableThemes);
      setSettings(alignSettingsToThemes(storedSettings, availableThemes));
    } catch (err) {
      console.error("[ProductionThemeSettingsPage] Failed to load production settings:", err);
      setStatus({
        tone: "error",
        text: "Could not load production theme settings.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const customThemes = useMemo(
    () => themes.filter((theme) => theme.source === "custom"),
    [themes],
  );

  const persistSettings = useCallback(
    async (nextSettings: ProductionSettings, successText: string, themePool = themes) => {
      const aligned = alignSettingsToThemes(nextSettings, themePool);
      const saved = await saveProductionSettings(aligned);
      const dockPayload = await syncProductionSettingsToDock(saved);
      dockBridge.sendFullState({ productionSettings: dockPayload });
      setSettings(saved);
      setStatus({ tone: "success", text: successText });
    },
    [themes],
  );

  const handleSaveDefaults = useCallback(async () => {
    setSaving(true);
    try {
      await persistSettings(settings, "Production defaults saved for the OBS Dock.");
    } catch (err) {
      console.error("[ProductionThemeSettingsPage] Failed to save production settings:", err);
      setStatus({
        tone: "error",
        text: err instanceof Error ? err.message : "Failed to save production defaults.",
      });
    } finally {
      setSaving(false);
    }
  }, [persistSettings, settings]);

  const handleThemeSaved = useCallback(
    async (theme: BibleTheme) => {
      const isEditing = Boolean(editingTheme);
      const nextThemes = [...themes.filter((item) => item.id !== theme.id), theme].sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      setThemes(nextThemes);
      setShowCreator(false);
      setEditingTheme(null);

      try {
        const nextSettings = alignSettingsToThemes(settings, nextThemes);
        await persistSettings(
          nextSettings,
          isEditing ? `"${theme.name}" updated.` : `"${theme.name}" created.`,
          nextThemes,
        );
      } catch (err) {
        console.error("[ProductionThemeSettingsPage] Failed to sync production settings after theme save:", err);
        setSettings((current) => alignSettingsToThemes(current, nextThemes));
        setStatus({
          tone: "error",
          text: "Theme saved, but dock defaults could not be refreshed automatically.",
        });
      }
    },
    [editingTheme, persistSettings, settings, themes],
  );

  const handleDeleteTheme = useCallback(
    async (theme: BibleTheme) => {
      if (!window.confirm(`Delete "${theme.name}"? This cannot be undone.`)) {
        return;
      }

      try {
        await deleteCustomTheme(theme.id);
        const nextThemes = themes.filter((item) => item.id !== theme.id);
        setThemes(nextThemes);
        const nextSettings = alignSettingsToThemes(settings, nextThemes);
        await persistSettings(
          nextSettings,
          `"${theme.name}" deleted and defaults refreshed.`,
          nextThemes,
        );
      } catch (err) {
        console.error("[ProductionThemeSettingsPage] Failed to delete custom theme:", err);
        setStatus({
          tone: "error",
          text: err instanceof Error ? err.message : "Failed to delete theme.",
        });
      }
    },
    [persistSettings, settings, themes],
  );

  if (loading) {
    return (
      <div className="app-page production-page">
        <div className="app-page__inner">
          <section className="production-panel">
            <div className="production-loading">
              <Icon name="hourglass_empty" size={18} />
              Loading production theme settings...
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page production-page">
      <div className="app-page__inner">
        <header className="app-page__header">
          <div className="app-page__header-copy">
            <p className="app-page__eyebrow">Production Themes</p>
            <h1 className="app-page__title">Set the defaults the OBS Dock should use for Bible and Worship.</h1>
            <p className="app-page__subtitle">
              Theme editing stays in the app. The dock only stages content using the defaults you set here.
            </p>
          </div>

          <div className="app-page__actions">
            <button
              className="production-btn production-btn--ghost"
              onClick={() => {
                setEditingTheme(null);
                setShowCreator(true);
              }}
            >
              <Icon name="add" size={16} />
              Create Theme
            </button>
            <button
              className="production-btn production-btn--primary"
              onClick={handleSaveDefaults}
              disabled={saving}
            >
              <Icon name={saving ? "hourglass_empty" : "save"} size={16} />
              {saving ? "Saving..." : "Save Defaults"}
            </button>
          </div>
        </header>

        {status && (
          <div className={`production-status-banner production-status-banner--${status.tone}`}>
            <Icon name={status.tone === "success" ? "check_circle" : "error_outline"} size={16} />
            <span>{status.text}</span>
          </div>
        )}


        {/* <div className="production-module-grid">
          {renderModuleCard(
            "bible",
            "Bible Defaults",
            "Used by Bible preview/program sends from the OBS Dock.",
            resolvedSettings.bible.defaultMode,
            resolvedSettings.bible.fullscreenTheme,
            resolvedSettings.bible.lowerThirdTheme,
          )}
          {renderModuleCard(
            "worship",
            "Worship Defaults",
            "Used by Worship lyric preview/program sends from the OBS Dock.",
            resolvedSettings.worship.defaultMode,
            resolvedSettings.worship.fullscreenTheme,
            resolvedSettings.worship.lowerThirdTheme,
          )}
        </div> */}

        <section className="production-panel">
          <div className="production-card-head">
            <div>
              <h2>Custom Themes</h2>
              <p>Create and maintain the custom fullscreen and lower-third looks used in production mode.</p>
            </div>
            <span className="production-count-pill">{customThemes.length} custom</span>
          </div>

          {customThemes.length === 0 ? (
            <div className="production-empty">
              <Icon name="palette" size={18} />
              <div>
                <strong>No custom themes yet.</strong>
                <p>Create one here and then assign it above as a Bible or Worship default.</p>
              </div>
            </div>
          ) : (
            <div className="production-theme-list">
              {customThemes
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((theme) => (
                  <div key={theme.id} className="production-theme-row">
                    <div className="production-theme-row__swatch" style={{ background: theme.settings.backgroundColor }} />
                    <div className="production-theme-row__copy">
                      <strong>{theme.name}</strong>
                      <span>
                        {theme.templateType === "lower-third" ? "Lower Third" : "Fullscreen"} • {themeCategories(theme)}
                      </span>
                    </div>
                    <div className="production-theme-row__actions">
                      <button
                        className="production-btn production-btn--ghost"
                        onClick={() => {
                          setEditingTheme(theme);
                          setShowCreator(true);
                        }}
                      >
                        <Icon name="edit" size={16} />
                        Edit
                      </button>
                      <button
                        className="production-btn production-btn--danger"
                        onClick={() => void handleDeleteTheme(theme)}
                      >
                        <Icon name="delete" size={16} />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        {showCreator && (
          <ThemeCreatorModal
            editTheme={editingTheme}
            onClose={() => {
              setShowCreator(false);
              setEditingTheme(null);
            }}
            onSaved={(theme) => void handleThemeSaved(theme)}
          />
        )}
      </div>
    </div>
  );
}
