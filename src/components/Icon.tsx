/**
 * Icon.tsx — Bundled icon component (replaces Material Icons CDN)
 *
 * Maps material icon names to lucide-react SVG components.
 * Renders instantly — no font download, no text flash.
 *
 * Usage:
 *   <Icon name="search" size={18} />
 *   <Icon name="close" className="my-class" />
 */

import React, { type CSSProperties } from "react";
import {
  Accessibility,
  AlertCircle,
  AlertTriangle,
  AlignCenter,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Archive,
  AtSign,
  Ban,
  Bell,
  Bolt,
  Bookmark,
  BookOpen,
  Brush,
  Calendar,
  Camera,
  CameraOff,
  Cast,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Church,
  Circle,
  CircleMinus,
  CirclePlus,
  CircleX,
  Clipboard,
  Clock,
  CloudUpload,
  Code,
  Copy,
  Crosshair,
  Database,
  Delete,
  Download,
  DownloadCloud,
  Eye,
  EyeOff,
  Film,
  Filter,
  Gauge,
  Globe,
  GripHorizontal,
  GripVertical,
  Grid2X2,
  Grid3X3,
  HeartHandshake,
  HelpCircle,
  History,
  Hourglass,
  Image,
  ImageMinus,
  ImagePlus,
  Infinity,
  Info,
  Keyboard,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  LayoutPanelLeft,
  LayoutPanelTop,
  LayoutTemplate,
  Link,
  Link2Off,
  ListMusic,
  ListVideo,
  Lock,
  LockOpen,
  MapPin,
  Maximize,
  Megaphone,
  Merge,
  Mic,
  MicOff,
  Minus,
  Monitor,
  MonitorOff,
  MonitorPlay,
  MonitorSmartphone,
  MoreVertical,
  MoveDown,
  Music,
  Palette,
  PanelBottom,
  PanelBottomClose,
  Pause,
  Pencil,
  Pin,
  Play,
  PlayCircle,
  Plus,
  PlusSquare,
  Podcast,
  Power,
  PowerOff,
  Presentation,
  Quote,
  Radio,
  Redo,
  RefreshCw,
  Rocket,
  RotateCcw,
  Ruler,
  Save,
  Scan,
  Search,
  SearchX,
  CheckSquare,
  Send,
  Settings,
  Shield,
  Shrink,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  SplitSquareVertical,
  Square,
  Star,
  StarOff,
  StopCircle,
  Subtitles,
  SunMedium,
  SwitchCamera,
  Trash2,
  Tv,
  Tv2,
  Type,
  Undo,
  Upload,
  UploadCloud,
  User,
  UserMinus,
  UserPlus,
  Video,
  VolumeX,
  Wallpaper,
  Wand2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

/**
 * Map of material icon name → lucide-react component.
 * Covers all icons used in the codebase.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  /* Navigation / Actions */
  arrow_back: ArrowLeft,
  arrow_back_ios: ArrowLeft,
  arrow_forward: ArrowRight,
  arrow_forward_ios: ArrowRight,
  arrow_upward: ArrowUp,
  arrow_downward: ArrowDown,
  arrow_drop_down: ChevronDown,
  arrow_drop_up: ChevronUp,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  expand_more: ChevronDown,
  expand_less: ChevronUp,
  close: X,
  clear: X,
  check: Check,
  check_circle: CheckCircle2,
  cancel: CircleX,

  /* CRUD */
  add: Plus,
  add_box: PlusSquare,
  add_circle: CirclePlus,
  add_circle_outline: CirclePlus,
  add_photo_alternate: ImagePlus,
  edit: Pencil,
  edit_note: Pencil,
  delete: Delete,
  delete_outline: Delete,
  delete_forever: Trash2,
  delete_sweep: Trash2,
  archive: Archive,
  remove: Minus,
  save: Save,
  refresh: RefreshCw,
  replay: RotateCcw,
  restart_alt: RotateCcw,
  sync: RefreshCw,
  undo: Undo,
  redo: Redo,

  /* Search & Filter */
  search: Search,
  search_off: SearchX,
  filter_list: Filter,
  sort: Filter,

  /* View / Layout */
  apps: LayoutGrid,
  grid_view: Grid2X2,
  grid_on: Grid3X3,
  dashboard: LayoutDashboard,
  space_dashboard: LayoutDashboard,
  view_sidebar: LayoutPanelLeft,
  view_column: LayoutPanelLeft,
  view_week: LayoutGrid,
  view_carousel: LayoutPanelTop,
  view_quilt: LayoutTemplate,
  auto_awesome_mosaic: LayoutTemplate,
  call_to_action: PanelBottom,
  branding_watermark: PanelBottomClose,
  picture_in_picture: Shrink,
  fullscreen: Maximize,
  vertical_split: SplitSquareVertical,
  splitscreen: SplitSquareVertical,
  crop_free: Scan,
  aspect_ratio: Maximize,
  select_all: CheckSquare,
  open_with: GripHorizontal,
  north_west: ArrowUpLeft,
  north_east: ArrowUpRight,
  south_west: ArrowDownLeft,
  south_east: ArrowDownRight,
  dock: PanelBottom,
  widgets: LayoutGrid,
  viewport: Monitor,

  /* Alignment */
  align_horizontal_left: AlignStartHorizontal,
  align_horizontal_center: AlignCenterHorizontal,
  align_horizontal_right: AlignEndHorizontal,
  align_vertical_top: AlignStartVertical,
  align_vertical_center: AlignCenterVertical,
  align_vertical_bottom: AlignEndVertical,
  horizontal_distribute: GripHorizontal,
  vertical_distribute: GripVertical,
  straighten: Ruler,
  space_bar: Ruler,

  /* Text alignment */
  format_align_left: AlignLeft,
  format_align_center: AlignCenter,
  format_align_right: AlignRight,

  /* Media */
  play_arrow: Play,
  play_circle: PlayCircle,
  play_circle_outline: PlayCircle,
  pause: Pause,
  stop: StopCircle,
  stop_circle: StopCircle,
  skip_next: SkipForward,
  skip_previous: SkipBack,
  videocam: Camera,
  videocam_off: CameraOff,
  cameraswitch: SwitchCamera,
  switch_video: SwitchCamera,
  video_library: Video,
  image: Image,
  image_not_supported: ImageMinus,
  no_photography: ImageMinus,
  perm_media: ImagePlus,
  photo_library: Image,
  wallpaper: Wallpaper,
  music_note: Music,
  music_off: MicOff,
  lyrics: ListMusic,
  library_music: ListMusic,
  film: Film,
  movie: Film,
  slideshow: Presentation,
  animation: Sparkles,
  speed: Gauge,

  /* Monitor / Preview */
  monitor: Monitor,
  monitor_heart: MonitorSmartphone,
  desktop_access_disabled: MonitorOff,
  tv: Tv,
  tv_off: MonitorOff,
  live_tv: Tv2,
  preview: MonitorPlay,
  cast: Cast,
  cast_connected: Cast,
  visibility: Eye,
  visibility_off: EyeOff,
  cancel_presentation: Presentation,
  pause_presentation: Pause,

  /* People */
  person: User,
  person_add: UserPlus,
  person_off: UserMinus,
  accessibility_new: Accessibility,
  volunteer_activism: HeartHandshake,

  /* Content / Features */
  auto_stories: BookOpen,
  menu_book: BookOpen,
  library_books: BookOpen,
  church: Church,
  palette: Palette,
  style: Palette,
  brush: Brush,
  mic: Mic,
  mic_off: MicOff,
  campaign: Megaphone,
  subtitles: Subtitles,
  format_quote: Quote,
  chat_bubble_outline: Quote,
  title: Type,
  text_fields: Type,
  short_text: Type,
  code: Code,
  auto_awesome: Sparkles,
  auto_fix_high: Wand2,
  explore: Globe,
  place: MapPin,
  translate: Globe,
  touch_app: Crosshair,
  receipt_long: Clipboard,
  rocket_launch: Rocket,

  /* Status */
  error: AlertCircle,
  error_outline: AlertCircle,
  warning: AlertTriangle,
  emergency: AlertTriangle,
  info: Info,
  help_outline: HelpCircle,
  fiber_manual_record: Circle,
  verified: CheckCircle2,
  block: Ban,
  shield: Shield,

  /* Tools / Settings */
  settings: Settings,
  settings_input_antenna: Radio,
  tune: SlidersHorizontal,
  build: Wand2,
  keyboard: Keyboard,
  equalizer: SlidersHorizontal,
  graphic_eq: SlidersHorizontal,
  install_desktop: Download,

  /* Files */
  content_copy: Copy,
  cloud_upload: CloudUpload,
  upload: Upload,
  upload_file: UploadCloud,
  download: Download,
  download_done: DownloadCloud,
  link: Link,
  link_off: Link2Off,
  assignment: Clipboard,

  /* UI elements */
  star: Star,
  star_border: StarOff,
  bookmark: Bookmark,
  more_vert: MoreVertical,
  drag_indicator: GripVertical,
  push_pin: Pin,
  lock: Lock,
  lock_open: LockOpen,
  move_down: MoveDown,
  notifications: Bell,
  volume_off: VolumeX,

  /* Misc */
  playlist_add: Plus,
  playlist_play: ListVideo,
  playlist_remove: CircleMinus,
  merge_type: Merge,
  event: Calendar,
  schedule: Clock,
  timer: Clock,
  history: History,
  hourglass_empty: Hourglass,
  hourglass_top: Hourglass,
  power_settings_new: Power,
  power_off: PowerOff,
  publish: Upload,
  send: Send,
  bolt: Bolt,
  layers: Layers,
  queue: LayoutList,
  storage: Database,

  /* Communication */
  alternate_email: AtSign,
  cell_tower: Radio,
  broadcast_on_personal: Radio,
  podcasts: Podcast,
  wifi: Wifi,
  wifi_tethering: WifiOff,

  /* Specialised */
  filter_none: Square,
  swap_horiz: RefreshCw,
  swap_calls: RefreshCw,
  all_inclusive: Infinity,
  light_mode: SunMedium,
  dark_mode: SunMedium,
  brightness_4: SunMedium,
  brightness_6: SunMedium,
  text_rotation_none: Type,
  check_box: CheckSquare,
  check_box_outline_blank: Square,
  system_update_alt: Download,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Material icon name (ligature) e.g. "search", "close", "star" */
  name: string;
  /** Icon size in px (default 20) */
  size?: number;
  /** Extra CSS class names */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
}

/**
 * Drop-in replacement for `<Icon name="name" size={20} />`.
 * Renders a bundled SVG instantly — no font download needed.
 */
export default function Icon({ name, size = 20, className, style, ...rest }: IconProps) {
  const LucideComponent = ICON_MAP[name];

  if (!LucideComponent) {
    // Fallback: render the name as text (same as broken material icon)
    return (
      <span
        className={className}
        style={{ fontSize: size, display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}
        {...(rest as React.HTMLAttributes<HTMLSpanElement>)}
      >
        {name}
      </span>
    );
  }

  return (
    <LucideComponent
      size={size}
      className={className}
      style={style}
      strokeWidth={2}
      {...rest}
    />
  );
}
