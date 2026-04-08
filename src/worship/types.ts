/**
 * types.ts — Worship Module type definitions
 */

export interface Slide {
  id: string;
  label: string;
  content: string;
  isContinuation: boolean;
  type: "verse" | "chorus" | "bridge" | "tag" | "pre-chorus" | "intro" | "outro" | "other";
}

export interface LyricSection {
  id: string;
  label: string;
  shortLabel: string;
  type: Slide["type"];
  lines: string[];
  startSlideIndex: number;
  slideCount: number;
}

export interface SongMetadata {
  title: string;
  artist: string;
}

export interface Song {
  id: string;
  metadata: SongMetadata;
  lyrics: string;
  slides: Slide[];
  createdAt: string;
  updatedAt: string;
  importSourceName?: string;
  importSourceType?: "manual" | "online";
  importSourceUrl?: string;
  archived?: boolean;
  archivedAt?: string | null;
}

export interface SplitConfig {
  linesPerSlide: number;
  identifyChorus: boolean;
}
