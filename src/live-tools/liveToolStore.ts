import { deleteRecord, getAll, getCentralDb, putRecord, STORES } from "../services/db";
import { DEFAULT_LIVE_TOOL_TEMPLATES } from "./liveToolDefaults";
import type { LiveToolTemplate, LiveToolsSnapshot } from "./types";

function cloneTemplate(template: LiveToolTemplate): LiveToolTemplate {
  return {
    ...template,
    isSystem: template.isSystem ?? false,
  };
}

function mergeTemplates(customTemplates: LiveToolTemplate[]): LiveToolTemplate[] {
  const customById = new Map(customTemplates.map((template) => [template.id, template]));
  const merged = DEFAULT_LIVE_TOOL_TEMPLATES.map((template) => {
    const custom = customById.get(template.id);
    return cloneTemplate(custom ? { ...template, ...custom, isSystem: false } : template);
  });

  for (const custom of customTemplates) {
    if (!DEFAULT_LIVE_TOOL_TEMPLATES.some((template) => template.id === custom.id)) {
      merged.push(cloneTemplate(custom));
    }
  }

  return merged.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export async function getLiveToolTemplates(): Promise<LiveToolTemplate[]> {
  const customTemplates = await getAll<LiveToolTemplate>(STORES.LIVE_TOOL_TEMPLATES);
  return mergeTemplates(customTemplates);
}

export async function getLiveToolsSnapshot(): Promise<LiveToolsSnapshot> {
  const templates = await getLiveToolTemplates();
  return {
    templates,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveLiveToolTemplate(template: LiveToolTemplate): Promise<LiveToolTemplate> {
  const now = new Date().toISOString();
  const record: LiveToolTemplate = {
    ...template,
    isSystem: false,
    updatedAt: now,
  };
  await putRecord(STORES.LIVE_TOOL_TEMPLATES, record);
  await syncLiveToolsToDock();
  await broadcastLiveToolsToDock();
  return record;
}

export async function resetLiveToolTemplate(id: string): Promise<void> {
  await deleteRecord(STORES.LIVE_TOOL_TEMPLATES, id);
  await syncLiveToolsToDock();
  await broadcastLiveToolsToDock();
}

export async function syncLiveToolsToDock(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const snapshot = await getLiveToolsSnapshot();
    await invoke("save_dock_data", {
      name: "dock-live-tools",
      data: JSON.stringify(snapshot),
    });
  } catch (err) {
    console.warn("[liveToolStore] Failed to sync Live Tools to dock:", err);
  }
}

export async function countSavedLiveToolTemplates(): Promise<number> {
  const db = await getCentralDb();
  return db.count(STORES.LIVE_TOOL_TEMPLATES);
}

async function broadcastLiveToolsToDock(): Promise<void> {
  try {
    const { dockBridge } = await import("../services/dockBridge");
    const snapshot = await getLiveToolsSnapshot();
    dockBridge.sendState({
      type: "state:live-tools",
      payload: snapshot,
      timestamp: Date.now(),
    });
  } catch {
    // BroadcastChannel is optional; dock JSON sync above is the durable fallback.
  }
}
