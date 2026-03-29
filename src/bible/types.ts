/**
 * bible/types.ts — Type definitions for the Bible Module
 *
 * Core types for scripture data, slides, themes, queue, and OBS output.
 */

// ---------------------------------------------------------------------------
// Bible Data Types
// ---------------------------------------------------------------------------

export interface BibleVerse {
  book: string;          // e.g. "John"
  chapter: number;
  verse: number;
  text: string;
  /** Canonical abbreviation like "Jn", "Gen" */
  abbrev: string;
}

export interface BiblePassage {
  reference: string;     // "John 3:16-18" or "John 3:16"
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
  verses: BibleVerse[];
  translation: string;   // "KJV", "NIV", etc.
}

/**
 * Dynamic translation identifier — no longer a fixed union.
 * Stored as the uppercase abbreviation string (e.g. "KJV", "ESV", "NIV").
 */
export type BibleTranslation = string;

/** Raw Bible JSON: Book → Chapter → Verse → Text */
export type RawBibleData = Record<string, Record<string, Record<string, string>>>;

// ---------------------------------------------------------------------------
// API / Library Types
// ---------------------------------------------------------------------------

/** A Bible in the remote catalog (from API response) */
export interface CatalogBible {
  id: string;
  name: string;
  language: string;
  country: string;
  version: string;
  filename: string;
  filesize: number;
  sha256: string;
}

/** A Bible that has been downloaded and stored locally in IndexedDB */
export interface InstalledBible {
  /** Catalog UUID */
  id: string;
  /** Short abbreviation used as translation key, e.g. "KJV" */
  abbr: string;
  /** Full display name, e.g. "King James Version" */
  name: string;
  /** Language, e.g. "English" */
  language: string;
  /** Parsed Bible data (Book → Chapter → Verse → Text) */
  data: RawBibleData;
  /** ISO timestamp of when this was downloaded */
  downloadedAt: string;
  /** File size in bytes (from catalog) */
  filesize: number;
}

// ---------------------------------------------------------------------------
// Slide System
// ---------------------------------------------------------------------------

export interface BibleSlide {
  id: string;
  /** Rendered text for this slide (may be a portion of a passage) */
  text: string;
  /** Reference label shown on the slide, e.g. "John 3:16 (KJV)" */
  reference: string;
  /** Verse numbers contained in this slide */
  verseRange: string;
  /** Index in the queue item's slide array */
  index: number;
  /** Total slides for this queue item */
  total: number;
}

export interface SlideConfig {
  /** Max lines per slide (default 4) */
  maxLines: number;
  /** Max characters per slide (default 200) */
  maxChars: number;
  /** Show verse numbers inline */
  showVerseNumbers: boolean;
  /** Try to avoid splitting mid-sentence */
  smartSplit: boolean;
}

export const DEFAULT_SLIDE_CONFIG: SlideConfig = {
  maxLines: 4,
  maxChars: 200,
  showVerseNumbers: true,
  smartSplit: true,
};

// ---------------------------------------------------------------------------
// Queue System
// ---------------------------------------------------------------------------

export interface QueueItem {
  id: string;
  passage: BiblePassage;
  slides: BibleSlide[];
  /** Currently active slide index */
  currentSlide: number;
}

// ---------------------------------------------------------------------------
// Theme System (Theme Pack)
// ---------------------------------------------------------------------------

export type BibleThemeCategory = "bible" | "worship" | "general";

export interface BibleTheme {
  id: string;
  name: string;
  description?: string;
  /** "builtin" for shipped themes, "custom" for user-created */
  source: "builtin" | "custom";
  /** Template type this theme uses */
  templateType: BibleTemplateType;
  /** Category for filtering in the Templates Library */
  category?: BibleThemeCategory;
  /** Optional multi-category mapping for custom themes */
  categories?: BibleThemeCategory[];
  /** Theme settings */
  settings: BibleThemeSettings;
  /** Preview thumbnail data URL (optional) */
  preview?: string;
  /** Whether this theme is hidden from the theme picker modal */
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BibleTemplateType =
  | "fullscreen"
  | "lower-third"
  | "side-by-side";

/**
 * Lower-third bar size presets.
 * Controls max-height, padding, font-size scaling, and safe-area inset.
 */
export type LowerThirdSize =
  | "smallest"
  | "smaller"
  | "small"
  | "medium"
  | "big"
  | "bigger"
  | "biggest";

export type LowerThirdWidthPreset =
  | "full"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "xxl";

/**
 * Pixel values for each lower-third size preset.
 * Consumed by the overlay HTML to scale the bar.
 */
export const LOWER_THIRD_SIZE_PRESETS: Record<LowerThirdSize, {
  maxHeight: number;  // px — max bar height
  padding: number;    // px — inner padding
  fontSize: number;   // px — base font size
  refFontSize: number;// px — reference label font size
  safeArea: number;   // px — margin from screen edges
}> = {
  smallest: { maxHeight: 180, padding: 14, fontSize: 24, refFontSize: 13, safeArea: 30 },
  smaller:  { maxHeight: 240, padding: 20, fontSize: 28, refFontSize: 14, safeArea: 35 },
  small:    { maxHeight: 320, padding: 24, fontSize: 32, refFontSize: 16, safeArea: 38 },
  medium:   { maxHeight: 400, padding: 30, fontSize: 36, refFontSize: 18, safeArea: 40 },
  big:      { maxHeight: 486, padding: 36, fontSize: 42, refFontSize: 20, safeArea: 44 },
  bigger:   { maxHeight: 560, padding: 42, fontSize: 48, refFontSize: 22, safeArea: 48 },
  biggest:  { maxHeight: 650, padding: 50, fontSize: 56, refFontSize: 26, safeArea: 52 },
};

export interface BibleThemeSettings {
  // Typography
  fontFamily: string;
  fontSize: number;          // px
  fontWeight: "normal" | "bold" | "light";
  fontColor: string;         // hex
  lineHeight: number;        // ratio e.g. 1.6
  textAlign: "left" | "center" | "right";
  textShadow: string;        // CSS text-shadow value
  textOutline: boolean;
  textOutlineColor: string;
  textOutlineWidth: number;
  textTransform: "none" | "uppercase" | "lowercase" | "capitalize";

