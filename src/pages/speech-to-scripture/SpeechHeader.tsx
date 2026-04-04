import Icon from "../../components/Icon";
import type { SpeechHeaderProps } from "./types";

export function SpeechHeader({
  status,
  statusLabel,
  sessionLabel,
  translation,
  translations,
  onTranslationChange,
}: SpeechHeaderProps) {
  return (
    <header className="app-page__header speech-page__header">
      <div className="app-page__header-copy">
        <p className="app-page__eyebrow">Voice Bible</p>
        <h1 className="app-page__title speech-page__title">Speech to Scripture</h1>
        <p className="app-page__subtitle">
          Listen to the active microphone, transcribe the sermon in real time, and surface the strongest verse matches without leaving the production desk.
        </p>
      </div>

      <div className="app-page__actions speech-page__header-actions">
        <span className={`speech-status-pill is-${status}`}>
          <Icon
            name={
              status === "listening"
                ? "mic"
                : status === "matching" || status === "transcribing"
                  ? "graphic_eq"
                  : status === "error"
                    ? "error_outline"
                    : "mic_off"
            }
            size={14}
          />
          {statusLabel}
        </span>

        {sessionLabel ? (
          <span className="speech-meta-pill">
            <Icon name="schedule" size={14} />
            {sessionLabel}
          </span>
        ) : null}

        <label className="speech-version-field">
          <span>Version</span>
          <select value={translation} onChange={(event) => onTranslationChange(event.target.value)}>
            {translations.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
