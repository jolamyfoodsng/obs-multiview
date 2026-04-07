import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOverlayBaseUrl, getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { dockObsClient } from "../dockObsClient";
import type { DockStagedItem } from "../dockTypes";

const LEGACY_PANEL_PATH = "/animated-lower-thirds/lower-thirds/control-panel.html";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

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

export default function DockAnimatedLTTab({ onStage }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState("");
  const [baseUrl, setBaseUrl] = useState(() => getOverlayBaseUrlSync());

  const panelUrl = useMemo(() => `${baseUrl}${LEGACY_PANEL_PATH}`, [baseUrl]);

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
        iframeRef.current?.contentWindow?.postMessage({
          type: "ocs:animated-lt-source-loaded",
          alt,
          live,
        }, "*");
      }, sourceChanged ? 260 : 30);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Animated Lower Thirds source.";
      console.warn("[DockAnimatedLTTab] Failed to load legacy Animated LT source:", err);
      setError(message);
    }
  }, [onStage]);

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
      />
    </div>
  );
}
