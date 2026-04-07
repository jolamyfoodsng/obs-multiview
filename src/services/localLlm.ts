import { invoke } from "@tauri-apps/api/core";
import type { VoiceBibleSettings } from "./voiceBibleTypes";

const DEFAULT_STOP_SEQUENCES = [
  "<|im_end|>",
  "<|end|>",
  "<|endoftext|>",
  "<|eot_id|>",
];

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
    .trim();
}

async function generateOllamaText(
  settings: VoiceBibleSettings,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const baseUrl = settings.ollamaBaseUrl?.trim();
  const model = settings.ollamaNormalizerModel?.trim() || settings.ollamaModel?.trim();

  if (!baseUrl || !model) {
    throw new Error("Configure Ollama before using text cleanup.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0,
        top_p: 0.05,
        num_predict: maxTokens,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama text cleanup failed with ${response.status}`);
  }

  const payload = await response.json() as { response?: string };
  return sanitizeTextCleanupOutput(payload.response ?? "");
}

export async function getLocalLlmRuntimeStatus(): Promise<LocalLlmRuntimeStatus> {
  return invoke<LocalLlmRuntimeStatus>("get_local_llm_runtime_status");
}

export async function installLocalLlmModel(sourcePath?: string): Promise<LocalLlmRuntimeStatus> {
  return invoke<LocalLlmRuntimeStatus>("install_local_llm_model", {
    sourcePath,
  });
}

export async function generateLocalLlmText(
  request: LocalLlmGenerationRequest,
): Promise<string> {
  const response = await invoke<string>("generate_local_llm_text", {
    request: {
      ...request,
      stop: request.stop?.length ? request.stop : DEFAULT_STOP_SEQUENCES,
    },
  });
  return sanitizeTextCleanupOutput(response);
}

export async function cleanupSermonSlideText(
  text: string,
  settings: VoiceBibleSettings,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const prompt = [
    "Clean up this sermon slide text for live presentation.",
    "Return ONLY the cleaned slide text.",
    "Keep the meaning, tone, and line breaks when helpful.",
    "Fix spelling, punctuation, spacing, capitalization, and obvious speech-to-text mistakes.",
    "Do not add commentary, labels, bullets, or quotation marks unless already needed in the text.",
    "",
    trimmed,
  ].join("\n");

  if (settings.semanticMode === "local") {
    return generateLocalLlmText({
      systemPrompt: "You rewrite short church presentation text. Return only the corrected slide text.",
      prompt,
      maxTokens: 96,
    });
  }

  if (settings.semanticMode === "ollama") {
    return generateOllamaText(settings, prompt, 96);
  }

  throw new Error("Select Local or Ollama as the LLM provider before using text cleanup.");
}
