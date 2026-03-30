/**
 * ThemeCreatorModal.tsx — Create new fullscreen & lower-third Bible themes
 *
 * Fullscreen builder: bg color/image, font family/size/weight/color, text alignment,
 *   line-height, text shadow, padding, animation, logo, and reference style.
 *
 * Lower-third builder: box bg color/image, font family/size/weight/color,
 *   border-radius, animation, padding, and bar size preset.
 *
 * Both modes show a real-time preview that mirrors the final OBS overlay.
 */

import {
  useState,
  useCallback,
  useMemo,
  useId,
  useRef,
} from "react";
import Icon from "../components/Icon";
import type {
  BibleTheme,
  BibleThemeCategory,
  BibleThemeSettings,
  LowerThirdSize,
  LowerThirdWidthPreset,
} from "../bible/types";
import { DEFAULT_THEME_SETTINGS } from "../bible/types";
import { saveCustomTheme } from "../bible/bibleDb";
import { addBibleFavorite } from "../services/favoriteThemes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type CreatorTab = "fullscreen" | "lower-third";

const CATEGORY_OPTIONS: Array<{ value: BibleThemeCategory; label: string; icon: string }> = [
  { value: "bible", label: "Bible", icon: "auto_stories" },
  { value: "worship", label: "Worship", icon: "music_note" },
  { value: "general", label: "General", icon: "dashboard" },
];

const FONT_FAMILIES = [
  '"CMG Sans", sans-serif',
  '"Montserrat", sans-serif',
  '"Inter", sans-serif',
  '"Playfair Display", serif',
  '"Lora", serif',
  '"Merriweather", serif',
  '"Roboto", sans-serif',
  '"Open Sans", sans-serif',
  '"Poppins", sans-serif',
  '"Oswald", sans-serif',
  '"Raleway", sans-serif',
  '"Bebas Neue", sans-serif',
  '"DM Sans", sans-serif',
  '"Source Serif 4", serif',
  '"Libre Baskerville", serif',
  "Georgia, serif",
  "system-ui, sans-serif",
];

const FONT_FAMILY_LABELS: Record<string, string> = {
  '"CMG Sans", sans-serif': "CMG Sans",
  '"Montserrat", sans-serif': "Montserrat",
  '"Inter", sans-serif': "Inter",
  '"Playfair Display", serif': "Playfair Display",
  '"Lora", serif': "Lora",
  '"Merriweather", serif': "Merriweather",
  '"Roboto", sans-serif': "Roboto",
  '"Open Sans", sans-serif': "Open Sans",
  '"Poppins", sans-serif': "Poppins",
  '"Oswald", sans-serif': "Oswald",
  '"Raleway", sans-serif': "Raleway",
  '"Bebas Neue", sans-serif': "Bebas Neue",
  '"DM Sans", sans-serif': "DM Sans",
  '"Source Serif 4", serif': "Source Serif 4",
  '"Libre Baskerville", serif': "Libre Baskerville",
  "Georgia, serif": "Georgia",
  "system-ui, sans-serif": "System",
};

