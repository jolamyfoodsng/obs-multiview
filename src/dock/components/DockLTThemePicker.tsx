/**
 * DockLTThemePicker.tsx — Lower-third theme picker for the dock
 *
 * Compact dropdown selector: shows the currently selected theme
 * with a click-to-expand dropdown listing available themes.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Star } from "lucide-react";
import { ALL_THEMES, canonicalizeLowerThirdThemeId, type ThemeLike } from "../../lowerthirds/themes";
import { loadDockLTFavorites } from "../dockThemeData";

/** Compact label for the theme card */
function shortName(theme: ThemeLike): string {
  const n = theme.name || theme.id;
  return n
    .replace(/^(Traditional|Modern|Cinematic|Elegant|Bold|Neon|Minimal)\s/i, "")
    .substring(0, 28);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function matchesThemeHints(theme: ThemeLike, hints: string[]): boolean {
  if (hints.length === 0) return true;

  const tagList = (theme.tags || []).map(normalizeToken);
  const signature = `${theme.id} ${theme.name || ""} ${theme.category || ""} ${tagList.join(" ")}`.toLowerCase();

  return hints.some((hint) => {
    if (!hint) return false;
    if (signature.includes(hint)) return true;
    return tagList.some((tag) => tag === hint || tag.includes(hint) || hint.includes(tag));
  });
}

interface Props {
  selectedThemeId: string | null;
  onSelect: (theme: { id: string; html: string; css: string }) => void;
  category?: string;
  tag?: string;
  tags?: string[];
  label?: string;
}

export default function DockLTThemePicker({ selectedThemeId, onSelect, category, tag, tags, label }: Props) {
  const [open, setOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const refreshFavorites = () => {
      loadDockLTFavorites().then((favorites) => {
        if (!cancelled) {
          setFavoriteIds(favorites);
          setFavoritesLoaded(true);
        }
      });
    };
    refreshFavorites();
    const timer = window.setInterval(refreshFavorites, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filter themes by renderability, category, and tag hints
  const filteredThemes = useMemo(() => {
    const normalizedCategory = category ? normalizeToken(category) : "";
    const hintSet = new Set<string>();
    if (tag) hintSet.add(normalizeToken(tag));
    for (const hint of tags || []) {
      const normalized = normalizeToken(hint);
      if (normalized) hintSet.add(normalized);
    }
    const hints = [...hintSet];

    let list = ALL_THEMES.filter((t) => t.html && t.css);
    if (normalizedCategory) {
      list = list.filter((t) => normalizeToken(String(t.category || "")) === normalizedCategory);
    }
    list = list.filter((t) => matchesThemeHints(t, hints));
    const favoriteMatches = list.filter((t) => favoriteIds.has(t.id));
    if (favoriteMatches.length > 0) {
      list = favoriteMatches;
    }
    return [...list].sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 1 : 0;
      const bFav = favoriteIds.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
  }, [category, favoriteIds, tag, tags]);

  const canonicalSelectedThemeId = useMemo(
    () => canonicalizeLowerThirdThemeId(selectedThemeId ?? ""),
    [selectedThemeId],
  );

  const selected = useMemo(
    () => filteredThemes.find((t) => t.id === canonicalSelectedThemeId) ?? filteredThemes[0],
    [filteredThemes, canonicalSelectedThemeId],
  );

  const handleSelect = useCallback(
    (theme: ThemeLike) => {
      onSelect({
        id: theme.id,
        html: theme.html || "",
        css: theme.css || "",
      });
      setOpen(false);
    },
    [onSelect],
  );

  // Auto-pick a visible theme so staged payloads don't fall back to generic defaults.
  useEffect(() => {
    if (!favoritesLoaded) return;
    if (!selected) return;
    if (canonicalSelectedThemeId === selected.id) return;
    handleSelect(selected);
  }, [favoritesLoaded, selected, canonicalSelectedThemeId, handleSelect]);

  return (
    <div className="dock-lt-theme-picker" ref={wrapRef} style={{ position: "relative" }}>
      <div className="dock-section-label" style={{ marginBottom: 4 }}>
        {label ?? "Lower Third Theme"}
      </div>

      {/* Selected theme preview — click to toggle dropdown */}
      <button
        className="dock-theme-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        title={selected ? (selected.name || selected.id) : "Select theme"}
      >
        <div
          className="dock-theme-dropdown-trigger__swatch"
          style={{ background: selected?.accentColor || "#6c63ff" }}
        />
        <span className="dock-theme-dropdown-trigger__name">
          {selected ? shortName(selected) : "Select Theme"}
        </span>
        {selected && favoriteIds.has(selected.id) && (
          <Star size={12} className="dock-theme-dropdown-trigger__favorite" />
        )}
        {open ? (
          <ChevronUp size={14} style={{ color: "var(--dock-text-dim)" }} />
        ) : (
          <ChevronDown size={14} style={{ color: "var(--dock-text-dim)" }} />
        )}
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="dock-theme-dropdown-list">
          {filteredThemes.map((theme) => (
            <button
              key={theme.id}
              className={`dock-theme-dropdown-item${canonicalSelectedThemeId === theme.id ? " dock-theme-dropdown-item--active" : ""}`}
              onClick={() => handleSelect(theme)}
            >
              <div
                className="dock-theme-dropdown-item__swatch"
                style={{ background: theme.accentColor || "#6c63ff" }}
              />
              <span className="dock-theme-dropdown-item__name">{shortName(theme)}</span>
              {favoriteIds.has(theme.id) && (
                <Star size={11} className="dock-theme-dropdown-item__favorite" />
              )}
            </button>
          ))}

          {filteredThemes.length === 0 && (
            <div style={{ padding: 10, textAlign: "center", color: "var(--dock-text-dim)", fontSize: 10 }}>
              No themes available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
