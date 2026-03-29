/**
 * updateService.ts — Tauri native auto-updater
 *
 * Uses @tauri-apps/plugin-updater to:
 *   1. Check for updates against GitHub Releases (latest.json)
 *   2. Download the update binary with progress tracking
 *   3. Install the update and relaunch the app
 *
 * The updater config (pubkey, endpoint) lives in tauri.conf.json.
 * Signing key is set via TAURI_SIGNING_PRIVATE_KEY at build time.
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// ── Private-repo auth ──
// For private GitHub repos, a fine-grained PAT with contents:read is injected
// at build time via VITE_UPDATER_TOKEN. This token is used for both the
// manifest fetch (check) and the binary download (downloadAndInstall).
// Create the token at: https://github.com/settings/tokens?type=beta
// Then add it as a repository secret named UPDATER_GITHUB_TOKEN.

function getUpdaterHeaders(): Record<string, string> | undefined {
  const token = (import.meta as any).env?.VITE_UPDATER_TOKEN as string | undefined;
  if (token) return { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" };
  return undefined;
}

// ── Types ──

export type { Update } from "@tauri-apps/plugin-updater";

export interface UpdateCheckResult {
  available: boolean;
  update?: Update;
  version?: string;
  currentVersion?: string;
  notes?: string;
  date?: string;
  error?: string;
}

export interface DownloadProgress {
  /** Total bytes to download (0 if unknown) */
  contentLength: number;
  /** Bytes downloaded so far */
  downloaded: number;
}

// ── Check ──

/**
 * Check GitHub Releases for a newer version.
 * Returns the Update object if one is available.
 *
 * For private repos, the VITE_UPDATER_TOKEN env var (set at build time)
 * is sent as an Authorization header so the updater can access the
 * release manifest and download the update binary.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    // Add auth headers for private repo access (no-op if token not set)
    const headers = getUpdaterHeaders();
    const update = await check(headers ? { headers } : undefined);

    if (update) {
      console.log(
        `[updater] Update available: v${update.version} (current: ${update.currentVersion})`
      );
      return {
        available: true,
        update,
        version: update.version,
        currentVersion: update.currentVersion,
        notes: update.body ?? undefined,
        date: update.date ?? undefined,
      };
    }

    console.log("[updater] App is up to date");
    return { available: false };
  } catch (err: any) {
    console.warn("[updater] Update check failed:", err);
    return {
      available: false,
      error: err?.message || String(err),
    };
  }
}

// ── Download & Install ──

/**
 * Download and install an update with progress tracking.
 * After install completes, relaunches the app automatically.
 *
 * @param update - The Update object from checkForUpdate()
 * @param onProgress - Called with download progress updates
 * @param onStatusChange - Called when status changes (downloading → installing → relaunching)
 */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (progress: DownloadProgress) => void,
  onStatusChange?: (status: "downloading" | "installing" | "relaunching") => void
): Promise<void> {
  let downloaded = 0;
  let contentLength = 0;

  onStatusChange?.("downloading");

  // Pass auth headers for private repo binary downloads
  const headers = getUpdaterHeaders();

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        console.log(`[updater] Download started: ${contentLength} bytes`);
        onProgress?.({ contentLength, downloaded: 0 });
        break;

      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ contentLength, downloaded });
        break;

      case "Finished":
        console.log("[updater] Download finished, installing...");
        onStatusChange?.("installing");
        break;
    }
  }, headers ? { headers } : undefined);

  console.log("[updater] Update installed, relaunching...");
  onStatusChange?.("relaunching");

  // Brief pause so the user sees "Relaunching..."
  await new Promise((r) => setTimeout(r, 800));
  await relaunch();
}
