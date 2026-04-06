/**
 * MVSettings.tsx — Unified Settings
 *
 * Tabs:
 *   General  — OBS Connection, Canvas, Editor, Auto-Save, Appearance, Shortcuts, About, Danger Zone
 *   Branding — Church profile, logo, social handles, brand color, service defaults
 *   Bible    — Colour mode, Translation, Theme, Slide Config, Behaviour, Accessibility
 */

import { useState, useCallback, useEffect, useMemo, useRef, type ChangeEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import { CANVAS_PRESETS } from "../types";
import * as db from "../mvStore";
import {
  type MVSettings as MVSettingsType,
  type SpeakerProfileSetting,
  DEFAULT_SETTINGS,
} from "../mvStore";
import { obsService } from "../../services/obsService";
import { refreshTheme } from "../components/MVThemeProvider";
import {
  SHORTCUTS,
  shortcutLabel,
  CATEGORY_LABELS,
  getShortcutsByCategory,
  type ShortcutCategory,
} from "../shortcuts";

// Bible settings imports
import { useBible } from "../../bible/bibleStore";
import { getBibleSettings, saveBibleSettings, getInstalledTranslations } from "../../bible/bibleDb";
import type { BibleTranslation } from "../../bible/types";
import { getOverlayBaseUrl, getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { AppLogo } from "../../components/AppLogo";
import { ltDurationStore } from "../../lowerthirds/ltDurationStore";
import { applyBrandingSettingsToDom } from "../../services/branding";
import { saveUploadFile } from "../../services/layoutEngine";
import { STREAMING_PLATFORM_OPTIONS, getStreamingPlatformLabel } from "../../services/streamQuality";
import { voiceBibleService } from "../../services/voiceBibleService";
import {
  DEFAULT_VOICE_BIBLE_SETTINGS,
  getMicrophonePermissionState,
  getVoiceBibleRuntimeStatus,
  getVoiceBibleSettings,
  isOllamaModelReady,
  listAudioInputDevices,
  listObsAudioInputs,
  prepareVoiceBibleModel,
  requestMicrophoneAccess,
  saveVoiceBibleSettings,
} from "../../services/voiceBibleSettings";
import type {
  VoiceBibleInputOption,
  VoiceBibleObsInputOption,
  VoiceBibleRuntimeStatus,
  VoiceBibleSettings,
} from "../../services/voiceBibleTypes";
import Icon from "../../components/Icon";

/* Dynamic — populated from IndexedDB installed translations */
const FALLBACK_TRANSLATIONS: { value: string; label: string }[] = [
  { value: "KJV", label: "King James Version (KJV)" },
];

type SettingsTab = "general" | "branding" | "bible";

const BRAND_LOGO_UPLOAD_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;
const BRAND_LOGO_UPLOAD_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
const BRAND_LOGO_UPLOAD_ACCEPT = [...BRAND_LOGO_UPLOAD_MIME_TYPES, ...BRAND_LOGO_UPLOAD_EXTENSIONS].join(",");
const EMPTY_SPEAKER_PROFILE: SpeakerProfileSetting = { name: "", role: "" };
const SPEAKER_POSITION_SUGGESTIONS = [
  "Lead Pastor",
  "Senior Pastor",
  "Associate Pastor",
  "Guest Speaker",
  "Minister",
  "Evangelist",
  "Reverend",
];

function hasAllowedBrandLogoExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = filename.slice(dot).toLowerCase();
  return BRAND_LOGO_UPLOAD_EXTENSIONS.includes(ext as (typeof BRAND_LOGO_UPLOAD_EXTENSIONS)[number]);
}

function resolveLogoPreviewSrc(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|blob:|asset:)/i.test(trimmed)) return trimmed;
  return convertFileSrc(trimmed);
}

function sanitizeSpeakerProfiles(value: unknown): SpeakerProfileSetting[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Partial<Record<string, unknown>>;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const role = typeof raw.role === "string" ? raw.role.trim() : "";
      if (!name) return null;
      return { name, role };
    })
    .filter((item): item is SpeakerProfileSetting => Boolean(item));
}

function parseLegacyPastorNames(pastorNames: string): SpeakerProfileSetting[] {
  return pastorNames
    .split(/\r?\n|,/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, role: "" }));
}

function resolveSpeakerProfiles(settings: MVSettingsType): SpeakerProfileSetting[] {
  const structured = sanitizeSpeakerProfiles((settings as Partial<MVSettingsType>).pastorSpeakers);
  if (structured.length > 0) return structured;
  return parseLegacyPastorNames(settings.pastorNames);
}

function compactSpeakerProfiles(profiles: SpeakerProfileSetting[]): SpeakerProfileSetting[] {
  return profiles
    .map((profile) => ({
      name: profile.name.trim(),
      role: profile.role.trim(),
    }))
    .filter((profile) => profile.name.length > 0);
}

