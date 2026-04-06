import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import {
  getDefaultPreServiceRuntime,
  loadPreServicePlan,
  loadPreServiceRuntime,
  savePreServicePlan,
  savePreServiceRuntime,
} from "../../preservice/preServiceStorage";
import {
  listAvailableScenes,
  runGoLive,
  runPreServiceStepToPreview,
  triggerGoLiveTransition,
} from "../../preservice/preServiceObsService";
import type {
  PreServiceCountdownTheme,
  PreServiceCountdownStep,
  PreServiceGoLiveStep,
  PreServiceMediaStep,
  PreServicePlan,
  PreServiceRuntimeState,
  PreServiceSceneStep,
  PreServiceStep,
  PreServiceStepType,
  PreServiceTransition,
} from "../../preservice/types";
import { obsService } from "../../services/obsService";
import { serviceStore } from "../../services/serviceStore";
import { getAllMedia, saveMediaItem, findMediaByPath, type MediaItem } from "../../multiview/mvStore";
import "./preService.css";
import Icon from "../Icon";

interface AddStepDraft {
  type: PreServiceStepType;
  configType: StepTypeCardId;
  label: string;
  mediaUrl: string;
  mediaId: string;
  durationMode: "auto" | "manual";
  durationSeconds: number;
  countdownSeconds: number;
  countdownTheme: PreServiceCountdownTheme;
  sceneName: string;
  transition: PreServiceTransition;
  platformOnly: boolean;
}

type AddStepModalStage = "select" | "configure";
type StepTypeCardId = "video" | "image" | "countdown" | "audio" | "scene" | "goLive" | "template";
type UploadAcceptType = "video" | "image" | "audio";

interface AudioLibraryItem {
  id: string;
  name: string;
  filePath: string;
  previewSrc: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

const STEP_TYPE_OPTIONS: ReadonlyArray<{
  id: StepTypeCardId;
  type: PreServiceStepType;
  title: string;
  description: string;
  icon: string;
  disabled?: boolean;
}> = [
  {
    id: "video",
    type: "media",
    title: "Video Player",
    description: "Play one or more videos from your library or stream URL.",
    icon: "play_circle",
  },
  {
    id: "image",
    type: "media",
    title: "Image / Slide",
    description: "Display a static image, announcement slide, or overlay.",
    icon: "image",
  },
  {
    id: "countdown",
    type: "countdown",
    title: "Countdown Timer",
    description: "Add a customizable countdown clock to the start time.",
    icon: "hourglass_empty",
  },
  {
    id: "audio",
    type: "media",
    title: "Audio Clip",
    description: "Play a standalone audio track, sound effect, or padding.",
    icon: "music_note",
  },
  {
    id: "scene",
    type: "scene",
    title: "Scene Switch",
    description: "Automate switching to a specific OBS scene configuration.",
    icon: "switch_video",
  },
  {
    id: "goLive",
    type: "goLive",
    title: "Go Live",
    description: "Switch the platform state to live when this step executes.",
    icon: "live_tv",
  },
  {
    id: "template",
    type: "scene",
    title: "Template Preset",
    description: "Load a pre-configured group of steps from your templates.",
    icon: "dashboard_customize",
    disabled: true,
  },
];

const COUNTDOWN_THEME_OPTIONS: ReadonlyArray<{
  id: PreServiceCountdownTheme;
  title: string;
  subtitle: string;
}> = [
  { id: "classic", title: "Classic", subtitle: "Dark background with primary accent timer." },
  { id: "minimal", title: "Minimal", subtitle: "Clean light countdown for brighter pre-show sets." },
  { id: "spotlight", title: "Spotlight", subtitle: "Radial stage-style focus around the timer." },
  { id: "bold", title: "Bold", subtitle: "High-contrast headline look for large venues." },
];

function isMediaStep(step: PreServiceStep): step is PreServiceMediaStep {
  return step.type === "media";
}

function isCountdownStep(step: PreServiceStep): step is PreServiceCountdownStep {
  return step.type === "countdown";
}

function isSceneStep(step: PreServiceStep): step is PreServiceSceneStep {
  return step.type === "scene";
}

function isGoLiveStep(step: PreServiceStep): step is PreServiceGoLiveStep {
  return step.type === "goLive";
}

const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|wmv|flv|ts|m4v|3gp)$/i;
const IMAGE_UPLOAD_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"] as const;
const VIDEO_UPLOAD_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v", ".3gp"] as const;
const AUDIO_UPLOAD_EXTENSIONS = [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma"] as const;
const IMAGE_UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/bmp"] as const;
const VIDEO_UPLOAD_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/mkv",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "video/x-m4v",
  "video/3gpp",
] as const;
const AUDIO_UPLOAD_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/x-ms-wma",
] as const;
const IMAGE_UPLOAD_ACCEPT = [...IMAGE_UPLOAD_MIME_TYPES, ...IMAGE_UPLOAD_EXTENSIONS].join(",");
const VIDEO_UPLOAD_ACCEPT = [...VIDEO_UPLOAD_MIME_TYPES, ...VIDEO_UPLOAD_EXTENSIONS].join(",");
const AUDIO_UPLOAD_ACCEPT = [...AUDIO_UPLOAD_MIME_TYPES, ...AUDIO_UPLOAD_EXTENSIONS].join(",");
const AUDIO_LIBRARY_STORAGE_KEY = "preservice.audioLibrary";

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function hasAllowedExtension(filename: string, allowed: readonly string[]): boolean {
  const ext = getFileExtension(filename);
  return allowed.includes(ext);
}

function loadAudioLibrary(): AudioLibraryItem[] {
  try {
    const raw = localStorage.getItem(AUDIO_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object") as AudioLibraryItem[];
  } catch {
    return [];
  }
}

function saveAudioLibrary(items: AudioLibraryItem[]): void {
  try {
    localStorage.setItem(AUDIO_LIBRARY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage failures
  }
}

/** Generate a friendly label like "Video-1", "Image-2", "Audio-3" based on existing steps */
function nextMediaLabel(mediaType: "video" | "image" | "audio", steps: PreServiceStep[]): string {
  const prefix = mediaType === "video" ? "Video" : mediaType === "audio" ? "Audio" : "Image";
  let count = 0;
  for (const s of steps) {
    if (s.type === "media" && s.label.startsWith(prefix + "-")) count++;
  }
  return `${prefix}-${count + 1}`;
}

/** Detect whether a media url / file path is video (vs image) */
function isVideoFile(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

function normalizeMediaUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^(https?:|file:|data:|blob:)/i.test(value)) return value;
  if (/^[a-zA-Z]:\\/.test(value)) {
    return `file:///${value.replace(/\\/g, "/")}`;
  }
  if (value.startsWith("/")) {
    return `file://${value}`;
  }
  return value;
}

function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseSceneName(value: string): string {
  return value.trim() || "Main Camera";
}

function stepTypeLabel(step: PreServiceStep): string {
  if (step.type === "media") return "Media";
  if (step.type === "countdown") return "Countdown";
  if (step.type === "goLive") return "Go Live";
  return "Scene";
}

function stepBadgeClass(step: PreServiceStep): string {
  if (step.type === "countdown") return "ps-step-badge--countdown";
  if (step.type === "goLive") return "ps-step-badge--go-live";
  if (step.type === "scene") return "ps-step-badge--scene";
  return "ps-step-badge--media";
}

async function resolveAutoMediaDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const media = document.createElement("video");
    const src = normalizeMediaUrl(url);

    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      media.removeAttribute("src");
      media.load();
      resolve(value);
    };

    const timeout = window.setTimeout(() => finish(null), 5000);

    media.preload = "metadata";
    media.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const duration = Number(media.duration);
      if (Number.isFinite(duration) && duration > 0) {
        finish(Math.ceil(duration));
      } else {
        finish(null);
      }
    };
    media.onerror = () => {
      window.clearTimeout(timeout);
      finish(null);
    };

    media.src = src;
  });
}