  // Reference label
  refFontSize: number;
  refFontColor: string;
  refFontWeight: "normal" | "bold" | "light";
  refPosition: "top" | "bottom";

  // Background
  backgroundColor: string;
  backgroundImage: string;   // URL or data URL
  backgroundVideo: string;   // URL or data URL
  backgroundOpacity: number; // 0–1
  /** Fullscreen readability shade overlay (drawn over BG, under text) */
  fullscreenShadeEnabled: boolean;
  fullscreenShadeColor: string;   // hex
  fullscreenShadeOpacity: number; // 0–1

  // Logo / branding
  logoUrl: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoSize: number;          // px width

  // Layout
  padding: number;           // px
  safeArea: number;          // px inset from edges
  borderRadius: number;      // px
  boxBackground: string;     // Background behind text box (for lower-third etc.)
  boxOpacity: number;        // 0–1
  boxBackgroundImage: string; // Image for lower-third box background

  /** Lower-third bar size preset — controls max-height, padding, and font scaling */
  lowerThirdSize: LowerThirdSize;
  /** Lower-third horizontal placement on the screen */
  lowerThirdPosition: "left" | "center" | "right";
  /** Optional minimum bar height in pixels (0 = auto) */
  lowerThirdHeight: number;
  /** Reduce width from both left and right edges using preset insets */
  lowerThirdWidthPreset: LowerThirdWidthPreset;
  /** Horizontal offset in pixels after width/placement are applied */
  lowerThirdOffsetX: number;

