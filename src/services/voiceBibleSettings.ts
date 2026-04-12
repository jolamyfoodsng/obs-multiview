import { invoke } from "@tauri-apps/api/core";
import { getByKey, putRecord, STORES } from "./db";
import { obsService } from "./obsService";
import type {
  VoiceBibleInputOption,
  VoiceBibleObsInputOption,
  VoiceBibleRuntimeStatus,
  VoiceBibleSettings,
} from "./voiceBibleTypes";

const VOICE_BIBLE_SETTINGS_KEY = "voice-bible-settings";

export const DEFAULT_VOICE_BIBLE_SETTINGS: VoiceBibleSettings = {
  audioSourceMode: "system-mic",
  sttModel: "large-v3",
  semanticMode: "off",
  ollamaBaseUrl: "",
  ollamaModel: "",
  ollamaNormalizerModel: "",
};

const OBS_AUDIO_INPUT_KINDS = new Set([
  "wasapi_input_capture",
  "coreaudio_input_capture",
  "pulse_input_capture",
  "pipewire-audio-capture-source",
  "alsa_input_capture",
]);

function normalizeVoiceBibleSettings(
  raw?: Partial<VoiceBibleSettings> | null,
): VoiceBibleSettings {
  return {
    audioSourceMode:
      raw?.audioSourceMode === "obs-input" ? "obs-input" : "system-mic",
    audioDeviceId:
      typeof raw?.audioDeviceId === "string" && raw.audioDeviceId.trim()
        ? raw.audioDeviceId
        : undefined,
    obsInputName:
      typeof raw?.obsInputName === "string" && raw.obsInputName.trim()
        ? raw.obsInputName
        : undefined,
    sttModel: "large-v3",
    semanticMode: "off",
    ollamaBaseUrl: "",
    ollamaModel: "",
    ollamaNormalizerModel: "",
  };
}

export async function getVoiceBibleSettings(): Promise<VoiceBibleSettings> {
  const raw = await getByKey<VoiceBibleSettings>(
    STORES.APP_SETTINGS,
    VOICE_BIBLE_SETTINGS_KEY,
  ).catch(() => undefined);
  return normalizeVoiceBibleSettings(raw);
}

export async function saveVoiceBibleSettings(
  settings: VoiceBibleSettings,
): Promise<VoiceBibleSettings> {
  const normalized = normalizeVoiceBibleSettings(settings);
  await putRecord(
    STORES.APP_SETTINGS,
    normalized,
    VOICE_BIBLE_SETTINGS_KEY,
  ).catch((err) => {
    console.warn("[voiceBibleSettings] Failed to save settings:", err);
  });
  return normalized;
}

export async function getVoiceBibleRuntimeStatus(): Promise<VoiceBibleRuntimeStatus> {
  return invoke<VoiceBibleRuntimeStatus>("get_voice_bible_runtime_status");
}

export async function prepareVoiceBibleModel(): Promise<VoiceBibleRuntimeStatus> {
  return invoke<VoiceBibleRuntimeStatus>("prepare_voice_bible_model");
}

export async function transcribeVoiceAudio(
  wavData: Uint8Array,
): Promise<string> {
  return invoke<string>("transcribe_voice_audio", {
    wavData: Array.from(wavData),
  });
}

export async function getMicrophonePermissionState(): Promise<PermissionState | "unsupported"> {
  try {
    if (
      typeof navigator === "undefined" ||
      !("permissions" in navigator) ||
      typeof navigator.permissions.query !== "function"
    ) {
      return "unsupported";
    }

    const result = await navigator.permissions.query({
      // TypeScript's PermissionName union does not always include microphone.
      name: "microphone" as PermissionName,
    });
    return result.state;
  } catch {
    return "unsupported";
  }
}

export async function requestMicrophoneAccess(
  deviceId?: string,
): Promise<PermissionState | "unsupported"> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId
        ? {
            deviceId: { exact: deviceId },
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48_000,
            sampleSize: 16,
          }
        : {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48_000,
            sampleSize: 16,
          },
    });
    stream.getTracks().forEach((track) => track.stop());
    return getMicrophonePermissionState();
  } catch {
    return "denied";
  }
}

export async function listAudioInputDevices(): Promise<VoiceBibleInputOption[]> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== "function"
  ) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}

function extractObsInputDeviceId(inputSettings: Record<string, unknown>): string | undefined {
  const candidates = [
    inputSettings.device_id,
    inputSettings.device,
    inputSettings.microphone,
    inputSettings.audio_device_id,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

export async function listObsAudioInputs(): Promise<VoiceBibleObsInputOption[]> {
  if (!obsService.isConnected) return [];

  const inputs = await obsService.getInputList();
  const relevantInputs = inputs.filter((input) =>
    OBS_AUDIO_INPUT_KINDS.has(input.inputKind) ||
    OBS_AUDIO_INPUT_KINDS.has(input.unversionedInputKind),
  );

  const results = await Promise.all(
    relevantInputs.map(async (input) => {
      let deviceId: string | undefined;

      try {
        const response = await obsService.call("GetInputSettings", {
          inputName: input.inputName,
        });
        deviceId = extractObsInputDeviceId(
          (response?.inputSettings ?? {}) as Record<string, unknown>,
        );
      } catch (err) {
        console.warn(
          `[voiceBibleSettings] Failed to inspect OBS input "${input.inputName}":`,
          err,
        );
      }

      return {
        inputName: input.inputName,
        inputKind: input.inputKind,
        label: input.inputName,
        deviceId,
      } satisfies VoiceBibleObsInputOption;
    }),
  );

  return results;
}
