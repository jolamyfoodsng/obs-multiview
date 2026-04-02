export type VoiceBibleStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "matching"
  | "no-match"
  | "error";

export type VoiceBibleAudioSourceMode = "system-mic" | "obs-input";
export type VoiceBibleSemanticMode = "ollama" | "lexical-only";
export type VoiceBibleModel = "medium.en";

export interface VoiceBibleSettings {
  audioSourceMode: VoiceBibleAudioSourceMode;
  audioDeviceId?: string;
  obsInputName?: string;
  sttModel: VoiceBibleModel;
  semanticMode: VoiceBibleSemanticMode;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

export interface VoiceBibleRuntimeStatus {
  modelReady: boolean;
  modelName: string;
  modelPath?: string | null;
}

export interface VoiceBibleInputOption {
  id: string;
  label: string;
}

export interface VoiceBibleObsInputOption {
  inputName: string;
  inputKind: string;
  label: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface VoiceBibleContextPayload {
  selectedBook?: string | null;
  selectedChapter?: number | null;
  selectedVerse?: number | null;
  translation: string;
  availableTranslations: Array<{ value: string; label: string }>;
}

export interface VoiceBibleCandidate {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  label: string;
  snippet: string;
  confidence: number;
}

export interface VoiceBibleResult {
  action: "stage-verse" | "set-chapter" | "set-translation";
  transcript: string;
  detail?: string;
  confidence?: number;
  book?: string;
  chapter?: number;
  verse?: number;
  translation?: string;
}

export interface VoiceBibleSnapshot {
  status: VoiceBibleStatus;
  detail?: string;
  transcript?: string;
  error?: string;
  modelReady: boolean;
  semanticReady: boolean;
  sourceLabel?: string;
  candidates: VoiceBibleCandidate[];
  lastResult?: VoiceBibleResult | null;
}
