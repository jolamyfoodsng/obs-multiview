import { dockBridge } from "./dockBridge";
import {
  loadVoiceBibleDockCommand,
  saveVoiceBibleDockState,
  VOICE_BIBLE_DOCK_COMMAND_TYPES,
  type VoiceBibleDockCommandType,
} from "./voiceBibleDockInterop";
import { resolveVoiceBibleIntent } from "./voiceBibleMatcher";
import {
  getVoiceBibleRuntimeStatus,
  getVoiceBibleSettings,
  isOllamaModelReady,
  listAudioInputDevices,
  listObsAudioInputs,
  prepareVoiceBibleModel,
  transcribeVoiceAudio,
} from "./voiceBibleSettings";
import { getLocalLlmRuntimeStatus } from "./localLlm";
import type {
  VoiceBibleContextPayload,
  VoiceBibleSnapshot,
} from "./voiceBibleTypes";

const TARGET_SAMPLE_RATE = 16_000;
const VOICE_BIBLE_FALLBACK_POLL_INTERVAL_MS = 420;
const LIVE_TRANSCRIPTION_INTERVAL_MS = 320;
const LIVE_TRANSCRIPTION_MIN_SECONDS = 0.6;
const LIVE_TRANSCRIPTION_WINDOW_SECONDS = 1.6;
const LIVE_TRANSCRIPTION_DELTA_SECONDS = 0.38;
const LIVE_TRANSCRIPTION_PHRASE_SILENCE_MS = 300;
const LIVE_TRANSCRIPTION_FORCE_SECONDS = 1.2;
const LIVE_TRANSCRIPTION_MAX_BUFFER_SECONDS = 6;
const LIVE_TRANSCRIPTION_MAX_DISPLAY_WORDS = 220;
const LIVE_MATCH_WINDOW_WORD_COUNTS = [12, 8, 5, 3];
const LIVE_MATCH_MIN_WORDS = 2;
const MIC_CAPTURE_PREAMP = 1.9;
const MIC_VOICE_HIGH_PASS_HZ = 115;
const MIC_VOICE_LOW_PASS_HZ = 4_600;
const MIC_VOICE_PRESENCE_HZ = 2_100;
const MIC_VOICE_PRESENCE_GAIN_DB = 3.4;
const MIC_COMPRESSOR_THRESHOLD_DB = -24;
const MIC_COMPRESSOR_KNEE_DB = 18;
const MIC_COMPRESSOR_RATIO = 3.2;
const MIC_COMPRESSOR_ATTACK_SECONDS = 0.003;
const MIC_COMPRESSOR_RELEASE_SECONDS = 0.14;
const INPUT_NOISE_GATE_THRESHOLD = 0.0062;
const INPUT_NOISE_GATE_ATTENUATION = 0.1;
const INPUT_NOISE_GATE_MULTIPLIER = 1.8;
const INPUT_NOISE_GATE_SUBTRACTION = 0.32;
const INPUT_NOISE_GATE_KNEE_MULTIPLIER = 1.75;
const INPUT_SOFT_CLIP_DRIVE = 1.06;
const TRANSCRIPTION_ACTIVITY_THRESHOLD = 0.0031;
const TRANSCRIPTION_TARGET_RMS = 0.17;
const TRANSCRIPTION_TARGET_PEAK = 0.95;
const TRANSCRIPTION_MAX_GAIN = 4.8;
const LOW_VALUE_FILLER_WORDS = new Set([
  "ah",
  "eh",
  "ha",
  "hmm",
  "mm",
  "mmm",
  "nah",
  "no",
  "oh",
  "uh",
  "um",
  "yeah",
  "yes",
]);
const NON_ASCII_TRANSCRIPT_PATTERN = /[^\x00-\x7F]/;

function buildDefaultSnapshot(): VoiceBibleSnapshot {
  return {
    status: "idle",
    inputLevel: 0,
    matching: false,
    modelReady: false,
    semanticReady: false,
    candidates: [],
    lastResult: null,
  };
}

function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function getRecentChunks(
  chunks: Float32Array[],
  sampleRate: number,
  seconds: number,
): Float32Array[] {
  const targetSamples = Math.max(1, Math.round(sampleRate * seconds));
  let collectedSamples = 0;
  const selected: Float32Array[] = [];

  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    selected.push(chunk);
    collectedSamples += chunk.length;
    if (collectedSamples >= targetSamples) {
      break;
    }
  }

  return selected.reverse();
}

function trimTranscriptToDisplayWords(words: string[]): string {
  return words.slice(-LIVE_TRANSCRIPTION_MAX_DISPLAY_WORDS).join(" ");
}

function countWords(value: string | undefined): number {
  return value?.split(/\s+/).filter(Boolean).length ?? 0;
}

function sanitizeLiveTranscriptText(value: string): string {
  return value
    .replace(/[^\x00-\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRepeatedTokenRun(tokens: string[], runLength: number): boolean {
  if (tokens.length < runLength) return false;

  let currentRun = 1;
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === tokens[index - 1]) {
      currentRun += 1;
      if (currentRun >= runLength) {
        return true;
      }
    } else {
      currentRun = 1;
    }
  }

  return false;
}

function buildLiveMatchWindows(transcript: string): string[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length < LIVE_MATCH_MIN_WORDS) {
    return [];
  }

  const windows: string[] = [];
  const addWindow = (slice: string[]) => {
    const value = slice.join(" ").trim();
    if (countWords(value) < LIVE_MATCH_MIN_WORDS) return;
    if (!windows.includes(value)) {
      windows.push(value);
    }
  };

  addWindow(words.length <= 16 ? words : words.slice(-16));
  for (const size of LIVE_MATCH_WINDOW_WORD_COUNTS) {
    if (words.length >= size) {
      addWindow(words.slice(-size));
    }
  }

  if (words.length >= 6) {
    addWindow(words.slice(-6));
  }

  return windows;
}

