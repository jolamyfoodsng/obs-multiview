export type PreServiceStepType = "media" | "countdown" | "scene" | "goLive";

export type PreServiceTransition = "cut" | "fade";
export type PreServiceCountdownTheme = "classic" | "minimal" | "spotlight" | "bold";

export interface PreServiceStepBase {
  id: string;
  type: PreServiceStepType;
  label: string;
  transition?: PreServiceTransition;
  autoAdvance?: boolean;
}

export interface PreServiceMediaStep extends PreServiceStepBase {
  type: "media";
  mediaId?: string;
  mediaUrl: string;
  durationMode: "auto" | "manual";
  durationSeconds?: number;
}

export interface PreServiceCountdownStep extends PreServiceStepBase {
  type: "countdown";
  seconds: number;
  theme?: PreServiceCountdownTheme;
}

export interface PreServiceSceneStep extends PreServiceStepBase {
  type: "scene";
  sceneName: string;
  durationSeconds?: number;
}

export interface PreServiceGoLiveStep extends PreServiceStepBase {
  type: "goLive";
  durationSeconds?: number;
  platformOnly?: boolean;
}

export type PreServiceStep =
  | PreServiceMediaStep
  | PreServiceCountdownStep
  | PreServiceSceneStep
  | PreServiceGoLiveStep;

export interface PreServicePlan {
  id: string;
  name: string;
  mainSceneName: string;
  loopEnabled: boolean;
  steps: PreServiceStep[];
}

export type PreServiceRuntimeStatus = "idle" | "running" | "paused" | "finished";

export interface PreServiceRuntimeState {
  status: PreServiceRuntimeStatus;
  activeStepIndex: number;
  stepStartedAt: number | null;
  remainingSeconds: number;
  currentStepDuration: number;
}
