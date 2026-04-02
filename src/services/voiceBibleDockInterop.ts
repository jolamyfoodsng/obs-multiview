import { getOverlayBaseUrlSync } from "./overlayUrl";
import type {
  VoiceBibleContextPayload,
  VoiceBibleResult,
  VoiceBibleSnapshot,
} from "./voiceBibleTypes";

export type VoiceBibleDockCommandType =
  | "voice-bible:start"
  | "voice-bible:stop"
  | "voice-bible:cancel";

export interface VoiceBibleDockCommandEnvelope {
  commandId: string;
  type: VoiceBibleDockCommandType;
  timestamp: number;
  payload?: VoiceBibleContextPayload | null;
}

export interface VoiceBibleDockStateEnvelope {
  snapshot: VoiceBibleSnapshot;
  updatedAt: number;
}

export const VOICE_BIBLE_DOCK_STATE_NAME = "dock-voice-bible-state";

export const VOICE_BIBLE_DOCK_COMMAND_NAMES: Record<VoiceBibleDockCommandType, string> = {
  "voice-bible:start": "dock-voice-bible-start",
  "voice-bible:stop": "dock-voice-bible-stop",
  "voice-bible:cancel": "dock-voice-bible-cancel",
};

export const VOICE_BIBLE_DOCK_COMMAND_TYPES: VoiceBibleDockCommandType[] = [
  "voice-bible:start",
  "voice-bible:stop",
  "voice-bible:cancel",
];

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createVoiceBibleDockCommand(
  type: VoiceBibleDockCommandType,
  payload?: VoiceBibleContextPayload | null,
): VoiceBibleDockCommandEnvelope {
  return {
    commandId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    timestamp: Date.now(),
    payload: payload ?? null,
  };
}

export function getVoiceBibleResultKey(result: VoiceBibleResult | null | undefined): string {
  if (!result) return "";
  return JSON.stringify(result);
}

export async function postVoiceBibleDockCommand(
  command: VoiceBibleDockCommandEnvelope,
  baseUrl = getOverlayBaseUrlSync(),
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/save-dock-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: VOICE_BIBLE_DOCK_COMMAND_NAMES[command.type],
      data: JSON.stringify(command),
    }),
  });

  if (!response.ok) {
    throw new Error(`Voice dock command failed with ${response.status}`);
  }
}

export async function loadVoiceBibleDockState(
  baseUrl = getOverlayBaseUrlSync(),
): Promise<VoiceBibleDockStateEnvelope | null> {
  try {
    const response = await fetch(
      `${baseUrl}/uploads/${VOICE_BIBLE_DOCK_STATE_NAME}.json?_=${Date.now()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const raw = await response.text();
    return parseJson<VoiceBibleDockStateEnvelope>(raw);
  } catch {
    return null;
  }
}

export async function saveVoiceBibleDockState(state: VoiceBibleDockStateEnvelope): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_dock_data", {
    name: VOICE_BIBLE_DOCK_STATE_NAME,
    data: JSON.stringify(state),
  });
}

export async function loadVoiceBibleDockCommand(
  type: VoiceBibleDockCommandType,
): Promise<VoiceBibleDockCommandEnvelope | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("load_dock_data", {
    name: VOICE_BIBLE_DOCK_COMMAND_NAMES[type],
  });
  if (!raw.trim()) return null;
  return parseJson<VoiceBibleDockCommandEnvelope>(raw);
}
