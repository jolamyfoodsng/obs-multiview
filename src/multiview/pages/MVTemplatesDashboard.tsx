import { type CSSProperties, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as db from "../mvStore";
import { TEMPLATE_LIBRARY, createLayoutFromTemplate } from "../templates";
import type { TemplateCategory } from "../types";
import type { BibleTheme, BibleThemeSettings } from "../../bible/types";
import { DEFAULT_THEME_SETTINGS } from "../../bible/types";
import { BUILTIN_THEMES } from "../../bible/themes/builtinThemes";
import { deleteCustomTheme, getCustomThemes, saveCustomTheme } from "../../bible/bibleDb";
import Icon from "../../components/Icon";

type DashboardCategory = TemplateCategory | "all";
type DisplayElementId = "website" | "qr" | "bank" | "phone" | "social" | "notes";

interface DashboardSettings {
  selectedTemplateId: string;
  displayElements: DisplayElementId[];
  durationSec: number;
  autoShowQr: boolean;
  loopAnimation: boolean;
  bankName: string;
  accountNumber: string;
  themes: TemplatesDashboardTheme[];
  activeThemeId: string;
}

interface TemplatesDashboardTheme {
  id: string;
  name: string;
  backgroundMode: "solid" | "gradient";
  backgroundStart: string;
  backgroundEnd: string;
  sidebarSurface: string;
  panelSurface: string;
  cardSurface: string;
}

const DASHBOARD_STORAGE_KEY = "mv-templates-dashboard-settings-v1";

const CATEGORY_LABELS: Record<DashboardCategory, string> = {
  all: "All",
  sermon: "Sermon",
  worship: "Worship",
  announcement: "Announcement",
  ceremony: "Ceremony",
  "multi-camera": "Multi-Camera",
  youth: "Youth",
  kids: "Kids",
  custom: "Custom",
};

const CATEGORY_ICONS: Record<DashboardCategory, string> = {
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

const CATEGORIES: DashboardCategory[] = [
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

const DISPLAY_ELEMENTS: { id: DisplayElementId; label: string; icon: string }[] = [
  { id: "website", label: "Website", icon: "language" },
  { id: "qr", label: "QR Code", icon: "qr_code_2" },
  { id: "bank", label: "Bank", icon: "account_balance" },
  { id: "phone", label: "Phone", icon: "call" },
  { id: "social", label: "Social", icon: "alternate_email" },
  { id: "notes", label: "Notes", icon: "notes" },
];

const DISPLAY_ELEMENT_IDS = new Set(DISPLAY_ELEMENTS.map((item) => item.id));
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const DEFAULT_DASHBOARD_THEMES: TemplatesDashboardTheme[] = [
  {
    id: "theme_emerald",
    name: "Emerald Night",
    backgroundMode: "gradient",
    backgroundStart: "#0f1f16",
    backgroundEnd: "#1d2f26",
    sidebarSurface: "#12231a",
    panelSurface: "#15261e",
    cardSurface: "#1b2f25",
  },
  {
    id: "theme_ocean",
    name: "Deep Ocean",
    backgroundMode: "gradient",
    backgroundStart: "#101b2b",
    backgroundEnd: "#163348",
    sidebarSurface: "#142131",
    panelSurface: "#162637",
    cardSurface: "#1b3045",
  },
  {
    id: "theme_warm",
    name: "Warm Stage",
    backgroundMode: "gradient",
    backgroundStart: "#231917",
    backgroundEnd: "#3a241f",
    sidebarSurface: "#2b1f1b",
    panelSurface: "#30231f",
    cardSurface: "#3a2c28",
  },
];

const DEFAULT_SETTINGS: DashboardSettings = {
  selectedTemplateId: TEMPLATE_LIBRARY[0]?.id ?? "",
  displayElements: ["website", "qr", "bank"],
  durationSec: 12,
  autoShowQr: true,
  loopAnimation: false,
  bankName: "First City Church",
  accountNumber: "**** **** 8842",
  themes: DEFAULT_DASHBOARD_THEMES,
  activeThemeId: DEFAULT_DASHBOARD_THEMES[0].id,
};

const OBS_THEME_FONT_OPTIONS = [
  '"CMG Sans", sans-serif',
  '"CMG Sans Bold", "CMG Sans", sans-serif',
  '"CMG Sans Light", "CMG Sans", sans-serif',
  '"Inter", "Segoe UI", sans-serif',
  '"Georgia", "Times New Roman", serif',
  '"Merriweather", Georgia, serif',
  'system-ui, sans-serif',
];

const BUILTIN_FULLSCREEN_OBS_THEMES = BUILTIN_THEMES.filter(
  (theme) => theme.templateType === "fullscreen",
);

function cloneThemeSettings(settings: BibleThemeSettings): BibleThemeSettings {
  return JSON.parse(JSON.stringify(settings)) as BibleThemeSettings;
}

function mergeObsThemes(customThemes: BibleTheme[]): BibleTheme[] {
  const merged = new Map<string, BibleTheme>();
  for (const theme of BUILTIN_FULLSCREEN_OBS_THEMES) {
    merged.set(theme.id, theme);
  }
  for (const theme of customThemes) {
    if (theme.templateType !== "fullscreen") continue;
    merged.set(theme.id, theme);
  }
  return Array.from(merged.values());
}

function regionColor(type: string): string {
  switch (type) {
    case "obs-scene":
      return "#6c5ce7";
    case "video-input":
      return "#0078d4";
    case "image-overlay":
      return "#00bcd4";
    case "media":
      return "#9c27b0";
    case "browser":
      return "#ff5722";
    case "color":
      return "#78909c";
    default:
      return "#666";
  }
}

function clampDuration(value: number): number {
  return Math.max(5, Math.min(30, Math.round(value)));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : fallback;
}

function normalizeTheme(
  value: unknown,
  fallback: TemplatesDashboardTheme,
  index: number,
): TemplatesDashboardTheme {
  const source = (value ?? {}) as Partial<TemplatesDashboardTheme>;
  const id =
    typeof source.id === "string" && source.id.trim().length > 0
      ? source.id
      : `theme_custom_${index + 1}`;

  return {
    id,
    name:
      typeof source.name === "string" && source.name.trim().length > 0
        ? source.name
        : fallback.name,
    backgroundMode: source.backgroundMode === "solid" ? "solid" : "gradient",
    backgroundStart: normalizeHexColor(source.backgroundStart, fallback.backgroundStart),
    backgroundEnd: normalizeHexColor(source.backgroundEnd, fallback.backgroundEnd),
    sidebarSurface: normalizeHexColor(source.sidebarSurface, fallback.sidebarSurface),
    panelSurface: normalizeHexColor(source.panelSurface, fallback.panelSurface),
    cardSurface: normalizeHexColor(source.cardSurface, fallback.cardSurface),
  };
}

function readStoredSettings(): DashboardSettings {
  try {
    const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw) as Partial<DashboardSettings>;
    const templateId =
      typeof parsed.selectedTemplateId === "string" &&
      TEMPLATE_LIBRARY.some((template) => template.id === parsed.selectedTemplateId)
        ? parsed.selectedTemplateId
        : DEFAULT_SETTINGS.selectedTemplateId;

    const displayElements = Array.isArray(parsed.displayElements)
      ? parsed.displayElements.filter((id): id is DisplayElementId =>
          typeof id === "string" && DISPLAY_ELEMENT_IDS.has(id as DisplayElementId),
        )
      : DEFAULT_SETTINGS.displayElements;

    const parsedThemes = Array.isArray(parsed.themes)
      ? parsed.themes.map((theme, index) =>
          normalizeTheme(theme, DEFAULT_DASHBOARD_THEMES[index % DEFAULT_DASHBOARD_THEMES.length], index),
        )
      : DEFAULT_DASHBOARD_THEMES.map((theme) => ({ ...theme }));

    const uniqueThemes: TemplatesDashboardTheme[] = [];
    const idSet = new Set<string>();
    for (const theme of parsedThemes) {
      const id = idSet.has(theme.id) ? `${theme.id}_${uniqueThemes.length + 1}` : theme.id;
      idSet.add(id);
      uniqueThemes.push({ ...theme, id });
    }

    const themes = uniqueThemes.length > 0
      ? uniqueThemes
      : DEFAULT_DASHBOARD_THEMES.map((theme) => ({ ...theme }));

    const activeThemeId =
      typeof parsed.activeThemeId === "string" &&
      themes.some((theme) => theme.id === parsed.activeThemeId)
        ? parsed.activeThemeId
        : themes[0].id;

    return {
      selectedTemplateId: templateId,
      displayElements:
        displayElements.length > 0 ? displayElements : [...DEFAULT_SETTINGS.displayElements],
      durationSec: clampDuration(Number(parsed.durationSec ?? DEFAULT_SETTINGS.durationSec)),
      autoShowQr: Boolean(parsed.autoShowQr ?? DEFAULT_SETTINGS.autoShowQr),
      loopAnimation: Boolean(parsed.loopAnimation ?? DEFAULT_SETTINGS.loopAnimation),
      bankName:
        typeof parsed.bankName === "string" && parsed.bankName.trim().length > 0
          ? parsed.bankName
          : DEFAULT_SETTINGS.bankName,
      accountNumber:
        typeof parsed.accountNumber === "string" && parsed.accountNumber.trim().length > 0
          ? parsed.accountNumber
          : DEFAULT_SETTINGS.accountNumber,
      themes,
      activeThemeId,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStoredSettings(settings: DashboardSettings): void {
  try {
    localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function MVTemplatesDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const themeStudioRef = useRef<HTMLElement | null>(null);
  const bgUploadRef = useRef<HTMLInputElement | null>(null);

  const [settings, setSettings] = useState<DashboardSettings>(readStoredSettings);
  const [filter, setFilter] = useState<DashboardCategory>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const [creatingLayout, setCreatingLayout] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [obsThemes, setObsThemes] = useState<BibleTheme[]>(BUILTIN_FULLSCREEN_OBS_THEMES);
  const [selectedObsThemeId, setSelectedObsThemeId] = useState<string>(
    BUILTIN_FULLSCREEN_OBS_THEMES[0]?.id ?? "classic-dark",
  );
  const [obsThemeName, setObsThemeName] = useState<string>("");
  const [obsThemeDescription, setObsThemeDescription] = useState<string>("");
  const [obsThemeDraft, setObsThemeDraft] = useState<BibleThemeSettings | null>(null);
  const [obsThemeBusy, setObsThemeBusy] = useState(false);
  const showEmbeddedObsThemes = false;

  const filteredTemplates = useMemo(
    () =>
      filter === "all"
        ? TEMPLATE_LIBRARY
        : TEMPLATE_LIBRARY.filter((template) => template.category === filter),
    [filter],
  );

  const selectedTemplate = useMemo(() => {
    const selected = TEMPLATE_LIBRARY.find((template) => template.id === settings.selectedTemplateId);
    if (selected) return selected;
    return TEMPLATE_LIBRARY[0] ?? null;
  }, [settings.selectedTemplateId]);

  const activeTheme = useMemo(() => {
    const selected = settings.themes.find((theme) => theme.id === settings.activeThemeId);
    if (selected) return selected;
    return settings.themes[0] ?? DEFAULT_DASHBOARD_THEMES[0];
  }, [settings.activeThemeId, settings.themes]);

  const pageThemeStyle = useMemo(() => {
    const pageBackground =
      activeTheme.backgroundMode === "solid"
        ? activeTheme.backgroundStart
        : `radial-gradient(circle at top right, ${activeTheme.backgroundEnd} 0%, transparent 46%), linear-gradient(140deg, ${activeTheme.backgroundStart} 0%, ${activeTheme.backgroundEnd} 100%)`;

    return {
      "--tpldash-page-bg": pageBackground,
      "--tpldash-sidebar-bg": activeTheme.sidebarSurface,
      "--tpldash-panel-bg": activeTheme.panelSurface,
      "--tpldash-card-bg": activeTheme.cardSurface,
    } as CSSProperties;
  }, [activeTheme]);

  const sliderPercent = useMemo(
    () => ((settings.durationSec - 5) / (30 - 5)) * 100,
    [settings.durationSec],
  );

  const selectedObsTheme = useMemo(() => {
    return obsThemes.find((theme) => theme.id === selectedObsThemeId) ?? null;
  }, [obsThemes, selectedObsThemeId]);

  const obsThemePreviewStyle = useMemo(() => {
    if (!obsThemeDraft) return { background: "#111827" } as CSSProperties;
    if (obsThemeDraft.backgroundImage) {
      return {
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0.42)), url(${obsThemeDraft.backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } as CSSProperties;
    }
    return { background: obsThemeDraft.backgroundColor } as CSSProperties;
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
      console.warn("[MVTemplatesDashboard] Failed to load OBS themes:", error);
      setObsThemes(BUILTIN_FULLSCREEN_OBS_THEMES);
      setSelectedObsThemeId(BUILTIN_FULLSCREEN_OBS_THEMES[0]?.id ?? "classic-dark");
    }
  }, []);

  useEffect(() => {
    void loadObsThemes();
  }, [loadObsThemes]);

  useEffect(() => {
    const refresh = () => {
      void loadObsThemes();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
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
    const timer = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!selectedTemplate) return;
    if (selectedTemplate.id === settings.selectedTemplateId) return;
    setSettings((prev) => {
      const next = { ...prev, selectedTemplateId: selectedTemplate.id };
      writeStoredSettings(next);
      return next;
    });
  }, [selectedTemplate, settings.selectedTemplateId]);

  useEffect(() => {
    if (location.hash !== "#obs-themes") return;
    window.setTimeout(() => {
      themeStudioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [location.hash]);

  const updateSettings = (patch: Partial<DashboardSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeStoredSettings(next);
      return next;
    });
  };

  const updateActiveTheme = (patch: Partial<TemplatesDashboardTheme>) => {
    setSettings((prev) => {
      const nextThemes = prev.themes.map((theme) =>
        theme.id === prev.activeThemeId
          ? {
              ...theme,
              ...patch,
            }
          : theme,
      );

      const next = { ...prev, themes: nextThemes };
      writeStoredSettings(next);
      return next;
    });
  };

  const openStudio = () => {
    navigate("/templates/studio");
  };

  const openObsThemesSection = () => {
    navigate("/templates/themes");
  };

  const showToast = (message: string) => {
    setToastMessage(message);
  };

  const toggleDisplayElement = (id: DisplayElementId, enabled: boolean) => {
    const nextElements = enabled
      ? Array.from(new Set([...settings.displayElements, id]))
      : settings.displayElements.filter((item) => item !== id);
    updateSettings({ displayElements: nextElements });
  };

  const handleSaveChanges = () => {
    if (!selectedTemplate) return;

    const nextSettings: DashboardSettings = {
      ...settings,
      selectedTemplateId: selectedTemplate.id,
    };

    writeStoredSettings(nextSettings);
    setSettings(nextSettings);
    showToast("Default template updated.");
  };

  const handleCreateTheme = () => {
    setSettings((prev) => {
      const source = prev.themes.find((theme) => theme.id === prev.activeThemeId) ?? prev.themes[0] ?? DEFAULT_DASHBOARD_THEMES[0];
      const newTheme: TemplatesDashboardTheme = {
        ...source,
        id: `theme_custom_${Date.now()}`,
        name: `Custom Theme ${prev.themes.length + 1}`,
      };

      const next = {
        ...prev,
        themes: [...prev.themes, newTheme],
        activeThemeId: newTheme.id,
      };
      writeStoredSettings(next);
      return next;
    });

    showToast("New theme created.");
  };

  const handleDeleteTheme = () => {
    if (settings.themes.length <= 1) {
      showToast("At least one theme is required.");
      return;
    }

    setSettings((prev) => {
      const remaining = prev.themes.filter((theme) => theme.id !== prev.activeThemeId);
      const next = {
        ...prev,
        themes: remaining,
        activeThemeId: remaining[0].id,
      };
      writeStoredSettings(next);
      return next;
    });

    showToast("Theme deleted.");
  };

  const handleSaveTheme = () => {
    writeStoredSettings(settings);
    showToast(`Theme "${activeTheme.name}" saved.`);
  };

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
      }
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
      showToast("Created new OBS theme.");
    } catch (error) {
      console.error("[MVTemplatesDashboard] Failed to create OBS theme:", error);
      showToast("Could not create OBS theme.");
    } finally {
      setObsThemeBusy(false);
    }
  };

  const handleSaveObsTheme = async () => {
    if (!obsThemeDraft) {
      showToast("Select a theme to edit.");
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
      showToast(
        isBuiltin
          ? `Saved as custom theme "${themeToSave.name}".`
          : `Saved theme "${themeToSave.name}".`,
      );
    } catch (error) {
      console.error("[MVTemplatesDashboard] Failed to save OBS theme:", error);
      showToast("Could not save OBS theme.");
    } finally {
      setObsThemeBusy(false);
    }
  };

  const handleDeleteObsTheme = async () => {
    if (!selectedObsTheme) return;
    if (selectedObsTheme.source === "builtin") {
      showToast("Built-in themes cannot be deleted.");
      return;
    }

    setObsThemeBusy(true);
    try {
      await deleteCustomTheme(selectedObsTheme.id);
      await loadObsThemes();
      showToast(`Deleted theme "${selectedObsTheme.name}".`);
    } catch (error) {
      console.error("[MVTemplatesDashboard] Failed to delete OBS theme:", error);
      showToast("Could not delete OBS theme.");
    } finally {
      setObsThemeBusy(false);
    }
  };

  const handleCreateLayout = async () => {
    if (!selectedTemplate) return;

    setCreatingLayout(true);
    try {
      const layout = createLayoutFromTemplate(selectedTemplate);
      await db.saveLayout(layout);
      showToast(`Layout created from ${selectedTemplate.name}.`);
      navigate(`/edit/${layout.id}`);
    } catch (error) {
      console.error("[MVTemplatesDashboard] Failed to create layout:", error);
      showToast("Could not create layout from this template.");
    } finally {
      setCreatingLayout(false);
    }
  };

  return (
    <div className="tpldash-page" style={pageThemeStyle}>
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

            <button className="tpldash-module-link is-active" type="button" aria-current="page">
              <Icon name="volunteer_activism" size={20} />
              <span>Giving</span>
            </button>

            <button className="tpldash-module-link" type="button" onClick={() => navigate("/templates/themes")}>
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
              <h2 className="tpldash-title">Giving Templates</h2>
              <p className="tpldash-subtitle">Choose a visual style for your donation overlays.</p>
            </div>

            <div className="tpldash-header-actions">
              <button
                className="tpldash-action-btn"
                type="button"
                onClick={() => setShowFilters((value) => !value)}
              >
                <Icon name="filter_list" size={20} />
                <span>{showFilters ? "Hide Filter" : "Filter"}</span>
              </button>

              <button className="tpldash-action-btn" type="button" onClick={openStudio}>
                <Icon name="add" size={20} />
                <span>New</span>
              </button>

              <button className="tpldash-action-btn" type="button" onClick={openObsThemesSection}>
                <Icon name="palette" size={20} />
                <span>OBS Themes</span>
              </button>
            </div>
          </header>

          {showFilters && (
            <div className="tpldash-filters" role="tablist" aria-label="Template categories">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  className={`tpldash-filter-chip${filter === category ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setFilter(category)}
                  role="tab"
                  aria-selected={filter === category}
                >
                  <Icon name={CATEGORY_ICONS[category]} size={20} />
                  <span>{CATEGORY_LABELS[category]}</span>
                </button>
              ))}
            </div>
          )}

          {showEmbeddedObsThemes && (
          <section ref={themeStudioRef} id="obs-themes" className="tpldash-obs-theme-section">
            <div className="tpldash-obs-theme-head">
              <div>
                <h3>OBS Output Themes</h3>
                <p>Edit Bible and Worship fullscreen themes sent to OBS.</p>
              </div>

              <div className="tpldash-obs-theme-head-actions">
                <button
                  className="tpldash-action-btn"
                  type="button"
                  onClick={() => { void loadObsThemes(); }}
                  disabled={obsThemeBusy}
                >
                  <Icon name="refresh" size={20} />
                  <span>Reload</span>
                </button>
                <button
                  className="tpldash-action-btn"
                  type="button"
                  onClick={() => { void handleCreateObsTheme(); }}
                  disabled={obsThemeBusy}
                >
                  <Icon name="add" size={20} />
                  <span>New Theme</span>
                </button>
              </div>
            </div>

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
                    <div className="tpldash-obs-theme-preview" style={obsThemePreviewStyle}>
                      <span
                        style={{
                          fontFamily: obsThemeDraft.fontFamily,
                          fontSize: `${Math.min(38, Math.max(16, obsThemeDraft.fontSize * 0.5))}px`,
                          color: obsThemeDraft.fontColor,
                          textShadow: obsThemeDraft.textShadow,
                        }}
                      >
                        For God so loved the world...
                      </span>
                    </div>

                    <div className="tpldash-obs-theme-form">
                      <label className="tpldash-input-label">
                        Theme Name
                        <input
                          className="tpldash-input"
                          value={obsThemeName}
                          onChange={(event) => setObsThemeName(event.target.value)}
                        />
                      </label>

                      <label className="tpldash-input-label">
                        Description
                        <input
                          className="tpldash-input"
                          value={obsThemeDescription}
                          onChange={(event) => setObsThemeDescription(event.target.value)}
                        />
                      </label>

                      <div className="tpldash-obs-theme-grid">
                        <label className="tpldash-input-label">
                          Font Family
                          <select
                            className="tpldash-input"
                            value={obsThemeDraft.fontFamily}
                            onChange={(event) => updateObsThemeDraft({ fontFamily: event.target.value })}
                          >
                            {OBS_THEME_FONT_OPTIONS.map((font) => (
                              <option key={font} value={font}>{font}</option>
                            ))}
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
                            onChange={(event) => updateObsThemeDraft({ fontSize: Number(event.target.value) })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Font Color
                          <input
                            className="tpldash-theme-color-input"
                            type="color"
                            value={obsThemeDraft.fontColor}
                            onChange={(event) => updateObsThemeDraft({ fontColor: event.target.value })}
                          />
                        </label>

                        <label className="tpldash-input-label">
                          Background Color
                          <input
                            className="tpldash-theme-color-input"
                            type="color"
                            value={obsThemeDraft.backgroundColor}
                            onChange={(event) => updateObsThemeDraft({ backgroundColor: event.target.value })}
                          />
                        </label>
                      </div>

                      <label className="tpldash-input-label">
                        Background Image URL (optional)
                        <input
                          className="tpldash-input"
                          placeholder="https://... or data:image/..."
                          value={obsThemeDraft.backgroundImage}
                          onChange={(event) => updateObsThemeDraft({ backgroundImage: event.target.value })}
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
                          onClick={() => { void handleDeleteObsTheme(); }}
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
          )}

          <div className="tpldash-template-grid">
            {filteredTemplates.map((template) => {
              const isActive = selectedTemplate?.id === template.id;
              return (
                <button
                  key={template.id}
                  className={`tpldash-template-card${isActive ? " is-active" : ""}`}
                  type="button"
                  onClick={() => updateSettings({ selectedTemplateId: template.id })}
                  title={template.name}
                >
                  <div className="tpldash-template-visual" style={{ background: template.background.color }}>
                    <svg
                      viewBox={`0 0 ${template.canvas.width} ${template.canvas.height}`}
                      className="tpldash-template-svg"
                      aria-hidden="true"
                    >
                      <rect width={template.canvas.width} height={template.canvas.height} fill={template.background.color} />

                      {template.safeFrame.enabled && (
                        <rect
                          x={template.safeFrame.left}
                          y={template.safeFrame.top}
                          width={template.canvas.width - template.safeFrame.left - template.safeFrame.right}
                          height={template.canvas.height - template.safeFrame.top - template.safeFrame.bottom}
                          fill="none"
                          stroke="rgba(255,255,255,0.28)"
                          strokeWidth={3}
                          strokeDasharray="10 8"
                        />
                      )}

                      {template.regions.map((region) => (
                        <rect
                          key={region.id}
                          x={region.x}
                          y={region.y}
                          width={region.width}
                          height={region.height}
                          fill={regionColor(region.type)}
                          opacity={0.72}
                          rx={region.borderRadius || 4}
                        />
                      ))}
                    </svg>

                    <div className="tpldash-template-gradient" />

                    {isActive && <span className="tpldash-template-badge">ACTIVE</span>}
                  </div>

                  <div className="tpldash-template-meta">
                    <div className="tpldash-template-name-row">
                      <Icon name={template.icon} size={20} />
                      <span className="tpldash-template-name">{template.name}</span>
                    </div>
                    <p className="tpldash-template-description">{template.description}</p>
                  </div>
                </button>
              );
            })}

            <button className="tpldash-template-create" type="button" onClick={openStudio}>
              <Icon name="add_circle" size={20} />
              <span>Create Template</span>
            </button>
          </div>

          {filteredTemplates.length === 0 && (
            <div className="tpldash-empty">
              <Icon name="search_off" size={20} />
              <p>No templates in this category yet.</p>
            </div>
          )}

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
        </section>

        <aside className="tpldash-settings">
          <div className="tpldash-settings-head">
            <h3>Giving Defaults</h3>
            <p>Configure global behaviors for giving overlays.</p>
          </div>

          <div className="tpldash-settings-body">
            <section className="tpldash-settings-section">
              <label className="tpldash-label">Display Elements</label>
              <div className="tpldash-display-toggle-list">
                {DISPLAY_ELEMENTS.map((element) => {
                  const isEnabled = settings.displayElements.includes(element.id);
                  return (
                    <div key={element.id} className="tpldash-toggle-row tpldash-display-toggle-row">
                      <div className="tpldash-display-toggle-meta">
                        <Icon name={element.icon} size={20} />
                        <div>
                          <div className="tpldash-toggle-title">{element.label}</div>
                          <div className="tpldash-toggle-description">
                            {isEnabled ? "Enabled for giving overlays." : "Disabled for giving overlays."}
                          </div>
                        </div>
                      </div>
                      <button
                        className={`tpldash-switch${isEnabled ? " is-on" : ""}`}
                        type="button"
                        onClick={() => toggleDisplayElement(element.id, !isEnabled)}
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`Toggle ${element.label}`}
                      >
                        <span className="tpldash-switch-thumb" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="tpldash-settings-section">
              <div className="tpldash-setting-row">
                <label className="tpldash-label">Duration</label>
                <span className="tpldash-duration-pill">{settings.durationSec}s</span>
              </div>

              <input
                type="range"
                min={5}
                max={30}
                value={settings.durationSec}
                className="tpldash-duration-slider"
                style={{
                  background: `linear-gradient(90deg, var(--primary) ${sliderPercent}%, var(--surface-raised) ${sliderPercent}%)`,
                }}
                onChange={(event) => updateSettings({ durationSec: clampDuration(Number(event.target.value)) })}
              />

              <div className="tpldash-range-labels">
                <span>5s</span>
                <span>30s</span>
              </div>
            </section>

            <section className="tpldash-settings-section">
              <label className="tpldash-label">Automation</label>

              <div className="tpldash-toggle-row">
                <div>
                  <div className="tpldash-toggle-title">Auto-show QR</div>
                  <div className="tpldash-toggle-description">Show when "Giving" scene is active</div>
                </div>
                <button
                  className={`tpldash-switch${settings.autoShowQr ? " is-on" : ""}`}
                  type="button"
                  onClick={() => updateSettings({ autoShowQr: !settings.autoShowQr })}
                  role="switch"
                  aria-checked={settings.autoShowQr}
                  aria-label="Toggle Auto-show QR"
                >
                  <span className="tpldash-switch-thumb" />
                </button>
              </div>

              <div className="tpldash-toggle-row">
                <div>
                  <div className="tpldash-toggle-title">Loop Animation</div>
                  <div className="tpldash-toggle-description">Restart motion every 15s</div>
                </div>
                <button
                  className={`tpldash-switch${settings.loopAnimation ? " is-on" : ""}`}
                  type="button"
                  onClick={() => updateSettings({ loopAnimation: !settings.loopAnimation })}
                  role="switch"
                  aria-checked={settings.loopAnimation}
                  aria-label="Toggle Loop Animation"
                >
                  <span className="tpldash-switch-thumb" />
                </button>
              </div>
            </section>

            <section className="tpldash-settings-section tpldash-content-section">
              <label className="tpldash-label">Content Data</label>

              {editingBank ? (
                <div className="tpldash-input-grid">
                  <label className="tpldash-input-label">
                    Bank Name
                    <input
                      className="tpldash-input"
                      value={settings.bankName}
                      onChange={(event) => updateSettings({ bankName: event.target.value })}
                    />
                  </label>

                  <label className="tpldash-input-label">
                    Account Number
                    <input
                      className="tpldash-input"
                      value={settings.accountNumber}
                      onChange={(event) => updateSettings({ accountNumber: event.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <div className="tpldash-data-grid">
                  <div className="tpldash-data-card">
                    <div className="tpldash-data-label">Bank Name</div>
                    <div className="tpldash-data-value">{settings.bankName}</div>
                  </div>
                  <div className="tpldash-data-card">
                    <div className="tpldash-data-label">Account Number</div>
                    <div className="tpldash-data-value">{settings.accountNumber}</div>
                  </div>
                </div>
              )}

              <button className="tpldash-edit-btn" type="button" onClick={() => setEditingBank((value) => !value)}>
                <Icon name={editingBank ? "check" : "edit"} size={20} />
                <span>{editingBank ? "Done Editing" : "Edit Bank Details"}</span>
              </button>
            </section>

            <section className="tpldash-settings-section tpldash-theme-section">
              <div className="tpldash-setting-row">
                <label className="tpldash-label">Dashboard Look</label>
                <button className="tpldash-theme-add-btn" type="button" onClick={handleCreateTheme}>
                  <Icon name="add" size={20} />
                  <span>New Theme</span>
                </button>
              </div>

              <div className="tpldash-theme-list">
                {settings.themes.map((theme) => (
                  <button
                    key={theme.id}
                    className={`tpldash-theme-chip${theme.id === activeTheme.id ? " is-active" : ""}`}
                    type="button"
                    onClick={() => updateSettings({ activeThemeId: theme.id })}
                    title={`Use ${theme.name}`}
                  >
                    <span
                      className="tpldash-theme-swatch"
                      style={{
                        background:
                          theme.backgroundMode === "solid"
                            ? theme.backgroundStart
                            : `linear-gradient(135deg, ${theme.backgroundStart}, ${theme.backgroundEnd})`,
                      }}
                    />
                    <span>{theme.name}</span>
                  </button>
                ))}
              </div>

              <div className="tpldash-theme-editor">
                <label className="tpldash-input-label">
                  Theme Name
                  <input
                    className="tpldash-input"
                    value={activeTheme.name}
                    onChange={(event) => updateActiveTheme({ name: event.target.value })}
                    placeholder="Theme Name"
                  />
                </label>

                <div className="tpldash-theme-mode">
                  <button
                    className={`tpldash-theme-mode-btn${activeTheme.backgroundMode === "solid" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => updateActiveTheme({ backgroundMode: "solid" })}
                  >
                    Solid
                  </button>
                  <button
                    className={`tpldash-theme-mode-btn${activeTheme.backgroundMode === "gradient" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => updateActiveTheme({ backgroundMode: "gradient" })}
                  >
                    Gradient
                  </button>
                </div>

                <div className="tpldash-theme-color-grid">
                  <label className="tpldash-theme-color-field">
                    <span>Background Start</span>
                    <input
                      className="tpldash-theme-color-input"
                      type="color"
                      value={activeTheme.backgroundStart}
                      onChange={(event) => updateActiveTheme({ backgroundStart: event.target.value })}
                    />
                  </label>

                  <label className="tpldash-theme-color-field">
                    <span>Background End</span>
                    <input
                      className="tpldash-theme-color-input"
                      type="color"
                      value={activeTheme.backgroundEnd}
                      onChange={(event) => updateActiveTheme({ backgroundEnd: event.target.value })}
                      disabled={activeTheme.backgroundMode === "solid"}
                    />
                  </label>

                  <label className="tpldash-theme-color-field">
                    <span>Sidebar</span>
                    <input
                      className="tpldash-theme-color-input"
                      type="color"
                      value={activeTheme.sidebarSurface}
                      onChange={(event) => updateActiveTheme({ sidebarSurface: event.target.value })}
                    />
                  </label>

                  <label className="tpldash-theme-color-field">
                    <span>Panel</span>
                    <input
                      className="tpldash-theme-color-input"
                      type="color"
                      value={activeTheme.panelSurface}
                      onChange={(event) => updateActiveTheme({ panelSurface: event.target.value })}
                    />
                  </label>

                  <label className="tpldash-theme-color-field">
                    <span>Card Surface</span>
                    <input
                      className="tpldash-theme-color-input"
                      type="color"
                      value={activeTheme.cardSurface}
                      onChange={(event) => updateActiveTheme({ cardSurface: event.target.value })}
                    />
                  </label>
                </div>

                <div className="tpldash-theme-editor-actions">
                  <button className="tpldash-theme-delete-btn" type="button" onClick={handleDeleteTheme}>
                    <Icon name="delete" size={20} />
                    <span>Delete Theme</span>
                  </button>
                  <button className="tpldash-theme-save-btn" type="button" onClick={handleSaveTheme}>
                    <Icon name="save" size={20} />
                    <span>Save Theme</span>
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="tpldash-settings-footer">
            <button className="tpldash-footer-btn tpldash-footer-btn--secondary" type="button" onClick={openStudio}>
              Open Studio
            </button>

            <button
              className="tpldash-footer-btn tpldash-footer-btn--primary"
              type="button"
              onClick={handleSaveChanges}
              disabled={!selectedTemplate}
            >
              Save Changes
            </button>

            <button
              className="tpldash-footer-btn tpldash-footer-btn--outline"
              type="button"
              onClick={handleCreateLayout}
              disabled={!selectedTemplate || creatingLayout}
            >
              {creatingLayout ? "Creating..." : "Create Layout"}
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}
