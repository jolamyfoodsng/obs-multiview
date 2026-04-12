import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOverlayBaseUrl, getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { dockClient } from "../../services/dockBridge";
import { dockObsClient } from "../dockObsClient";
import type { DockStagedItem } from "../dockTypes";

const LEGACY_PANEL_PATH = "/animated-lower-thirds/lower-thirds/control-panel.html";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

type SpeakerProfile = {
  name: string;
  role: string;
};

type AnimatedLtBranding = {
  brandColor: string;
  brandSecondaryColor: string;
  churchName: string;
  mainPastorName: string;
  logoUrl: string;
};

function buildLegacyStageItem(live: boolean): DockStagedItem {
  return {
    type: "animated-lt",
    label: "Animated Lower Thirds",
    subtitle: live ? "Legacy control panel loaded in Program" : "Legacy control panel loaded in Preview",
    data: {
      source: "animated-lower-thirds-legacy",
      _dockLive: live,
    },
  };
}

function normalizeSpeakerProfile(value: unknown): SpeakerProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Record<string, unknown>>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const roleCandidates = [raw.role, raw.position, raw.info, raw.title];
  const role = roleCandidates.find((candidate): candidate is string => typeof candidate === "string")?.trim() ?? "";
  if (!name) return null;
  return { name, role };
}

function uniqueSpeakers(speakers: SpeakerProfile[]): SpeakerProfile[] {
  const seen = new Set<string>();
  const result: SpeakerProfile[] = [];
  for (const speaker of speakers) {
    const key = speaker.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(speaker);
  }
  return result;
}

function loadSpeakersFromLocalSettings(): SpeakerProfile[] {
  try {
    const raw = localStorage.getItem("mv-settings");
    if (!raw) return [];
    const settings = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const speakers = Array.isArray(settings.pastorSpeakers)
      ? settings.pastorSpeakers.map(normalizeSpeakerProfile).filter((speaker): speaker is SpeakerProfile => Boolean(speaker))
      : [];
    if (speakers.length > 0) return uniqueSpeakers(speakers);

    const mainPastorName = typeof settings.mainPastorName === "string" ? settings.mainPastorName.trim() : "";
    if (mainPastorName) return [{ name: mainPastorName, role: "Lead Pastor" }];

    const pastorNames = typeof settings.pastorNames === "string" ? settings.pastorNames : "";
    return uniqueSpeakers(
      pastorNames
        .split(/\r?\n|,/)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, role: "" })),
    );
  } catch {
    return [];
  }
}

