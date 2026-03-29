import type { MVSettings } from "../multiview/mvStore";

export function applyBrandingSettingsToDom(settings: Pick<MVSettings, "brandColor" | "churchName">) {
  const root = document.documentElement;
  // Branding defaults should not recolor the app UI. Keep app theme colors static.
  // Clear any previously injected variables so CSS falls back to App.css defaults.
  root.style.removeProperty("--primary");
  root.style.removeProperty("--primary-hover");
  root.style.removeProperty("--primary-rgb");

  const churchName = settings.churchName.trim();
  document.title = churchName ? `${churchName} · OBS Church Studio` : "OBS Church Studio";
}
