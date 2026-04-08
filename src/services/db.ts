/**
 * db.ts — Centralized IndexedDB for OBS Church Studio
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  ONE database: "obs-church-studio"                                 │
 * │                                                                    │
 * │  Object Stores:                                                    │
 * │   ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
 * │   │  bible_favorites │  │  bible_history    │  │  bible_themes  │   │
 * │   │  key: reference  │  │  key: id (auto)  │  │  key: id       │   │
 * │   │  idx: —          │  │  idx: timestamp   │  │  idx: —        │   │
 * │   └─────────────────┘  └──────────────────┘  └────────────────┘   │
 * │   ┌─────────────────┐  ┌──────────────────┐                       │
 * │   │  bible_settings  │  │ bible_translations│                      │
 * │   │  key: (manual)   │  │  key: abbr        │                      │
 * │   │  idx: —          │  │  idx: —           │                      │
 * │   └─────────────────┘  └──────────────────┘                       │
 * │   ┌─────────────────┐  ┌──────────────────┐                       │
 * │   │  worship_songs   │  │  speakers        │                       │
 * │   │  key: id         │  │  key: id          │                      │
 * │   │  idx: title,     │  │  idx: name        │                      │
 * │   │       updatedAt  │  │                   │                      │
 * │   └─────────────────┘  └──────────────────┘                       │
 * │   ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
 * │   │  obs_scenes      │  │  obs_inputs      │  │ obs_sceneItems │   │
 * │   │  key: slot       │  │  key: slot        │  │  key: slot     │   │
 * │   │  idx: sceneUuid  │  │  idx: inputUuid   │  │  idx: scene,   │   │
 * │   │                  │  │                   │  │       input    │   │
 * │   └─────────────────┘  └──────────────────┘  └────────────────┘   │
 * │   ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
 * │   │  mv_layouts      │  │  mv_assets       │  │  mv_mappings   │   │
 * │   │  key: id         │  │  key: id          │  │  key: layoutId │   │
 * │   │  idx: updatedAt, │  │  idx: type,       │  │  idx: —        │   │
 * │   │       isTemplate │  │       folder      │  │                │   │
 * │   └─────────────────┘  └──────────────────┘  └────────────────┘   │
 * │   ┌─────────────────┐  ┌──────────────────┐                       │
 * │   │  mv_media        │  │  app_settings    │                       │
 * │   │  key: id         │  │  key: (manual)   │                       │
 * │   │  idx: mediaType, │  │  idx: —          │                       │
 * │   │       createdAt  │  │                   │                      │
 * │   └─────────────────┘  └──────────────────┘                       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Why centralise?
 *  • Single upgrade path, no version conflicts between modules
 *  • DevDashboard can enumerate all stores from one handle
 *  • Backup / export / import becomes trivial
 *  • No accidental store-name collisions
 */

import { openDB, type IDBPDatabase } from "idb";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CENTRAL_DB_NAME = "obs-church-studio";
export const CENTRAL_DB_VERSION = 2;

