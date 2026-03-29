export type LTCategory = 'bible' | 'worship' | 'speaker' | 'generic' | 'social' | 'giving' | 'countdown';

export interface LTVariable {
  key: string;
  label: string;
  type: 'text' | 'image' | 'color' | 'number';
  defaultValue: string | number;
  placeholder?: string;
  required?: boolean;
  group?: string;
}

export interface LTAnimation {
  name: string;
  duration: number;
  easing: string;
}

export interface LowerThirdTheme {
  id: string;
  name: string;
  description: string;
  category: LTCategory;
  icon: string;
  html: string;
  css: string;
  variables: LTVariable[];
  animation?: LTAnimation;
  accentColor: string;
  tags: string[];
  usesTailwind: boolean;
  fontImports?: string[];
}

export const SHARED_CSS = `
/* Animations */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ticker {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
@keyframes bounceIn {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.05); opacity: 1; }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
@keyframes sheen {
  0% { transform: translateX(-100%) skewX(-15deg); }
  100% { transform: translateX(200%) skewX(-15deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes bounce {
  0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0,0,0.2,1); }
}

.animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
.animate-ticker { animation: ticker 20s linear infinite; }
.animate-bounce-in { animation: bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
.animate-sheen { animation: sheen 3s infinite; }
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.animate-ping { animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
.animate-spin { animation: spin 1s linear infinite; }
.animate-bounce { animation: bounce 1s infinite; }

/* Clip paths */
.torn-edge {
  clip-path: polygon(0% 0%, 5% 5%, 10% 0%, 15% 5%, 20% 0%, 25% 5%, 30% 0%, 35% 5%, 40% 0%, 45% 5%, 50% 0%, 55% 5%, 60% 0%, 65% 5%, 70% 0%, 75% 5%, 80% 0%, 85% 5%, 90% 0%, 95% 5%, 100% 0%, 100% 100%, 0% 100%);
}

/* Base */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: transparent; overflow: hidden; }
`;

export const GOOGLE_FONTS = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Work+Sans:wght@300;400;500;600;700;900&display=swap",
  "https://fonts.googleapis.com/icon?family=Material+Icons",
];