function trimAudioChunksToRecentWindow(
  chunks: Float32Array[],
  sampleRate: number,
  seconds: number,
): Float32Array[] {
  if (chunks.length === 0) {
    return chunks;
  }

  const targetSamples = Math.max(1, Math.round(sampleRate * seconds));
  let collectedSamples = 0;
  let startIndex = chunks.length - 1;

  for (; startIndex >= 0; startIndex -= 1) {
    collectedSamples += chunks[startIndex].length;
    if (collectedSamples >= targetSamples) {
      break;
    }
  }

  if (startIndex <= 0) {
    return chunks;
  }

  return chunks.slice(startIndex);
}

function normalizeTranscriptWord(word: string): string {
  return word.toLowerCase().replace(/[^\w']/g, "");
}

function isLowValueLiveTranscript(value: string): boolean {
  const sanitized = sanitizeLiveTranscriptText(value);
  if (!sanitized) return true;
  if (NON_ASCII_TRANSCRIPT_PATTERN.test(value)) return true;

  const tokens = sanitized
    .toLowerCase()
    .replace(/[^\w\s:']/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return true;
  if (tokens.length <= 2) return false;

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const uniqueCount = counts.size;
  const highestFrequency = Math.max(...counts.values());
  const fillerOnly = tokens.every((token) => LOW_VALUE_FILLER_WORDS.has(token));

  if (fillerOnly && tokens.length >= 2) {
    return true;
  }

  if (hasRepeatedTokenRun(tokens, 4)) {
    return true;
  }

  if (tokens.length >= 4 && uniqueCount <= 2) {
    return true;
  }

  if (tokens.length >= 5 && highestFrequency / tokens.length >= 0.6) {
    return true;
  }

  return false;
}

function mergeRollingTranscript(existing: string | undefined, incoming: string): string {
  const next = incoming.trim();
  if (!next) {
    return existing?.trim() ?? "";
  }

  const current = existing?.trim() ?? "";
  if (!current) return next;
  if (current === next || current.endsWith(next)) return current;
  if (next.endsWith(current)) return next;

  const currentWords = current.split(/\s+/).filter(Boolean);
  const nextWords = next.split(/\s+/).filter(Boolean);
  const currentNormalizedWords = currentWords
    .map(normalizeTranscriptWord)
    .filter(Boolean);
  const nextNormalizedWords = nextWords
    .map(normalizeTranscriptWord)
    .filter(Boolean);
  const maxOverlap = Math.min(currentWords.length, nextWords.length, 14);

  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    let matches = true;

    for (let index = 0; index < overlap; index += 1) {
      const left = normalizeTranscriptWord(
        currentWords[currentWords.length - overlap + index],
      );
      const right = normalizeTranscriptWord(nextWords[index]);
      if (!left || !right || left !== right) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return [...currentWords, ...nextWords.slice(overlap)].join(" ");
    }
  }

  const currentTail = currentNormalizedWords.slice(-6);
  const nextHead = nextNormalizedWords.slice(0, 6);
  if (
    currentTail.length >= 1 &&
    currentTail.length === nextHead.length &&
    currentTail.every((word, index) => word === nextHead[index])
  ) {
      return trimTranscriptToDisplayWords([
      ...currentWords,
      ...nextWords.slice(currentTail.length),
    ]);
  }

  const currentWordSet = new Set(currentNormalizedWords);
  const sharedNextWordCount = nextNormalizedWords.filter((word) => currentWordSet.has(word)).length;
  const sharedNextWordRatio = nextNormalizedWords.length > 0
    ? sharedNextWordCount / nextNormalizedWords.length
    : 0;

  if (sharedNextWordRatio >= 0.8) {
    return current;
  }

  return trimTranscriptToDisplayWords([...currentWords, ...nextWords]);
}

function downsampleBuffer(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const result = new Float32Array(outputLength);
  let outputOffset = 0;
  let inputOffset = 0;

  while (outputOffset < outputLength) {
    const nextInputOffset = Math.round((outputOffset + 1) * ratio);
    let accumulator = 0;
    let count = 0;

    for (let index = inputOffset; index < nextInputOffset && index < input.length; index += 1) {
      accumulator += input[index];
      count += 1;
    }

    result[outputOffset] = count > 0 ? accumulator / count : 0;
    outputOffset += 1;
    inputOffset = nextInputOffset;
  }

  return result;
}

function preprocessCaptureSamples(input: Float32Array): Float32Array {
  let estimatedNoiseSum = 0;
  let estimatedNoiseCount = 0;

  for (let index = 0; index < input.length; index += 1) {
    const abs = Math.abs(input[index]);
    if (abs <= INPUT_NOISE_GATE_THRESHOLD * 2.4) {
      estimatedNoiseSum += abs;
      estimatedNoiseCount += 1;
    }
  }

  const estimatedNoiseFloor =
    estimatedNoiseCount > 0
      ? estimatedNoiseSum / estimatedNoiseCount
      : INPUT_NOISE_GATE_THRESHOLD;
  const adaptiveGateThreshold = Math.max(
    INPUT_NOISE_GATE_THRESHOLD,
    estimatedNoiseFloor * INPUT_NOISE_GATE_MULTIPLIER,
  );
  const adaptiveGateKnee = adaptiveGateThreshold * INPUT_NOISE_GATE_KNEE_MULTIPLIER;
  const output = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index];
    const abs = Math.abs(raw);
    let shaped = raw;

    if (abs <= adaptiveGateThreshold) {
      shaped = raw * INPUT_NOISE_GATE_ATTENUATION;
    } else {
      const cleanedAbs = Math.max(0, abs - adaptiveGateThreshold * INPUT_NOISE_GATE_SUBTRACTION);
      const kneeBlend =
        abs < adaptiveGateKnee
          ? 0.88 +
            (((abs - adaptiveGateThreshold) /
              Math.max(0.000001, adaptiveGateKnee - adaptiveGateThreshold)) *
              0.12)
          : 1;
      shaped = Math.sign(raw) * cleanedAbs * kneeBlend;
    }

    const boosted = shaped * MIC_CAPTURE_PREAMP;
    const clipped =
      Math.tanh(boosted * INPUT_SOFT_CLIP_DRIVE) / Math.tanh(INPUT_SOFT_CLIP_DRIVE);
    output[index] = Math.max(-1, Math.min(1, clipped));
  }

  return output;
}

function normalizeForTranscription(input: Float32Array): Float32Array {
  let peak = 0;
  let activeSquares = 0;
  let activeCount = 0;

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    if (abs >= TRANSCRIPTION_ACTIVITY_THRESHOLD) {
      activeSquares += value * value;
      activeCount += 1;
    }
  }

  if (!peak || activeCount === 0) {
    return input;
  }

  const activeRms = Math.sqrt(activeSquares / activeCount);
  const rmsGain = activeRms > 0
    ? TRANSCRIPTION_TARGET_RMS / activeRms
    : TRANSCRIPTION_MAX_GAIN;
  const peakGain = TRANSCRIPTION_TARGET_PEAK / peak;
  const gain = Math.max(1, Math.min(TRANSCRIPTION_MAX_GAIN, rmsGain, peakGain));

  if (gain <= 1.02) {
    return input;
  }

  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = Math.max(-0.98, Math.min(0.98, input[index] * gain));
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

class VoiceBibleService {
  private initialized = false;
  private snapshot: VoiceBibleSnapshot = buildDefaultSnapshot();
  private listeners = new Set<(snapshot: VoiceBibleSnapshot) => void>();
  private levelListeners = new Set<(level: number) => void>();
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private highPassNode: BiquadFilterNode | null = null;
  private lowPassNode: BiquadFilterNode | null = null;
  private presenceNode: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sinkNode: GainNode | null = null;
  private audioChunks: Float32Array[] = [];
  private activeContext: VoiceBibleContextPayload | null = null;
  private unsubscribeDock: (() => void) | null = null;
  private requestNonce = 0;
  private fallbackPollTimer: number | null = null;
  private lastProcessedCommandIds: Partial<Record<VoiceBibleDockCommandType, string>> = {};
  private currentLevel = 0;
  private liveTranscriptionTimer: number | null = null;
  private liveTranscriptionInFlight = false;
  private capturedSampleCount = 0;
  private lastInterimCapturedSampleCount = 0;
  private interimTranscript = "";
  private activeSettings: Awaited<ReturnType<typeof getVoiceBibleSettings>> | null = null;
  private liveMatchWorkerActive = false;
  private liveMatchVersion = 0;
  private pendingLiveMatchJob:
    | { version: number; transcript: string; sourceLabel?: string }
    | null = null;
  private lastQueuedMatchTranscript = "";
  private lastSpeechTimestampMs = 0;
  private lastLevelStatusPushMs = 0;

  private isCurrentRequest(requestId: number): boolean {
    return this.requestNonce === requestId;
  }

  init(): () => void {
    if (this.initialized) {
      return () => {
        // noop
      };
    }

    this.initialized = true;
    this.unsubscribeDock = dockBridge.onCommand((cmd) => {
      if (cmd.type === "voice-bible:start" || cmd.type === "voice-bible:stop" || cmd.type === "voice-bible:cancel") {
        void this.handleDockCommand({
          type: cmd.type,
          payload: (cmd.payload ?? null) as VoiceBibleContextPayload | null,
          commandId: cmd.commandId,
        });
      }
    });

    this.startFallbackPolling();
    void this.refreshAvailability();
    return () => {
      this.unsubscribeDock?.();
      this.unsubscribeDock = null;
      this.stopFallbackPolling();
      void this.cancelListening();
      this.initialized = false;
    };
  }

  getSnapshot(): VoiceBibleSnapshot {
    return { ...this.snapshot, candidates: [...this.snapshot.candidates] };
  }

  subscribe(listener: (snapshot: VoiceBibleSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeInputLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener);
    listener(this.currentLevel);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  async startSession(context: VoiceBibleContextPayload | null): Promise<void> {
    await this.startListening(context);
  }

  async stopSession(context: VoiceBibleContextPayload | null): Promise<void> {
    await this.stopListening(context);
  }

  async cancelSession(): Promise<void> {
    await this.cancelListening();
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setInputLevel(level: number): void {
    const nextLevel = Math.max(0, Math.min(1, level));
    this.currentLevel = nextLevel;
    this.snapshot = {
      ...this.snapshot,
      inputLevel: nextLevel,
    };

    const now = Date.now();
    if (
      this.snapshot.status === "listening" &&
      (now - this.lastLevelStatusPushMs >= 90 || nextLevel <= 0.01)
    ) {
      this.lastLevelStatusPushMs = now;
      this.pushStatus();
    }

    for (const listener of this.levelListeners) {
      listener(nextLevel);
    }
  }

  async refreshAvailability(): Promise<VoiceBibleSnapshot> {
    const [runtime, settings] = await Promise.all([
      getVoiceBibleRuntimeStatus().catch(() => ({
        modelReady: false,
        modelName: "large-v3",
        modelPath: null,
      })),
      getVoiceBibleSettings().catch(() => undefined),
    ]);

    const semanticReady =
      settings?.semanticMode === "local"
        ? await getLocalLlmRuntimeStatus()
            .then((status: { modelReady: boolean }) => status.modelReady)
            .catch(() => false)
        : settings?.semanticMode === "ollama" &&
            settings.ollamaBaseUrl &&
            settings.ollamaModel
          ? await isOllamaModelReady(settings.ollamaBaseUrl, settings.ollamaModel)
          : false;

    this.snapshot = {
      ...this.snapshot,
      modelReady: runtime.modelReady,
      semanticReady,
    };
    this.pushStatus();
    return this.getSnapshot();
  }

  private pushStatus(): void {
    this.notifyListeners();
    dockBridge.sendState({
      type: "state:voice-bible-status",
      payload: this.getSnapshot(),
      timestamp: Date.now(),
    });
    this.syncDockState();
  }

  private pushCandidates(): void {
    dockBridge.sendState({
      type: "state:voice-bible-candidates",
      payload: {
        transcript: this.snapshot.transcript ?? "",
        detail: this.snapshot.matchDetail ?? this.snapshot.detail ?? "",
        candidates: this.snapshot.candidates,
      },
      timestamp: Date.now(),
    });
    this.syncDockState();
  }

  private pushResult(): void {
    dockBridge.sendState({
      type: "state:voice-bible-result",
      payload: this.snapshot.lastResult,
      timestamp: Date.now(),
    });
    this.syncDockState();
  }

  private syncDockState(): void {
    void saveVoiceBibleDockState({
      snapshot: this.getSnapshot(),
      updatedAt: Date.now(),
    }).catch((err) => {
      console.warn("[voiceBibleService] Failed to sync dock voice state:", err);
    });
  }

  private startLiveTranscriptionLoop(): void {
    this.stopLiveTranscriptionLoop();

    if (
      typeof window === "undefined" ||
      !this.activeContext?.liveInterim ||
      this.snapshot.status !== "listening"
    ) {
      return;
    }

    const tick = () => {
      void this.processLiveTranscription();
    };

    this.liveTranscriptionTimer = window.setInterval(tick, LIVE_TRANSCRIPTION_INTERVAL_MS);
    window.setTimeout(tick, LIVE_TRANSCRIPTION_INTERVAL_MS);
  }

  private stopLiveTranscriptionLoop(): void {
    if (this.liveTranscriptionTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.liveTranscriptionTimer);
    }
    this.liveTranscriptionTimer = null;
    this.liveTranscriptionInFlight = false;
    this.liveMatchWorkerActive = false;
    this.liveMatchVersion = 0;
    this.pendingLiveMatchJob = null;
    this.lastQueuedMatchTranscript = "";
    this.capturedSampleCount = 0;
    this.lastInterimCapturedSampleCount = 0;
    this.interimTranscript = "";
    this.lastSpeechTimestampMs = 0;
  }

  private syncActiveContextFromResult(result: NonNullable<VoiceBibleSnapshot["lastResult"]>): void {
    if (!this.activeContext) {
      return;
    }

    if (result.action === "set-translation" && result.translation) {
      this.activeContext = {
        ...this.activeContext,
        translation: result.translation,
      };
      return;
    }

    if (result.action === "set-chapter" && result.book && result.chapter) {
      this.activeContext = {
        ...this.activeContext,
        selectedBook: result.book,
        selectedChapter: result.chapter,
        selectedVerse: null,
        translation: result.translation ?? this.activeContext.translation,
      };
      return;
    }

    if (result.action === "stage-verse" && result.book && result.chapter && result.verse) {
      this.activeContext = {
        ...this.activeContext,
        selectedBook: result.book,
        selectedChapter: result.chapter,
        selectedVerse: result.verse,
        translation: result.translation ?? this.activeContext.translation,
      };
    }
  }

  private queueLiveMatchJob(transcript: string, sourceLabel: string | undefined): void {
    if (
      !this.activeContext?.liveInterim ||
      this.snapshot.status !== "listening"
    ) {
      return;
    }

    const normalized = transcript.trim();
    if (countWords(normalized) < LIVE_MATCH_MIN_WORDS) {
      return;
    }

    if (normalized === this.lastQueuedMatchTranscript) {
      return;
    }

    this.lastQueuedMatchTranscript = normalized;
    this.pendingLiveMatchJob = {
      version: ++this.liveMatchVersion,
      transcript: normalized,
      sourceLabel,
    };
    this.snapshot = {
      ...this.snapshot,
      matching: true,
      matchDetail: "Searching scripture in the background…",
    };
    this.pushStatus();

    if (!this.liveMatchWorkerActive) {
      void this.runLiveMatchWorker();
    }
  }

  private applyLiveMatchIntent(
    transcript: string,
    sourceLabel: string | undefined,
    intent: Awaited<ReturnType<typeof resolveVoiceBibleIntent>>,
  ): void {
    if (intent.kind === "result") {
      this.syncActiveContextFromResult(intent.result);
      this.snapshot = {
        ...this.snapshot,
        status: "listening",
        transcript,
        matchDetail: intent.result.detail ?? "Live match detected",
        matching: false,
        candidates: intent.candidates,
        lastResult: intent.result,
        error: undefined,
        sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
      this.pushResult();
      return;
    }

    if (intent.kind === "candidates") {
      this.snapshot = {
        ...this.snapshot,
        status: "listening",
        transcript,
        matchDetail: intent.detail,
        matching: false,
        candidates: intent.candidates,
        lastResult: null,
        error: undefined,
        sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      status: "listening",
      transcript,
      matchDetail: "No confident verse match yet. Listening for newer words…",
      matching: false,
      candidates: [],
      lastResult: null,
      error: undefined,
      sourceLabel,
    };
    this.pushStatus();
    this.pushCandidates();
  }

  private async runLiveMatchWorker(): Promise<void> {
    if (this.liveMatchWorkerActive) {
      return;
    }

    this.liveMatchWorkerActive = true;

    try {
      while (this.pendingLiveMatchJob) {
        const job = this.pendingLiveMatchJob;
        this.pendingLiveMatchJob = null;

        const sessionNonce = this.requestNonce;
        const activeContext = this.activeContext;
        if (
          !job ||
          !activeContext ||
          !activeContext.liveInterim ||
          this.snapshot.status !== "listening"
        ) {
          continue;
        }

        const settings = this.activeSettings ?? await getVoiceBibleSettings();
        if (
          this.requestNonce !== sessionNonce ||
          job.version !== this.liveMatchVersion ||
          this.snapshot.status !== "listening"
        ) {
          continue;
        }

        const windows = buildLiveMatchWindows(job.transcript);
        let resolvedIntent: Awaited<ReturnType<typeof resolveVoiceBibleIntent>> | null = null;

        for (const windowTranscript of windows) {
          if (
            this.requestNonce !== sessionNonce ||
            job.version !== this.liveMatchVersion ||
            this.snapshot.status !== "listening"
          ) {
            resolvedIntent = null;
            break;
          }

          const intent = await resolveVoiceBibleIntent(
            windowTranscript,
            activeContext,
            settings,
            { fastInterim: true },
          );

          if (
            this.requestNonce !== sessionNonce ||
            job.version !== this.liveMatchVersion ||
            this.snapshot.status !== "listening"
          ) {
            resolvedIntent = null;
            break;
          }

          if (intent.kind !== "none") {
            resolvedIntent = intent;
            break;
          }
        }

        if (
          this.requestNonce !== sessionNonce ||
          job.version !== this.liveMatchVersion ||
          this.snapshot.status !== "listening"
        ) {
          continue;
        }

        this.applyLiveMatchIntent(
          job.transcript,
          job.sourceLabel,
          resolvedIntent ?? {
            kind: "none",
            transcript: job.transcript,
            detail: "No confident verse match",
          },
        );
      }
    } catch (err) {
      console.warn("[voiceBibleService] Live verse matching failed:", err);
      this.snapshot = {
        ...this.snapshot,
        matching: false,
        matchDetail: "Verse search paused. Listening continues.",
      };
      this.pushStatus();
    } finally {
      this.liveMatchWorkerActive = false;
      if (this.pendingLiveMatchJob) {
        void this.runLiveMatchWorker();
      }
    }
  }

  private async processLiveTranscription(): Promise<void> {
    if (
      !this.activeContext?.liveInterim ||
      this.snapshot.status !== "listening" ||
      this.liveTranscriptionInFlight ||
      this.audioChunks.length === 0
    ) {
      return;
    }

    const sampleRate = this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
    const totalCapturedSampleCount = this.capturedSampleCount;
    if (totalCapturedSampleCount < sampleRate * LIVE_TRANSCRIPTION_MIN_SECONDS) {
      return;
    }

    if (
      this.lastInterimCapturedSampleCount > 0 &&
      totalCapturedSampleCount - this.lastInterimCapturedSampleCount < sampleRate * LIVE_TRANSCRIPTION_DELTA_SECONDS
    ) {
      return;
    }

    const now = Date.now();
    const silenceMs =
      this.lastSpeechTimestampMs > 0
        ? now - this.lastSpeechTimestampMs
        : Number.POSITIVE_INFINITY;
    const newPhraseSampleCount =
      this.lastInterimCapturedSampleCount > 0
        ? totalCapturedSampleCount - this.lastInterimCapturedSampleCount
        : totalCapturedSampleCount;
    const phraseReady =
      silenceMs >= LIVE_TRANSCRIPTION_PHRASE_SILENCE_MS ||
      newPhraseSampleCount >= sampleRate * LIVE_TRANSCRIPTION_FORCE_SECONDS;

    if (!phraseReady) {
      return;
    }

    const recentChunks = getRecentChunks(
      this.audioChunks,
      sampleRate,
      LIVE_TRANSCRIPTION_WINDOW_SECONDS,
    );
    if (recentChunks.length === 0) {
      return;
    }

    const sessionNonce = this.requestNonce;
    const sourceLabel = this.snapshot.sourceLabel;
    this.liveTranscriptionInFlight = true;

    try {
      const merged = mergeFloat32Chunks(recentChunks);
      const downsampled = downsampleBuffer(merged, sampleRate, TARGET_SAMPLE_RATE);
      const prepared = normalizeForTranscription(downsampled);
      if (prepared.length < TARGET_SAMPLE_RATE * LIVE_TRANSCRIPTION_MIN_SECONDS) {
        return;
      }

      const wavBytes = encodeWav(prepared, TARGET_SAMPLE_RATE);
      const rawWindowTranscript = await transcribeVoiceAudio(wavBytes);

      if (this.requestNonce !== sessionNonce || this.snapshot.status !== "listening") {
        return;
      }

      this.lastInterimCapturedSampleCount = totalCapturedSampleCount;
      const windowTranscript = sanitizeLiveTranscriptText(rawWindowTranscript);
      if (!windowTranscript.trim()) {
        return;
      }

      const mergedTranscript = mergeRollingTranscript(
        this.interimTranscript || this.snapshot.transcript,
        windowTranscript,
      );

      if (
        !mergedTranscript ||
        mergedTranscript === this.snapshot.transcript
      ) {
        return;
      }

      this.interimTranscript = mergedTranscript;
      this.snapshot = {
        ...this.snapshot,
        status: "listening",
        detail: "Listening live… transcribing as you speak",
        transcript: mergedTranscript,
        matching: this.snapshot.matching,
        error: undefined,
        sourceLabel,
      };
      this.pushStatus();

      if (!isLowValueLiveTranscript(mergedTranscript)) {
        this.queueLiveMatchJob(mergedTranscript, sourceLabel);
      }
    } catch (err) {
      console.warn("[voiceBibleService] Live transcription update failed:", err);
    } finally {
      if (this.requestNonce === sessionNonce) {
        this.liveTranscriptionInFlight = false;
      }
    }
  }

  private startFallbackPolling(): void {
    if (typeof window === "undefined" || this.fallbackPollTimer !== null) {
      return;
    }

    const poll = () => {
      void this.consumeFallbackCommands();
    };

    poll();
    this.fallbackPollTimer = window.setInterval(poll, VOICE_BIBLE_FALLBACK_POLL_INTERVAL_MS);
  }

  private stopFallbackPolling(): void {
    if (this.fallbackPollTimer === null || typeof window === "undefined") return;
    window.clearInterval(this.fallbackPollTimer);
    this.fallbackPollTimer = null;
  }

  private async consumeFallbackCommands(): Promise<void> {
    const commands = await Promise.all(
      VOICE_BIBLE_DOCK_COMMAND_TYPES.map((type) =>
        loadVoiceBibleDockCommand(type).catch(() => null),
      ),
    );

    const pending = commands
      .filter((command): command is NonNullable<typeof command> => Boolean(command))
      .filter((command) => this.lastProcessedCommandIds[command.type] !== command.commandId)
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const command of pending) {
      await this.handleDockCommand(command);
    }
  }

  private async handleDockCommand(command: {
    type: VoiceBibleDockCommandType;
    payload?: VoiceBibleContextPayload | null;
    commandId?: string;
  }): Promise<void> {
    if (command.commandId && this.lastProcessedCommandIds[command.type] === command.commandId) {
      return;
    }

    if (command.commandId) {
      this.lastProcessedCommandIds[command.type] = command.commandId;
    }

    if (command.type === "voice-bible:start") {
      await this.startListening(command.payload ?? null);
      return;
    }

    if (command.type === "voice-bible:stop") {
      await this.stopListening(command.payload ?? null);
      return;
    }

    await this.cancelListening();
  }

  private async resolveSource(
    settings: Awaited<ReturnType<typeof getVoiceBibleSettings>>,
  ): Promise<{ deviceId?: string; sourceLabel: string }> {
    if (settings.audioSourceMode === "obs-input") {
      if (!settings.obsInputName) {
        throw new Error("Select an OBS input source in Voice Bible settings.");
      }

      const obsInputs = await listObsAudioInputs();
      const selected = obsInputs.find(
        (item) => item.inputName === settings.obsInputName,
      );
      if (!selected) {
        throw new Error(`OBS input "${settings.obsInputName}" is unavailable.`);
      }
      if (!selected.deviceId) {
        throw new Error(
          `OBS input "${settings.obsInputName}" could not be mapped to a microphone device.`,
        );
      }

      return {
        deviceId: selected.deviceId,
        sourceLabel: selected.label,
      };
    }

    if (settings.audioDeviceId) {
      const devices = await listAudioInputDevices();
      const selected = devices.find((device) => device.id === settings.audioDeviceId);
      if (selected) {
        return {
          deviceId: selected.id,
          sourceLabel: selected.label,
        };
      }
    }

    return {
      deviceId: settings.audioDeviceId,
      sourceLabel: "System microphone",
    };
  }

  private async startListening(context: VoiceBibleContextPayload | null): Promise<void> {
    if (this.snapshot.status === "listening") return;
    const requestId = ++this.requestNonce;
    this.activeContext = context;
    this.setInputLevel(0);
    this.snapshot = {
      ...this.snapshot,
      status: "transcribing",
      detail: "Loading voice settings…",
      transcript: undefined,
      matchDetail: undefined,
      matching: false,
      error: undefined,
      candidates: [],
      lastResult: null,
    };
    this.pushStatus();

    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        throw new Error("Microphone capture is unavailable in this app environment.");
      }

      const settings = await getVoiceBibleSettings();
      this.activeSettings = settings;
      if (requestId !== this.requestNonce) return;
      this.snapshot = {
        ...this.snapshot,
        status: "transcribing",
        detail: "Resolving microphone source…",
        error: undefined,
      };
      this.pushStatus();
      const source = await this.resolveSource(settings);
      if (requestId !== this.requestNonce) return;

      if (!this.snapshot.modelReady) {
        this.snapshot = {
          ...this.snapshot,
          status: "transcribing",
          detail: "Downloading Whisper model…",
          error: undefined,
          sourceLabel: source.sourceLabel,
        };
        this.pushStatus();
        await prepareVoiceBibleModel();
      }

      if (requestId !== this.requestNonce) return;

      this.snapshot = {
        ...this.snapshot,
        status: "transcribing",
        detail: "Requesting microphone access…",
        error: undefined,
        sourceLabel: source.sourceLabel,
      };
      this.pushStatus();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: source.deviceId
          ? {
              deviceId: { exact: source.deviceId },
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

      const audioContext = new AudioContext();
      this.snapshot = {
        ...this.snapshot,
        status: "transcribing",
        detail: "Starting microphone…",
        error: undefined,
        sourceLabel: source.sourceLabel,
      };
      this.pushStatus();
      await audioContext.resume();
      if (requestId !== this.requestNonce) {
        stream.getTracks().forEach((track) => track.stop());
        await audioContext.close().catch(() => undefined);
        return;
      }

      const mediaSource = audioContext.createMediaStreamSource(stream);
      const highPassNode = audioContext.createBiquadFilter();
      highPassNode.type = "highpass";
      highPassNode.frequency.value = MIC_VOICE_HIGH_PASS_HZ;
      highPassNode.Q.value = 0.707;

      const lowPassNode = audioContext.createBiquadFilter();
      lowPassNode.type = "lowpass";
      lowPassNode.frequency.value = MIC_VOICE_LOW_PASS_HZ;
      lowPassNode.Q.value = 0.707;

      const presenceNode = audioContext.createBiquadFilter();
      presenceNode.type = "peaking";
      presenceNode.frequency.value = MIC_VOICE_PRESENCE_HZ;
      presenceNode.Q.value = 0.95;
      presenceNode.gain.value = MIC_VOICE_PRESENCE_GAIN_DB;

      const compressorNode = audioContext.createDynamicsCompressor();
      compressorNode.threshold.value = MIC_COMPRESSOR_THRESHOLD_DB;
      compressorNode.knee.value = MIC_COMPRESSOR_KNEE_DB;
      compressorNode.ratio.value = MIC_COMPRESSOR_RATIO;
      compressorNode.attack.value = MIC_COMPRESSOR_ATTACK_SECONDS;
      compressorNode.release.value = MIC_COMPRESSOR_RELEASE_SECONDS;

      const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      const sinkNode = audioContext.createGain();
      sinkNode.gain.value = 0;

      this.audioChunks = [];
      this.capturedSampleCount = 0;
      processorNode.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer;
        const channelCount = inputBuffer.numberOfChannels;
        const mono = new Float32Array(inputBuffer.length);

        for (let channel = 0; channel < channelCount; channel += 1) {
          const channelData = inputBuffer.getChannelData(channel);
          for (let index = 0; index < channelData.length; index += 1) {
            mono[index] += channelData[index] / channelCount;
          }
        }

        const processed = preprocessCaptureSamples(mono);
        let sumSquares = 0;
        for (let index = 0; index < processed.length; index += 1) {
          sumSquares += processed[index] * processed[index];
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, processed.length));
        const normalizedLevel = Math.min(1, Math.max(0, (rms - 0.004) / 0.09));
        const smoothedLevel = this.currentLevel * 0.72 + normalizedLevel * 0.28;
        this.setInputLevel(smoothedLevel < 0.012 ? 0 : smoothedLevel);
        if (rms >= TRANSCRIPTION_ACTIVITY_THRESHOLD) {
          this.lastSpeechTimestampMs = Date.now();
        }
        this.audioChunks.push(processed);
        this.capturedSampleCount += processed.length;
        this.audioChunks = trimAudioChunksToRecentWindow(
          this.audioChunks,
          audioContext.sampleRate,
          LIVE_TRANSCRIPTION_MAX_BUFFER_SECONDS,
        );
      };

      mediaSource.connect(highPassNode);
      highPassNode.connect(lowPassNode);
      lowPassNode.connect(presenceNode);
      presenceNode.connect(compressorNode);
      compressorNode.connect(processorNode);
      processorNode.connect(sinkNode);
      sinkNode.connect(audioContext.destination);

      this.mediaStream = stream;
      this.audioContext = audioContext;
      this.mediaSource = mediaSource;
      this.highPassNode = highPassNode;
      this.lowPassNode = lowPassNode;
      this.presenceNode = presenceNode;
      this.compressorNode = compressorNode;
      this.processorNode = processorNode;
      this.sinkNode = sinkNode;

      const refreshedSnapshot = await this.refreshAvailability();
      this.snapshot = {
        ...refreshedSnapshot,
        status: "listening",
        detail: this.activeContext?.liveInterim
          ? "Listening live… transcript and verse search run in parallel"
          : "Listening… click the mic again to stop",
        transcript: undefined,
        matchDetail: this.activeContext?.liveInterim
          ? "Waiting for enough spoken context to search scripture…"
          : undefined,
        matching: false,
        error: undefined,
        candidates: [],
        lastResult: null,
        sourceLabel: source.sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
      this.startLiveTranscriptionLoop();
    } catch (err) {
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      await this.teardownAudio();
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      this.setInputLevel(0);
      this.activeSettings = null;
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        detail: "Microphone capture failed",
      };
      this.pushStatus();
    }
  }

  private async stopListening(context: VoiceBibleContextPayload | null): Promise<void> {
    const requestId = ++this.requestNonce;
    this.stopLiveTranscriptionLoop();
    if (context) {
      this.activeContext = context;
    }

    if (this.snapshot.status !== "listening") {
      await this.cancelListening(requestId);
      return;
    }

    const activeContext = this.activeContext;
    if (!activeContext) {
      await this.cancelListening(requestId);
      return;
    }

    const sourceLabel = this.snapshot.sourceLabel;

    if (activeContext.liveInterim) {
      await this.teardownAudio();
      this.setInputLevel(0);
      const refreshedSnapshot = await this.refreshAvailability().catch(() => this.snapshot);
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      this.snapshot = {
        ...refreshedSnapshot,
        status: "idle",
        detail: this.snapshot.transcript
          ? "Live transcription stopped"
          : "Transcription stopped",
        transcript: this.snapshot.transcript,
        matchDetail: this.snapshot.matchDetail,
        matching: false,
        candidates: this.snapshot.candidates,
        lastResult: this.snapshot.lastResult,
        error: undefined,
        sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
      if (this.snapshot.lastResult) {
        this.pushResult();
      }
      this.activeSettings = null;
      return;
    }

    const sampleRate = this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
    const merged = mergeFloat32Chunks(this.audioChunks);
    await this.teardownAudio();
    if (!this.isCurrentRequest(requestId)) {
      return;
    }

    if (merged.length < TARGET_SAMPLE_RATE / 2) {
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        detail: "Speech was too short to process",
        error: "Speak for a little longer before stopping the microphone.",
      };
      this.pushStatus();
      return;
    }

    try {
      this.snapshot = {
        ...this.snapshot,
        status: "transcribing",
        detail: "Processing recording…",
        matchDetail: undefined,
        matching: false,
        error: undefined,
      };
      this.pushStatus();

      const downsampled = downsampleBuffer(merged, sampleRate, TARGET_SAMPLE_RATE);
      const prepared = normalizeForTranscription(downsampled);
      const wavBytes = encodeWav(prepared, TARGET_SAMPLE_RATE);
      const transcript = await transcribeVoiceAudio(wavBytes);

      this.snapshot = {
        ...this.snapshot,
        status: "matching",
        detail: "Matching verse…",
        transcript,
        error: undefined,
      };
      this.pushStatus();

      const settings = this.activeSettings ?? await getVoiceBibleSettings();
      const intent = await resolveVoiceBibleIntent(transcript, activeContext, settings);
      const refreshedSnapshot = await this.refreshAvailability();
      if (!this.isCurrentRequest(requestId)) {
        return;
      }

      if (intent.kind === "result") {
        this.snapshot = {
        ...refreshedSnapshot,
        status: "idle",
        detail: intent.result.detail,
        transcript,
        matchDetail: intent.result.detail,
        matching: false,
        candidates: [],
        lastResult: intent.result,
        sourceLabel,
        };
        this.pushStatus();
        this.pushCandidates();
        this.pushResult();
        return;
      }

      if (intent.kind === "candidates") {
        this.snapshot = {
        ...refreshedSnapshot,
        status: "idle",
        detail: intent.detail,
        transcript,
        matchDetail: intent.detail,
        matching: false,
        candidates: intent.candidates,
        lastResult: null,
        sourceLabel,
        };
        this.pushStatus();
        this.pushCandidates();
        return;
      }

      this.snapshot = {
        ...refreshedSnapshot,
        status: "no-match",
        detail: intent.detail,
        transcript,
        matchDetail: intent.detail,
        matching: false,
        candidates: [],
        lastResult: null,
        sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
    } catch (err) {
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        detail: "Voice Bible failed",
        transcript: this.snapshot.transcript,
        matchDetail: undefined,
        matching: false,
        candidates: [],
        lastResult: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.pushStatus();
    } finally {
      if (this.isCurrentRequest(requestId)) {
        this.activeSettings = null;
      }
    }
  }

  private async cancelListening(requestId = ++this.requestNonce): Promise<void> {
    this.stopLiveTranscriptionLoop();
    await this.teardownAudio();
    if (!this.isCurrentRequest(requestId)) {
      return;
    }
    this.setInputLevel(0);
    this.activeSettings = null;
    const refreshedSnapshot = await this.refreshAvailability().catch(() => this.snapshot);
    if (!this.isCurrentRequest(requestId)) {
      return;
    }
    this.snapshot = {
      ...refreshedSnapshot,
      status: "idle",
      detail: undefined,
      transcript: undefined,
      matchDetail: undefined,
      matching: false,
      candidates: [],
      lastResult: null,
      error: undefined,
      sourceLabel: undefined,
    };
    this.pushStatus();
    this.pushCandidates();
  }

  private async teardownAudio(): Promise<void> {
    try {
      this.processorNode?.disconnect();
    } catch {
      // noop
    }
    try {
      this.mediaSource?.disconnect();
    } catch {
      // noop
    }
    try {
      this.highPassNode?.disconnect();
    } catch {
      // noop
    }
    try {
      this.lowPassNode?.disconnect();
    } catch {
      // noop
    }
    try {
      this.presenceNode?.disconnect();
    } catch {
      // noop
    }
    try {
      this.compressorNode?.disconnect();
    } catch {
      // noop
    }
    try {
      this.sinkNode?.disconnect();
    } catch {
      // noop
    }

    this.processorNode = null;
    this.mediaSource = null;
    this.highPassNode = null;
    this.lowPassNode = null;
    this.presenceNode = null;
    this.compressorNode = null;
    this.sinkNode = null;

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    this.setInputLevel(0);
  }
}

export const voiceBibleService = new VoiceBibleService();
