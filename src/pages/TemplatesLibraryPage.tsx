/**
 * TemplatesLibraryPage.tsx — Theme & Template Library
 *
 * Browseable library of ALL lower-third and fullscreen themes.
 * Users can:
 *   - Filter by type: "lower-third" or "fullscreen"
 *   - Filter by category: bible, worship, general (giving/events/speakers)
 *   - Mark themes as favorites (★)
 *   - Favorites appear first in the OBS dock theme pickers
 *   - If no favorites are set, the dock shows the first 2 themes
 *
 * Data sources:
 *   - Lower-third themes: ALL_THEMES from lowerthirds/themes.ts (deduped canonical set)
 *   - Fullscreen themes: BUILTIN_THEMES from bible/themes/builtinThemes.ts (4 themes)
 *   - Custom themes: loaded from IndexedDB (bibleDb.getCustomThemes)
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { ALL_THEMES } from "../lowerthirds/themes";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import type { BibleTheme, BibleThemeCategory, BibleThemeSettings } from "../bible/types";
import {
  FAVORITE_THEMES_UPDATED_EVENT,
  getBibleFavorites,
  hydrateFavoriteThemes,
  toggleBibleFavorite,
  getWorshipLTFavorites,
  toggleWorshipLTFavorite,
} from "../services/favoriteThemes";
import { deleteCustomTheme } from "../bible/bibleDb";
import Icon from "../components/Icon";
import ThemeCreatorModal from "./ThemeCreatorModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThemeType = "all" | "lower-third" | "fullscreen";
type CategoryFilter = "all" | "bible" | "worship" | "general";
const SHARED_WORSHIP_BIBLE_THEME_TAG = "shared-worship-bible";

/** Unified shape so we can render both LT and fullscreen themes in one grid */
interface UnifiedTheme {
  id: string;
  name: string;
  description: string;
  type: "lower-third" | "fullscreen";
  category: string;
  categories: BibleThemeCategory[];
  accentColor: string;
  tags: string[];
  /** For LT themes — raw HTML preview */
  html?: string;
  css?: string;
  fontImports?: string[];
  sampleValues?: Record<string, string>;
  /** For fullscreen themes — settings preview */
  bgColor?: string;
  fontColor?: string;
  settings?: BibleThemeSettings;
  isFavorite: boolean;
  source: "builtin" | "custom";
}

function normalizeThemeCategories(values: Array<string | null | undefined>, fallback: BibleThemeCategory): BibleThemeCategory[] {
  const ordered: BibleThemeCategory[] = ["bible", "worship", "general"];
  const set = new Set<BibleThemeCategory>();
  for (const value of values) {
    if (value === "bible" || value === "worship" || value === "general") {
      set.add(value);
    }
  }
  if (set.size === 0) set.add(fallback);
  return ordered.filter((value) => set.has(value));
}