  // Animation
  animation: "none" | "fade" | "slide-up" | "slide-left" | "scale-in" | "reveal-bg-then-text";
  animationDuration: number; // ms
}

export const DEFAULT_THEME_SETTINGS: BibleThemeSettings = {
  fontFamily: '"CMG Sans", sans-serif',
  fontSize: 48,
  fontWeight: "normal",
  fontColor: "#FFFFFF",
  lineHeight: 1.6,
  textAlign: "center",
  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
  textOutline: false,
  textOutlineColor: "#000000",
  textOutlineWidth: 2,
  textTransform: "none",

  refFontSize: 24,
  refFontColor: "#cccccc",
  refFontWeight: "normal",
  refPosition: "bottom",

  backgroundColor: "#000000",
  backgroundImage: "",
  backgroundVideo: "",
  backgroundOpacity: 1,
  fullscreenShadeEnabled: true,
  fullscreenShadeColor: "#000000",
  fullscreenShadeOpacity: 0.42,

  logoUrl: "",
  logoPosition: "bottom-right",
  logoSize: 80,

  padding: 60,
  safeArea: 40,
  borderRadius: 0,
  boxBackground: "rgba(0,0,0,0.7)",
  boxOpacity: 1,
  boxBackgroundImage: "",

  lowerThirdSize: "medium",
  lowerThirdPosition: "left",
  lowerThirdHeight: 0,
  lowerThirdWidthPreset: "full",
  lowerThirdOffsetX: 0,

  animation: "fade",
  animationDuration: 400,
};

// ---------------------------------------------------------------------------
// Bible Module State
// ---------------------------------------------------------------------------

export interface BibleState {
  /** Current translation */
  translation: BibleTranslation;
  /** Search query */
  searchQuery: string;
  /** Selected passage */
  selectedPassage: BiblePassage | null;
  /** Slide configuration */
  slideConfig: SlideConfig;
  /** Queue of passages */
  queue: QueueItem[];
  /** Currently active queue item index */
  activeQueueIndex: number;
  /** Selected theme */
  activeThemeId: string;
  /** All available themes */
  themes: BibleTheme[];
  /** History of displayed passages */
  history: BiblePassage[];
  /** Favorite passages */
  favorites: BiblePassage[];
  /** Is the output currently live to OBS */
  isLive: boolean;
  /** Is the screen blanked */
  isBlanked: boolean;
  /** UI colour mode */
  colorMode: "dark" | "light" | "system";
  /** Auto-send verse on double-click */
  autoSendOnDoubleClick: boolean;
  /** Reduce motion / animations */
  reduceMotion: boolean;
  /** High-contrast borders and text */
  highContrast: boolean;
}

export const BIBLE_BOOKS = [
  // Old Testament
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
  "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
  "Zephaniah", "Haggai", "Zechariah", "Malachi",
  // New Testament
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
  "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
] as const;

export type BibleBookName = (typeof BIBLE_BOOKS)[number];

export const BOOK_ABBREVS: Record<string, string[]> = {
  Genesis: ["Gen", "Ge", "Gn"],
  Exodus: ["Exod", "Ex", "Exo"],
  Leviticus: ["Lev", "Le", "Lv"],
  Numbers: ["Num", "Nu", "Nm", "Nb"],
  Deuteronomy: ["Deut", "Dt"],
  Joshua: ["Josh", "Jos", "Jsh"],
  Judges: ["Judg", "Jdg", "Jg", "Jdgs"],
  Ruth: ["Rth", "Ru"],
  "1 Samuel": ["1Sam", "1 Sam", "1S", "I Sam"],
  "2 Samuel": ["2Sam", "2 Sam", "2S", "II Sam"],
  "1 Kings": ["1Kgs", "1 Kgs", "1Ki", "I Kgs"],
  "2 Kings": ["2Kgs", "2 Kgs", "2Ki", "II Kgs"],
  "1 Chronicles": ["1Chr", "1 Chr", "I Chr"],
  "2 Chronicles": ["2Chr", "2 Chr", "II Chr"],
  Ezra: ["Ezr"],
  Nehemiah: ["Neh", "Ne"],
  Esther: ["Est", "Esth"],
  Job: ["Jb"],
  Psalms: ["Ps", "Psa", "Psm", "Pss", "Psalm"],
  Proverbs: ["Prov", "Pro", "Prv"],
  Ecclesiastes: ["Eccl", "Ecc", "Ec", "Qoh"],
  "Song of Solomon": ["Song", "SOS", "Sg", "Cant"],
  Isaiah: ["Isa", "Is"],
  Jeremiah: ["Jer", "Je", "Jr"],
  Lamentations: ["Lam", "La"],
  Ezekiel: ["Ezek", "Eze", "Ezk"],
  Daniel: ["Dan", "Da", "Dn"],
  Hosea: ["Hos", "Ho"],
  Joel: ["Joe", "Jl"],
  Amos: ["Am"],
  Obadiah: ["Obad", "Ob"],
  Jonah: ["Jon", "Jnh"],
  Micah: ["Mic", "Mc"],
  Nahum: ["Nah", "Na"],
  Habakkuk: ["Hab", "Hb"],
  Zephaniah: ["Zeph", "Zep", "Zp"],
  Haggai: ["Hag", "Hg"],
  Zechariah: ["Zech", "Zec", "Zc"],
  Malachi: ["Mal", "Ml"],
  Matthew: ["Matt", "Mt"],
  Mark: ["Mrk", "Mk", "Mr"],
  Luke: ["Luk", "Lk"],
  John: ["Jn", "Jhn"],
  Acts: ["Act", "Ac"],
  Romans: ["Rom", "Ro", "Rm"],
  "1 Corinthians": ["1Cor", "1 Cor", "I Cor"],
  "2 Corinthians": ["2Cor", "2 Cor", "II Cor"],
  Galatians: ["Gal", "Ga"],
  Ephesians: ["Eph", "Ephes"],
  Philippians: ["Phil", "Php", "Pp"],
  Colossians: ["Col"],
  "1 Thessalonians": ["1Thess", "1 Thess", "I Thess"],
  "2 Thessalonians": ["2Thess", "2 Thess", "II Thess"],
  "1 Timothy": ["1Tim", "1 Tim", "I Tim"],
  "2 Timothy": ["2Tim", "2 Tim", "II Tim"],
  Titus: ["Tit", "Ti"],
  Philemon: ["Phlm", "Phm"],
  Hebrews: ["Heb"],
  James: ["Jas", "Jm"],
  "1 Peter": ["1Pet", "1 Pet", "I Pet"],
  "2 Peter": ["2Pet", "2 Pet", "II Pet"],
  "1 John": ["1Jn", "1 Jn", "I Jn"],
  "2 John": ["2Jn", "2 Jn", "II Jn"],
  "3 John": ["3Jn", "3 Jn", "III Jn"],
  Jude: ["Jud", "Jd"],
  Revelation: ["Rev", "Re"],
};
