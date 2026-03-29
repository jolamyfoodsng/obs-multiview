/**
 * ThemeSelector.tsx — Theme preset selector
 *
 * Two modes:
 * - Default (strip): Narrow vertical theme strip with square buttons
 * - Compact: Inline grid of theme cards for the popover
 *
 * Supports favorite themes — starred themes appear first.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBible } from "../bibleStore";
import {
  FAVORITE_THEMES_UPDATED_EVENT,
  getBibleFavorites,
  hydrateFavoriteThemes,
  toggleBibleFavorite,
  sortWithFavorites,
} from "../../services/favoriteThemes";
import Icon from "../../components/Icon";

interface Props {
  /** Compact mode for inline popover grid */
  compact?: boolean;
  /** Callback when "Edit Theme" is triggered */
  onEditTheme?: () => void;
}

export default function ThemeSelector({ compact, onEditTheme }: Props) {
  const { state, setTheme } = useBible();
  const navigate = useNavigate();
  const [favs, setFavs] = useState<Set<string>>(() => getBibleFavorites());

  useEffect(() => {
    let cancelled = false;

    const syncFavorites = () => {
      if (cancelled) return;
      setFavs(new Set(getBibleFavorites()));
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

  const handleToggleFav = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = toggleBibleFavorite(id);
    setFavs(new Set(updated));
  }, []);

  const sortedThemes = useMemo(() => sortWithFavorites(state.themes, favs), [state.themes, favs]);

  // Compact mode: render theme thumbnails inline (favorites first)
  if (compact) {
    return (
      <>
        {sortedThemes.slice(0, 6).map((theme) => {
          const isActive = theme.id === state.activeThemeId;
          const isFav = favs.has(theme.id);
          const bgImg = theme.settings.backgroundImage;
          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              title={theme.name}
              style={{
                aspectRatio: "16/9", borderRadius: "var(--radius)", overflow: "hidden", cursor: "pointer",
                border: isActive ? "2px solid var(--success)" : "1px solid var(--border)",
                boxShadow: isActive ? "0 0 0 2px rgba(var(--success-rgb),0.2)" : "none",
                backgroundImage: bgImg ? `url(${bgImg})` : undefined,
                backgroundSize: "cover", backgroundPosition: "center",
                backgroundColor: bgImg ? undefined : theme.settings.backgroundColor,
                position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end",
                padding: 0,
              }}
            >
              {/* Favorite star */}
              <span
                onClick={(e) => handleToggleFav(theme.id, e)}
                title={isFav ? "Remove from favorites" : "Add to favorites"}
                style={{
                  position: "absolute", top: 3, right: 3,
                  color: isFav ? "#f59e0b" : "rgba(255,255,255,0.5)",
                  cursor: "pointer", textShadow: "0 1px 3px rgba(0,0,0,.6)", zIndex: 1,
                  display: "inline-flex",
                }}
              >
                <Icon name={isFav ? "star" : "star_border"} size={14} />
              </span>
              <div style={{
                background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)", padding: "12px 6px 4px",
                fontSize: 8, fontWeight: 700, color: "#fff", textAlign: "left", lineHeight: 1.2,
              }}>
                {theme.name}
              </div>
            </button>
          );
        })}
      </>
    );
  }

  // Full strip mode (favorites first)
  return (
    <div className="theme-strip b-scroll">
      <span className="theme-strip-title">Themes</span>

      {sortedThemes.map((theme) => {
        const isActive = theme.id === state.activeThemeId;
        const isFav = favs.has(theme.id);
        const bgImg = theme.settings.backgroundImage;
        return (
          <button
            key={theme.id}
            className={`theme-strip-btn ${isActive ? "active" : ""}`}
            onClick={() => setTheme(theme.id)}
            title={theme.name}
            style={{
              backgroundImage: bgImg ? `url(${bgImg})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundColor: bgImg ? undefined : theme.settings.backgroundColor,
              position: "relative",
            }}
          >
            {/* Favorite star overlay */}
            <span
              onClick={(e) => handleToggleFav(theme.id, e)}
              title={isFav ? "Remove from favorites" : "Add to favorites"}
              style={{
                position: "absolute", top: 2, right: 2,
                color: isFav ? "#f59e0b" : "rgba(255,255,255,0.4)",
                cursor: "pointer", textShadow: "0 1px 2px rgba(0,0,0,.6)", zIndex: 1,
                display: "inline-flex",
              }}
            >
              <Icon name={isFav ? "star" : "star_border"} size={12} />
            </span>
            <Icon name={theme.templateType === "lower-third" ? "subtitles" : theme.templateType === "fullscreen" ? "fullscreen" : "format_quote"} size={20} style={{ textShadow: "0 1px 4px rgba(0, 0, 0, .5)" }} />
            <span className="theme-strip-btn-label" style={{ textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>
              {theme.name.length > 8 ? theme.name.slice(0, 7) + "\u2026" : theme.name}
            </span>
          </button>
        );
      })}

      <div className="theme-strip-spacer" />

      <button className="theme-strip-add" onClick={onEditTheme ?? (() => navigate("/bible/templates"))} title="Create new theme">
        <Icon name="add" size={20} />
        <span>New</span>
      </button>
    </div>
  );
}
