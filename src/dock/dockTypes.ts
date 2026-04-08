/**
 * dockTypes.ts — Types for the OBS Browser Dock UI
 *
 * Defines the tab structure, speaker/event/sermon data shapes,
 * and shared state types for the dock page.
 */

// ---------------------------------------------------------------------------
// Dock Tabs
// ---------------------------------------------------------------------------

export type DockTab = "planner" | "ministry" | "bible" | "worship" | "media";
export type DockStageType = DockTab | "speaker" | "sermon" | "event" | "media" | "ministry" | "animated-lt";

export interface DockTabDef {
  id: DockTab;
  label: string;
  icon: string;
}

export const DOCK_TABS: DockTabDef[] = [
  { id: "planner", label: "Planner", icon: "event_note" },
  { id: "ministry", label: "Ministry", icon: "church" },
  { id: "bible", label: "Bible", icon: "menu_book" },
  { id: "worship", label: "Worship", icon: "music_note" },
  { id: "media", label: "Media", icon: "photo_library" },
];

// ---------------------------------------------------------------------------
// Speaker
// ---------------------------------------------------------------------------

export interface DockSpeaker {
  name: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Bible
// ---------------------------------------------------------------------------

export interface DockBibleSelection {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  text?: string;
}

export interface DockBibleTheme {
  id: string;
  label: string;
}

export const BIBLE_THEMES: DockBibleTheme[] = [
  { id: "default", label: "Default" },
  { id: "minimal", label: "Minimal" },
  { id: "bold", label: "Bold" },
  { id: "cinematic", label: "Cinematic" },
];

// ---------------------------------------------------------------------------
// Sermon
// ---------------------------------------------------------------------------

export interface DockSermonPoint {
  id: string;
  text: string;
  type: "quote" | "point";
  /** Attribution for quotes (e.g. pastor name). Auto-filled from message details. */
  attribution?: string;
}

export interface DockSermon {
  title: string;
  series: string;
  points: DockSermonPoint[];
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface DockEvent {
  id: string;
  name: string;
  date: string;
  location: string;
  description: string;
  graphicUrl?: string;
}

// ---------------------------------------------------------------------------
// Worship
// ---------------------------------------------------------------------------

export interface DockWorshipSong {
  id: string;
  title: string;
  artist: string;
}

export interface DockWorshipSection {
  id: string;
  label: string; // "Verse 1", "Chorus", "Bridge" etc.
  text: string;
  isLive?: boolean;
  isPreview?: boolean;
}

// ---------------------------------------------------------------------------
// Staged Item (common across all tabs)
// ---------------------------------------------------------------------------

export interface DockStagedItem {
  type: DockStageType;
  label: string;
  subtitle?: string;
  /** Additional data for the command */
  data: unknown;
}

// ---------------------------------------------------------------------------
// Bible book lists (for the 4-col grid)
// ---------------------------------------------------------------------------

export const OT_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
  "Amos", "Obadiah", "Jonah", "Micah", "Nahum",
  "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
];

export const NT_BOOKS = [
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
  "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
];

/** Short labels for the book grid */
export function bookAbbrev(name: string): string {
  const map: Record<string, string> = {
    Genesis: "Gen", Exodus: "Exo", Leviticus: "Lev", Numbers: "Num",
    Deuteronomy: "Deut", Joshua: "Josh", Judges: "Judg", Ruth: "Ruth",
    "1 Samuel": "1 Sam", "2 Samuel": "2 Sam", "1 Kings": "1 Kgs",
    "2 Kings": "2 Kgs", "1 Chronicles": "1 Chr", "2 Chronicles": "2 Chr",
    Ezra: "Ezra", Nehemiah: "Neh", Esther: "Esth", Job: "Job",
    Psalms: "Psa", Proverbs: "Prov", Ecclesiastes: "Eccl",
    "Song of Solomon": "Song", Isaiah: "Isa", Jeremiah: "Jer",
    Lamentations: "Lam", Ezekiel: "Ezek", Daniel: "Dan",
    Hosea: "Hos", Joel: "Joel", Amos: "Amos", Obadiah: "Obad",
    Jonah: "Jonah", Micah: "Mic", Nahum: "Nah", Habakkuk: "Hab",
    Zephaniah: "Zeph", Haggai: "Hag", Zechariah: "Zech", Malachi: "Mal",
    Matthew: "Matt", Mark: "Mark", Luke: "Luke", John: "John",
    Acts: "Acts", Romans: "Rom", "1 Corinthians": "1 Cor",
    "2 Corinthians": "2 Cor", Galatians: "Gal", Ephesians: "Eph",
    Philippians: "Phil", Colossians: "Col",
    "1 Thessalonians": "1 Thes", "2 Thessalonians": "2 Thes",
    "1 Timothy": "1 Tim", "2 Timothy": "2 Tim", Titus: "Titus",
    Philemon: "Phm", Hebrews: "Heb", James: "Jas",
    "1 Peter": "1 Pet", "2 Peter": "2 Pet", "1 John": "1 Jn",
    "2 John": "2 Jn", "3 John": "3 Jn", Jude: "Jude",
    Revelation: "Rev",
  };
  return map[name] ?? name.substring(0, 4);
}

/** Number of chapters per book */
export const BOOK_CHAPTERS: Record<string, number> = {
  Genesis: 50, Exodus: 40, Leviticus: 27, Numbers: 36, Deuteronomy: 34,
  Joshua: 24, Judges: 21, Ruth: 4, "1 Samuel": 31, "2 Samuel": 24,
  "1 Kings": 22, "2 Kings": 25, "1 Chronicles": 29, "2 Chronicles": 36,
  Ezra: 10, Nehemiah: 13, Esther: 10, Job: 42, Psalms: 150, Proverbs: 31,
  Ecclesiastes: 12, "Song of Solomon": 8, Isaiah: 66, Jeremiah: 52,
  Lamentations: 5, Ezekiel: 48, Daniel: 12, Hosea: 14, Joel: 3,
  Amos: 9, Obadiah: 1, Jonah: 4, Micah: 7, Nahum: 3,
  Habakkuk: 3, Zephaniah: 3, Haggai: 2, Zechariah: 14, Malachi: 4,
  Matthew: 28, Mark: 16, Luke: 24, John: 21, Acts: 28,
  Romans: 16, "1 Corinthians": 16, "2 Corinthians": 13, Galatians: 6,
  Ephesians: 6, Philippians: 4, Colossians: 4,
  "1 Thessalonians": 5, "2 Thessalonians": 3,
  "1 Timothy": 6, "2 Timothy": 4, Titus: 3, Philemon: 1,
  Hebrews: 13, James: 5, "1 Peter": 5, "2 Peter": 3,
  "1 John": 5, "2 John": 1, "3 John": 1, Jude: 1, Revelation: 22,
};
