export type StreamingPlatform = "youtube" | "twitch" | "custom";

export interface StreamingPlatformOption {
  value: StreamingPlatform;
  label: string;
  description: string;
  helper: string;
  safeUploadUtilization: number;
}

export interface StreamTelemetry {
  streaming: boolean;
  platform: StreamingPlatform;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number | null;
  droppedFrameRatio: number;
  congestion: number | null;
  reconnecting: boolean;
}

export interface StreamAssessmentMemory {
  uploadCapacityMbps: number | null;
  bitrateWarningStreak: number;
  bitrateCriticalStreak: number;
  riskWarningStreak: number;
  riskCriticalStreak: number;
}

export interface StreamAssessment {
  overallRisk: "good" | "warning" | "critical" | "offline";
  overallTitle: string;
  probableCause: string;
  videoQualityStatus: "good" | "warning" | "critical" | "offline";
  videoQualityTitle: string;
  videoQualityAdvice: string;
  estimatedUploadCapacityMbps: number | null;
  safeBitrateKbps: number | null;
  recommendedBitrateKbps: number | null;
  formatLabel: string;
  platformLabel: string;
  platformHelper: string;
}

interface BitratePreset {
  maxHeight: number;
  maxFps: number;
  recommendedKbps: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundToStep = (value: number, step: number): number => Math.round(value / step) * step;

const normalizeFps = (fps: number): number => {
  if (fps >= 50) return 60;
  if (fps >= 35) return 50;
  if (fps >= 28) return 30;
  return 24;
};

const getResolutionHeight = (width: number, height: number): number => {
  if (!width || !height) return 0;
  return Math.min(width, height);
};

const YOUTUBE_BITRATE_PRESETS: BitratePreset[] = [
  { maxHeight: 480, maxFps: 30, recommendedKbps: 1500 },
  { maxHeight: 480, maxFps: 60, recommendedKbps: 4000 },
  { maxHeight: 720, maxFps: 30, recommendedKbps: 4000 },
  { maxHeight: 720, maxFps: 60, recommendedKbps: 6000 },
  { maxHeight: 1080, maxFps: 30, recommendedKbps: 10000 },
  { maxHeight: 1080, maxFps: 60, recommendedKbps: 12000 },
  { maxHeight: 1440, maxFps: 30, recommendedKbps: 15000 },
  { maxHeight: 1440, maxFps: 60, recommendedKbps: 24000 },
  { maxHeight: 2160, maxFps: 30, recommendedKbps: 30000 },
  { maxHeight: 2160, maxFps: 60, recommendedKbps: 51000 },
];

const TWITCH_BITRATE_PRESETS: BitratePreset[] = [
  { maxHeight: 480, maxFps: 30, recommendedKbps: 1800 },
  { maxHeight: 480, maxFps: 60, recommendedKbps: 2500 },
  { maxHeight: 720, maxFps: 30, recommendedKbps: 3000 },
  { maxHeight: 720, maxFps: 60, recommendedKbps: 4500 },
  { maxHeight: 1080, maxFps: 30, recommendedKbps: 4500 },
  { maxHeight: 1080, maxFps: 60, recommendedKbps: 6000 },
  { maxHeight: 1440, maxFps: 60, recommendedKbps: 6000 },
  { maxHeight: 2160, maxFps: 60, recommendedKbps: 6000 },
];

const CUSTOM_BITRATE_PRESETS: BitratePreset[] = [
  { maxHeight: 480, maxFps: 30, recommendedKbps: 1500 },
  { maxHeight: 480, maxFps: 60, recommendedKbps: 2500 },
  { maxHeight: 720, maxFps: 30, recommendedKbps: 3000 },
  { maxHeight: 720, maxFps: 60, recommendedKbps: 4500 },
  { maxHeight: 1080, maxFps: 30, recommendedKbps: 6000 },
  { maxHeight: 1080, maxFps: 60, recommendedKbps: 8500 },
  { maxHeight: 1440, maxFps: 60, recommendedKbps: 12000 },
  { maxHeight: 2160, maxFps: 60, recommendedKbps: 20000 },
];

export const STREAMING_PLATFORM_OPTIONS: StreamingPlatformOption[] = [
  {
    value: "youtube",
    label: "YouTube",
    description: "Choose where you stream so DeckPilot can give the right bitrate and network advice.",
    helper: "YouTube-focused bitrate guidance",
    safeUploadUtilization: 0.78,
  },
  {
    value: "twitch",
    label: "Twitch",
    description: "Choose where you stream so DeckPilot can give the right bitrate and network advice.",
    helper: "Safer bitrate recommendations with more upload headroom",
    safeUploadUtilization: 0.65,
  },
  {
    value: "custom",
    label: "Custom / Other",
    description: "Choose where you stream so DeckPilot can give the right bitrate and network advice.",
    helper: "General safe recommendations",
    safeUploadUtilization: 0.72,
  },
];

export function createInitialStreamAssessmentMemory(): StreamAssessmentMemory {
  return {
    uploadCapacityMbps: null,
    bitrateWarningStreak: 0,
    bitrateCriticalStreak: 0,
    riskWarningStreak: 0,
    riskCriticalStreak: 0,
  };
}

export function getStreamingPlatformLabel(platform: StreamingPlatform): string {
  return STREAMING_PLATFORM_OPTIONS.find((option) => option.value === platform)?.label ?? "Custom / Other";
}

export function getStreamingPlatformHelper(platform: StreamingPlatform): string {
  return STREAMING_PLATFORM_OPTIONS.find((option) => option.value === platform)?.helper ?? "General safe recommendations";
}

function getBitratePreset(platform: StreamingPlatform, width: number, height: number, fps: number): BitratePreset {
  const presets = platform === "youtube"
    ? YOUTUBE_BITRATE_PRESETS
    : platform === "twitch"
      ? TWITCH_BITRATE_PRESETS
      : CUSTOM_BITRATE_PRESETS;
  const targetHeight = getResolutionHeight(width, height);
  const targetFps = normalizeFps(fps);
  return presets.find((preset) => targetHeight <= preset.maxHeight && targetFps <= preset.maxFps) ?? presets[presets.length - 1];
}

function getFormatLabel(width: number, height: number, fps: number): string {
  if (!width || !height || !fps) return "Waiting for OBS video settings";
  return `${width}×${height} @ ${normalizeFps(fps)} FPS`;
}

function formatBitrateSuggestion(kbps: number): string {
  return `${roundToStep(kbps, 250).toLocaleString()} kbps`;
}

export function assessStreamQuality(
  telemetry: StreamTelemetry,
  memory: StreamAssessmentMemory,
): { assessment: StreamAssessment; memory: StreamAssessmentMemory } {
  const platformLabel = getStreamingPlatformLabel(telemetry.platform);
  const platformHelper = getStreamingPlatformHelper(telemetry.platform);
  const preset = getBitratePreset(telemetry.platform, telemetry.width, telemetry.height, telemetry.fps);
  const bitrateKbps = telemetry.bitrateKbps && telemetry.bitrateKbps > 0 ? telemetry.bitrateKbps : null;
  const congestion = clamp(telemetry.congestion ?? 0, 0, 1);
  const droppedRatio = clamp(telemetry.droppedFrameRatio, 0, 1);
  const safeUploadUtilization = STREAMING_PLATFORM_OPTIONS.find((option) => option.value === telemetry.platform)?.safeUploadUtilization ?? 0.72;

  if (!telemetry.streaming || !bitrateKbps) {
    return {
      assessment: {
        overallRisk: "offline",
        overallTitle: telemetry.streaming ? "Measuring stream" : "Off Air",
        probableCause: telemetry.streaming
          ? "DeckPilot is collecting a few live samples before judging bitrate."
          : "Start streaming to measure bitrate, upload headroom, and stability.",
        videoQualityStatus: "offline",
        videoQualityTitle: telemetry.streaming ? "Measuring bitrate" : "Waiting for a live stream",
        videoQualityAdvice: telemetry.streaming
          ? "Give it a few seconds to estimate safe bitrate."
          : "Stream Check updates lightly while off-air and becomes live once you start streaming.",
        estimatedUploadCapacityMbps: memory.uploadCapacityMbps,
        safeBitrateKbps: null,
        recommendedBitrateKbps: preset.recommendedKbps,
        formatLabel: getFormatLabel(telemetry.width, telemetry.height, telemetry.fps),
        platformLabel,
        platformHelper,
      },
      memory,
    };
  }

  const baseCapacityMbps = (bitrateKbps / 1000) / safeUploadUtilization;
  const stressPenalty = clamp(1 - (congestion * 0.45 + droppedRatio * 8 + (telemetry.reconnecting ? 0.22 : 0)), 0.55, 1);
  const estimatedCapacityMbpsRaw = baseCapacityMbps * stressPenalty;
  const estimatedUploadCapacityMbps = memory.uploadCapacityMbps == null
    ? estimatedCapacityMbpsRaw
    : memory.uploadCapacityMbps * 0.65 + estimatedCapacityMbpsRaw * 0.35;
  const safeBitrateKbps = Math.max(1000, estimatedUploadCapacityMbps * 1000 * safeUploadUtilization);

  const abovePlatformTypical = bitrateKbps > preset.recommendedKbps * 1.1;
  const nearLimitSignal = bitrateKbps > safeBitrateKbps * 0.92 || (congestion >= 0.06 && bitrateKbps > safeBitrateKbps * 0.88);
  const tooHighSignal = bitrateKbps > safeBitrateKbps * 1.02 && (congestion >= 0.08 || droppedRatio >= 0.01 || telemetry.reconnecting);
  const networkRiskSignal = congestion >= 0.08 || droppedRatio >= 0.015 || telemetry.reconnecting;
  const criticalRiskSignal = telemetry.reconnecting || droppedRatio >= 0.04 || (tooHighSignal && congestion >= 0.12);

  const nextMemory: StreamAssessmentMemory = {
    uploadCapacityMbps: estimatedUploadCapacityMbps,
    bitrateWarningStreak: nearLimitSignal ? memory.bitrateWarningStreak + 1 : 0,
    bitrateCriticalStreak: tooHighSignal ? memory.bitrateCriticalStreak + 1 : 0,
    riskWarningStreak: networkRiskSignal ? memory.riskWarningStreak + 1 : 0,
    riskCriticalStreak: criticalRiskSignal ? memory.riskCriticalStreak + 1 : 0,
  };

  let overallRisk: StreamAssessment["overallRisk"] = "good";
  let overallTitle = "Stable";
  if (telemetry.reconnecting || nextMemory.riskCriticalStreak >= 2) {
    overallRisk = "critical";
    overallTitle = "Unstable";
  } else if (nextMemory.riskWarningStreak >= 2) {
    overallRisk = "warning";
    overallTitle = "At Risk";
  }

  let probableCause = "Connection looks stable.";
  if (telemetry.reconnecting) {
    probableCause = "OBS is reconnecting to the stream destination.";
  } else if (tooHighSignal && nextMemory.bitrateCriticalStreak >= 2) {
    probableCause = "Current bitrate is too close to the safe upload headroom.";
  } else if (droppedRatio >= 0.015) {
    probableCause = "Dropped frames are elevated and pointing to network strain.";
  } else if (congestion >= 0.06) {
    probableCause = "Network congestion is rising near your safe upload limit.";
  } else if (abovePlatformTypical) {
    probableCause = `${platformLabel} usually works better a little below this bitrate.`;
  }

  let videoQualityStatus: StreamAssessment["videoQualityStatus"] = "good";
  let videoQualityTitle = "Good for your connection";
  let videoQualityAdvice = "Fits your connection.";

  const nearLimitTarget = Math.min(preset.recommendedKbps, safeBitrateKbps * 0.96);
  const nearLimitFloor = Math.max(1000, nearLimitTarget * 0.9);
  const criticalTarget = Math.min(preset.recommendedKbps, safeBitrateKbps * 0.9);

  if (tooHighSignal && nextMemory.bitrateCriticalStreak >= 2) {
    videoQualityStatus = "critical";
    videoQualityTitle = "Too high for this connection";
    videoQualityAdvice = `Try ${formatBitrateSuggestion(criticalTarget)}.`;
  } else if (nearLimitSignal && nextMemory.bitrateWarningStreak >= 2) {
    videoQualityStatus = "warning";
    videoQualityTitle = "Near your network limit";
    videoQualityAdvice = `Try ${formatBitrateSuggestion(nearLimitFloor)}-${formatBitrateSuggestion(nearLimitTarget)}.`;
  } else if (abovePlatformTypical) {
    videoQualityStatus = "warning";
    videoQualityTitle = `Above typical for ${platformLabel}`;
    videoQualityAdvice = `${platformLabel} usually works well around ${formatBitrateSuggestion(preset.recommendedKbps)}.`;
  }

  return {
    assessment: {
      overallRisk,
      overallTitle,
      probableCause,
      videoQualityStatus,
      videoQualityTitle,
      videoQualityAdvice,
      estimatedUploadCapacityMbps,
      safeBitrateKbps,
      recommendedBitrateKbps: preset.recommendedKbps,
      formatLabel: getFormatLabel(telemetry.width, telemetry.height, telemetry.fps),
      platformLabel,
      platformHelper,
    },
    memory: nextMemory,
  };
}