export default function PreServicePanel() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PreServicePlan>(() => loadPreServicePlan());
  const [runtime, setRuntime] = useState<PreServiceRuntimeState>(() => loadPreServiceRuntime());
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const [isStreaming, setIsStreaming] = useState(false);
  const [availableScenes, setAvailableScenes] = useState<string[]>([]);
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const [audioLibrary, setAudioLibrary] = useState<AudioLibraryItem[]>(() => loadAudioLibrary());
  const [engineError, setEngineError] = useState<string | null>(null);

  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [addModalStage, setAddModalStage] = useState<AddStepModalStage>("select");
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [showGoLiveConfirm, setShowGoLiveConfirm] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [videoSearch, setVideoSearch] = useState("");
  const [imageSearch, setImageSearch] = useState("");
  const [audioSearch, setAudioSearch] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [dragStepIndex, setDragStepIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const videoUploadRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const audioUploadRef = useRef<HTMLInputElement>(null);
  const [addDraft, setAddDraft] = useState<AddStepDraft>({
    type: "media",
    configType: "video",
    label: "",
    mediaUrl: "",
    mediaId: "",
    durationMode: "auto",
    durationSeconds: 120,
    countdownSeconds: 600,
    countdownTheme: "classic",
    sceneName: "Main Camera",
    transition: "cut",
    platformOnly: true,
  });

  const intervalRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);
  const planRef = useRef(plan);
  const runtimeRef = useRef(runtime);

  useEffect(() => {
    planRef.current = plan;
    savePreServicePlan(plan);
  }, [plan]);

  useEffect(() => {
    runtimeRef.current = runtime;
    savePreServiceRuntime(runtime);
  }, [runtime]);

  useEffect(() => {
    saveAudioLibrary(audioLibrary);
  }, [audioLibrary]);

  useEffect(() => {
    // Lightweight local migration for older saved plans.
    setPlan((prev) => {
      let changed = false;
      const migrated = prev.steps.map((step) => {
        if (isCountdownStep(step) && !step.theme) {
          changed = true;
          return { ...step, theme: "classic" as PreServiceCountdownTheme };
        }
        if (isSceneStep(step) && step.label.trim().toLowerCase() === "go live") {
          changed = true;
          return {
            id: step.id,
            type: "goLive" as const,
            label: step.label,
            durationSeconds: step.durationSeconds || 0,
            platformOnly: true,
            transition: "cut" as const,
          };
        }
        if (isGoLiveStep(step) && step.platformOnly === undefined) {
          changed = true;
          return { ...step, platformOnly: true };
        }
        return step;
      });
      if (!changed) return prev;
      return { ...prev, steps: migrated };
    });
  }, []);

  const setRuntimeSafe = useCallback(
    (nextOrUpdater: PreServiceRuntimeState | ((prev: PreServiceRuntimeState) => PreServiceRuntimeState)) => {
      setRuntime((prev) => {
        const next = typeof nextOrUpdater === "function"
          ? (nextOrUpdater as (prev: PreServiceRuntimeState) => PreServiceRuntimeState)(prev)
          : nextOrUpdater;
        runtimeRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearTicker = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const refreshScenes = useCallback(async () => {
    if (!obsService.isConnected) {
      setAvailableScenes([]);
      return;
    }
    try {
      const scenes = await listAvailableScenes();
      setAvailableScenes(scenes);
    } catch {
      setAvailableScenes([]);
    }
  }, []);

  const refreshMedia = useCallback(async () => {
    try {
      const items = await getAllMedia();
      setMediaLibrary(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch {
      setMediaLibrary([]);
    }
  }, []);

  useEffect(() => {
    refreshMedia();
  }, [refreshMedia]);

  useEffect(() => {
    refreshScenes();
    const unsub = obsService.onStatusChange((status) => {
      const connected = status === "connected";
      setObsConnected(connected);
      if (connected) {
        refreshScenes();
      } else {
        setIsStreaming(false);
      }
    });
    return unsub;
  }, [refreshScenes]);

  // ── Poll OBS stream status ──
  useEffect(() => {
    if (!obsConnected) return;

    const checkStreamStatus = async () => {
      try {
        const resp = await obsService.call("GetStreamStatus") as { outputActive: boolean };
        setIsStreaming(resp.outputActive);
      } catch {
        // Non-fatal: OBS may not support this call
      }
    };

    // Check immediately
    void checkStreamStatus();

    // Listen for stream state change events
    const unsubStart = obsService.on("StreamStateChanged", (data: { outputActive: boolean }) => {
      setIsStreaming(data.outputActive);
    });

    // Fallback poll every 5s in case events are missed
    const pollId = window.setInterval(checkStreamStatus, 5000);

    return () => {
      unsubStart();
      window.clearInterval(pollId);
    };
  }, [obsConnected]);

  const getStepDuration = useCallback(async (step: PreServiceStep): Promise<number> => {
    if (isMediaStep(step)) {
      if (step.durationMode === "manual") {
        return Math.max(1, Math.floor(step.durationSeconds || 0));
      }
      const fromMetadata = await resolveAutoMediaDuration(step.mediaUrl);
      if (fromMetadata && fromMetadata > 0) {
        return fromMetadata;
      }
      return Math.max(1, Math.floor(step.durationSeconds || 30));
    }

    if (isCountdownStep(step)) {
      return Math.max(1, Math.floor(step.seconds));
    }

    if (isGoLiveStep(step) && step.durationSeconds && step.durationSeconds > 0) {
      return Math.max(1, Math.floor(step.durationSeconds));
    }

    // Scene steps: use durationSeconds if set, otherwise 0 (instant advance)
    if (isSceneStep(step) && step.durationSeconds && step.durationSeconds > 0) {
      return Math.max(1, Math.floor(step.durationSeconds));
    }

    return 0;
  }, []);

  const goLiveOnPlatformOnly = useCallback(() => {
    serviceStore.goLive();
    navigate("/hub?mode=live");
  }, [navigate]);

  const holdStepForManualAdvance = useCallback((stepIndex: number, durationSeconds: number) => {
    setRuntimeSafe((prev) => ({
      ...prev,
      status: "paused",
      activeStepIndex: stepIndex,
      stepStartedAt: null,
      remainingSeconds: 0,
      currentStepDuration: durationSeconds,
    }));
  }, [setRuntimeSafe]);

  const executeStep = useCallback(async (
    stepIndex: number,
    token: number,
    remainingOverride?: number,
  ) => {
    clearTicker();

    const currentPlan = planRef.current;
    const steps = currentPlan.steps;

    if (stepIndex >= steps.length) {
      if (token !== runTokenRef.current) return;

      setRuntimeSafe({
        status: "finished",
        activeStepIndex: Math.max(0, steps.length - 1),
        stepStartedAt: null,
        remainingSeconds: 0,
        currentStepDuration: 0,
      });

      if (currentPlan.loopEnabled) {
        const nextToken = ++runTokenRef.current;
        void executeStep(0, nextToken);
      }
      return;
    }

    const step = steps[stepIndex];
    const durationSeconds = Math.max(0, Math.ceil(
      remainingOverride ?? await getStepDuration(step),
    ));
    const shouldAutoAdvance = step.autoAdvance !== false || isGoLiveStep(step);

    const startedAt = Date.now();

    setRuntimeSafe({
      status: "running",
      activeStepIndex: stepIndex,
      stepStartedAt: startedAt,
      remainingSeconds: durationSeconds,
      currentStepDuration: durationSeconds,
    });

    if (!isGoLiveStep(step)) {
      try {
        await runPreServiceStepToPreview(step, durationSeconds);
      } catch (err) {
        if (token !== runTokenRef.current) return;
        setEngineError(err instanceof Error ? err.message : String(err));
        setRuntimeSafe((prev) => ({
          ...prev,
          status: "paused",
          stepStartedAt: null,
        }));
        return;
      }
    }
    if (token !== runTokenRef.current) return;

    const completeCurrentStep = () => {
      clearTicker();
      if (token !== runTokenRef.current) return;
      if (isGoLiveStep(step)) {
        setRuntimeSafe((prev) => ({
          ...prev,
          status: "finished",
          stepStartedAt: null,
          remainingSeconds: 0,
          currentStepDuration: 0,
        }));
        goLiveOnPlatformOnly();
        return;
      }
      if (!shouldAutoAdvance) {
        holdStepForManualAdvance(stepIndex, durationSeconds);
        return;
      }
      void executeStep(stepIndex + 1, token);
    };

    if (durationSeconds <= 0) {
      window.setTimeout(completeCurrentStep, 200);
      return;
    }

    intervalRef.current = window.setInterval(() => {
      if (token !== runTokenRef.current) {
        clearTicker();
        return;
      }

      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
      const roundedRemaining = Math.ceil(remainingSeconds);

      setRuntimeSafe((prev) => {
        if (prev.status !== "running") return prev;
        if (prev.remainingSeconds === roundedRemaining) return prev;
        return {
          ...prev,
          remainingSeconds: roundedRemaining,
        };
      });

      if (remainingSeconds <= 0.01) {
        completeCurrentStep();
      }
    }, 250);
  }, [clearTicker, getStepDuration, goLiveOnPlatformOnly, holdStepForManualAdvance, setRuntimeSafe]);

  const startSequence = useCallback(() => {
    setEngineError(null);
    const token = ++runTokenRef.current;

    if (runtimeRef.current.status === "paused") {
      const currentStep = planRef.current.steps[runtimeRef.current.activeStepIndex];
      if (runtimeRef.current.remainingSeconds <= 0 && currentStep && currentStep.autoAdvance === false) {
        void executeStep(runtimeRef.current.activeStepIndex + 1, token);
        return;
      }
      void executeStep(
        runtimeRef.current.activeStepIndex,
        token,
        Math.max(0, runtimeRef.current.remainingSeconds),
      );
      return;
    }

    void executeStep(0, token);
  }, [executeStep]);

  const pauseSequence = useCallback(() => {
    const current = runtimeRef.current;
    if (current.status !== "running") return;

    const token = ++runTokenRef.current;
    void token;

    clearTicker();

    const elapsedSeconds = current.stepStartedAt
      ? (Date.now() - current.stepStartedAt) / 1000
      : 0;
    const remainingSeconds = Math.max(0, current.currentStepDuration - elapsedSeconds);

    setRuntimeSafe({
      ...current,
      status: "paused",
      stepStartedAt: null,
      remainingSeconds: Math.ceil(remainingSeconds),
    });
  }, [clearTicker, setRuntimeSafe]);

  const skipStep = useCallback(() => {
    const current = runtimeRef.current;
    if (current.status !== "running" && current.status !== "paused") return;

    setEngineError(null);
    const token = ++runTokenRef.current;
    clearTicker();
    void executeStep(current.activeStepIndex + 1, token);
  }, [clearTicker, executeStep]);

  const stopAndReset = useCallback(() => {
    ++runTokenRef.current;
    clearTicker();
    setEngineError(null);
    setRuntimeSafe(getDefaultPreServiceRuntime());
  }, [clearTicker, setRuntimeSafe]);

  const goLiveNow = useCallback(async () => {
    setShowGoLiveConfirm(true);
  }, []);

  const confirmGoLive = useCallback(async () => {
    setShowGoLiveConfirm(false);
    ++runTokenRef.current;
    clearTicker();
    setEngineError(null);

    try {
      if (runtimeRef.current.status === "running" || runtimeRef.current.status === "paused") {
        await triggerGoLiveTransition();
      } else {
        await runGoLive(parseSceneName(planRef.current.mainSceneName));
      }
      setRuntimeSafe((prev) => ({
        ...prev,
        status: "finished",
        stepStartedAt: null,
        remainingSeconds: 0,
        currentStepDuration: 0,
      }));
      // Navigate to Service Hub after pushing to program
      serviceStore.goLive();
      navigate("/hub?mode=live");
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    }
  }, [clearTicker, setRuntimeSafe, navigate]);

  // Safety: NEVER auto-resume on page load. If the persisted runtime was
  // "running" or "paused" from a previous session, reset to idle. The operator
  // must explicitly press Start to begin automation.
  useEffect(() => {
    if (runtime.status === "running" || runtime.status === "paused") {
      ++runTokenRef.current;
      clearTicker();
      setRuntimeSafe(getDefaultPreServiceRuntime());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      ++runTokenRef.current;
      clearTicker();
    };
  }, [clearTicker]);

  const activeStep = plan.steps[runtime.activeStepIndex] ?? null;
  const nextStep = plan.steps[runtime.activeStepIndex + 1] ?? null;

  const isRunning = runtime.status === "running";
  const isPaused = runtime.status === "paused";
  const pausedAtManualHold = isPaused && runtime.remainingSeconds <= 0 && activeStep?.autoAdvance === false;

  const updateStep = useCallback((id: string, updater: (step: PreServiceStep) => PreServiceStep) => {
    setPlan((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (step.id === id ? updater(step) : step)),
    }));
  }, []);

  const removeStep = useCallback((id: string) => {
    setPlan((prev) => {
      const nextSteps = prev.steps.filter((step) => step.id !== id);
      return {
        ...prev,
        steps: nextSteps,
      };
    });
  }, []);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setPlan((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.steps.length) return prev;
      const nextSteps = [...prev.steps];
      const [moved] = nextSteps.splice(index, 1);
      nextSteps.splice(target, 0, moved);
      return { ...prev, steps: nextSteps };
    });
  }, []);

  const openAddStep = useCallback(() => {
    setAddModalStage("select");
    setSelectedCardIndex(0);
    setShowAddStepModal(true);
    setAddDraft(() => ({
      type: "media",
      configType: "video",
      label: "",
      mediaUrl: "",
      mediaId: "",
      durationMode: "auto",
      durationSeconds: 120,
      countdownSeconds: 600,
      countdownTheme: "classic",
      sceneName: availableScenes[0] || plan.mainSceneName || "Main Camera",
      transition: "cut",
      platformOnly: true,
    }));
  }, [availableScenes, plan.mainSceneName]);

  const closeAddStep = useCallback(() => {
    setAddModalStage("select");
    setShowAddStepModal(false);
  }, []);

  const createStepFromDraft = useCallback((): PreServiceStep | null => {
    const id = nanoid();

    if (addDraft.type === "media") {
      const mediaUrl = normalizeMediaUrl(addDraft.mediaUrl);
      if (!mediaUrl) return null;
      const fallbackLabel = addDraft.configType === "audio"
        ? "Audio"
        : addDraft.configType === "image"
          ? "Image"
          : "Media";
      return {
        id,
        type: "media",
        label: addDraft.label.trim() || fallbackLabel,
        mediaId: addDraft.mediaId || undefined,
        mediaUrl,
        durationMode: addDraft.durationMode,
        durationSeconds: Math.max(1, Math.floor(addDraft.durationSeconds || 30)),
        transition: addDraft.transition,
      };
    }

    if (addDraft.type === "countdown") {
      return {
        id,
        type: "countdown",
        label: addDraft.label.trim() || "Service Starts In",
        seconds: Math.max(1, Math.floor(addDraft.countdownSeconds || 300)),
        theme: addDraft.countdownTheme,
        transition: addDraft.transition,
      };
    }

    if (addDraft.type === "scene") {
      return {
        id,
        type: "scene",
        label: addDraft.label.trim() || "Scene Switch",
        sceneName: parseSceneName(addDraft.sceneName),
        durationSeconds: Math.max(0, Math.floor(addDraft.durationSeconds || 0)),
        transition: addDraft.transition,
      };
    }

    if (addDraft.type === "goLive") {
      return {
        id,
        type: "goLive",
        label: addDraft.label.trim() || "Go Live",
        durationSeconds: Math.max(0, Math.floor(addDraft.durationSeconds || 0)),
        platformOnly: true,
        transition: "cut",
      };
    }

    return null;
  }, [addDraft]);

  const addStep = useCallback(() => {
    const step = createStepFromDraft();
    if (!step) {
      setEngineError("Please complete the step details before adding.");
      return;
    }

    setPlan((prev) => ({
      ...prev,
      steps: [...prev.steps, step],
    }));

    setAddModalStage("select");
    setShowAddStepModal(false);
    setEngineError(null);
  }, [createStepFromDraft]);

  const applyMediaPreset = useCallback((
    item: Pick<MediaItem, "id" | "name" | "filePath" | "previewSrc"> | AudioLibraryItem,
    explicitType?: UploadAcceptType,
  ) => {
    const mediaType: UploadAcceptType = explicitType
      || (/\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(item.name || item.filePath)
        ? "audio"
        : isVideoFile(item.filePath || item.previewSrc)
          ? "video"
          : "image");
    const autoLabel = nextMediaLabel(mediaType, plan.steps);
    const mediaUrl = normalizeMediaUrl(item.filePath || item.previewSrc);
    setAddDraft((prev) => ({
      ...prev,
      type: "media",
      configType: mediaType,
      mediaId: item.id,
      mediaUrl,
      label: prev.label || autoLabel,
      // Videos can resolve auto metadata, image/audio should use manual duration
      durationMode: mediaType === "video" ? "auto" : "manual",
    }));

    // Auto-resolve video duration from file metadata
    if (mediaType === "video" && mediaUrl) {
      void resolveAutoMediaDuration(mediaUrl).then((dur) => {
        if (dur && dur > 0) {
          setAddDraft((prev) => ({
            ...prev,
            durationSeconds: Math.ceil(dur),
          }));
        }
      });
    }
  }, [plan.steps]);

  // ── File upload handler (video / image / audio) ──
  const handleFileUpload = useCallback(
    async (files: FileList | null, acceptType: UploadAcceptType) => {
      if (!files || files.length === 0) return;

      const newMediaItems: MediaItem[] = [];
      const newAudioItems: AudioLibraryItem[] = [];

      for (const file of Array.from(files)) {
        // Validate MIME type + extension (some browsers omit MIME on drag/drop)
        if (acceptType === "video") {
          const okType = file.type.startsWith("video/");
          const okExt = hasAllowedExtension(file.name, VIDEO_UPLOAD_EXTENSIONS);
          if (!okType && !okExt) continue;
        }
        if (acceptType === "image") {
          const okType = file.type.startsWith("image/");
          const okExt = hasAllowedExtension(file.name, IMAGE_UPLOAD_EXTENSIONS);
          if (!okType && !okExt) continue;
        }
        if (acceptType === "audio") {
          const okType = file.type.startsWith("audio/");
          const okExt = hasAllowedExtension(file.name, AUDIO_UPLOAD_EXTENSIONS);
          if (!okType && !okExt) continue;
        }

        // Read as data URL for preview
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        // Save to disk via Tauri
        let diskPath: string | undefined;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const bytes = new Uint8Array(await file.arrayBuffer());
          const safeName = `ps_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          diskPath = await invoke<string>("save_upload_file", {
            fileName: safeName,
            fileData: Array.from(bytes),
          });
        } catch (err) {
          console.warn("[PreService] Could not save file to disk:", err);
        }

        const filePath = diskPath || dataUrl;
        if (acceptType === "audio") {
          newAudioItems.push({
            id: nanoid(12),
            name: file.name,
            filePath,
            previewSrc: dataUrl,
            mimeType: file.type,
            size: file.size,
            createdAt: new Date().toISOString(),
          });
          continue;
        }

        const item: MediaItem = {
          id: nanoid(12),
          name: file.name,
          mediaType: acceptType,
          filePath,
          previewSrc: dataUrl,
          mimeType: file.type,
          size: file.size,
          createdAt: new Date().toISOString(),
          tags: ["preservice"],
        };

        // Persist to media library
        if (diskPath) {
          const existing = await findMediaByPath(diskPath);
          if (!existing) {
            await saveMediaItem(item);
          }
        }

        newMediaItems.push(item);
      }

      if (newAudioItems.length > 0) {
        setAudioLibrary((prev) => {
          const map = new Map(prev.map((item) => [item.filePath, item]));
          for (const item of newAudioItems) {
            map.set(item.filePath, item);
          }
          return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });

        if (newAudioItems.length === 1) {
          const first = newAudioItems[0];
          applyMediaPreset(first, "audio");
          setAddDraft((prev) => ({
            ...prev,
            durationMode: "manual",
          }));
        } else {
          const newSteps: PreServiceStep[] = newAudioItems.map((item, idx) => ({
            id: nanoid(),
            type: "media",
            label: nextMediaLabel("audio", [...plan.steps, ...newAudioItems.slice(0, idx).map((prevItem, prevIndex) => ({
              id: prevItem.id,
              type: "media" as const,
              label: `Audio-${prevIndex + 1}`,
              mediaUrl: prevItem.filePath,
              durationMode: "manual" as const,
              durationSeconds: 30,
              transition: "cut" as PreServiceTransition,
            }))]),
            mediaId: item.id,
            mediaUrl: normalizeMediaUrl(item.filePath || item.previewSrc),
            durationMode: "manual",
            durationSeconds: 30,
            transition: "cut",
          }));
          setPlan((prev) => ({
            ...prev,
            steps: [...prev.steps, ...newSteps],
          }));
          setShowAddStepModal(false);
          setAddModalStage("select");
        }
      }

      if (newMediaItems.length > 0) {
        if (newMediaItems.length === 1) {
          // Single file: populate the draft for the modal
          const first = newMediaItems[0];
          const autoLabel = nextMediaLabel(acceptType, plan.steps);
          const mediaUrl = normalizeMediaUrl(first.filePath || first.previewSrc);
          setAddDraft((prev) => ({
            ...prev,
            type: "media",
            configType: acceptType,
            mediaId: first.id,
            mediaUrl,
            label: prev.label || autoLabel,
            durationMode: acceptType === "video" ? "auto" : "manual",
          }));

          // Auto-resolve video duration from file metadata
          if (acceptType === "video" && mediaUrl) {
            void resolveAutoMediaDuration(mediaUrl).then((dur) => {
              if (dur && dur > 0) {
                setAddDraft((prev) => ({
                  ...prev,
                  durationSeconds: Math.ceil(dur),
                }));
              }
            });
          }
        } else {
          // Multiple files: create a step for each file automatically
          const newSteps: PreServiceStep[] = newMediaItems.map((item, idx) => {
            const labelNum = nextMediaLabel(acceptType, [
              ...plan.steps,
              // Account for items we already appended in earlier iterations
              ...newMediaItems.slice(0, idx).map((prev) => ({
                id: prev.id, type: "media" as const, label: `${acceptType === "video" ? "Video" : "Image"}-${idx}`,
                mediaUrl: "", durationMode: "auto" as const, durationSeconds: 30, transition: "cut" as PreServiceTransition,
              })),
            ]);
            return {
              id: nanoid(),
              type: "media" as const,
              label: labelNum,
              mediaId: item.id,
              mediaUrl: normalizeMediaUrl(item.filePath || item.previewSrc),
              durationMode: "auto" as const,
              durationSeconds: 30,
              transition: "cut" as PreServiceTransition,
            };
          });

          setPlan((prev) => ({
            ...prev,
            steps: [...prev.steps, ...newSteps],
          }));

          // Close the modal since steps were created automatically
          setShowAddStepModal(false);
          setAddModalStage("select");
        }
        // Refresh the media library to show newly uploaded files
        refreshMedia();
      }
    },
    [applyMediaPreset, refreshMedia, plan.steps],
  );

  // ── Drag & drop handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, acceptType: UploadAcceptType) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      void handleFileUpload(e.dataTransfer.files, acceptType);
    },
    [handleFileUpload],
  );

  // ── Step reorder drag & drop ──
  const handleStepDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (isRunning || isPaused) { e.preventDefault(); return; }
    setDragStepIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, [isRunning, isPaused]);

  const handleStepDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleStepDragEnd = useCallback(() => {
    setDragStepIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleStepDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const transferIndex = Number(e.dataTransfer.getData("text/plain"));
    const fromIndex = Number.isInteger(transferIndex) ? transferIndex : dragStepIndex;
    setDragStepIndex(null);
    setDragOverIndex(null);
    if (fromIndex === null || fromIndex === targetIndex || fromIndex < 0) return;

    setPlan((prev) => {
      if (fromIndex >= prev.steps.length || targetIndex >= prev.steps.length) return prev;
      const nextSteps = [...prev.steps];
      const [moved] = nextSteps.splice(fromIndex, 1);
      nextSteps.splice(targetIndex, 0, moved);
      return { ...prev, steps: nextSteps };
    });
  }, [dragStepIndex]);

  const headerTitle = "Pre-Service Automation";
  const selectedTypeOption = STEP_TYPE_OPTIONS[selectedCardIndex] ?? STEP_TYPE_OPTIONS[0];
  const selectedCard = selectedTypeOption?.id ?? "video";

  const audioTracks = useMemo(() => {
    const fromMediaLibrary: AudioLibraryItem[] = mediaLibrary
      .filter((m) => /\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(m.name || m.filePath))
      .map((m) => ({
        id: m.id,
        name: m.name,
        filePath: m.filePath,
        previewSrc: m.previewSrc,
        mimeType: m.mimeType,
        size: m.size,
        createdAt: m.createdAt,
      }));
    const deduped = new Map<string, AudioLibraryItem>();
    for (const track of [...audioLibrary, ...fromMediaLibrary]) {
      deduped.set(track.filePath, track);
    }
    return Array.from(deduped.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [audioLibrary, mediaLibrary]);

  const toggleStepExpanded = useCallback((stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const getConfiguredDurationSeconds = useCallback((step: PreServiceStep): number => {
    if (isCountdownStep(step)) return Math.max(1, step.seconds);
    if (isMediaStep(step)) return Math.max(1, step.durationSeconds || 30);
    if (isSceneStep(step)) return Math.max(0, step.durationSeconds || 0);
    if (isGoLiveStep(step)) return Math.max(0, step.durationSeconds || 0);
    return 0;
  }, []);

  /** Compute total plan duration in seconds */
  const totalDuration = plan.steps.reduce((acc, s) => {
    return acc + getConfiguredDurationSeconds(s);
  }, 0);

  /** Compute total remaining time when sequence is running */
  const totalRemaining = (() => {
    if (runtime.status === "idle" || runtime.status === "finished") return totalDuration;
    // Current step remaining
    let remaining = runtime.remainingSeconds;
    // Add durations of all future steps
    for (let i = runtime.activeStepIndex + 1; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      remaining += getConfiguredDurationSeconds(s);
    }
    return remaining;
  })();

  /** Progress percentage for the countdown bar (0 = just started, 100 = done) */
  const sequenceProgress = totalDuration > 0
    ? Math.min(100, Math.max(0, ((totalDuration - totalRemaining) / totalDuration) * 100))
    : 0;

  return (
    <div className="pre-service-auto">
      {/* ── Page Header ── */}
      <div className="ps-page-header">
        <div>
          <h2>{headerTitle}</h2>
          <p>
            Control what appears on Preview before service starts. Each step has a duration (timer icon)
            and <strong>Auto Next</strong>: when enabled it advances automatically; when disabled it waits for Skip/Resume.
          </p>
        </div>
        <div className={`ps-health-badge${obsConnected ? "" : " is-disconnected"}`}>
          <span className="ps-health-dot" />
          <span>{obsConnected ? "System Healthy" : "OBS Disconnected"}</span>
        </div>
      </div>

      {/* ── Sequence Countdown Bar ── */}
      {(isRunning || isPaused) && (
        <div className={`ps-sequence-countdown${isPaused ? " is-paused" : ""}`}>
          <div className="ps-sequence-countdown-info">
            <div className="ps-sequence-countdown-left">
              <Icon name={isPaused ? "pause_circle" : "timer"} size={20} />
              <span className="ps-sequence-countdown-label">
                {isPaused ? "Paused" : "Sequence Running"}
              </span>
            </div>
            <div className="ps-sequence-countdown-right">
              <span className="ps-sequence-countdown-step">
                Step {runtime.activeStepIndex + 1} of {plan.steps.length}
                {activeStep ? ` · ${activeStep.label}` : ""}
              </span>
              <span className="ps-sequence-countdown-time">{formatSeconds(totalRemaining)}</span>
            </div>
          </div>
          <div className="ps-sequence-countdown-track">
            <div
              className="ps-sequence-countdown-fill"
              style={{ width: `${sequenceProgress}%` }}
            />
          </div>
        </div>
      )}

      {engineError && <div className="ps-error-banner">{engineError}</div>}

      {!obsConnected && (
        <div className="ps-warning-banner">
          OBS is disconnected. Pre-Service Automation will run only after OBS reconnects.
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="ps-grid">
        {/* ════ Left column: Steps ════ */}
        <div className="ps-steps-col">
          {plan.steps.map((step, index) => {
            const isActive = runtime.activeStepIndex === index && runtime.status !== "idle";
            const isExpanded = expandedSteps.has(step.id);
            const dur = getConfiguredDurationSeconds(step);
            const autoEnabled = step.autoAdvance !== false || isGoLiveStep(step);

            return (
              <div
                key={step.id}
                className={`ps-step-card${isActive ? " is-active" : ""}${dragStepIndex === index ? " is-dragging" : ""}${dragOverIndex === index ? " is-drag-over" : ""}`}
                draggable={!isRunning && !isPaused}
                onDragStart={(e) => handleStepDragStart(e, index)}
                onDragOver={(e) => handleStepDragOver(e, index)}
                onDragEnd={handleStepDragEnd}
                onDrop={(e) => handleStepDrop(e, index)}
              >
                {/* Step header */}
                <div className="ps-step-header" onClick={() => toggleStepExpanded(step.id)}>
                  <div className="ps-step-header-left">
                    <div className={`ps-step-badge ${stepBadgeClass(step)}`}>
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="ps-step-header-info">
                      <h3>{step.label}</h3>
                      <p>{stepTypeLabel(step)}{isMediaStep(step) && step.mediaUrl ? ` · ${step.mediaUrl.split("/").pop()?.split("\\").pop() ?? ""}` : ""}</p>
                    </div>
                  </div>
                  <div className="ps-step-header-right">
                    <div className="ps-step-timer">
                      <Icon name="timer" size={20} />
                      <span>{formatSeconds(dur)}</span>
                    </div>

                    <label
                      className="ps-auto-toggle"
                      title={isGoLiveStep(step) ? "Go Live step always auto-runs." : "When off, this step waits for Skip/Resume after its timer ends."}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={autoEnabled}
                        disabled={isGoLiveStep(step)}
                        onChange={(e) => updateStep(step.id, (prev) => ({ ...prev, autoAdvance: e.target.checked }))}
                      />
                      <span className="ps-toggle-track" />
                      <span className="ps-toggle-label">Auto Next</span>
                    </label>

                    <button
                      type="button"
                      className={`ps-step-expand-btn${!isExpanded ? " is-collapsed" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleStepExpanded(step.id); }}
                    >
                      <Icon name="expand_less" size={20} />
                    </button>
                  </div>
                </div>

                {/* Step body */}
                <div className={`ps-step-body${!isExpanded ? " is-hidden" : ""}`}>
                  {/* ── Media step body ── */}
                  {isMediaStep(step) && (
                    <>
                      <div className="ps-media-row">
                        <div className="ps-media-row-left">
                          <div className="ps-drag-handle">
                            <Icon name="drag_indicator" size={20} />
                          </div>
                          <div className="ps-media-thumb">
                            <div className="ps-media-thumb-placeholder">
                              <Icon name={step.mediaUrl && /\.(mp4|mov|webm|mkv|avi)$/i.test(step.mediaUrl) ? "movie" : "image"} size={20} />
                            </div>
                          </div>
                          <div className="ps-media-info">
                            <input
                              type="text"
                              className="ps-step-label-input"
                              value={step.mediaUrl}
                              onChange={(e) => updateStep(step.id, (prev) => ({
                                ...prev,
                                mediaUrl: normalizeMediaUrl(e.target.value),
                              }))}
                              placeholder="Media URL or file path"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="ps-media-info-meta">
                              <span>{formatSeconds(dur)}</span>
                              <span className="ps-dot" />
                              <span>{step.durationMode === "auto" ? "Auto Duration" : "Manual Duration"}</span>
                            </div>
                          </div>
                        </div>
                        <div className="ps-media-row-right">
                          <label className="ps-loop-toggle" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              disabled={isRunning || isPaused || !isVideoFile(step.mediaUrl)}
                              checked={isVideoFile(step.mediaUrl) && step.durationMode === "auto"}
                              onChange={(e) => updateStep(step.id, (prev) => ({
                                ...prev,
                                durationMode: e.target.checked ? "auto" : "manual",
                              }))}
                            />
                            <span className="ps-loop-track" />
                            <span className="ps-loop-label">Auto</span>
                          </label>
                          <div className="ps-media-divider" />
                          <button
                            type="button"
                            className="ps-media-delete"
                            disabled={isRunning || isPaused}
                            onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                          >
                            <Icon name="delete" size={20} />
                          </button>
                        </div>
                      </div>
                      <div className="ps-step-duration-grid">
                        <div className="ps-step-duration-field">
                          <span className="ps-step-duration-label">Minutes</span>
                          <input
                            type="number"
                            min={0}
                            className="ps-step-duration-input"
                            value={Math.floor((step.durationSeconds || 0) / 60)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const mins = Math.max(0, Number(e.target.value) || 0);
                              const secs = (step.durationSeconds || 0) % 60;
                              updateStep(step.id, (prev) => ({
                                ...prev,
                                durationSeconds: mins * 60 + secs,
                              }));
                            }}
                          />
                        </div>
                        <div className="ps-step-duration-field">
                          <span className="ps-step-duration-label">Seconds</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            className="ps-step-duration-input"
                            value={(step.durationSeconds || 0) % 60}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                              const mins = Math.floor((step.durationSeconds || 0) / 60);
                              updateStep(step.id, (prev) => ({
                                ...prev,
                                durationSeconds: mins * 60 + secs,
                              }));
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Countdown step body ── */}
                  {isCountdownStep(step) && (
                    <div className="ps-countdown-display">
                      {(isRunning || isPaused) ? (
                        <div className="ps-countdown-inner">
                          <div className="ps-countdown-time">
                            {formatSeconds(
                              isActive ? runtime.remainingSeconds : step.seconds,
                            )}
                          </div>
                          <p className="ps-countdown-label">{step.label || "Service Starts In"}</p>
                        </div>
                      ) : (
                        <div className="ps-countdown-inner ps-countdown-inner--editable">
                          <div className="ps-countdown-edit-row">
                            <div className="ps-countdown-edit-field">
                              <input
                                type="number"
                                className="ps-countdown-edit-input"
                                min={0}
                                value={Math.floor(step.seconds / 60)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const mins = Math.max(0, Number(e.target.value) || 0);
                                  const secs = step.seconds % 60;
                                  updateStep(step.id, (prev) => ({
                                    ...prev,
                                    seconds: mins * 60 + secs,
                                  } as PreServiceStep));
                                }}
                              />
                              <span className="ps-countdown-edit-unit">min</span>
                            </div>
                            <span className="ps-countdown-edit-sep">:</span>
                            <div className="ps-countdown-edit-field">
                              <input
                                type="number"
                                className="ps-countdown-edit-input"
                                min={0}
                                max={59}
                                value={step.seconds % 60}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                                  const mins = Math.floor(step.seconds / 60);
                                  updateStep(step.id, (prev) => ({
                                    ...prev,
                                    seconds: mins * 60 + secs,
                                  } as PreServiceStep));
                                }}
                              />
                              <span className="ps-countdown-edit-unit">sec</span>
                            </div>
                          </div>
                          <div className="ps-step-duration-grid ps-step-duration-grid--single">
                            <div className="ps-step-duration-field">
                              <span className="ps-step-duration-label">Theme</span>
                              <select
                                className="ps-step-duration-select"
                                value={step.theme || "classic"}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  updateStep(step.id, (prev) => ({
                                    ...prev,
                                    theme: e.target.value as PreServiceCountdownTheme,
                                  } as PreServiceStep));
                                }}
                              >
                                {COUNTDOWN_THEME_OPTIONS.map((theme) => (
                                  <option key={theme.id} value={theme.id}>{theme.title}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                            <p className="ps-countdown-label" style={{ margin: 0 }}>Edit duration and theme</p>
                            <button
                              type="button"
                              className="ps-media-delete"
                              disabled={isRunning || isPaused}
                              onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                              title="Delete step"
                            >
                              <Icon name="delete" size={20} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Scene step body ── */}
                  {isSceneStep(step) && (
                    <div className="ps-scene-display" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Icon name="switch_video" size={20} />
                          <span className="ps-scene-name">{step.sceneName || "Select a scene"}</span>
                        </div>
                        <button
                          type="button"
                          className="ps-media-delete"
                          disabled={isRunning || isPaused}
                          onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                          title="Delete step"
                        >
                          <Icon name="delete" size={20} />
                        </button>
                      </div>
                      <div className="ps-step-duration-grid">
                        <div className="ps-step-duration-field">
                          <span className="ps-step-duration-label">Minutes</span>
                          <input
                            type="number"
                            min={0}
                            className="ps-step-duration-input"
                            value={Math.floor((step.durationSeconds || 0) / 60)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const mins = Math.max(0, Number(e.target.value) || 0);
                              const secs = (step.durationSeconds || 0) % 60;
                              updateStep(step.id, (prev) => ({
                                ...prev,
                                durationSeconds: mins * 60 + secs,
                              }));
                            }}
                          />
                        </div>
                        <div className="ps-step-duration-field">
                          <span className="ps-step-duration-label">Seconds</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            className="ps-step-duration-input"
                            value={(step.durationSeconds || 0) % 60}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                              const mins = Math.floor((step.durationSeconds || 0) / 60);
                              updateStep(step.id, (prev) => ({
                                ...prev,
                                durationSeconds: mins * 60 + secs,
                              }));
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Go Live step body ── */}
                  {isGoLiveStep(step) && (
                    <div className="ps-scene-display" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Icon name="live_tv" size={20} />
                          <span className="ps-scene-name">Platform will switch to live mode.</span>
                        </div>
                        <button
                          type="button"
                          className="ps-media-delete"
                          disabled={isRunning || isPaused}
                          onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                          title="Delete step"
                        >
                          <Icon name="delete" size={20} />
                        </button>
                      </div>
                      <div className="ps-step-duration-grid">
                        <div className="ps-step-duration-field">
                          <span className="ps-step-duration-label">Minutes</span>
                          <input
                            type="number"
                            min={0}
                            className="ps-step-duration-input"
                            value={Math.floor((step.durationSeconds || 0) / 60)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const mins = Math.max(0, Number(e.target.value) || 0);
                              const secs = (step.durationSeconds || 0) % 60;
                              updateStep(step.id, (prev) => ({
                                ...prev,
                                durationSeconds: mins * 60 + secs,
                              }));
                            }}
                          />
                        </div>
                        <div className="ps-step-duration-field">
                          <span className="ps-step-duration-label">Seconds</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            className="ps-step-duration-input"
                            value={(step.durationSeconds || 0) % 60}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                              const mins = Math.floor((step.durationSeconds || 0) / 60);
                              updateStep(step.id, (prev) => ({
                                ...prev,
                                durationSeconds: mins * 60 + secs,
                              }));
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step footer */}
                  <div className="ps-step-footer">
                    <div className="ps-step-footer-left">
                      <button
                        type="button"
                        className="ps-add-media-btn"
                        disabled={isRunning || isPaused}
                        onClick={(e) => { e.stopPropagation(); moveStep(index, -1); }}
                        title="Move up"
                      >
                        <Icon name="arrow_upward" size={20} />
                      </button>
                      <button
                        type="button"
                        className="ps-add-media-btn"
                        disabled={isRunning || isPaused}
                        onClick={(e) => { e.stopPropagation(); moveStep(index, 1); }}
                        title="Move down"
                      >
                        <Icon name="arrow_downward" size={20} />
                      </button>
                    </div>
                    <div className="ps-step-footer-right">
                      {isGoLiveStep(step) ? (
                        <div className="ps-transition-wrap">
                          <span className="ps-transition-label">Platform Live Step</span>
                        </div>
                      ) : (
                        <div className="ps-transition-wrap">
                          <span className="ps-transition-label">Transition</span>
                          <span className="ps-transition-divider" />
                          <select
                            className="ps-transition-select"
                            disabled={isRunning || isPaused}
                            value={step.transition || "cut"}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateStep(step.id, (prev) => ({
                              ...prev,
                              transition: e.target.value as PreServiceTransition,
                            }))}
                          >
                            <option value="cut">Cut</option>
                            <option value="fade">Fade</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {plan.steps.length === 0 && (
            <div className="ps-empty-state">
              <Icon name="playlist_add" size={20} />
              <p>You can set things to display automatically — like a countdown, a video, images, or announcements.</p>
            </div>
          )}

          {/* Add New Step button */}
          <button
            type="button"
            className={`ps-add-step-btn${isRunning || isPaused ? " is-disabled-state" : ""}`}
            disabled={isRunning || isPaused}
            onClick={openAddStep}
          >
            <Icon name="add_circle" size={20} />
            <span>Add New Step</span>
          </button>
        </div>

        {/* ════ Right column: Sidebar ════ */}
        <div className="ps-sidebar-col">
          {/* Status Banner — changes based on state */}
          <div className={`ps-status-banner ps-status-banner--${runtime.status}`}>
            <div className="ps-status-banner-icon">
              <Icon name={runtime.status === "idle" ? "radio_button_unchecked" :
                 runtime.status === "running" ? "play_circle" :
                 runtime.status === "paused" ? "pause_circle" :
                 "check_circle"} size={20} />
            </div>
            <div className="ps-status-banner-text">
              <span className="ps-status-banner-label">
                {runtime.status === "idle" ? "Ready to Start" :
                 runtime.status === "running" ? "Now Playing" :
                 runtime.status === "paused" ? "Paused" :
                 "Completed"}
              </span>
              <span className="ps-status-banner-sub">
                {runtime.status === "idle"
                  ? `${plan.steps.length} step${plan.steps.length !== 1 ? "s" : ""} configured · Press Start to begin`
                  : runtime.status === "running"
                  ? `Step ${runtime.activeStepIndex + 1} of ${plan.steps.length}${activeStep ? ` · ${activeStep.label}` : ""}`
                  : runtime.status === "paused"
                  ? `Paused at step ${runtime.activeStepIndex + 1}${activeStep ? ` · ${activeStep.label}` : ""}`
                  : "Sequence finished — editing is available"}
              </span>
            </div>
          </div>

          {/* Sequence Monitor */}
          <div className="ps-sidebar-panel">
            <h3>
              <Icon name="monitor_heart" size={20} />
              Sequence Monitor
            </h3>
            <div className="ps-monitor-grid">
              <div className="ps-monitor-stat">
                <div className="ps-monitor-stat-top">
                  <span className="ps-monitor-stat-label">Total Duration</span>
                </div>
                <div className="ps-monitor-stat-value">
                  {totalDuration >= 60 ? `${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s` : `${totalDuration}s`}
                </div>
                <div className="ps-monitor-stat-sub">{plan.steps.length} step{plan.steps.length !== 1 ? "s" : ""} configured</div>
                <div className="ps-monitor-stat-bar ps-monitor-stat-bar--primary" />
              </div>
              {runtime.status !== "idle" && (
                <div className="ps-monitor-stat">
                  <div className="ps-monitor-stat-top">
                    <span className="ps-monitor-stat-label">Next Event</span>
                  </div>
                  <div className="ps-monitor-stat-value">
                    {nextStep ? nextStep.label : "Complete"}
                  </div>
                  <div className="ps-monitor-stat-sub">
                    {nextStep ? `After current step` : "Sequence done"}
                  </div>
                  <div className="ps-monitor-stat-bar ps-monitor-stat-bar--blue" />
                </div>
              )}
              {runtime.status === "idle" && plan.steps.length > 0 && (
                <div className="ps-monitor-stat">
                  <div className="ps-monitor-stat-top">
                    <span className="ps-monitor-stat-label">First Step</span>
                  </div>
                  <div className="ps-monitor-stat-value">
                    {plan.steps[0].label}
                  </div>
                  <div className="ps-monitor-stat-sub">
                    Will execute when you press Start
                  </div>
                  <div className="ps-monitor-stat-bar ps-monitor-stat-bar--green" />
                </div>
              )}
            </div>
          </div>

          {/* Control Actions */}
          <div className="ps-control-panel">
            <h3>Control Actions</h3>
            <div className="ps-control-btns">
              {!isRunning ? (
                <button
                  type="button"
                  className="ps-btn-start"
                  onClick={isPaused ? startSequence : () => setShowStartConfirm(true)}
                  disabled={!obsConnected || plan.steps.length === 0}
                >
                  <Icon name="play_arrow" size={20} />
                  <span>{pausedAtManualHold ? "Continue Sequence" : isPaused ? "Resume Sequence" : "Start Sequence"}</span>
                </button>
              ) : (
                <button type="button" className="ps-btn-start" onClick={pauseSequence}>
                  <Icon name="pause" size={20} />
                  <span>Pause</span>
                </button>
              )}

              <button
                type="button"
                className="ps-btn-stop"
                onClick={stopAndReset}
                disabled={runtime.status === "idle"}
              >
                <Icon name="stop_circle" size={20} />
                Stop / Reset
              </button>

              <button
                type="button"
                className="ps-btn-secondary"
                onClick={skipStep}
                disabled={!isRunning && !isPaused}
              >
                <Icon name="skip_next" size={20} />
                Skip Step
              </button>

              <button
                type="button"
                className={`ps-btn-secondary ps-btn-golive${isStreaming ? " is-live" : ""}`}
                onClick={goLiveNow}
                disabled={!obsConnected}
              >
                <Icon name={isStreaming ? "live_tv" : "cast"} size={20} />
                {isStreaming ? "Push to Program" : "Push to Program"}
              </button>

              {/* Settings */}
              <div className="ps-settings-row">
                <div className="ps-setting-item">
                  <label>Loop Sequence</label>
                  <input
                    type="checkbox"
                    checked={plan.loopEnabled}
                    onChange={(e) => setPlan((prev) => ({ ...prev, loopEnabled: e.target.checked }))}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddStepModal && (
        <div className="pre-service-modal-backdrop" onClick={closeAddStep}>
          <div className="pre-service-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pre-service-modal-head">
              <div className="pre-service-modal-head-content">
                <h4>Add New Step</h4>
                <p>
                  {addModalStage === "select"
                    ? "Select the type of automation step to add to your sequence."
                    : `Configure ${selectedTypeOption?.title ?? "step"} details.`}
                </p>
              </div>
              <button type="button" onClick={closeAddStep}>
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="pre-service-modal-body">
              {addModalStage === "select" && (
                <div className="pre-service-step-type-grid pre-service-step-type-grid--picker">
                  {STEP_TYPE_OPTIONS.map((option, idx) => {
                    const isSelected = selectedCardIndex === idx;
                    const isDisabled = !!option.disabled;
                    return (
                      <button
                        key={`${option.type}-${idx}`}
                        type="button"
                        className={`type-card${isSelected ? " is-selected" : ""}${isDisabled ? " is-disabled" : ""}`}
                        disabled={isDisabled}
                        onClick={() => {
                          if (isDisabled) return;
                          setSelectedCardIndex(idx);
                          setAddDraft((prev) => ({
                            ...prev,
                            type: option.type,
                            configType: option.id,
                            mediaId: "",
                            mediaUrl: "",
                            label: "",
                            durationMode: option.id === "video" ? "auto" : "manual",
                            durationSeconds: option.id === "goLive" ? 0 : prev.durationSeconds,
                          }));
                        }}
                      >
                        {isSelected && !isDisabled && (
                          <span className="type-card-check">
                            <Icon name="check" size={20} />
                          </span>
                        )}
                        <span className={`type-card-icon${isDisabled ? " is-disabled" : ""}`}>
                          <Icon name={option.icon} size={20} />
                        </span>
                        <span className="type-card-body">
                          <span className="type-card-title">{option.title}</span>
                          <span className="type-card-desc">{option.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "video" && (
                <div className="cfg-media-picker">
                  <div className="cfg-media-picker__toolbar">
                    <div className="cfg-search-wrap">
                      <Icon name="search" size={20} className="cfg-search-icon" />
                      <input
                        type="text"
                        className="cfg-search-input"
                        placeholder="Search filenames..."
                        value={videoSearch}
                        onChange={(event) => setVideoSearch(event.target.value)}
                        aria-label="Search filenames"
                      />
                      {videoSearch && (
                        <button
                          type="button"
                          className="cfg-search-clear"
                          onClick={() => setVideoSearch("")}
                          aria-label="Clear filename search"
                          title="Clear filename search"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="cfg-filter-pills">
                      <button className="cfg-pill is-active">All Media</button>
                      <button className="cfg-pill">Countdowns</button>
                      <button className="cfg-pill">Loops</button>
                      <button className="cfg-pill">Promos</button>
                    </div>
                  </div>

                  {/* Upload zone */}
                  <div
                    className={`cfg-upload-zone${isDragging ? " is-dragging" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, "video")}
                  >
                    <Icon name="cloud_upload" size={20} />
                    <p>Drag & drop video files here, or</p>
                    <button
                      type="button"
                      className="cfg-upload-btn"
                      onClick={() => videoUploadRef.current?.click()}
                    >
                      Browse Files
                    </button>
                    <input
                      ref={videoUploadRef}
                      type="file"
                      accept={VIDEO_UPLOAD_ACCEPT}
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => {
                        void handleFileUpload(e.target.files, "video");
                        e.target.value = "";
                      }}
                    />
                    <span className="cfg-upload-hint">MP4, MOV, WebM, MKV, AVI</span>
                  </div>

                  <div className="cfg-media-grid cfg-media-grid--video">
                    {mediaLibrary.filter((m) => /\.(mp4|mov|webm|mkv|avi)$/i.test(m.name || m.filePath)).length === 0 && (
                      <div className="cfg-empty-state">
                        <Icon name="video_library" size={20} />
                        <p>No video files found in your media library.</p>
                      </div>
                    )}
                    {mediaLibrary
                      .filter((m) => /\.(mp4|mov|webm|mkv|avi)$/i.test(m.name || m.filePath))
                      .map((item) => {
                        const isSelected = addDraft.mediaId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`cfg-media-card${isSelected ? " is-selected" : ""}`}
                            onClick={() => applyMediaPreset(item, "video")}
                          >
                            <div className="cfg-media-card__thumb">
                              {item.previewSrc ? (
                                <img src={item.previewSrc} alt={item.name} />
                              ) : (
                                <Icon name="movie" size={20} className="cfg-media-card__placeholder" />
                              )}
                              <div className="cfg-media-card__gradient" />
                            </div>
                            {isSelected && (
                              <span className="cfg-media-card__check">
                                <Icon name="check" size={20} />
                              </span>
                            )}
                            <div className="cfg-media-card__info">
                              <span className="cfg-media-card__name">{item.name}</span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <div className="cfg-selection-bar">
                    <div className="cfg-selection-bar__count">
                      {addDraft.mediaId ? (
                        <>
                          <span className="cfg-badge">1</span>
                          <span>video selected</span>
                        </>
                      ) : (
                        <span className="cfg-selection-bar__hint">Select a video to continue</span>
                      )}
                    </div>
                    {addDraft.mediaId && addDraft.durationSeconds > 0 && (
                      <div className="cfg-selection-bar__duration">
                        <Icon name="schedule" size={16} />
                        <span className="cfg-duration-inline-label">
                          Duration: {formatSeconds(addDraft.durationSeconds)}
                        </span>
                        <span className="cfg-duration-auto-badge">Auto</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "image" && (
                <div className="cfg-media-picker">
                  <div className="cfg-media-picker__toolbar">
                    <div className="cfg-search-wrap">
                      <Icon name="search" size={20} className="cfg-search-icon" />
                      <input
                        type="text"
                        className="cfg-search-input"
                        placeholder="Search assets..."
                        value={imageSearch}
                        onChange={(event) => setImageSearch(event.target.value)}
                        aria-label="Search assets"
                      />
                      {imageSearch && (
                        <button
                          type="button"
                          className="cfg-search-clear"
                          onClick={() => setImageSearch("")}
                          aria-label="Clear asset search"
                          title="Clear asset search"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="cfg-filter-pills">
                      <button className="cfg-pill is-active">All Assets</button>
                      <button className="cfg-pill">Worship</button>
                      <button className="cfg-pill">Giving</button>
                      <button className="cfg-pill">Sermon</button>
                    </div>
                  </div>

                  {/* Upload zone — multiple files */}
                  <div
                    className={`cfg-upload-zone${isDragging ? " is-dragging" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, "image")}
                  >
                    <Icon name="cloud_upload" size={20} />
                    <p>Drag & drop images here, or</p>
                    <button
                      type="button"
                      className="cfg-upload-btn"
                      onClick={() => imageUploadRef.current?.click()}
                    >
                      Browse Files
                    </button>
                    <input
                      ref={imageUploadRef}
                      type="file"
                      accept={IMAGE_UPLOAD_ACCEPT}
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => {
                        void handleFileUpload(e.target.files, "image");
                        e.target.value = "";
                      }}
                    />
                    <span className="cfg-upload-hint">PNG, JPG, GIF, WebP, SVG — Select multiple</span>
                  </div>

                  <div className="cfg-media-grid cfg-media-grid--image">
                    {mediaLibrary.filter((m) => /\.(png|jpg|jpeg|gif|bmp|svg|webp)$/i.test(m.name || m.filePath)).length === 0 && (
                      <div className="cfg-empty-state">
                        <Icon name="add_photo_alternate" size={20} />
                        <p>No image files found in your media library.</p>
                      </div>
                    )}
                    {mediaLibrary
                      .filter((m) => /\.(png|jpg|jpeg|gif|bmp|svg|webp)$/i.test(m.name || m.filePath))
                      .map((item) => {
                        const isSelected = addDraft.mediaId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`cfg-media-card cfg-media-card--image${isSelected ? " is-selected" : ""}`}
                            onClick={() => applyMediaPreset(item, "image")}
                          >
                            <div className="cfg-media-card__thumb">
                              {item.previewSrc ? (
                                <img src={item.previewSrc} alt={item.name} />
                              ) : (
                                <Icon name="image" size={20} className="cfg-media-card__placeholder" />
                              )}
                              <div className="cfg-media-card__gradient" />
                            </div>
                            {isSelected && (
                              <span className="cfg-media-card__check">
                                <Icon name="check" size={20} />
                              </span>
                            )}
                            <div className="cfg-media-card__info">
                              <span className="cfg-media-card__name">{item.name}</span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <div className="cfg-selection-bar">
                    <div className="cfg-selection-bar__count">
                      {addDraft.mediaId ? (
                        <>
                          <span className="cfg-badge">1</span>
                          <span>item selected</span>
                        </>
                      ) : (
                        <span className="cfg-selection-bar__hint">Select an image to continue</span>
                      )}
                    </div>
                    {addDraft.mediaId && (
                      <div className="cfg-selection-bar__duration">
                        <label className="cfg-duration-inline-label">Duration</label>
                        <div className="cfg-duration-inline-inputs">
                          <input
                            type="number"
                            className="cfg-duration-inline-field"
                            min={0}
                            value={Math.floor(addDraft.durationSeconds / 60)}
                            onChange={(e) => {
                              const mins = Math.max(0, Number(e.target.value) || 0);
                              const secs = addDraft.durationSeconds % 60;
                              setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                            }}
                          />
                          <span className="cfg-duration-inline-sep">m</span>
                          <input
                            type="number"
                            className="cfg-duration-inline-field"
                            min={0}
                            max={59}
                            value={addDraft.durationSeconds % 60}
                            onChange={(e) => {
                              const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                              const mins = Math.floor(addDraft.durationSeconds / 60);
                              setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                            }}
                          />
                          <span className="cfg-duration-inline-sep">s</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "countdown" && (
                <div className="cfg-countdown">
                  <div className="cfg-countdown__sidebar">
                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Duration</label>
                      <div className="cfg-countdown__duration-grid">
                        <div className="cfg-duration-input">
                          <span className="cfg-duration-input__label">Minutes</span>
                          <input
                            type="number"
                            className="cfg-duration-input__field"
                            min={0}
                            value={Math.floor(addDraft.countdownSeconds / 60)}
                            onChange={(e) => {
                              const mins = Math.max(0, Number(e.target.value) || 0);
                              const secs = addDraft.countdownSeconds % 60;
                              setAddDraft((prev) => ({ ...prev, countdownSeconds: mins * 60 + secs }));
                            }}
                          />
                        </div>
                        <div className="cfg-duration-input">
                          <span className="cfg-duration-input__label">Seconds</span>
                          <input
                            type="number"
                            className="cfg-duration-input__field"
                            min={0}
                            max={59}
                            value={addDraft.countdownSeconds % 60}
                            onChange={(e) => {
                              const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                              const mins = Math.floor(addDraft.countdownSeconds / 60);
                              setAddDraft((prev) => ({ ...prev, countdownSeconds: mins * 60 + secs }));
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Theme</label>
                      <div className="cfg-select-wrap">
                        <select
                          className="cfg-select"
                          value={addDraft.countdownTheme}
                          onChange={(e) => setAddDraft((prev) => ({
                            ...prev,
                            countdownTheme: e.target.value as PreServiceCountdownTheme,
                          }))}
                        >
                          {COUNTDOWN_THEME_OPTIONS.map((theme) => (
                            <option key={theme.id} value={theme.id}>
                              {theme.title}
                            </option>
                          ))}
                        </select>
                        <Icon name="expand_more" size={20} className="cfg-select-chevron" />
                      </div>
                      <p className="cfg-field-hint">
                        {COUNTDOWN_THEME_OPTIONS.find((theme) => theme.id === addDraft.countdownTheme)?.subtitle}
                      </p>
                    </div>

                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Timer Label</label>
                      <div className="cfg-text-input-wrap">
                        <Icon name="short_text" size={20} className="cfg-text-input-icon" />
                        <input
                          type="text"
                          className="cfg-text-input"
                          placeholder="e.g. Service Starts In"
                          value={addDraft.label}
                          onChange={(e) => setAddDraft((prev) => ({ ...prev, label: e.target.value }))}
                        />
                      </div>
                      <p className="cfg-field-hint">Main text displayed above the timer.</p>
                    </div>

                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Transition</label>
                      <select
                        className="cfg-select"
                        value={addDraft.transition}
                        onChange={(e) => setAddDraft((prev) => ({
                          ...prev,
                          transition: e.target.value as PreServiceTransition,
                        }))}
                      >
                        <option value="cut">Cut</option>
                        <option value="fade">Fade</option>
                      </select>
                    </div>
                  </div>

                  <div className={`cfg-countdown__preview cfg-countdown__preview--${addDraft.countdownTheme}`}>
                    <div className="cfg-countdown__preview-grid" />
                    <div className="cfg-countdown__preview-card">
                      <div className="cfg-countdown__preview-time">
                        {formatSeconds(addDraft.countdownSeconds)}
                      </div>
                      <p className="cfg-countdown__preview-msg">
                        {addDraft.label || "Service Starting Soon"}
                      </p>
                      <div className="cfg-countdown__preview-badge">Preview Output</div>
                    </div>
                  </div>
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "audio" && (
                <div className="cfg-audio-picker">
                  <div className="cfg-media-picker__toolbar">
                    <div className="cfg-search-wrap">
                      <Icon name="search" size={20} className="cfg-search-icon" />
                      <input
                        type="text"
                        className="cfg-search-input"
                        placeholder="Search tracks, tags, or artists..."
                        value={audioSearch}
                        onChange={(event) => setAudioSearch(event.target.value)}
                        aria-label="Search tracks, tags, or artists"
                      />
                      {audioSearch && (
                        <button
                          type="button"
                          className="cfg-search-clear"
                          onClick={() => setAudioSearch("")}
                          aria-label="Clear audio search"
                          title="Clear audio search"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="cfg-filter-pills">
                      <button className="cfg-pill is-active">Audio Library</button>
                    </div>
                  </div>
                  <div
                    className={`cfg-upload-zone${isDragging ? " is-dragging" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, "audio")}
                  >
                    <Icon name="library_music" size={20} />
                    <p>Drag & drop audio files here, or</p>
                    <button
                      type="button"
                      className="cfg-upload-btn"
                      onClick={() => audioUploadRef.current?.click()}
                    >
                      Browse Audio
                    </button>
                    <input
                      ref={audioUploadRef}
                      type="file"
                      accept={AUDIO_UPLOAD_ACCEPT}
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => {
                        void handleFileUpload(e.target.files, "audio");
                        e.target.value = "";
                      }}
                    />
                    <span className="cfg-upload-hint">MP3, WAV, OGG, FLAC, AAC, M4A, WMA</span>
                  </div>
                  <div className="cfg-audio-table-wrap">
                    <table className="cfg-audio-table">
                      <thead>
                        <tr>
                          <th style={{ width: 48 }}></th>
                          <th>Track Details</th>
                          <th style={{ width: 80, textAlign: "right" }}>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audioTracks.map((item) => {
                            const isSelected = addDraft.mediaId === item.id;
                            return (
                              <tr
                                key={item.id}
                                className={isSelected ? "is-selected" : ""}
                                onClick={() => applyMediaPreset(item, "audio")}
                              >
                                <td>
                                  <button type="button" className={`cfg-audio-play-btn${isSelected ? " is-active" : ""}`}>
                                    <Icon name={isSelected ? "check_circle" : "play_arrow"} size={20} />
                                  </button>
                                </td>
                                <td>
                                  <span className="cfg-audio-track-name">{item.name}</span>
                                </td>
                                <td className="cfg-audio-dur">—</td>
                              </tr>
                            );
                          })}
                        {audioTracks.length === 0 && (
                          <tr>
                            <td colSpan={3}>
                              <div className="cfg-empty-state">
                                <Icon name="music_off" size={20} />
                                <p>No audio files found yet. Upload tracks to use them in this sequence.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="cfg-selection-bar">
                    <div className="cfg-selection-bar__count">
                      {addDraft.mediaId ? (
                        <>
                          <span className="cfg-badge">1</span>
                          <span>track selected</span>
                        </>
                      ) : (
                        <span className="cfg-selection-bar__hint">Select an audio track to continue</span>
                      )}
                    </div>
                    <div className="cfg-selection-bar__duration">
                      <label className="cfg-duration-inline-label">Duration</label>
                      <div className="cfg-duration-inline-inputs">
                        <input
                          type="number"
                          className="cfg-duration-inline-field"
                          min={0}
                          value={Math.floor(addDraft.durationSeconds / 60)}
                          onChange={(e) => {
                            const mins = Math.max(0, Number(e.target.value) || 0);
                            const secs = addDraft.durationSeconds % 60;
                            setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                          }}
                        />
                        <span className="cfg-duration-inline-sep">m</span>
                        <input
                          type="number"
                          className="cfg-duration-inline-field"
                          min={0}
                          max={59}
                          value={addDraft.durationSeconds % 60}
                          onChange={(e) => {
                            const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                            const mins = Math.floor(addDraft.durationSeconds / 60);
                            setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                          }}
                        />
                        <span className="cfg-duration-inline-sep">s</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "scene" && (
                <div className="cfg-scene">
                  <div className="cfg-scene__icon-wrap">
                    <Icon name="switch_video" size={20} />
                  </div>
                  <div className="cfg-field-group">
                    <label className="cfg-label-upper">Target OBS Scene</label>
                    <div className="cfg-select-wrap">
                      <select
                        className="cfg-select cfg-select--lg"
                        value={addDraft.sceneName}
                        onChange={(e) => setAddDraft((prev) => ({ ...prev, sceneName: e.target.value }))}
                      >
                        <option value="">Select a scene...</option>
                        {availableScenes.map((scene) => (
                          <option key={scene} value={scene}>{scene}</option>
                        ))}
                      </select>
                      <Icon name="expand_more" size={20} className="cfg-select-chevron" />
                    </div>
                    <p className="cfg-field-hint">
                      <Icon name="wifi" size={14} />
                      Synced with OBS WebSocket
                    </p>
                  </div>

                  <div className="cfg-scene__grid-row">
                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Transition Type</label>
                      <div className="cfg-select-wrap">
                        <select
                          className="cfg-select"
                          value={addDraft.transition}
                          onChange={(e) => setAddDraft((prev) => ({
                            ...prev,
                            transition: e.target.value as PreServiceTransition,
                          }))}
                        >
                          <option value="cut">Cut</option>
                          <option value="fade">Fade</option>
                        </select>
                        <Icon name="expand_more" size={20} className="cfg-select-chevron" />
                      </div>
                    </div>

                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Label</label>
                      <input
                        type="text"
                        className="cfg-text-input"
                        value={addDraft.label}
                        onChange={(e) => setAddDraft((prev) => ({ ...prev, label: e.target.value }))}
                        placeholder="Scene Switch"
                      />
                    </div>

                    <div className="cfg-field-group">
                      <label className="cfg-label-upper">Duration</label>
                      <div className="cfg-countdown__duration-grid">
                        <div className="cfg-duration-input">
                          <span className="cfg-duration-input__label">Minutes</span>
                          <input
                            type="number"
                            className="cfg-duration-input__field"
                            min={0}
                            value={Math.floor(addDraft.durationSeconds / 60)}
                            onChange={(e) => {
                              const mins = Math.max(0, Number(e.target.value) || 0);
                              const secs = addDraft.durationSeconds % 60;
                              setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                            }}
                          />
                        </div>
                        <div className="cfg-duration-input">
                          <span className="cfg-duration-input__label">Seconds</span>
                          <input
                            type="number"
                            className="cfg-duration-input__field"
                            min={0}
                            max={59}
                            value={addDraft.durationSeconds % 60}
                            onChange={(e) => {
                              const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                              const mins = Math.floor(addDraft.durationSeconds / 60);
                              setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                            }}
                          />
                        </div>
                      </div>
                      <p className="cfg-field-hint">How long to stay on this scene before advancing.</p>
                    </div>
                  </div>
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "goLive" && (
                <div className="cfg-scene">
                  <div className="cfg-scene__icon-wrap">
                    <Icon name="live_tv" size={20} />
                  </div>
                  <div className="cfg-field-group">
                    <label className="cfg-label-upper">Step Label</label>
                    <input
                      type="text"
                      className="cfg-text-input"
                      value={addDraft.label}
                      onChange={(e) => setAddDraft((prev) => ({ ...prev, label: e.target.value }))}
                      placeholder="Go Live"
                    />
                    <p className="cfg-field-hint">
                      This step sets the platform state to live and opens the live service hub.
                    </p>
                  </div>
                  <div className="cfg-field-group">
                    <label className="cfg-label-upper">Delay Before Going Live</label>
                    <div className="cfg-countdown__duration-grid">
                      <div className="cfg-duration-input">
                        <span className="cfg-duration-input__label">Minutes</span>
                        <input
                          type="number"
                          className="cfg-duration-input__field"
                          min={0}
                          value={Math.floor(addDraft.durationSeconds / 60)}
                          onChange={(e) => {
                            const mins = Math.max(0, Number(e.target.value) || 0);
                            const secs = addDraft.durationSeconds % 60;
                            setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                          }}
                        />
                      </div>
                      <div className="cfg-duration-input">
                        <span className="cfg-duration-input__label">Seconds</span>
                        <input
                          type="number"
                          className="cfg-duration-input__field"
                          min={0}
                          max={59}
                          value={addDraft.durationSeconds % 60}
                          onChange={(e) => {
                            const secs = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                            const mins = Math.floor(addDraft.durationSeconds / 60);
                            setAddDraft((prev) => ({ ...prev, durationSeconds: mins * 60 + secs }));
                          }}
                        />
                      </div>
                    </div>
                    <p className="cfg-field-hint">Set to 0:00 to go live immediately when this step runs.</p>
                  </div>
                </div>
              )}

              {addModalStage === "configure" && selectedCard === "template" && (
                <div className="cfg-template">
                  <div className="cfg-template__grid">
                    <div className="cfg-template-card">
                      <div className="cfg-template-card__preview">
                        <Icon name="play_circle" size={20} />
                      </div>
                      <div className="cfg-template-card__body">
                        <h4>Sunday Service Intro</h4>
                        <p>2 Videos, 1 Countdown, 1 Scene Switch</p>
                        <div className="cfg-template-card__meta">
                          <span className="cfg-template-card__time">Total: 08:30</span>
                          <span className="cfg-template-card__tag">Standard</span>
                        </div>
                      </div>
                    </div>
                    <div className="cfg-template-card cfg-template-card--add">
                      <div className="cfg-template-card__add-inner">
                        <Icon name="add_circle" size={20} />
                        <h4>Save Current as Template</h4>
                        <p>Save the steps currently in your timeline as a new preset.</p>
                      </div>
                    </div>
                  </div>
                  <div className="cfg-selection-bar">
                    <div className="cfg-selection-bar__count">
                      <Icon name="info" size={18} />
                      <span>Select a template to import its steps.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pre-service-modal-footer">
              {addModalStage === "select" ? (
                <>
                  <button type="button" className="ghost" onClick={closeAddStep}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => setAddModalStage("configure")}
                    disabled={!!STEP_TYPE_OPTIONS[selectedCardIndex]?.disabled}
                  >
                    Next
                    <Icon name="arrow_forward" size={20} />
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={() => setAddModalStage("select")}>
                    <Icon name="arrow_back" size={20} />
                    Back
                  </button>
                  <button type="button" onClick={addStep}>
                    Add Step
                    <Icon name="arrow_forward" size={20} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Push to Program Confirmation Modal ── */}
      {showGoLiveConfirm && (
        <div className="pre-service-modal-backdrop" onClick={() => setShowGoLiveConfirm(false)}>
          <div className="ps-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ps-confirm-icon">
              <Icon name="cast" size={20} />
            </div>
            <h3 className="ps-confirm-title">Push to Program?</h3>
            <p className="ps-confirm-text">
              This will transition the current preview output to the live program and take you to the Service Hub.
              {(isRunning || isPaused) && " The running pre-service sequence will be stopped."}
              {isStreaming && " You are currently streaming — your audience will see this change immediately."}
            </p>
            <div className="ps-confirm-actions">
              <button
                type="button"
                className="ps-confirm-cancel"
                onClick={() => setShowGoLiveConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ps-confirm-go"
                onClick={confirmGoLive}
              >
                <Icon name="cast" size={20} />
                Yes, Push to Program
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Start Sequence Confirmation Modal ── */}
      {showStartConfirm && (
        <div className="pre-service-modal-backdrop" onClick={() => setShowStartConfirm(false)}>
          <div className="ps-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ps-confirm-icon" style={{ background: "rgba(0,230,118,0.12)" }}>
              <Icon name="play_arrow" size={20} style={{ color: "#00E676" }} />
            </div>
            <h3 className="ps-confirm-title">Start Sequence?</h3>
            <p className="ps-confirm-text">
              This will begin the pre-service automation with {plan.steps.length} step{plan.steps.length !== 1 ? "s" : ""}.
              {isStreaming && " You are currently streaming — changes will be visible to your audience."}
            </p>
            <div className="ps-confirm-actions">
              <button
                type="button"
                className="ps-confirm-cancel"
                onClick={() => setShowStartConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ps-confirm-go"
                style={{ background: "#00E676", color: "#121212" }}
                onClick={() => { setShowStartConfirm(false); startSequence(); }}
              >
                <Icon name="play_arrow" size={20} />
                Start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Service Confirmation Modal ── */}
      {showCancelConfirm && (
        <div className="pre-service-modal-backdrop" onClick={() => setShowCancelConfirm(false)}>
          <div className="ps-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ps-confirm-icon" style={{ background: "rgba(244,67,54,0.12)" }}>
              <Icon name="cancel" size={20} style={{ color: "#F44336" }} />
            </div>
            <h3 className="ps-confirm-title">Cancel Service?</h3>
            <p className="ps-confirm-text">
              This will stop the pre-service automation and return to the dashboard.
              All progress will be lost.
            </p>
            <div className="ps-confirm-actions">
              <button
                type="button"
                className="ps-confirm-cancel"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep Going
              </button>
              <button
                type="button"
                className="ps-confirm-go"
                style={{ background: "#F44336" }}
                onClick={() => {
                  setShowCancelConfirm(false);
                  stopAndReset();
                  serviceStore.reset();
                  navigate("/");
                }}
              >
                <Icon name="cancel" size={20} />
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