// All object-store names in one place:
export const STORES = {
  // Bible
  BIBLE_FAVORITES:    "bible_favorites",
  BIBLE_HISTORY:      "bible_history",
  BIBLE_THEMES:       "bible_themes",
  BIBLE_SETTINGS:     "bible_settings",
  BIBLE_TRANSLATIONS: "bible_translations",

  // Worship
  WORSHIP_SONGS: "worship_songs",

  // Speakers (migrated from localStorage)
  SPEAKERS: "speakers",

  // OBS Registry
  OBS_SCENES:      "obs_scenes",
  OBS_INPUTS:      "obs_inputs",
  OBS_SCENE_ITEMS: "obs_sceneItems",

  // Multi-View
  MV_LAYOUTS:  "mv_layouts",
  MV_ASSETS:   "mv_assets",
  MV_MAPPINGS: "mv_mappings",
  MV_MEDIA:    "mv_media",

  // Global app settings
  APP_SETTINGS: "app_settings",

  // Service Planner
  SERVICE_PLANS: "service_plans",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

// ─── Database singleton ───────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getCentralDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(CENTRAL_DB_NAME, CENTRAL_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // ── Bible ──
          if (!db.objectStoreNames.contains(STORES.BIBLE_FAVORITES)) {
            db.createObjectStore(STORES.BIBLE_FAVORITES, { keyPath: "reference" });
          }
          if (!db.objectStoreNames.contains(STORES.BIBLE_HISTORY)) {
            const hist = db.createObjectStore(STORES.BIBLE_HISTORY, {
              keyPath: "id",
              autoIncrement: true,
            });
            hist.createIndex("timestamp", "timestamp");
          }
          if (!db.objectStoreNames.contains(STORES.BIBLE_THEMES)) {
            db.createObjectStore(STORES.BIBLE_THEMES, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(STORES.BIBLE_SETTINGS)) {
            db.createObjectStore(STORES.BIBLE_SETTINGS);
          }
          if (!db.objectStoreNames.contains(STORES.BIBLE_TRANSLATIONS)) {
            db.createObjectStore(STORES.BIBLE_TRANSLATIONS, { keyPath: "abbr" });
          }

          // ── Worship ──
          if (!db.objectStoreNames.contains(STORES.WORSHIP_SONGS)) {
            const songs = db.createObjectStore(STORES.WORSHIP_SONGS, { keyPath: "id" });
            songs.createIndex("title", "metadata.title");
            songs.createIndex("updatedAt", "updatedAt");
          }

          // ── Speakers ──
          if (!db.objectStoreNames.contains(STORES.SPEAKERS)) {
            const speakers = db.createObjectStore(STORES.SPEAKERS, { keyPath: "id" });
            speakers.createIndex("name", "name");
          }

          // ── OBS Registry ──
          if (!db.objectStoreNames.contains(STORES.OBS_SCENES)) {
            const scenes = db.createObjectStore(STORES.OBS_SCENES, { keyPath: "slot" });
            scenes.createIndex("sceneUuid", "sceneUuid", { unique: true });
          }
          if (!db.objectStoreNames.contains(STORES.OBS_INPUTS)) {
            const inputs = db.createObjectStore(STORES.OBS_INPUTS, { keyPath: "slot" });
            inputs.createIndex("inputUuid", "inputUuid", { unique: true });
          }
          if (!db.objectStoreNames.contains(STORES.OBS_SCENE_ITEMS)) {
            const items = db.createObjectStore(STORES.OBS_SCENE_ITEMS, { keyPath: "slot" });
            items.createIndex("sceneSlot", "sceneSlot");
            items.createIndex("inputSlot", "inputSlot");
          }

          // ── Multi-View ──
          if (!db.objectStoreNames.contains(STORES.MV_LAYOUTS)) {
            const layouts = db.createObjectStore(STORES.MV_LAYOUTS, { keyPath: "id" });
            layouts.createIndex("updatedAt", "updatedAt");
            layouts.createIndex("isTemplate", "isTemplate");
          }
          if (!db.objectStoreNames.contains(STORES.MV_ASSETS)) {
            const assets = db.createObjectStore(STORES.MV_ASSETS, { keyPath: "id" });
            assets.createIndex("type", "type");
            assets.createIndex("folder", "folder");
          }
          if (!db.objectStoreNames.contains(STORES.MV_MAPPINGS)) {
            db.createObjectStore(STORES.MV_MAPPINGS, { keyPath: "layoutId" });
          }
          if (!db.objectStoreNames.contains(STORES.MV_MEDIA)) {
            const media = db.createObjectStore(STORES.MV_MEDIA, { keyPath: "id" });
            media.createIndex("mediaType", "mediaType");
            media.createIndex("createdAt", "createdAt");
          }

          // ── App settings ──
          if (!db.objectStoreNames.contains(STORES.APP_SETTINGS)) {
            db.createObjectStore(STORES.APP_SETTINGS);
          }
        }

        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(STORES.SERVICE_PLANS)) {
            const plans = db.createObjectStore(STORES.SERVICE_PLANS, { keyPath: "id" });
            plans.createIndex("serviceDate", "serviceDate");
            plans.createIndex("updatedAt", "updatedAt");
            plans.createIndex("status", "status");
          }
        }
      },
    });
  }
  return dbPromise;
}

