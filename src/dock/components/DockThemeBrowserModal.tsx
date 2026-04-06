import { useState, useMemo, useEffect } from "react";
import { ImageIcon, Search, Sparkles, X } from "lucide-react";
import type { BibleTheme } from "../../bible/types";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";

interface Props {
  open: boolean;
  selectedThemeId: string | null;
  onSelect: (theme: BibleTheme) => void;
  onClose: () => void;
  title?: string;
  templateType?: BibleTheme["templateType"];
  allowedCategories?: Array<NonNullable<BibleTheme["category"]>>;
}

function clampPreviewSize(size: number, min: number, max: number, ratio = 0.2): number {
  return Math.max(min, Math.min(max, Math.round(size * ratio)));
}

export default function DockThemeBrowserModal({
  open,
  selectedThemeId,
  onSelect,
  onClose,
  title = "Select Theme",
  templateType,
  allowedCategories,
}: Props) {
  const [allThemes, setAllThemes] = useState<BibleTheme[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const favoriteThemes = await loadDockFavoriteBibleThemes(templateType);
      if (cancelled) return;
      const allowed = new Set((allowedCategories ?? []).map((category) => category.toLowerCase()));
      const filtered = allowed.size === 0
        ? favoriteThemes
        : favoriteThemes.filter((theme) => {
          const categories = theme.categories?.length ? theme.categories : theme.category ? [theme.category] : [];
          if (categories.length === 0) return false;
          return categories.some((category) => allowed.has(category.toLowerCase()));
        });
      setAllThemes(filtered);
    })();

    return () => {
      cancelled = true;
    };
  }, [allowedCategories, open, templateType]);

  const favorites = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q
      ? allThemes.filter(
        (theme) =>
          theme.name.toLowerCase().includes(q) ||
          (theme.description ?? "").toLowerCase().includes(q) ||
          (theme.category ?? "").toLowerCase().includes(q) ||
          (theme.categories ?? []).some((category) => category.toLowerCase().includes(q)),
      )
      : allThemes;
  }, [allThemes, search]);

  if (!open) return null;

  const renderThemeCard = (theme: BibleTheme) => {
    const isActive = theme.id === selectedThemeId;
    const bgColor = theme.settings.boxBackground || theme.settings.backgroundColor || "#0a0a14";
    const fontColor = theme.settings.fontColor || "#fff";
    const bgImage = theme.settings.boxBackgroundImage || theme.settings.backgroundImage;
    const hasBgImage = Boolean(bgImage && !bgImage.startsWith("__"));
    const textAlign = theme.settings.textAlign || "center";

    return (
      <button
        key={theme.id}
        className={`dtb-card${isActive ? " dtb-card--active" : ""}`}
        onClick={() => {
          onSelect(theme);
          onClose();
        }}
        title={theme.description || theme.name}
      >
        <div
          className="dtb-card__swatch"
          style={{
            background: hasBgImage ? `url(${bgImage}) center/cover` : bgColor,
            color: fontColor,
            fontFamily: theme.settings.fontFamily,
            textAlign,
          }}
        >
          <div className="dtb-card__swatch-preview">
            <span
              className="dtb-card__swatch-main"
              style={{
                fontSize: clampPreviewSize(theme.settings.fontSize, 10, 18),
                fontWeight: theme.settings.fontWeight === "light" ? 400 : theme.settings.fontWeight === "bold" ? 700 : 500,
                textTransform: theme.settings.textTransform,
                textShadow: theme.settings.textShadow,
                color: theme.settings.fontColor,
              }}
            >
              Faith
            </span>
            <span
              className="dtb-card__swatch-ref"
              style={{
                fontSize: clampPreviewSize(theme.settings.refFontSize, 8, 12),
                fontWeight: theme.settings.refFontWeight === "light" ? 400 : theme.settings.refFontWeight === "bold" ? 700 : 500,
                color: theme.settings.refFontColor || theme.settings.fontColor,
              }}
            >
              John 3:16
            </span>
          </div>
          {theme.settings.logoUrl && (
            <span className="dtb-card__logo-badge" title="Includes logo">
              <ImageIcon size={9} />
            </span>
          )}
        </div>

        <div className="dtb-card__info">
          <span className="dtb-card__name">{theme.name}</span>
          {/* <span className="dtb-card__favorite-badge">
            <Star size={10} />
            Favorite
          </span> */}
        </div>

        <div className="dtb-card__meta">
          {(theme.categories?.length ? theme.categories : theme.category ? [theme.category] : []).map((category) => (
            <span key={`${theme.id}-${category}`} className={`dtb-card__badge dtb-card__badge--${category}`}>
              {category}
            </span>
          ))}
          <span className={`dtb-card__badge dtb-card__badge--${theme.source}`}>
            {theme.source === "custom" ? "Custom" : "Built-in"}
          </span>
        </div>
      </button>
    );
  };

  const renderSection = (label: string, themes: BibleTheme[]) => {
    if (themes.length === 0) return null;
    return (
      <div className="dtb-section">
        <div className="dtb-section__header">
          <span>{label}</span>
          <span className="dtb-section__count">{themes.length}</span>
        </div>
        <div className="dtb-grid">
          {themes.map(renderThemeCard)}
        </div>
      </div>
    );
  };

  return (
    <div className="dtb-backdrop" onClick={onClose}>
      <div className="dtb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dtb-header">
          <h3 className="dtb-title">{title}</h3>
          <div className="dtb-header__actions">
            <button className="dtb-close-btn" onClick={onClose} aria-label="Close theme browser">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="dtb-search">
          <Search size={14} />
          <input
            type="text"
            className="dtb-search__input"
            placeholder="Search themes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search themes"
            autoFocus
          />
          {search && (
            <button type="button" className="dtb-search__clear" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="dtb-body">
          {renderSection("Favorite Themes", favorites)}

          {favorites.length === 0 && (
            <div className="dtb-empty">
              <Sparkles size={28} />
              <span>No favorite themes available</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
