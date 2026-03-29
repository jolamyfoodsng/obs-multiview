import type { PreServicePlan, PreServiceRuntimeState } from "./types";

const PLAN_KEY = "preservice.plan";
const RUNTIME_KEY = "preservice.runtime";

const DEFAULT_PLAN: PreServicePlan = {
  id: "default",
  name: "Sunday Pre-Service",
  mainSceneName: "Main Camera",
  loopEnabled: false,
  steps: [
    {
      id: "s1",
      type: "media",
      label: "Welcome Video",
      mediaId: "vid_welcome",
      mediaUrl: "",
      durationMode: "auto",
      durationSeconds: 120,
      transition: "fade",
    },
    {
      id: "s2",
      type: "media",
      label: "Announcements",
      mediaId: "vid_rules",
      mediaUrl: "",
      durationMode: "auto",
      durationSeconds: 120,
      transition: "fade",
    },
    {
      id: "s3",
      type: "countdown",
      label: "Service Starts In",
      seconds: 600,
      transition: "cut",
    },
    {
      id: "s4",
      type: "goLive",
      label: "Go Live",
      durationSeconds: 0,
      platformOnly: true,
      transition: "cut",
    },
  ],
};

const DEFAULT_RUNTIME: PreServiceRuntimeState = {
  status: "idle",
  activeStepIndex: 0,
  stepStartedAt: null,
  remainingSeconds: 0,
  currentStepDuration: 0,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getDefaultPreServicePlan(): PreServicePlan {
  return JSON.parse(JSON.stringify(DEFAULT_PLAN)) as PreServicePlan;
}

export function getDefaultPreServiceRuntime(): PreServiceRuntimeState {
  return { ...DEFAULT_RUNTIME };
}

export function loadPreServicePlan(): PreServicePlan {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return getDefaultPreServicePlan();
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !Array.isArray(parsed.steps)) {
      return getDefaultPreServicePlan();
    }

    const merged: PreServicePlan = {
      ...getDefaultPreServicePlan(),
      ...(parsed as Partial<PreServicePlan>),
      steps: Array.isArray(parsed.steps)
        ? (parsed.steps as PreServicePlan["steps"]).filter((step) => step && typeof step === "object")
        : getDefaultPreServicePlan().steps,
    };

    if (merged.steps.length === 0) {
      return getDefaultPreServicePlan();
    }

    return merged;
  } catch {
    return getDefaultPreServicePlan();
  }
}

export function savePreServicePlan(plan: PreServicePlan): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    // ignore storage failures
  }
}

export function loadPreServiceRuntime(): PreServiceRuntimeState {
  try {
    const raw = localStorage.getItem(RUNTIME_KEY);
    if (!raw) return getDefaultPreServiceRuntime();
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return getDefaultPreServiceRuntime();

    return {
      ...getDefaultPreServiceRuntime(),
      ...(parsed as Partial<PreServiceRuntimeState>),
    };
  } catch {
    return getDefaultPreServiceRuntime();
  }
}

export function savePreServiceRuntime(runtime: PreServiceRuntimeState): void {
  try {
    localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
  } catch {
    // ignore storage failures
  }
}
