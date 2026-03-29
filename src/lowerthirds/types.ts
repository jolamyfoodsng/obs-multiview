/**
 * types.ts — Lower Third Themes type system
 *
 * Defines the data model for broadcast graphic overlay themes.
 * Each theme is an HTML template with CSS, variable placeholders,
 * and animation definitions.
 *
 * Themes are classified into categories:
 *   - "bible"   → Has scripture/verse fields (used in Bible module)
 *   - "worship" → Used for worship lyrics, speaker names, announcements
 *   - "general" → General-purpose broadcast graphics
 */

// ---------------------------------------------------------------------------
// Variable Definitions — editable fields per theme
// ---------------------------------------------------------------------------

export type LTVariableType = "text" | "number" | "color" | "select" | "toggle" | "list";

export interface LTVariable {
  /** Unique key used in the template as {{key}} */
  key: string;
  /** Human-readable label for the UI */
  label: string;
  /** Input type */
  type: LTVariableType;
  /** Default value */
  defaultValue: string;
  /** Placeholder text for text inputs */
  placeholder?: string;
  /** Options for select type */
  options?: { label: string; value: string }[];
  /** Whether this field is required */
  required?: boolean;
  /** Max length for text inputs */
  maxLength?: number;
  /** Group label for organizing variables in the UI */
  group?: string;
  /** Separator used to join list items (for type "list"). Defaults to " • " */
  separator?: string;
}

// ---------------------------------------------------------------------------
// Theme Category
// ---------------------------------------------------------------------------

export type LTCategory = "bible" | "worship" | "general";

// ---------------------------------------------------------------------------
// Size Options
// ---------------------------------------------------------------------------

export type LTSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/** Scale factor for each size option (used for transform fallback) */
export const LT_SIZE_SCALE: Record<LTSize, number> = {
  sm:  0.75,
  md:  0.9,
  lg:  1.1,
  xl:  1.35,
  "2xl": 1.6,
  "3xl": 1.85,
};

/** Width percentage for each size — how much of the 1920px canvas the LT fills */
export const LT_SIZE_WIDTH: Record<LTSize, number> = {
  sm:   40,
  md:   55,
  lg:   70,
  xl:   82,
  "2xl": 93,
  "3xl": 100,
};

/** Font scale factor for each size — multiplied against base font sizes */
export const LT_SIZE_FONT_SCALE: Record<LTSize, number> = {
  sm:   0.85,
  md:   1.0,
  lg:   1.15,
  xl:   1.35,
  "2xl": 1.55,
  "3xl": 1.75,
};

/** Display labels for size options */
export const LT_SIZE_LABELS: Record<LTSize, string> = {
  sm:  "S",
  md:  "M",
  lg:  "L",
  xl:  "XL",
  "2xl": "2XL",
  "3xl": "3XL",
};

/** All sizes in order */
export const LT_SIZES: LTSize[] = ["sm", "lg", "xl", "3xl"];

// ---------------------------------------------------------------------------
// Font Size Override — independent of the Size control
// ---------------------------------------------------------------------------

export type LTFontSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

export const LT_FONT_SIZES: LTFontSize[] = ["sm", "md", "lg", "xl"];

export const LT_FONT_SIZE_LABELS: Record<LTFontSize, string> = {
  xs:  "XS",
  sm:  "S",
  md:  "M",
  lg:  "L",
  xl:  "XL",
  "2xl": "2XL",
  "3xl": "3XL",
};

/** Font scale multiplier for each font-size option */
export const LT_FONT_SIZE_SCALE: Record<LTFontSize, number> = {
  xs:  0.75,
  sm:  0.9,
  md:  1.1,
  lg:  1.3,
  xl:  1.55,
  "2xl": 1.8,
  "3xl": 2.1,
};

// ---------------------------------------------------------------------------
// Position Options
// ---------------------------------------------------------------------------

