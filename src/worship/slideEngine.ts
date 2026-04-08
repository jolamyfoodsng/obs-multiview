/**
 * slideEngine.ts — Worship slide generation utilities
 */

import type { LyricSection, Slide } from "./types";

type SectionLabel = {
  label: string;
  shortLabel: string;
  type: Slide["type"];
};

function normalizeLabelText(rawLabel: string): string {
  return rawLabel
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bV(\d+)\b/i, "Verse $1");
}

function classifySectionLabel(rawLabel: string): SectionLabel | null {
  const label = normalizeLabelText(rawLabel.replace(/^\[|\]$/g, ""));
  if (!label) return null;

  const verseMatch = label.match(/^(?:v|verse)\s*(\d+|[ivx]+)?$/i);
  if (verseMatch) {
    const suffix = verseMatch[1] ? ` ${verseMatch[1].toUpperCase()}` : "";
    const displaySuffix = verseMatch[1] && /^\d+$/.test(verseMatch[1]) ? ` ${verseMatch[1]}` : suffix;
    return { label: `Verse${displaySuffix}`, shortLabel: `V${displaySuffix.trim() || ""}`.trim(), type: "verse" };
  }

  const chorusMatch = label.match(/^(?:c|ch|chorus|refrain)(?:\s*(\d+))?$/i);
  if (chorusMatch) {
    const suffix = chorusMatch[1] ? ` ${chorusMatch[1]}` : "";
    return { label: `Chorus${suffix}`, shortLabel: `C${chorusMatch[1] ?? ""}`, type: "chorus" };
  }

  const preChorusMatch = label.match(/^(?:pre\s*chorus|prechorus|pc)(?:\s*(\d+))?$/i);
  if (preChorusMatch) {
    const suffix = preChorusMatch[1] ? ` ${preChorusMatch[1]}` : "";
    return { label: `Pre-Chorus${suffix}`, shortLabel: `PC${preChorusMatch[1] ?? ""}`, type: "pre-chorus" };
  }

  const bridgeMatch = label.match(/^(?:b|br|bridge)(?:\s*(\d+))?$/i);
  if (bridgeMatch) {
    const suffix = bridgeMatch[1] ? ` ${bridgeMatch[1]}` : "";
    return { label: `Bridge${suffix}`, shortLabel: `B${bridgeMatch[1] ?? ""}`, type: "bridge" };
  }

  const tagMatch = label.match(/^(?:tag|vamp|hook)(?:\s*(\d+))?$/i);
  if (tagMatch) {
    const suffix = tagMatch[1] ? ` ${tagMatch[1]}` : "";
    return { label: `Tag${suffix}`, shortLabel: `T${tagMatch[1] ?? ""}`, type: "tag" };
  }

  const introMatch = label.match(/^(?:intro|instrumental)(?:\s*(\d+))?$/i);
  if (introMatch) {
    const suffix = introMatch[1] ? ` ${introMatch[1]}` : "";
    return { label: `Intro${suffix}`, shortLabel: `I${introMatch[1] ?? ""}`, type: "intro" };
  }

  const outroMatch = label.match(/^(?:outro|ending|end)(?:\s*(\d+))?$/i);
  if (outroMatch) {
    const suffix = outroMatch[1] ? ` ${outroMatch[1]}` : "";
    return { label: `Outro${suffix}`, shortLabel: `O${outroMatch[1] ?? ""}`, type: "outro" };
  }

  return null;
}

function parseSectionLabelLine(line: string): { section: SectionLabel; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracketMatch) {
    const section = classifySectionLabel(bracketMatch[1]);
    if (section) return { section, rest: bracketMatch[2]?.trim() ?? "" };
  }

  const colonMatch = trimmed.match(/^([A-Za-z][A-Za-z\s-]*\d*)\s*:\s*(.*)$/);
  if (colonMatch) {
    const section = classifySectionLabel(colonMatch[1]);
    if (section) return { section, rest: colonMatch[2]?.trim() ?? "" };
  }

  const section = classifySectionLabel(trimmed);
  return section ? { section, rest: "" } : null;
}

