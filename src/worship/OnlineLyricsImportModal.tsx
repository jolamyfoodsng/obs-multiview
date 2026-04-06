import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { OnlineLyricsSearchResult } from "./onlineLyricsService";
import "./onlineLyricsImportModal.css";

export interface OnlineLyricsImportDraft {
  title: string;
  artist: string;
  lyrics: string;
}

interface OnlineLyricsImportModalProps {
  result: OnlineLyricsSearchResult;
  saving?: boolean;
  onClose: () => void;
  onImport: (draft: OnlineLyricsImportDraft) => void | Promise<void>;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function OnlineLyricsImportModal({
  result,
  saving = false,
  onClose,
  onImport,
}: OnlineLyricsImportModalProps) {
  const titleId = useId();
  const lyricsId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState(result.title);
  const [artist, setArtist] = useState(result.artist);
  const [lyrics, setLyrics] = useState(result.lyrics);

  useEffect(() => {
    setTitle(result.title);
    setArtist(result.artist);
    setLyrics(result.lyrics);
  }, [result]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => lyricsRef.current?.focus(), 0);

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter((node) => node.offsetParent !== null);

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose]);

  const cleanedLyrics = lyrics.trim();
  const cleanedTitle = title.trim();
  const canImport = cleanedTitle.length > 0 && cleanedLyrics.length > 0 && !saving;

  return (
    <div className="online-lyrics-modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="online-lyrics-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="online-lyrics-modal__header">
          <div>
            <p className="online-lyrics-modal__eyebrow">Review lyrics import</p>
            <h2 id={titleId}>Edit before adding to Worship</h2>
            <p id={descriptionId}>
              Imported from <strong>{result.sourceName}</strong>. Review the lyrics, then save it to the worship list.
            </p>
          </div>
          <button
            type="button"
            className="online-lyrics-modal__close"
            aria-label="Close lyrics import"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="online-lyrics-modal__source-row">
          <span className="online-lyrics-modal__source">Source: {result.sourceName}</span>
          <span className="online-lyrics-modal__tag">Imported after save</span>
        </div>

        <div className="online-lyrics-modal__fields">
          <label className="online-lyrics-modal__field">
            <span>Song title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={!cleanedTitle}
            />
          </label>

          <label className="online-lyrics-modal__field">
            <span>Artist</span>
            <input
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        <label className="online-lyrics-modal__field online-lyrics-modal__field--lyrics" htmlFor={lyricsId}>
          <span>Lyrics</span>
          <textarea
            id={lyricsId}
            ref={lyricsRef}
            value={lyrics}
            onChange={(event) => setLyrics(event.target.value)}
            aria-invalid={!cleanedLyrics}
            spellCheck
          />
        </label>

        <div className="online-lyrics-modal__footer">
          <button
            type="button"
            className="online-lyrics-modal__secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="online-lyrics-modal__primary"
            disabled={!canImport}
            onClick={() => {
              if (!canImport) return;
              void onImport({
                title: cleanedTitle,
                artist: artist.trim(),
                lyrics: cleanedLyrics,
              });
            }}
          >
            {saving ? "Importing..." : "Import to Worship"}
          </button>
        </div>
      </div>
    </div>
  );
}
