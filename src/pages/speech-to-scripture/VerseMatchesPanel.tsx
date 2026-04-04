import Icon from "../../components/Icon";
import type { VerseMatchesPanelProps } from "./types";
import { VerseMatchCard } from "./VerseMatchCard";

export function VerseMatchesPanel({
  matches,
  selectedId,
  detail,
  matching = false,
  onPreview,
  onPresent,
  onQueue,
  onClear,
}: VerseMatchesPanelProps) {
  return (
    <section className="speech-matches">
      <div className="speech-matches__header">
        <div>
          <p className="speech-panel__eyebrow">Detected verse matches</p>
          <h2 className="app-surface__title">Similarity results</h2>
        </div>
        <button type="button" className="speech-link-btn" onClick={onClear}>
          Clear all
        </button>
      </div>

      <div className="speech-matches__list">
        {matches.length === 0 ? (
          <div className="app-surface speech-panel speech-empty-results">
            <div className="app-surface__body">
              <Icon name={matching ? "sync" : "search"} size={18} />
              <p>{detail || "Verse matches will populate here as the transcript becomes more specific."}</p>
            </div>
          </div>
        ) : (
          matches.map((match) => (
            <VerseMatchCard
              key={match.id}
              match={match}
              selected={selectedId === match.id}
              onPreview={() => onPreview(match)}
              onPresent={() => onPresent(match)}
              onQueue={() => onQueue(match)}
            />
          ))
        )}
      </div>

      <div className="speech-matches__hint">
        <Icon name={matching ? "sync" : "info"} size={14} />
        <p>{detail || "Matches refine as additional words arrive. Stronger confidence appears first for faster live selection."}</p>
      </div>
    </section>
  );
}