/* ── Tiny inline toggle ── */
function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="mv-settings-toggle">
      <div className="mv-settings-toggle-text">
        <span className="mv-settings-toggle-label">{label}</span>
        {description && (
          <span className="mv-settings-toggle-desc">{description}</span>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        className={`mv-toggle ${checked ? "mv-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span className="mv-toggle-knob" />
      </button>
    </label>
  );
}

/* ── Number input with label ── */
function NumberSetting({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="mv-settings-number">
      <span>{label}</span>
      <div className="mv-settings-number-input">
        <input
          type="number"
          className="mv-input mv-input--sm"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="mv-settings-suffix">{suffix}</span>}
      </div>
    </label>
  );
}

export function MVSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<MVSettingsType>(db.getSettings);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [obsStatus, setObsStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [obsTestResult, setObsTestResult] = useState<string | null>(null);
  const [obsPasswordDraft, setObsPasswordDraft] = useState(() => db.getSettings().obsPassword ?? "");
  const obsPasswordScrubbedRef = useRef(false);
  const [overlayBaseUrl, setOverlayBaseUrl] = useState(() => getOverlayBaseUrlSync());
  const [overlayHealth, setOverlayHealth] = useState<"checking" | "healthy" | "unreachable">("checking");
  const [overlayHealthError, setOverlayHealthError] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutSearch, setShortcutSearch] = useState("");
  const [brandLogoPreviewSrc, setBrandLogoPreviewSrc] = useState<string>("");
  const [brandLogoStatus, setBrandLogoStatus] = useState<string | null>(null);
  const [brandLogoStatusType, setBrandLogoStatusType] = useState<"ok" | "err">("ok");
  const [brandLogoUploading, setBrandLogoUploading] = useState(false);
  const [speakerProfiles, setSpeakerProfiles] = useState<SpeakerProfileSetting[]>(() => {
    const profiles = resolveSpeakerProfiles(db.getSettings());
    return profiles.length > 0 ? profiles : [{ ...EMPTY_SPEAKER_PROFILE }];
  });

  // ── Bible settings state ──
  const { state: bibleState, dispatch: bibleDispatch, setTheme: bibleSetTheme } = useBible();
  const [bDefaultTranslation, setBDefaultTranslation] = useState<BibleTranslation>("KJV");
  const [bDefaultThemeId, setBDefaultThemeId] = useState("classic-dark");
  const [bShowVerseNumbers, setBShowVerseNumbers] = useState(true);
  const [bMaxLines, setBMaxLines] = useState(4);
  const [bAutoSend, setBAutoSend] = useState(true);
  const [bColorMode, setBColorMode] = useState<"dark" | "light" | "system">("dark");
  const [bReduceMotion, setBReduceMotion] = useState(false);
  const [bHighContrast, setBHighContrast] = useState(false);
  const [bSaved, setBSaved] = useState(false);
  const [bTranslations, setBTranslations] = useState(FALLBACK_TRANSLATIONS);
  const [bibleSettingsDirty, setBibleSettingsDirty] = useState(false);
  const [voiceBibleSettings, setVoiceBibleSettings] = useState<VoiceBibleSettings>(DEFAULT_VOICE_BIBLE_SETTINGS);
  const [voiceRuntime, setVoiceRuntime] = useState<VoiceBibleRuntimeStatus>({
    modelReady: false,
    modelName: "large-v3",
    modelPath: null,
  });
  const [voicePermission, setVoicePermission] = useState<PermissionState | "unsupported">("unsupported");
  const [voiceDevices, setVoiceDevices] = useState<VoiceBibleInputOption[]>([]);
  const [voiceObsInputs, setVoiceObsInputs] = useState<VoiceBibleObsInputOption[]>([]);
  const [voiceSemanticReady, setVoiceSemanticReady] = useState(false);
  const [voiceStatusMessage, setVoiceStatusMessage] = useState<string | null>(null);
  const [voiceStatusType, setVoiceStatusType] = useState<"ok" | "err">("ok");
  const [voicePreparingModel, setVoicePreparingModel] = useState(false);
  const [voiceBibleDirty, setVoiceBibleDirty] = useState(false);

  // Load Bible settings from IndexedDB on mount
  useEffect(() => {
    getBibleSettings().then((s) => {
      setBDefaultTranslation((s.defaultTranslation as BibleTranslation) ?? "KJV");
      setBDefaultThemeId(s.activeThemeId ?? "classic-dark");
      setBColorMode(s.colorMode ?? "dark");
      setBAutoSend(s.autoSendOnDoubleClick ?? true);
      setBReduceMotion(s.reduceMotion ?? false);
      setBHighContrast(s.highContrast ?? false);
      if (s.slideConfig) {
        setBShowVerseNumbers(s.slideConfig.showVerseNumbers ?? true);
        setBMaxLines(s.slideConfig.maxLines ?? 4);
      }
      setBibleSettingsDirty(false);
    }).catch(console.error);

    // Load dynamic translation list from IndexedDB
    getInstalledTranslations().then((list) => {
      if (list.length > 0) {
        setBTranslations(
          list.map((t) => ({ value: t.abbr, label: `${t.name} (${t.abbr})` }))
        );
      }
    }).catch(console.error);
  }, []);

  const refreshVoiceBibleDiagnostics = useCallback(async () => {
    const [runtime, permission, devices] = await Promise.all([
      getVoiceBibleRuntimeStatus().catch(() => ({
        modelReady: false,
        modelName: "large-v3",
        modelPath: null,
      })),
      getMicrophonePermissionState(),
      listAudioInputDevices().catch(() => []),
    ]);

    setVoiceRuntime(runtime);
    setVoicePermission(permission);
    setVoiceDevices(devices);

    if (obsService.isConnected) {
      const obsInputs = await listObsAudioInputs().catch(() => []);
      setVoiceObsInputs(obsInputs);
    } else {
      setVoiceObsInputs([]);
    }

    if (
      voiceBibleSettings.semanticMode === "ollama" &&
      voiceBibleSettings.ollamaBaseUrl &&
      voiceBibleSettings.ollamaModel
    ) {
      const ready = await isOllamaModelReady(
        voiceBibleSettings.ollamaBaseUrl,
        voiceBibleSettings.ollamaModel,
      );
      setVoiceSemanticReady(ready);
    } else {
      setVoiceSemanticReady(false);
    }
  }, [voiceBibleSettings.ollamaBaseUrl, voiceBibleSettings.ollamaModel, voiceBibleSettings.semanticMode]);

  useEffect(() => {
    getVoiceBibleSettings()
      .then((saved) => {
        setVoiceBibleSettings(saved);
        setVoiceBibleDirty(false);
      })
      .catch((err) => console.warn("[MVSettings] Failed to load Voice Bible settings:", err));
  }, []);

  useEffect(() => {
    void refreshVoiceBibleDiagnostics();
  }, [obsStatus, refreshVoiceBibleDiagnostics]);

  // Keep the Settings "Default Translation" aligned with the Bible page selection
  // unless the user is currently editing unsaved values in this form.
  useEffect(() => {
    if (bibleSettingsDirty) return;
    if (bDefaultTranslation !== bibleState.translation) {
      setBDefaultTranslation(bibleState.translation);
    }
  }, [bDefaultTranslation, bibleSettingsDirty, bibleState.translation]);

  // Listen for OBS connection changes
  useEffect(() => {
    const check = () => setObsStatus(obsService.isConnected ? "connected" : "disconnected");
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, []);

  const checkOverlayHealth = useCallback(async () => {
    setOverlayHealth("checking");
    setOverlayHealthError(null);
    try {
      const base = await getOverlayBaseUrl();
      setOverlayBaseUrl(base);
      const probe = await fetch(`${base}/bible-overlay-fullscreen.html`, { cache: "no-store" });
      if (!probe.ok) {
        throw new Error(`HTTP ${probe.status}`);
      }
      setOverlayHealth("healthy");
    } catch (err) {
      setOverlayHealth("unreachable");
      setOverlayHealthError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void checkOverlayHealth();
    const iv = window.setInterval(() => {
      void checkOverlayHealth();
    }, 15000);
    return () => window.clearInterval(iv);
  }, [checkOverlayHealth]);

  useEffect(() => {
    const logoPath = settings.brandLogoPath.trim();
    if (!logoPath) {
      setBrandLogoPreviewSrc("");
      return;
    }
    try {
      setBrandLogoPreviewSrc(resolveLogoPreviewSrc(logoPath));
    } catch {
      setBrandLogoPreviewSrc("");
    }
  }, [settings.brandLogoPath]);

  useEffect(() => {
    const profiles = resolveSpeakerProfiles(settings);
    setSpeakerProfiles(profiles.length > 0 ? profiles : [{ ...EMPTY_SPEAKER_PROFILE }]);
  }, [settings.pastorSpeakers, settings.pastorNames]);

  const applyLowerThirdDefaultDuration = useCallback((seconds: number) => {
    const safe = Math.max(1, Math.min(300, Math.floor(seconds || 10)));
    ltDurationStore.setGlobalDefaults({
      durations: {
        speaker: safe,
        scripture: safe,
        announcement: safe,
        generic: safe,
      },
    });
  }, []);

  useEffect(() => {
    applyBrandingSettingsToDom({ brandColor: settings.brandColor, churchName: settings.churchName });
    applyLowerThirdDefaultDuration(settings.lowerThirdDefaultDurationSec);
  }, []);

  const update = useCallback(
    (patch: Partial<MVSettingsType>) => {
      const next = db.updateSettings(patch);
      setSettings(next);
      // Side-effects for OBS
      if (patch.obsAutoReconnect !== undefined) {
        obsService.setAutoReconnect(patch.obsAutoReconnect);
      }
      // Side-effects for theme
      if (patch.theme !== undefined || patch.highContrast !== undefined) {
        refreshTheme();
      }
      if (patch.brandColor !== undefined || patch.churchName !== undefined) {
        applyBrandingSettingsToDom({ brandColor: next.brandColor, churchName: next.churchName });
      }
      if (patch.lowerThirdDefaultDurationSec !== undefined) {
        applyLowerThirdDefaultDuration(next.lowerThirdDefaultDurationSec);
      }
    },
    [applyLowerThirdDefaultDuration]
  );

  useEffect(() => {
    if (obsPasswordScrubbedRef.current) return;
    obsPasswordScrubbedRef.current = true;
    if (!settings.obsPassword) return;
    setObsPasswordDraft(settings.obsPassword);
    // Security hardening: keep OBS password in memory for this session only.
    update({ obsPassword: "" });
  }, [settings.obsPassword, update]);

  const persistSpeakerProfiles = useCallback((profiles: SpeakerProfileSetting[]) => {
    const compact = compactSpeakerProfiles(profiles);
    setSpeakerProfiles(profiles);
    update({
      pastorSpeakers: compact,
      pastorNames: compact.map((profile) => profile.name).join("\n"),
    });
  }, [update]);

  const handleSpeakerProfileNameChange = useCallback((index: number, name: string) => {
    const next = speakerProfiles.map((profile, profileIndex) => (
      profileIndex === index ? { ...profile, name } : profile
    ));
    persistSpeakerProfiles(next);
  }, [persistSpeakerProfiles, speakerProfiles]);

  const handleSpeakerProfileRoleChange = useCallback((index: number, role: string) => {
    const next = speakerProfiles.map((profile, profileIndex) => (
      profileIndex === index ? { ...profile, role } : profile
    ));
    persistSpeakerProfiles(next);
  }, [persistSpeakerProfiles, speakerProfiles]);

  const handleAddSpeakerProfileRow = useCallback(() => {
    // Only update local state — don't persist yet because compactSpeakerProfiles
    // would immediately strip the blank row before the user can type anything.
    setSpeakerProfiles((prev) => [...prev, { ...EMPTY_SPEAKER_PROFILE }]);
  }, []);

  const handleRemoveSpeakerProfileRow = useCallback((index: number) => {
    if (speakerProfiles.length <= 1) {
      persistSpeakerProfiles([{ ...EMPTY_SPEAKER_PROFILE }]);
      return;
    }
    persistSpeakerProfiles(speakerProfiles.filter((_, profileIndex) => profileIndex !== index));
  }, [persistSpeakerProfiles, speakerProfiles]);

  const handleClear = async () => {
    await db.clearAll();
    setCleared(true);
    setConfirmClear(false);
    setTimeout(() => setCleared(false), 3000);
  };

  const handleTestObs = async () => {
    setObsTestResult(null);
    setObsStatus("connecting");
    try {
      if (!obsService.isConnected) {
        await obsService.connect(settings.obsUrl, obsPasswordDraft || undefined);
      }
      const version = await obsService.call("GetVersion");
      setObsTestResult(
        `✓ Connected — OBS v${version.obsVersion}, WebSocket v${version.obsWebSocketVersion}`
      );
      setObsStatus("connected");
    } catch (err: any) {
      setObsTestResult(`✗ ${err.message || "Connection failed"}`);
      setObsStatus("disconnected");
    }
  };

  const handleDisconnect = () => {
    obsService.disconnect();
    setObsStatus("disconnected");
    setObsTestResult(null);
  };

  const handleResetSettings = () => {
    const next = db.updateSettings(DEFAULT_SETTINGS);
    setSettings({ ...next });
    setObsPasswordDraft("");
    setBrandLogoStatus(null);
    setBrandLogoStatusType("ok");
    applyBrandingSettingsToDom({ brandColor: next.brandColor, churchName: next.churchName });
    applyLowerThirdDefaultDuration(next.lowerThirdDefaultDurationSec);
  };

  const handleResetBrandingSettings = () => {
    update({
      churchName: DEFAULT_SETTINGS.churchName,
      pastorNames: DEFAULT_SETTINGS.pastorNames,
      pastorSpeakers: DEFAULT_SETTINGS.pastorSpeakers,
      lowerThirdDefaultDurationSec: DEFAULT_SETTINGS.lowerThirdDefaultDurationSec,
      brandColor: DEFAULT_SETTINGS.brandColor,
      brandLogoPath: DEFAULT_SETTINGS.brandLogoPath,
      socialWebsite: DEFAULT_SETTINGS.socialWebsite,
      socialInstagram: DEFAULT_SETTINGS.socialInstagram,
      socialFacebook: DEFAULT_SETTINGS.socialFacebook,
      socialYouTube: DEFAULT_SETTINGS.socialYouTube,
      socialX: DEFAULT_SETTINGS.socialX,
      socialTikTok: DEFAULT_SETTINGS.socialTikTok,
    });
    setSpeakerProfiles([{ ...EMPTY_SPEAKER_PROFILE }]);
    setBrandLogoStatus(null);
    setBrandLogoStatusType("ok");
  };

  const handleBrandLogoUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const isImageMime = file.type.startsWith("image/");
      const isAllowedExt = hasAllowedBrandLogoExtension(file.name);
      if (!isImageMime && !isAllowedExt) {
        setBrandLogoStatus("Unsupported logo type. Use PNG, JPG, WEBP, GIF, or SVG.");
        setBrandLogoStatusType("err");
        e.target.value = "";
        return;
      }

      setBrandLogoUploading(true);
      try {
        const absolutePath = await saveUploadFile(file);
        update({ brandLogoPath: absolutePath });
        setBrandLogoStatus(`Logo updated: ${file.name}`);
        setBrandLogoStatusType("ok");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Logo upload failed";
        setBrandLogoStatus(message);
        setBrandLogoStatusType("err");
      } finally {
        setBrandLogoUploading(false);
        e.target.value = "";
      }
    },
    [update]
  );

  const handleClearBrandLogo = useCallback(() => {
    update({ brandLogoPath: "" });
    setBrandLogoStatus("Logo removed.");
    setBrandLogoStatusType("ok");
  }, [update]);

  // ── Bible settings save ──
  const handleSaveBible = useCallback(async () => {
    bibleDispatch({ type: "SET_TRANSLATION", translation: bDefaultTranslation });
    bibleDispatch({
      type: "SET_SLIDE_CONFIG",
      config: { ...bibleState.slideConfig, showVerseNumbers: bShowVerseNumbers, maxLines: bMaxLines },
    });
    bibleDispatch({ type: "SET_COLOR_MODE", mode: bColorMode });
    bibleDispatch({ type: "SET_AUTO_SEND", enabled: bAutoSend });
    bibleDispatch({ type: "SET_REDUCE_MOTION", enabled: bReduceMotion });
    bibleDispatch({ type: "SET_HIGH_CONTRAST", enabled: bHighContrast });
    bibleSetTheme(bDefaultThemeId);

    await saveBibleSettings({
      defaultTranslation: bDefaultTranslation,
      activeThemeId: bDefaultThemeId,
      slideConfig: { ...bibleState.slideConfig, showVerseNumbers: bShowVerseNumbers, maxLines: bMaxLines },
      colorMode: bColorMode,
      autoSendOnDoubleClick: bAutoSend,
      reduceMotion: bReduceMotion,
      highContrast: bHighContrast,
    });

    setBibleSettingsDirty(false);
    setBSaved(true);
    setTimeout(() => setBSaved(false), 2000);
  }, [bDefaultTranslation, bDefaultThemeId, bShowVerseNumbers, bMaxLines, bColorMode, bAutoSend, bReduceMotion, bHighContrast, bibleDispatch, bibleSetTheme, bibleState.slideConfig]);

  const updateVoiceBibleDraft = useCallback((patch: Partial<VoiceBibleSettings>) => {
    setVoiceBibleSettings((current) => ({ ...current, ...patch }));
    setVoiceBibleDirty(true);
  }, []);

  const handleSaveVoiceBible = useCallback(async () => {
    try {
      const saved = await saveVoiceBibleSettings(voiceBibleSettings);
      setVoiceBibleSettings(saved);
      setVoiceBibleDirty(false);
      setVoiceStatusMessage("Voice Bible settings saved.");
      setVoiceStatusType("ok");
      await voiceBibleService.refreshAvailability();
      await refreshVoiceBibleDiagnostics();
    } catch (err) {
      setVoiceStatusMessage(err instanceof Error ? err.message : String(err));
      setVoiceStatusType("err");
    }
  }, [refreshVoiceBibleDiagnostics, voiceBibleSettings]);

  const handleRequestVoiceMic = useCallback(async () => {
    const requestedDeviceId =
      voiceBibleSettings.audioSourceMode === "system-mic"
        ? voiceBibleSettings.audioDeviceId
        : undefined;
    const nextPermission = await requestMicrophoneAccess(requestedDeviceId);
    setVoicePermission(nextPermission);
    if (nextPermission === "denied") {
      setVoiceStatusMessage("Microphone permission was denied.");
      setVoiceStatusType("err");
    } else {
      setVoiceStatusMessage("Microphone access confirmed.");
      setVoiceStatusType("ok");
    }
    await refreshVoiceBibleDiagnostics();
  }, [refreshVoiceBibleDiagnostics, voiceBibleSettings.audioDeviceId, voiceBibleSettings.audioSourceMode]);

  const handlePrepareVoiceModel = useCallback(async () => {
    setVoicePreparingModel(true);
    try {
      const runtime = await prepareVoiceBibleModel();
      setVoiceRuntime(runtime);
      setVoiceStatusMessage("Whisper large-v3 is ready.");
      setVoiceStatusType("ok");
      await voiceBibleService.refreshAvailability();
    } catch (err) {
      setVoiceStatusMessage(err instanceof Error ? err.message : String(err));
      setVoiceStatusType("err");
    } finally {
      setVoicePreparingModel(false);
      await refreshVoiceBibleDiagnostics();
    }
  }, [refreshVoiceBibleDiagnostics]);

  const overlayUrls = useMemo(
    () => ({
      bibleFullscreen: `${overlayBaseUrl}/bible-overlay-fullscreen.html`,
      bibleLowerThird: `${overlayBaseUrl}/bible-overlay-lower-third.html`,
      lowerThird: `${overlayBaseUrl}/lower-third-overlay.html`,
    }),
    [overlayBaseUrl]
  );

  const grouped = getShortcutsByCategory();

  return (
    <div className="mv-page mv-settings">
      <header className="mv-page-header">
        <div>
          <h1 className="mv-page-title">Settings</h1>
          <p className="mv-page-subtitle">
            {activeTab === "general"
              ? "Application preferences and configuration"
              : activeTab === "branding"
                ? "Church profile, identity, and service defaults"
                : "Bible module preferences"}
          </p>
        </div>
        {activeTab === "general" ? (
          <button
            className="mv-btn mv-btn--outline mv-btn--sm"
            onClick={handleResetSettings}
            title="Reset all general settings to defaults"
          >
            <Icon name="restart_alt" size={14} />
            Reset Defaults
          </button>
        ) : activeTab === "branding" ? (
          <button
            className="mv-btn mv-btn--outline mv-btn--sm"
            onClick={handleResetBrandingSettings}
            title="Reset branding settings to defaults"
          >
            <Icon name="restart_alt" size={14} />
            Reset Branding
          </button>
        ) : (
          <button
            className="mv-btn mv-btn--primary mv-btn--sm"
            onClick={handleSaveBible}
          >
            <Icon name="check" size={14} />
            {bSaved ? "Saved ✓" : "Save Bible Settings"}
          </button>
        )}
      </header>

      {/* ── Tab bar ── */}
      <div className="mv-settings-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "general"}
          className={`mv-settings-tab${activeTab === "general" ? " mv-settings-tab--active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          <Icon name="settings" size={16} />
          General
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "branding"}
          className={`mv-settings-tab${activeTab === "branding" ? " mv-settings-tab--active" : ""}`}
          onClick={() => setActiveTab("branding")}
        >
          <Icon name="branding_watermark" size={16} />
          Branding
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "bible"}
          className={`mv-settings-tab${activeTab === "bible" ? " mv-settings-tab--active" : ""}`}
          onClick={() => setActiveTab("bible")}
        >
          <Icon name="menu_book" size={16} />
          Bible
        </button>
      </div>

      {activeTab === "general" ? (
      <div className="mv-settings-sections">
        {/* ═══════════════════ OBS Connection ═══════════════════ */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="cast" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}OBS Connection
          </h2>
          <p className="mv-settings-desc">
            Connect to OBS Studio via the obs-websocket plugin (v5+).
          </p>

          <div className="mv-settings-form">
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">WebSocket URL</span>
              <input
                className="mv-input"
                type="text"
                placeholder="ws://localhost:4455"
                value={settings.obsUrl}
                onChange={(e) => update({ obsUrl: e.target.value })}
              />
            </label>
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">Password</span>
              <input
                className="mv-input"
                type="password"
                placeholder="(optional)"
                value={obsPasswordDraft}
                onChange={(e) => setObsPasswordDraft(e.target.value)}
              />
              <span className="mv-settings-hint">
                Stored in memory for this session only.
              </span>
            </label>
          </div>

          <div className="mv-settings-row" style={{ marginTop: 12 }}>
            {obsStatus === "connected" ? (
              <button className="mv-btn mv-btn--outline mv-btn--sm" onClick={handleDisconnect}>
                <Icon name="link_off" size={14} />
                Disconnect
              </button>
            ) : (
              <button
                className="mv-btn mv-btn--primary mv-btn--sm"
                onClick={handleTestObs}
                disabled={obsStatus === "connecting"}
              >
                <Icon name={obsStatus === "connecting" ? "hourglass_top" : "power"} size={14} />
                {obsStatus === "connecting" ? "Connecting…" : "Test Connection"}
              </button>
            )}
            <span
              className={`mv-obs-status-dot ${obsStatus === "connected" ? "mv-obs-status-dot--on" : ""}`}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {obsStatus === "connected" ? "Connected" : obsStatus === "connecting" ? "Connecting…" : "Disconnected"}
            </span>
          </div>

          {obsTestResult && (
            <p
              className={`mv-settings-test-result ${
                obsTestResult.startsWith("✓") ? "mv-settings-test-result--ok" : "mv-settings-test-result--err"
              }`}
            >
              {obsTestResult}
            </p>
          )}

          <div className="mv-overlay-health">
            <div className="mv-overlay-health-header">
              <h3 className="mv-overlay-health-title">
                <Icon name="monitor_heart" size={16} />
                Overlay Server Health
              </h3>
              <button className="mv-btn mv-btn--outline mv-btn--sm" onClick={() => void checkOverlayHealth()}>
                <Icon name="refresh" size={14} />
                Refresh
              </button>
            </div>

            <div className="mv-overlay-health-status">
              <span
                className={`mv-obs-status-dot ${
                  overlayHealth === "healthy"
                    ? "mv-obs-status-dot--on"
                    : overlayHealth === "checking"
                      ? "mv-overlay-health-dot--checking"
                      : ""
                }`}
              />
              <span className={`mv-overlay-health-state${overlayHealth === "unreachable" ? " mv-overlay-health-state--err" : ""}`}>
                {overlayHealth === "healthy" ? "Healthy" : overlayHealth === "checking" ? "Checking…" : "Unreachable"}
              </span>
            </div>

            <label className="mv-overlay-health-url-row">
              <span className="mv-overlay-health-url-label">Bible Fullscreen URL</span>
              <input className="mv-input mv-overlay-health-url" type="text" value={overlayUrls.bibleFullscreen} readOnly />
            </label>
            <label className="mv-overlay-health-url-row">
              <span className="mv-overlay-health-url-label">Bible Lower Third URL</span>
              <input className="mv-input mv-overlay-health-url" type="text" value={overlayUrls.bibleLowerThird} readOnly />
            </label>
            <label className="mv-overlay-health-url-row">
              <span className="mv-overlay-health-url-label">Lower Third URL</span>
              <input className="mv-input mv-overlay-health-url" type="text" value={overlayUrls.lowerThird} readOnly />
            </label>

            <p className="mv-settings-hint" style={{ marginTop: 10 }}>
              These are the exact URLs currently used when creating or updating OBS Browser Sources.
            </p>

            {overlayHealthError && overlayHealth === "unreachable" && (
              <p className="mv-settings-test-result mv-settings-test-result--err" style={{ marginTop: 8 }}>
                Overlay check failed: {overlayHealthError}
              </p>
            )}
          </div>

          <div className="mv-settings-toggles" style={{ marginTop: 12 }}>
            <Toggle
              checked={settings.obsAutoReconnect}
              onChange={(v) => update({ obsAutoReconnect: v })}
              label="Auto-reconnect"
              description="Automatically reconnect to OBS if the connection drops"
            />
            <Toggle
              checked={settings.obsConnectOnStartup}
              onChange={(v) => update({ obsConnectOnStartup: v })}
              label="Connect on startup"
              description="Attempt to connect to OBS when the app opens"
            />
          </div>
        </section>

        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="podcasts" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Streaming Platform
          </h2>
          <p className="mv-settings-desc">
            Choose where you stream so DeckPilot can give the right bitrate and network advice.
          </p>
          <p className="mv-settings-hint">
            Platform choice changes bitrate recommendations, upload headroom checks, and Stream Check results.
          </p>

          <div className="mv-stream-platform-grid" role="radiogroup" aria-label="Streaming platform">
            {STREAMING_PLATFORM_OPTIONS.map((option) => {
              const selected = settings.streamingPlatform === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`mv-stream-platform-card${selected ? " mv-stream-platform-card--active" : ""}`}
                  onClick={() => update({ streamingPlatform: option.value })}
                >
                  <div className="mv-stream-platform-card-head">
                    <span className="mv-stream-platform-card-title">{option.label}</span>
                    {selected && <Icon name="check_circle" size={16} />}
                  </div>
                  <p className="mv-stream-platform-card-helper">{option.helper}</p>
                  <p className="mv-stream-platform-card-body">
                    {option.value === "youtube"
                      ? "Useful when your stream is tuned for YouTube Live bitrate guidance."
                      : option.value === "twitch"
                        ? "Uses safer upload headroom before warning that bitrate is too high."
                        : "Best when you stream to church CDN, RTMP, or another custom destination."}
                  </p>
                </button>
              );
            })}
          </div>

          <p className="mv-settings-hint" style={{ marginTop: 10 }}>
            Current selection: <strong>{getStreamingPlatformLabel(settings.streamingPlatform)}</strong>
          </p>
        </section>

        {/* ═══════════════════ Default Canvas ═══════════════════ */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="aspect_ratio" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Default Canvas Size
          </h2>
          <p className="mv-settings-desc">
            New layouts will start with this resolution.
          </p>
          <div className="mv-settings-row">
            {CANVAS_PRESETS.map((p, i) => (
              <button
                key={p.label}
                className={`mv-btn mv-btn--outline ${
                  settings.defaultCanvasPreset === i ? "mv-btn--active" : ""
                }`}
                onClick={() => update({ defaultCanvasPreset: i })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mv-settings-hint">
            {CANVAS_PRESETS[settings.defaultCanvasPreset]?.width ?? 1920} ×{" "}
            {CANVAS_PRESETS[settings.defaultCanvasPreset]?.height ?? 1080} pixels
          </p>
        </section>

        {/* ═══════════════════ Editor Defaults ═══════════════════ */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="tune" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Editor Defaults
          </h2>
          <p className="mv-settings-desc">
            These settings apply when opening a new editor session.
          </p>
          <div className="mv-settings-toggles">
            <Toggle
              checked={settings.showGrid}
              onChange={(v) => update({ showGrid: v })}
              label="Show grid"
              description="Display the alignment grid on the canvas"
            />
            <Toggle
              checked={settings.snapToGrid}
              onChange={(v) => update({ snapToGrid: v })}
              label="Snap to grid"
              description="Regions snap to grid lines when moving"
            />
            <Toggle
              checked={settings.showSafeMargins}
              onChange={(v) => update({ showSafeMargins: v })}
              label="Show safe margins"
              description="Display broadcast-safe area guides"
            />
            <Toggle
              checked={settings.showLabels}
              onChange={(v) => update({ showLabels: v })}
              label="Show region labels"
              description="Display name labels on canvas regions"
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <NumberSetting
              label="Grid size"
              value={settings.gridSize}
              onChange={(v) => update({ gridSize: Math.max(4, Math.min(100, v)) })}
              min={4}
              max={100}
              step={4}
              suffix="px"
            />
          </div>
        </section>

        {/* ═══════════════════ Auto-Save ═══════════════════ */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="save" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Auto-Save
          </h2>
          <p className="mv-settings-desc">
            Automatically save your work at a regular interval.
          </p>
          <div className="mv-settings-toggles">
            <Toggle
              checked={settings.autoSaveEnabled}
              onChange={(v) => update({ autoSaveEnabled: v })}
              label="Enable auto-save"
              description="Periodically save open layout to the local database"
            />
          </div>
          {settings.autoSaveEnabled && (
            <div style={{ marginTop: 12 }}>
              <NumberSetting
                label="Interval"
                value={settings.autoSaveIntervalSec}
                onChange={(v) =>
                  update({ autoSaveIntervalSec: Math.max(10, Math.min(600, v)) })
                }
                min={10}
                max={600}
                step={10}
                suffix="seconds"
              />
            </div>
          )}
        </section>

        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="shield" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Broadcast Safety
          </h2>
          <p className="mv-settings-desc">
            Controls confirmation prompts for actions that can immediately affect live output.
          </p>
          <div className="mv-settings-toggles">
            <Toggle
              checked={settings.confirmBeforeProgramSend}
              onChange={(v) => update({ confirmBeforeProgramSend: v })}
              label="Confirm before Send to Program"
              description="Show a confirmation modal before pushing overlays directly to OBS Program"
            />
          </div>
        </section>

        {/* ═══════════════════ Appearance ═══════════════════ */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="palette" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Appearance
          </h2>
          <p className="mv-settings-desc">
            Customize the editor workspace look and feel.
          </p>

          {/* Theme selector */}
          <div className="mv-settings-field" style={{ maxWidth: 340 }}>
            <span className="mv-settings-field-label">Theme</span>
            <div className="mv-theme-toggle-group" role="radiogroup" aria-label="Theme preference">
              {(["dark", "light", "system"] as const).map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={settings.theme === t}
                  className={`mv-theme-toggle-btn${settings.theme === t ? " mv-theme-toggle-btn--active" : ""}`}
                  onClick={() => update({ theme: t })}
                >
                  <Icon name={t === "dark" ? "dark_mode" : t === "light" ? "light_mode" : "settings_brightness"} size={16} />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>


          {/* High contrast */}
          <div className="mv-settings-toggles" style={{ marginTop: 8 }}>
            <Toggle
              checked={settings.highContrast}
              onChange={(v) => update({ highContrast: v })}
              label="High contrast mode"
              description="Increase text & border contrast for better readability"
            />
          </div>

          <label className="mv-settings-field" style={{ maxWidth: 260 }}>
            <span className="mv-settings-field-label">Workspace background</span>
            <div className="mv-settings-color-row">
              <input
                type="color"
                className="mv-settings-color-input"
                value={settings.canvasBackground}
                onChange={(e) => update({ canvasBackground: e.target.value })}
              />
              <input
                type="text"
                className="mv-input mv-input--sm"
                value={settings.canvasBackground}
                onChange={(e) => update({ canvasBackground: e.target.value })}
                style={{ flex: 1, fontFamily: "monospace" }}
              />
            </div>
          </label>
          <div className="mv-settings-toggles" style={{ marginTop: 12 }}>
            <Toggle
              checked={settings.animateTransitions}
              onChange={(v) => update({ animateTransitions: v })}
              label="Animate transitions"
              description="Smooth animations for UI interactions"
            />
            <Toggle
              checked={settings.showToastNotifications}
              onChange={(v) => update({ showToastNotifications: v })}
              label="Show notifications"
              description="Display toast messages for save, sync, and errors"
            />
          </div>
        </section>

        {/* ═══════════════════ Keyboard Shortcuts ═══════════════════ */}
        <section className="mv-settings-section">
          <h2
            className="mv-settings-heading mv-settings-heading--clickable"
            onClick={() => setShortcutsOpen((o) => !o)}
          >
            <Icon name="keyboard" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Keyboard Shortcuts
            <Icon name="expand_more" size={18} className="mv-settings-chevron" style={{ marginLeft: "auto", transition: "transform .2s", transform: shortcutsOpen ? "rotate(180deg)" : undefined }} />
          </h2>
          <p className="mv-settings-desc">
            {SHORTCUTS.length} shortcuts across {Object.keys(CATEGORY_LABELS).length} categories — Bible, Worship, Lower Thirds, Quick Merge, and more.{" "}
            {!shortcutsOpen && (
              <button className="mv-link" onClick={() => setShortcutsOpen(true)}>
                Show all
              </button>
            )}
          </p>

          {shortcutsOpen && (() => {
            const q = shortcutSearch.toLowerCase().trim();
            const filtered = q
              ? (Array.from(grouped.entries()) as [ShortcutCategory, typeof SHORTCUTS[number][]][])
                  .map(([cat, items]) => [cat, items.filter(
                    (s) => s.label.toLowerCase().includes(q)
                      || CATEGORY_LABELS[cat].toLowerCase().includes(q)
                      || shortcutLabel(s.keys).toLowerCase().includes(q)
                      || (s.description ?? "").toLowerCase().includes(q)
                  )] as [ShortcutCategory, typeof SHORTCUTS[number][]])
                  .filter(([, items]) => items.length > 0)
              : (Array.from(grouped.entries()) as [ShortcutCategory, typeof SHORTCUTS[number][]][]);
            const matchCount = filtered.reduce((n, [, items]) => n + items.length, 0);

            return (
              <>
                <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="mv-inline-search">
                  <input
                    className="mv-input"
                    type="text"
                    placeholder="Search shortcuts… e.g. Bible, Undo, ⌘Z"
                    value={shortcutSearch}
                    onChange={(e) => setShortcutSearch(e.target.value)}
                    aria-label="Search keyboard shortcuts"
                    style={{ maxWidth: 340, paddingRight: 32 }}
                  />
                  {shortcutSearch && (
                    <button
                      type="button"
                      className="mv-inline-search-clear"
                      onClick={() => setShortcutSearch("")}
                      aria-label="Clear shortcut search"
                      title="Clear shortcut search"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                  </div>
                  {q && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {matchCount} {matchCount === 1 ? "match" : "matches"}
                    </span>
                  )}
                </div>
                <div className="mv-shortcuts-grid">
                  {filtered.map(([cat, items]) => (
                    <div key={cat} className="mv-shortcuts-group">
                      <h3 className="mv-shortcuts-cat">{CATEGORY_LABELS[cat]}</h3>
                      {items.map((s) => (
                        <div key={s.id} className="mv-shortcuts-item" title={s.description}>
                          <span className="mv-shortcuts-label">{s.label}</span>
                          <kbd className="mv-shortcuts-keys">{shortcutLabel(s.keys)}</kbd>
                        </div>
                      ))}
                    </div>
                  ))}
                  {q && matchCount === 0 && (
                    <p style={{ color: "var(--text-muted)", fontSize: 13, gridColumn: "1 / -1" }}>
                      No shortcuts match "{shortcutSearch}".
                    </p>
                  )}
                </div>
              </>
            );
          })()}
        </section>

        {/* ═══════════════════ About ═══════════════════ */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="info" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}About
          </h2>
          <div className="mv-settings-about">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <AppLogo alt="OBS Church Studio" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain" }} />
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>OBS Church Studio</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Version {__APP_VERSION__}</p>
              </div>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>
              Complete Church Production Control for OBS — a smart layer built on top of OBS Studio
              for church broadcast teams. Multi-view layouts, Bible verse overlays, scene management,
              and one-click production workflows.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Built with Tauri v2 + React 19 + TypeScript
            </p>
            <div className="mv-settings-row" style={{ marginTop: 12 }}>
              <a
                className="mv-btn mv-btn--outline mv-btn--sm"
                href="https://github.com/jolamyfoodsng/obs-multiview"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="code" size={14} />
                GitHub
              </a>
            </div>
          </div>
        </section>

        {/* ═══════════════════ Danger Zone ═══════════════════ */}
        <section className="mv-settings-section mv-settings-section--danger">
          <h2 className="mv-settings-heading">
            <Icon name="warning" size={18} style={{ verticalAlign: "text-bottom", color: "var(--error, #e74856)" }} />
            {" "}Danger Zone
          </h2>
          <p className="mv-settings-desc">
            Clear all saved layouts, templates, and assets from the local database.
            This cannot be undone.
          </p>
          {cleared ? (
            <p className="mv-settings-success">
              <Icon name="check_circle" size={16} style={{ verticalAlign: "middle" }} />{" "}
              Database cleared. Templates will be re-seeded on next visit.
            </p>
          ) : confirmClear ? (
            <div className="mv-settings-row">
              <span style={{ color: "var(--error)" }}>Are you sure?</span>
              <button className="mv-btn mv-btn--danger" onClick={handleClear}>
                Yes, Clear Everything
              </button>
              <button
                className="mv-btn mv-btn--outline"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="mv-btn mv-btn--danger"
              onClick={() => setConfirmClear(true)}
            >
              <Icon name="delete_forever" size={16} />
              Clear All Data
            </button>
          )}
        </section>
      </div>
      ) : activeTab === "branding" ? (
      /* ═══════════════════════════════════════════════════════════
         BRANDING TAB
         ═══════════════════════════════════════════════════════════ */
      <div className="mv-settings-sections">
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="church" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Church Profile
          </h2>
          <p className="mv-settings-desc">
            Identity values used across Speaker and Lower Third templates.
          </p>
          <div className="mv-settings-form">
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">Church Name</span>
              <input
                className="mv-input"
                type="text"
                placeholder="Your Church Name"
                value={settings.churchName}
                onChange={(e) => update({ churchName: e.target.value })}
              />
            </label>
            <div className="mv-settings-field">
              <span className="mv-settings-field-label">Pastors / Speakers</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.1fr 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontWeight: 600,
                    letterSpacing: ".02em",
                    textTransform: "uppercase",
                  }}
                >
                  <span>Name</span>
                  <span>Position</span>
                  <span />
                </div>
                {speakerProfiles.map((profile, index) => (
                  <div
                    key={`speaker-profile-${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.1fr 1fr auto",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      className="mv-input"
                      type="text"
                      placeholder="Full Name"
                      value={profile.name}
                      onChange={(e) => handleSpeakerProfileNameChange(index, e.target.value)}
                    />
                    <input
                      className="mv-input"
                      type="text"
                      placeholder="Position"
                      list="mv-speaker-position-options"
                      value={profile.role}
                      onChange={(e) => handleSpeakerProfileRoleChange(index, e.target.value)}
                    />
                    <button
                      type="button"
                      className="mv-btn mv-btn--outline mv-btn--sm"
                      onClick={() => handleRemoveSpeakerProfileRow(index)}
                      title="Remove speaker row"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="mv-btn mv-btn--outline mv-btn--sm"
                    onClick={handleAddSpeakerProfileRow}
                  >
                    <Icon name="add" size={14} />
                    Add Speaker
                  </button>
                </div>
              </div>
              <datalist id="mv-speaker-position-options">
                {SPEAKER_POSITION_SUGGESTIONS.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </div>
          </div>
        </section>

        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="palette" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Brand Defaults
          </h2>
          <p className="mv-settings-desc">
            Defaults for lower-third and speaker overlays only (OBS output), not app page styling.
          </p>
          <p className="mv-settings-hint">
            Saved brand color is used for compatible lower-third backgrounds and accents. It does not recolor this app UI.
          </p>

          <div style={{ marginTop: 8, maxWidth: 300 }}>
            <NumberSetting
              label="Default lower-third duration"
              value={settings.lowerThirdDefaultDurationSec}
              onChange={(v) => update({ lowerThirdDefaultDurationSec: Math.max(1, Math.min(300, Math.floor(v || 10))) })}
              min={1}
              max={300}
              step={1}
              suffix="sec"
            />
          </div>

          <label className="mv-settings-field" style={{ maxWidth: 300, marginTop: 12 }}>
            <span className="mv-settings-field-label">Brand Color</span>
            <div className="mv-settings-color-row">
              <input
                type="color"
                className="mv-settings-color-input"
                value={settings.brandColor}
                onChange={(e) => update({ brandColor: e.target.value })}
              />
              <input
                type="text"
                className="mv-input mv-input--sm"
                value={settings.brandColor}
                onChange={(e) => update({ brandColor: e.target.value })}
                style={{ flex: 1, fontFamily: "monospace" }}
              />
            </div>
          </label>
        </section>

        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="image" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Logo Upload
          </h2>
          <p className="mv-settings-desc">
            Upload your ministry logo once and reuse it as default branding.
          </p>
          <p className="mv-settings-hint">
            After upload, logo fields in logo-based Lower Third and Speaker themes are populated automatically.
          </p>

          <label className="mv-settings-field" style={{ maxWidth: 360 }}>
            <span className="mv-settings-field-label">Logo File (PNG, JPG, WEBP, GIF, SVG)</span>
            <input
              className="mv-input"
              type="file"
              accept={BRAND_LOGO_UPLOAD_ACCEPT}
              onChange={(e) => void handleBrandLogoUpload(e)}
              disabled={brandLogoUploading}
            />
          </label>

          {brandLogoPreviewSrc ? (
            <div className="mv-settings-logo-preview-wrap">
              <img className="mv-settings-logo-preview" src={brandLogoPreviewSrc} alt="Church logo preview" />
            </div>
          ) : (
            <p className="mv-settings-hint">No logo uploaded yet.</p>
          )}

          {!!settings.brandLogoPath.trim() && (
            <>
              <p className="mv-settings-hint" style={{ marginTop: 8 }}>
                Saved path: {settings.brandLogoPath}
              </p>
              <button
                type="button"
                className="mv-btn mv-btn--outline mv-btn--sm"
                style={{ marginTop: 8 }}
                onClick={handleClearBrandLogo}
              >
                <Icon name="delete" size={14} />
                Remove Logo
              </button>
            </>
          )}

          {brandLogoStatus && (
            <p
              className={`mv-settings-test-result ${
                brandLogoStatusType === "ok" ? "mv-settings-test-result--ok" : "mv-settings-test-result--err"
              }`}
              style={{ marginTop: 10 }}
            >
              {brandLogoStatus}
            </p>
          )}
        </section>

        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="alternate_email" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Social Media Handles
          </h2>
          <p className="mv-settings-desc">
            These handles are stored as quick defaults for social and announcement templates.
          </p>
          <div
            className="mv-settings-form"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}
          >
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">Website</span>
              <input
                className="mv-input"
                type="text"
                placeholder="https://yourchurch.org"
                value={settings.socialWebsite}
                onChange={(e) => update({ socialWebsite: e.target.value })}
              />
            </label>
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">Instagram</span>
              <input
                className="mv-input"
                type="text"
                placeholder="@yourchurch"
                value={settings.socialInstagram}
                onChange={(e) => update({ socialInstagram: e.target.value })}
              />
            </label>
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">Facebook</span>
              <input
                className="mv-input"
                type="text"
                placeholder="@yourchurch"
                value={settings.socialFacebook}
                onChange={(e) => update({ socialFacebook: e.target.value })}
              />
            </label>
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">YouTube</span>
              <input
                className="mv-input"
                type="text"
                placeholder="@yourchurchlive"
                value={settings.socialYouTube}
                onChange={(e) => update({ socialYouTube: e.target.value })}
              />
            </label>
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">X (Twitter)</span>
              <input
                className="mv-input"
                type="text"
                placeholder="@yourchurch"
                value={settings.socialX}
                onChange={(e) => update({ socialX: e.target.value })}
              />
            </label>
            <label className="mv-settings-field">
              <span className="mv-settings-field-label">TikTok</span>
              <input
                className="mv-input"
                type="text"
                placeholder="@yourchurch"
                value={settings.socialTikTok}
                onChange={(e) => update({ socialTikTok: e.target.value })}
              />
            </label>
          </div>
        </section>
      </div>
      ) : (
      /* ═══════════════════════════════════════════════════════════
         BIBLE TAB
         ═══════════════════════════════════════════════════════════ */
      <div className="mv-settings-sections">
        {/* ── 1. Appearance / Colour Mode ── */}


        {/* ── 2. Default Translation ── */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="translate" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Default Translation
          </h2>
          <p className="mv-settings-desc">
            Sets the default Bible translation used when the app starts.
          </p>
          <p className="mv-settings-hint">
            This stays synced with the Bible page translation. Click Save Bible Settings to apply updates.{" "}
            <Link className="mv-link" to="/resources?tab=bible">
              Download or import more translations →
            </Link>
          </p>
          <label className="mv-settings-field" style={{ maxWidth: 400 }}>
            <span className="mv-settings-field-label">Translation</span>
            <select
              className="mv-input"
              value={bDefaultTranslation}
              onChange={(e) => {
                setBDefaultTranslation(e.target.value as BibleTranslation);
                setBibleSettingsDirty(true);
              }}
            >
              {bTranslations.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="mic" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Voice Bible
          </h2>
          <p className="mv-settings-desc">
            Configure local speech-to-verse lookup for the OBS dock mic button.
          </p>
          <p className="mv-settings-hint">
            Supported commands include: “John 1 verse 2”, “next verse”, “previous verse”, “go to chapter 4”, “last chapter”, and “use NIV”.
          </p>

          <div className="mv-settings-form">
            <label className="mv-settings-field" style={{ maxWidth: 280 }}>
              <span className="mv-settings-field-label">Audio Source</span>
              <select
                className="mv-input"
                value={voiceBibleSettings.audioSourceMode}
                onChange={(e) =>
                  updateVoiceBibleDraft({
                    audioSourceMode: e.target.value as VoiceBibleSettings["audioSourceMode"],
                  })
                }
              >
                <option value="system-mic">System microphone</option>
                <option value="obs-input">OBS input source</option>
              </select>
            </label>

            {voiceBibleSettings.audioSourceMode === "system-mic" ? (
              <label className="mv-settings-field" style={{ maxWidth: 360 }}>
                <span className="mv-settings-field-label">Microphone Device</span>
                <select
                  className="mv-input"
                  value={voiceBibleSettings.audioDeviceId ?? ""}
                  onChange={(e) =>
                    updateVoiceBibleDraft({ audioDeviceId: e.target.value || undefined })
                  }
                >
                  <option value="">Default system microphone</option>
                  {voiceDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="mv-settings-field" style={{ maxWidth: 360 }}>
                <span className="mv-settings-field-label">OBS Input Source</span>
                <select
                  className="mv-input"
                  value={voiceBibleSettings.obsInputName ?? ""}
                  onChange={(e) => {
                    const nextInputName = e.target.value || undefined;
                    const mappedInput = voiceObsInputs.find((input) => input.inputName === nextInputName);
                    updateVoiceBibleDraft({
                      obsInputName: nextInputName,
                      audioDeviceId: mappedInput?.deviceId,
                    });
                  }}
                  disabled={!obsService.isConnected}
                >
                  <option value="">
                    {obsService.isConnected ? "Select an OBS audio input" : "Connect OBS to inspect inputs"}
                  </option>
                  {voiceObsInputs.map((input) => (
                    <option key={input.inputName} value={input.inputName}>
                      {input.label}{input.deviceId ? "" : " (unmapped)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="mv-settings-form" style={{ marginTop: 12 }}>
            <label className="mv-settings-field" style={{ maxWidth: 240 }}>
              <span className="mv-settings-field-label">Semantic Matching</span>
              <select
                className="mv-input"
                value={voiceBibleSettings.semanticMode}
                onChange={(e) =>
                  updateVoiceBibleDraft({
                    semanticMode: e.target.value as VoiceBibleSettings["semanticMode"],
                  })
                }
              >
                <option value="ollama">Ollama rerank</option>
                <option value="lexical-only">Lexical only</option>
              </select>
            </label>

            {voiceBibleSettings.semanticMode === "ollama" && (
              <>
                <label className="mv-settings-field" style={{ maxWidth: 300 }}>
                  <span className="mv-settings-field-label">Ollama Base URL</span>
                  <input
                    className="mv-input"
                    type="text"
                    value={voiceBibleSettings.ollamaBaseUrl ?? ""}
                    onChange={(e) => updateVoiceBibleDraft({ ollamaBaseUrl: e.target.value })}
                    placeholder="http://127.0.0.1:11434"
                  />
                </label>
                <label className="mv-settings-field" style={{ maxWidth: 300 }}>
                  <span className="mv-settings-field-label">Embedding Model</span>
                  <input
                    className="mv-input"
                    type="text"
                    value={voiceBibleSettings.ollamaModel ?? ""}
                    onChange={(e) => updateVoiceBibleDraft({ ollamaModel: e.target.value })}
                    placeholder="qwen3-embedding:4b"
                  />
                </label>
                <label className="mv-settings-field" style={{ maxWidth: 300 }}>
                  <span className="mv-settings-field-label">Normalizer Model</span>
                  <input
                    className="mv-input"
                    type="text"
                    value={voiceBibleSettings.ollamaNormalizerModel ?? ""}
                    onChange={(e) =>
                      updateVoiceBibleDraft({ ollamaNormalizerModel: e.target.value })
                    }
                    placeholder="qwen2.5:3b"
                  />
                </label>
              </>
            )}
          </div>

          <div className="mv-settings-row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <button className="mv-btn mv-btn--outline mv-btn--sm" onClick={() => void handleRequestVoiceMic()}>
              <Icon name="mic" size={14} />
              Request Mic Access
            </button>
            <button
              className="mv-btn mv-btn--outline mv-btn--sm"
              onClick={() => void refreshVoiceBibleDiagnostics()}
            >
              <Icon name="refresh" size={14} />
              Refresh Sources
            </button>
            <button
              className="mv-btn mv-btn--outline mv-btn--sm"
              onClick={() => void handlePrepareVoiceModel()}
              disabled={voicePreparingModel}
            >
              <Icon name={voicePreparingModel ? "hourglass_top" : "download"} size={14} />
              {voicePreparingModel ? "Downloading Whisper…" : voiceRuntime.modelReady ? "Re-check Whisper" : "Download Whisper"}
            </button>
            <button
              className="mv-btn mv-btn--primary mv-btn--sm"
              onClick={() => void handleSaveVoiceBible()}
              disabled={!voiceBibleDirty}
            >
              <Icon name="save" size={14} />
              Save Voice Bible
            </button>
          </div>

          <div className="mv-settings-form" style={{ marginTop: 12 }}>
            <div className="mv-settings-field" style={{ maxWidth: 360 }}>
              <span className="mv-settings-field-label">Whisper Runtime</span>
              <div className="mv-settings-hint">
                {voiceRuntime.modelReady
                  ? "large-v3 is downloaded locally and ready."
                  : "large-v3 will be downloaded to Documents/OBSChurchStudio/voice-bible on first use."}
              </div>
            </div>
            <div className="mv-settings-field" style={{ maxWidth: 360 }}>
              <span className="mv-settings-field-label">Ollama Rerank</span>
              <div className="mv-settings-hint">
                {voiceBibleSettings.semanticMode === "ollama"
                  ? voiceSemanticReady
                    ? "Configured Ollama embedding model is reachable."
                    : "Configured Ollama model is not ready; lexical matching will be used."
                  : "Lexical-only mode is active."}
              </div>
            </div>
            <div className="mv-settings-field" style={{ maxWidth: 360 }}>
              <span className="mv-settings-field-label">Ollama Normalizer</span>
              <div className="mv-settings-hint">
                {voiceBibleSettings.semanticMode !== "ollama"
                  ? "Disabled while lexical-only mode is active."
                  : voiceBibleSettings.ollamaNormalizerModel?.trim()
                    ? "Uses the configured chat model to rewrite noisy speech like “John 3-1 go to verse 5” into a clean reference."
                    : "Optional. Add a chat/instruct Ollama model to rewrite malformed spoken references before matching."}
              </div>
            </div>
          </div>

          <p className="mv-settings-hint" style={{ marginTop: 10 }}>
            Microphone permission: <strong>{voicePermission}</strong>
            {voiceBibleSettings.audioSourceMode === "obs-input" && !obsService.isConnected ? " — connect OBS to inspect audio input mappings." : ""}
          </p>

          {voiceStatusMessage && (
            <p
              className={`mv-settings-test-result ${
                voiceStatusType === "ok" ? "mv-settings-test-result--ok" : "mv-settings-test-result--err"
              }`}
              style={{ marginTop: 8 }}
            >
              {voiceStatusMessage}
            </p>
          )}
        </section>

        {/* ── 3. Default Theme ── */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="brush" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Default Theme
          </h2>
          <p className="mv-settings-desc">
            Choose the theme that will be active when the app launches.
          </p>
          <label className="mv-settings-field" style={{ maxWidth: 400 }}>
            <span className="mv-settings-field-label">Active Theme</span>
            <select
              className="mv-input"
              value={bDefaultThemeId}
              onChange={(e) => setBDefaultThemeId(e.target.value)}
            >
              {bibleState.themes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.hidden ? " (hidden)" : ""}</option>
              ))}
            </select>
          </label>
        </section>

        {/* ── 4. Slide Settings ── */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="view_carousel" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Slide Settings
          </h2>
          <p className="mv-settings-desc">
            Configure how Bible verses are displayed on slides.
          </p>
          <div style={{ marginBottom: 12 }}>
            <NumberSetting
              label="Max lines per slide"
              value={bMaxLines}
              onChange={(v) => setBMaxLines(Math.max(1, Math.min(10, v)))}
              min={1}
              max={10}
              step={1}
              suffix="lines"
            />
          </div>
          <div className="mv-settings-toggles">
            <Toggle
              checked={bShowVerseNumbers}
              onChange={(v) => setBShowVerseNumbers(v)}
              label="Show verse numbers inline"
              description="Display verse numbers within the slide text"
            />
          </div>
        </section>

        {/* ── 5. Behaviour ── */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="tune" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Behaviour
          </h2>
          <div className="mv-settings-toggles">
            <Toggle
              checked={bAutoSend}
              onChange={(v) => setBAutoSend(v)}
              label="Auto-send verse on double-click"
              description="When enabled, double-clicking a verse immediately sends it to OBS"
            />
          </div>
        </section>

        {/* ── 6. Accessibility ── */}
        <section className="mv-settings-section">
          <h2 className="mv-settings-heading">
            <Icon name="accessibility_new" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Accessibility
          </h2>
          <p className="mv-settings-desc">
            Fine-tune the Bible interface for comfort and readability.
          </p>
          <div className="mv-settings-toggles">
            <Toggle
              checked={bReduceMotion}
              onChange={(v) => setBReduceMotion(v)}
              label="Reduce motion & animations"
              description="Disables all CSS transitions and animations in the Bible interface"
            />
            <Toggle
              checked={bHighContrast}
              onChange={(v) => setBHighContrast(v)}
              label="High-contrast mode"
              description="Increases contrast of borders, text, and controls for better readability"
            />
          </div>
        </section>

        {/* ── 7. Bible Keyboard Shortcuts ── */}
        <section className="mv-settings-section" style={{ borderBottom: "none" }}>
          <h2 className="mv-settings-heading">
            <Icon name="keyboard" size={18} style={{ verticalAlign: "text-bottom" }} />
            {" "}Bible Shortcuts
          </h2>
          <p className="mv-settings-desc">
            Quick reference for Bible interface shortcuts.{" "}
            <button className="mv-link" onClick={() => { setActiveTab("general"); setShortcutsOpen(true); setShortcutSearch("Bible"); }}>
              See all shortcuts →
            </button>
          </p>
          <div className="mv-shortcuts-grid">
            {(Array.from(grouped.entries()) as [ShortcutCategory, typeof SHORTCUTS[number][]][])
              .filter(([cat]) => cat === "bible")
              .map(([cat, items]) => (
                <div key={cat} className="mv-shortcuts-group">
                  {items.map((s) => (
                    <div key={s.id} className="mv-shortcuts-item" title={s.description}>
                      <span className="mv-shortcuts-label">{s.label}</span>
                      <kbd className="mv-shortcuts-keys">{shortcutLabel(s.keys)}</kbd>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </section>
      </div>
      )}
    </div>
  );
}
