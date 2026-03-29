/* eslint-disable */
/**
 * bible category themes
 * Standalone file: no imports.
 * Source: BIBLE_PARTITION_THEMES
 */

export type ThemeCategory = "bible" | "worship" | "general" | string;

export type ThemeLike = {
  id: string;
  name: string;
  description?: string;
  category?: ThemeCategory;
  icon?: string;
  accentColor?: string;
  tags?: string[];
  usesTailwind?: boolean;
  fontImports?: string[];
  variables?: Array<Record<string, unknown>>;
  animation?: Record<string, unknown>;
  css?: string;
  html?: string;
  [key: string]: unknown;
};

export type ThemeTone = "light" | "dark";

export type ThemeVariantSet = {
  light: ThemeLike[];
  dark: ThemeLike[];
  both: ThemeLike[];
};

export const DEFAULT_CHURCH_PRIMARY_COLOR = "#3651B6";

function normalizePrimaryColor(primaryColor: string): string {
  const color = String(primaryColor || "").trim();
  return color || DEFAULT_CHURCH_PRIMARY_COLOR;
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.filter((tag) => String(tag || "").trim().length > 0))];
}

function toneCss(tone: ThemeTone, primaryColor: string): string {
  const isLight = tone === "light";
  const fg = isLight ? "#0f172a" : "#f8fafc";
  const sub = isLight ? "#334155" : "#cbd5e1";
  const bg1 = isLight ? "#ffffff" : "#0b1222";
  const bg2 = isLight ? "#f5f7fb" : "#1b2436";
  const bg = isLight ? "rgba(255,255,255,.94)" : "rgba(9,14,24,.9)";
  const border = isLight ? "rgba(15,23,42,.18)" : "rgba(148,163,184,.24)";
  const glow = isLight ? "rgba(54,81,182,.14)" : "rgba(54,81,182,.26)";

  return `
/* category tone variant: ${tone} */
.church-tone-root[data-church-tone="${tone}"] {
  --church-primary: ${primaryColor};
  --accent: var(--church-primary);
  --fg: ${fg};
  --sub: ${sub};
  --bg: ${bg};
  --bg1: ${bg1};
  --bg2: ${bg2};
  --bd: ${border};
  --border: ${border};
  --glow: ${glow};
  --tagFg: #ffffff;
}

.church-tone-root[data-church-tone="${tone}"] * {
  --accent: var(--church-primary);
}
`;
}

export function createThemeToneVariant(
  theme: ThemeLike,
  tone: ThemeTone,
  primaryColorInput: string = DEFAULT_CHURCH_PRIMARY_COLOR,
): ThemeLike {
  const primaryColor = normalizePrimaryColor(primaryColorInput);
  const baseId = String(theme.id || "theme").replace(/-(light|dark)$/i, "");
  const baseName = String(theme.name || "Untitled");
  const toneLabel = tone === "light" ? "Light" : "Dark";

  return {
    ...theme,
    id: `${baseId}-${tone}`,
    name: `${baseName} (${toneLabel})`,
    accentColor: primaryColor,
    tags: uniqueTags([...(theme.tags || []).map(String), tone, "church-primary"]),
    css: `${String(theme.css || "")}
${toneCss(tone, primaryColor)}`,
    html: `<div class="church-tone-root" data-church-tone="${tone}" style="--church-primary:${primaryColor};">${String(theme.html || "")}</div>`,
  };
}

export function buildLightDarkVariants(
  themes: ThemeLike[],
  primaryColor: string = DEFAULT_CHURCH_PRIMARY_COLOR,
): ThemeVariantSet {
  const light = themes.map((theme) => createThemeToneVariant(theme, "light", primaryColor));
  const dark = themes.map((theme) => createThemeToneVariant(theme, "dark", primaryColor));
  return {
    light,
    dark,
    both: [...light, ...dark],
  };
}