const ANIMATIONS: Array<{ value: BibleThemeSettings["animation"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide Up" },
  { value: "slide-left", label: "Slide Left" },
  { value: "scale-in", label: "Scale In" },
  { value: "reveal-bg-then-text", label: "Reveal Background + Text" },
];

const LT_SIZES: Array<{ value: LowerThirdSize; label: string }> = [
  { value: "smallest", label: "Smallest" },
  { value: "smaller", label: "Smaller" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "big", label: "Big" },
  { value: "bigger", label: "Bigger" },
  { value: "biggest", label: "Biggest" },
];

const LT_WIDTHS: Array<{ value: LowerThirdWidthPreset; label: string; reduction: number }> = [
  { value: "full", label: "Full", reduction: 0 },
  { value: "sm", label: "SM", reduction: 120 },
  { value: "md", label: "MD", reduction: 240 },
  { value: "lg", label: "LG", reduction: 360 },
  { value: "xl", label: "XL", reduction: 520 },
  { value: "xxl", label: "XXL", reduction: 680 },
];

const LT_WIDTH_REDUCTION = LT_WIDTHS.reduce<Record<LowerThirdWidthPreset, number>>(
  (acc, option) => {
    acc[option.value] = option.reduction;
    return acc;
  },
  {
    full: 0,
    sm: 120,
    md: 240,
    lg: 360,
    xl: 520,
    xxl: 680,
  }
);

const LT_POSITIONS: Array<{
  value: BibleThemeSettings["lowerThirdPosition"];
  label: string;
  icon: string;
}> = [
  { value: "left", label: "Left", icon: "align_horizontal_left" },
  { value: "center", label: "Center", icon: "align_horizontal_center" },
  { value: "right", label: "Right", icon: "align_horizontal_right" },
];

const OBS_CANVAS_WIDTH = 1920;
const LT_MIN_WIDTH = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getLowerThirdLayout(settings: BibleThemeSettings, canvasWidth = OBS_CANVAS_WIDTH) {
  const safeArea = Math.max(0, Number(settings.safeArea) || 40);
  const paddedWidth = Math.max(LT_MIN_WIDTH, canvasWidth - safeArea * 2);
  const requestedReduction = LT_WIDTH_REDUCTION[settings.lowerThirdWidthPreset || "full"] ?? 0;
  const maxReduction = Math.max(0, paddedWidth - LT_MIN_WIDTH);
  const reduction = clamp(requestedReduction, 0, maxReduction);
  const barWidth = Math.max(LT_MIN_WIDTH, paddedWidth - reduction);
  const freeSpace = Math.max(0, paddedWidth - barWidth);

  let minOffset = 0;
  let maxOffset = 0;

  if (settings.lowerThirdPosition === "center") {
    minOffset = -freeSpace / 2;
    maxOffset = freeSpace / 2;
  } else if (settings.lowerThirdPosition === "right") {
    minOffset = -freeSpace;
    maxOffset = 0;
  } else {
    minOffset = 0;
    maxOffset = freeSpace;
  }

  return {
    safeArea,
    paddedWidth,
    reduction,
    barWidth,
    freeSpace,
    justify:
      settings.lowerThirdPosition === "center"
        ? "center"
        : settings.lowerThirdPosition === "right"
          ? "flex-end"
          : "flex-start",
    minOffset: Math.round(minOffset),
    maxOffset: Math.round(maxOffset),
    offsetX: Math.round(clamp(Number(settings.lowerThirdOffsetX) || 0, minOffset, maxOffset)),
  };
}

function normalizeThemeSettings(settings: BibleThemeSettings): BibleThemeSettings {
  const normalized = {
    ...settings,
    lowerThirdWidthPreset: settings.lowerThirdWidthPreset || "full",
  };
  const layout = getLowerThirdLayout(normalized);
  return {
    ...normalized,
    lowerThirdOffsetX: layout.offsetX,
  };
}

function normalizeCategories(values: Array<BibleThemeCategory | null | undefined>): BibleThemeCategory[] {
  const ordered = CATEGORY_OPTIONS.map((option) => option.value);
  const set = new Set<BibleThemeCategory>();
  for (const value of values) {
    if (value && ordered.includes(value)) {
      set.add(value);
    }
  }
  if (set.size === 0) set.add("bible");
  return ordered.filter((value) => set.has(value));
}

// ── Category-specific sample content for the live preview ──
const SAMPLE_CONTENT: Record<
  BibleThemeCategory,
  { verse: string; ref: string; refAbbr: string; verseShort: string }
> = {
  bible: {
    verse: "\u201CFor God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.\u201D",
    ref: "John 3:16 (KJV)",
    refAbbr: "Jn 3:16 (KJV)",
    verseShort: "\u201CFor God so loved the world, that he gave his only begotten Son…\u201D",
  },
  worship: {
    verse: "Amazing grace, how sweet the sound\nThat saved a wretch like me\nI once was lost, but now I\u2019m found\nWas blind, but now I see",
    ref: "Amazing Grace \u2014 John Newton",
    refAbbr: "Amazing Grace \u2014 John Newton",
    verseShort: "Amazing grace, how sweet the sound\nThat saved a wretch like me…",
  },
  general: {
    verse: "Join us this Sunday for a special time of worship and fellowship. All are welcome!",
    ref: "Sunday Service \u2014 10:30 AM",
    refAbbr: "Sunday Service \u2014 10:30 AM",
    verseShort: "Join us this Sunday for a special time…",
  },
};

/** Preview content visibility options */
interface PreviewOptions {
  showVerse: boolean;
  showRef: boolean;
  abbreviateBooks: boolean;
}

const DEFAULT_PREVIEW_OPTIONS: PreviewOptions = {
  showVerse: true,
  showRef: true,
  abbreviateBooks: false,
};

/** Section descriptions — shown under each section heading */
const SECTION_DESC: Record<string, string> = {
  details: "Name your theme, add a description, and choose one or more categories.",
  background: "Set the stage — choose a color, image, or overlay shade.",
  logo: "Add your church or ministry logo to the overlay.",
  typography: "Control font family, size, weight, color, and text effects.",
  reference: "Style the reference line (or subtitle) below the main text.",
  spacing: "Adjust padding, safe-area margins, and border radius.",
  animation: "Choose how the overlay enters the screen.",
};

const LOGO_POSITIONS: Array<{
  value: BibleThemeSettings["logoPosition"];
  label: string;
  icon: string;
}> = [
  { value: "top-left", label: "Top Left", icon: "north_west" },
  { value: "top-right", label: "Top Right", icon: "north_east" },
  { value: "bottom-left", label: "Bottom Left", icon: "south_west" },
  { value: "bottom-right", label: "Bottom Right", icon: "south_east" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse a CSS text-shadow value into visual-builder fields */
function parseShadow(raw: string): { x: number; y: number; blur: number; color: string } {
  const defaults = { x: 0, y: 2, blur: 8, color: "#000000" };
  if (!raw || raw === "none") return defaults;
  // Match: "Xpx Ypx Bpx <color>"  or  "<color> Xpx Ypx Bpx"
  const nums = raw.match(/-?\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    defaults.x = parseFloat(nums[0]);
    defaults.y = parseFloat(nums[1]);
    defaults.blur = parseFloat(nums[2]);
  }
  const colorMatch = raw.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-zA-Z]+)/);
  if (colorMatch) {
    const c = colorMatch[1];
    // Only keep if it's an actual color (not a number-like thing)
    if (c.startsWith("#") || c.startsWith("rgb") || /^[a-z]{3,}$/i.test(c)) {
      defaults.color = c;
    }
  }
  return defaults;
}

/** Convert a hex color to rgba with given opacity */
function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${opacity})`;
}

/** Build CSS text-shadow from visual values */
function buildShadowCss(x: number, y: number, blur: number, color: string): string {
  if (x === 0 && y === 0 && blur === 0) return "none";
  return `${x}px ${y}px ${blur}px ${color}`;
}

/** Generate CSS keyframes + animation rule for the preview content element */
function buildAnimationCss(anim: BibleThemeSettings["animation"], duration: number): string {
  if (anim === "none") return "";
  const ms = duration;
  let keyframes = "";
  switch (anim) {
    case "fade":
      keyframes = `@keyframes tc-enter{from{opacity:0}to{opacity:1}}`;
      break;
    case "slide-up":
      keyframes = `@keyframes tc-enter{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}`;
      break;
    case "slide-left":
      keyframes = `@keyframes tc-enter{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:translateX(0)}}`;
      break;
    case "scale-in":
      keyframes = `@keyframes tc-enter{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}`;
      break;
    case "reveal-bg-then-text": {
      const bgMs = Math.max(180, Math.round(ms * 0.6));
      const textMs = Math.max(180, Math.round(ms * 0.75));
      const textDelay = Math.max(80, Math.round(ms * 0.28));
      return `@keyframes tc-panel-enter{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}\n` +
        `@keyframes tc-text-enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}\n` +
        `.anim-panel{animation:tc-panel-enter ${bgMs}ms ease both;}\n` +
        `.anim-text{opacity:0;animation:tc-text-enter ${textMs}ms ease ${textDelay}ms both;}`;
    }
  }
  return `${keyframes}\n.anim{animation:tc-enter ${ms}ms ease both;}`;
}

/** Build an inline HTML preview doc for a fullscreen theme */
function buildFullscreenPreviewHtml(
  s: BibleThemeSettings,
  cat: BibleThemeCategory,
  opts: PreviewOptions = DEFAULT_PREVIEW_OPTIONS
): string {
  const sample = SAMPLE_CONTENT[cat];
  const refText = opts.abbreviateBooks ? sample.refAbbr : sample.ref;
  const bgImg = s.backgroundImage
    ? `background-image: url("${s.backgroundImage.replace(/"/g, "&quot;")}"); background-size: cover; background-position: center;`
    : "";
  const shade = s.fullscreenShadeEnabled
    ? `<div style="position:absolute;inset:0;background:${s.fullscreenShadeColor};opacity:${s.fullscreenShadeOpacity};pointer-events:none;"></div>`
    : "";
  const animCss = buildAnimationCss(s.animation, s.animationDuration);
  const contentAnimClass = s.animation === "reveal-bg-then-text"
    ? " anim-panel"
    : s.animation !== "none"
      ? " anim"
      : "";
  const textAnimClass = s.animation === "reveal-bg-then-text" ? " anim-text" : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:${s.fontFamily};}
