import { useCallback, useMemo, useState } from "react";
import { getDisplaySceneName, getRawPreviewScene, getRawProgramScene } from "../../services/obsSceneTargets";
import { getSettings, updateSettings } from "../../multiview/mvStore";
import "./obs-scenes-panel.css";
import Icon from "../Icon";

export interface ObsSceneOption {
  sceneName: string;
  sceneIndex?: number;
}

type ObsSendMode = "scene" | "preview" | "program";

interface ObsScenesPanelProps {
  title?: string;
  description?: string;
  contentLabel?: string;
  connected: boolean;
  scenes: ObsSceneOption[];
  mainScene?: string;
  previewScene?: string;
  programScene?: string;
  activeScenes?: string[];
  refreshing?: boolean;
  disabled?: boolean;
  sendLabel?: string;
  onRefresh?: () => void | Promise<void>;
  onSendToScene: (sceneName: string, mode: ObsSendMode) => void | Promise<void>;
}

export function ObsScenesPanel({
  title = "OBS Scenes",
  description,
  contentLabel = "overlay",
  connected,
  scenes,
  mainScene = "",
  previewScene = "",
  programScene = "",
  activeScenes = [],
  refreshing = false,
  disabled = false,
  sendLabel = "Send",
  onRefresh,
  onSendToScene,
}: ObsScenesPanelProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [programConfirmOpen, setProgramConfirmOpen] = useState(false);
  const [programTarget, setProgramTarget] = useState("");
  const [skipProgramConfirm, setSkipProgramConfirm] = useState(false);

  const sortedScenes = useMemo(() => {
    return [...scenes].sort((a, b) => {
      if (a.sceneName === mainScene) return -1;
      if (b.sceneName === mainScene) return 1;
      const ai = Number.isFinite(a.sceneIndex) ? (a.sceneIndex as number) : Number.MAX_SAFE_INTEGER;
      const bi = Number.isFinite(b.sceneIndex) ? (b.sceneIndex as number) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.sceneName.localeCompare(b.sceneName);
    });
  }, [scenes, mainScene]);

  const safeSend = useCallback(
    async (sceneName: string, mode: ObsSendMode, key: string) => {
      if (!sceneName) return;
      setBusyKey(key);
      try {
        await onSendToScene(sceneName, mode);
      } finally {
        setBusyKey(null);
      }
    },
    [onSendToScene],
  );

  const handleSendPreview = useCallback(async () => {
    if (disabled || !connected || busyKey) return;
    const target = await getRawPreviewScene(previewScene);
    await safeSend(target, "preview", "preview");
  }, [disabled, connected, busyKey, previewScene, safeSend]);

  const handleConfirmProgram = useCallback(async () => {
    if (!programTarget) return;
    if (skipProgramConfirm) {
      updateSettings({ confirmBeforeProgramSend: false });
    }
    setProgramConfirmOpen(false);
    await safeSend(programTarget, "program", "program");
    setProgramTarget("");
    setSkipProgramConfirm(false);
  }, [programTarget, skipProgramConfirm, safeSend]);

  const handleSendProgram = useCallback(async () => {
    if (disabled || !connected || busyKey) return;
    const target = await getRawProgramScene(programScene);
    if (!target) return;
    const settings = getSettings();
    if (settings.confirmBeforeProgramSend) {
      setProgramTarget(target);
      setProgramConfirmOpen(true);
      return;
    }
    await safeSend(target, "program", "program");
  }, [disabled, connected, busyKey, programScene, safeSend]);

  return (
    <div className="obs-scenes-panel">
      <div className="obs-scenes-panel-head">
        <span className="obs-scenes-panel-title">
          <Icon name="movie" size={15} />
          {title}
        </span>
        {onRefresh && (
          <button
            type="button"
            className="obs-scenes-panel-refresh"
            onClick={() => { void onRefresh(); }}
            disabled={refreshing || Boolean(busyKey)}
            title="Refresh scenes"
          >
            <Icon name="refresh" size={14} style={{ animation: refreshing ? "spin 1s linear infinite" : undefined }} />
          </button>
        )}
      </div>

      <p className="obs-scenes-panel-help">
        {description ?? `These are your current scenes in OBS. Send this ${contentLabel} to Preview, Program, or any specific scene.`}
      </p>

      <div className="obs-scenes-panel-actions">
        <button
          type="button"
          className="obs-scenes-panel-action"
          onClick={handleSendPreview}
          disabled={!connected || disabled || Boolean(busyKey)}
          title="Sends to the scene currently loaded in OBS Preview"
        >
          {busyKey === "preview" ? "Sending…" : "Send to Preview"}
        </button>
        <button
          type="button"
          className="obs-scenes-panel-action primary"
          onClick={handleSendProgram}
          disabled={!connected || disabled || Boolean(busyKey)}
          title="Sends directly to the scene currently live in OBS Program"
        >
          {busyKey === "program" ? "Sending…" : "Send to Program"}
        </button>
      </div>

      {sortedScenes.length === 0 ? (
        <p className="obs-scenes-panel-empty">
          {connected ? "No scenes found in OBS." : "Connect to OBS to discover scenes."}
        </p>
      ) : (
        <div className="obs-scenes-panel-list">
          {sortedScenes.map((scene) => {
            const isServiceScene = scene.sceneName === mainScene && mainScene !== "";
            const isPreview = scene.sceneName === previewScene && previewScene !== "";
            const isProgram = scene.sceneName === programScene && programScene !== "";
            const isActive = activeScenes.includes(scene.sceneName);
            const sceneBusy = busyKey === `scene:${scene.sceneName}`;
            const statusParts: string[] = [];
            if (isServiceScene) statusParts.push("Service main scene");
            if (isPreview) statusParts.push("Currently in OBS Preview");
            if (isProgram) statusParts.push("Currently live in OBS Program");
            if (isActive) statusParts.push(`This ${contentLabel} is active here`);
            const statusText = statusParts.join(" • ");
            return (
              <div key={scene.sceneName} className="obs-scenes-panel-item">
                <Icon name={isServiceScene ? "star" : "videocam"} size={14} style={{ color: isServiceScene ? "#00E676" : "rgba(255, 255, 255, 0.35)" }} />
                <div className="obs-scenes-panel-item-meta">
                  <span className="obs-scenes-panel-item-name">{scene.sceneName}</span>
                  {statusText && (
                    <span className="obs-scenes-panel-item-status">{statusText}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="obs-scenes-panel-send-btn"
                  onClick={() => { void safeSend(scene.sceneName, "scene", `scene:${scene.sceneName}`); }}
                  disabled={!connected || disabled || Boolean(busyKey)}
                >
                  {sceneBusy ? "Sending…" : sendLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {programConfirmOpen && (
        <div className="obs-scenes-modal-backdrop" onClick={() => setProgramConfirmOpen(false)}>
          <div className="obs-scenes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="obs-scenes-modal-head">
              <h3>Send To Live Program?</h3>
              <button
                type="button"
                className="obs-scenes-modal-close"
                onClick={() => setProgramConfirmOpen(false)}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="obs-scenes-modal-body">
              <p>
                You are about to send this {contentLabel} directly to <strong>{getDisplaySceneName(programTarget)}</strong>, the current OBS Program scene.
              </p>
              <p>The audience will see this immediately.</p>
              <label className="obs-scenes-modal-check">
                <input
                  type="checkbox"
                  checked={skipProgramConfirm}
                  onChange={(e) => setSkipProgramConfirm(e.target.checked)}
                />
                <span>Do not show this confirmation again</span>
              </label>
            </div>
            <div className="obs-scenes-modal-actions">
              <button type="button" className="obs-scenes-modal-btn" onClick={() => setProgramConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="obs-scenes-modal-btn primary" onClick={() => { void handleConfirmProgram(); }}>
                Send To Program
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
