/**
 * obsRegistry.ts — Persistent UUID tracking for every OBS object the app creates
 *
 * Stores sceneUuid, inputUuid, sceneItemId for all OBS objects created by
 * OBS Church Studio. Uses IndexedDB for persistence across sessions.
 *
 * Why?
 *   - OBS identifies objects by UUID internally. Names can be renamed by the user.
 *   - After a restart, we need to find our objects even if they were renamed.
 *   - This registry lets us look up objects by their original slot/purpose.
 *
 * Naming convention:
 *   - All auto-created OBS objects are prefixed with "SS " for human clarity.
 *   - Each registered entry tracks `createdBy: "OBSChurchStudio"` and a timestamp.
 */

import { openDB, type IDBPDatabase } from "idb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredScene {
  /** Our internal slot name, e.g. "bible-overlay", "multiview-layout-3" */
  slot: string;
  /** OBS scene UUID (stable even after rename) */
  sceneUuid: string;
  /** Original scene name at creation time */
  sceneName: string;
  /** ISO timestamp when we created this */
  createdAt: string;
  createdBy: "OBSChurchStudio";
}

export interface RegisteredInput {
  /** Our internal slot name, e.g. "bible-browser-source", "mv-color-bg-3" */
  slot: string;
  /** OBS input UUID (stable even after rename) */
  inputUuid: string;
  /** Original input name at creation time */
  inputName: string;
  /** OBS input kind, e.g. "browser_source", "color_source_v3" */
  inputKind: string;
  /** ISO timestamp */
  createdAt: string;
  createdBy: "OBSChurchStudio";
}

export interface RegisteredSceneItem {
  /** Composite key: slot of the scene + slot of the input */
  slot: string;
  /** The scene this item lives in (slot reference) */
  sceneSlot: string;
  /** The input this item references (slot reference) */
  inputSlot: string;
  /** OBS scene item ID (integer, stable within the scene) */
  sceneItemId: number;
  /** The scene UUID it belongs to */
  sceneUuid: string;
  /** ISO timestamp */
  createdAt: string;
  createdBy: "OBSChurchStudio";
}

// ---------------------------------------------------------------------------
// IndexedDB setup
// ---------------------------------------------------------------------------

