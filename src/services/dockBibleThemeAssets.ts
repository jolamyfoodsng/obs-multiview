import type { BibleTheme } from "../bible/types";

function canPersistDockAssets(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function fileExtensionFromDataUrl(dataUrl: string): string {
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/i);
  const mime = mimeMatch?.[1]?.toLowerCase() ?? "";
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

async function saveDataUrlToUploads(dataUrl: string, prefix: string): Promise<string> {
  if (!canPersistDockAssets() || !dataUrl.startsWith("data:")) return dataUrl;

  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return dataUrl;

  const base64Data = dataUrl.slice(commaIdx + 1);
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const ext = fileExtensionFromDataUrl(dataUrl);
  const fileName = `${prefix}_${simpleHash(dataUrl)}.${ext}`;

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<string>("save_upload_file", {
    fileName,
    fileData: Array.from(bytes),
  });

  return `/uploads/${encodeURIComponent(fileName)}`;
}

async function normalizeThemeAssets(theme: BibleTheme): Promise<BibleTheme> {
  const settings = { ...theme.settings };
  settings.backgroundImage = await saveDataUrlToUploads(settings.backgroundImage || "", "dock_theme_bg");
  settings.boxBackgroundImage = await saveDataUrlToUploads(settings.boxBackgroundImage || "", "dock_theme_box_bg");
  settings.logoUrl = await saveDataUrlToUploads(settings.logoUrl || "", "dock_theme_logo");
  return { ...theme, settings };
}

export async function serializeBibleThemesForDock(themes: BibleTheme[]): Promise<BibleTheme[]> {
  return Promise.all(themes.map(normalizeThemeAssets));
}
