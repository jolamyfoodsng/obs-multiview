import { useState, useEffect, useCallback, useMemo } from "react";
import type { BibleTheme, BibleThemeSettings } from "../../bible/types";
import DockThemeBrowserModal from "./DockThemeBrowserModal";
import { loadDockFavoriteBibleThemes } from "../dockThemeData";

interface Props {
  selectedThemeId: string | null;
  onSelect: (theme: BibleTheme) => void;
  label?: string;
  templateType?: BibleTheme["templateType"];
  previewTheme?: BibleTheme | null;
  allowedCategories?: Array<NonNullable<BibleTheme["category"]>>;
  browserTitle?: string;
  sampleText?: string;
  sampleReference?: string;
}

function clampPreviewSize(size: number, min: number, max: number, ratio = 0.18): number {
  return Math.max(min, Math.min(max, Math.round(size * ratio)));
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return `rgba(10, 10, 20, ${alpha})`;
  }
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function themePreviewStyle(settings: BibleThemeSettings) {
  const overlayEnabled = settings.fullscreenShadeEnabled !== false;
  const overlay =
    overlayEnabled && settings.fullscreenShadeOpacity > 0
      ? `linear-gradient(${hexToRgba(settings.fullscreenShadeColor || "#0b1020", settings.fullscreenShadeOpacity)}, ${hexToRgba(settings.fullscreenShadeColor || "#0b1020", settings.fullscreenShadeOpacity)})`
      : null;
  const imageLayer = settings.boxBackgroundImage
    ? `url(${settings.boxBackgroundImage})`
    : settings.backgroundImage
      ? `url(${settings.backgroundImage})`
      : null;

  return {
    backgroundColor: settings.boxBackground || settings.backgroundColor || "#0a0a14",
    backgroundImage: [overlay, imageLayer].filter(Boolean).join(", ") || undefined,
    backgroundPosition: imageLayer ? "center, center" : undefined,
    backgroundSize: imageLayer ? "cover, cover" : undefined,
    color: settings.fontColor || "#fff",
    textAlign: settings.textAlign || "center",
    fontFamily: settings.fontFamily || '"CMG Sans", sans-serif',
  } as const;
}

export default function DockBibleThemePicker({
  selectedThemeId,
  onSelect,
  label,
  templateType,
  previewTheme,
  allowedCategories,
  browserTitle,
  sampleText,
  sampleReference,
}: Props) {
  const [allThemes, setAllThemes] = useState<BibleTheme[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const resolvedLabel = typeof label === "string" ? label.trim() : "Bible Theme";
  const showLabel = typeof label === "string" ? resolvedLabel.length > 0 : true;
  const previewRatio = templateType === "fullscreen" ? 0.15 : 0.18;
  const sampleMain = sampleText || "Faith";
  const sampleMeta = sampleReference ?? "John 3:16";

  const loadThemes = useCallback(async () => {
    const favorites = await loadDockFavoriteBibleThemes(templateType);
    const allowed = new Set((allowedCategories ?? []).map((category) => category.toLowerCase()));
    const filtered = allowed.size === 0
      ? favorites
      : favorites.filter((theme) => {
        const categories = theme.categories?.length ? theme.categories : theme.category ? [theme.category] : [];
        if (categories.length === 0) return false;
        return categories.some((category) => allowed.has(category.toLowerCase()));
      });
    setAllThemes(filtered);
  }, [allowedCategories, templateType]);

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
  const displayTheme = previewTheme ?? selected;

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
      <div
        className={[
          "dock-bible-theme-picker",
          templateType === "fullscreen" ? "dock-bible-theme-picker--fullscreen" : "",
          !showLabel ? "dock-bible-theme-picker--label-less" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {showLabel && (
          <div className="dock-section-label" style={{ marginBottom: 4 }}>
            {resolvedLabel}
          </div>
        )}

        <button
          className="dock-theme-dropdown-trigger dock-theme-dropdown-trigger--preview"
          onClick={() => setShowBrowser(true)}
          title={displayTheme?.description || displayTheme?.name || "Select favorite theme"}
        >
          <div
            className="dock-theme-dropdown-trigger__swatch dock-theme-dropdown-trigger__swatch--preview"
            style={displayTheme ? themePreviewStyle(displayTheme.settings) : undefined}
          >
            {displayTheme && (
              <div className="dock-theme-dropdown-trigger__sample">
                <span
                  className="dock-theme-dropdown-trigger__sample-main"
                  style={{
                    fontSize: clampPreviewSize(displayTheme.settings.fontSize, 9, 16, previewRatio),
                    fontWeight: displayTheme.settings.fontWeight === "light" ? 400 : displayTheme.settings.fontWeight === "bold" ? 700 : 500,
                    textTransform: displayTheme.settings.textTransform,
                    lineHeight: 1.05,
                  }}
                >
                  {sampleMain}
                </span>
                {sampleMeta && (
                  <span
                    className="dock-theme-dropdown-trigger__sample-ref"
                    style={{
                      fontSize: clampPreviewSize(displayTheme.settings.refFontSize, 7, 11, previewRatio),
                      color: displayTheme.settings.refFontColor || displayTheme.settings.fontColor || "#fff",
                      fontWeight: displayTheme.settings.refFontWeight === "light" ? 400 : displayTheme.settings.refFontWeight === "bold" ? 700 : 500,
                    }}
                  >
                    {sampleMeta}
                  </span>
                )}
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
        title={browserTitle ?? (showLabel ? resolvedLabel : "Select Bible Theme")}
        templateType={templateType}
        allowedCategories={allowedCategories}
      />
    </>
  );
}
