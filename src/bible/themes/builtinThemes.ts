/**
 * builtinThemes.ts — Built-in Bible overlay themes
 *
 * Two default themes shipped with the app:
 * 1. Classic Dark — dark background, white text, centered, subtle shadow
 * 2. Modern Light — light blurred background, dark text, lower-third style
 */

import type { BibleTheme, BibleThemeSettings } from "../types";
import { DEFAULT_THEME_SETTINGS } from "../types";

// ---------------------------------------------------------------------------
// Classic Dark
// ---------------------------------------------------------------------------

const classicDarkSettings: BibleThemeSettings = {
  ...DEFAULT_THEME_SETTINGS,
  fontFamily: '"CMG Sans", sans-serif',
  fontSize: 52,
  fontWeight: "normal",
  fontColor: "#FFFFFF",
  lineHeight: 1.7,
  textAlign: "center",
  textShadow: "0 2px 12px rgba(0,0,0,0.8)",
  textOutline: false,
  textOutlineColor: "#000000",
  textOutlineWidth: 0,

  refFontSize: 22,
  refFontColor: "#aaaaaa",
  refFontWeight: "normal",
  refPosition: "bottom",

  backgroundColor: "#0a0a14",
  backgroundImage: "",
  backgroundVideo: "",
  backgroundOpacity: 1,

  logoUrl: "",
  logoPosition: "bottom-right",
  logoSize: 60,

  padding: 80,
  safeArea: 50,
  borderRadius: 0,
  boxBackground: "transparent",
  boxOpacity: 0,

  animation: "fade",
  animationDuration: 500,
};

const classicDark: BibleTheme = {
  id: "classic-dark",
  name: "Classic Dark",
  description:
    "Elegant dark background with centered white serif text. Perfect for traditional worship.",
  source: "builtin",
  templateType: "fullscreen",
  settings: classicDarkSettings,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Modern Light
// ---------------------------------------------------------------------------

const modernLightSettings: BibleThemeSettings = {
  ...DEFAULT_THEME_SETTINGS,
  fontFamily: '"CMG Sans", sans-serif',
  fontSize: 44,
  fontWeight: "bold",
  fontColor: "#FFFFFF",
  lineHeight: 1.5,
  textAlign: "left",
  textShadow: "0 1px 4px rgba(0,0,0,0.5)",
  textOutline: false,
  textOutlineColor: "#000000",
  textOutlineWidth: 0,

  refFontSize: 20,
  refFontColor: "#e0e0e0",
  refFontWeight: "bold",
  refPosition: "bottom",

  backgroundColor: "#1a1a2e",
  backgroundImage: "",
  backgroundVideo: "",
  backgroundOpacity: 1,

  logoUrl: "",
  logoPosition: "bottom-right",
  logoSize: 60,

  padding: 40,
  safeArea: 30,
  borderRadius: 12,
  boxBackground: "rgba(26, 26, 46, 0.85)",
  boxOpacity: 0.9,

  animation: "slide-up",
  animationDuration: 400,
};

const modernLight: BibleTheme = {
  id: "modern-lower-third",
  name: "Modern Lower Third",
  description:
    "Contemporary lower-third overlay with semi-transparent box. Great for modern worship and youth services.",
  source: "builtin",
  templateType: "lower-third",
  settings: modernLightSettings,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Cinematic
// ---------------------------------------------------------------------------

const cinematicSettings: BibleThemeSettings = {
  ...DEFAULT_THEME_SETTINGS,
  fontFamily: '"CMG Sans Bold", "CMG Sans", sans-serif',
  fontSize: 56,
  fontWeight: "bold",
  fontColor: "#FFFFFF",
  lineHeight: 1.8,
  textAlign: "center",
  textShadow: "0 4px 20px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.5)",
  textOutline: true,
  textOutlineColor: "rgba(0,0,0,0.3)",
  textOutlineWidth: 1,

  refFontSize: 20,
  refFontColor: "#d4af37",
  refFontWeight: "bold",
  refPosition: "bottom",

  backgroundColor: "#000000",
  backgroundImage: "",
  backgroundVideo: "",
  backgroundOpacity: 1,

  logoUrl: "",
  logoPosition: "bottom-right",
  logoSize: 60,

  padding: 100,
  safeArea: 60,
  borderRadius: 0,
  boxBackground: "transparent",
  boxOpacity: 0,

  animation: "fade",
  animationDuration: 800,
};

const cinematic: BibleTheme = {
  id: "cinematic",
  name: "Cinematic",
  description:
    "Bold cinematic look with heavy shadows and gold reference text. Makes scripture feel epic.",
  source: "builtin",
  templateType: "fullscreen",
  settings: cinematicSettings,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Clean Minimal
// ---------------------------------------------------------------------------

const cleanMinimalSettings: BibleThemeSettings = {
  ...DEFAULT_THEME_SETTINGS,
  fontFamily: '"CMG Sans Light", "CMG Sans", sans-serif',
  fontSize: 40,
  fontWeight: "light",
  fontColor: "#333333",
  lineHeight: 1.6,
  textAlign: "center",
  textShadow: "none",
  textOutline: false,
  textOutlineColor: "#000000",
  textOutlineWidth: 0,

  refFontSize: 18,
  refFontColor: "#888888",
  refFontWeight: "normal",
  refPosition: "bottom",

  backgroundColor: "#f8f8f8",
  backgroundImage: "",
  backgroundVideo: "",
  backgroundOpacity: 1,

  logoUrl: "",
  logoPosition: "bottom-right",
  logoSize: 50,

  padding: 80,
  safeArea: 50,
  borderRadius: 0,
  boxBackground: "transparent",
  boxOpacity: 0,

  animation: "fade",
  animationDuration: 300,
};

const cleanMinimal: BibleTheme = {
  id: "clean-minimal",
  name: "Clean Minimal",
  description:
    "Light, clean design with minimal decoration. Good for projectors and bright environments.",
  source: "builtin",
  templateType: "fullscreen",
  settings: cleanMinimalSettings,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const BUILTIN_THEMES: BibleTheme[] = [
  classicDark,
  modernLight,
  cinematic,
  cleanMinimal,
];
