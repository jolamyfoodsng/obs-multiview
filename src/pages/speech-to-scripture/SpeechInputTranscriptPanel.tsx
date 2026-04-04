import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "../../components/Icon";
import { AudioReactiveTranscriptionButton } from "./AudioReactiveTranscriptionButton";
import type { SpeechInputTranscriptPanelProps } from "./types";

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

export function SpeechInputTranscriptPanel({
  status,
  audioLevel,
  sourceLabel,
  detail,
  onPrimaryAction,
  segments,
  inputOptions,
  selectedInputId,
  onSelectInput,
  inputPickerDisabled = false,
}: SpeechInputTranscriptPanelProps) {
  const isListening = status === "listening";
  const isProcessing = status === "transcribing" || status === "matching";
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const emptyMessage = isListening || isProcessing
    ? "Listening for speech. Live transcript will appear here as words are captured."
    : "Start transcription to stream spoken phrases here and analyze them against scripture.";

  useEffect(() => {
    if (!pickerOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [pickerOpen]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [detail, isListening, isProcessing, segments]);

  return (
    <section className="app-surface speech-panel speech-input-panel">


      <div className="speech-input-panel__transcript">
        <div className="speech-transcript-panel__header">
          <div>
            <p className="speech-panel__eyebrow">Live transcript</p>
            <h2 className="app-surface__title">Spoken phrases</h2>
          </div>
          <div className="speech-source-picker" ref={pickerRef}>
            <button
              type="button"
              className="speech-control-panel__icon speech-source-picker__trigger"
              onClick={() => setPickerOpen((current) => !current)}
              aria-label="Select microphone"
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              disabled={inputPickerDisabled}
              title={sourceLabel}
            >
              <Icon name="mic" size={16} />
            </button>

            {pickerOpen ? (
              <div className="speech-source-picker__menu" role="menu" aria-label="Microphone inputs">
                <div className="speech-source-picker__heading">Microphone input</div>
                <button
                  type="button"
                  className={`speech-source-picker__item${!selectedInputId ? " is-active" : ""}`}
                  onClick={() => {
                    setPickerOpen(false);
                    void onSelectInput(undefined);
                  }}
                  role="menuitemradio"
                  aria-checked={!selectedInputId}
                >
                  <span className="speech-source-picker__item-copy">
                    <span className="speech-source-picker__item-label">System default</span>
                    <span className="speech-source-picker__item-meta">Use the default microphone input</span>
                  </span>
                  {!selectedInputId ? <Icon name="check" size={14} /> : null}
                </button>

                {inputOptions.map((option) => {
                  const active = option.id === selectedInputId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`speech-source-picker__item${active ? " is-active" : ""}`}
                      onClick={() => {
                        setPickerOpen(false);
                        void onSelectInput(option.id);
                      }}
                      role="menuitemradio"
                      aria-checked={active}
                    >
                      <span className="speech-source-picker__item-copy">
                        <span className="speech-source-picker__item-label">{option.label}</span>
                      </span>
                      {active ? <Icon name="check" size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="speech-transcript" ref={transcriptRef}>
          {segments.length === 0 ? (
            <div className="speech-empty-state">
              <Icon name="mic_off" size={18} />
              <p>{emptyMessage}</p>
            </div>
          ) : (
            segments.map((segment) => (
              <p key={segment.id} className={`speech-transcript__segment is-${segment.tone}`}>
                {renderHighlightedText(segment.text, segment.highlight)}
              </p>
            ))
          )}

          {(isListening || isProcessing) && (
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

      <div className="speech-input-panel__footer">
        <AudioReactiveTranscriptionButton
          status={status}
          audioLevel={audioLevel}
          onClick={onPrimaryAction}
        />
      </div>
    </section>
  );
}
