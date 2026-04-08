export type LiveToolMoment = "pre-service" | "live-service" | "emergency" | "post-service";

export type LiveToolKind =
  | "countdown"
  | "fullscreen"
  | "media-loop"
  | "lower-third"
  | "scene"
  | "safety-action";

export type LiveToolAction = "safe-scene" | "hide-overlays" | "mute-mic";

export interface LiveToolTemplate {
  id: string;
  moment: LiveToolMoment;
  kind: LiveToolKind;
  label: string;
  description: string;
  icon: string;
  title: string;
  subtitle?: string;
  body?: string;
  cta?: string;
  durationSeconds?: number;
  backgroundColor?: string;
  backgroundMediaId?: string;
  backgroundMediaName?: string;
  backgroundMediaPath?: string;
  backgroundMediaUrl?: string;
  sceneName?: string;
  sourceName?: string;
  action?: LiveToolAction;
  sortOrder: number;
  isSystem?: boolean;
  updatedAt: string;
}

export interface LiveToolsSnapshot {
  templates: LiveToolTemplate[];
  updatedAt: string;
}

export interface LiveToolOverlayPayload {
  kind: LiveToolKind;
  label: string;
  title: string;
  subtitle?: string;
  body?: string;
  cta?: string;
  durationSeconds?: number;
  backgroundColor?: string;
  backgroundMediaUrl?: string;
  lowerThird?: boolean;
  timestamp: number;
}

export const LIVE_TOOL_MOMENT_LABELS: Record<LiveToolMoment, string> = {
  "pre-service": "Pre-Service",
  "live-service": "Live Service",
  emergency: "Emergency",
  "post-service": "Post-Service",
};

export const LIVE_TOOL_MOMENT_DESCRIPTIONS: Record<LiveToolMoment, string> = {
  "pre-service": "Get the room and stream ready before service starts.",
  "live-service": "Fast overlays and scene helpers while service is active.",
  emergency: "One-tap safety screens for pressure moments.",
  "post-service": "Close the stream with giving, thank-you, and outro screens.",
};