export const BIBLE_THEMES: ThemeLike[] = [
  {
    "id": "lt-105-traditional-scripture-ribbon",
    "name": "Traditional Scripture Ribbon",
    "description": "Simple scripture band with readable serif verse text.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#6D1F1F",
    "tags": [
      "traditional",
      "scripture",
      "verse",
      "bible"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Trust in the Lord with all your heart, and lean not on your own understanding.",
        "placeholder": "Enter verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Proverbs 3:5",
        "placeholder": "e.g. Romans 8:28",
        "required": true,
        "group": "Content"
      }
    ],
    "html": "<div class=\"lt pos-bc in-up\">\n  <div class=\"panel quote-panel\" style=\"--bg:#FFF9F4;--fg:#3E2A1F;--accent:#6D1F1F;--bd:rgba(109,31,31,.25);\">\n    <span class=\"kicker\">{{label}}</span>\n    <p class=\"quote-text\">{{verseText}}</p>\n    <p class=\"quote-ref\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Source+Serif+4:wght@400;600;700&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 600,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes tickerMove {\n  0% { transform: translateX(0%); }\n  100% { transform: translateX(-50%); }\n}\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: .45; }\n}\n\n.lt { position: fixed; z-index: 40; pointer-events: none; }\n.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }\n\n.pos-bl { left: 40px; bottom: 32px; }\n.pos-br { right: 40px; bottom: 32px; }\n.pos-bc { left: 50%; bottom: 32px; transform: translateX(-50%); }\n.pos-tl { left: 40px; top: 32px; }\n.pos-tr { right: 40px; top: 32px; }\n.pos-tc { left: 50%; top: 32px; transform: translateX(-50%); }\n.pos-full-bottom { left: 0; right: 0; bottom: 0; }\n\n.panel {\n  background: var(--bg, rgba(20,20,20,.85));\n  color: var(--fg, #fff);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  border-radius: 14px;\n  box-shadow: 0 12px 40px rgba(0,0,0,.28);\n  backdrop-filter: blur(2px);\n}\n\n.row { display: flex; align-items: center; }\n.col { display: flex; flex-direction: column; min-width: 0; }\n\n.kicker {\n  display: inline-block;\n  font-size: 15px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  margin-bottom: 8px;\n  color: var(--accent, #4a6bcb);\n}\n\n.headline {\n  font-size: clamp(28px, 2.1vw, 54px);\n  font-weight: 800;\n  line-height: 1.08;\n  letter-spacing: .005em;\n}\n\n.subline {\n  margin-top: 6px;\n  font-size: clamp(17px, 1.32vw, 34px);\n  font-weight: 500;\n  line-height: 1.2;\n  opacity: .94;\n}\n\n.meta {\n  margin-top: 8px;\n  font-size: clamp(14px, 1vw, 24px);\n  font-weight: 600;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .88;\n}\n\n.speaker-panel {\n  display: flex;\n  align-items: center;\n  gap: 18px;\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 80px));\n  padding: 20px 24px;\n}\n\n.logo-box {\n  width: 170px;\n  min-width: 170px;\n  height: 96px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(255,255,255,.02);\n}\n\n.logo-box.logo-round {\n  width: 88px;\n  min-width: 88px;\n  height: 88px;\n  border-radius: 999px;\n  border: 2px solid rgba(255,255,255,.18);\n}\n\n.logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }\n\n.v-divider {\n  width: 6px;\n  min-width: 6px;\n  height: 94px;\n  border-radius: 2px;\n  background: var(--accent, #4a6bcb);\n}\n\n.name-line {\n  font-size: clamp(30px, 2.55vw, 62px);\n  font-weight: 800;\n  line-height: 1;\n  text-transform: uppercase;\n}\n\n.role-line {\n  margin-top: 9px;\n  font-size: clamp(20px, 1.82vw, 42px);\n  font-weight: 500;\n  line-height: 1.15;\n}\n\n.quote-panel {\n  max-width: min(1450px, calc(100vw - 80px));\n  min-width: 680px;\n  padding: 18px 24px 20px;\n}\n\n.quote-text {\n  font-family: \"Source Serif 4\", serif;\n  font-size: clamp(29px, 2.25vw, 55px);\n  line-height: 1.22;\n  font-weight: 600;\n}\n\n.quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(16px, 1.1vw, 26px);\n  font-weight: 700;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .9;\n}\n\n.announce-panel {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  min-width: 640px;\n  max-width: min(1280px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.tag-box {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  border-radius: 10px;\n  padding: 9px 14px;\n  font-size: 14px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.keyword-panel {\n  display: inline-flex;\n  align-items: center;\n  gap: 14px;\n  max-width: min(1250px, calc(100vw - 80px));\n  padding: 12px 16px;\n}\n\n.keyword-main {\n  font-size: clamp(30px, 2.35vw, 56px);\n  font-weight: 800;\n  line-height: 1;\n  letter-spacing: .01em;\n  text-transform: uppercase;\n}\n\n.keyword-sub {\n  font-size: clamp(16px, 1.06vw, 24px);\n  font-weight: 600;\n  opacity: .92;\n}\n\n.date-shell {\n  display: flex;\n  align-items: stretch;\n  gap: 14px;\n  min-width: 650px;\n  max-width: min(1180px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.date-box {\n  min-width: 92px;\n  border-radius: 10px;\n  background: var(--accent, #4a6bcb);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 8px 10px;\n}\n\n.date-box .mth {\n  font-size: 14px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.date-box .dy {\n  font-size: 36px;\n  font-weight: 800;\n  line-height: 1;\n}\n\n.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: var(--bg, rgba(16,16,16,.78));\n  border: 1px solid var(--bd, rgba(255,255,255,.18));\n  box-shadow: 0 10px 24px rgba(0,0,0,.28);\n  color: var(--fg, #fff);\n}\n\n.dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 999px;\n  background: var(--accent, #e53935);\n  animation: pulse 1.6s ease-in-out infinite;\n}\n\n.pill-label {\n  font-size: 13px;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  font-weight: 700;\n  color: var(--accent, #e53935);\n}\n\n.pill-time {\n  font-size: 24px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  font-variant-numeric: tabular-nums;\n}\n\n.pill-context {\n  font-size: 14px;\n  font-weight: 600;\n  opacity: .9;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n.social-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.platform-pill {\n  background: rgba(255,255,255,.14);\n  border-radius: 999px;\n  padding: 7px 11px;\n  font-size: 13px;\n  text-transform: uppercase;\n  font-weight: 700;\n  letter-spacing: .08em;\n}\n\n.handle {\n  font-size: clamp(21px, 1.56vw, 34px);\n  font-weight: 700;\n}\n\n.ticker-shell {\n  width: min(1880px, calc(100vw - 24px));\n  margin: 0 auto 10px;\n  height: 56px;\n  border-radius: 12px;\n  overflow: hidden;\n  background: var(--bg, #111);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  box-shadow: 0 10px 26px rgba(0,0,0,.35);\n  display: flex;\n  align-items: stretch;\n}\n\n.ticker-badge {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  min-width: 142px;\n  padding: 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .09em;\n}\n\n.ticker-track {\n  flex: 1;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n}\n\n.ticker-move {\n  display: inline-flex;\n  white-space: nowrap;\n  gap: 48px;\n  padding-left: 28px;\n  font-size: 18px;\n  font-weight: 600;\n  letter-spacing: .01em;\n  animation: tickerMove var(--speed, 20s) linear infinite;\n}\n\n.info-panel {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.line-list {\n  margin-top: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  font-size: clamp(16px, 1vw, 22px);\n  font-weight: 600;\n  line-height: 1.25;\n}\n\n@media (max-width: 1180px) {\n  .pos-bl, .pos-br, .pos-bc, .pos-tl, .pos-tr, .pos-tc { left: 20px; right: 20px; transform: none; }\n  .pos-br, .pos-tr { left: auto; }\n  .pos-bc, .pos-tc { left: 20px; right: 20px; }\n  .speaker-panel, .quote-panel, .announce-panel, .date-shell, .social-row, .info-panel { min-width: 0; max-width: calc(100vw - 40px); }\n  .speaker-panel { padding: 14px 16px; gap: 14px; }\n  .logo-box { width: 116px; min-width: 116px; height: 70px; }\n  .logo-box.logo-round { width: 64px; min-width: 64px; height: 64px; }\n  .v-divider { height: 70px; }\n}\n"
  },
  {
    "id": "lt-106-traditional-scripture-center",
    "name": "Traditional Scripture Center",
    "description": "Centered lower-third scripture for readings and responsive moments.",
    "category": "bible",
    "icon": "auto_stories",
    "accentColor": "#344E41",
    "tags": [
      "traditional",
      "bible",
      "reading",
      "scripture"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Trust in the Lord with all your heart, and lean not on your own understanding.",
        "placeholder": "Enter verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Proverbs 3:5",
        "placeholder": "e.g. Romans 8:28",
        "required": true,
        "group": "Content"
      }
    ],
    "html": "<div class=\"lt pos-bc in-up\">\n  <div class=\"panel quote-panel\" style=\"--bg:#FDFDFB;--fg:#2B312D;--accent:#344E41;--bd:rgba(52,78,65,.2);\">\n    <span class=\"kicker\">{{label}}</span>\n    <p class=\"quote-text\">{{verseText}}</p>\n    <p class=\"quote-ref\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Source+Serif+4:wght@400;600;700&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 600,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes tickerMove {\n  0% { transform: translateX(0%); }\n  100% { transform: translateX(-50%); }\n}\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: .45; }\n}\n\n.lt { position: fixed; z-index: 40; pointer-events: none; }\n.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }\n\n.pos-bl { left: 40px; bottom: 32px; }\n.pos-br { right: 40px; bottom: 32px; }\n.pos-bc { left: 50%; bottom: 32px; transform: translateX(-50%); }\n.pos-tl { left: 40px; top: 32px; }\n.pos-tr { right: 40px; top: 32px; }\n.pos-tc { left: 50%; top: 32px; transform: translateX(-50%); }\n.pos-full-bottom { left: 0; right: 0; bottom: 0; }\n\n.panel {\n  background: var(--bg, rgba(20,20,20,.85));\n  color: var(--fg, #fff);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  border-radius: 14px;\n  box-shadow: 0 12px 40px rgba(0,0,0,.28);\n  backdrop-filter: blur(2px);\n}\n\n.row { display: flex; align-items: center; }\n.col { display: flex; flex-direction: column; min-width: 0; }\n\n.kicker {\n  display: inline-block;\n  font-size: 15px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  margin-bottom: 8px;\n  color: var(--accent, #4a6bcb);\n}\n\n.headline {\n  font-size: clamp(28px, 2.1vw, 54px);\n  font-weight: 800;\n  line-height: 1.08;\n  letter-spacing: .005em;\n}\n\n.subline {\n  margin-top: 6px;\n  font-size: clamp(17px, 1.32vw, 34px);\n  font-weight: 500;\n  line-height: 1.2;\n  opacity: .94;\n}\n\n.meta {\n  margin-top: 8px;\n  font-size: clamp(14px, 1vw, 24px);\n  font-weight: 600;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .88;\n}\n\n.speaker-panel {\n  display: flex;\n  align-items: center;\n  gap: 18px;\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 80px));\n  padding: 20px 24px;\n}\n\n.logo-box {\n  width: 170px;\n  min-width: 170px;\n  height: 96px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(255,255,255,.02);\n}\n\n.logo-box.logo-round {\n  width: 88px;\n  min-width: 88px;\n  height: 88px;\n  border-radius: 999px;\n  border: 2px solid rgba(255,255,255,.18);\n}\n\n.logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }\n\n.v-divider {\n  width: 6px;\n  min-width: 6px;\n  height: 94px;\n  border-radius: 2px;\n  background: var(--accent, #4a6bcb);\n}\n\n.name-line {\n  font-size: clamp(30px, 2.55vw, 62px);\n  font-weight: 800;\n  line-height: 1;\n  text-transform: uppercase;\n}\n\n.role-line {\n  margin-top: 9px;\n  font-size: clamp(20px, 1.82vw, 42px);\n  font-weight: 500;\n  line-height: 1.15;\n}\n\n.quote-panel {\n  max-width: min(1450px, calc(100vw - 80px));\n  min-width: 680px;\n  padding: 18px 24px 20px;\n}\n\n.quote-text {\n  font-family: \"Source Serif 4\", serif;\n  font-size: clamp(29px, 2.25vw, 55px);\n  line-height: 1.22;\n  font-weight: 600;\n}\n\n.quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(16px, 1.1vw, 26px);\n  font-weight: 700;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .9;\n}\n\n.announce-panel {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  min-width: 640px;\n  max-width: min(1280px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.tag-box {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  border-radius: 10px;\n  padding: 9px 14px;\n  font-size: 14px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.keyword-panel {\n  display: inline-flex;\n  align-items: center;\n  gap: 14px;\n  max-width: min(1250px, calc(100vw - 80px));\n  padding: 12px 16px;\n}\n\n.keyword-main {\n  font-size: clamp(30px, 2.35vw, 56px);\n  font-weight: 800;\n  line-height: 1;\n  letter-spacing: .01em;\n  text-transform: uppercase;\n}\n\n.keyword-sub {\n  font-size: clamp(16px, 1.06vw, 24px);\n  font-weight: 600;\n  opacity: .92;\n}\n\n.date-shell {\n  display: flex;\n  align-items: stretch;\n  gap: 14px;\n  min-width: 650px;\n  max-width: min(1180px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.date-box {\n  min-width: 92px;\n  border-radius: 10px;\n  background: var(--accent, #4a6bcb);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 8px 10px;\n}\n\n.date-box .mth {\n  font-size: 14px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.date-box .dy {\n  font-size: 36px;\n  font-weight: 800;\n  line-height: 1;\n}\n\n.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: var(--bg, rgba(16,16,16,.78));\n  border: 1px solid var(--bd, rgba(255,255,255,.18));\n  box-shadow: 0 10px 24px rgba(0,0,0,.28);\n  color: var(--fg, #fff);\n}\n\n.dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 999px;\n  background: var(--accent, #e53935);\n  animation: pulse 1.6s ease-in-out infinite;\n}\n\n.pill-label {\n  font-size: 13px;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  font-weight: 700;\n  color: var(--accent, #e53935);\n}\n\n.pill-time {\n  font-size: 24px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  font-variant-numeric: tabular-nums;\n}\n\n.pill-context {\n  font-size: 14px;\n  font-weight: 600;\n  opacity: .9;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n.social-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.platform-pill {\n  background: rgba(255,255,255,.14);\n  border-radius: 999px;\n  padding: 7px 11px;\n  font-size: 13px;\n  text-transform: uppercase;\n  font-weight: 700;\n  letter-spacing: .08em;\n}\n\n.handle {\n  font-size: clamp(21px, 1.56vw, 34px);\n  font-weight: 700;\n}\n\n.ticker-shell {\n  width: min(1880px, calc(100vw - 24px));\n  margin: 0 auto 10px;\n  height: 56px;\n  border-radius: 12px;\n  overflow: hidden;\n  background: var(--bg, #111);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  box-shadow: 0 10px 26px rgba(0,0,0,.35);\n  display: flex;\n  align-items: stretch;\n}\n\n.ticker-badge {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  min-width: 142px;\n  padding: 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .09em;\n}\n\n.ticker-track {\n  flex: 1;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n}\n\n.ticker-move {\n  display: inline-flex;\n  white-space: nowrap;\n  gap: 48px;\n  padding-left: 28px;\n  font-size: 18px;\n  font-weight: 600;\n  letter-spacing: .01em;\n  animation: tickerMove var(--speed, 20s) linear infinite;\n}\n\n.info-panel {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.line-list {\n  margin-top: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  font-size: clamp(16px, 1vw, 22px);\n  font-weight: 600;\n  line-height: 1.25;\n}\n\n@media (max-width: 1180px) {\n  .pos-bl, .pos-br, .pos-bc, .pos-tl, .pos-tr, .pos-tc { left: 20px; right: 20px; transform: none; }\n  .pos-br, .pos-tr { left: auto; }\n  .pos-bc, .pos-tc { left: 20px; right: 20px; }\n  .speaker-panel, .quote-panel, .announce-panel, .date-shell, .social-row, .info-panel { min-width: 0; max-width: calc(100vw - 40px); }\n  .speaker-panel { padding: 14px 16px; gap: 14px; }\n  .logo-box { width: 116px; min-width: 116px; height: 70px; }\n  .logo-box.logo-round { width: 64px; min-width: 64px; height: 64px; }\n  .v-divider { height: 70px; }\n}\n"
  },
  {
    "id": "lt-123-modern-scripture-left",
    "name": "Modern Scripture Left",
    "description": "Left-positioned scripture card with high readability.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#2563EB",
    "tags": [
      "modern",
      "scripture",
      "bible",
      "verse"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Trust in the Lord with all your heart, and lean not on your own understanding.",
        "placeholder": "Enter verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Proverbs 3:5",
        "placeholder": "e.g. Romans 8:28",
        "required": true,
        "group": "Content"
      }
    ],
    "html": "<div class=\"lt pos-bl in-up\">\n  <div class=\"panel quote-panel\" style=\"--bg:rgba(15,23,42,.86);--fg:#E2E8F0;--accent:#2563EB;--bd:rgba(59,130,246,.3);\">\n    <span class=\"kicker\">{{label}}</span>\n    <p class=\"quote-text\">{{verseText}}</p>\n    <p class=\"quote-ref\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Source+Serif+4:wght@400;600;700&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 600,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes tickerMove {\n  0% { transform: translateX(0%); }\n  100% { transform: translateX(-50%); }\n}\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: .45; }\n}\n\n.lt { position: fixed; z-index: 40; pointer-events: none; }\n.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }\n\n.pos-bl { left: 40px; bottom: 32px; }\n.pos-br { right: 40px; bottom: 32px; }\n.pos-bc { left: 50%; bottom: 32px; transform: translateX(-50%); }\n.pos-tl { left: 40px; top: 32px; }\n.pos-tr { right: 40px; top: 32px; }\n.pos-tc { left: 50%; top: 32px; transform: translateX(-50%); }\n.pos-full-bottom { left: 0; right: 0; bottom: 0; }\n\n.panel {\n  background: var(--bg, rgba(20,20,20,.85));\n  color: var(--fg, #fff);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  border-radius: 14px;\n  box-shadow: 0 12px 40px rgba(0,0,0,.28);\n  backdrop-filter: blur(2px);\n}\n\n.row { display: flex; align-items: center; }\n.col { display: flex; flex-direction: column; min-width: 0; }\n\n.kicker {\n  display: inline-block;\n  font-size: 15px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  margin-bottom: 8px;\n  color: var(--accent, #4a6bcb);\n}\n\n.headline {\n  font-size: clamp(28px, 2.1vw, 54px);\n  font-weight: 800;\n  line-height: 1.08;\n  letter-spacing: .005em;\n}\n\n.subline {\n  margin-top: 6px;\n  font-size: clamp(17px, 1.32vw, 34px);\n  font-weight: 500;\n  line-height: 1.2;\n  opacity: .94;\n}\n\n.meta {\n  margin-top: 8px;\n  font-size: clamp(14px, 1vw, 24px);\n  font-weight: 600;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .88;\n}\n\n.speaker-panel {\n  display: flex;\n  align-items: center;\n  gap: 18px;\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 80px));\n  padding: 20px 24px;\n}\n\n.logo-box {\n  width: 170px;\n  min-width: 170px;\n  height: 96px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(255,255,255,.02);\n}\n\n.logo-box.logo-round {\n  width: 88px;\n  min-width: 88px;\n  height: 88px;\n  border-radius: 999px;\n  border: 2px solid rgba(255,255,255,.18);\n}\n\n.logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }\n\n.v-divider {\n  width: 6px;\n  min-width: 6px;\n  height: 94px;\n  border-radius: 2px;\n  background: var(--accent, #4a6bcb);\n}\n\n.name-line {\n  font-size: clamp(30px, 2.55vw, 62px);\n  font-weight: 800;\n  line-height: 1;\n  text-transform: uppercase;\n}\n\n.role-line {\n  margin-top: 9px;\n  font-size: clamp(20px, 1.82vw, 42px);\n  font-weight: 500;\n  line-height: 1.15;\n}\n\n.quote-panel {\n  max-width: min(1450px, calc(100vw - 80px));\n  min-width: 680px;\n  padding: 18px 24px 20px;\n}\n\n.quote-text {\n  font-family: \"Source Serif 4\", serif;\n  font-size: clamp(29px, 2.25vw, 55px);\n  line-height: 1.22;\n  font-weight: 600;\n}\n\n.quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(16px, 1.1vw, 26px);\n  font-weight: 700;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .9;\n}\n\n.announce-panel {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  min-width: 640px;\n  max-width: min(1280px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.tag-box {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  border-radius: 10px;\n  padding: 9px 14px;\n  font-size: 14px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.keyword-panel {\n  display: inline-flex;\n  align-items: center;\n  gap: 14px;\n  max-width: min(1250px, calc(100vw - 80px));\n  padding: 12px 16px;\n}\n\n.keyword-main {\n  font-size: clamp(30px, 2.35vw, 56px);\n  font-weight: 800;\n  line-height: 1;\n  letter-spacing: .01em;\n  text-transform: uppercase;\n}\n\n.keyword-sub {\n  font-size: clamp(16px, 1.06vw, 24px);\n  font-weight: 600;\n  opacity: .92;\n}\n\n.date-shell {\n  display: flex;\n  align-items: stretch;\n  gap: 14px;\n  min-width: 650px;\n  max-width: min(1180px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.date-box {\n  min-width: 92px;\n  border-radius: 10px;\n  background: var(--accent, #4a6bcb);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 8px 10px;\n}\n\n.date-box .mth {\n  font-size: 14px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.date-box .dy {\n  font-size: 36px;\n  font-weight: 800;\n  line-height: 1;\n}\n\n.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: var(--bg, rgba(16,16,16,.78));\n  border: 1px solid var(--bd, rgba(255,255,255,.18));\n  box-shadow: 0 10px 24px rgba(0,0,0,.28);\n  color: var(--fg, #fff);\n}\n\n.dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 999px;\n  background: var(--accent, #e53935);\n  animation: pulse 1.6s ease-in-out infinite;\n}\n\n.pill-label {\n  font-size: 13px;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  font-weight: 700;\n  color: var(--accent, #e53935);\n}\n\n.pill-time {\n  font-size: 24px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  font-variant-numeric: tabular-nums;\n}\n\n.pill-context {\n  font-size: 14px;\n  font-weight: 600;\n  opacity: .9;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n.social-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.platform-pill {\n  background: rgba(255,255,255,.14);\n  border-radius: 999px;\n  padding: 7px 11px;\n  font-size: 13px;\n  text-transform: uppercase;\n  font-weight: 700;\n  letter-spacing: .08em;\n}\n\n.handle {\n  font-size: clamp(21px, 1.56vw, 34px);\n  font-weight: 700;\n}\n\n.ticker-shell {\n  width: min(1880px, calc(100vw - 24px));\n  margin: 0 auto 10px;\n  height: 56px;\n  border-radius: 12px;\n  overflow: hidden;\n  background: var(--bg, #111);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  box-shadow: 0 10px 26px rgba(0,0,0,.35);\n  display: flex;\n  align-items: stretch;\n}\n\n.ticker-badge {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  min-width: 142px;\n  padding: 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .09em;\n}\n\n.ticker-track {\n  flex: 1;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n}\n\n.ticker-move {\n  display: inline-flex;\n  white-space: nowrap;\n  gap: 48px;\n  padding-left: 28px;\n  font-size: 18px;\n  font-weight: 600;\n  letter-spacing: .01em;\n  animation: tickerMove var(--speed, 20s) linear infinite;\n}\n\n.info-panel {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.line-list {\n  margin-top: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  font-size: clamp(16px, 1vw, 22px);\n  font-weight: 600;\n  line-height: 1.25;\n}\n\n@media (max-width: 1180px) {\n  .pos-bl, .pos-br, .pos-bc, .pos-tl, .pos-tr, .pos-tc { left: 20px; right: 20px; transform: none; }\n  .pos-br, .pos-tr { left: auto; }\n  .pos-bc, .pos-tc { left: 20px; right: 20px; }\n  .speaker-panel, .quote-panel, .announce-panel, .date-shell, .social-row, .info-panel { min-width: 0; max-width: calc(100vw - 40px); }\n  .speaker-panel { padding: 14px 16px; gap: 14px; }\n  .logo-box { width: 116px; min-width: 116px; height: 70px; }\n  .logo-box.logo-round { width: 64px; min-width: 64px; height: 64px; }\n  .v-divider { height: 70px; }\n}\n"
  },
  {
    "id": "lt-124-modern-scripture-card",
    "name": "Modern Scripture Card",
    "description": "Centered modern scripture for sermon and reflection moments.",
    "category": "bible",
    "icon": "chrome_reader_mode",
    "accentColor": "#14B8A6",
    "tags": [
      "modern",
      "bible",
      "verse",
      "centered"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Trust in the Lord with all your heart, and lean not on your own understanding.",
        "placeholder": "Enter verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Proverbs 3:5",
        "placeholder": "e.g. Romans 8:28",
        "required": true,
        "group": "Content"
      }
    ],
    "html": "<div class=\"lt pos-bc in-up\">\n  <div class=\"panel quote-panel\" style=\"--bg:rgba(17,24,39,.9);--fg:#ECFEFF;--accent:#14B8A6;--bd:rgba(20,184,166,.28);\">\n    <span class=\"kicker\">{{label}}</span>\n    <p class=\"quote-text\">{{verseText}}</p>\n    <p class=\"quote-ref\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Source+Serif+4:wght@400;600;700&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 600,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes tickerMove {\n  0% { transform: translateX(0%); }\n  100% { transform: translateX(-50%); }\n}\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: .45; }\n}\n\n.lt { position: fixed; z-index: 40; pointer-events: none; }\n.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }\n\n.pos-bl { left: 40px; bottom: 32px; }\n.pos-br { right: 40px; bottom: 32px; }\n.pos-bc { left: 50%; bottom: 32px; transform: translateX(-50%); }\n.pos-tl { left: 40px; top: 32px; }\n.pos-tr { right: 40px; top: 32px; }\n.pos-tc { left: 50%; top: 32px; transform: translateX(-50%); }\n.pos-full-bottom { left: 0; right: 0; bottom: 0; }\n\n.panel {\n  background: var(--bg, rgba(20,20,20,.85));\n  color: var(--fg, #fff);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  border-radius: 14px;\n  box-shadow: 0 12px 40px rgba(0,0,0,.28);\n  backdrop-filter: blur(2px);\n}\n\n.row { display: flex; align-items: center; }\n.col { display: flex; flex-direction: column; min-width: 0; }\n\n.kicker {\n  display: inline-block;\n  font-size: 15px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  margin-bottom: 8px;\n  color: var(--accent, #4a6bcb);\n}\n\n.headline {\n  font-size: clamp(28px, 2.1vw, 54px);\n  font-weight: 800;\n  line-height: 1.08;\n  letter-spacing: .005em;\n}\n\n.subline {\n  margin-top: 6px;\n  font-size: clamp(17px, 1.32vw, 34px);\n  font-weight: 500;\n  line-height: 1.2;\n  opacity: .94;\n}\n\n.meta {\n  margin-top: 8px;\n  font-size: clamp(14px, 1vw, 24px);\n  font-weight: 600;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .88;\n}\n\n.speaker-panel {\n  display: flex;\n  align-items: center;\n  gap: 18px;\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 80px));\n  padding: 20px 24px;\n}\n\n.logo-box {\n  width: 170px;\n  min-width: 170px;\n  height: 96px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(255,255,255,.02);\n}\n\n.logo-box.logo-round {\n  width: 88px;\n  min-width: 88px;\n  height: 88px;\n  border-radius: 999px;\n  border: 2px solid rgba(255,255,255,.18);\n}\n\n.logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }\n\n.v-divider {\n  width: 6px;\n  min-width: 6px;\n  height: 94px;\n  border-radius: 2px;\n  background: var(--accent, #4a6bcb);\n}\n\n.name-line {\n  font-size: clamp(30px, 2.55vw, 62px);\n  font-weight: 800;\n  line-height: 1;\n  text-transform: uppercase;\n}\n\n.role-line {\n  margin-top: 9px;\n  font-size: clamp(20px, 1.82vw, 42px);\n  font-weight: 500;\n  line-height: 1.15;\n}\n\n.quote-panel {\n  max-width: min(1450px, calc(100vw - 80px));\n  min-width: 680px;\n  padding: 18px 24px 20px;\n}\n\n.quote-text {\n  font-family: \"Source Serif 4\", serif;\n  font-size: clamp(29px, 2.25vw, 55px);\n  line-height: 1.22;\n  font-weight: 600;\n}\n\n.quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(16px, 1.1vw, 26px);\n  font-weight: 700;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .9;\n}\n\n.announce-panel {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  min-width: 640px;\n  max-width: min(1280px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.tag-box {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  border-radius: 10px;\n  padding: 9px 14px;\n  font-size: 14px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.keyword-panel {\n  display: inline-flex;\n  align-items: center;\n  gap: 14px;\n  max-width: min(1250px, calc(100vw - 80px));\n  padding: 12px 16px;\n}\n\n.keyword-main {\n  font-size: clamp(30px, 2.35vw, 56px);\n  font-weight: 800;\n  line-height: 1;\n  letter-spacing: .01em;\n  text-transform: uppercase;\n}\n\n.keyword-sub {\n  font-size: clamp(16px, 1.06vw, 24px);\n  font-weight: 600;\n  opacity: .92;\n}\n\n.date-shell {\n  display: flex;\n  align-items: stretch;\n  gap: 14px;\n  min-width: 650px;\n  max-width: min(1180px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.date-box {\n  min-width: 92px;\n  border-radius: 10px;\n  background: var(--accent, #4a6bcb);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 8px 10px;\n}\n\n.date-box .mth {\n  font-size: 14px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.date-box .dy {\n  font-size: 36px;\n  font-weight: 800;\n  line-height: 1;\n}\n\n.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: var(--bg, rgba(16,16,16,.78));\n  border: 1px solid var(--bd, rgba(255,255,255,.18));\n  box-shadow: 0 10px 24px rgba(0,0,0,.28);\n  color: var(--fg, #fff);\n}\n\n.dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 999px;\n  background: var(--accent, #e53935);\n  animation: pulse 1.6s ease-in-out infinite;\n}\n\n.pill-label {\n  font-size: 13px;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  font-weight: 700;\n  color: var(--accent, #e53935);\n}\n\n.pill-time {\n  font-size: 24px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  font-variant-numeric: tabular-nums;\n}\n\n.pill-context {\n  font-size: 14px;\n  font-weight: 600;\n  opacity: .9;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n.social-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.platform-pill {\n  background: rgba(255,255,255,.14);\n  border-radius: 999px;\n  padding: 7px 11px;\n  font-size: 13px;\n  text-transform: uppercase;\n  font-weight: 700;\n  letter-spacing: .08em;\n}\n\n.handle {\n  font-size: clamp(21px, 1.56vw, 34px);\n  font-weight: 700;\n}\n\n.ticker-shell {\n  width: min(1880px, calc(100vw - 24px));\n  margin: 0 auto 10px;\n  height: 56px;\n  border-radius: 12px;\n  overflow: hidden;\n  background: var(--bg, #111);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  box-shadow: 0 10px 26px rgba(0,0,0,.35);\n  display: flex;\n  align-items: stretch;\n}\n\n.ticker-badge {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  min-width: 142px;\n  padding: 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .09em;\n}\n\n.ticker-track {\n  flex: 1;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n}\n\n.ticker-move {\n  display: inline-flex;\n  white-space: nowrap;\n  gap: 48px;\n  padding-left: 28px;\n  font-size: 18px;\n  font-weight: 600;\n  letter-spacing: .01em;\n  animation: tickerMove var(--speed, 20s) linear infinite;\n}\n\n.info-panel {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.line-list {\n  margin-top: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  font-size: clamp(16px, 1vw, 22px);\n  font-weight: 600;\n  line-height: 1.25;\n}\n\n@media (max-width: 1180px) {\n  .pos-bl, .pos-br, .pos-bc, .pos-tl, .pos-tr, .pos-tc { left: 20px; right: 20px; transform: none; }\n  .pos-br, .pos-tr { left: auto; }\n  .pos-bc, .pos-tc { left: 20px; right: 20px; }\n  .speaker-panel, .quote-panel, .announce-panel, .date-shell, .social-row, .info-panel { min-width: 0; max-width: calc(100vw - 40px); }\n  .speaker-panel { padding: 14px 16px; gap: 14px; }\n  .logo-box { width: 116px; min-width: 116px; height: 70px; }\n  .logo-box.logo-round { width: 64px; min-width: 64px; height: 64px; }\n  .v-divider { height: 70px; }\n}\n"
  },
  {
    "id": "lt-143-style-verse-focus",
    "name": "Stylish Verse Focus",
    "description": "Bible verse focus card with elevated modern contrast.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#C026D3",
    "tags": [
      "stylish",
      "scripture",
      "verse",
      "bible"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Trust in the Lord with all your heart, and lean not on your own understanding.",
        "placeholder": "Enter verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Proverbs 3:5",
        "placeholder": "e.g. Romans 8:28",
        "required": true,
        "group": "Content"
      }
    ],
    "html": "<div class=\"lt pos-bc in-up\">\n  <div class=\"panel quote-panel\" style=\"--bg:rgba(30,27,75,.9);--fg:#FAF5FF;--accent:#C026D3;--bd:rgba(192,38,211,.35);\">\n    <span class=\"kicker\">{{label}}</span>\n    <p class=\"quote-text\">{{verseText}}</p>\n    <p class=\"quote-ref\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Source+Serif+4:wght@400;600;700&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 600,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Montserrat\", sans-serif; }\n\n@keyframes fadeInUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes tickerMove {\n  0% { transform: translateX(0%); }\n  100% { transform: translateX(-50%); }\n}\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: .45; }\n}\n\n.lt { position: fixed; z-index: 40; pointer-events: none; }\n.in-up { animation: fadeInUp .6s cubic-bezier(0.16,1,0.3,1) both; }\n\n.pos-bl { left: 40px; bottom: 32px; }\n.pos-br { right: 40px; bottom: 32px; }\n.pos-bc { left: 50%; bottom: 32px; transform: translateX(-50%); }\n.pos-tl { left: 40px; top: 32px; }\n.pos-tr { right: 40px; top: 32px; }\n.pos-tc { left: 50%; top: 32px; transform: translateX(-50%); }\n.pos-full-bottom { left: 0; right: 0; bottom: 0; }\n\n.panel {\n  background: var(--bg, rgba(20,20,20,.85));\n  color: var(--fg, #fff);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  border-radius: 14px;\n  box-shadow: 0 12px 40px rgba(0,0,0,.28);\n  backdrop-filter: blur(2px);\n}\n\n.row { display: flex; align-items: center; }\n.col { display: flex; flex-direction: column; min-width: 0; }\n\n.kicker {\n  display: inline-block;\n  font-size: 15px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  margin-bottom: 8px;\n  color: var(--accent, #4a6bcb);\n}\n\n.headline {\n  font-size: clamp(28px, 2.1vw, 54px);\n  font-weight: 800;\n  line-height: 1.08;\n  letter-spacing: .005em;\n}\n\n.subline {\n  margin-top: 6px;\n  font-size: clamp(17px, 1.32vw, 34px);\n  font-weight: 500;\n  line-height: 1.2;\n  opacity: .94;\n}\n\n.meta {\n  margin-top: 8px;\n  font-size: clamp(14px, 1vw, 24px);\n  font-weight: 600;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .88;\n}\n\n.speaker-panel {\n  display: flex;\n  align-items: center;\n  gap: 18px;\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 80px));\n  padding: 20px 24px;\n}\n\n.logo-box {\n  width: 170px;\n  min-width: 170px;\n  height: 96px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(255,255,255,.02);\n}\n\n.logo-box.logo-round {\n  width: 88px;\n  min-width: 88px;\n  height: 88px;\n  border-radius: 999px;\n  border: 2px solid rgba(255,255,255,.18);\n}\n\n.logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }\n\n.v-divider {\n  width: 6px;\n  min-width: 6px;\n  height: 94px;\n  border-radius: 2px;\n  background: var(--accent, #4a6bcb);\n}\n\n.name-line {\n  font-size: clamp(30px, 2.55vw, 62px);\n  font-weight: 800;\n  line-height: 1;\n  text-transform: uppercase;\n}\n\n.role-line {\n  margin-top: 9px;\n  font-size: clamp(20px, 1.82vw, 42px);\n  font-weight: 500;\n  line-height: 1.15;\n}\n\n.quote-panel {\n  max-width: min(1450px, calc(100vw - 80px));\n  min-width: 680px;\n  padding: 18px 24px 20px;\n}\n\n.quote-text {\n  font-family: \"Source Serif 4\", serif;\n  font-size: clamp(29px, 2.25vw, 55px);\n  line-height: 1.22;\n  font-weight: 600;\n}\n\n.quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(16px, 1.1vw, 26px);\n  font-weight: 700;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n  opacity: .9;\n}\n\n.announce-panel {\n  display: flex;\n  align-items: center;\n  gap: 16px;\n  min-width: 640px;\n  max-width: min(1280px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.tag-box {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  border-radius: 10px;\n  padding: 9px 14px;\n  font-size: 14px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.keyword-panel {\n  display: inline-flex;\n  align-items: center;\n  gap: 14px;\n  max-width: min(1250px, calc(100vw - 80px));\n  padding: 12px 16px;\n}\n\n.keyword-main {\n  font-size: clamp(30px, 2.35vw, 56px);\n  font-weight: 800;\n  line-height: 1;\n  letter-spacing: .01em;\n  text-transform: uppercase;\n}\n\n.keyword-sub {\n  font-size: clamp(16px, 1.06vw, 24px);\n  font-weight: 600;\n  opacity: .92;\n}\n\n.date-shell {\n  display: flex;\n  align-items: stretch;\n  gap: 14px;\n  min-width: 650px;\n  max-width: min(1180px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.date-box {\n  min-width: 92px;\n  border-radius: 10px;\n  background: var(--accent, #4a6bcb);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 8px 10px;\n}\n\n.date-box .mth {\n  font-size: 14px;\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n.date-box .dy {\n  font-size: 36px;\n  font-weight: 800;\n  line-height: 1;\n}\n\n.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: var(--bg, rgba(16,16,16,.78));\n  border: 1px solid var(--bd, rgba(255,255,255,.18));\n  box-shadow: 0 10px 24px rgba(0,0,0,.28);\n  color: var(--fg, #fff);\n}\n\n.dot {\n  width: 10px;\n  height: 10px;\n  border-radius: 999px;\n  background: var(--accent, #e53935);\n  animation: pulse 1.6s ease-in-out infinite;\n}\n\n.pill-label {\n  font-size: 13px;\n  text-transform: uppercase;\n  letter-spacing: .11em;\n  font-weight: 700;\n  color: var(--accent, #e53935);\n}\n\n.pill-time {\n  font-size: 24px;\n  font-weight: 800;\n  letter-spacing: .08em;\n  font-variant-numeric: tabular-nums;\n}\n\n.pill-context {\n  font-size: 14px;\n  font-weight: 600;\n  opacity: .9;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n.social-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 12px 14px;\n}\n\n.platform-pill {\n  background: rgba(255,255,255,.14);\n  border-radius: 999px;\n  padding: 7px 11px;\n  font-size: 13px;\n  text-transform: uppercase;\n  font-weight: 700;\n  letter-spacing: .08em;\n}\n\n.handle {\n  font-size: clamp(21px, 1.56vw, 34px);\n  font-weight: 700;\n}\n\n.ticker-shell {\n  width: min(1880px, calc(100vw - 24px));\n  margin: 0 auto 10px;\n  height: 56px;\n  border-radius: 12px;\n  overflow: hidden;\n  background: var(--bg, #111);\n  border: 1px solid var(--bd, rgba(255,255,255,.14));\n  box-shadow: 0 10px 26px rgba(0,0,0,.35);\n  display: flex;\n  align-items: stretch;\n}\n\n.ticker-badge {\n  background: var(--accent, #4a6bcb);\n  color: var(--tagFg, #fff);\n  min-width: 142px;\n  padding: 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .09em;\n}\n\n.ticker-track {\n  flex: 1;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n}\n\n.ticker-move {\n  display: inline-flex;\n  white-space: nowrap;\n  gap: 48px;\n  padding-left: 28px;\n  font-size: 18px;\n  font-weight: 600;\n  letter-spacing: .01em;\n  animation: tickerMove var(--speed, 20s) linear infinite;\n}\n\n.info-panel {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  padding: 14px 18px;\n}\n\n.line-list {\n  margin-top: 8px;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n  font-size: clamp(16px, 1vw, 22px);\n  font-weight: 600;\n  line-height: 1.25;\n}\n\n@media (max-width: 1180px) {\n  .pos-bl, .pos-br, .pos-bc, .pos-tl, .pos-tr, .pos-tc { left: 20px; right: 20px; transform: none; }\n  .pos-br, .pos-tr { left: auto; }\n  .pos-bc, .pos-tc { left: 20px; right: 20px; }\n  .speaker-panel, .quote-panel, .announce-panel, .date-shell, .social-row, .info-panel { min-width: 0; max-width: calc(100vw - 40px); }\n  .speaker-panel { padding: 14px 16px; gap: 14px; }\n  .logo-box { width: 116px; min-width: 116px; height: 70px; }\n  .logo-box.logo-round { width: 64px; min-width: 64px; height: 64px; }\n  .v-divider { height: 70px; }\n}\n"
  },
  {
    "id": "lt-205-youth-scripture-glow-electric-indigo",
    "name": "Scripture Glow — Electric Indigo",
    "description": "Scripture panel with focused readability and gentle glow.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#38bdf8",
    "tags": [
      "bible",
      "scripture",
      "verse",
      "animated",
      "in-out",
      "modern-youth",
      "electric-indigo"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Do not be conformed to this world, but be transformed by the renewing of your mind.",
        "placeholder": "Verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Romans 12:2",
        "placeholder": "Reference",
        "required": true,
        "group": "Content"
      },
      {
        "key": "state",
        "label": "Animation State",
        "type": "select",
        "defaultValue": "in",
        "options": [
          {
            "label": "Animate In",
            "value": "in"
          },
          {
            "label": "Animate Out",
            "value": "out"
          }
        ],
        "group": "Animation"
      },
      {
        "key": "animMode",
        "label": "Animation Mode",
        "type": "select",
        "defaultValue": "slow",
        "options": [
          {
            "label": "Staggered",
            "value": "stagger"
          },
          {
            "label": "Together Slow",
            "value": "slow"
          },
          {
            "label": "Together",
            "value": "together"
          }
        ],
        "group": "Animation"
      }
    ],
    "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#0b122a;--bg2:#16203f;--fg:#f8fbff;--accent:#38bdf8;--muted:rgba(230,245,255,.82);--border:rgba(56,189,248,.34);--glow:rgba(56,189,248,.26);\">\n  <div class=\"y-shell y-scripture\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-scripture-main y-enter-1\">{{verseText}}</p>\n    <p class=\"y-scripture-ref y-enter-2\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 650,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Outfit\", sans-serif; }\n\n.ylt {\n  position: fixed;\n  z-index: 50;\n  pointer-events: none;\n  color: var(--fg, #ffffff);\n  --bg1: #0f172a;\n  --bg2: #111827;\n  --accent: #38bdf8;\n  --muted: rgba(255,255,255,.75);\n  --border: rgba(255,255,255,.22);\n  --glow: rgba(56,189,248,.24);\n}\n\n.y-pos-bl { left: 34px; bottom: 30px; }\n.y-pos-br { right: 34px; bottom: 30px; }\n.y-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.y-pos-tl { left: 34px; top: 30px; }\n.y-pos-tr { right: 34px; top: 30px; }\n.y-pos-tc { left: 50%; top: 30px; transform: translateX(-50%); }\n\n.y-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow:\n    0 14px 44px rgba(0,0,0,.42),\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 0 24px var(--glow);\n}\n\n.y-shell::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(420px 180px at 0% 100%, rgba(255,255,255,.1), transparent 70%),\n    linear-gradient(95deg, transparent 0 32%, rgba(255,255,255,.08) 48%, transparent 66%);\n  mix-blend-mode: screen;\n  pointer-events: none;\n}\n\n.y-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .92;\n}\n\n.y-shell,\n.y-enter-1,\n.y-enter-2,\n.y-enter-3 {\n  opacity: 0;\n}\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-shell,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-1,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-2,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-3,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-shell,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-1,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-2,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-3 {\n  opacity: 1;\n}\n\n.y-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .14em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-line1 {\n  font-size: clamp(27px, 2.15vw, 50px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .005em;\n}\n\n.y-line2 {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 30px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--muted);\n}\n\n.y-meta {\n  margin-top: 10px;\n  font-size: clamp(13px, .95vw, 21px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-speaker {\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 76px));\n  border-radius: 16px;\n  padding: 16px 20px;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.y-logo {\n  width: 128px;\n  min-width: 128px;\n  height: 78px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.07);\n  border: 1px solid rgba(255,255,255,.2);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.y-logo img {\n  max-width: 100%;\n  max-height: 100%;\n  object-fit: contain;\n}\n\n.y-vline {\n  width: 5px;\n  min-width: 5px;\n  height: 80px;\n  border-radius: 3px;\n  background: var(--accent);\n}\n\n.y-speaker-text { min-width: 0; display: flex; flex-direction: column; }\n.y-speaker-name { font-size: clamp(29px, 2.45vw, 56px); font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: .007em; }\n.y-speaker-role { margin-top: 8px; font-size: clamp(18px, 1.5vw, 34px); font-weight: 500; color: var(--muted); line-height: 1.15; }\n\n.y-quote {\n  min-width: 720px;\n  max-width: min(1450px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-quote-main {\n  margin-top: 8px;\n  font-size: clamp(26px, 2.05vw, 46px);\n  line-height: 1.2;\n  font-weight: 700;\n  font-family: \"Sora\", sans-serif;\n}\n\n.y-quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-ann {\n  min-width: 650px;\n  max-width: min(1280px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-tag {\n  padding: 8px 12px;\n  border-radius: 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  font-weight: 800;\n  white-space: nowrap;\n}\n\n.y-ann-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.y-keyword {\n  min-width: 620px;\n  max-width: min(1220px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 15px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-key-main {\n  font-size: clamp(30px, 2.5vw, 60px);\n  line-height: 1;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .015em;\n}\n\n.y-key-sub {\n  font-size: clamp(15px, 1.05vw, 23px);\n  font-weight: 600;\n  color: var(--muted);\n}\n\n.y-scripture {\n  min-width: 720px;\n  max-width: min(1460px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-scripture-main {\n  margin-top: 7px;\n  font-size: clamp(25px, 2vw, 44px);\n  line-height: 1.24;\n  font-weight: 600;\n}\n\n.y-scripture-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-event {\n  min-width: 660px;\n  max-width: min(1200px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: stretch;\n  gap: 12px;\n}\n\n.y-date {\n  min-width: 90px;\n  border-radius: 12px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 8px;\n}\n\n.y-date .m { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }\n.y-date .d { font-size: 34px; font-weight: 800; line-height: 1; }\n\n.y-event-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }\n\n.y-social {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 999px;\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.y-platform {\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(255,255,255,.16);\n  font-size: 12px;\n  letter-spacing: .09em;\n  text-transform: uppercase;\n  font-weight: 700;\n}\n\n.y-handle {\n  font-size: clamp(20px, 1.5vw, 32px);\n  font-weight: 700;\n}\n\n.y-give {\n  min-width: 580px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.y-lyrics {\n  min-width: 620px;\n  max-width: min(1260px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 13px 16px;\n}\n\n.y-lyric-1 {\n  font-size: clamp(24px, 1.9vw, 42px);\n  line-height: 1.08;\n  font-weight: 700;\n}\n\n.y-lyric-2 {\n  margin-top: 6px;\n  font-size: clamp(22px, 1.75vw, 38px);\n  line-height: 1.08;\n  font-weight: 800;\n  color: var(--accent);\n}\n\n.y-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 11px;\n  padding: 10px 15px;\n  border-radius: 999px;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow: 0 10px 28px rgba(0,0,0,.34), 0 0 14px var(--glow);\n}\n\n.y-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 999px;\n  background: var(--accent);\n  box-shadow: 0 0 8px var(--accent);\n}\n\n.y-pill-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }\n.y-pill-time { font-size: 24px; font-weight: 800; letter-spacing: .08em; font-variant-numeric: tabular-nums; }\n.y-pill-context { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); }\n\n@keyframes yBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.96); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes yBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(2px); }\n}\n@keyframes yTextInUp {\n  from { opacity: 0; transform: translateY(14px); filter: blur(1px); }\n  to { opacity: 1; transform: translateY(0); filter: blur(0); }\n}\n@keyframes yTextInFade {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes yTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-11px); }\n}\n@keyframes yTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n/* IN: stagger (background -> first text -> second text/meta) */\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-shell { animation: yBgIn .46s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .16s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextInFade .32s cubic-bezier(0.16,1,0.3,1) .39s both; }\n\n/* OUT: first text -> second text/meta -> background */\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextOutUp .26s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextOutDown .22s cubic-bezier(.4,0,1,1) .15s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-shell { animation: yBgOut .34s cubic-bezier(.4,0,1,1) .24s both; }\n\n/* IN: together-slow */\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-shell { animation: yBgIn .8s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextInUp .64s cubic-bezier(0.16,1,0.3,1) .18s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextInUp .66s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextInFade .64s cubic-bezier(0.16,1,0.3,1) .36s both; }\n\n/* OUT: slow */\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextOutDown .34s cubic-bezier(.4,0,1,1) .1s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextOutDown .31s cubic-bezier(.4,0,1,1) .2s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-shell { animation: yBgOut .45s cubic-bezier(.4,0,1,1) .34s both; }\n\n/* IN/OUT: together */\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-shell { animation: yBgIn .55s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-1 { animation: yTextInUp .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-2 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-3 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-1,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-2,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-3 {\n  animation: yTextOutUp .3s cubic-bezier(.4,0,1,1) both;\n}\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-shell { animation: yBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .y-pos-bl, .y-pos-br, .y-pos-bc, .y-pos-tl, .y-pos-tr, .y-pos-tc { left: 18px; right: 18px; transform: none; }\n  .y-pos-br, .y-pos-tr { left: auto; }\n  .y-pos-bc, .y-pos-tc { left: 18px; right: 18px; }\n  .y-speaker, .y-quote, .y-ann, .y-keyword, .y-scripture, .y-event, .y-social, .y-give, .y-lyrics { min-width: 0; max-width: calc(100vw - 36px); }\n  .y-speaker { padding: 12px 14px; gap: 11px; }\n  .y-logo { width: 92px; min-width: 92px; height: 58px; }\n  .y-vline { height: 58px; }\n}\n"
  },
  {
    "id": "lt-215-youth-scripture-glow-vibe-magenta",
    "name": "Scripture Glow — Vibe Magenta",
    "description": "Scripture panel with focused readability and gentle glow.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#f472b6",
    "tags": [
      "bible",
      "scripture",
      "verse",
      "animated",
      "in-out",
      "modern-youth",
      "vibe-magenta"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Do not be conformed to this world, but be transformed by the renewing of your mind.",
        "placeholder": "Verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Romans 12:2",
        "placeholder": "Reference",
        "required": true,
        "group": "Content"
      },
      {
        "key": "state",
        "label": "Animation State",
        "type": "select",
        "defaultValue": "in",
        "options": [
          {
            "label": "Animate In",
            "value": "in"
          },
          {
            "label": "Animate Out",
            "value": "out"
          }
        ],
        "group": "Animation"
      },
      {
        "key": "animMode",
        "label": "Animation Mode",
        "type": "select",
        "defaultValue": "slow",
        "options": [
          {
            "label": "Staggered",
            "value": "stagger"
          },
          {
            "label": "Together Slow",
            "value": "slow"
          },
          {
            "label": "Together",
            "value": "together"
          }
        ],
        "group": "Animation"
      }
    ],
    "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#1e1232;--bg2:#2a1442;--fg:#fff6fd;--accent:#f472b6;--muted:rgba(255,227,248,.82);--border:rgba(244,114,182,.33);--glow:rgba(244,114,182,.24);\">\n  <div class=\"y-shell y-scripture\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-scripture-main y-enter-1\">{{verseText}}</p>\n    <p class=\"y-scripture-ref y-enter-2\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 650,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Outfit\", sans-serif; }\n\n.ylt {\n  position: fixed;\n  z-index: 50;\n  pointer-events: none;\n  color: var(--fg, #ffffff);\n  --bg1: #0f172a;\n  --bg2: #111827;\n  --accent: #38bdf8;\n  --muted: rgba(255,255,255,.75);\n  --border: rgba(255,255,255,.22);\n  --glow: rgba(56,189,248,.24);\n}\n\n.y-pos-bl { left: 34px; bottom: 30px; }\n.y-pos-br { right: 34px; bottom: 30px; }\n.y-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.y-pos-tl { left: 34px; top: 30px; }\n.y-pos-tr { right: 34px; top: 30px; }\n.y-pos-tc { left: 50%; top: 30px; transform: translateX(-50%); }\n\n.y-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow:\n    0 14px 44px rgba(0,0,0,.42),\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 0 24px var(--glow);\n}\n\n.y-shell::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(420px 180px at 0% 100%, rgba(255,255,255,.1), transparent 70%),\n    linear-gradient(95deg, transparent 0 32%, rgba(255,255,255,.08) 48%, transparent 66%);\n  mix-blend-mode: screen;\n  pointer-events: none;\n}\n\n.y-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .92;\n}\n\n.y-shell,\n.y-enter-1,\n.y-enter-2,\n.y-enter-3 {\n  opacity: 0;\n}\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-shell,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-1,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-2,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-3,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-shell,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-1,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-2,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-3 {\n  opacity: 1;\n}\n\n.y-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .14em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-line1 {\n  font-size: clamp(27px, 2.15vw, 50px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .005em;\n}\n\n.y-line2 {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 30px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--muted);\n}\n\n.y-meta {\n  margin-top: 10px;\n  font-size: clamp(13px, .95vw, 21px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-speaker {\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 76px));\n  border-radius: 16px;\n  padding: 16px 20px;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.y-logo {\n  width: 128px;\n  min-width: 128px;\n  height: 78px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.07);\n  border: 1px solid rgba(255,255,255,.2);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.y-logo img {\n  max-width: 100%;\n  max-height: 100%;\n  object-fit: contain;\n}\n\n.y-vline {\n  width: 5px;\n  min-width: 5px;\n  height: 80px;\n  border-radius: 3px;\n  background: var(--accent);\n}\n\n.y-speaker-text { min-width: 0; display: flex; flex-direction: column; }\n.y-speaker-name { font-size: clamp(29px, 2.45vw, 56px); font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: .007em; }\n.y-speaker-role { margin-top: 8px; font-size: clamp(18px, 1.5vw, 34px); font-weight: 500; color: var(--muted); line-height: 1.15; }\n\n.y-quote {\n  min-width: 720px;\n  max-width: min(1450px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-quote-main {\n  margin-top: 8px;\n  font-size: clamp(26px, 2.05vw, 46px);\n  line-height: 1.2;\n  font-weight: 700;\n  font-family: \"Sora\", sans-serif;\n}\n\n.y-quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-ann {\n  min-width: 650px;\n  max-width: min(1280px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-tag {\n  padding: 8px 12px;\n  border-radius: 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  font-weight: 800;\n  white-space: nowrap;\n}\n\n.y-ann-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.y-keyword {\n  min-width: 620px;\n  max-width: min(1220px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 15px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-key-main {\n  font-size: clamp(30px, 2.5vw, 60px);\n  line-height: 1;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .015em;\n}\n\n.y-key-sub {\n  font-size: clamp(15px, 1.05vw, 23px);\n  font-weight: 600;\n  color: var(--muted);\n}\n\n.y-scripture {\n  min-width: 720px;\n  max-width: min(1460px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-scripture-main {\n  margin-top: 7px;\n  font-size: clamp(25px, 2vw, 44px);\n  line-height: 1.24;\n  font-weight: 600;\n}\n\n.y-scripture-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-event {\n  min-width: 660px;\n  max-width: min(1200px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: stretch;\n  gap: 12px;\n}\n\n.y-date {\n  min-width: 90px;\n  border-radius: 12px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 8px;\n}\n\n.y-date .m { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }\n.y-date .d { font-size: 34px; font-weight: 800; line-height: 1; }\n\n.y-event-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }\n\n.y-social {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 999px;\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.y-platform {\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(255,255,255,.16);\n  font-size: 12px;\n  letter-spacing: .09em;\n  text-transform: uppercase;\n  font-weight: 700;\n}\n\n.y-handle {\n  font-size: clamp(20px, 1.5vw, 32px);\n  font-weight: 700;\n}\n\n.y-give {\n  min-width: 580px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.y-lyrics {\n  min-width: 620px;\n  max-width: min(1260px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 13px 16px;\n}\n\n.y-lyric-1 {\n  font-size: clamp(24px, 1.9vw, 42px);\n  line-height: 1.08;\n  font-weight: 700;\n}\n\n.y-lyric-2 {\n  margin-top: 6px;\n  font-size: clamp(22px, 1.75vw, 38px);\n  line-height: 1.08;\n  font-weight: 800;\n  color: var(--accent);\n}\n\n.y-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 11px;\n  padding: 10px 15px;\n  border-radius: 999px;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow: 0 10px 28px rgba(0,0,0,.34), 0 0 14px var(--glow);\n}\n\n.y-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 999px;\n  background: var(--accent);\n  box-shadow: 0 0 8px var(--accent);\n}\n\n.y-pill-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }\n.y-pill-time { font-size: 24px; font-weight: 800; letter-spacing: .08em; font-variant-numeric: tabular-nums; }\n.y-pill-context { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); }\n\n@keyframes yBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.96); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes yBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(2px); }\n}\n@keyframes yTextInUp {\n  from { opacity: 0; transform: translateY(14px); filter: blur(1px); }\n  to { opacity: 1; transform: translateY(0); filter: blur(0); }\n}\n@keyframes yTextInFade {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes yTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-11px); }\n}\n@keyframes yTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n/* IN: stagger (background -> first text -> second text/meta) */\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-shell { animation: yBgIn .46s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .16s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextInFade .32s cubic-bezier(0.16,1,0.3,1) .39s both; }\n\n/* OUT: first text -> second text/meta -> background */\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextOutUp .26s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextOutDown .22s cubic-bezier(.4,0,1,1) .15s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-shell { animation: yBgOut .34s cubic-bezier(.4,0,1,1) .24s both; }\n\n/* IN: together-slow */\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-shell { animation: yBgIn .8s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextInUp .64s cubic-bezier(0.16,1,0.3,1) .18s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextInUp .66s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextInFade .64s cubic-bezier(0.16,1,0.3,1) .36s both; }\n\n/* OUT: slow */\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextOutDown .34s cubic-bezier(.4,0,1,1) .1s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextOutDown .31s cubic-bezier(.4,0,1,1) .2s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-shell { animation: yBgOut .45s cubic-bezier(.4,0,1,1) .34s both; }\n\n/* IN/OUT: together */\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-shell { animation: yBgIn .55s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-1 { animation: yTextInUp .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-2 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-3 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-1,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-2,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-3 {\n  animation: yTextOutUp .3s cubic-bezier(.4,0,1,1) both;\n}\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-shell { animation: yBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .y-pos-bl, .y-pos-br, .y-pos-bc, .y-pos-tl, .y-pos-tr, .y-pos-tc { left: 18px; right: 18px; transform: none; }\n  .y-pos-br, .y-pos-tr { left: auto; }\n  .y-pos-bc, .y-pos-tc { left: 18px; right: 18px; }\n  .y-speaker, .y-quote, .y-ann, .y-keyword, .y-scripture, .y-event, .y-social, .y-give, .y-lyrics { min-width: 0; max-width: calc(100vw - 36px); }\n  .y-speaker { padding: 12px 14px; gap: 11px; }\n  .y-logo { width: 92px; min-width: 92px; height: 58px; }\n  .y-vline { height: 58px; }\n}\n"
  },
  {
    "id": "lt-225-youth-scripture-glow-teal-wave",
    "name": "Scripture Glow — Teal Wave",
    "description": "Scripture panel with focused readability and gentle glow.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#2dd4bf",
    "tags": [
      "bible",
      "scripture",
      "verse",
      "animated",
      "in-out",
      "modern-youth",
      "teal-wave"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Do not be conformed to this world, but be transformed by the renewing of your mind.",
        "placeholder": "Verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Romans 12:2",
        "placeholder": "Reference",
        "required": true,
        "group": "Content"
      },
      {
        "key": "state",
        "label": "Animation State",
        "type": "select",
        "defaultValue": "in",
        "options": [
          {
            "label": "Animate In",
            "value": "in"
          },
          {
            "label": "Animate Out",
            "value": "out"
          }
        ],
        "group": "Animation"
      },
      {
        "key": "animMode",
        "label": "Animation Mode",
        "type": "select",
        "defaultValue": "slow",
        "options": [
          {
            "label": "Staggered",
            "value": "stagger"
          },
          {
            "label": "Together Slow",
            "value": "slow"
          },
          {
            "label": "Together",
            "value": "together"
          }
        ],
        "group": "Animation"
      }
    ],
    "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#072223;--bg2:#0c3134;--fg:#f1ffff;--accent:#2dd4bf;--muted:rgba(218,255,248,.8);--border:rgba(45,212,191,.33);--glow:rgba(45,212,191,.24);\">\n  <div class=\"y-shell y-scripture\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-scripture-main y-enter-1\">{{verseText}}</p>\n    <p class=\"y-scripture-ref y-enter-2\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 650,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Outfit\", sans-serif; }\n\n.ylt {\n  position: fixed;\n  z-index: 50;\n  pointer-events: none;\n  color: var(--fg, #ffffff);\n  --bg1: #0f172a;\n  --bg2: #111827;\n  --accent: #38bdf8;\n  --muted: rgba(255,255,255,.75);\n  --border: rgba(255,255,255,.22);\n  --glow: rgba(56,189,248,.24);\n}\n\n.y-pos-bl { left: 34px; bottom: 30px; }\n.y-pos-br { right: 34px; bottom: 30px; }\n.y-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.y-pos-tl { left: 34px; top: 30px; }\n.y-pos-tr { right: 34px; top: 30px; }\n.y-pos-tc { left: 50%; top: 30px; transform: translateX(-50%); }\n\n.y-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow:\n    0 14px 44px rgba(0,0,0,.42),\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 0 24px var(--glow);\n}\n\n.y-shell::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(420px 180px at 0% 100%, rgba(255,255,255,.1), transparent 70%),\n    linear-gradient(95deg, transparent 0 32%, rgba(255,255,255,.08) 48%, transparent 66%);\n  mix-blend-mode: screen;\n  pointer-events: none;\n}\n\n.y-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .92;\n}\n\n.y-shell,\n.y-enter-1,\n.y-enter-2,\n.y-enter-3 {\n  opacity: 0;\n}\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-shell,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-1,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-2,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-3,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-shell,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-1,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-2,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-3 {\n  opacity: 1;\n}\n\n.y-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .14em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-line1 {\n  font-size: clamp(27px, 2.15vw, 50px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .005em;\n}\n\n.y-line2 {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 30px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--muted);\n}\n\n.y-meta {\n  margin-top: 10px;\n  font-size: clamp(13px, .95vw, 21px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-speaker {\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 76px));\n  border-radius: 16px;\n  padding: 16px 20px;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.y-logo {\n  width: 128px;\n  min-width: 128px;\n  height: 78px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.07);\n  border: 1px solid rgba(255,255,255,.2);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.y-logo img {\n  max-width: 100%;\n  max-height: 100%;\n  object-fit: contain;\n}\n\n.y-vline {\n  width: 5px;\n  min-width: 5px;\n  height: 80px;\n  border-radius: 3px;\n  background: var(--accent);\n}\n\n.y-speaker-text { min-width: 0; display: flex; flex-direction: column; }\n.y-speaker-name { font-size: clamp(29px, 2.45vw, 56px); font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: .007em; }\n.y-speaker-role { margin-top: 8px; font-size: clamp(18px, 1.5vw, 34px); font-weight: 500; color: var(--muted); line-height: 1.15; }\n\n.y-quote {\n  min-width: 720px;\n  max-width: min(1450px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-quote-main {\n  margin-top: 8px;\n  font-size: clamp(26px, 2.05vw, 46px);\n  line-height: 1.2;\n  font-weight: 700;\n  font-family: \"Sora\", sans-serif;\n}\n\n.y-quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-ann {\n  min-width: 650px;\n  max-width: min(1280px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-tag {\n  padding: 8px 12px;\n  border-radius: 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  font-weight: 800;\n  white-space: nowrap;\n}\n\n.y-ann-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.y-keyword {\n  min-width: 620px;\n  max-width: min(1220px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 15px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-key-main {\n  font-size: clamp(30px, 2.5vw, 60px);\n  line-height: 1;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .015em;\n}\n\n.y-key-sub {\n  font-size: clamp(15px, 1.05vw, 23px);\n  font-weight: 600;\n  color: var(--muted);\n}\n\n.y-scripture {\n  min-width: 720px;\n  max-width: min(1460px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-scripture-main {\n  margin-top: 7px;\n  font-size: clamp(25px, 2vw, 44px);\n  line-height: 1.24;\n  font-weight: 600;\n}\n\n.y-scripture-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-event {\n  min-width: 660px;\n  max-width: min(1200px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: stretch;\n  gap: 12px;\n}\n\n.y-date {\n  min-width: 90px;\n  border-radius: 12px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 8px;\n}\n\n.y-date .m { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }\n.y-date .d { font-size: 34px; font-weight: 800; line-height: 1; }\n\n.y-event-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }\n\n.y-social {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 999px;\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.y-platform {\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(255,255,255,.16);\n  font-size: 12px;\n  letter-spacing: .09em;\n  text-transform: uppercase;\n  font-weight: 700;\n}\n\n.y-handle {\n  font-size: clamp(20px, 1.5vw, 32px);\n  font-weight: 700;\n}\n\n.y-give {\n  min-width: 580px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.y-lyrics {\n  min-width: 620px;\n  max-width: min(1260px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 13px 16px;\n}\n\n.y-lyric-1 {\n  font-size: clamp(24px, 1.9vw, 42px);\n  line-height: 1.08;\n  font-weight: 700;\n}\n\n.y-lyric-2 {\n  margin-top: 6px;\n  font-size: clamp(22px, 1.75vw, 38px);\n  line-height: 1.08;\n  font-weight: 800;\n  color: var(--accent);\n}\n\n.y-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 11px;\n  padding: 10px 15px;\n  border-radius: 999px;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow: 0 10px 28px rgba(0,0,0,.34), 0 0 14px var(--glow);\n}\n\n.y-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 999px;\n  background: var(--accent);\n  box-shadow: 0 0 8px var(--accent);\n}\n\n.y-pill-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }\n.y-pill-time { font-size: 24px; font-weight: 800; letter-spacing: .08em; font-variant-numeric: tabular-nums; }\n.y-pill-context { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); }\n\n@keyframes yBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.96); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes yBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(2px); }\n}\n@keyframes yTextInUp {\n  from { opacity: 0; transform: translateY(14px); filter: blur(1px); }\n  to { opacity: 1; transform: translateY(0); filter: blur(0); }\n}\n@keyframes yTextInFade {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes yTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-11px); }\n}\n@keyframes yTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n/* IN: stagger (background -> first text -> second text/meta) */\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-shell { animation: yBgIn .46s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .16s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextInFade .32s cubic-bezier(0.16,1,0.3,1) .39s both; }\n\n/* OUT: first text -> second text/meta -> background */\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextOutUp .26s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextOutDown .22s cubic-bezier(.4,0,1,1) .15s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-shell { animation: yBgOut .34s cubic-bezier(.4,0,1,1) .24s both; }\n\n/* IN: together-slow */\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-shell { animation: yBgIn .8s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextInUp .64s cubic-bezier(0.16,1,0.3,1) .18s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextInUp .66s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextInFade .64s cubic-bezier(0.16,1,0.3,1) .36s both; }\n\n/* OUT: slow */\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextOutDown .34s cubic-bezier(.4,0,1,1) .1s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextOutDown .31s cubic-bezier(.4,0,1,1) .2s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-shell { animation: yBgOut .45s cubic-bezier(.4,0,1,1) .34s both; }\n\n/* IN/OUT: together */\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-shell { animation: yBgIn .55s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-1 { animation: yTextInUp .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-2 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-3 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-1,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-2,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-3 {\n  animation: yTextOutUp .3s cubic-bezier(.4,0,1,1) both;\n}\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-shell { animation: yBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .y-pos-bl, .y-pos-br, .y-pos-bc, .y-pos-tl, .y-pos-tr, .y-pos-tc { left: 18px; right: 18px; transform: none; }\n  .y-pos-br, .y-pos-tr { left: auto; }\n  .y-pos-bc, .y-pos-tc { left: 18px; right: 18px; }\n  .y-speaker, .y-quote, .y-ann, .y-keyword, .y-scripture, .y-event, .y-social, .y-give, .y-lyrics { min-width: 0; max-width: calc(100vw - 36px); }\n  .y-speaker { padding: 12px 14px; gap: 11px; }\n  .y-logo { width: 92px; min-width: 92px; height: 58px; }\n  .y-vline { height: 58px; }\n}\n"
  },
  {
    "id": "lt-235-youth-scripture-glow-sunrise-orange",
    "name": "Scripture Glow — Sunrise Orange",
    "description": "Scripture panel with focused readability and gentle glow.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#fb923c",
    "tags": [
      "bible",
      "scripture",
      "verse",
      "animated",
      "in-out",
      "modern-youth",
      "sunrise-orange"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Do not be conformed to this world, but be transformed by the renewing of your mind.",
        "placeholder": "Verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Romans 12:2",
        "placeholder": "Reference",
        "required": true,
        "group": "Content"
      },
      {
        "key": "state",
        "label": "Animation State",
        "type": "select",
        "defaultValue": "in",
        "options": [
          {
            "label": "Animate In",
            "value": "in"
          },
          {
            "label": "Animate Out",
            "value": "out"
          }
        ],
        "group": "Animation"
      },
      {
        "key": "animMode",
        "label": "Animation Mode",
        "type": "select",
        "defaultValue": "slow",
        "options": [
          {
            "label": "Staggered",
            "value": "stagger"
          },
          {
            "label": "Together Slow",
            "value": "slow"
          },
          {
            "label": "Together",
            "value": "together"
          }
        ],
        "group": "Animation"
      }
    ],
    "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#2b150b;--bg2:#3a1d10;--fg:#fff8f2;--accent:#fb923c;--muted:rgba(255,232,214,.82);--border:rgba(251,146,60,.35);--glow:rgba(251,146,60,.23);\">\n  <div class=\"y-shell y-scripture\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-scripture-main y-enter-1\">{{verseText}}</p>\n    <p class=\"y-scripture-ref y-enter-2\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 650,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Outfit\", sans-serif; }\n\n.ylt {\n  position: fixed;\n  z-index: 50;\n  pointer-events: none;\n  color: var(--fg, #ffffff);\n  --bg1: #0f172a;\n  --bg2: #111827;\n  --accent: #38bdf8;\n  --muted: rgba(255,255,255,.75);\n  --border: rgba(255,255,255,.22);\n  --glow: rgba(56,189,248,.24);\n}\n\n.y-pos-bl { left: 34px; bottom: 30px; }\n.y-pos-br { right: 34px; bottom: 30px; }\n.y-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.y-pos-tl { left: 34px; top: 30px; }\n.y-pos-tr { right: 34px; top: 30px; }\n.y-pos-tc { left: 50%; top: 30px; transform: translateX(-50%); }\n\n.y-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow:\n    0 14px 44px rgba(0,0,0,.42),\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 0 24px var(--glow);\n}\n\n.y-shell::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(420px 180px at 0% 100%, rgba(255,255,255,.1), transparent 70%),\n    linear-gradient(95deg, transparent 0 32%, rgba(255,255,255,.08) 48%, transparent 66%);\n  mix-blend-mode: screen;\n  pointer-events: none;\n}\n\n.y-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .92;\n}\n\n.y-shell,\n.y-enter-1,\n.y-enter-2,\n.y-enter-3 {\n  opacity: 0;\n}\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-shell,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-1,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-2,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-3,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-shell,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-1,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-2,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-3 {\n  opacity: 1;\n}\n\n.y-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .14em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-line1 {\n  font-size: clamp(27px, 2.15vw, 50px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .005em;\n}\n\n.y-line2 {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 30px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--muted);\n}\n\n.y-meta {\n  margin-top: 10px;\n  font-size: clamp(13px, .95vw, 21px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-speaker {\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 76px));\n  border-radius: 16px;\n  padding: 16px 20px;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.y-logo {\n  width: 128px;\n  min-width: 128px;\n  height: 78px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.07);\n  border: 1px solid rgba(255,255,255,.2);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.y-logo img {\n  max-width: 100%;\n  max-height: 100%;\n  object-fit: contain;\n}\n\n.y-vline {\n  width: 5px;\n  min-width: 5px;\n  height: 80px;\n  border-radius: 3px;\n  background: var(--accent);\n}\n\n.y-speaker-text { min-width: 0; display: flex; flex-direction: column; }\n.y-speaker-name { font-size: clamp(29px, 2.45vw, 56px); font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: .007em; }\n.y-speaker-role { margin-top: 8px; font-size: clamp(18px, 1.5vw, 34px); font-weight: 500; color: var(--muted); line-height: 1.15; }\n\n.y-quote {\n  min-width: 720px;\n  max-width: min(1450px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-quote-main {\n  margin-top: 8px;\n  font-size: clamp(26px, 2.05vw, 46px);\n  line-height: 1.2;\n  font-weight: 700;\n  font-family: \"Sora\", sans-serif;\n}\n\n.y-quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-ann {\n  min-width: 650px;\n  max-width: min(1280px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-tag {\n  padding: 8px 12px;\n  border-radius: 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  font-weight: 800;\n  white-space: nowrap;\n}\n\n.y-ann-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.y-keyword {\n  min-width: 620px;\n  max-width: min(1220px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 15px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-key-main {\n  font-size: clamp(30px, 2.5vw, 60px);\n  line-height: 1;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .015em;\n}\n\n.y-key-sub {\n  font-size: clamp(15px, 1.05vw, 23px);\n  font-weight: 600;\n  color: var(--muted);\n}\n\n.y-scripture {\n  min-width: 720px;\n  max-width: min(1460px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-scripture-main {\n  margin-top: 7px;\n  font-size: clamp(25px, 2vw, 44px);\n  line-height: 1.24;\n  font-weight: 600;\n}\n\n.y-scripture-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-event {\n  min-width: 660px;\n  max-width: min(1200px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: stretch;\n  gap: 12px;\n}\n\n.y-date {\n  min-width: 90px;\n  border-radius: 12px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 8px;\n}\n\n.y-date .m { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }\n.y-date .d { font-size: 34px; font-weight: 800; line-height: 1; }\n\n.y-event-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }\n\n.y-social {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 999px;\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.y-platform {\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(255,255,255,.16);\n  font-size: 12px;\n  letter-spacing: .09em;\n  text-transform: uppercase;\n  font-weight: 700;\n}\n\n.y-handle {\n  font-size: clamp(20px, 1.5vw, 32px);\n  font-weight: 700;\n}\n\n.y-give {\n  min-width: 580px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.y-lyrics {\n  min-width: 620px;\n  max-width: min(1260px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 13px 16px;\n}\n\n.y-lyric-1 {\n  font-size: clamp(24px, 1.9vw, 42px);\n  line-height: 1.08;\n  font-weight: 700;\n}\n\n.y-lyric-2 {\n  margin-top: 6px;\n  font-size: clamp(22px, 1.75vw, 38px);\n  line-height: 1.08;\n  font-weight: 800;\n  color: var(--accent);\n}\n\n.y-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 11px;\n  padding: 10px 15px;\n  border-radius: 999px;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow: 0 10px 28px rgba(0,0,0,.34), 0 0 14px var(--glow);\n}\n\n.y-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 999px;\n  background: var(--accent);\n  box-shadow: 0 0 8px var(--accent);\n}\n\n.y-pill-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }\n.y-pill-time { font-size: 24px; font-weight: 800; letter-spacing: .08em; font-variant-numeric: tabular-nums; }\n.y-pill-context { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); }\n\n@keyframes yBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.96); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes yBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(2px); }\n}\n@keyframes yTextInUp {\n  from { opacity: 0; transform: translateY(14px); filter: blur(1px); }\n  to { opacity: 1; transform: translateY(0); filter: blur(0); }\n}\n@keyframes yTextInFade {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes yTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-11px); }\n}\n@keyframes yTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n/* IN: stagger (background -> first text -> second text/meta) */\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-shell { animation: yBgIn .46s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .16s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextInFade .32s cubic-bezier(0.16,1,0.3,1) .39s both; }\n\n/* OUT: first text -> second text/meta -> background */\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextOutUp .26s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextOutDown .22s cubic-bezier(.4,0,1,1) .15s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-shell { animation: yBgOut .34s cubic-bezier(.4,0,1,1) .24s both; }\n\n/* IN: together-slow */\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-shell { animation: yBgIn .8s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextInUp .64s cubic-bezier(0.16,1,0.3,1) .18s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextInUp .66s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextInFade .64s cubic-bezier(0.16,1,0.3,1) .36s both; }\n\n/* OUT: slow */\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextOutDown .34s cubic-bezier(.4,0,1,1) .1s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextOutDown .31s cubic-bezier(.4,0,1,1) .2s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-shell { animation: yBgOut .45s cubic-bezier(.4,0,1,1) .34s both; }\n\n/* IN/OUT: together */\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-shell { animation: yBgIn .55s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-1 { animation: yTextInUp .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-2 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-3 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-1,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-2,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-3 {\n  animation: yTextOutUp .3s cubic-bezier(.4,0,1,1) both;\n}\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-shell { animation: yBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .y-pos-bl, .y-pos-br, .y-pos-bc, .y-pos-tl, .y-pos-tr, .y-pos-tc { left: 18px; right: 18px; transform: none; }\n  .y-pos-br, .y-pos-tr { left: auto; }\n  .y-pos-bc, .y-pos-tc { left: 18px; right: 18px; }\n  .y-speaker, .y-quote, .y-ann, .y-keyword, .y-scripture, .y-event, .y-social, .y-give, .y-lyrics { min-width: 0; max-width: calc(100vw - 36px); }\n  .y-speaker { padding: 12px 14px; gap: 11px; }\n  .y-logo { width: 92px; min-width: 92px; height: 58px; }\n  .y-vline { height: 58px; }\n}\n"
  },
  {
    "id": "lt-245-youth-scripture-glow-royal-violet",
    "name": "Scripture Glow — Royal Violet",
    "description": "Scripture panel with focused readability and gentle glow.",
    "category": "bible",
    "icon": "menu_book",
    "accentColor": "#a78bfa",
    "tags": [
      "bible",
      "scripture",
      "verse",
      "animated",
      "in-out",
      "modern-youth",
      "royal-violet"
    ],
    "variables": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "defaultValue": "Scripture",
        "placeholder": "e.g. Scripture Reading",
        "group": "Header"
      },
      {
        "key": "verseText",
        "label": "Verse Text",
        "type": "text",
        "defaultValue": "Do not be conformed to this world, but be transformed by the renewing of your mind.",
        "placeholder": "Verse text",
        "required": true,
        "group": "Content"
      },
      {
        "key": "reference",
        "label": "Reference",
        "type": "text",
        "defaultValue": "Romans 12:2",
        "placeholder": "Reference",
        "required": true,
        "group": "Content"
      },
      {
        "key": "state",
        "label": "Animation State",
        "type": "select",
        "defaultValue": "in",
        "options": [
          {
            "label": "Animate In",
            "value": "in"
          },
          {
            "label": "Animate Out",
            "value": "out"
          }
        ],
        "group": "Animation"
      },
      {
        "key": "animMode",
        "label": "Animation Mode",
        "type": "select",
        "defaultValue": "slow",
        "options": [
          {
            "label": "Staggered",
            "value": "stagger"
          },
          {
            "label": "Together Slow",
            "value": "slow"
          },
          {
            "label": "Together",
            "value": "together"
          }
        ],
        "group": "Animation"
      }
    ],
    "html": "<div class=\"ylt y-pos-bc\" data-state=\"{{state}}\" data-mode=\"{{animMode}}\" style=\"--bg1:#1a1338;--bg2:#25194c;--fg:#f8f5ff;--accent:#a78bfa;--muted:rgba(236,229,255,.82);--border:rgba(167,139,250,.34);--glow:rgba(167,139,250,.24);\">\n  <div class=\"y-shell y-scripture\">\n    <span class=\"y-kicker y-enter-3\">{{label}}</span>\n    <p class=\"y-scripture-main y-enter-1\">{{verseText}}</p>\n    <p class=\"y-scripture-ref y-enter-2\">{{reference}}</p>\n  </div>\n</div>",
    "usesTailwind": false,
    "fontImports": [
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
    ],
    "animation": {
      "name": "fadeInUp",
      "duration": 650,
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)"
    },
    "css": "\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }\nbody { font-family: \"Outfit\", sans-serif; }\n\n.ylt {\n  position: fixed;\n  z-index: 50;\n  pointer-events: none;\n  color: var(--fg, #ffffff);\n  --bg1: #0f172a;\n  --bg2: #111827;\n  --accent: #38bdf8;\n  --muted: rgba(255,255,255,.75);\n  --border: rgba(255,255,255,.22);\n  --glow: rgba(56,189,248,.24);\n}\n\n.y-pos-bl { left: 34px; bottom: 30px; }\n.y-pos-br { right: 34px; bottom: 30px; }\n.y-pos-bc { left: 50%; bottom: 30px; transform: translateX(-50%); }\n.y-pos-tl { left: 34px; top: 30px; }\n.y-pos-tr { right: 34px; top: 30px; }\n.y-pos-tc { left: 50%; top: 30px; transform: translateX(-50%); }\n\n.y-shell {\n  position: relative;\n  overflow: hidden;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow:\n    0 14px 44px rgba(0,0,0,.42),\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 0 24px var(--glow);\n}\n\n.y-shell::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(420px 180px at 0% 100%, rgba(255,255,255,.1), transparent 70%),\n    linear-gradient(95deg, transparent 0 32%, rgba(255,255,255,.08) 48%, transparent 66%);\n  mix-blend-mode: screen;\n  pointer-events: none;\n}\n\n.y-shell::after {\n  content: \"\";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 3px;\n  background: linear-gradient(90deg, transparent, var(--accent), transparent);\n  opacity: .92;\n}\n\n.y-shell,\n.y-enter-1,\n.y-enter-2,\n.y-enter-3 {\n  opacity: 0;\n}\n\n/* Fallback visibility when animation vars are missing/unresolved in host renderer */\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-shell,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-1,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-2,\n.ylt:not([data-state=\"in\"]):not([data-state=\"out\"]) .y-enter-3,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-shell,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-1,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-2,\n.ylt:not([data-mode=\"stagger\"]):not([data-mode=\"slow\"]):not([data-mode=\"together\"]) .y-enter-3 {\n  opacity: 1;\n}\n\n.y-kicker {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: .14em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-line1 {\n  font-size: clamp(27px, 2.15vw, 50px);\n  line-height: 1.04;\n  font-weight: 800;\n  letter-spacing: .005em;\n}\n\n.y-line2 {\n  margin-top: 7px;\n  font-size: clamp(17px, 1.3vw, 30px);\n  line-height: 1.18;\n  font-weight: 500;\n  color: var(--muted);\n}\n\n.y-meta {\n  margin-top: 10px;\n  font-size: clamp(13px, .95vw, 21px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-speaker {\n  min-width: 760px;\n  max-width: min(1500px, calc(100vw - 76px));\n  border-radius: 16px;\n  padding: 16px 20px;\n  display: flex;\n  align-items: center;\n  gap: 16px;\n}\n\n.y-logo {\n  width: 128px;\n  min-width: 128px;\n  height: 78px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.07);\n  border: 1px solid rgba(255,255,255,.2);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.y-logo img {\n  max-width: 100%;\n  max-height: 100%;\n  object-fit: contain;\n}\n\n.y-vline {\n  width: 5px;\n  min-width: 5px;\n  height: 80px;\n  border-radius: 3px;\n  background: var(--accent);\n}\n\n.y-speaker-text { min-width: 0; display: flex; flex-direction: column; }\n.y-speaker-name { font-size: clamp(29px, 2.45vw, 56px); font-weight: 800; text-transform: uppercase; line-height: 1; letter-spacing: .007em; }\n.y-speaker-role { margin-top: 8px; font-size: clamp(18px, 1.5vw, 34px); font-weight: 500; color: var(--muted); line-height: 1.15; }\n\n.y-quote {\n  min-width: 720px;\n  max-width: min(1450px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-quote-main {\n  margin-top: 8px;\n  font-size: clamp(26px, 2.05vw, 46px);\n  line-height: 1.2;\n  font-weight: 700;\n  font-family: \"Sora\", sans-serif;\n}\n\n.y-quote-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 600;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--muted);\n}\n\n.y-ann {\n  min-width: 650px;\n  max-width: min(1280px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-tag {\n  padding: 8px 12px;\n  border-radius: 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 12px;\n  letter-spacing: .12em;\n  text-transform: uppercase;\n  font-weight: 800;\n  white-space: nowrap;\n}\n\n.y-ann-copy { min-width: 0; display: flex; flex-direction: column; }\n\n.y-keyword {\n  min-width: 620px;\n  max-width: min(1220px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 15px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.y-key-main {\n  font-size: clamp(30px, 2.5vw, 60px);\n  line-height: 1;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: .015em;\n}\n\n.y-key-sub {\n  font-size: clamp(15px, 1.05vw, 23px);\n  font-weight: 600;\n  color: var(--muted);\n}\n\n.y-scripture {\n  min-width: 720px;\n  max-width: min(1460px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 16px 20px 18px;\n}\n\n.y-scripture-main {\n  margin-top: 7px;\n  font-size: clamp(25px, 2vw, 44px);\n  line-height: 1.24;\n  font-weight: 600;\n}\n\n.y-scripture-ref {\n  margin-top: 10px;\n  text-align: right;\n  font-size: clamp(14px, 1vw, 22px);\n  font-weight: 700;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  color: var(--accent);\n}\n\n.y-event {\n  min-width: 660px;\n  max-width: min(1200px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: stretch;\n  gap: 12px;\n}\n\n.y-date {\n  min-width: 90px;\n  border-radius: 12px;\n  background: var(--accent);\n  color: #fff;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 8px;\n}\n\n.y-date .m { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }\n.y-date .d { font-size: 34px; font-weight: 800; line-height: 1; }\n\n.y-event-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }\n\n.y-social {\n  min-width: 560px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 999px;\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.y-platform {\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(255,255,255,.16);\n  font-size: 12px;\n  letter-spacing: .09em;\n  text-transform: uppercase;\n  font-weight: 700;\n}\n\n.y-handle {\n  font-size: clamp(20px, 1.5vw, 32px);\n  font-weight: 700;\n}\n\n.y-give {\n  min-width: 580px;\n  max-width: min(980px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 14px 16px;\n}\n\n.y-lyrics {\n  min-width: 620px;\n  max-width: min(1260px, calc(100vw - 80px));\n  border-radius: 16px;\n  padding: 13px 16px;\n}\n\n.y-lyric-1 {\n  font-size: clamp(24px, 1.9vw, 42px);\n  line-height: 1.08;\n  font-weight: 700;\n}\n\n.y-lyric-2 {\n  margin-top: 6px;\n  font-size: clamp(22px, 1.75vw, 38px);\n  line-height: 1.08;\n  font-weight: 800;\n  color: var(--accent);\n}\n\n.y-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 11px;\n  padding: 10px 15px;\n  border-radius: 999px;\n  border: 1px solid var(--border);\n  background: linear-gradient(135deg, var(--bg1), var(--bg2));\n  box-shadow: 0 10px 28px rgba(0,0,0,.34), 0 0 14px var(--glow);\n}\n\n.y-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 999px;\n  background: var(--accent);\n  box-shadow: 0 0 8px var(--accent);\n}\n\n.y-pill-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--accent); }\n.y-pill-time { font-size: 24px; font-weight: 800; letter-spacing: .08em; font-variant-numeric: tabular-nums; }\n.y-pill-context { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); }\n\n@keyframes yBgIn {\n  from { opacity: 0; transform: translateY(18px) scale(.96); filter: blur(2px); }\n  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n}\n@keyframes yBgOut {\n  from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }\n  to { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(2px); }\n}\n@keyframes yTextInUp {\n  from { opacity: 0; transform: translateY(14px); filter: blur(1px); }\n  to { opacity: 1; transform: translateY(0); filter: blur(0); }\n}\n@keyframes yTextInFade {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n@keyframes yTextOutUp {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(-11px); }\n}\n@keyframes yTextOutDown {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(10px); }\n}\n\n/* IN: stagger (background -> first text -> second text/meta) */\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-shell { animation: yBgIn .46s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .16s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextInUp .35s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextInFade .32s cubic-bezier(0.16,1,0.3,1) .39s both; }\n\n/* OUT: first text -> second text/meta -> background */\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-1 { animation: yTextOutUp .26s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-2 { animation: yTextOutDown .24s cubic-bezier(.4,0,1,1) .08s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-enter-3 { animation: yTextOutDown .22s cubic-bezier(.4,0,1,1) .15s both; }\n.ylt[data-state=\"out\"][data-mode=\"stagger\"] .y-shell { animation: yBgOut .34s cubic-bezier(.4,0,1,1) .24s both; }\n\n/* IN: together-slow */\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-shell { animation: yBgIn .8s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextInUp .64s cubic-bezier(0.16,1,0.3,1) .18s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextInUp .66s cubic-bezier(0.16,1,0.3,1) .28s both; }\n.ylt[data-state=\"in\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextInFade .64s cubic-bezier(0.16,1,0.3,1) .36s both; }\n\n/* OUT: slow */\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-1 { animation: yTextOutUp .34s cubic-bezier(.4,0,1,1) both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-2 { animation: yTextOutDown .34s cubic-bezier(.4,0,1,1) .1s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-enter-3 { animation: yTextOutDown .31s cubic-bezier(.4,0,1,1) .2s both; }\n.ylt[data-state=\"out\"][data-mode=\"slow\"] .y-shell { animation: yBgOut .45s cubic-bezier(.4,0,1,1) .34s both; }\n\n/* IN/OUT: together */\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-shell { animation: yBgIn .55s cubic-bezier(0.16,1,0.3,1) both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-1 { animation: yTextInUp .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-2 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n.ylt[data-state=\"in\"][data-mode=\"together\"] .y-enter-3 { animation: yTextInFade .48s cubic-bezier(0.16,1,0.3,1) .12s both; }\n\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-1,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-2,\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-enter-3 {\n  animation: yTextOutUp .3s cubic-bezier(.4,0,1,1) both;\n}\n.ylt[data-state=\"out\"][data-mode=\"together\"] .y-shell { animation: yBgOut .36s cubic-bezier(.4,0,1,1) .14s both; }\n\n@media (max-width: 1180px) {\n  .y-pos-bl, .y-pos-br, .y-pos-bc, .y-pos-tl, .y-pos-tr, .y-pos-tc { left: 18px; right: 18px; transform: none; }\n  .y-pos-br, .y-pos-tr { left: auto; }\n  .y-pos-bc, .y-pos-tc { left: 18px; right: 18px; }\n  .y-speaker, .y-quote, .y-ann, .y-keyword, .y-scripture, .y-event, .y-social, .y-give, .y-lyrics { min-width: 0; max-width: calc(100vw - 36px); }\n  .y-speaker { padding: 12px 14px; gap: 11px; }\n  .y-logo { width: 92px; min-width: 92px; height: 58px; }\n  .y-vline { height: 58px; }\n}\n"
  }
];

