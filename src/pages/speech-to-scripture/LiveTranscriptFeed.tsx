import type { ReactNode } from "react";
import Icon from "../../components/Icon";
import type { LiveTranscriptFeedProps } from "./types";

function renderHighlightedText(text: string, highlight?: string): ReactNode {
  if (!highlight) return text;
  const lowerText = text.toLowerCase();
  const lowerHighlight = highlight.toLowerCase();
  const start = lowerText.indexOf(lowerHighlight);
  if (start < 0) return text;
  const end = start + highlight.length;
  return (
    <>
      {text.slice(0, start)}
      <mark className="speech-transcript__mark">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export function LiveTranscriptFeed({ status, detail, segments }: LiveTranscriptFeedProps) {
  const isListening = status === "listening";
  const isBusy = status === "matching" || status === "transcribing";

  return (
    <section className="app-surface speech-panel speech-transcript-panel">
      <div className="app-surface__header">
        <div>
          <p className="speech-panel__eyebrow">Live transcript</p>
          <h2 className="app-surface__title">Spoken phrases</h2>
        </div>
        <Icon name="auto_awesome" size={16} />
      </div>

      <div className="app-surface__body speech-transcript-panel__body">
        <div className="speech-transcript">
          {segments.length === 0 ? (
            <div className="speech-empty-state">
              <Icon name="mic_off" size={18} />
              <p>Start transcription to stream spoken phrases here and analyze them against scripture.</p>
            </div>
          ) : (
            segments.map((segment) => (
              <p key={segment.id} className={`speech-transcript__segment is-${segment.tone}`}>
                {renderHighlightedText(segment.text, segment.highlight)}
              </p>
            ))
          )}

          {(isListening || isBusy) && (
            <div className="speech-transcript__cursor">
              <span className="speech-transcript__cursor-bar" />
              <span>{detail || "Analyzing incoming speech…"}</span>
            </div>
          )}
        </div>

        {/* <div className="speech-transcript__footnote">
          Spoken phrases are compared against Bible text in the selected version with KJV fallback for recall.
        </div> */}
      </div>
    </section>
  );
}
