import { useCallback, useMemo, useState } from "react";
import { getOverlayBaseUrlSync } from "../../services/overlayUrl";
import { dockObsClient } from "../dockObsClient";
import type { DockStagedItem } from "../dockTypes";
import Icon from "../DockIcon";

const LEGACY_PANEL_PATH = "/animated-lower-thirds/lower-thirds/control-panel.html";
const LEGACY_SOURCE_PATH = "/animated-lower-thirds/lower-thirds/browser-source.html";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

type LoadState = "idle" | "loading-preview" | "loading-program" | "ready-preview" | "ready-program" | "error";

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

export default function DockAnimatedLTTab({ staged, onStage }: Props) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");

  const baseUrl = getOverlayBaseUrlSync();
  const panelUrl = useMemo(() => `${baseUrl}${LEGACY_PANEL_PATH}`, [baseUrl]);
  const sourceUrl = useMemo(() => `${baseUrl}${LEGACY_SOURCE_PATH}`, [baseUrl]);

  const loadObsSource = useCallback(async (live: boolean) => {
    setError("");
    setLoadState(live ? "loading-program" : "loading-preview");

    try {
      if (!dockObsClient.isConnected) {
        await dockObsClient.connect();
      }
      if (!dockObsClient.isConnected) {
        throw new Error("OBS is not connected.");
      }

      await dockObsClient.loadAnimatedLowerThirdSource(live);
      onStage(buildLegacyStageItem(live));
      setLoadState(live ? "ready-program" : "ready-preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Animated Lower Thirds source.";
      console.warn("[DockAnimatedLTTab] Failed to load legacy Animated LT source:", err);
      setError(message);
      setLoadState("error");
    }
  }, [onStage]);

  const stagedData = staged?.type === "animated-lt" && staged.data && typeof staged.data === "object"
    ? staged.data as { source?: string; _dockLive?: boolean }
    : null;
  const loadedLabel = stagedData?.source === "animated-lower-thirds-legacy"
    ? (stagedData._dockLive ? "Program source loaded" : "Preview source loaded")
    : loadState === "ready-program"
      ? "Program source loaded"
      : loadState === "ready-preview"
        ? "Preview source loaded"
        : "Source not loaded";

  return (
    <div className="dock-animated-lt-legacy">
      <div className="dock-animated-lt-legacy__setup" aria-label="Animated Lower Thirds OBS source setup">
        <div className="dock-animated-lt-legacy__copy">
          <span className="dock-section-label">Animated Lower Thirds</span>
          <span className="dock-animated-lt-legacy__status">{loadedLabel}</span>
        </div>
        <div className="dock-animated-lt-legacy__actions">
          <button
            type="button"
            className="dock-btn dock-btn--preview"
            onClick={() => void loadObsSource(false)}
            disabled={loadState === "loading-preview" || loadState === "loading-program"}
            title={`Load ${sourceUrl}?mode=preview into the OBS Preview scene`}
          >
            <Icon name="preview" size={13} />
            {loadState === "loading-preview" ? "Loading..." : "Load Preview"}
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--live"
            onClick={() => void loadObsSource(true)}
            disabled={loadState === "loading-preview" || loadState === "loading-program"}
            title={`Load ${sourceUrl} into the OBS Program scene`}
          >
            <Icon name="play_arrow" size={13} />
            {loadState === "loading-program" ? "Loading..." : "Load Program"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="dock-animated-lt-legacy__error" role="status">
          {error}
        </div>
      ) : null}

      <iframe
        className="dock-animated-lt-legacy__frame"
        title="Animated Lower Thirds Control Panel"
        src={panelUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
      />
    </div>
  );
}
