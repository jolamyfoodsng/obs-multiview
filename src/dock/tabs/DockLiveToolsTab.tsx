import { useCallback, useEffect, useMemo, useState } from "react";
import { dockObsClient } from "../dockObsClient";
import type { DockStagedItem } from "../dockTypes";
import Icon from "../DockIcon";
import { DEFAULT_LIVE_TOOL_TEMPLATES, LIVE_TOOL_MOMENTS } from "../../live-tools/liveToolDefaults";
import {
  LIVE_TOOL_MOMENT_DESCRIPTIONS,
  LIVE_TOOL_MOMENT_LABELS,
  type LiveToolMoment,
  type LiveToolsSnapshot,
  type LiveToolTemplate,
} from "../../live-tools/types";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  initialSnapshot?: LiveToolsSnapshot | null;
}

type OutputTarget = "preview" | "program";

function createDefaultSnapshot(): LiveToolsSnapshot {
  return {
    templates: DEFAULT_LIVE_TOOL_TEMPLATES,
    updatedAt: new Date().toISOString(),
  };
}

function getMomentClass(moment: LiveToolMoment): string {
  return moment === "emergency" ? " dock-live-tool-row--emergency" : "";
}

function getConfigurationMessage(tool: LiveToolTemplate): string {
  if (tool.kind === "scene" && !tool.sceneName) return "Choose scene in app";
  if (tool.action === "safe-scene" && !tool.sceneName) return "Choose safe scene in app";
  if (tool.action === "mute-mic" && !tool.sourceName) return "Choose mic source in app";
  return "";
}

export default function DockLiveToolsTab({ staged: _staged, onStage, initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState<LiveToolsSnapshot>(() => initialSnapshot ?? createDefaultSnapshot());
  const [activeMoment, setActiveMoment] = useState<LiveToolMoment>("pre-service");
  const [sending, setSending] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const loadSnapshot = useCallback(async () => {
    if (initialSnapshot?.templates?.length) {
      setSnapshot(initialSnapshot);
      return;
    }

    try {
      const res = await fetch("/uploads/dock-live-tools.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && Array.isArray(data.templates)) {
        setSnapshot(data as LiveToolsSnapshot);
        return;
      }
    } catch {
      // Fall back to system defaults.
    }
    setSnapshot(createDefaultSnapshot());
  }, [initialSnapshot]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const templates = useMemo(
    () => snapshot.templates.filter((tool) => tool.moment === activeMoment),
    [activeMoment, snapshot.templates],
  );

  const handleSend = useCallback(async (tool: LiveToolTemplate, target: OutputTarget) => {
    const key = `${tool.id}:${target}`;
    setSending(key);
    setMessage(target === "preview" ? "Sending to Preview..." : "Sending to Program...");
    try {
      await dockObsClient.pushLiveTool(tool, target === "program");
      onStage({
        type: "live",
        label: tool.label,
        subtitle: target === "program" ? "Program" : "Preview",
        data: {
          tool,
          target,
          _dockLive: target === "program",
        },
      });
      setMessage(target === "preview" ? "Sent to Preview" : "Sent to Program");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(null);
    }
  }, [onStage]);

  const handleClear = useCallback(async (target: "preview" | "program" | "all") => {
    setSending(`clear:${target}`);
    try {
      if (target === "all") {
        await dockObsClient.clearLiveTools();
      } else {
        await dockObsClient.clearLiveToolTarget(target === "program");
      }
      setMessage(`Cleared ${target}`);
      if (target === "all") onStage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(null);
    }
  }, [onStage]);

  return (
    <div className="dock-module dock-module--live-tools">
      <section className="dock-console-panel dock-console-panel--workspace dock-live-tools-shell">
        <div className="dock-console-header">
          <div>
            <div className="dock-console-header__eyebrow">Live Tools</div>
            <div className="dock-console-header__title">Service flow controls</div>
          </div>
          <button
            type="button"
            className="dock-shell-icon-btn"
            onClick={() => void loadSnapshot()}
            aria-label="Refresh Live Tools"
            title="Refresh Live Tools"
          >
            <Icon name="refresh" size={12} />
          </button>
        </div>

        <div className="dock-console-segmented dock-live-tools-moments" role="tablist" aria-label="Live Tool sections">
          {LIVE_TOOL_MOMENTS.map((moment) => (
            <button
              key={moment}
              type="button"
              role="tab"
              aria-selected={activeMoment === moment}
              className={`dock-console-segmented__item${activeMoment === moment ? " dock-console-segmented__item--active" : ""}`}
              onClick={() => setActiveMoment(moment)}
            >
              {LIVE_TOOL_MOMENT_LABELS[moment]}
            </button>
          ))}
        </div>

        <div className="dock-live-tools-moment-copy">
          {LIVE_TOOL_MOMENT_DESCRIPTIONS[activeMoment]}
        </div>

        {message && (
          <div className="dock-live-tools-message">{message}</div>
        )}

        <div className="dock-live-tools-list">
          {templates.map((tool) => {
            const previewKey = `${tool.id}:preview`;
            const programKey = `${tool.id}:program`;
            const configurationMessage = getConfigurationMessage(tool);
            const disabled = sending !== null || Boolean(configurationMessage);
            return (
              <div key={tool.id} className={`dock-live-tool-row${getMomentClass(tool.moment)}`}>
                <div className="dock-live-tool-row__main">
                  <span className="dock-live-tool-row__icon">
                    <Icon name={tool.icon} size={13} />
                  </span>
                  <div className="dock-live-tool-row__copy">
                    <div className="dock-live-tool-row__title">{tool.label}</div>
                    <div className="dock-live-tool-row__meta">
                      {configurationMessage || tool.title}
                      {tool.backgroundMediaName ? ` · ${tool.backgroundMediaName}` : ""}
                    </div>
                  </div>
                  <span className="dock-live-tool-row__kind">{tool.kind.replace("-", " ")}</span>
                </div>
                <div className="dock-hover-actions dock-live-tool-row__actions">
                  <button
                    type="button"
                    className="dock-btn dock-btn--preview dock-btn--compact"
                    disabled={disabled}
                    onClick={() => void handleSend(tool, "preview")}
                  >
                    {sending === previewKey ? "..." : "Preview"}
                  </button>
                  <button
                    type="button"
                    className="dock-btn dock-btn--live dock-btn--compact"
                    disabled={disabled}
                    onClick={() => void handleSend(tool, "program")}
                  >
                    {sending === programKey ? "..." : "Program"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="dock-live-tools-clear">
          <button
            type="button"
            className="dock-btn dock-btn--compact"
            disabled={sending !== null}
            onClick={() => void handleClear("preview")}
          >
            Clear Preview
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--compact"
            disabled={sending !== null}
            onClick={() => void handleClear("program")}
          >
            Clear Program
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--danger dock-btn--compact"
            disabled={sending !== null}
            onClick={() => void handleClear("all")}
          >
            Clear All
          </button>
        </div>
      </section>
    </div>
  );
}
