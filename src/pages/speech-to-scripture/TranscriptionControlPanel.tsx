import Icon from "../../components/Icon";
import type { TranscriptionControlPanelProps } from "./types";

const WAVE_BARS = [26, 44, 34, 58, 42, 68, 30, 52, 38];

export function TranscriptionControlPanel({
  status,
  sourceLabel,
  detail,
  modelReady,
  sessionLabel,
  onPrimaryAction,
}: TranscriptionControlPanelProps) {
  const isListening = status === "listening";
  const isProcessing = status === "transcribing" || status === "matching";
  const buttonLabel = isListening
    ? "Stop Transcription"
    : isProcessing
      ? "Processing…"
      : "Start Transcription";
  const buttonIcon = isListening ? "stop_circle" : "mic";

  return (
    <section className="app-surface speech-panel speech-control-panel">
      <div className="app-surface__header">
        <div>
          <p className="speech-panel__eyebrow">Input channel</p>
          <h2 className="app-surface__title">{sourceLabel}</h2>
          <p className="app-surface__meta">
            {detail || (modelReady ? "Ready to detect scripture from live speech." : "Whisper will prepare on first use.")}
          </p>
        </div>
        <div className={`speech-control-panel__icon is-${status}`}>
          <Icon name={isListening ? "mic" : "graphic_eq"} size={18} />
        </div>
      </div>

      <div className="app-surface__body speech-control-panel__body">
        <div className={`speech-wave speech-wave--${status}`}>
          {WAVE_BARS.map((height, index) => (
            <span
              key={index}
              className="speech-wave__bar"
              style={{
                height: `${height}%`,
                animationDelay: `${index * 70}ms`,
              }}
            />
          ))}
        </div>

        <button
          type="button"
          className={`speech-primary-btn${isListening ? " is-stop" : ""}`}
          onClick={onPrimaryAction}
          disabled={isProcessing}
        >
          <Icon name={buttonIcon} size={16} />
          {buttonLabel}
        </button>

        <div className="speech-control-panel__meta">
          <span className="speech-inline-meta">
            <Icon name={modelReady ? "check_circle" : "download"} size={14} />
            {modelReady ? "Model ready" : "Preparing local Whisper"}
          </span>
          {sessionLabel ? (
            <span className="speech-inline-meta">
              <Icon name="schedule" size={14} />
              {sessionLabel}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