body{display:flex;align-items:center;justify-content:center;position:relative;
background:${s.backgroundColor};${bgImg}opacity:${s.backgroundOpacity};}
.shade{position:absolute;inset:0;pointer-events:none;}
.content{position:relative;z-index:1;text-align:${s.textAlign};padding:${s.padding}px;max-width:90%;}
.verse{font-size:${s.fontSize * 0.38}px;font-weight:${s.fontWeight};color:${s.fontColor};
line-height:${s.lineHeight};text-shadow:${s.textShadow};
${s.textOutline ? `-webkit-text-stroke:${s.textOutlineWidth}px ${s.textOutlineColor};` : ""}
font-style:italic;text-transform:${s.textTransform};white-space:pre-line;}
.ref{font-size:${s.refFontSize * 0.38}px;font-weight:${s.refFontWeight};color:${s.refFontColor};
margin-top:8px;letter-spacing:0.5px;}
.logo{position:absolute;z-index:3;width:${s.logoSize * 0.4}px;height:auto;opacity:0.85;display:${s.logoUrl ? "block" : "none"};}
.logo.top-left{top:10px;left:10px;}
.logo.top-right{top:10px;right:10px;}
.logo.bottom-left{bottom:10px;left:10px;}
.logo.bottom-right{bottom:10px;right:10px;}
${animCss}
</style></head><body>${shade}
<div class="content${contentAnimClass}">
${opts.showRef && s.refPosition === "top" ? `<p class="ref${textAnimClass}">${refText}</p>` : ""}
${opts.showVerse ? `<p class="verse${textAnimClass}">${sample.verse}</p>` : ""}
${opts.showRef && s.refPosition === "bottom" ? `<p class="ref${textAnimClass}">${refText}</p>` : ""}
</div>
${s.logoUrl ? `<img class="logo ${s.logoPosition}" src="${s.logoUrl.replace(/"/g, "&quot;")}" alt="">` : ""}
</body></html>`;
}

/** Build an inline HTML preview doc for a lower-third theme */
function buildLowerThirdPreviewHtml(
  s: BibleThemeSettings,
  cat: BibleThemeCategory,
  opts: PreviewOptions = DEFAULT_PREVIEW_OPTIONS
): string {
  const layout = getLowerThirdLayout(s);
  const sample = SAMPLE_CONTENT[cat];
  const refText = opts.abbreviateBooks ? sample.refAbbr : sample.ref;
  const boxBgImg = s.boxBackgroundImage
    ? `background-image: url("${s.boxBackgroundImage.replace(/"/g, "&quot;")}"); background-size: cover; background-position: center;`
    : "";
  const transparentBox = !s.boxBackgroundImage &&
    s.boxOpacity <= 0 &&
    s.boxBackground.trim().toLowerCase() === "transparent";
  const panelBackground = transparentBox ? "transparent" : s.boxBackground;
  const panelOpacity = transparentBox ? 1 : s.boxOpacity;
  const panelShadow = transparentBox ? "none" : "0 16px 40px rgba(0,0,0,.28)";
  const panelBorder = transparentBox ? "none" : "1px solid rgba(255,255,255,.08)";
  const animCss = buildAnimationCss(s.animation, s.animationDuration);
  const barAnimClass = s.animation === "reveal-bg-then-text"
    ? " anim-panel"
    : s.animation !== "none"
      ? " anim"
      : "";
  const textAnimClass = s.animation === "reveal-bg-then-text" ? " anim-text" : "";
  const scaledOffset = Math.round(layout.offsetX * 0.35);
  const scaledWidth = Math.round(layout.barWidth * 0.35)-60;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:${s.fontFamily};