const DB_NAME = "sunday-switcher-obs-registry"; // legacy name — do not change (breaks existing user data)
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Scenes store — keyed by slot
        if (!db.objectStoreNames.contains("scenes")) {
          const store = db.createObjectStore("scenes", { keyPath: "slot" });
          store.createIndex("sceneUuid", "sceneUuid", { unique: true });
        }
        // Inputs store — keyed by slot
        if (!db.objectStoreNames.contains("inputs")) {
          const store = db.createObjectStore("inputs", { keyPath: "slot" });
          store.createIndex("inputUuid", "inputUuid", { unique: true });
        }
        // Scene items store — keyed by slot
        if (!db.objectStoreNames.contains("sceneItems")) {
          const store = db.createObjectStore("sceneItems", { keyPath: "slot" });
          store.createIndex("sceneSlot", "sceneSlot");
          store.createIndex("inputSlot", "inputSlot");
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Scene registration
// ---------------------------------------------------------------------------

/**
 * Register a scene that OBS Church Studio created.
 * Uses upsert — if the slot already exists, it updates the UUID.
 */
export async function registerScene(
  slot: string,
  sceneUuid: string,
  sceneName: string
): Promise<RegisteredScene> {
  const db = await getDb();
  const entry: RegisteredScene = {
    slot,
    sceneUuid,
    sceneName,
    createdAt: new Date().toISOString(),
    createdBy: "OBSChurchStudio",
  };
  await db.put("scenes", entry);
  console.log(`[OBSRegistry] Registered scene "${sceneName}" (${sceneUuid}) → slot "${slot}"`);
  return entry;
}

/**
 * Get a registered scene by its slot name.
 */
export async function getSceneBySlot(slot: string): Promise<RegisteredScene | undefined> {
  const db = await getDb();
  return db.get("scenes", slot);
}

/**
 * Get a registered scene by its UUID.
 */
export async function getSceneByUuid(sceneUuid: string): Promise<RegisteredScene | undefined> {
  const db = await getDb();
  return db.getFromIndex("scenes", "sceneUuid", sceneUuid);
}

/**
 * Get all registered scenes.
 */
export async function getAllScenes(): Promise<RegisteredScene[]> {
  const db = await getDb();
  return db.getAll("scenes");
}

// ---------------------------------------------------------------------------
// Input registration
// ---------------------------------------------------------------------------

/**
 * Register an input (source) that OBS Church Studio created.
 */
export async function registerInput(
  slot: string,
  inputUuid: string,
  inputName: string,
  inputKind: string
): Promise<RegisteredInput> {
  const db = await getDb();
  const entry: RegisteredInput = {
    slot,
    inputUuid,
    inputName,
    inputKind,
    createdAt: new Date().toISOString(),
    createdBy: "OBSChurchStudio",
  };
  await db.put("inputs", entry);
  console.log(`[OBSRegistry] Registered input "${inputName}" (${inputUuid}) → slot "${slot}"`);
  return entry;
}

/**
 * Get a registered input by its slot name.
 */
export async function getInputBySlot(slot: string): Promise<RegisteredInput | undefined> {
  const db = await getDb();
  return db.get("inputs", slot);
}

/**
 * Get a registered input by its UUID.
 */
export async function getInputByUuid(inputUuid: string): Promise<RegisteredInput | undefined> {
  const db = await getDb();
  return db.getFromIndex("inputs", "inputUuid", inputUuid);
}

/**
 * Get all registered inputs.
 */
export async function getAllInputs(): Promise<RegisteredInput[]> {
  const db = await getDb();
  return db.getAll("inputs");
}

// ---------------------------------------------------------------------------
// Scene item registration
// ---------------------------------------------------------------------------

/**
 * Register a scene item (the link between a scene and an input).
 */
export async function registerSceneItem(
  slot: string,
  sceneSlot: string,
  inputSlot: string,
  sceneItemId: number,
  sceneUuid: string
): Promise<RegisteredSceneItem> {
  const db = await getDb();
  const entry: RegisteredSceneItem = {
    slot,
    sceneSlot,
    inputSlot,
    sceneItemId,
    sceneUuid,
    createdAt: new Date().toISOString(),
    createdBy: "OBSChurchStudio",
  };
  await db.put("sceneItems", entry);
  console.log(
    `[OBSRegistry] Registered sceneItem #${sceneItemId} (scene: "${sceneSlot}", input: "${inputSlot}") → slot "${slot}"`
  );
  return entry;
}

/**
 * Get a registered scene item by its slot name.
 */
export async function getSceneItemBySlot(slot: string): Promise<RegisteredSceneItem | undefined> {
  const db = await getDb();
  return db.get("sceneItems", slot);
}

/**
 * Get all scene items belonging to a scene slot.
 */
export async function getSceneItemsBySceneSlot(sceneSlot: string): Promise<RegisteredSceneItem[]> {
  const db = await getDb();
  return db.getAllFromIndex("sceneItems", "sceneSlot", sceneSlot);
}

/**
 * Get all registered scene items.
 */
export async function getAllSceneItems(): Promise<RegisteredSceneItem[]> {
  const db = await getDb();
  return db.getAll("sceneItems");
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find all registered objects for a given slot prefix.
 * E.g. findBySlot("bible") returns all scenes, inputs, items whose slot starts with "bible".
 */
export async function findBySlot(slotPrefix: string): Promise<{
  scenes: RegisteredScene[];
  inputs: RegisteredInput[];
  sceneItems: RegisteredSceneItem[];
}> {
  const [scenes, inputs, sceneItems] = await Promise.all([
    getAllScenes(),
    getAllInputs(),
    getAllSceneItems(),
  ]);

  return {
    scenes: scenes.filter((s) => s.slot.startsWith(slotPrefix)),
    inputs: inputs.filter((i) => i.slot.startsWith(slotPrefix)),
    sceneItems: sceneItems.filter((si) => si.slot.startsWith(slotPrefix)),
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Remove all registry entries for a given slot prefix.
 * Call this when tearing down a layout or feature.
 */
export async function cleanupBySlot(slotPrefix: string): Promise<void> {
  const db = await getDb();

  const [scenes, inputs, sceneItems] = await Promise.all([
    getAllScenes(),
    getAllInputs(),
    getAllSceneItems(),
  ]);

  const tx = db.transaction(["scenes", "inputs", "sceneItems"], "readwrite");

  for (const s of scenes) {
    if (s.slot.startsWith(slotPrefix)) {
      await tx.objectStore("scenes").delete(s.slot);
    }
  }
  for (const i of inputs) {
    if (i.slot.startsWith(slotPrefix)) {
      await tx.objectStore("inputs").delete(i.slot);
    }
  }
  for (const si of sceneItems) {
    if (si.slot.startsWith(slotPrefix)) {
      await tx.objectStore("sceneItems").delete(si.slot);
    }
  }

  await tx.done;
  console.log(`[OBSRegistry] Cleaned up all entries with slot prefix "${slotPrefix}"`);
}

/**
 * Remove a single scene, its inputs, and its scene items by scene slot.
 */
export async function cleanupLayout(sceneSlot: string): Promise<void> {
  const db = await getDb();

  // Find scene items for this scene
  const sceneItems = await getSceneItemsBySceneSlot(sceneSlot);
  const inputSlots = new Set(sceneItems.map((si) => si.inputSlot));

  const tx = db.transaction(["scenes", "inputs", "sceneItems"], "readwrite");

  // Remove scene items
  for (const si of sceneItems) {
    await tx.objectStore("sceneItems").delete(si.slot);
  }

  // Remove inputs that were exclusive to this scene
  for (const inputSlot of inputSlots) {
    // Check if any other scene item references this input
    const allItems = await getAllSceneItems();
    const otherRefs = allItems.filter(
      (si) => si.inputSlot === inputSlot && si.sceneSlot !== sceneSlot
    );
    if (otherRefs.length === 0) {
      await tx.objectStore("inputs").delete(inputSlot);
    }
  }

  // Remove scene
  await tx.objectStore("scenes").delete(sceneSlot);

  await tx.done;
  console.log(`[OBSRegistry] Cleaned up layout "${sceneSlot}" and its exclusive inputs`);
}

/**
 * Clear the entire registry. Use with caution!
 */
export async function clearRegistry(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["scenes", "inputs", "sceneItems"], "readwrite");
  await tx.objectStore("scenes").clear();
  await tx.objectStore("inputs").clear();
  await tx.objectStore("sceneItems").clear();
  await tx.done;
  console.log("[OBSRegistry] Registry cleared");
}

/**
 * Get a summary of the registry for debugging.
 */
export async function getRegistrySummary(): Promise<{
  sceneCount: number;
  inputCount: number;
  sceneItemCount: number;
  scenes: RegisteredScene[];
  inputs: RegisteredInput[];
  sceneItems: RegisteredSceneItem[];
}> {
  const [scenes, inputs, sceneItems] = await Promise.all([
    getAllScenes(),
    getAllInputs(),
    getAllSceneItems(),
  ]);

  return {
    sceneCount: scenes.length,
    inputCount: inputs.length,
    sceneItemCount: sceneItems.length,
    scenes,
    inputs,
    sceneItems,
  };
}
