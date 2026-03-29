/**
 * libraryDb.ts — localStorage CRUD for media items.
 *
 * Songs use the existing worshipDb.ts (IndexedDB).
 */

import type { MediaItem } from "./libraryTypes";

const STORAGE_KEY = "obs-church-studio-media-library";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(): MediaItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MediaItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: MediaItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Get all media items, sorted by createdAt descending */
export function getAllMedia(): MediaItem[] {
  return read().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Save (create or update) a media item */
export function saveMedia(item: MediaItem): void {
  const items = read();
  const idx = items.findIndex((m) => m.id === item.id);
  if (idx >= 0) {
    items[idx] = item;
  } else {
    items.push(item);
  }
  write(items);
  // Sync to dock (fire-and-forget)
  syncMediaToDock()
    .then(() => {
      import("../services/dockBridge").then((m) => m.dockBridge.sendLibraryUpdated());
    })
    .catch(() => {});
}

/** Delete a media item by id */
export function deleteMedia(id: string): void {
  write(read().filter((m) => m.id !== id));
  // Sync to dock (fire-and-forget)
  syncMediaToDock()
    .then(() => {
      import("../services/dockBridge").then((m) => m.dockBridge.sendLibraryUpdated());
    })
    .catch(() => {});
}

/** Rename a media item */
export function renameMedia(id: string, newName: string): void {
  const items = read();
  const item = items.find((m) => m.id === id);
  if (item) {
    item.name = newName;
    write(items);
    // Sync to dock (fire-and-forget)
    syncMediaToDock()
      .then(() => {
        import("../services/dockBridge").then((m) => m.dockBridge.sendLibraryUpdated());
      })
      .catch(() => {});
  }
}

/**
 * Sync all media items to a JSON file that the overlay server can serve
 * to the dock.  Calls the Tauri `save_dock_data` command so the dock at
 * http://127.0.0.1:<port>/uploads/dock-media-library.json can read them.
 */
export async function syncMediaToDock(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const media = getAllMedia();
    await invoke("save_dock_data", {
      name: "dock-media-library",
      data: JSON.stringify(media),
    });
  } catch (err) {
    console.warn("[libraryDb] Failed to sync media to dock:", err);
  }
}