async function loadSpeakersFromServer(baseUrl: string): Promise<SpeakerProfile[]> {
  try {
    const res = await fetch(`${baseUrl}/uploads/dock-speakers.json`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return uniqueSpeakers(
      data
        .map(normalizeSpeakerProfile)
        .filter((speaker): speaker is SpeakerProfile => Boolean(speaker)),
    );
  } catch {
    return [];
  }
}

async function loadBranding(baseUrl: string): Promise<AnimatedLtBranding> {
  const branding: AnimatedLtBranding = {
    brandColor: "#2563eb",
    brandSecondaryColor: "",
    churchName: "",
    mainPastorName: "",
    logoUrl: "",
  };

  try {
    const raw = localStorage.getItem("mv-settings");
    if (raw) {
      const settings = JSON.parse(raw) as Partial<Record<string, unknown>>;
      branding.brandColor = typeof settings.brandColor === "string" && settings.brandColor.trim()
        ? settings.brandColor.trim()
        : branding.brandColor;
      branding.brandSecondaryColor = typeof settings.brandSecondaryColor === "string"
        ? settings.brandSecondaryColor.trim()
        : "";
      branding.churchName = typeof settings.churchName === "string" ? settings.churchName.trim() : "";
      branding.mainPastorName = typeof settings.mainPastorName === "string" ? settings.mainPastorName.trim() : "";
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(`${baseUrl}/uploads/dock-branding.json`, { cache: "no-store" });
    if (!res.ok) return branding;
    const data = await res.json();
    branding.brandColor = typeof data.brandColor === "string" && data.brandColor.trim()
      ? data.brandColor.trim()
      : branding.brandColor;
    branding.brandSecondaryColor = typeof data.brandSecondaryColor === "string"
      ? data.brandSecondaryColor.trim()
      : branding.brandSecondaryColor;
    branding.churchName = typeof data.churchName === "string" ? data.churchName.trim() : branding.churchName;
    branding.mainPastorName = typeof data.mainPastorName === "string" ? data.mainPastorName.trim() : branding.mainPastorName;
    const logoFileName = typeof data.brandLogoFileName === "string" ? data.brandLogoFileName.trim() : "";
    branding.logoUrl = logoFileName ? `${baseUrl}/uploads/${encodeURIComponent(logoFileName)}` : "";
  } catch { /* ignore */ }

  return branding;
}

export default function DockAnimatedLTTab({ onStage }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState("");
  const [baseUrl, setBaseUrl] = useState(() => getOverlayBaseUrlSync());

  const panelUrl = useMemo(() => `${baseUrl}${LEGACY_PANEL_PATH}`, [baseUrl]);

  const syncProfileToPanel = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;

    const localSpeakers = loadSpeakersFromLocalSettings();
    const serverSpeakers = await loadSpeakersFromServer(baseUrl);
    const branding = await loadBranding(baseUrl);
    const speakers = uniqueSpeakers([
      ...serverSpeakers,
      ...localSpeakers,
      ...(serverSpeakers.length === 0 && localSpeakers.length === 0 && branding.mainPastorName
        ? [{ name: branding.mainPastorName, role: "Lead Pastor" }]
        : []),
    ]);

    frame.contentWindow.postMessage({
      type: "ocs:animated-lt-profile-sync",
      speakers,
      branding,
    }, "*");
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    void getOverlayBaseUrl()
      .then((url) => {
        if (!cancelled) setBaseUrl(url);
      })
      .catch((err) => {
        console.warn("[DockAnimatedLTTab] Failed to resolve overlay base URL:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void syncProfileToPanel();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [syncProfileToPanel, panelUrl]);

  useEffect(() => {
    const unsub = dockClient.onState((msg) => {
      if (msg.type !== "state:branding-updated") return;
      window.setTimeout(() => {
        void syncProfileToPanel();
      }, 120);
    });
    return unsub;
  }, [syncProfileToPanel]);

  const postPanelMessage = useCallback((payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(payload, "*");
  }, []);

  const clearLowerThird = useCallback((alt?: number) => {
    postPanelMessage({
      type: "ocs:animated-lt-clear",
      alt,
      all: alt === undefined,
    });

    if (alt === undefined) {
      onStage(null);
    }
  }, [onStage, postPanelMessage]);

  const loadObsSource = useCallback(async (live: boolean, alt?: number, payload?: Record<string, unknown>) => {
    setError("");

    try {
      if (!dockObsClient.isConnected) {
        await dockObsClient.connect();
      }
      if (!dockObsClient.isConnected) {
        throw new Error("OBS is not connected.");
      }

      const sourceChanged = await dockObsClient.loadAnimatedLowerThirdSource(live, payload);
      onStage(buildLegacyStageItem(live));
      window.setTimeout(() => {
        postPanelMessage({
          type: "ocs:animated-lt-source-loaded",
          alt,
          live,
        });
      }, sourceChanged ? 260 : 30);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Animated Lower Thirds source.";
      console.warn("[DockAnimatedLTTab] Failed to load legacy Animated LT source:", err);
      setError(message);
    }
  }, [onStage, postPanelMessage]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        live?: boolean;
        alt?: number;
        payload?: Record<string, unknown>;
      } | null;
      if (!payload || payload.type !== "ocs:animated-lt-load-source") return;

      const alt = Number(payload.alt);
      void loadObsSource(Boolean(payload.live), Number.isFinite(alt) ? alt : undefined, payload.payload);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadObsSource]);

  return (
    <div className="dock-animated-lt-legacy">
      {error ? (
        <div className="dock-animated-lt-legacy__error" role="status">
          {error}
        </div>
      ) : null}

      <iframe
        ref={iframeRef}
        className="dock-animated-lt-legacy__frame"
        title="Animated Lower Thirds Control Panel"
        src={panelUrl}
        onLoad={() => void syncProfileToPanel()}
      />

      <div className="dock-animated-lt-clearbar" aria-label="Animated lower third clear controls">
        <span className="dock-animated-lt-clearbar__label">Clear</span>
        {[1, 2, 3, 4].map((alt) => (
          <button
            key={alt}
            type="button"
            className="dock-btn dock-btn--secondary dock-animated-lt-clearbar__button"
            onClick={() => clearLowerThird(alt)}
          >
            LT {alt}
          </button>
        ))}
        <button
          type="button"
          className="dock-btn dock-btn--danger dock-animated-lt-clearbar__button"
          onClick={() => clearLowerThird()}
        >
          All
        </button>
      </div>
    </div>
  );
}