export function getSectionTypeTone(type: Slide["type"]): string {
  switch (type) {
    case "chorus":
      return "chorus";
    case "bridge":
      return "bridge";
    case "tag":
      return "tag";
    case "pre-chorus":
      return "pre-chorus";
    default:
      return "verse";
  }
}

/**
 * Parse raw lyrics into structured worship sections: Verse, Chorus, Bridge,
 * Tag, etc. If a stanza is unlabeled, it becomes the next Verse.
 */
export function parseWorshipLyricSections(rawLyrics: string, linesPerSlide: number): LyricSection[] {
  const normalizedLyrics = rawLyrics.replace(/\r\n?/g, "\n").trim();
  if (!normalizedLyrics) return [];

  const sections: LyricSection[] = [];
  let verseCount = 0;
  let slideCursor = 0;

  const pushSection = (baseSection: SectionLabel, lines: string[]) => {
    const cleanLines = lines.map((line) => line.trim()).filter(Boolean);
    if (cleanLines.length === 0) return;
    const slideCount = Math.max(1, Math.ceil(cleanLines.length / Math.max(1, linesPerSlide)));
    const idBase = `${baseSection.shortLabel || baseSection.label}-${sections.length}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    sections.push({
      id: `section-${idBase}`,
      label: baseSection.label,
      shortLabel: baseSection.shortLabel || baseSection.label,
      type: baseSection.type,
      lines: cleanLines,
      startSlideIndex: slideCursor,
      slideCount,
    });
    slideCursor += slideCount;
  };

  normalizedLyrics.split(/\n\s*\n/).forEach((stanza) => {
    const stanzaLines = stanza.split("\n").map((line) => line.trim()).filter(Boolean);
    if (stanzaLines.length === 0) return;

    let label = parseSectionLabelLine(stanzaLines[0]);
    let lines = stanzaLines;

    if (label) {
      lines = [
        ...(label.rest ? [label.rest] : []),
        ...stanzaLines.slice(1),
      ];
    } else {
      verseCount += 1;
      label = {
        section: { label: `Verse ${verseCount}`, shortLabel: `V${verseCount}`, type: "verse" },
        rest: "",
      };
    }

    const inlineSections: Array<{ section: SectionLabel; lines: string[] }> = [];
    let current = { section: label.section, lines: [] as string[] };

    for (const line of lines) {
      const nextLabel = parseSectionLabelLine(line);
      if (nextLabel && current.lines.length > 0) {
        inlineSections.push(current);
        current = { section: nextLabel.section, lines: nextLabel.rest ? [nextLabel.rest] : [] };
      } else if (nextLabel) {
        current = { section: nextLabel.section, lines: nextLabel.rest ? [nextLabel.rest] : [] };
      } else {
        current.lines.push(line);
      }
    }

    inlineSections.push(current);
    inlineSections.forEach((section) => pushSection(section.section, section.lines));
  });

  return sections;
}

export function formatLyricsFromSections(sections: Array<Pick<LyricSection, "label" | "lines">>): string {
  return sections
    .map((section) => {
      const label = toTitleCase(section.label.trim());
      const lines = section.lines.map((line) => line.trim()).filter(Boolean);
      return [label ? `${label}:` : "", ...lines].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

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
  const sections = parseWorshipLyricSections(rawLyrics, linesPerSlide);

  sections.forEach((section) => {
    for (let i = 0; i < section.lines.length; i += linesPerSlide) {
      const chunk = section.lines.slice(i, i + linesPerSlide);
      const isContinuation = i > 0;

      slides.push({
        id: `slide-${section.id}-${slides.length}`,
        label: isContinuation ? `${section.label} (cont)` : section.label,
        content: chunk.join("\n"),
        isContinuation,
        type: section.type,
      });
    }
  });

  return slides;
}