// ─── Migration helper ─────────────────────────────────────────────────────────

/**
 * One-time migration: copies data from legacy databases into the central DB.
 * Safe to call multiple times — each store is only migrated once.
 */
export async function migrateFromLegacyDatabases(): Promise<{ migrated: string[]; errors: string[] }> {
  const migrated: string[] = [];
  const errors: string[] = [];
  const central = await getCentralDb();

  const MIGRATION_FLAG_KEY = "__ocs_migration_v1_done";
  const alreadyDone = await central.get(STORES.APP_SETTINGS, MIGRATION_FLAG_KEY);
  if (alreadyDone) return { migrated: [], errors: [] };

  // Helper: copy all records from a legacy store to a central store
  async function copyStore(
    legacyDbName: string,
    legacyVersion: number,
    legacyStoreName: string,
    centralStoreName: string,
  ) {
    try {
      const legacyDb = await openDB(legacyDbName, legacyVersion);
      if (!legacyDb.objectStoreNames.contains(legacyStoreName)) {
        legacyDb.close();
        return;
      }
      const all = await legacyDb.getAll(legacyStoreName);
      legacyDb.close();

      if (all.length === 0) return;

      const tx = central.transaction(centralStoreName, "readwrite");
      for (const record of all) {
        await tx.store.put(record);
      }
      await tx.done;
      migrated.push(`${legacyDbName}/${legacyStoreName} → ${centralStoreName} (${all.length} records)`);
    } catch (err) {
      errors.push(`Failed to migrate ${legacyDbName}/${legacyStoreName}: ${err}`);
    }
  }

  // Copy all-key store (like settings which use manual keys)
  async function copyKeyStore(
    legacyDbName: string,
    legacyVersion: number,
    legacyStoreName: string,
    centralStoreName: string,
  ) {
    try {
      const legacyDb = await openDB(legacyDbName, legacyVersion);
      if (!legacyDb.objectStoreNames.contains(legacyStoreName)) {
        legacyDb.close();
        return;
      }
      const keys = await legacyDb.getAllKeys(legacyStoreName);
      const tx = central.transaction(centralStoreName, "readwrite");
      for (const key of keys) {
        const value = await legacyDb.get(legacyStoreName, key);
        await tx.store.put(value, key);
      }
      await tx.done;
      legacyDb.close();
      if (keys.length > 0) {
        migrated.push(`${legacyDbName}/${legacyStoreName} → ${centralStoreName} (${keys.length} records)`);
      }
    } catch (err) {
      errors.push(`Failed to migrate ${legacyDbName}/${legacyStoreName}: ${err}`);
    }
  }

  // ── Bible (sunday-switcher-bible v2) ──
  await copyStore("sunday-switcher-bible", 2, "favorites", STORES.BIBLE_FAVORITES);
  await copyStore("sunday-switcher-bible", 2, "history", STORES.BIBLE_HISTORY);
  await copyStore("sunday-switcher-bible", 2, "themes", STORES.BIBLE_THEMES);
  await copyKeyStore("sunday-switcher-bible", 2, "settings", STORES.BIBLE_SETTINGS);
  await copyStore("sunday-switcher-bible", 2, "translations", STORES.BIBLE_TRANSLATIONS);

  // ── Worship (obs-church-studio-worship v1) ──
  await copyStore("obs-church-studio-worship", 1, "songs", STORES.WORSHIP_SONGS);

  // ── OBS Registry (sunday-switcher-obs-registry v1) ──
  await copyStore("sunday-switcher-obs-registry", 1, "scenes", STORES.OBS_SCENES);
  await copyStore("sunday-switcher-obs-registry", 1, "inputs", STORES.OBS_INPUTS);
  await copyStore("sunday-switcher-obs-registry", 1, "sceneItems", STORES.OBS_SCENE_ITEMS);

  // ── Multi-View (sunday-mv v2) ──
  await copyStore("sunday-mv", 2, "layouts", STORES.MV_LAYOUTS);
  await copyStore("sunday-mv", 2, "assets", STORES.MV_ASSETS);
  await copyStore("sunday-mv", 2, "mappings", STORES.MV_MAPPINGS);
  await copyStore("sunday-mv", 2, "media-library", STORES.MV_MEDIA);

  // ── Speakers from localStorage ──
  try {
    const raw = localStorage.getItem("service-hub.speaker.presets");
    if (raw) {
      const presets = JSON.parse(raw);
      if (Array.isArray(presets)) {
        const tx = central.transaction(STORES.SPEAKERS, "readwrite");
        for (const p of presets) {
          if (p && typeof p === "object" && p.id) {
            await tx.store.put(p);
          }
        }
        await tx.done;
        migrated.push(`localStorage/speaker.presets → ${STORES.SPEAKERS} (${presets.length} records)`);
      }
    }
  } catch (err) {
    errors.push(`Failed to migrate speaker presets: ${err}`);
  }

  // Mark migration done
  await central.put(STORES.APP_SETTINGS, true, MIGRATION_FLAG_KEY);

  if (migrated.length > 0) {
    console.info("[CentralDB] Migration complete:", migrated);
  }
  if (errors.length > 0) {
    console.warn("[CentralDB] Migration errors:", errors);
  }

  return { migrated, errors };
}