const FALLBACK_LOGO_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
      <rect width="220" height="220" rx="36" fill="#2563eb"/>
      <path d="M110 42l46 26v52c0 33-20 56-46 64-26-8-46-31-46-64V68l46-26z" fill="#fff"/>
      <path d="M110 70c17 0 30 13 30 30s-13 30-30 30-30-13-30-30 13-30 30-30z" fill="#2563eb"/>
    </svg>`
  );

const DEFAULT_LT_PREVIEW_VALUES: Record<string, string> = {
  state: "in",
  animMode: "stagger",
  logoUrl: FALLBACK_LOGO_DATA_URI,
  qrCodeUrl: FALLBACK_LOGO_DATA_URI,
  name: "Pastor Daniel Carter",
  title: "Senior Pastor · Grace Church",
  label: "Sermon Point",
  heading: "This Week",
  headline: "Faithful in Every Season",
  details: "Join us this Wednesday 6:30 PM",
  line1: "Prayer Night",
  line2: "Main Auditorium · 6:30 PM",
  titleText: "Faithful in Every Season",
  subtitle: "Stand firm in hope and grace.",
  meta: "Romans 8:28",
  verseText: "For God so loved the world...",
  reference: "John 3:16",
  quote: "Grace grows where truth is planted.",
  keyword: "FAITH",
  supportingText: "Walking in obedience daily",
  month: "NOV",
  day: "24",
  badge: "Announcement",
  tickerText: "Welcome to service • Prayer meeting tonight • Youth conference this Friday",
  platform: "Instagram",
  handle: "@gracechurch",
  facebook: "/GraceChurch",
  twitter: "@GraceChurch",
  instagram: "@GraceChurch",
  time: "00:15",
  eventName: "Service Begins",
  cycleSeconds: "8",
};

const LT_WIDTH_REDUCTION: Record<string, number> = {
  full: 0,
  sm: 120,
  md: 240,
  lg: 360,
  xl: 520,
  xxl: 680,
};

function safeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function extractSampleValues(theme: unknown): Record<string, string> {
  const values: Record<string, string> = { ...DEFAULT_LT_PREVIEW_VALUES };
  const maybeTheme = theme as { variables?: Array<Record<string, unknown>> };
  if (!Array.isArray(maybeTheme.variables)) return values;

  for (const variable of maybeTheme.variables) {
    const key = typeof variable?.key === "string" ? variable.key : "";
    if (!key) continue;
    const candidate = variable.defaultValue ?? variable.placeholder ?? values[key] ?? "";
    values[key] = safeValue(candidate);
  }

  return values;
}

function substituteTemplateVariables(template: string, values: Record<string, string>): string {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    return key in DEFAULT_LT_PREVIEW_VALUES ? DEFAULT_LT_PREVIEW_VALUES[key] : "";
  });
}

function buildLowerThirdPreviewDoc(theme: UnifiedTheme, options: { includeFonts: boolean }): string {
  const values = { ...DEFAULT_LT_PREVIEW_VALUES, ...(theme.sampleValues || {}) };
  const css = theme.css || "";
  const html = substituteTemplateVariables(theme.html || "", values);
  const imports = options.includeFonts
    ? (theme.fontImports || [])
        .filter((href) => typeof href === "string" && href.trim())
        .map((href) => `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}">`)
        .join("\n")
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${imports}
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      body {
        position: relative;
        font-family: "CMG Sans", "Montserrat", sans-serif;
      }
      ${css}
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`;
}

function getThemePreviewSample(category: string): { verse: string; reference: string } {
  switch (category) {
    case "worship":
      return {
        verse: "Amazing grace, how sweet the sound\nThat saved a wretch like me…",
        reference: "Worship Lyrics",
      };
    case "general":
      return {
        verse: "Sunday service starts 10:30 AM\nJoin us for worship and fellowship.",
        reference: "Church Announcement",
      };
    default:
      return {
        verse: "For God so loved the world, that he gave his only begotten Son…",
        reference: "John 3:16",
      };
  }
}

function isTransparentThemeBox(settings: BibleThemeSettings): boolean {
  return !settings.boxBackgroundImage &&
    settings.boxOpacity <= 0 &&
    settings.boxBackground.trim().toLowerCase() === "transparent";
}

function buildCustomLowerThirdPreviewDoc(theme: UnifiedTheme): string {
  const settings = theme.settings;
  if (!settings) return buildLowerThirdPreviewDoc(theme, { includeFonts: false });

  const sample = getThemePreviewSample(theme.category);
  const boxBgImg = settings.boxBackgroundImage
    ? `background-image:url("${settings.boxBackgroundImage.replace(/"/g, "&quot;")}");background-size:cover;background-position:center;`
    : "";
  const transparentBox = isTransparentThemeBox(settings);
  const panelBackground = transparentBox ? "transparent" : settings.boxBackground;
  const panelOpacity = transparentBox ? 1 : settings.boxOpacity;
  const panelBorder = transparentBox ? "none" : "1px solid rgba(255,255,255,.08)";
  const panelShadow = transparentBox ? "none" : "0 16px 40px rgba(0,0,0,.28)";
  const justify = settings.lowerThirdPosition === "center"
    ? "center"
    : settings.lowerThirdPosition === "right"
      ? "flex-end"
      : "flex-start";
  const baseWidth = Math.max(480, 1920 - (settings.safeArea || 40) * 2);
  const scaledWidth = Math.round((baseWidth - (LT_WIDTH_REDUCTION[settings.lowerThirdWidthPreset || "full"] || 0)) * 0.35);
  const scaledOffset = (settings.lowerThirdOffsetX || 0) * 0.35;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      body {
        display: flex;
        align-items: flex-end;
        justify-content: ${justify};
        padding: ${Math.max(12, settings.safeArea * 0.35)}px;
        font-family: ${settings.fontFamily};
      }
      .bar {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        position: relative;
        isolation: isolate;
        overflow: hidden;
        text-align: ${settings.textAlign};
        width: min(100%, ${scaledWidth}px);
        max-width: 100%;
        left: ${scaledOffset}px;
        border-radius: ${settings.borderRadius}px;
        padding: ${Math.max(16, settings.padding * 0.35)}px ${Math.max(22, settings.padding * 0.5)}px;
        min-height: ${Math.max(0, settings.lowerThirdHeight || 0) * 0.35}px;
        border: ${panelBorder};
        box-shadow: ${panelShadow};
      }
      .bar::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: ${panelBackground};
        ${boxBgImg}
        opacity: ${panelOpacity};
        backdrop-filter: ${transparentBox ? "none" : "blur(12px)"};
        -webkit-backdrop-filter: ${transparentBox ? "none" : "blur(12px)"};
        z-index: 0;
      }
      .verse {
        margin: 0 0 6px;
        color: ${settings.fontColor};
        font-size: ${Math.max(20, settings.fontSize * 0.28)}px;
        font-weight: ${settings.fontWeight};
        line-height: ${settings.lineHeight};
        text-shadow: ${settings.textShadow};
        text-transform: ${settings.textTransform};
        white-space: pre-line;
        width: 100%;
        position: relative;
        z-index: 1;
      }
      .ref {
        margin: 0;
        color: ${settings.refFontColor};
        font-size: ${Math.max(13, settings.refFontSize * 0.28)}px;
        font-weight: ${settings.refFontWeight};
        letter-spacing: 0.03em;
        width: 100%;
        position: relative;
        z-index: 1;
      }
    </style>
  </head>
  <body>
    <div class="bar">
      <p class="verse">${sample.verse}</p>
      <p class="ref">${sample.reference}</p>
    </div>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplatesLibraryPage() {
  // ── State ──
  const [typeFilter, setTypeFilter] = useState<ThemeType>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [ltFavs, setLtFavs] = useState<Set<string>>(() => getWorshipLTFavorites());
  const [bibleFavs, setBibleFavs] = useState<Set<string>>(() => getBibleFavorites());
  const [customThemes, setCustomThemes] = useState<BibleTheme[]>([]);
  const [previewTheme, setPreviewTheme] = useState<UnifiedTheme | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [editThemeData, setEditThemeData] = useState<BibleTheme | null>(null);
  const [showMyThemesOnly, setShowMyThemesOnly] = useState(false);

  // ── Auto-dismiss toast ──
  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 2800);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // ── Load custom themes ──
  useEffect(() => {
    (async () => {
      try {
        const { getCustomThemes } = await import("../bible/bibleDb");
        const custom = await getCustomThemes();
        const builtinIds = new Set(BUILTIN_THEMES.map((t) => t.id));
        setCustomThemes(custom.filter((t) => !builtinIds.has(t.id)));
      } catch { /* IndexedDB not available */ }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncFavorites = () => {
      if (cancelled) return;
      setBibleFavs(new Set(getBibleFavorites()));
      setLtFavs(new Set(getWorshipLTFavorites()));
    };

    const handleFavoritesUpdated = () => {
      syncFavorites();
    };

    window.addEventListener(FAVORITE_THEMES_UPDATED_EVENT, handleFavoritesUpdated);
    hydrateFavoriteThemes().then(syncFavorites).catch(() => {});

    return () => {
      cancelled = true;
      window.removeEventListener(FAVORITE_THEMES_UPDATED_EVENT, handleFavoritesUpdated);
    };
  }, []);

  // ── Build unified theme list ──
  const allThemes = useMemo<UnifiedTheme[]>(() => {
    const themes: UnifiedTheme[] = [];

    // Lower-third themes (from merged registry)
    for (const t of ALL_THEMES) {
      if (!t.html || !t.css) continue;
      themes.push({
        id: t.id,
        name: t.name || t.id,
        description: t.description || "",
        type: "lower-third",
        category: t.category || "general",
        categories: normalizeThemeCategories([t.category], "general"),
        accentColor: t.accentColor || "#6c63ff",
        tags: t.tags || [],
        html: t.html,
        css: t.css,
        fontImports: Array.isArray(t.fontImports) ? t.fontImports.filter((href): href is string => typeof href === "string") : [],
        sampleValues: extractSampleValues(t),
        isFavorite: ltFavs.has(t.id),
        source: "builtin",
      });
    }

    // Fullscreen themes (builtin)
    for (const t of BUILTIN_THEMES) {
      themes.push({
        id: t.id,
        name: t.name,
        description: t.description || "",
        type: "fullscreen",
        category: "bible",
        categories: ["bible"],
        accentColor: t.settings.fontColor || "#fff",
        tags: [],
        bgColor: t.settings.backgroundColor,
        fontColor: t.settings.fontColor,
        isFavorite: bibleFavs.has(t.id),
        source: "builtin",
      });
    }

    // Custom themes
    for (const t of customThemes) {
      const type = t.templateType === "lower-third" ? "lower-third" : "fullscreen";
      themes.push({
        id: t.id,
        name: t.name,
        description: t.description || "",
        type,
        category: (t.categories?.[0] || t.category || "bible"),
        categories: normalizeThemeCategories(t.categories?.length ? t.categories : [t.category], "bible"),
        accentColor: t.settings.fontColor || "#fff",
        tags: [],
        bgColor: type === "fullscreen" ? t.settings.backgroundColor : t.settings.boxBackground,
        fontColor: t.settings.fontColor,
        settings: t.settings,
        isFavorite: bibleFavs.has(t.id),
        source: "custom",
      });
    }

    return themes;
  }, [ltFavs, bibleFavs, customThemes]);

  // ── Filtered & sorted list ──
  const filteredThemes = useMemo(() => {
    let list = allThemes;

    // My themes only
    if (showMyThemesOnly) {
      list = list.filter((t) => t.source === "custom");
    }

    // Favorites only
    if (showFavoritesOnly) {
      list = list.filter((t) => t.isFavorite);
    }

    // Type filter
    if (typeFilter !== "all") {
      list = list.filter((t) => t.type === typeFilter);
    }

    // Category filter
    if (categoryFilter !== "all") {
      list = list.filter((t) => {
        if (t.categories.includes(categoryFilter)) return true;
        if (t.type !== "lower-third") return false;
        const hasSharedTag = t.tags.some(
          (tag) => String(tag).trim().toLowerCase() === SHARED_WORSHIP_BIBLE_THEME_TAG
        );
        if (!hasSharedTag) return false;
        return categoryFilter === "bible" || categoryFilter === "worship";
      });
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.categories.some((category) => category.toLowerCase().includes(q)) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    // Sort: favorites first, then alphabetical
    return list.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allThemes, typeFilter, categoryFilter, searchQuery, showFavoritesOnly, showMyThemesOnly]);

  // ── Toggle favorite ──
  const handleToggleFavorite = useCallback((theme: UnifiedTheme) => {
    const wasFav = theme.isFavorite;
    if (theme.type === "fullscreen" || theme.source === "custom") {
      const updated = toggleBibleFavorite(theme.id);
      setBibleFavs(new Set(updated));
    } else {
      const updated = toggleWorshipLTFavorite(theme.id);
      setLtFavs(new Set(updated));
    }
    setToastMessage(
      wasFav
        ? `"${theme.name}" removed from favorites`
        : `"${theme.name}" added to favorites ★`
    );
  }, []);

  // ── Delete custom theme ──
  const handleDeleteTheme = useCallback(async (theme: UnifiedTheme) => {
    if (theme.source !== "custom") return;
    if (!window.confirm(`Delete "${theme.name}"? This cannot be undone.`)) return;
    try {
      await deleteCustomTheme(theme.id);
      setCustomThemes((prev) => prev.filter((t) => t.id !== theme.id));
      setToastMessage(`"${theme.name}" deleted`);
      if (previewTheme?.id === theme.id) setPreviewTheme(null);
    } catch {
      setToastMessage("Failed to delete theme");
    }
  }, [previewTheme]);

  // ── Edit custom theme ──
  const handleEditTheme = useCallback((theme: UnifiedTheme) => {
    if (theme.source !== "custom") return;
    const original = customThemes.find((t) => t.id === theme.id);
    if (!original) return;
    setEditThemeData(original);
    setShowCreator(true);
  }, [customThemes]);

  // ── Clone any fullscreen theme ──
  const handleCloneTheme = useCallback((theme: UnifiedTheme) => {
    // Find in builtins or custom
    const original =
      BUILTIN_THEMES.find((t) => t.id === theme.id) ||
      customThemes.find((t) => t.id === theme.id);
    if (!original) return;
    // Create a clone with a new id and "(Copy)" in the name
    const clone: BibleTheme = {
      ...original,
      id: "", // Will be assigned by the creator on save
      name: `${original.name} (Copy)`,
      source: "custom",
    };
    setEditThemeData(clone);
    setShowCreator(true);
  }, [customThemes]);

  // ── Counts ──
  const totalCount = allThemes.length;
  const favCount = allThemes.filter((t) => t.isFavorite).length;
  const ltCount = allThemes.filter((t) => t.type === "lower-third").length;
  const fsCount = allThemes.filter((t) => t.type === "fullscreen").length;
  const myCount = allThemes.filter((t) => t.source === "custom").length;

  return (
    <div className="tlib-page">
      {/* ── Header ── */}
      <div className="tlib-header">
        <div className="tlib-header-left">
          <h1 className="tlib-title">
            <Icon name="palette" size={20} />
            Templates Library
          </h1>
          <p className="tlib-subtitle">
            {totalCount} themes available · {favCount} favorited
          </p>
        </div>
        <div className="tlib-header-right">
          <button
            className="tlib-create-btn"
            onClick={() => {
              setEditThemeData(null);
              setShowCreator(true);
            }}
          >
            <Icon name="add" size={18} />
            Create Theme
          </button>
          <div className="tlib-search">
            <Icon name="search" size={20} />
            <input
              type="text"
              placeholder="Search themes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search themes"
            />
            {searchQuery && (
              <button
                type="button"
                className="tlib-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear theme search"
                title="Clear theme search"
              >
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Body: sidebar + grid ── */}
      <div className="tlib-body">
        {/* ── Left Sidebar Filters ── */}
        <aside className="tlib-sidebar">
          <div className="tlib-sidebar-group">
            <h4 className="tlib-sidebar-heading">Type</h4>
            <button
              className={`tlib-sidebar-item${typeFilter === "all" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setTypeFilter("all")}
            >
              <Icon name="apps" size={20} />
              <span>All Types</span>
              <span className="tlib-sidebar-count">{totalCount}</span>
            </button>
            <button
              className={`tlib-sidebar-item${typeFilter === "lower-third" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setTypeFilter("lower-third")}
            >
              <Icon name="call_to_action" size={20} />
              <span>Lower Thirds</span>
              <span className="tlib-sidebar-count">{ltCount}</span>
            </button>
            <button
              className={`tlib-sidebar-item${typeFilter === "fullscreen" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setTypeFilter("fullscreen")}
            >
              <Icon name="fullscreen" size={20} />
              <span>Fullscreen</span>
              <span className="tlib-sidebar-count">{fsCount}</span>
            </button>
          </div>

          <div className="tlib-sidebar-divider" />

          <div className="tlib-sidebar-group">
            <h4 className="tlib-sidebar-heading">Category</h4>
            <button
              className={`tlib-sidebar-item${categoryFilter === "all" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setCategoryFilter("all")}
            >
              <Icon name="grid_view" size={20} />
              <span>All Categories</span>
            </button>
            <button
              className={`tlib-sidebar-item${categoryFilter === "bible" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setCategoryFilter("bible")}
            >
              <Icon name="auto_stories" size={20} />
              <span>Bible</span>
            </button>
            <button
              className={`tlib-sidebar-item${categoryFilter === "worship" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setCategoryFilter("worship")}
            >
              <Icon name="music_note" size={20} />
              <span>Worship</span>
            </button>
            <button
              className={`tlib-sidebar-item${categoryFilter === "general" ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setCategoryFilter("general")}
            >
              <Icon name="dashboard" size={20} />
              <span>General</span>
            </button>
          </div>

          <div className="tlib-sidebar-divider" />

          <div className="tlib-sidebar-group">
            <h4 className="tlib-sidebar-heading">My Themes</h4>
            <button
              className={`tlib-sidebar-item${showMyThemesOnly ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setShowMyThemesOnly(!showMyThemesOnly)}
            >
              <Icon name="person" size={20} />
              <span>Created by Me</span>
              <span className="tlib-sidebar-count">{myCount}</span>
            </button>
            {myCount === 0 && (
              <p className="tlib-sidebar-hint">
                No custom themes yet. Click <strong>Create Theme</strong> to get started!
              </p>
            )}
          </div>

          <div className="tlib-sidebar-divider" />

          <div className="tlib-sidebar-group">
            <h4 className="tlib-sidebar-heading">Quick Filters</h4>
            <button
              className={`tlib-sidebar-item${showFavoritesOnly ? " tlib-sidebar-item--active" : ""}`}
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            >
              <Icon name="star" size={20} />
              <span>Favorites Only</span>
              <span className="tlib-sidebar-count">{favCount}</span>
            </button>
            <button
              className="tlib-sidebar-item"
              onClick={() => { setTypeFilter("all"); setCategoryFilter("all"); setSearchQuery(""); setShowFavoritesOnly(false); setShowMyThemesOnly(false); }}
            >
              <Icon name="restart_alt" size={20} />
              <span>Reset All Filters</span>
            </button>
          </div>
        </aside>

        {/* ── Main content area ── */}
        <div className="tlib-main">
          {/* Result count bar */}
          <div className="tlib-result-bar">
            <span className="tlib-result-count">
              Showing {filteredThemes.length} of {totalCount} themes
            </span>
            {/* Active filter pills */}
            {(typeFilter !== "all" || categoryFilter !== "all" || searchQuery || showFavoritesOnly || showMyThemesOnly) && (
              <div className="tlib-active-filters">
                {showMyThemesOnly && (
                  <span className="tlib-active-pill tlib-active-pill--my">
                    <Icon name="person" size={12} />
                    My Themes
                    <button onClick={() => setShowMyThemesOnly(false)}>
                      <Icon name="close" size={20} />
                    </button>
                  </span>
                )}
                {showFavoritesOnly && (
                  <span className="tlib-active-pill tlib-active-pill--fav">
                    <Icon name="star" size={12} />
                    Favorites
                    <button onClick={() => setShowFavoritesOnly(false)}>
                      <Icon name="close" size={20} />
                    </button>
                  </span>
                )}
                {typeFilter !== "all" && (
                  <span className="tlib-active-pill">
                    {typeFilter === "lower-third" ? "Lower Thirds" : "Fullscreen"}
                    <button onClick={() => setTypeFilter("all")}>
                      <Icon name="close" size={20} />
                    </button>
                  </span>
                )}
                {categoryFilter !== "all" && (
                  <span className="tlib-active-pill">
                    {categoryFilter}
                    <button onClick={() => setCategoryFilter("all")}>
                      <Icon name="close" size={20} />
                    </button>
                  </span>
                )}
                {searchQuery && (
                  <span className="tlib-active-pill">
                    "{searchQuery}"
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear theme search filter"
                      title="Clear theme search filter"
                    >
                      <Icon name="close" size={20} />
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Theme Grid ── */}
          <div className="tlib-grid">
            {filteredThemes.map((theme) => (
              <div
                key={theme.id}
                className={`tlib-card${theme.isFavorite ? " tlib-card--fav" : ""}${previewTheme?.id === theme.id ? " tlib-card--preview" : ""}`}
                onClick={() => setPreviewTheme(previewTheme?.id === theme.id ? null : theme)}
              >
                {/* Preview area */}
                <div className="tlib-card-preview">
                  {theme.type === "fullscreen" ? (
                    <div
                      className="tlib-card-fs-preview"
                      style={{
                        background: theme.bgColor || "#0a0a14",
                        color: theme.fontColor || "#fff",
                      }}
                    >
                      <span className="tlib-card-fs-verse">"For God so loved..."</span>
                      <span className="tlib-card-fs-ref">John 3:16</span>
                    </div>
                  ) : (
                    <div className="tlib-card-lt-preview tlib-card-lt-preview--iframe">
                      <iframe
                        className="tlib-card-lt-iframe"
                        title={`${theme.name} preview`}
                        loading="lazy"
                        srcDoc={
                          theme.source === "custom" && theme.settings
                            ? buildCustomLowerThirdPreviewDoc(theme)
                            : buildLowerThirdPreviewDoc(theme, { includeFonts: false })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Card info */}
                <div className="tlib-card-body">
                  <div className="tlib-card-head">
                    <div className="tlib-card-title-wrap">
                      <h4 className="tlib-card-name">{theme.name}</h4>
                      <div className="tlib-card-badges">
                        <span className={`tlib-badge tlib-badge--${theme.type}`}>
                          {theme.type === "fullscreen" ? "Fullscreen" : "Lower Third"}
                        </span>
                        {theme.categories.map((category) => (
                          <span key={`${theme.id}-${category}`} className="tlib-badge tlib-badge--cat">
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className={`tlib-fav-btn${theme.isFavorite ? " tlib-fav-btn--active" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(theme);
                      }}
                      title={theme.isFavorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Icon name={theme.isFavorite ? "star" : "star_border"} size={20} />
                    </button>
                  </div>
                  {theme.description && (
                    <p className="tlib-card-desc">{theme.description}</p>
                  )}
                  {theme.tags.length > 0 && (
                    <div className="tlib-card-tags">
                      {theme.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="tlib-tag">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Action buttons for custom themes + clonable fullscreen builtins */}
                  {(theme.source === "custom" || theme.type === "fullscreen") && (
                    <div className="tlib-card-actions">
                      {theme.source === "custom" && (
                        <button
                          className="tlib-action-btn"
                          onClick={(e) => { e.stopPropagation(); handleEditTheme(theme); }}
                          title="Edit theme"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      )}
                      <button
                        className="tlib-action-btn"
                        onClick={(e) => { e.stopPropagation(); handleCloneTheme(theme); }}
                        title="Duplicate theme"
                      >
                        <Icon name="content_copy" size={14} />
                      </button>
                      {theme.source === "custom" && (
                        <button
                          className="tlib-action-btn tlib-action-btn--danger"
                          onClick={(e) => { e.stopPropagation(); handleDeleteTheme(theme); }}
                          title="Delete theme"
                        >
                          <Icon name="delete" size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Empty state ── */}
          {filteredThemes.length === 0 && (
            <div className="tlib-empty">
              <Icon name="search_off" size={20} />
              <h3>No themes found</h3>
              <p>Try adjusting your filters or search query.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Preview modal ── */}
      {previewTheme && (
        <div className="tlib-preview-backdrop" onClick={() => setPreviewTheme(null)}>
          <div className="tlib-preview-modal" onClick={(e) => e.stopPropagation()}>
            {/* Close button */}
            <button className="tlib-preview-close" onClick={() => setPreviewTheme(null)}>
              <Icon name="close" size={20} />
            </button>

            {/* Large preview area */}
            <div className="tlib-preview-stage">
              {previewTheme.type === "fullscreen" ? (
                <div
                  className="tlib-preview-fs"
                  style={{
                    background: previewTheme.bgColor || "#0a0a14",
                    color: previewTheme.fontColor || "#fff",
                  }}
                >
                  <p className="tlib-preview-fs-verse">
                    "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
                  </p>
                  <p className="tlib-preview-fs-ref">John 3:16 (KJV)</p>
                </div>
              ) : (
                <div className="tlib-preview-lt tlib-preview-lt--iframe">
                  <iframe
                    className="tlib-preview-lt-iframe"
                    title={`${previewTheme.name} full preview`}
                    srcDoc={
                      previewTheme.source === "custom" && previewTheme.settings
                        ? buildCustomLowerThirdPreviewDoc(previewTheme)
                        : buildLowerThirdPreviewDoc(previewTheme, { includeFonts: true })
                    }
                  />
                </div>
              )}
            </div>

            {/* Info section */}
            <div className="tlib-preview-info">
              <div className="tlib-preview-info-top">
                <div className="tlib-preview-info-left">
                  <h3 className="tlib-preview-title">{previewTheme.name}</h3>
                  <div className="tlib-preview-badges">
                    <span className={`tlib-badge tlib-badge--${previewTheme.type}`}>
                      {previewTheme.type === "fullscreen" ? "Fullscreen" : "Lower Third"}
                    </span>
                    {previewTheme.categories.map((category) => (
                      <span key={`${previewTheme.id}-${category}`} className={`tlib-badge tlib-badge--${category}`}>
                        {category}
                      </span>
                    ))}
                    <span className="tlib-badge">{previewTheme.source}</span>
                  </div>
                </div>
                <button
                  className={`tlib-preview-fav-btn${previewTheme.isFavorite ? " tlib-preview-fav-btn--active" : ""}`}
                  onClick={() => handleToggleFavorite(previewTheme)}
                >
                  <Icon name={previewTheme.isFavorite ? "star" : "star_border"} size={20} />
                  {previewTheme.isFavorite ? "Favorited" : "Add to Favorites"}
                </button>
              </div>

              {previewTheme.description && (
                <p className="tlib-preview-desc">{previewTheme.description}</p>
              )}

              {previewTheme.tags.length > 0 && (
                <div className="tlib-preview-tags">
                  {previewTheme.tags.map((tag) => (
                    <span key={tag} className="tlib-preview-tag">{tag}</span>
                  ))}
                </div>
              )}

              {/* Accent color swatch */}
              <div className="tlib-preview-swatch-row">
                <span className="tlib-preview-swatch-label">Accent</span>
                <span
                  className="tlib-preview-swatch"
                  style={{ background: previewTheme.accentColor }}
                />
                <span className="tlib-preview-swatch-hex">{previewTheme.accentColor}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Theme Creator Modal ── */}
      {showCreator && (
        <ThemeCreatorModal
          editTheme={editThemeData}
          onClose={() => { setShowCreator(false); setEditThemeData(null); }}
          onSaved={(theme) => {
            setCustomThemes((prev) => {
              // If editing, replace existing; if creating, append
              const idx = prev.findIndex((t) => t.id === theme.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = theme;
                return next;
              }
              return [...prev, theme];
            });
            setBibleFavs(new Set(getBibleFavorites()));
            setLtFavs(new Set(getWorshipLTFavorites()));
            setShowCreator(false);
            setEditThemeData(null);
            setToastMessage(
              editThemeData ? `"${theme.name}" updated!` : `"${theme.name}" created successfully!`
            );
          }}
        />
      )}

      {/* ── Toast notification ── */}
      {toastMessage && (
        <div className="tlib-toast" role="status" aria-live="polite">
          <Icon name="check_circle" size={20} />
          <span>{toastMessage}</span>
          <button
            className="tlib-toast-close"
            type="button"
            onClick={() => setToastMessage(null)}
            aria-label="Dismiss notification"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
