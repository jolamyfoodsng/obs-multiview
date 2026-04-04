import type { BiblePassage } from "../../bible/types";
import type { VoiceBibleInputOption } from "../../services/voiceBibleTypes";
import type { VoiceBibleStatus } from "../../services/voiceBibleTypes";

export interface TranslationOption {
  value: string;
  label: string;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  highlight?: string;
  tone: "muted" | "active" | "stable";
}

export interface VerseMatchViewModel {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  reference: string;
  translation: string;
  excerpt: string;
  confidence: number;
  rankLabel?: string;
  emphasis: "primary" | "secondary" | "tertiary";
}

export interface SessionHistoryItem {
  id: string;
  reference: string;
  translation: string;
  timestamp: number;
  passage: BiblePassage;
}

export interface SpeechHeaderProps {
  status: VoiceBibleStatus;
  statusLabel: string;
  sessionLabel?: string;
  translation: string;
  translations: TranslationOption[];
  onTranslationChange: (value: string) => void;
}

export interface TranscriptionControlPanelProps {
  status: VoiceBibleStatus;
  sourceLabel: string;
  detail?: string;
  modelReady: boolean;
  sessionLabel?: string;
  onPrimaryAction: () => void;
}

export interface LiveTranscriptFeedProps {
  status: VoiceBibleStatus;
  detail?: string;
  segments: TranscriptSegment[];
}

export interface SpeechInputTranscriptPanelProps {
  status: VoiceBibleStatus;
  audioLevel: number;
  sourceLabel: string;
  detail?: string;
  modelReady: boolean;
  sessionLabel?: string;
  onPrimaryAction: () => void;
  segments: TranscriptSegment[];
  inputOptions: VoiceBibleInputOption[];
  selectedInputId?: string;
  onSelectInput: (deviceId?: string) => void | Promise<void>;
  inputPickerDisabled?: boolean;
}

export interface PreviewPanelProps {
  livePassage: BiblePassage | null;
  selectedMatch: VerseMatchViewModel | null;
  queueCount: number;
  onPresent: () => void;
  onQueue: () => void;
  actionDisabled: boolean;
}

export interface VerseMatchesPanelProps {
  matches: VerseMatchViewModel[];
  selectedId: string | null;
  detail?: string;
  matching?: boolean;
  onPreview: (match: VerseMatchViewModel) => void;
  onPresent: (match: VerseMatchViewModel) => void;
  onQueue: (match: VerseMatchViewModel) => void;
  onClear: () => void;
}

export interface VerseMatchCardProps {
  match: VerseMatchViewModel;
  selected: boolean;
  onPreview: () => void;
  onPresent: () => void;
  onQueue: () => void;
}

export interface RecentHistoryPanelProps {
  items: SessionHistoryItem[];
  onReplay: (item: SessionHistoryItem) => void;
}