export type LTPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-center" | "top-right" | "center" | "custom";

export const LT_POSITIONS: LTPosition[] = [
  "bottom-left", "bottom-center", "bottom-right",
  "top-left", "top-center", "top-right",
  "center",
];

export const LT_POSITION_LABELS: Record<LTPosition, string> = {
  "bottom-left": "Bottom Left",
  "bottom-center": "Bottom Center",
  "bottom-right": "Bottom Right",
  "top-left": "Top Left",
  "top-center": "Top Center",
  "top-right": "Top Right",
  "center": "Center",
  "custom": "Custom",
};

export const LT_POSITION_ICONS: Record<LTPosition, string> = {
  "bottom-left": "south_west",
  "bottom-center": "south",
  "bottom-right": "south_east",
  "top-left": "north_west",
  "top-center": "north",
  "top-right": "north_east",
  "center": "center_focus_strong",
  "custom": "open_with",
};

// ---------------------------------------------------------------------------
// Animation In Options
// ---------------------------------------------------------------------------

export type LTAnimationIn =
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "fade-in"
  | "fade-up"
  | "fade-down"
  | "zoom-in"
  | "bounce-in"
  | "flip-in"
  | "blur-in"
  | "none";

export const LT_ANIMATIONS_IN: LTAnimationIn[] = [
  "slide-left", "slide-right", "slide-up", "slide-down",
  "fade-in", "fade-up", "fade-down",
  "zoom-in", "bounce-in", "flip-in", "blur-in",
  "none",
];

export const LT_ANIMATION_LABELS: Record<LTAnimationIn, string> = {
  "slide-left": "Slide Left",
  "slide-right": "Slide Right",
  "slide-up": "Slide Up",
  "slide-down": "Slide Down",
  "fade-in": "Fade In",
  "fade-up": "Fade Up",
  "fade-down": "Fade Down",
  "zoom-in": "Zoom In",
  "bounce-in": "Bounce In",
  "flip-in": "Flip In",
  "blur-in": "Blur In",
  "none": "None",
};

export const LT_ANIMATION_ICONS: Record<LTAnimationIn, string> = {
  "slide-left": "arrow_forward",
  "slide-right": "arrow_back",
  "slide-up": "arrow_upward",
  "slide-down": "arrow_downward",
  "fade-in": "blur_on",
  "fade-up": "north",
  "fade-down": "south",
  "zoom-in": "zoom_in",
  "bounce-in": "sports_basketball",
  "flip-in": "flip",
  "blur-in": "blur_circular",
  "none": "block",
};

// ---------------------------------------------------------------------------
// Custom Style Overrides — user-customisable appearance per instance
// ---------------------------------------------------------------------------

export interface LTCustomStyle {
  /** Override background color (CSS color value) */
  bgColor: string;
  /** Override primary text color */
  textColor: string;
  /** Override accent / highlight color (borders, tags, icons, gradients) */
  accentColor: string;
  /** Background image URL — replaces background color when set */
  bgImage: string;
  /** Background image opacity (0–1, blended over bgColor) */
  bgImageOpacity: number;
  /** Height override in px (0 = auto/theme default) */
  heightPx: number;
  /** Logo scale multiplier for branded lower-thirds */
  logoScale: number;
}

/** Default custom style — empty = use theme defaults */
export const LT_DEFAULT_CUSTOM_STYLE: LTCustomStyle = {
  bgColor: "",
  textColor: "",
  accentColor: "",
  bgImage: "",
  bgImageOpacity: 0.3,
  heightPx: 0,
  logoScale: 1.2,
};

// ---------------------------------------------------------------------------
// Animation Definition
// ---------------------------------------------------------------------------

export interface LTAnimation {
  /** CSS animation name (keyframe name) */
  name: string;
  /** Duration in ms */
  duration: number;
  /** CSS timing function */
  easing: string;
  /** Delay in ms */
  delay?: number;
}

