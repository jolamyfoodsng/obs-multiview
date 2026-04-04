import type { BiblePassage } from "../../bible/types";
import type { PreviewPanelProps } from "./types";

function getPassageText(passage: BiblePassage | null): string {
  if (!passage) return "Select a detected match to prepare it for preview or live presentation.";
  return passage.verses.map((verse) => verse.text).join(" ");
}

function getPassageReference(passage: BiblePassage | null): string {
  if (!passage) return "No verse prepared yet";
  return `${passage.reference} (${passage.translation})`;
}

function getSelectedMatchText(match: PreviewPanelProps["selectedMatch"]): string {
  if (!match) return "Select a detected match to prepare it for live presentation.";
  return match.excerpt || match.reference;
}

function getSelectedMatchReference(match: PreviewPanelProps["selectedMatch"]): string {
  if (!match) return "No verse prepared yet";
  return `${match.reference} (${match.translation})`;
}

export function PreviewPanel({
  livePassage,
  selectedMatch,
}: PreviewPanelProps) {
  const displayText = livePassage
    ? getPassageText(livePassage)
    : getSelectedMatchText(selectedMatch);
  const displayReference = livePassage
    ? getPassageReference(livePassage)
    : getSelectedMatchReference(selectedMatch);

  return (
    <section className="speech-preview-stack">
      <article className="app-surface speech-panel speech-live-card">
        <div className="app-surface__header">
          <div>
            <p className="speech-panel__eyebrow">Live display</p>
            <h2 className="app-surface__title">Current presentation</h2>
          </div>
          <span className={`speech-live-indicator${livePassage ? " is-live" : ""}`}>
            <span className="speech-live-indicator__dot" />
            {livePassage ? "On air" : "Standby"}
          </span>
        </div>
        <div className="app-surface__body speech-live-card__body">
          <div className="speech-display-frame speech-display-frame--live">
            <div className="speech-display-frame__content">
              <p className="speech-display-frame__quote">“{displayText}”</p>
              <p className="speech-display-frame__reference">{displayReference}</p>
            </div>
          </div>
        </div>
      </article>


    </section>
  );
}
