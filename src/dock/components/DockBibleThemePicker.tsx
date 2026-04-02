import { useState, useEffect, useCallback, useMemo } from "react";
import type { BibleTheme, BibleThemeSettings } from "../../bible/types";
import DockThemeBrowserModal from "./DockThemeBrowserModal";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";

interface Props {
  selectedThemeId: string | null;
  onSelect: (theme: BibleTheme) => void;
  label?: string;
  templateType?: BibleTheme["templateType"];
}

function clampPreviewSize(size: number, min: number, max: number, ratio = 0.18): number {
  return Math.max(min, Math.min(max, Math.round(size * ratio)));
}

function themePreviewStyle(settings: BibleThemeSettings) {
  return {
    background: settings.boxBackgroundImage
      ? `url(${settings.boxBackgroundImage}) center/cover`
      : settings.backgroundImage
        ? `url(${settings.backgroundImage}) center/cover`
        : settings.boxBackground || settings.backgroundColor || "#0a0a14",
    color: settings.fontColor || "#fff",
    textAlign: settings.textAlign || "center",
    fontFamily: settings.fontFamily || '"CMG Sans", sans-serif',
  } as const;
}

export default function DockBibleThemePicker({ selectedThemeId, onSelect, label, templateType }: Props) {
  const [allThemes, setAllThemes] = useState<BibleTheme[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);

  const loadThemes = useCallback(async () => {
    const favorites = await loadDockFavoriteBibleThemes(templateType);
    setAllThemes(favorites);
  }, [templateType]);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes]);

  useEffect(() => {
    if (!showBrowser) return;
    void loadThemes();
  }, [loadThemes, showBrowser]);

  const selected = useMemo(
    () => allThemes.find((theme) => theme.id === selectedThemeId) ?? allThemes[0],
    [allThemes, selectedThemeId],
  );

  const handleSelect = useCallback(
    (theme: BibleTheme) => {
      onSelect(theme);
    },
    [onSelect],
  );

  useEffect(() => {
    if (!selected) return;
    if (selectedThemeId === selected.id) return;
    handleSelect(selected);
  }, [handleSelect, selected, selectedThemeId]);

  return (
    <>
      <div className="dock-bible-theme-picker">
        <div className="dock-section-label" style={{ marginBottom: 4 }}>
          {label ?? "Bible Theme"}
        </div>

        <button
          className="dock-theme-dropdown-trigger dock-theme-dropdown-trigger--preview"
          onClick={() => setShowBrowser(true)}
          title={selected?.description || selected?.name || "Select favorite theme"}
        >
          <div
            className="dock-theme-dropdown-trigger__swatch dock-theme-dropdown-trigger__swatch--preview"
            style={selected ? themePreviewStyle(selected.settings) : undefined}
          >
            {selected && (
              <div className="dock-theme-dropdown-trigger__sample">
                <span
                  className="dock-theme-dropdown-trigger__sample-main"
                  style={{
                    fontSize: clampPreviewSize(selected.settings.fontSize, 10, 18),
                    fontWeight: selected.settings.fontWeight === "light" ? 400 : selected.settings.fontWeight === "bold" ? 700 : 500,
                    textTransform: selected.settings.textTransform,
                    lineHeight: 1.05,
                  }}
                >
                  Faith
                </span>
                <span
                  className="dock-theme-dropdown-trigger__sample-ref"
                  style={{
                    fontSize: clampPreviewSize(selected.settings.refFontSize, 8, 12),
                    color: selected.settings.refFontColor || selected.settings.fontColor || "#fff",
                    fontWeight: selected.settings.refFontWeight === "light" ? 400 : selected.settings.refFontWeight === "bold" ? 700 : 500,
                  }}
                >
                  John 3:16
                </span>
              </div>
            )}
          </div>
          {/* <span className="dock-theme-dropdown-trigger__name">
            {selected?.name || "No Favorite Themes"}
          </span> */}
          {/* <ChevronDown size={14} style={{ color: "var(--dock-text-dim)" }} /> */}
        </button>
      </div>

      <DockThemeBrowserModal
        open={showBrowser}
        selectedThemeId={selectedThemeId}
        onSelect={handleSelect}
        onClose={() => setShowBrowser(false)}
        title={label ?? "Select Bible Theme"}
        templateType={templateType}
      />
    </>
  );
}