export const lt01ScriptureBold: LowerThirdTheme = {
  id: "lt-01-scripture-bold",
  name: "Scripture Banner: The Word",
  description: "Bold serif typography on textured red bar.",
  category: "bible",
  icon: "menu_book",
  accentColor: "#a31621",
  tags: ["Scripture", "Red", "Bold"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "label", label: "Tag Label", type: "text", defaultValue: "The Word", placeholder: "e.g. The Word", group: "Header" },
    { key: "mainText", label: "Main Text", type: "text", defaultValue: "JOHN 3:16", placeholder: "e.g. JOHN 3:16", required: true, group: "Content" },
    { key: "subText", label: "Sub Text", type: "text", defaultValue: "For God So Loved The World", placeholder: "e.g. For God So Loved The World", required: true, group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="w-full max-w-4xl mx-auto group animate-fade-in-up" style="position:fixed;bottom:10%;left:50%;transform:translateX(-50%);">
    <div class="relative w-full h-24 bg-[#a31621] flex items-center px-8 shadow-2xl overflow-hidden rounded-sm border-l-8 border-white">
      <div class="absolute inset-0 bg-black/10 mix-blend-multiply"></div>
      <div class="flex items-center gap-6 relative z-10">
        <div class="bg-white text-[#a31621] px-3 py-1 text-xs font-black tracking-widest uppercase rounded-sm shadow-md rotate-[-2deg]">
          {{label}}
        </div>
        <div class="h-12 w-px bg-white/30"></div>
        <div class="flex flex-col justify-center">
          <h3 class="text-white font-serif text-3xl font-bold tracking-wide leading-none" style="font-family: 'Work Sans', sans-serif;">{{mainText}}</h3>
          <p class="text-white/80 text-sm font-medium uppercase tracking-widest mt-1">{{subText}}</p>
        </div>
      </div>
      <div class="absolute top-0 -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent to-white opacity-20 animate-sheen"></div>
    </div>
  </div>`,
};

export const lt02SpeakerGeometric: LowerThirdTheme = {
  id: "lt-02-speaker-geometric",
  name: "Speaker Plate: Geometric",
  description: "Cyan/Yellow layered card with circular photo.",
  category: "speaker",
  icon: "person",
  accentColor: "#06b6d4",
  tags: ["Speaker ID", "Modern", "Geometric"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "name", label: "Speaker Name", type: "text", defaultValue: "Pastor John Doe", placeholder: "e.g. Pastor John Doe", required: true, group: "Content" },
    { key: "title", label: "Title", type: "text", defaultValue: "Senior Pastor", placeholder: "e.g. Senior Pastor", group: "Content" },
    { key: "image", label: "Speaker Image", type: "image", defaultValue: "https://lh3.googleusercontent.com/aida-public/AB6AXuBr8ZfupKjJzop_yM6_xlZblZeWuCu6oIz9rbW8bVD6Jfbs7-Ni6lMgqA24zPLotO4QVM4KsT024Wbxgos9cugIHgXVQcTDOUfoKGZdWx_SQxKLbIdERUmH6wKXzTTW54LaaK9Pe-OOIxBCx5bBs3AIW0i1gbG-mN1a9r91ZFBpMcK8agHz5Z-aUfxFBec-B7qlg8WPVuDSV816udEfzMPofgdT-Bjt74JaePtYpwgUAxPTL9YBlNkNASdqrmJQ5y5dr15HRH_xcg", group: "Content" }
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="w-full max-w-2xl animate-fade-in-up" style="position:fixed;bottom:10%;left:5%;transform:none;">
    <div class="flex items-center gap-4">
      <div class="relative w-24 h-24 rounded-full border-4 border-[#06b6d4] bg-slate-800 overflow-hidden shadow-lg z-20">
        <img src="{{image}}" alt="Speaker" class="w-full h-full object-cover" />
      </div>
      <div class="relative -ml-8 pl-10 pr-6 py-3 bg-white skew-x-[-10deg] shadow-lg border-l-8 border-[#facc15]">
        <div class="skew-x-[10deg]">
          <h3 class="text-slate-900 text-xl font-black uppercase tracking-tight" style="font-family: 'Work Sans', sans-serif;">{{name}}</h3>
          <p class="text-[#06b6d4] text-xs font-bold uppercase tracking-widest">{{title}}</p>
        </div>
      </div>
    </div>
  </div>`,
};

export const lt03FaithDeclaration: LowerThirdTheme = {
  id: "lt-03-faith-declaration",
  name: "Faith Declaration: Royal",
  description: "Massive typography with purple glow gradient.",
  category: "generic",
  icon: "campaign",
  accentColor: "#7f13ec",
  tags: ["Declaration", "Glow", "Purple"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "text", label: "Declaration Text", type: "text", defaultValue: "I Am Victorious", placeholder: "e.g. I Am Victorious", required: true, group: "Content" },
  ],
  animation: { name: "bounceIn", duration: 500, easing: "cubic-bezier(0.175, 0.885, 0.32, 1.275)" },
  css: SHARED_CSS,
  html: `<div class="w-full mx-auto animate-bounce-in" style="position:fixed;bottom:15%;left:0;right:0;display:flex;justify-content:center;padding:0 2rem;">
    <div class="relative w-full max-w-3xl py-4 bg-gradient-to-r from-[#7f13ec]/80 via-purple-600/90 to-[#7f13ec]/80 backdrop-blur-md border-y border-white/20 shadow-[0_0_30px_rgba(127,19,236,0.6)] flex flex-col items-center justify-center text-center">
      <h2 class="text-white text-4xl md:text-5xl font-black uppercase tracking-tighter drop-shadow-lg" style="text-shadow: 0 4px 10px rgba(0,0,0,0.5); font-family: 'Work Sans', sans-serif;">{{text}}</h2>
      <div class="w-24 h-1 bg-white mt-2 shadow-[0_0_10px_white]"></div>
    </div>
  </div>`,
};

