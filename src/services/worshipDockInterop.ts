import type { Song } from "../worship/types";

export interface WorshipDockSongSavePayload {
  id: string;
  title: string;
  artist: string;
  lyrics: string;
  importSourceName?: string;
  importSourceType?: "manual" | "online";
  importSourceUrl?: string;
}

export interface WorshipDockSongSaveCommand {
  commandId: string;
  timestamp: number;
  payload: WorshipDockSongSavePayload;
}

export interface WorshipDockSongSaveResult {
  commandId: string;
  timestamp: number;
  ok: boolean;
  song?: Song;
  error?: string;
}

export const WORSHIP_DOCK_SONG_SAVE_COMMAND_NAME = "dock-worship-song-save";
export const WORSHIP_DOCK_SONG_SAVE_RESULT_NAME = "dock-worship-song-save-result";

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createWorshipDockSongSaveCommand(
  payload: WorshipDockSongSavePayload,
): WorshipDockSongSaveCommand {
  return {
    commandId: `worship-song-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    payload,
  };
}

export async function postWorshipDockSongSaveCommand(
  command: WorshipDockSongSaveCommand,
  baseUrl = window.location.origin,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/save-dock-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: WORSHIP_DOCK_SONG_SAVE_COMMAND_NAME,
      data: JSON.stringify(command),
    }),
  });

  if (!response.ok) {
    throw new Error(`Worship song save command failed with ${response.status}`);
  }
}

export async function loadWorshipDockSongSaveCommand(): Promise<WorshipDockSongSaveCommand | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("load_dock_data", {
    name: WORSHIP_DOCK_SONG_SAVE_COMMAND_NAME,
  });
  if (!raw.trim()) return null;
  return parseJson<WorshipDockSongSaveCommand>(raw);
}

export async function saveWorshipDockSongSaveResult(
  result: WorshipDockSongSaveResult,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_dock_data", {
    name: WORSHIP_DOCK_SONG_SAVE_RESULT_NAME,
    data: JSON.stringify(result),
  });
}

export async function loadWorshipDockSongSaveResult(
  commandId: string,
  baseUrl = window.location.origin,
): Promise<WorshipDockSongSaveResult | null> {
  try {
    const response = await fetch(
      `${baseUrl}/uploads/${WORSHIP_DOCK_SONG_SAVE_RESULT_NAME}.json?_=${Date.now()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const result = parseJson<WorshipDockSongSaveResult>(await response.text());
    if (!result || result.commandId !== commandId) return null;
    return result;
  } catch {
    return null;
  }
}