background:transparent;}
body{display:flex;align-items:flex-end;justify-content:${layout.justify};}
.bar{display:flex;flex-direction:column;align-items:stretch;text-align:${s.textAlign};
position:relative;isolation:isolate;overflow:hidden;
border-radius:${s.borderRadius}px;padding:${s.padding * 0.35}px ${s.padding * 0.5}px;
width:min(100%, ${scaledWidth}px);max-width:100%;box-sizing:border-box;
left:${scaledOffset}px;
min-height:${Math.max(0, s.lowerThirdHeight || 0) * 0.35}px;
box-shadow:${panelShadow};border:${panelBorder};}
.bar::before{content:"";position:absolute;inset:0;border-radius:inherit;
background:${panelBackground};${boxBgImg}opacity:${panelOpacity};
backdrop-filter:${transparentBox ? "none" : "blur(12px)"};-webkit-backdrop-filter:${transparentBox ? "none" : "blur(12px)"};z-index:0;}
.verse{font-size:${s.fontSize * 0.3}px;font-weight:${s.fontWeight};color:${s.fontColor};
line-height:${s.lineHeight};text-shadow:${s.textShadow};
text-transform:${s.textTransform};margin:0 0 4px;white-space:pre-line;width:100%;position:relative;z-index:1;}
.ref{font-size:${s.refFontSize * 0.3}px;font-weight:${s.refFontWeight};color:${s.refFontColor};
margin:0;letter-spacing:0.3px;width:100%;position:relative;z-index:1;}
${animCss}
</style></head><body style="padding:0px !important;">
<div class="bar${barAnimClass}">
${opts.showVerse ? `<p class="verse${textAnimClass}">${sample.verseShort}</p>` : ""}
${opts.showRef ? `<p class="ref${textAnimClass}">${refText}</p>` : ""}
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onClose: () => void;
  onSaved: (theme: BibleTheme) => void;
  /** If provided, we're editing/cloning an existing theme */
  editTheme?: BibleTheme | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ThemeCreatorModal({ onClose, onSaved, editTheme }: Props) {
  const formId = useId();
  const isEditing = !!editTheme;
  const [tab, setTab] = useState<CreatorTab>(
    editTheme?.templateType === "lower-third" ? "lower-third" : "fullscreen"
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Theme metadata ──
  const [name, setName] = useState(editTheme?.name || "");
  const [description, setDescription] = useState(editTheme?.description || "");
  const [categories, setCategories] = useState<BibleThemeCategory[]>(
    normalizeCategories(editTheme?.categories?.length ? editTheme.categories : [editTheme?.category])
  );
  const previewCategory = categories[0] || "bible";

  // ── Settings (shared between both tabs — values are tab-aware) ──
  const [settings, setSettings] = useState<BibleThemeSettings>(
    normalizeThemeSettings(
      editTheme ? { ...DEFAULT_THEME_SETTINGS, ...editTheme.settings } : { ...DEFAULT_THEME_SETTINGS }
    )
  );

  // ── Preview content visibility options (per-category) ──
  const [previewOpts, setPreviewOpts] = useState<PreviewOptions>({ ...DEFAULT_PREVIEW_OPTIONS });
  const [showPreviewSettings, setShowPreviewSettings] = useState(false);

  // Patch helper
  const patch = useCallback(
    (partial: Partial<BibleThemeSettings>) =>
      setSettings((prev) => normalizeThemeSettings({ ...prev, ...partial })),
    []
  );

  const toggleCategory = useCallback((value: BibleThemeCategory) => {
    setCategories((prev) => {
      if (prev.includes(value)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== value);
      }
      return normalizeCategories([...prev, value]);
    });
  }, []);

  // ── Animation replay key — increments when animation or duration changes
  //    to force the iframe to remount, replaying the entrance animation. ──
  const animKeyRef = useRef(0);
  const prevAnimRef = useRef<string>(settings.animation);
  const prevDurRef = useRef<number>(settings.animationDuration);
  if (settings.animation !== prevAnimRef.current || settings.animationDuration !== prevDurRef.current) {
    animKeyRef.current += 1;
    prevAnimRef.current = settings.animation;
    prevDurRef.current = settings.animationDuration;
  }

  // ── Live preview HTML ──
  const previewHtml = useMemo(() => {
    return tab === "fullscreen"
      ? buildFullscreenPreviewHtml(settings, previewCategory, previewOpts)
      : buildLowerThirdPreviewHtml(settings, previewCategory, previewOpts);
  }, [tab, settings, previewCategory, previewOpts]);

  const lowerThirdLayout = useMemo(
    () => getLowerThirdLayout(settings),
    [settings]
  );

  // ── Handle image upload (bg, box, or logo) ──
  const handleImageUpload = useCallback(
    (field: "backgroundImage" | "boxBackgroundImage" | "logoUrl") => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          patch({ [field]: reader.result as string });
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
    [patch]
  );

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaveError(null);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const normalizedCategories = normalizeCategories(categories);
      const theme: BibleTheme = {
        id: editTheme?.id || uid(),
        name: name.trim(),
        description: description.trim(),
        source: "custom",
        templateType: tab === "fullscreen" ? "fullscreen" : "lower-third",
        category: normalizedCategories[0],
        categories: normalizedCategories,
        settings,
        createdAt: editTheme?.createdAt || now,
        updatedAt: now,
      };
      await saveCustomTheme(theme);
      if (normalizedCategories.length > 1) {
        try {
          addBibleFavorite(theme.id);
        } catch (favoriteErr) {
          console.warn("[ThemeCreatorModal] Saved theme but failed to auto-favorite it:", favoriteErr);
        }
      }
      onSaved(theme);
    } catch (err) {
      console.error("[ThemeCreatorModal] Failed to save theme:", err);
      setSaveError("Could not save this theme. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [name, description, categories, tab, settings, onSaved, editTheme]);

  const applyTransparentLowerThirdPreset = useCallback(() => {
    patch({
      boxBackground: "transparent",
      boxOpacity: 0,
      boxBackgroundImage: "",
      fontColor: "#FFFFFF",
      refFontColor: "#FFFFFF",
      textShadow: "0 2px 12px rgba(0,0,0,0.75)",
    });
  }, [patch]);

  const clearLowerThirdBackground = useCallback(() => {
    patch({
      boxBackground: "transparent",
      boxOpacity: 0,
      boxBackgroundImage: "",
    });
  }, [patch]);

  // ── Render ──
  return (
    <div className="tc-backdrop">
      <div className="tc-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="tc-header">
          <div className="tc-header-left">
            <Icon name={isEditing ? "edit" : "add_circle"} size={22} />
            <h2 className="tc-header-title">{isEditing ? "Edit Theme" : "Create New Theme"}</h2>
          </div>
          <button type="button" className="tc-close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* ── Tab selector ── */}
        <div className="tc-tabs">
          <button
            type="button"
            className={`tc-tab${tab === "fullscreen" ? " tc-tab--active" : ""}`}
            onClick={() => setTab("fullscreen")}
          >
            <Icon name="fullscreen" size={16} />
            Fullscreen
          </button>
          <button
            type="button"
            className={`tc-tab${tab === "lower-third" ? " tc-tab--active" : ""}`}
            onClick={() => setTab("lower-third")}
          >
            <Icon name="call_to_action" size={16} />
            Lower Third
          </button>
        </div>

        {/* ── Body: left panel + right preview ── */}
        <div className="tc-body">
          {/* ── Left: controls ── */}
          <div className="tc-controls">
            {/* ─── Meta section ─── */}
            <section className="tc-section">
              <h3 className="tc-section-title">
                <Icon name="edit" size={14} />
                Details
              </h3>
              <p className="tc-section-desc">{SECTION_DESC.details}</p>
              <label className="tc-label" htmlFor={`${formId}-name`}>
                Theme Name <span className="tc-required">*</span>
              </label>
              <input
                id={`${formId}-name`}
                className="tc-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sunday Worship Dark"
                maxLength={60}
              />

              <label className="tc-label" htmlFor={`${formId}-desc`}>Description</label>
              <textarea
                id={`${formId}-desc`}
                className="tc-input tc-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this theme..."
                rows={2}
                maxLength={200}
              />

              <span className="tc-label">Categories</span>
              <div id={`${formId}-cat`} className="tc-btn-group tc-btn-group--wrap" role="group" aria-label="Theme categories">
                {CATEGORY_OPTIONS.map((option) => {
                  const active = categories.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`tc-btn-seg${active ? " tc-btn-seg--active" : ""}`}
                      onClick={() => toggleCategory(option.value)}
                      aria-pressed={active}
                    >
                      <Icon name={option.icon} size={14} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="tc-section-desc" style={{ marginTop: 10 }}>
                Pick one or more categories. Themes saved to multiple categories are auto-added to dock favorites.
              </p>
            </section>

            {/* ─── Background section ─── */}
            <section className="tc-section">
              <h3 className="tc-section-title">
                <Icon name="image" size={14} />
                Background
              </h3>
              <p className="tc-section-desc">{SECTION_DESC.background}</p>

              {tab === "lower-third" && (
                <div className="tc-upload-row" style={{ marginBottom: 12 }}>
                  <button
                    className="tc-btn tc-btn--outline"
                    type="button"
                    onClick={applyTransparentLowerThirdPreset}
                  >
                    <Icon name="text_fields" size={14} />
                    White Text Only
                  </button>
                  <button
                    className="tc-btn tc-btn--ghost"
                    type="button"
                    onClick={clearLowerThirdBackground}
                  >
                    <Icon name="layers_clear" size={14} />
                    No Background
                  </button>
                </div>
              )}

              <div className="tc-row-2 tc-row-2--collapse">
                <div className="tc-field">
                  <label className="tc-label">
                    {tab === "fullscreen" ? "Background Color" : "Box Background"}
                  </label>
                  <div className="tc-color-row">
                    <input
                      type="color"
                      className="tc-swatch"
                      value={
                        tab === "fullscreen"
                          ? settings.backgroundColor
                          : (settings.boxBackground.startsWith("rgba") || !settings.boxBackground.startsWith("#"))
                            ? "#000000"
                            : settings.boxBackground
                      }
                      onChange={(e) =>
                        patch(
                          tab === "fullscreen"
                            ? { backgroundColor: e.target.value }
                            : { boxBackground: e.target.value }
                        )
                      }
                    />
                    <input
                      type="text"
                      className="tc-input tc-hex"
                      value={
                        tab === "fullscreen"
                          ? settings.backgroundColor
                          : settings.boxBackground
                      }
                      onChange={(e) =>
                        patch(
                          tab === "fullscreen"
                            ? { backgroundColor: e.target.value }
                            : { boxBackground: e.target.value }
                        )
                      }
                      placeholder="#000000"
                    />
                  </div>
                </div>

                <div className="tc-field">
                  <label className="tc-label">Background Image</label>
                  <div className="tc-upload-row">
                    <button
                      type="button"
                      className="tc-btn tc-btn--outline"
                      onClick={() =>
                        handleImageUpload(
                          tab === "fullscreen" ? "backgroundImage" : "boxBackgroundImage"
                        )
                      }
                    >
                      <Icon name="upload" size={14} />
                      Upload Image
                    </button>
                    {(tab === "fullscreen" ? settings.backgroundImage : settings.boxBackgroundImage) && (
                      <button
                        type="button"
                        className="tc-btn tc-btn--ghost"
                        onClick={() =>
                          patch(
                            tab === "fullscreen"
                              ? { backgroundImage: "" }
                              : { boxBackgroundImage: "" }
                          )
                        }
                      >
                        <Icon name="close" size={14} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {(tab === "fullscreen" ? settings.backgroundImage : settings.boxBackgroundImage) && (
                <div className="tc-img-preview">
                  <img
                    src={tab === "fullscreen" ? settings.backgroundImage : settings.boxBackgroundImage}
                    alt="Background preview"
                  />
                </div>
              )}

              {/* Background opacity */}
              {tab === "fullscreen" && (
                <>
                  <label className="tc-label">Background Opacity</label>
                  <div className="tc-slider-row">
                    <input
                      type="range"
                      className="tc-range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.backgroundOpacity}
                      onChange={(e) => patch({ backgroundOpacity: parseFloat(e.target.value) })}
                    />
                    <span className="tc-range-value">{Math.round(settings.backgroundOpacity * 100)}%</span>
                  </div>
                </>
              )}

              {/* Box opacity (lower-third) */}
              {tab === "lower-third" && (
                <>
                  <label className="tc-label">Box Opacity</label>
                  <div className="tc-slider-row">
                    <input
                      type="range"
                      className="tc-range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.boxOpacity}
                      onChange={(e) => patch({ boxOpacity: parseFloat(e.target.value) })}
                    />
                    <span className="tc-range-value">{Math.round(settings.boxOpacity * 100)}%</span>
                  </div>
                </>
              )}

              {/* Shade overlay (fullscreen) */}
              {tab === "fullscreen" && (
                <>
                  <label className="tc-label tc-label--row">
                    <input
                      type="checkbox"
                      checked={settings.fullscreenShadeEnabled}
                      onChange={(e) => patch({ fullscreenShadeEnabled: e.target.checked })}
                    />
                    Readability Shade
                  </label>
                  {settings.fullscreenShadeEnabled && (
                    <div className="tc-color-row">
                      <input
                        type="color"
                        className="tc-swatch"
                        value={settings.fullscreenShadeColor}
                        onChange={(e) => patch({ fullscreenShadeColor: e.target.value })}
                      />
                      <input
                        type="range"
                        className="tc-range tc-range--inline"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.fullscreenShadeOpacity}
                        onChange={(e) => patch({ fullscreenShadeOpacity: parseFloat(e.target.value) })}
                      />
                      <span className="tc-range-value">{Math.round(settings.fullscreenShadeOpacity * 100)}%</span>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ─── Logo / Branding section (fullscreen only) ─── */}
            {tab === "fullscreen" && (
              <section className="tc-section">
                <h3 className="tc-section-title">
                  <Icon name="branding_watermark" size={14} />
                  Logo / Branding
                </h3>
                <p className="tc-section-desc">{SECTION_DESC.logo}</p>

                <label className="tc-label">Logo Image</label>
                <div className="tc-upload-row">
                  <button
                    className="tc-btn tc-btn--outline"
                    onClick={() => handleImageUpload("logoUrl")}
                  >
                    <Icon name="upload" size={14} />
                    Upload Logo
                  </button>
                  {settings.logoUrl && (
                    <button
                      className="tc-btn tc-btn--ghost"
                      onClick={() => patch({ logoUrl: "" })}
                    >
                      <Icon name="close" size={14} />
                      Remove
                    </button>
                  )}
                </div>
                {settings.logoUrl && (
                  <div className="tc-img-preview tc-img-preview--logo">
                    <img src={settings.logoUrl} alt="Logo preview" />
                  </div>
                )}

                <label className="tc-label">Position</label>
                <div className="tc-btn-group tc-btn-group--wrap">
                  {LOGO_POSITIONS.map((lp) => (
                    <button
                      key={lp.value}
                      className={`tc-btn-seg${settings.logoPosition === lp.value ? " tc-btn-seg--active" : ""}`}
                      onClick={() => patch({ logoPosition: lp.value })}
                    >
                      <Icon name={lp.icon} size={14} />
                      {lp.label}
                    </button>
                  ))}
                </div>

                <label className="tc-label">Logo Size</label>
                <div className="tc-slider-row">
                  <input
                    type="range"
                    className="tc-range"
                    min={20}
                    max={200}
                    step={5}
                    value={settings.logoSize}
                    onChange={(e) => patch({ logoSize: parseInt(e.target.value) })}
                  />
                  <span className="tc-range-value">{settings.logoSize}px</span>
                </div>
              </section>
            )}

            {/* ─── Typography section ─── */}
            <section className="tc-section">
              <h3 className="tc-section-title">
                <Icon name="text_fields" size={14} />
                Typography
              </h3>
              <p className="tc-section-desc">{SECTION_DESC.typography}</p>

              {/* Font family */}
              <label className="tc-label">Font Family</label>
              <select
                className="tc-input tc-select"
                value={settings.fontFamily}
                onChange={(e) => patch({ fontFamily: e.target.value })}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {FONT_FAMILY_LABELS[f] || f}
                  </option>
                ))}
              </select>

              {/* Font size + weight */}
              <div className="tc-row-2">
                <div className="tc-field">
                  <label className="tc-label">Font Size</label>
                  <div className="tc-input-group">
                    <input
                      type="number"
                      className="tc-input"
                      value={settings.fontSize}
                      min={12}
                      max={120}
                      onChange={(e) => patch({ fontSize: parseInt(e.target.value) || 48 })}
                    />
                    <span className="tc-input-suffix">px</span>
                  </div>
                </div>
                <div className="tc-field">
                  <label className="tc-label">Weight</label>
                  <select
                    className="tc-input tc-select"
                    value={settings.fontWeight}
                    onChange={(e) => patch({ fontWeight: e.target.value as BibleThemeSettings["fontWeight"] })}
                  >
                    <option value="light">Light</option>
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
              </div>

              {/* Font color */}
              <label className="tc-label">Text Color</label>
              <div className="tc-color-row">
                <input
                  type="color"
                  className="tc-swatch"
                  value={settings.fontColor}
                  onChange={(e) => patch({ fontColor: e.target.value })}
                />
                <input
                  type="text"
                  className="tc-input tc-hex"
                  value={settings.fontColor}
                  onChange={(e) => patch({ fontColor: e.target.value })}
                  placeholder="#FFFFFF"
                />
              </div>

              {/* Line height */}
              <label className="tc-label">Line Height</label>
              <div className="tc-slider-row">
                <input
                  type="range"
                  className="tc-range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={settings.lineHeight}
                  onChange={(e) => patch({ lineHeight: parseFloat(e.target.value) })}
                />
                <span className="tc-range-value">{settings.lineHeight.toFixed(1)}</span>
              </div>

              {/* Text align */}
              <label className="tc-label">Text Align</label>
              <div className="tc-btn-group">
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    className={`tc-btn-seg${settings.textAlign === align ? " tc-btn-seg--active" : ""}`}
                    onClick={() => patch({ textAlign: align })}
                  >
                    <Icon name={`format_align_${align}`} size={16} />
                  </button>
                ))}
              </div>

              {/* Text transform */}
              <label className="tc-label">Text Transform</label>
              <select
                className="tc-input tc-select"
                value={settings.textTransform}
                onChange={(e) =>
                  patch({ textTransform: e.target.value as BibleThemeSettings["textTransform"] })
                }
              >
                <option value="none">None</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="lowercase">lowercase</option>
                <option value="capitalize">Capitalize</option>
              </select>

              {/* Text shadow visual builder */}
              <label className="tc-label">Text Shadow</label>
              {(() => {
                const sh = parseShadow(settings.textShadow);
                const update = (field: string, val: number | string) => {
                  const next = { ...sh, [field]: val };
                  patch({ textShadow: buildShadowCss(next.x, next.y, next.blur, next.color) });
                };
                return (
                  <div className="tc-shadow-builder">
                    <div className="tc-shadow-row">
                      <div className="tc-field">
                        <label className="tc-label">X</label>
                        <div className="tc-input-group">
                          <input
                            type="number"
                            className="tc-input"
                            value={sh.x}
                            min={-20}
                            max={20}
                            onChange={(e) => update("x", parseInt(e.target.value) || 0)}
                          />
                          <span className="tc-input-suffix">px</span>
                        </div>
                      </div>
                      <div className="tc-field">
                        <label className="tc-label">Y</label>
                        <div className="tc-input-group">
                          <input
                            type="number"
                            className="tc-input"
                            value={sh.y}
                            min={-20}
                            max={20}
                            onChange={(e) => update("y", parseInt(e.target.value) || 0)}
                          />
                          <span className="tc-input-suffix">px</span>
                        </div>
                      </div>
                      <div className="tc-field">
                        <label className="tc-label">Blur</label>
                        <div className="tc-input-group">
                          <input
                            type="number"
                            className="tc-input"
                            value={sh.blur}
                            min={0}
                            max={50}
                            onChange={(e) => update("blur", parseInt(e.target.value) || 0)}
                          />
                          <span className="tc-input-suffix">px</span>
                        </div>
                      </div>
                    </div>
                    <div className="tc-shadow-color-row">
                      <label className="tc-label">Shadow Color</label>
                      <div className="tc-color-row">
                        <input
                          type="color"
                          className="tc-swatch"
                          value={sh.color.startsWith("#") ? sh.color : "#000000"}
                          onChange={(e) => update("color", hexToRgba(e.target.value, 0.6))}
                        />
                        <input
                          type="text"
                          className="tc-input tc-hex"
                          value={sh.color}
                          onChange={(e) => update("color", e.target.value)}
                          placeholder="rgba(0,0,0,0.6)"
                        />
                      </div>
                    </div>
                    <button
                      className="tc-btn tc-btn--ghost tc-btn--sm"
                      onClick={() => patch({ textShadow: "none" })}
                    >
                      No Shadow
                    </button>
                  </div>
                );
              })()}

              {/* Text outline */}
              <label className="tc-label tc-label--row">
                <input
                  type="checkbox"
                  checked={settings.textOutline}
                  onChange={(e) => patch({ textOutline: e.target.checked })}
                />
                Text Outline
              </label>
              {settings.textOutline && (
                <div className="tc-color-row">
                  <input
                    type="color"
                    className="tc-swatch"
                    value={settings.textOutlineColor}
                    onChange={(e) => patch({ textOutlineColor: e.target.value })}
                  />
                  <input
                    type="number"
                    className="tc-input tc-hex"
                    value={settings.textOutlineWidth}
                    min={0}
                    max={10}
                    onChange={(e) => patch({ textOutlineWidth: parseInt(e.target.value) || 0 })}
                  />
                  <span className="tc-range-value">px</span>
                </div>
              )}
            </section>

            {/* ─── Reference / subtitle section ─── */}
            <section className="tc-section">
              <h3 className="tc-section-title">
                <Icon name="format_quote" size={14} />
                {previewCategory === "bible"
                  ? "Reference Label"
                  : previewCategory === "worship"
                    ? "Song Info Label"
                    : "Subtitle Label"}
              </h3>
              <p className="tc-section-desc">{SECTION_DESC.reference}</p>
              <div className="tc-row-2">
                <div className="tc-field">
                  <label className="tc-label">Size</label>
                  <div className="tc-input-group">
                    <input
                      type="number"
                      className="tc-input"
                      value={settings.refFontSize}
                      min={8}
                      max={60}
                      onChange={(e) => patch({ refFontSize: parseInt(e.target.value) || 24 })}
                    />
                    <span className="tc-input-suffix">px</span>
                  </div>
                </div>
                <div className="tc-field">
                  <label className="tc-label">Weight</label>
                  <select
                    className="tc-input tc-select"
                    value={settings.refFontWeight}
                    onChange={(e) =>
                      patch({ refFontWeight: e.target.value as BibleThemeSettings["refFontWeight"] })
                    }
                  >
                    <option value="light">Light</option>
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
              </div>

              <label className="tc-label">Ref Color</label>
              <div className="tc-color-row">
                <input
                  type="color"
                  className="tc-swatch"
                  value={settings.refFontColor}
                  onChange={(e) => patch({ refFontColor: e.target.value })}
                />
                <input
                  type="text"
                  className="tc-input tc-hex"
                  value={settings.refFontColor}
                  onChange={(e) => patch({ refFontColor: e.target.value })}
                  placeholder="#cccccc"
                />
              </div>

              <label className="tc-label">Position</label>
              <div className="tc-btn-group">
                <button
                  className={`tc-btn-seg${settings.refPosition === "top" ? " tc-btn-seg--active" : ""}`}
                  onClick={() => patch({ refPosition: "top" })}
                >
                  {previewCategory === "bible" ? "Above verse" : "Above text"}
                </button>
                <button
                  className={`tc-btn-seg${settings.refPosition === "bottom" ? " tc-btn-seg--active" : ""}`}
                  onClick={() => patch({ refPosition: "bottom" })}
                >
                  {previewCategory === "bible" ? "Below verse" : "Below text"}
                </button>
              </div>
            </section>

            {/* ─── Spacing section ─── */}
            <section className="tc-section">
              <h3 className="tc-section-title">
                <Icon name="space_bar" size={14} />
                Spacing &amp; Layout
              </h3>
              <p className="tc-section-desc">{SECTION_DESC.spacing}</p>

              <div className="tc-row-2">
                <div className="tc-field">
                  <label className="tc-label">Padding</label>
                  <div className="tc-input-group">
                    <input
                      type="number"
                      className="tc-input"
                      value={settings.padding}
                      min={0}
                      max={200}
                      onChange={(e) => patch({ padding: parseInt(e.target.value) || 0 })}
                    />
                    <span className="tc-input-suffix">px</span>
                  </div>
                </div>
                <div className="tc-field">
                  <label className="tc-label">Safe Area</label>
                  <div className="tc-input-group">
                    <input
                      type="number"
                      className="tc-input"
                      value={settings.safeArea}
                      min={0}
                      max={200}
                      onChange={(e) => patch({ safeArea: parseInt(e.target.value) || 0 })}
                    />
                    <span className="tc-input-suffix">px</span>
                  </div>
                </div>
              </div>

              <div className="tc-row-2">
                <div className="tc-field">
                  <label className="tc-label">Border Radius</label>
                  <div className="tc-input-group">
                    <input
                      type="number"
                      className="tc-input"
                      value={settings.borderRadius}
                      min={0}
                      max={60}
                      onChange={(e) => patch({ borderRadius: parseInt(e.target.value) || 0 })}
                    />
                    <span className="tc-input-suffix">px</span>
                  </div>
                </div>
                {tab === "lower-third" && (
                  <div className="tc-field">
                    <label className="tc-label">Bar Size</label>
                    <select
                      className="tc-input tc-select"
                      value={settings.lowerThirdSize}
                      onChange={(e) =>
                        patch({ lowerThirdSize: e.target.value as LowerThirdSize })
                      }
                    >
                      {LT_SIZES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {tab === "lower-third" && (
                <>
                  <label className="tc-label">Bar Width</label>
                  <div className="tc-btn-group tc-btn-group--wrap">
                    {LT_WIDTHS.map((option) => (
                      <button
                        key={option.value}
                        className={`tc-btn-seg${settings.lowerThirdWidthPreset === option.value ? " tc-btn-seg--active" : ""}`}
                        onClick={() => patch({ lowerThirdWidthPreset: option.value })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="tc-section-desc" style={{ marginTop: 10 }}>
                    Full width is the default. Smaller presets pull the bar in equally from both sides before any drag shift is applied.
                  </p>

                  <label className="tc-label">Bar Position</label>
                  <div className="tc-btn-group tc-btn-group--wrap">
                    {LT_POSITIONS.map((option) => (
                      <button
                        key={option.value}
                        className={`tc-btn-seg${settings.lowerThirdPosition === option.value ? " tc-btn-seg--active" : ""}`}
                        onClick={() => patch({ lowerThirdPosition: option.value })}
                      >
                        <Icon name={option.icon} size={14} />
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="tc-row-2" style={{ marginTop: 12 }}>
                    <div className="tc-field">
                      <label className="tc-label">Horizontal Shift</label>
                      <div className="tc-input-group">
                        <input
                          type="number"
                          className="tc-input"
                          value={settings.lowerThirdOffsetX}
                          min={lowerThirdLayout.minOffset}
                          max={lowerThirdLayout.maxOffset}
                          onChange={(e) =>
                            patch({ lowerThirdOffsetX: parseInt(e.target.value, 10) || 0 })
                          }
                        />
                        <span className="tc-input-suffix">px</span>
                      </div>
                    </div>
                    <div className="tc-field">
                      <label className="tc-label">Bar Width</label>
                      <p className="tc-section-desc" style={{ marginTop: 8 }}>
                        Active width: {Math.round(lowerThirdLayout.barWidth)}px
                      </p>
                      <p className="tc-section-desc">
                        Shift range: {lowerThirdLayout.minOffset}px to {lowerThirdLayout.maxOffset}px
                      </p>
                    </div>
                  </div>

                  <label className="tc-label">Bar Height</label>
                  <div className="tc-input-group">
                    <input
                      type="number"
                      className="tc-input"
                      value={settings.lowerThirdHeight}
                      min={0}
                      max={800}
                      onChange={(e) => patch({ lowerThirdHeight: parseInt(e.target.value) || 0 })}
                    />
                    <span className="tc-input-suffix">px</span>
                  </div>
                  <p className="tc-section-desc" style={{ marginTop: 10 }}>
                    Use <strong>0px</strong> for auto height, or raise it to make the background bar taller.
                  </p>
                </>
              )}
            </section>

            {/* ─── Animation section ─── */}
            <section className="tc-section">
              <h3 className="tc-section-title">
                <Icon name="animation" size={14} />
                Animation
              </h3>
              <p className="tc-section-desc">{SECTION_DESC.animation}</p>

              <label className="tc-label">Entrance Style</label>
              <div className="tc-btn-group tc-btn-group--wrap">
                {ANIMATIONS.map((a) => (
                  <button
                    key={a.value}
                    className={`tc-btn-seg${settings.animation === a.value ? " tc-btn-seg--active" : ""}`}
                    onClick={() => patch({ animation: a.value })}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <label className="tc-label">Duration</label>
              <div className="tc-slider-row">
                <input
                  type="range"
                  className="tc-range"
                  min={100}
                  max={2000}
                  step={50}
                  value={settings.animationDuration}
                  onChange={(e) => patch({ animationDuration: parseInt(e.target.value) })}
                />
                <span className="tc-range-value">{settings.animationDuration}ms</span>
              </div>
              <p className="tc-section-desc" style={{ marginTop: 10 }}>
                Entrance animation runs only when the overlay first appears. Verse or stanza updates keep the background stable and only update the text.
              </p>
            </section>
          </div>

          {/* ── Right: live preview ── */}
          <div className="tc-preview-pane">
            <div className="tc-preview-label">
              <Icon name="visibility" size={14} />
              Live Preview
              <span className="tc-preview-actions">
                {settings.animation !== "none" && (
                  <button
                    className="tc-replay-btn"
                    onClick={() => { animKeyRef.current += 1; patch({}); }}
                    title="Replay entrance animation"
                  >
                    <Icon name="replay" size={14} />
                    Replay
                  </button>
                )}
                {/* Settings gear — category-specific preview toggles */}
                <div className="tc-pvs-wrap">
                  <button
                    className="tc-pvs-trigger"
                    onClick={() => setShowPreviewSettings((v) => !v)}
                    title="Preview display settings"
                  >
                    <Icon name="tune" size={14} />
                  </button>
                  {showPreviewSettings && (
                    <div className="tc-pvs-popover">
                      <div className="tc-pvs-header">
                        <span className="tc-pvs-title">
                          <Icon name="tune" size={12} />
                          Preview Options
                        </span>
                        <button
                          className="tc-pvs-close"
                          onClick={() => setShowPreviewSettings(false)}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </div>

                      {/* ── Verse / lyrics text toggle ── */}
                      <label className="tc-pvs-row">
                        <span className="tc-pvs-row-label">
                          {previewCategory === "bible"
                            ? "Show verse text"
                            : previewCategory === "worship"
                              ? "Show lyrics"
                              : "Show body text"}
                        </span>
                        <input
                          type="checkbox"
                          className="tc-pvs-toggle"
                          checked={previewOpts.showVerse}
                          onChange={(e) =>
                            setPreviewOpts((p) => ({ ...p, showVerse: e.target.checked }))
                          }
                        />
                      </label>

                      {/* ── Reference / author toggle ── */}
                      <label className="tc-pvs-row">
                        <span className="tc-pvs-row-label">
                          {previewCategory === "bible"
                            ? "Show reference"
                            : previewCategory === "worship"
                              ? "Show author / song info"
                              : "Show subtitle"}
                        </span>
                        <input
                          type="checkbox"
                          className="tc-pvs-toggle"
                          checked={previewOpts.showRef}
                          onChange={(e) =>
                            setPreviewOpts((p) => ({ ...p, showRef: e.target.checked }))
                          }
                        />
                      </label>

                      {/* ── Abbreviate book names (bible only) ── */}
                      {previewCategory === "bible" && (
                        <label className="tc-pvs-row">
                          <span className="tc-pvs-row-label">Abbreviate book names</span>
                          <input
                            type="checkbox"
                            className="tc-pvs-toggle"
                            checked={previewOpts.abbreviateBooks}
                            onChange={(e) =>
                              setPreviewOpts((p) => ({
                                ...p,
                                abbreviateBooks: e.target.checked,
                              }))
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </span>
            </div>
            <div className={`tc-preview-stage${tab === "lower-third" ? " tc-preview-stage--lt" : ""}`}>
              <iframe
                key={animKeyRef.current}
                className="tc-preview-iframe"
                title="Theme preview"
                srcDoc={previewHtml}
                sandbox="allow-same-origin"
              />
            </div>
            <p className="tc-preview-hint">
              {previewCategory === "bible" && "Previewing: Bible verse overlay"}
              {previewCategory === "worship" && "Previewing: Worship lyrics overlay"}
              {previewCategory === "general" && "Previewing: Announcement overlay"}
            </p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="tc-footer">
          {saveError && (
            <p
              style={{
                margin: 0,
                marginRight: "auto",
                color: "#fca5a5",
                fontSize: 11,
                fontWeight: 600,
              }}
              role="alert"
            >
              {saveError}
            </p>
          )}
          <button type="button" className="tc-btn tc-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tc-btn tc-btn--primary"
            disabled={!name.trim() || saving}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Icon name="hourglass_empty" size={16} />
                Saving…
              </>
            ) : (
              <>
                <Icon name="save" size={16} />
                {isEditing ? "Update Theme" : "Save Theme"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
