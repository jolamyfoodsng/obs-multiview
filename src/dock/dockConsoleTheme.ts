import type { CSSProperties } from "react";
import type { BibleThemeSettings } from "../bible/types";

export type DockBackgroundPreset =
  | "theme"
  | "dark"
  | "light"
  | "gradient"
  | "theme-art"
  | "none";

export type DockLiveThemeOverrides = Partial<BibleThemeSettings>;

export interface DockBackgroundPresetOption {
  id: DockBackgroundPreset;
  label: string;
}

export const DOCK_BACKGROUND_PRESETS: DockBackgroundPresetOption[] = [
  { id: "theme", label: "Theme" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "gradient", label: "Gradient" },
  { id: "theme-art", label: "Theme Art" },
  { id: "none", label: "None" },
];

function hexToRgb(hex: string): [number, number, number] {
  const normalized = String(hex || "").trim().replace("#", "");
  if (normalized.length === 3) {
    const [r, g, b] = normalized.split("");
    return [
      Number.parseInt(r + r, 16) || 0,
      Number.parseInt(g + g, 16) || 0,
      Number.parseInt(b + b, 16) || 0,
    ];
  }

  if (normalized.length >= 6) {
    return [
      Number.parseInt(normalized.slice(0, 2), 16) || 0,
      Number.parseInt(normalized.slice(2, 4), 16) || 0,
      Number.parseInt(normalized.slice(4, 6), 16) || 0,
    ];
  }

  return [0, 0, 0];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mix(colorA: string, colorB: string, ratio: number): string {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const clamped = Math.max(0, Math.min(1, ratio));
  return rgbToHex(
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  );
}

function svgDataUri(markup: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markup)}`;
}

function buildGradientImage(primary: string, accent: string): string {
  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="55%" stop-color="${accent}" />
          <stop offset="100%" stop-color="${mix(accent, "#08111f", 0.55)}" />
        </linearGradient>
        <radialGradient id="glow" cx="35%" cy="35%" r="60%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.2)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#bg)" />
      <circle cx="420" cy="260" r="320" fill="url(#glow)" />
      <circle cx="1540" cy="860" r="380" fill="rgba(255,255,255,0.05)" />
    </svg>
  `);
}

function buildAmbientArtImage(primary: string, accent: string, neutral: string): string {
  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${mix(primary, "#05070d", 0.24)}" />
          <stop offset="100%" stop-color="${mix(accent, "#05070d", 0.4)}" />
        </linearGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#bg)" />
      <g opacity="0.78">
        <circle cx="340" cy="260" r="210" fill="${mix(accent, "#ffffff", 0.1)}" />
        <circle cx="1510" cy="260" r="260" fill="${mix(primary, "#ffffff", 0.08)}" />
        <circle cx="1210" cy="760" r="340" fill="${mix(neutral, primary, 0.35)}" />
        <rect x="110" y="690" width="520" height="180" rx="90" fill="${mix(primary, "#ffffff", 0.06)}" />
      </g>
    </svg>
  `);
}

export function buildDockBackgroundPresetOverrides(
  settings: BibleThemeSettings,
  preset: DockBackgroundPreset,
): DockLiveThemeOverrides | null {
  switch (preset) {
    case "theme":
      return null;
    case "dark":
      return {
        backgroundColor: "#060812",
        backgroundImage: "",
        backgroundOpacity: 1,
        fullscreenShadeEnabled: true,
        fullscreenShadeColor: "#000000",
        fullscreenShadeOpacity: 0.4,
        fontColor: "#f8fbff",
        refFontColor: "#cbd5e1",
        textShadow: "0 12px 28px rgba(0,0,0,0.55)",
      };
    case "light":
      return {
        backgroundColor: "#edf2f7",
        backgroundImage: "",
        backgroundOpacity: 1,
        fullscreenShadeEnabled: false,
        fullscreenShadeColor: "#ffffff",
        fullscreenShadeOpacity: 0,
        fontColor: "#111827",
        refFontColor: "#475467",
        textShadow: "0 1px 0 rgba(255,255,255,0.75)",
      };
    case "gradient": {
      const primary = mix(settings.backgroundColor || "#111827", "#0b1020", 0.3);
      const accent = mix(settings.refFontColor || settings.fontColor || "#3651B6", "#3651B6", 0.55);
      return {
        backgroundColor: primary,
        backgroundImage: buildGradientImage(primary, accent),
        backgroundOpacity: 1,
        fullscreenShadeEnabled: true,
        fullscreenShadeColor: "#020617",
        fullscreenShadeOpacity: 0.26,
        fontColor: "#f8fafc",
        refFontColor: "#dbeafe",
        textShadow: "0 10px 30px rgba(2,6,23,0.45)",
      };
    }
    case "theme-art": {
      if (settings.backgroundImage) {
        return {
          backgroundImage: settings.backgroundImage,
          backgroundOpacity: 1,
          fullscreenShadeEnabled: true,
          fullscreenShadeColor: "#020617",
          fullscreenShadeOpacity: 0.28,
        };
      }

      const primary = settings.backgroundColor || "#0b1020";
      const accent = settings.refFontColor || settings.fontColor || "#3651B6";
      const neutral = settings.boxBackground || "#111827";
      return {
        backgroundColor: primary,
        backgroundImage: buildAmbientArtImage(primary, accent, neutral),
        backgroundOpacity: 1,
        fullscreenShadeEnabled: true,
        fullscreenShadeColor: "#020617",
        fullscreenShadeOpacity: 0.28,
      };
    }
    case "none":
      return {
        backgroundColor: "transparent",
        backgroundImage: "",
        backgroundOpacity: 0,
        fullscreenShadeEnabled: false,
        fullscreenShadeColor: "transparent",
        fullscreenShadeOpacity: 0,
      };
    default:
      return null;
  }
}

export function mergeDockThemeSettings(
  settings: BibleThemeSettings,
  overrides?: DockLiveThemeOverrides | null,
): BibleThemeSettings {
  return overrides ? { ...settings, ...overrides } : settings;
}

export function dockBackgroundPresetPreviewStyle(
  settings: BibleThemeSettings,
  preset: DockBackgroundPreset,
): CSSProperties {
  const merged = mergeDockThemeSettings(settings, buildDockBackgroundPresetOverrides(settings, preset));
  const backgroundImage =
    merged.backgroundImage && merged.backgroundImage !== "__FROM_CSS__"
      ? `url(${merged.backgroundImage})`
      : undefined;

  return {
    backgroundColor:
      merged.backgroundColor && merged.backgroundColor !== "transparent"
        ? merged.backgroundColor
        : "rgba(148, 163, 184, 0.08)",
    backgroundImage,
    backgroundPosition: "center",
    backgroundSize: "cover",
    color: merged.fontColor,
    border: preset === "none" ? "1px dashed rgba(148, 163, 184, 0.34)" : undefined,
  };
}
