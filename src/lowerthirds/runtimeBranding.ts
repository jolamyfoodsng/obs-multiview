import type { MVSettings } from "../multiview/mvStore";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";
import type { LowerThirdTheme, LTVariable } from "./types";

const DEFAULT_BRAND_COLOR = "#00E676";
const RUNTIME_BRAND_CSS_SENTINEL = "Runtime brand color override";

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function toRgba(hex: string, alpha: number, fallback: string): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return fallback;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

export function normalizeBrandColor(color: string | null | undefined, fallback = DEFAULT_BRAND_COLOR): string {
  const trimmed = (color ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return fallback;
}

export function isLogoVariable(variable: Pick<LTVariable, "key" | "label">): boolean {
  const key = String(variable.key || "").toLowerCase();
  const label = String(variable.label || "").toLowerCase();
  const hint = `${key} ${label}`;
  return hint.includes("logo") || hint.includes("brand mark") || hint.includes("brandmark");
}

export function resolveOverlayAssetUrl(pathOrUrl: string): string {
  const raw = pathOrUrl.trim();
  if (!raw) return "";

  if (/^(https?:|data:|blob:|asset:)/i.test(raw)) return raw;
  if (/^\/?uploads\//i.test(raw)) {
    const clean = raw.replace(/^\/+/, "");
    return `${getOverlayBaseUrlSync()}/${clean}`;
  }

  let candidate = raw;
  if (/^file:\/\//i.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate.replace(/^file:\/\//i, ""));
    } catch {
      candidate = candidate.replace(/^file:\/\//i, "");
    }
  }

  const fileName = candidate.split(/[\\/]/).pop()?.trim() ?? "";
  if (!fileName) return "";
  return `${getOverlayBaseUrlSync()}/uploads/${encodeURIComponent(fileName)}`;
}

function buildRuntimeBrandCss(brandColor: string): string {
  const border = toRgba(brandColor, 0.32, "rgba(74, 222, 128, 0.32)");
  const glow = toRgba(brandColor, 0.14, "rgba(74, 222, 128, 0.14)");
  return `
/* ${RUNTIME_BRAND_CSS_SENTINEL} */
:root, #overlay-root {
  --lt-brand-primary: ${brandColor} !important;
  --lt-brand-border: ${border} !important;
  --lt-brand-glow: ${glow} !important;
  --lt-logo-scale: 1.2 !important;
  --lt-logo-box-width: 220px !important;
  --lt-logo-box-height: 126px !important;
  --lt-logo-round-size: 120px !important;
  --lt-logo-compact-box-width: 154px !important;
  --lt-logo-compact-box-height: 90px !important;
  --lt-logo-compact-round-size: 86px !important;
}

.logo-box,
.lt53-logo,
.y-logo {
  width: calc(var(--lt-logo-box-width, 220px) * var(--lt-logo-scale, 1.2)) !important;
  min-width: calc(var(--lt-logo-box-width, 220px) * var(--lt-logo-scale, 1.2)) !important;
  height: calc(var(--lt-logo-box-height, 126px) * var(--lt-logo-scale, 1.2)) !important;
}

.logo-box.logo-round {
  width: calc(var(--lt-logo-round-size, 120px) * var(--lt-logo-scale, 1.2)) !important;
  min-width: calc(var(--lt-logo-round-size, 120px) * var(--lt-logo-scale, 1.2)) !important;
  height: calc(var(--lt-logo-round-size, 120px) * var(--lt-logo-scale, 1.2)) !important;
}

.logo-box img,
.lt53-logo img,
.y-logo img {
  width: 100% !important;
  max-height: calc(var(--lt-logo-box-height, 126px) * var(--lt-logo-scale, 1.2)) !important;
  object-fit: contain !important;
}

@media (max-width: 1180px) {
  .logo-box,
  .lt53-logo,
  .y-logo {
    width: calc(var(--lt-logo-compact-box-width, 154px) * var(--lt-logo-scale, 1.2)) !important;
    min-width: calc(var(--lt-logo-compact-box-width, 154px) * var(--lt-logo-scale, 1.2)) !important;
    height: calc(var(--lt-logo-compact-box-height, 90px) * var(--lt-logo-scale, 1.2)) !important;
  }

  .logo-box.logo-round {
    width: calc(var(--lt-logo-compact-round-size, 86px) * var(--lt-logo-scale, 1.2)) !important;
    min-width: calc(var(--lt-logo-compact-round-size, 86px) * var(--lt-logo-scale, 1.2)) !important;
    height: calc(var(--lt-logo-compact-round-size, 86px) * var(--lt-logo-scale, 1.2)) !important;
  }

  .logo-box img,
  .lt53-logo img,
  .y-logo img {
    max-height: calc(var(--lt-logo-compact-box-height, 90px) * var(--lt-logo-scale, 1.2)) !important;
  }
}
`;
}

export function withRuntimeBrandColor(theme: LowerThirdTheme, brandColor: string): LowerThirdTheme {
  const safeColor = normalizeBrandColor(brandColor, theme.accentColor || DEFAULT_BRAND_COLOR);
  const cssBase = typeof theme.css === "string" ? theme.css : "";
  const css = cssBase.includes(RUNTIME_BRAND_CSS_SENTINEL)
    ? cssBase
    : `${cssBase}\n${buildRuntimeBrandCss(safeColor)}`;

  return {
    ...theme,
    accentColor: safeColor,
    css,
  };
}

export function applyBrandLogoDefaults(
  theme: LowerThirdTheme,
  values: Record<string, string>,
  brandLogoPath: string,
): Record<string, string> {
  const resolvedLogo = resolveOverlayAssetUrl(brandLogoPath);
  if (!resolvedLogo) return { ...values };

  const next = { ...values };
  for (const variable of theme.variables) {
    if (!isLogoVariable(variable)) continue;
    next[variable.key] = resolvedLogo;
  }
  return next;
}

export function applyRuntimeBranding(
  theme: LowerThirdTheme,
  values: Record<string, string>,
  settings: Pick<MVSettings, "brandColor" | "brandLogoPath">,
): { theme: LowerThirdTheme; values: Record<string, string>; brandColor: string; logoUrl: string } {
  const brandColor = normalizeBrandColor(settings.brandColor, theme.accentColor || DEFAULT_BRAND_COLOR);
  const brandedTheme = withRuntimeBrandColor(theme, brandColor);
  const brandedValues = applyBrandLogoDefaults(brandedTheme, values, settings.brandLogoPath || "");
  const logoUrl = resolveOverlayAssetUrl(settings.brandLogoPath || "");
  return {
    theme: brandedTheme,
    values: brandedValues,
    brandColor,
    logoUrl,
  };
}