export const BIBLE_THEME_COUNT = BIBLE_THEMES.length;
export const BIBLE_THEME_IDS = BIBLE_THEMES.map((theme) => String(theme.id));

export function getBibleThemeById(id: string): ThemeLike | undefined {
  return BIBLE_THEMES.find((theme) => String(theme.id) === id);
}

const BIBLE_VARIANTS_DEFAULT = buildLightDarkVariants(
  BIBLE_THEMES,
  DEFAULT_CHURCH_PRIMARY_COLOR,
);

export const BIBLE_THEMES_LIGHT: ThemeLike[] = BIBLE_VARIANTS_DEFAULT.light;
export const BIBLE_THEMES_DARK: ThemeLike[] = BIBLE_VARIANTS_DEFAULT.dark;
export const BIBLE_THEMES_LIGHT_DARK: ThemeLike[] = BIBLE_VARIANTS_DEFAULT.both;

export const BIBLE_THEME_VARIANT_COUNTS = {
  light: BIBLE_THEMES_LIGHT.length,
  dark: BIBLE_THEMES_DARK.length,
  total: BIBLE_THEMES_LIGHT_DARK.length,
};

export function buildBibleThemeVariants(
  primaryColor: string = DEFAULT_CHURCH_PRIMARY_COLOR,
): ThemeVariantSet {
  return buildLightDarkVariants(BIBLE_THEMES, primaryColor);
}