// ---------------------------------------------------------------------------
// Lower Third Theme
// ---------------------------------------------------------------------------

export interface LowerThirdTheme {
  /** Unique theme ID (e.g., "lt-01-scripture-bold") */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Theme category for classification */
  category: LTCategory;
  /** Material icon name for the theme */
  icon: string;
  /** HTML template with {{variable}} placeholders */
  html: string;
  /** CSS styles including animations (injected into overlay) */
  css: string;
  /** Editable variable definitions */
  variables: LTVariable[];
  /** Default animation applied to the root element */
  animation?: LTAnimation;
  /** Preview accent color for theme cards */
  accentColor: string;
  /** Tags for search/filtering */
  tags: string[];
  /** Whether this theme requires Tailwind CSS */
  usesTailwind: boolean;
  /** External font imports needed (Google Fonts URLs) */
  fontImports?: string[];
}

// ---------------------------------------------------------------------------
// Lower Third Instance — a theme with values filled in
// ---------------------------------------------------------------------------

export interface LTInstance {
  /** Unique instance ID */
  id: string;
  /** Theme ID reference */
  themeId: string;
  /** Current variable values (key → value) */
  values: Record<string, string>;
  /** Whether this instance is currently live on OBS */
  isLive: boolean;
  /** OBS source name this instance is pushed to (if any) */
  obsSourceName?: string;
  /** Timestamp of last update */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// OBS Lower Third Source info
// ---------------------------------------------------------------------------

export interface LTObsSource {
  /** OBS input name */
  inputName: string;
  /** OBS input kind (should be "browser_source") */
  inputKind: string;
  /** Whether it was created by OCS */
  isOcsManaged: boolean;
  /** Current theme ID if known */
  themeId?: string;
}

// ---------------------------------------------------------------------------
// Store State
// ---------------------------------------------------------------------------

export interface LTState {
  /** All available themes */
  themes: LowerThirdTheme[];
  /** Active instance being edited */
  activeInstance: LTInstance | null;
  /** All known OBS lower-third sources */
  obsSources: LTObsSource[];
  /** Whether the panel is sending */
  isSending: boolean;
  /** Last error message */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Duration + Auto-Clear
// ---------------------------------------------------------------------------

/** How the lower third is triggered to clear */
export type LTTriggerMode = "timed" | "manual" | "untilNext" | "untilSceneChange";

export const LT_TRIGGER_MODES: LTTriggerMode[] = ["timed", "manual", "untilNext", "untilSceneChange"];

export const LT_TRIGGER_MODE_LABELS: Record<LTTriggerMode, string> = {
  timed: "Timed",
  manual: "Manual",
  untilNext: "Until Next LT",
  untilSceneChange: "Until Scene Changes",
};

/** Exit animation style for auto-clear */
export type LTExitStyle = "fade" | "slideDown" | "cut";

export const LT_EXIT_STYLES: LTExitStyle[] = ["fade", "slideDown", "cut"];

export const LT_EXIT_STYLE_LABELS: Record<LTExitStyle, string> = {
  fade: "Fade Out",
  slideDown: "Slide Down",
  cut: "Cut",
};

/** Maps exit style to the CSS class used in the overlay */
export const LT_EXIT_STYLE_CSS: Record<LTExitStyle, string> = {
  fade: "exit-fade-in",
  slideDown: "exit-slide-down",
  cut: "exit-none",
};

/** Lower third content type — used for default durations */
export type LTType = "speaker" | "scripture" | "announcement" | "generic";

export const LT_TYPES: LTType[] = ["speaker", "scripture", "announcement", "generic"];

export const LT_TYPE_LABELS: Record<LTType, string> = {
  speaker: "Speaker",
  scripture: "Scripture",
  announcement: "Announcement",
  generic: "Generic",
};

/** Duration preset chips (seconds) */
export const LT_DURATION_CHIPS: number[] = [5, 8, 10, 15, 20];

/** Per-LT duration configuration */
export interface LTDurationConfig {
  /** Duration in seconds (0 = pinned / infinite) */
  durationSeconds: number;
  /** How the LT is triggered to clear */
  triggerMode: LTTriggerMode;
  /** Exit animation style */
  exitStyle: LTExitStyle;
  /** Whether to use global defaults instead of per-LT settings */
  useDefaults: boolean;
  /** Whether this LT is pinned (ignores timer) */
  isPinned: boolean;
}

/** Default per-LT duration config */
export const LT_DEFAULT_DURATION_CONFIG: LTDurationConfig = {
  durationSeconds: 10,
  triggerMode: "timed",
  exitStyle: "fade",
  useDefaults: true,
  isPinned: false,
};

/** Global defaults for duration per LT type */
export interface LTGlobalDefaults {
  /** Default duration per type (seconds) */
  durations: Record<LTType, number>;
  /** Default exit style */
  exitStyle: LTExitStyle;
  /** Default trigger mode */
  triggerMode: LTTriggerMode;
  /** Whether to auto-clear when switching sections/tabs */
  autoClearOnSectionChange: boolean;
}

/** Factory defaults for global settings */
export const LT_DEFAULT_GLOBAL_DEFAULTS: LTGlobalDefaults = {
  durations: {
    speaker: 8,
    scripture: 20,
    announcement: 15,
    generic: 10,
  },
  exitStyle: "fade",
  triggerMode: "timed",
  autoClearOnSectionChange: true,
};

/** State of the currently active (live) lower third */
export interface LTActiveState {
  /** ID of the active lower third (preset ID or "current") */
  activeLowerThirdId: string | null;
  /** Display label of the active LT */
  activeLabel: string;
  /** Display subtitle of the active LT (first value or theme name) */
  activeSubtitle: string;
  /** Theme ID of the active LT */
  activeThemeId: string | null;
  /** When the LT was shown */
  shownAt: number;
  /** Total duration in seconds (0 = infinite) */
  totalDuration: number;
  /** Remaining seconds (counts down) */
  remainingSeconds: number;
  /** Whether the LT is currently pinned */
  isPinned: boolean;
  /** Trigger mode of the active LT */
  triggerMode: LTTriggerMode;
  /** Exit style of the active LT */
  exitStyle: LTExitStyle;
  /** Whether it's actually visible in OBS */
  isVisible: boolean;
  /** The last LT ID that was shown (for re-show) */
  lastShownLowerThirdId: string | null;
  /** Values snapshot for re-show */
  lastShownValues: Record<string, string>;
  /** Theme ID snapshot for re-show */
  lastShownThemeId: string | null;
}

/** Default active state (nothing showing) */
export const LT_DEFAULT_ACTIVE_STATE: LTActiveState = {
  activeLowerThirdId: null,
  activeLabel: "",
  activeSubtitle: "",
  activeThemeId: null,
  shownAt: 0,
  totalDuration: 0,
  remainingSeconds: 0,
  isPinned: false,
  triggerMode: "timed",
  exitStyle: "fade",
  isVisible: false,
  lastShownLowerThirdId: null,
  lastShownValues: {},
  lastShownThemeId: null,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** OBS source name prefix for OCS-managed lower-third sources */
export const LT_SOURCE_PREFIX = "OCS_LT_";

/** OBS scene name for the lower-third overlay scene */
export const LT_SCENE_NAME = "OCS Lower Thirds";

/** Pattern to match MV-created lower-third sources */
export const MV_LT_PATTERN = /^MV_.+_LT:/;

/** Pattern to match OCS-managed lower-third sources */
export const OCS_LT_PATTERN = /^OCS_LT_/;

/** Pattern to match OCS Bible lower-third sources (created by Bible module LT mode) */
export const OCS_BIBLE_LT_PATTERN = /^OCS_BibleLT_/;
