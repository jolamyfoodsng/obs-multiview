import Icon from "../../components/Icon";
import type { VoiceBibleStatus } from "../../services/voiceBibleTypes";

const METER_PROFILE = [0.34, 0.5, 0.68, 0.9, 0.68, 0.5, 0.34];

interface AudioReactiveTranscriptionButtonProps {
  status: VoiceBibleStatus;
  audioLevel: number;
  onClick: () => void;
}

function getButtonLabel(status: VoiceBibleStatus): string {
  if (status === "listening") return "Listening";
  if (status === "transcribing" || status === "matching") return "Processing…";
  return "Start Transcription";
}

function getButtonIcon(status: VoiceBibleStatus): string {
  if (status === "listening") return "mic";
  if (status === "transcribing" || status === "matching") return "sync";
  return "mic";
}

export function AudioReactiveTranscriptionButton({
  status,
  audioLevel,
  onClick,
}: AudioReactiveTranscriptionButtonProps) {
  const isListening = status === "listening";
  const isProcessing = status === "transcribing" || status === "matching";
  const isVoiceActive = isListening && audioLevel > 0.075;

  return (
    <button
      type="button"
      className={[
        "speech-primary-btn",
        "speech-primary-btn--wide",
        "speech-reactive-btn",
        `is-${status}`,
        isListening ? "is-listening" : "",
        isVoiceActive ? "is-voice-active" : "is-voice-idle",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
      disabled={isProcessing}
      aria-pressed={isListening}
      aria-label={isListening ? "Stop transcription" : "Start transcription"}
    >
      <span className="speech-reactive-btn__content">
        <Icon name={getButtonIcon(status)} size={16} />
        <span className="speech-reactive-btn__label">{getButtonLabel(status)}</span>
        {isListening ? (
          <span className="speech-reactive-btn__meter" aria-hidden="true">
            {METER_PROFILE.map((shape, index) => {
              const floor = shape * 0.28;
              const lift = shape * Math.max(0, Math.min(1, audioLevel)) * 0.9;
              const scale = Math.max(0.14, Math.min(1, floor + lift));
              return (
                <span
                  key={index}
                  className="speech-reactive-btn__bar"
                  style={{ transform: `scaleY(${scale.toFixed(3)})` }}
                />
              );
            })}
          </span>
        ) : null}
      </span>
    </button>
  );
}
