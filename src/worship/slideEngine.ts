/**
 * slideEngine.ts — Worship slide generation utilities
 */

import type { Slide } from "./types";

/**
 * Split raw lyrics into slides based on stanza breaks and lines-per-slide.
 */
export function generateSlides(
  rawLyrics: string,
  linesPerSlide: number,
  _identifyChorus: boolean
): Slide[] {
  if (!rawLyrics.trim()) return [];

  const slides: Slide[] = [];
  const stanzas = rawLyrics.split(/\n\s*\n/);

  let verseCount = 0;

  stanzas.forEach((stanza) => {
    const lines = stanza
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    verseCount++;
    const labelBase = `Verse ${verseCount}`;

    for (let i = 0; i < lines.length; i += linesPerSlide) {
      const chunk = lines.slice(i, i + linesPerSlide);
      const isContinuation = i > 0;

      slides.push({
        id: `slide-${Date.now()}-${slides.length}`,
        label: isContinuation ? `${labelBase} (cont)` : labelBase,
        content: chunk.join("\n"),
        isContinuation,
        type: "verse",
      });
    }
  });

  return slides;
}
