import type { VoiceBibleSettings } from "./voiceBibleTypes";

export interface LocalLlmRuntimeStatus {
  modelReady: boolean;
  modelName: string;
  modelPath?: string | null;
  expectedPath: string;
  installSourcePath?: string | null;
  installActionAvailable: boolean;
  loaded: boolean;
}

export interface LocalLlmGenerationRequest {
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  stop?: string[];
}

function sanitizeTextCleanupOutput(value: string): string {
  return value
    .replace(/<\|im_end\|>|<\|end\|>|<\|endoftext\|>|<\|eot_id\|>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sentenceCaseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function deterministicTextCleanup(text: string): string {
  const cleaned = text
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([^\s])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .replace(/\b(i)\b/g, "I");

  const lines = cleaned
    .split(/\n+/)
    .map((line) => sentenceCaseLine(line))
    .filter(Boolean);

  return sanitizeTextCleanupOutput(lines.join("\n"));
}

export async function getLocalLlmRuntimeStatus(): Promise<LocalLlmRuntimeStatus> {
  return {
    modelReady: false,
    modelName: "Disabled",
    modelPath: null,
    expectedPath: "",
    installSourcePath: null,
    installActionAvailable: false,
    loaded: false,
  };
}

export async function installLocalLlmModel(sourcePath?: string): Promise<LocalLlmRuntimeStatus> {
  void sourcePath;
  return getLocalLlmRuntimeStatus();
}

export async function generateLocalLlmText(
  request: LocalLlmGenerationRequest,
): Promise<string> {
  return sanitizeTextCleanupOutput(request.prompt);
}

export async function cleanupSermonSlideText(
  text: string,
  settings: VoiceBibleSettings,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  void settings;
  return deterministicTextCleanup(trimmed);
}
