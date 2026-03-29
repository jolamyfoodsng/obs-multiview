/**
 * worshipDb.ts — IndexedDB persistence for the Worship module
 *
 * Stores songs and setlists locally using idb.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { Song } from "./types";

const DB_NAME = "obs-church-studio-worship";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function isSongArchived(song: Song): boolean {
  return Boolean(song.archived || song.archivedAt);
}

function sortSongs(songs: Song[]): Song[] {
  return songs.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function sortArchivedSongs(songs: Song[]): Song[] {
  return songs.sort((a, b) => {
    const aTime = new Date(a.archivedAt || a.updatedAt).getTime();
    const bTime = new Date(b.archivedAt || b.updatedAt).getTime();
    return bTime - aTime;
  });
}

function notifySongsChanged(): void {
  syncSongsToDock()
    .then(() => {
      import("../services/dockBridge").then((m) => m.dockBridge.sendLibraryUpdated());
    })
    .catch(() => {});
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains("songs")) {
            const store = db.createObjectStore("songs", { keyPath: "id" });
            store.createIndex("title", "metadata.title");
            store.createIndex("updatedAt", "updatedAt");
          }
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Song CRUD
// ---------------------------------------------------------------------------

/** Get all songs, sorted by updatedAt descending */
export async function getAllSongs(): Promise<Song[]> {
  const db = await getDb();
  const all = await db.getAll("songs");
  return sortSongs((all as Song[]).filter((song) => !isSongArchived(song)));
}

/** Get archived songs, newest archived first */
export async function getArchivedSongs(): Promise<Song[]> {
  const db = await getDb();
  const all = await db.getAll("songs");
  return sortArchivedSongs((all as Song[]).filter((song) => isSongArchived(song)));
}

/** Get a single song by id */
export async function getSong(id: string): Promise<Song | undefined> {
  const db = await getDb();
  return db.get("songs", id) as Promise<Song | undefined>;
}

/** Create or update a song */
export async function saveSong(song: Song): Promise<void> {
  const db = await getDb();
  await db.put("songs", song);
  notifySongsChanged();
}

/** Archive a song by id so it is removed from active views without being deleted */
export async function archiveSong(id: string): Promise<void> {
  const db = await getDb();
  const existing = (await db.get("songs", id)) as Song | undefined;
  if (!existing || isSongArchived(existing)) return;

  await db.put("songs", {
    ...existing,
    archived: true,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  notifySongsChanged();
}

/** Restore an archived song back into the active worship library */
export async function restoreSong(id: string): Promise<void> {
  const db = await getDb();
  const existing = (await db.get("songs", id)) as Song | undefined;
  if (!existing || !isSongArchived(existing)) return;

  await db.put("songs", {
    ...existing,
    archived: false,
    archivedAt: null,
    updatedAt: new Date().toISOString(),
  });
  notifySongsChanged();
}

/** Backwards-compatible alias: song removal now archives instead of deleting */
export async function deleteSong(id: string): Promise<void> {
  await archiveSong(id);
}

/** Count total songs */
export async function countSongs(): Promise<number> {
  return (await getAllSongs()).length;
}

/**
 * Sync all songs to a JSON file that the overlay server can serve to the dock.
 * Calls the Tauri `save_dock_data` command so the dock at
 * http://127.0.0.1:<port>/uploads/dock-worship-songs.json can read them.
 */
export async function syncSongsToDock(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const songs = await getAllSongs();
    await invoke("save_dock_data", {
      name: "dock-worship-songs",
      data: JSON.stringify(songs),
    });
  } catch (err) {
    console.warn("[worshipDb] Failed to sync songs to dock:", err);
  }
}