export const lt04GuestMinister: LowerThirdTheme = {
  id: "lt-04-guest-minister",
  name: "Guest Minister: Glassmorphic",
  description: "Sleek glass card with gold accent and logo slot.",
  category: "speaker",
  icon: "person_outline",
  accentColor: "#eab308",
  tags: ["Guest", "Glass", "Gold"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "name", label: "Minister Name", type: "text", defaultValue: "Bishop T.D. Jakes", placeholder: "e.g. Bishop T.D. Jakes", required: true, group: "Content" },
    { key: "church", label: "Church/Org", type: "text", defaultValue: "The Potter's House, Dallas", placeholder: "e.g. The Potter's House", group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="w-full mx-auto animate-fade-in-up" style="position:fixed;bottom:10%;right:5%;display:flex;justify-content:flex-end;">
    <div class="relative pl-6 pr-4 py-3 bg-white/10 backdrop-blur-xl border border-white/20 border-r-4 border-r-[#eab308] rounded-l-xl shadow-xl flex items-center gap-4 max-w-lg">
      <div class="flex flex-col text-right">
        <h3 class="text-white text-lg font-bold" style="font-family: 'Work Sans', sans-serif;">{{name}}</h3>
        <p class="text-white/70 text-xs font-medium uppercase tracking-wide">{{church}}</p>
      </div>
      <div class="h-10 w-px bg-white/20"></div>
      <div class="w-10 h-10 bg-white rounded-full flex items-center justify-center shrink-0">
        <span class="material-icons text-slate-900">church</span>
      </div>
    </div>
  </div>`,
};

export const lt05WorshipPulse: LowerThirdTheme = {
  id: "lt-05-worship-pulse",
  name: "Worship Lyric: Pulse",
  description: "Low-profile translucent bar with teal pulse.",
  category: "worship",
  icon: "music_note",
  accentColor: "#2dd4bf",
  tags: ["Worship", "Minimal", "Teal"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "lyrics", label: "Lyrics", type: "text", defaultValue: "Way Maker, Miracle Worker", placeholder: "e.g. Way Maker, Miracle Worker", required: true, group: "Content" },
    { key: "songInfo", label: "Song Info", type: "text", defaultValue: "Sinach - Way Maker", placeholder: "e.g. Sinach - Way Maker", group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="w-full mx-auto animate-fade-in-up" style="position:fixed;bottom:10%;left:0;right:0;display:flex;justify-content:center;">
    <div class="relative w-full max-w-2xl text-center">
      <div class="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center justify-center">
        <div class="w-2 h-2 bg-[#2dd4bf] rounded-full animate-ping absolute"></div>
        <div class="w-2 h-2 bg-[#2dd4bf] rounded-full relative"></div>
      </div>
      <div class="bg-black/40 backdrop-blur-md border border-white/10 rounded-full py-3 px-8 shadow-lg">
        <h3 class="text-white text-xl md:text-2xl font-medium tracking-wide" style="font-family: 'Work Sans', sans-serif;">{{lyrics}}</h3>
      </div>
      <p class="text-white/60 text-xs font-medium mt-2 uppercase tracking-widest">{{songInfo}}</p>
    </div>
  </div>`,
};

export const lt06NewsTicker: LowerThirdTheme = {
  id: "lt-06-news-ticker",
  name: "News Ticker",
  description: "Continuous scroll for announcements.",
  category: "generic",
  icon: "view_stream",
  accentColor: "#f20d0d",
  tags: ["Ticker", "News", "Red"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "label", label: "Label", type: "text", defaultValue: "Announcements", placeholder: "e.g. Announcements", group: "Header" },
    { key: "tickerText", label: "Ticker Text", type: "text", defaultValue: "WELCOME TO SUNDAY SERVICE — WE ARE GLAD YOU ARE HERE. • JOIN US FOR COFFEE IN THE LOBBY AFTER THE STREAM. • NEXT WEEK: SPECIAL GUEST SPEAKER DR. JAMES WILSON.", placeholder: "Enter scrolling text...", required: true, group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="w-full animate-fade-in-up" style="position:fixed;bottom:0;left:0;right:0;">
    <div class="w-full h-12 bg-[#f20d0d] flex items-center shadow-[0_-4px_20px_rgba(242,13,13,0.3)]">
      <div class="bg-black/20 h-full px-6 flex items-center justify-center shrink-0 z-40 relative">
        <span class="text-white font-black uppercase tracking-widest text-sm flex items-center gap-2" style="font-family: 'Inter', sans-serif;">
          <span class="material-icons text-[18px]">campaign</span>
          {{label}}
        </span>
        <div class="absolute right-[-12px] top-0 h-full w-6 bg-[#f20d0d] skew-x-[-20deg]"></div>
      </div>
      <div class="flex-1 overflow-hidden relative h-full flex items-center pl-4">
        <div class="w-full overflow-hidden whitespace-nowrap">
          <div class="inline-block whitespace-nowrap animate-ticker">
            <span class="text-white font-bold text-sm tracking-wide px-4" style="font-family: 'Inter', sans-serif;">{{tickerText}}</span>
            <span class="text-white font-bold text-sm tracking-wide px-4" style="font-family: 'Inter', sans-serif;">{{tickerText}}</span>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};

export const lt07SermonPoint: LowerThirdTheme = {
  id: "lt-07-sermon-point",
  name: "Sermon Point",
  description: "Floating card for key sermon points.",
  category: "generic",
  icon: "format_list_numbered",
  accentColor: "#f20d0d",
  tags: ["Sermon", "Point", "Red"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "pointLabel", label: "Point Label", type: "text", defaultValue: "Point 01", placeholder: "e.g. Point 01", group: "Header" },
    { key: "title", label: "Title", type: "text", defaultValue: "The Cost of Discipleship", placeholder: "e.g. The Cost of Discipleship", required: true, group: "Content" },
    { key: "description", label: "Description", type: "text", defaultValue: "\"Deny yourself, take up your cross daily, and follow me.\"", placeholder: "e.g. Quote or scripture", group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="max-w-md animate-fade-in-up" style="position:fixed;bottom:6rem;left:2rem;">
    <div class="bg-[#2d2d2d] border-l-4 border-[#f20d0d] shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-r-lg p-6 flex flex-col gap-2">
      <span class="text-[#f20d0d] font-black text-sm tracking-[0.2em] uppercase" style="font-family: 'Inter', sans-serif;">{{pointLabel}}</span>
      <h3 class="text-white text-3xl font-extrabold leading-none tracking-tight" style="font-family: 'Inter', sans-serif;">{{title}}</h3>
      <p class="text-slate-400 text-sm mt-1 leading-snug" style="font-family: 'Inter', sans-serif;">{{description}}</p>
    </div>
  </div>`,
};

export const lt08GivingCard: LowerThirdTheme = {
  id: "lt-08-giving-card",
  name: "Giving Card",
  description: "Floating card with QR code for giving.",
  category: "giving",
  icon: "qr_code_2",
  accentColor: "#ffffff",
  tags: ["Giving", "QR", "Dark"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "title", label: "Title", type: "text", defaultValue: "Ways to Give", placeholder: "e.g. Ways to Give", required: true, group: "Header" },
    { key: "subtitle", label: "Subtitle", type: "text", defaultValue: "Scan to give securely online", placeholder: "e.g. Scan to give securely online", group: "Header" },
    { key: "bankLabel", label: "Bank Label", type: "text", defaultValue: "Bank", placeholder: "e.g. Bank", group: "Details" },
    { key: "bankValue", label: "Bank Name", type: "text", defaultValue: "First National", placeholder: "e.g. First National", group: "Details" },
    { key: "accLabel", label: "Account Label", type: "text", defaultValue: "Acc", placeholder: "e.g. Acc", group: "Details" },
    { key: "accValue", label: "Account Number", type: "text", defaultValue: "12-3456-78", placeholder: "e.g. 12-3456-78", group: "Details" },
    { key: "qrCodeUrl", label: "QR Code URL", type: "image", defaultValue: "https://lh3.googleusercontent.com/aida-public/AB6AXuAOiYE-LZBHUgpco1M1lSTo3bjnBqPhJo38-esuvVvyOyH7krn4axvxbgitsxvHLxbw4gHizl2M6K_RNjrx_fNnveQWf3b7r9jhVeU77xRk6IaPbyE9PkX1h8mDf6v2hSb2Np11yQleB11_QzpLawt4H_aPshLe7G8VnZEoYxUR6ybqTp5rY_AsCTBe-GyF9DTmyBb6Nz26N-Ow4mab_eVogbuUJiy03l0WkT6ssb_RaBbiMv84EAMq9cf8-Wxfs3DvF0bamCdOrw", group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="max-w-sm w-full animate-fade-in-up" style="position:fixed;bottom:6rem;right:2rem;">
    <div class="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 rounded-xl p-0 overflow-hidden shadow-2xl flex">
      <div class="bg-white p-4 flex items-center justify-center shrink-0 w-32">
        <img src="{{qrCodeUrl}}" alt="QR Code" class="w-24 h-24 mix-blend-multiply" />
      </div>
      <div class="p-5 flex flex-col justify-center flex-1">
        <h4 class="text-white font-bold text-lg leading-tight mb-1" style="font-family: 'Inter', sans-serif;">{{title}}</h4>
        <p class="text-slate-400 text-xs mb-3" style="font-family: 'Inter', sans-serif;">{{subtitle}}</p>
        <div class="space-y-1 border-t border-slate-700/50 pt-2 mt-auto">
          <div class="flex justify-between text-xs">
            <span class="text-slate-500" style="font-family: 'Inter', sans-serif;">{{bankLabel}}</span>
            <span class="text-white font-medium" style="font-family: 'Inter', sans-serif;">{{bankValue}}</span>
          </div>
          <div class="flex justify-between text-xs">
            <span class="text-slate-500" style="font-family: 'Inter', sans-serif;">{{accLabel}}</span>
            <span class="text-white font-medium" style="font-family: 'Inter', sans-serif;">{{accValue}}</span>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};

export const lt09SocialPopup: LowerThirdTheme = {
  id: "lt-09-social-popup",
  name: "Social Pop-Up",
  description: "Animated social media handle display.",
  category: "social",
  icon: "share",
  accentColor: "#f20d0d",
  tags: ["Social", "Follow", "Red"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "label", label: "Label", type: "text", defaultValue: "Follow Us", placeholder: "e.g. Follow Us", group: "Header" },
    { key: "handle", label: "Handle", type: "text", defaultValue: "@CityChurchLive", placeholder: "e.g. @CityChurchLive", required: true, group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="animate-fade-in-up" style="position:fixed;top:8rem;left:0;">
    <div class="flex items-center bg-white border-r-4 border-[#f20d0d] rounded-r-lg shadow-xl py-3 pl-6 pr-8 max-w-sm">
      <div class="flex flex-col gap-1">
        <span class="text-xs font-bold text-[#f20d0d] uppercase tracking-widest" style="font-family: 'Inter', sans-serif;">{{label}}</span>
        <div class="flex items-center gap-3 text-slate-900">
          <span class="text-lg font-bold" style="font-family: 'Inter', sans-serif;">{{handle}}</span>
        </div>
      </div>
      <div class="ml-6 flex items-center gap-3 border-l border-slate-200 pl-6">
        <span class="material-icons text-slate-600">facebook</span>
        <span class="material-icons text-slate-600">smart_display</span>
      </div>
    </div>
  </div>`,
};

export const lt10EventCountdown: LowerThirdTheme = {
  id: "lt-10-event-countdown",
  name: "Event Countdown",
  description: "Pill-shaped countdown timer.",
  category: "countdown",
  icon: "timer",
  accentColor: "#f20d0d",
  tags: ["Countdown", "Timer", "Red"],
  usesTailwind: true,
  fontImports: GOOGLE_FONTS,
  variables: [
    { key: "label", label: "Label", type: "text", defaultValue: "LIVE IN", placeholder: "e.g. LIVE IN", group: "Header" },
    { key: "time", label: "Time", type: "text", defaultValue: "04:59", placeholder: "e.g. 04:59", required: true, group: "Content" },
    { key: "eventName", label: "Event Name", type: "text", defaultValue: "Sunday Service", placeholder: "e.g. Sunday Service", group: "Content" },
  ],
  animation: { name: "fadeInUp", duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  css: SHARED_CSS,
  html: `<div class="animate-fade-in-up" style="position:fixed;top:2rem;left:50%;transform:translateX(-50%);">
    <div class="bg-black/80 backdrop-blur-sm border border-slate-700/50 rounded-full px-6 py-2 flex items-center gap-4 shadow-lg">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-[#f20d0d] animate-pulse"></div>
        <span class="text-[#f20d0d] font-bold text-xs tracking-wider" style="font-family: 'Inter', sans-serif;">{{label}}</span>
      </div>
      <div class="h-4 w-px bg-slate-700"></div>
      <span class="text-white font-mono font-bold text-lg tracking-widest tabular-nums" style="font-family: 'Inter', sans-serif;">{{time}}</span>
      <div class="h-4 w-px bg-slate-700"></div>
      <span class="text-slate-300 text-xs font-medium tracking-wide uppercase" style="font-family: 'Inter', sans-serif;">{{eventName}}</span>
    </div>
  </div>`,
};

export const themes: LowerThirdTheme[] = [
  lt01ScriptureBold,
  lt02SpeakerGeometric,
  lt03FaithDeclaration,
  lt04GuestMinister,
  lt05WorshipPulse,
  lt06NewsTicker,
  lt07SermonPoint,
  lt08GivingCard,
  lt09SocialPopup,
  lt10EventCountdown
];
