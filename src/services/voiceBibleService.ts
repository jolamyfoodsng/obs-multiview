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
import type {
  VoiceBibleContextPayload,
  VoiceBibleSnapshot,
} from "./voiceBibleTypes";

const TARGET_SAMPLE_RATE = 16_000;

function buildDefaultSnapshot(): VoiceBibleSnapshot {
  return {
    status: "idle",
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
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sinkNode: GainNode | null = null;
  private audioChunks: Float32Array[] = [];
  private activeContext: VoiceBibleContextPayload | null = null;
  private unsubscribeDock: (() => void) | null = null;
  private requestNonce = 0;
  private fallbackPollTimer: number | null = null;
  private lastProcessedCommandIds: Partial<Record<VoiceBibleDockCommandType, string>> = {};

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

  async refreshAvailability(): Promise<VoiceBibleSnapshot> {
    const [runtime, settings] = await Promise.all([
      getVoiceBibleRuntimeStatus().catch(() => ({
        modelReady: false,
        modelName: "medium.en",
        modelPath: null,
      })),
      getVoiceBibleSettings().catch(() => undefined),
    ]);

    const semanticReady =
      settings?.semanticMode === "ollama" &&
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
        detail: this.snapshot.detail ?? "",
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

  private startFallbackPolling(): void {
    if (typeof window === "undefined" || this.fallbackPollTimer !== null) {
      return;
    }

    const poll = () => {
      void this.consumeFallbackCommands();
    };

    poll();
    this.fallbackPollTimer = window.setInterval(poll, 180);
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
    this.snapshot = {
      ...this.snapshot,
      status: "transcribing",
      detail: "Loading voice settings…",
      transcript: undefined,
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
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : {
              channelCount: 1,
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
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
      const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      const sinkNode = audioContext.createGain();
      sinkNode.gain.value = 0;

      this.audioChunks = [];
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

        this.audioChunks.push(mono);
      };

      mediaSource.connect(processorNode);
      processorNode.connect(sinkNode);
      sinkNode.connect(audioContext.destination);

      this.mediaStream = stream;
      this.audioContext = audioContext;
      this.mediaSource = mediaSource;
      this.processorNode = processorNode;
      this.sinkNode = sinkNode;

      const refreshedSnapshot = await this.refreshAvailability();
      this.snapshot = {
        ...refreshedSnapshot,
        status: "listening",
        detail: "Listening… click the mic again to stop",
        transcript: undefined,
        error: undefined,
        candidates: [],
        lastResult: null,
        sourceLabel: source.sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
    } catch (err) {
      await this.teardownAudio();
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
    this.requestNonce += 1;
    if (context) {
      this.activeContext = context;
    }

    if (this.snapshot.status !== "listening") {
      await this.cancelListening();
      return;
    }

    const activeContext = this.activeContext;
    if (!activeContext) {
      await this.cancelListening();
      return;
    }

    const sampleRate = this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
    const merged = mergeFloat32Chunks(this.audioChunks);
    await this.teardownAudio();

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
        error: undefined,
      };
      this.pushStatus();

      const downsampled = downsampleBuffer(merged, sampleRate, TARGET_SAMPLE_RATE);
      const wavBytes = encodeWav(downsampled, TARGET_SAMPLE_RATE);
      const transcript = await transcribeVoiceAudio(wavBytes);

      this.snapshot = {
        ...this.snapshot,
        status: "matching",
        detail: "Matching verse…",
        transcript,
        error: undefined,
      };
      this.pushStatus();

      const settings = await getVoiceBibleSettings();
      const intent = await resolveVoiceBibleIntent(transcript, activeContext, settings);
      const refreshedSnapshot = await this.refreshAvailability();

      if (intent.kind === "result") {
        this.snapshot = {
          ...refreshedSnapshot,
          status: "idle",
          detail: intent.result.detail,
          transcript,
          candidates: [],
          lastResult: intent.result,
          sourceLabel: this.snapshot.sourceLabel,
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
          candidates: intent.candidates,
          lastResult: null,
          sourceLabel: this.snapshot.sourceLabel,
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
        candidates: [],
        lastResult: null,
        sourceLabel: this.snapshot.sourceLabel,
      };
      this.pushStatus();
      this.pushCandidates();
    } catch (err) {
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        detail: "Voice Bible failed",
        transcript: this.snapshot.transcript,
        candidates: [],
        lastResult: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.pushStatus();
    }
  }

  private async cancelListening(): Promise<void> {
    this.requestNonce += 1;
    await this.teardownAudio();
    const refreshedSnapshot = await this.refreshAvailability().catch(() => this.snapshot);
    this.snapshot = {
      ...refreshedSnapshot,
      status: "idle",
      detail: undefined,
      transcript: undefined,
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
      this.sinkNode?.disconnect();
    } catch {
      // noop
    }

    this.processorNode = null;
    this.mediaSource = null;
    this.sinkNode = null;

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }
}

export const voiceBibleService = new VoiceBibleService();
