import { useEffect, useState, type ImgHTMLAttributes } from "react";
import darkLogo from "../app_logo_no_bg_for_dark_mode.png";
import lightLogo from "../app_logo_no_bg_for_light_mode.png";

type LogoMode = "auto" | "dark" | "light";

type AppLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  mode?: LogoMode;
};

function detectThemeMode(): "light" | "dark" {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "dark";
  }

  const root = document.documentElement;
  const body = document.body;
  const rootTheme = root.getAttribute("data-theme");
  const bodyTheme = body?.getAttribute("data-theme");

  if (
    root.classList.contains("mv-theme-light") ||
    body?.classList.contains("mv-theme-light") ||
    root.classList.contains("light") ||
    body?.classList.contains("light") ||
    rootTheme === "light" ||
    bodyTheme === "light"
  ) {
    return "light";
  }

  if (
    root.classList.contains("mv-theme-dark") ||
    body?.classList.contains("mv-theme-dark") ||
    root.classList.contains("dark") ||
    body?.classList.contains("dark") ||
    rootTheme === "dark" ||
    bodyTheme === "dark"
  ) {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function AppLogo({
  mode = "auto",
  alt = "OBS Church Studio",
  ...imgProps
}: AppLogoProps) {
  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">(() => (
    mode === "auto" ? detectThemeMode() : mode
  ));

  useEffect(() => {
    if (mode !== "auto") {
      setResolvedMode(mode);
      return;
    }

    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const updateMode = () => setResolvedMode(detectThemeMode());
    updateMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateMode);
    } else {
      mediaQuery.addListener(updateMode);
    }

    const rootObserver = new MutationObserver(updateMode);
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    const bodyObserver = new MutationObserver(updateMode);
    if (document.body) {
      bodyObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", updateMode);
      } else {
        mediaQuery.removeListener(updateMode);
      }
      rootObserver.disconnect();
      bodyObserver.disconnect();
    };
  }, [mode]);

  const fallbackLogoSrc = resolvedMode === "light" ? lightLogo : darkLogo;
  return <img {...imgProps} src={fallbackLogoSrc} alt={alt} />;
}
