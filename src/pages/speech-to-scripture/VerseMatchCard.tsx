import Icon from "../../components/Icon";
import type { VerseMatchCardProps } from "./types";

function confidenceLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function VerseMatchCard({
  match,
  selected,
  onPreview,
  onPresent,
  onQueue,
}: VerseMatchCardProps) {
  return (
    <article className={`speech-match-card is-${match.emphasis}${selected ? " is-selected" : ""}`}>
      <div className="speech-match-card__head">
        <div>
          <h3>{match.reference}</h3>
          <p>{match.translation}</p>
        </div>
        <span className="speech-match-card__score">{confidenceLabel(match.confidence)}</span>
      </div>

      <p className="speech-match-card__excerpt">“{match.excerpt}”</p>

      <div className="speech-match-card__actions">
        <button type="button" className="speech-match-btn" onClick={onPreview}>
          <Icon name="visibility" size={14} />
          Preview
        </button>
        <button type="button" className="speech-match-btn speech-match-btn--primary" onClick={onPresent}>
          <Icon name="play_arrow" size={14} />
          Present
        </button>
        <button type="button" className="speech-match-btn" onClick={onQueue}>
          <Icon name="queue" size={14} />
          Queue
        </button>
      </div>
    </article>
  );
}
