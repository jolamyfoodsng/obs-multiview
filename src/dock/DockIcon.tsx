import type { CSSProperties } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AppWindow,
  ArrowLeft,
  BadgeAlert,
  BookOpenText,
  CalendarDays,
  Cast,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Church,
  ClipboardList,
  Circle,
  Clapperboard,
  Eraser,
  EyeOff,
  File,
  FilePenLine,
  FileText,
  Film,
  Gamepad2,
  Globe,
  Headphones,
  History,
  Image,
  Images,
  Languages,
  Link,
  ListPlus,
  Maximize,
  Megaphone,
  Mic,
  MicVocal,
  Monitor,
  MoonStar,
  Music2,
  Music4,
  Paintbrush,
  Pencil,
  Play,
  Plus,
  Quote,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Star,
  SunMedium,
  Type,
  Tv,
  User,
  UserCog,
  UserRoundX,
  Video,
  X,
  AlertTriangle,
  Layers3,
} from "lucide-react";

interface Props {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

type IconDef = {
  component: LucideIcon;
  fill?: boolean;
  strokeWidth?: number;
};

const ICONS: Record<string, IconDef> = {
  add: { component: Plus },
  arrow_back: { component: ArrowLeft },
  assignment: { component: FileText },
  audiotrack: { component: Music4 },
  auto_stories: { component: Languages },
  campaign: { component: Megaphone },
  cast: { component: Cast },
  check: { component: Check },
  check_circle: { component: CheckCircle2 },
  chevron_right: { component: ChevronRight },
  expand_more: { component: ChevronDown },
  church: { component: Church },
  clear: { component: Eraser },
  close: { component: X },
  delete_outline: { component: X },
  desktop_windows: { component: AppWindow },
  edit: { component: Pencil },
  edit_note: { component: SquarePen },
  error: { component: BadgeAlert },
  event: { component: CalendarDays },
  fiber_manual_record: { component: Circle, fill: true, strokeWidth: 0 },
  format_quote: { component: Quote },
  fullscreen: { component: Maximize },
  headphones: { component: Headphones },
  history: { component: History },
  image: { component: Image },
  insert_drive_file: { component: File },
  language: { component: Globe },
  layers: { component: Layers3 },
  link: { component: Link },
  live_tv: { component: Tv },
  lyrics: { component: Music2 },
  mic: { component: Mic },
  monitor: { component: Monitor },
  movie: { component: Film },
  moon: { component: MoonStar },
  menu_book: { component: BookOpenText },
  music_note: { component: Music2 },
  music_off: { component: Music4 },
  palette: { component: Paintbrush },
  person: { component: User },
  person_add: { component: UserCog },
  person_off: { component: UserRoundX },
  photo_library: { component: Images },
  play_arrow: { component: Play },
  play_circle: { component: Clapperboard },
  playlist_add: { component: ListPlus },
  preview: { component: Sparkles },
  checklist: { component: ClipboardList },
  radio_button_unchecked: { component: Circle },
  record_voice_over: { component: MicVocal },
  refresh: { component: RefreshCcw },
  replay: { component: RefreshCcw },
  search: { component: Search },
  self_improvement: { component: Sparkles },
  settings: { component: Settings },
  sports_esports: { component: Gamepad2 },
  star: { component: Star, fill: true, strokeWidth: 1.8 },
  star_border: { component: Star },
  subtitles: { component: FilePenLine },
  sync: { component: RefreshCcw },
  sun: { component: SunMedium },
  text_fields: { component: Type },
  travel_explore: { component: Globe },
  videocam: { component: Video },
  visibility_off: { component: EyeOff },
  warning: { component: AlertTriangle },
  widgets: { component: Sparkles },
};

export default function DockIcon({ name, size = 16, className, style }: Props) {
  const def = ICONS[name] ?? ICONS.widgets;
  const Component = def.component;
  const iconProps: LucideProps = {
    size,
    className,
    style,
    strokeWidth: def.strokeWidth ?? 2,
  };

  if (def.fill) {
    iconProps.fill = "currentColor";
  }

  return <Component {...iconProps} />;
}
