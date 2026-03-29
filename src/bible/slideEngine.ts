/**
 * slideEngine.ts — Auto-split Bible passages into presentation slides
 *
 * Features:
 * - Configurable max lines & max characters per slide
 * - Smart split: avoids breaking mid-sentence (prefers punctuation boundaries)
 * - Inline verse numbers
 * - Generates BibleSlide[] from a BiblePassage
 */

import { nanoid } from "nanoid";
import type {
  BiblePassage,
  BibleSlide,
  BibleVerse,
  SlideConfig,
} from "./types";
import { DEFAULT_SLIDE_CONFIG } from "./types";

/**
 * Build a single string from verses, optionally with inline verse numbers.
 */
function buildVerseText(
  verses: BibleVerse[],
  showVerseNumbers: boolean
): string {
  return verses
    .map((v) => {
      const prefix = showVerseNumbers ? `[${v.verse}] ` : "";
      return prefix + v.text.trim();
    })
    .join(" ");
}

/**
 * Find the best split point near `target` in `text`.
 * Prefers sentence-ending punctuation, then commas/semicolons, then spaces.
 */
function findSmartSplitPoint(text: string, target: number): number {
  // Don't go beyond text length
  const max = Math.min(target, text.length);

  // Search window: look backwards up to 40% of target for punctuation
  const windowStart = Math.max(0, max - Math.floor(target * 0.4));

  // Prefer sentence boundaries (.!? followed by space)
  for (let i = max; i >= windowStart; i--) {
    const ch = text[i - 1];
    if ((ch === "." || ch === "!" || ch === "?") && (i === text.length || text[i] === " ")) {
      return i;
    }
  }

  // Next: comma / semicolon / colon boundaries
  for (let i = max; i >= windowStart; i--) {
    const ch = text[i - 1];
    if ((ch === "," || ch === ";" || ch === ":") && i < text.length && text[i] === " ") {
      return i;
    }
  }

  // Fallback: find last space before max
  const lastSpace = text.lastIndexOf(" ", max);
  if (lastSpace > windowStart) {
    return lastSpace;
  }

  // Hard split at target
  return max;
}

/**
 * Split a long text into chunks respecting maxChars & smart splitting.
 */
function splitText(text: string, config: SlideConfig): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= config.maxChars) {
      chunks.push(remaining.trim());
      break;
    }

    let splitAt: number;
    if (config.smartSplit) {
      splitAt = findSmartSplitPoint(remaining, config.maxChars);
    } else {
      // Simple split at last space before maxChars
      const lastSpace = remaining.lastIndexOf(" ", config.maxChars);
      splitAt = lastSpace > 0 ? lastSpace : config.maxChars;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks;
}

/**
 * Further limit each chunk to maxLines (approximate — assumes ~60 chars per line
 * at default font size, but this is mostly a char limit safeguard).
 */
function enforceMaxLines(chunks: string[], maxLines: number): string[] {
  const result: string[] = [];
  const approxCharsPerLine = 55;

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    if (lines.length <= maxLines) {
      // Check wrapped line estimate
      const estimatedLines = Math.ceil(chunk.length / approxCharsPerLine);
      if (estimatedLines <= maxLines) {
        result.push(chunk);
      } else {
        // Re-split this chunk into smaller pieces
        const subMaxChars = maxLines * approxCharsPerLine;
        const subConfig: SlideConfig = {
          maxLines,
          maxChars: subMaxChars,
          showVerseNumbers: false,
          smartSplit: true,
        };
        result.push(...splitText(chunk, subConfig));
      }
    } else {
      // More hard newlines than maxLines — split on newline boundaries
      for (let i = 0; i < lines.length; i += maxLines) {
        result.push(lines.slice(i, i + maxLines).join("\n"));
      }
    }
  }

  return result;
}

/**
 * Determine which verse numbers are covered by a text chunk.
 * Uses the [N] markers to detect verse boundaries.
 */
function detectVerseRange(
  text: string,
  verses: BibleVerse[]
): string {
  const verseNums: number[] = [];
  const regex = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    verseNums.push(parseInt(match[1], 10));
  }

  if (verseNums.length === 0 && verses.length > 0) {
    // No markers — probably single verse or markers stripped
    return `${verses[0].verse}`;
  }

  if (verseNums.length === 1) {
    return `${verseNums[0]}`;
  }

  const min = Math.min(...verseNums);
  const max = Math.max(...verseNums);
  return min === max ? `${min}` : `${min}-${max}`;
}

/**
 * Generate slides from a BiblePassage.
 */
export function generateSlides(
  passage: BiblePassage,
  config: SlideConfig = DEFAULT_SLIDE_CONFIG
): BibleSlide[] {
  if (!passage.verses.length) return [];

  const fullText = buildVerseText(passage.verses, config.showVerseNumbers);

  // Split into chunks
  let chunks = splitText(fullText, config);

  // Enforce max lines
  chunks = enforceMaxLines(chunks, config.maxLines);

  const total = chunks.length;
  const referenceBase = `${passage.book} ${passage.chapter}:${
    passage.startVerse === passage.endVerse
      ? passage.startVerse
      : `${passage.startVerse}-${passage.endVerse}`
  }`;

  return chunks.map((text, i) => ({
    id: nanoid(),
    text,
    reference: `${referenceBase} (${passage.translation})`,
    verseRange: detectVerseRange(text, passage.verses),
    index: i,
    total,
  }));
}

/**
 * Parse a user reference string into components.
 * Supports formats:
 *   "John 3:16"
 *   "John 3:16-18"
 *   "1 Cor 13:4-8"
 *   "Gen 1:1-3"
 *   "Ps 23"  (whole chapter)
 */
export interface ParsedReference {
  book: string;
  chapter: number;
  startVerse: number | null;
  endVerse: number | null;
}

export function parseReference(input: string): ParsedReference | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern: optional number prefix + book name + chapter + optional :verse or :verse-verse
  const match = trimmed.match(
    /^(\d?\s*[A-Za-z][A-Za-z\s.]*?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/
  );

  if (!match) return null;

  const bookRaw = match[1].trim();
  const chapter = parseInt(match[2], 10);
  const startVerse = match[3] ? parseInt(match[3], 10) : null;
  const endVerse = match[4] ? parseInt(match[4], 10) : startVerse;

  return {
    book: bookRaw,
    chapter,
    startVerse,
    endVerse,
  };
}