// ─── Generic CRUD helpers ─────────────────────────────────────────────────────

/** Get all records from a store */
export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await getCentralDb();
  return db.getAll(store) as Promise<T[]>;
}

/** Get a single record by key */
export async function getByKey<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await getCentralDb();
  return db.get(store, key) as Promise<T | undefined>;
}

/** Put (upsert) a record */
export async function putRecord<T>(store: StoreName, record: T, key?: IDBValidKey): Promise<void> {
  const db = await getCentralDb();
  if (key !== undefined) {
    await db.put(store, record, key);
  } else {
    await db.put(store, record);
  }
}

/** Delete a record by key */
export async function deleteRecord(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await getCentralDb();
  await db.delete(store, key);
}

/** Count records in a store */
export async function countRecords(store: StoreName): Promise<number> {
  const db = await getCentralDb();
  return db.count(store);
}

/** Clear all records from a store */
export async function clearStore(store: StoreName): Promise<void> {
  const db = await getCentralDb();
  await db.clear(store);
}

// ─── Dev Dashboard data ───────────────────────────────────────────────────────

export interface StoreInfo {
  name: string;
  count: number;
  indexes: string[];
  sampleRecords: unknown[];
}

/**
 * Returns a summary of every store in the central database.
 * Used by the DevDashboard to render an admin-style data browser.
 */
export async function inspectDatabase(): Promise<StoreInfo[]> {
  const db = await getCentralDb();
  const result: StoreInfo[] = [];

  for (const storeName of db.objectStoreNames) {
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.store;
      const count = await store.count();
      const indexes = Array.from(store.indexNames);

      // Get first 5 records as samples
      const sampleRecords: unknown[] = [];
      let cursor = await store.openCursor();
      let i = 0;
      while (cursor && i < 5) {
        sampleRecords.push(cursor.value);
        cursor = await cursor.continue();
        i++;
      }

      result.push({ name: storeName, count, indexes, sampleRecords });
    } catch (err) {
      result.push({ name: storeName, count: 0, indexes: [], sampleRecords: [] });
    }
  }

  return result;
}
