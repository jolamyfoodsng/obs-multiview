/**
 * ltPresetCategories.ts — Preset category definitions for the Lower Third module
 *
 * Each preset category defines:
 *   - A human-readable label & icon
 *   - Tag patterns used to auto-filter themes
 *   - Dynamic field definitions for the Edit Content form
 *   - Social-media platform definitions (for the Connect category)
 */

import type { LowerThirdTheme } from "./types";
import { LT_THEMES } from "./themes";

// ---------------------------------------------------------------------------
// Preset Category Enum
// ---------------------------------------------------------------------------

export type LTPresetCategoryId =
  | "sermon"
  | "event"
  | "event-highlight"
  | "prayer-request"
  | "giving"
  | "follow-us";

// ---------------------------------------------------------------------------
// Dynamic Field Definitions
// ---------------------------------------------------------------------------

export type LTDynamicFieldType =
  | "text"
  | "textarea"
  | "select"
  | "toggle"
  | "platform-picker"
  | "giving-mode";

export interface LTDynamicField {
  key: string;
  label: string;
  type: LTDynamicFieldType;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  options?: { label: string; value: string }[];
  /** Only show this field when a condition is met (key=value) */
  showWhen?: { key: string; value: string };
}

// ---------------------------------------------------------------------------
// Social Platform Definitions
// ---------------------------------------------------------------------------

export interface LTSocialPlatform {
  id: string;
  label: string;
  /** Font Awesome class or material icon */
  iconClass: string;
  /** Brand colour */
  color: string;
  /** Placeholder for the handle input */
  placeholder: string;
}

export const LT_SOCIAL_PLATFORMS: LTSocialPlatform[] = [
  { id: "instagram", label: "Instagram", iconClass: "fab fa-instagram", color: "#E1306C", placeholder: "@yourchurch" },
  { id: "facebook", label: "Facebook", iconClass: "fab fa-facebook-f", color: "#1877F2", placeholder: "@yourchurch" },
  { id: "whatsapp", label: "WhatsApp", iconClass: "fab fa-whatsapp", color: "#25D366", placeholder: "+1 234 567 8900" },
  { id: "youtube", label: "YouTube", iconClass: "fab fa-youtube", color: "#FF0000", placeholder: "@yourchurch" },
  { id: "x", label: "X (Twitter)", iconClass: "fab fa-x-twitter", color: "#000000", placeholder: "@yourchurch" },
  { id: "tiktok", label: "TikTok", iconClass: "fab fa-tiktok", color: "#00F2EA", placeholder: "@yourchurch" },
  { id: "threads", label: "Threads", iconClass: "fab fa-threads", color: "#000000", placeholder: "@yourchurch" },
  { id: "website", label: "Website", iconClass: "fas fa-globe", color: "#6366F1", placeholder: "www.yourchurch.com" },
];

// ---------------------------------------------------------------------------
// Category Definitions
// ---------------------------------------------------------------------------

export interface LTPresetCategory {
  id: LTPresetCategoryId;
  label: string;
  /** Short description shown on the tile */
  description: string;
  /** Material icon name */
  icon: string;
  /** Accent colour for the tile */
  color: string;
  /** Tags used to filter themes (any match) — lowercased for comparison */
  themeTags: string[];
  /** Theme IDs to always include regardless of tags */
  themeIdIncludes?: string[];
  /** Dynamic fields for the Edit Content form for this category */
  fields: LTDynamicField[];
  /** Default theme ID for this category */
  defaultThemeId?: string;
}

export const LT_PRESET_CATEGORIES: LTPresetCategory[] = [
  // ── SERMON ──
  {
    id: "sermon",
    label: "Sermon Title",
    description: "Sermon points, series titles & scripture",
    icon: "menu_book",
    color: "#C8102E",
    themeTags: ["sermon", "point", "scripture", "verse", "bible", "quote", "keyword"],
    themeIdIncludes: [
      "lt-128-modern-sermon-point",
      "lt-110-traditional-sermon-quote",
      "lt-111-traditional-key-point",
      "lt-105-traditional-scripture-ribbon",
      "lt-106-traditional-scripture-center",
      "lt-123-modern-scripture-left",
      "lt-124-modern-scripture-card",
      "lt-125-modern-quote-highlight",
      "lt-143-style-verse-focus",
      "lt-144-style-quote-ribbon",
      "lt-401-core-sermon-title-electric-blue",
      "lt-402-core-sermon-title-royal-purple",
      "lt-403-core-sermon-title-emerald-wave",
      "lt-404-core-sermon-title-sunset-orange",
      "lt-405-core-sermon-title-crimson-edge",
    ],
    fields: [
      { key: "title", label: "Sermon Title", type: "text", placeholder: "e.g. The Cost of Discipleship", required: true },
      { key: "series", label: "Series Name", type: "text", placeholder: "e.g. Faith Forward" },
      { key: "scripture", label: "Scripture Reference", type: "text", placeholder: "e.g. Luke 14:27" },
      { key: "pointLabel", label: "Point Label", type: "text", placeholder: "e.g. Point 01" },
    ],
    defaultThemeId: "lt-128-modern-sermon-point",
  },

  // ── EVENT ──
  {
    id: "event",
    label: "Event",
    description: "Event announcements with date & location",
    icon: "event",
    color: "#6366F1",
    themeTags: ["event", "card", "banner", "announcement", "date", "celebration"],
    themeIdIncludes: [
      "lt-130-modern-event-date-block",
      "lt-113-traditional-event-reminder",
      "lt-112-traditional-announcement-card",
      "lt-129-modern-announcement-strip",
      "lt-131-modern-up-next",
      "lt-145-style-announcement-ticker",
      "lt-411-core-event-electric-blue",
      "lt-412-core-event-royal-purple",
      "lt-413-core-event-emerald-wave",
      "lt-414-core-event-sunset-orange",
      "lt-415-core-event-crimson-edge",
    ],
    fields: [
      { key: "title", label: "Event Title", type: "text", placeholder: "e.g. Youth Conference 2026", required: true },
      { key: "date", label: "Date / Time", type: "text", placeholder: "e.g. March 15, 2026 • 6:00 PM" },
      { key: "location", label: "Location", type: "text", placeholder: "e.g. Main Auditorium or Online" },
      { key: "cta", label: "Call to Action", type: "select", options: [
        { label: "None", value: "" },
        { label: "Register Now", value: "Register Now" },
        { label: "Join Us", value: "Join Us" },
        { label: "Don't Miss It", value: "Don't Miss It" },
        { label: "Sign Up Today", value: "Sign Up Today" },
        { label: "Learn More", value: "Learn More" },
      ], defaultValue: "" },
    ],
    defaultThemeId: "lt-130-modern-event-date-block",
  },

  // ── EVENT HIGHLIGHT ──
  {
    id: "event-highlight",
    label: "Event Highlight",
    description: "Featured moments & special highlights",
    icon: "auto_awesome",
    color: "#F59E0B",
    themeTags: ["event", "banner", "celebration", "special", "notification", "popup", "alert", "highlight"],
    themeIdIncludes: [
      "lt-421-core-event-highlight-electric-blue",
      "lt-422-core-event-highlight-royal-purple",
      "lt-423-core-event-highlight-emerald-wave",
      "lt-424-core-event-highlight-sunset-orange",
      "lt-425-core-event-highlight-crimson-edge",
      "lt-131-modern-up-next",
      "lt-141-style-newsline",
      "lt-125-modern-quote-highlight",
    ],
    fields: [
      { key: "title", label: "Highlight Title", type: "text", placeholder: "e.g. Special Moment", required: true },
      { key: "subtitle", label: "Subtitle / Description", type: "text", placeholder: "e.g. A night to remember" },
      { key: "tag", label: "Tag", type: "text", placeholder: "e.g. HIGHLIGHT" },
    ],
    defaultThemeId: "lt-421-core-event-highlight-electric-blue",
  },

  // ── PRAYER REQUEST ──
  {
    id: "prayer-request",
    label: "Prayer Request",
    description: "Prayer prompts & contact info",
    icon: "volunteer_activism",
    color: "#8B5CF6",
    themeTags: ["prayer", "declaration", "notification", "popup", "information"],
    themeIdIncludes: [
      "lt-431-core-prayer-request-electric-blue",
      "lt-432-core-prayer-request-royal-purple",
      "lt-433-core-prayer-request-emerald-wave",
      "lt-434-core-prayer-request-sunset-orange",
      "lt-435-core-prayer-request-crimson-edge",
      "lt-108-traditional-prayer-focus",
      "lt-135-modern-prayer-request",
      "lt-148-style-community-care",
    ],
    fields: [
      { key: "prompt", label: "Prompt Text", type: "text", placeholder: "e.g. Send us your prayer request", required: true },
      { key: "contact", label: "Contact (WhatsApp / Phone / Link)", type: "text", placeholder: "e.g. +1 234 567 8900 or prayer.yourchurch.com" },
      { key: "serviceTag", label: "Service Tag", type: "text", placeholder: "e.g. We're ready to pray with you" },
    ],
    defaultThemeId: "lt-431-core-prayer-request-electric-blue",
  },

  // ── GIVING MOMENT ──
  {
    id: "giving",
    label: "Giving Moment",
    description: "Bank details, QR code & donation links",
    icon: "volunteer_activism",
    color: "#10B981",
    themeTags: ["donation", "give", "giving", "qr", "prompt", "offering"],
    themeIdIncludes: [
      "lt-301-giving-classic-white-qr",
      "lt-302-giving-white-stripe",
      "lt-303-giving-minimal-banner",
      "lt-304-giving-dark-neon-qr",
      "lt-305-giving-split-blue-white",
      "lt-306-giving-three-methods",
      "lt-307-giving-bank-qr-card",
      "lt-308-giving-scripture-cta",
      "lt-309-giving-mobile-pill",
      "lt-310-giving-footer-info",
      "lt-116-traditional-offering-classic",
      "lt-136-modern-giving-cta",
      "lt-137-modern-text-to-give",
    ],
    fields: [
      { key: "givingMode", label: "Display Mode", type: "giving-mode", defaultValue: "bank" },
      // Bank fields
      { key: "bankName", label: "Bank Name", type: "text", placeholder: "e.g. First National Bank", showWhen: { key: "givingMode", value: "bank" } },
      { key: "accountNumber", label: "Account Number", type: "text", placeholder: "e.g. 12-3456-78", showWhen: { key: "givingMode", value: "bank" } },
      { key: "accountName", label: "Account Name", type: "text", placeholder: "e.g. Your Church Name", showWhen: { key: "givingMode", value: "bank" } },
      // QR code
      { key: "qrCodeUrl", label: "QR Code Image URL", type: "text", placeholder: "Paste QR code image URL", showWhen: { key: "givingMode", value: "qr" } },
      // Website / link
      { key: "donationLink", label: "Donation Link / Website", type: "text", placeholder: "e.g. give.yourchurch.com", showWhen: { key: "givingMode", value: "link" } },
      // Title (always shown)
      { key: "title", label: "Title", type: "text", placeholder: "e.g. Ways to Give", defaultValue: "Ways to Give" },
    ],
    defaultThemeId: "lt-301-giving-classic-white-qr",
  },

  // ── FOLLOW US / CONNECT ──
  {
    id: "follow-us",
    label: "Follow Us",
    description: "Social media handles & connect info",
    icon: "share",
    color: "#3B82F6",
    themeTags: ["social", "follow", "handle", "handles", "instagram", "facebook", "loop", "connect"],
    themeIdIncludes: [
      "lt-441-core-follow-us-electric-blue",
      "lt-442-core-follow-us-royal-purple",
      "lt-443-core-follow-us-emerald-wave",
      "lt-444-core-follow-us-sunset-orange",
      "lt-445-core-follow-us-crimson-edge",
      "lt-55-social-triple-icons",
      "lt-56-social-rotating-platform",
      "lt-57-social-footer-banner",
      "lt-58-social-stack-card",
      "lt-59-social-minimal-live",
      "lt-54-follow-social-rotator",
      "lt-132-modern-livestream-follow",
      "lt-150-style-closing-social",
    ],
    fields: [
      { key: "platforms", label: "Platforms", type: "platform-picker" },
    ],
    defaultThemeId: "lt-55-social-triple-icons",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the category definition by ID */
export function getPresetCategory(id: LTPresetCategoryId): LTPresetCategory | undefined {
  return LT_PRESET_CATEGORIES.find((c) => c.id === id);
}

const COLOR_VARIANT_SUFFIXES = [
  "electric blue",
  "royal purple",
  "emerald wave",
  "sunset orange",
  "crimson edge",
  "midnight cyan",
  "ivory gold",
  "slate teal",
  "berry pop",
  "graphite lime",
  "electric indigo",
  "royal violet",
];

const IMAGE_SET_SUFFIX_RE = /\s+\[image set\]\s*$/i;
const LIGHT_DARK_SUFFIX_RE = /\s+\((light|dark)\)\s*$/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COLOR_VARIANT_SUFFIX_RE = new RegExp(
  `\\s+[\\-\\u2013\\u2014]\\s+(${COLOR_VARIANT_SUFFIXES.map(escapeRegex).join("|")})$`,
  "i",
);

function normalizeThemeFamilyName(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(IMAGE_SET_SUFFIX_RE, "").trim();
  normalized = normalized.replace(COLOR_VARIANT_SUFFIX_RE, "").trim();
  normalized = normalized.replace(LIGHT_DARK_SUFFIX_RE, "").trim();
  return normalized.replace(/\s+/g, " ").toLowerCase();
}

type ThemeTone = "dark" | "light" | "base";

function getThemeTone(theme: LowerThirdTheme): ThemeTone {
  const tags = theme.tags.map((tag) => tag.toLowerCase());
  if (tags.includes("light")) return "light";
  if (tags.includes("dark")) return "dark";

  const signature = `${theme.id} ${theme.name} ${tags.join(" ")}`.toLowerCase();
  if (/\blight\b/.test(signature)) return "light";
  if (/\bdark\b/.test(signature)) return "dark";
  return "base";
}

function collapseThemeVariants(themes: LowerThirdTheme[]): LowerThirdTheme[] {
  const seen = new Set<string>();
  const collapsed: LowerThirdTheme[] = [];

  for (const theme of themes) {
    const familyName = normalizeThemeFamilyName(theme.name || theme.id);
    const description = (theme.description || "").trim().toLowerCase();
    const tone = getThemeTone(theme);
    const dedupeKey = `${familyName}::${description}::${tone}`;

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    collapsed.push(theme);
  }

  return collapsed;
}

/** Filter themes that are relevant for a given preset category */
export function getThemesForCategory(categoryId: LTPresetCategoryId): LowerThirdTheme[] {
  const cat = getPresetCategory(categoryId);
  if (!cat) return LT_THEMES;

  const tagSet = new Set(cat.themeTags.map((t) => t.toLowerCase()));
  const idSet = new Set(cat.themeIdIncludes ?? []);

  const matched = LT_THEMES.filter((theme) => {
    // Always include if explicitly listed
    if (idSet.has(theme.id)) return true;
    // Match any tag
    return theme.tags.some((t) => tagSet.has(t.toLowerCase()));
  });

  // Deduplicate and put explicitly-included themes first
  const seen = new Set<string>();
  const result: LowerThirdTheme[] = [];

  // First: explicitly listed IDs (in order)
  for (const id of cat.themeIdIncludes ?? []) {
    const t = matched.find((m) => m.id === id);
    if (t && !seen.has(t.id)) {
      result.push(t);
      seen.add(t.id);
    }
  }
  // Then: tag-matched themes
  for (const t of matched) {
    if (!seen.has(t.id)) {
      result.push(t);
      seen.add(t.id);
    }
  }

  return collapseThemeVariants(result);
}

type CategoryFieldCandidates = Partial<Record<LTPresetCategoryId, Record<string, string[]>>>;

const CATEGORY_FIELD_CANDIDATES: CategoryFieldCandidates = {
  sermon: {
    pointLabel: ["pointLabel", "label", "tag", "kicker", "badge"],
    title: ["title", "headline", "quote", "keyword", "verseText", "text", "name", "line1", "tickerText"],
    scripture: ["scripture", "reference", "verseRef", "verseReference", "subtitle", "supportingText", "details", "meta", "description", "line2"],
    series: ["series", "meta", "subtitle", "description", "supportingText", "details", "line2"],
  },
  event: {
    title: ["title", "headline", "text", "name", "heading", "tickerText"],
    date: ["date", "datetime", "time", "subtitle", "meta", "details", "line2", "tickerText"],
    location: ["location", "venue", "place", "details", "subtitle", "meta", "description", "line2"],
    cta: ["cta", "buttonText", "action", "label", "badge", "tag", "kicker"],
  },
  "event-highlight": {
    title: ["title", "headline", "text", "name", "heading", "tickerText"],
    subtitle: ["subtitle", "details", "description", "meta", "line2", "tickerText"],
    tag: ["tag", "label", "badge", "kicker", "cta"],
  },
  "prayer-request": {
    prompt: ["prompt", "text", "title", "headline", "quote"],
    contact: ["contact", "subtitle", "details", "meta", "description", "line2", "url", "link", "website"],
    serviceTag: ["serviceTag", "label", "tag", "kicker", "badge", "cta", "description"],
  },
};

function extractMonthDayParts(value: string): { month: string; day: string } {
  const raw = value.trim();
  if (!raw) return { month: "", day: "" };

  let month = "";
  let day = "";

  const monthMatch = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  if (monthMatch) {
    month = monthMatch[1].slice(0, 3).toUpperCase();
  }

  const dayMatch = raw.match(/\b([0-3]?\d)\b/);
  if (dayMatch) {
    day = String(Number(dayMatch[1]));
  }

  if ((!month || !day) && !Number.isNaN(Date.parse(raw))) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      if (!month) month = parsed.toLocaleString("en-US", { month: "short" }).toUpperCase();
      if (!day) day = String(parsed.getDate());
    }
  }

  if (!month) {
    const token = raw.split(/\s+/).find(Boolean);
    if (token) month = token.slice(0, 3).toUpperCase();
  }

  return { month, day };
}

/**
 * Map category field values → theme variable values.
 *
 * Each theme has its own variable keys. This function maps generic category
 * field keys (e.g. "title", "scripture") to the nearest matching theme variable.
 * Social platforms are mapped to theme variables like "facebook", "instagram" etc.
 */
export function mapCategoryFieldsToThemeValues(
  categoryId: LTPresetCategoryId,
  fieldValues: Record<string, string>,
  theme: LowerThirdTheme,
): Record<string, string> {
  const result: Record<string, string> = {};
  const themeVarKeys = new Set(theme.variables.map((v) => v.key));
  const applyFirstMatch = (value: string | undefined, keys: string[]) => {
    if (!value) return;
    for (const key of keys) {
      if (themeVarKeys.has(key) && !result[key]) {
        result[key] = value;
        return;
      }
    }
  };

  // Direct key match — if the category field key matches a theme variable key
  for (const [key, val] of Object.entries(fieldValues)) {
    if (themeVarKeys.has(key)) {
      result[key] = val;
    }
  }

  // Category-specific mappings
  if (categoryId === "sermon") {
    // Map generic sermon fields into the theme's actual key names.
    // This allows quote/keyword/headline-style sermon templates to stay editable
    // from the category form, not only themes that literally use "title/subtitle".
    applyFirstMatch(fieldValues.pointLabel, [
      "pointLabel",
      "label",
      "tag",
      "kicker",
      "badge",
    ]);

    applyFirstMatch(fieldValues.title, [
      "title",
      "headline",
      "quote",
      "keyword",
      "verseText",
      "text",
      "name",
      "line1",
    ]);

    applyFirstMatch(fieldValues.scripture, [
      "scripture",
      "reference",
      "subtitle",
      "supportingText",
      "details",
      "meta",
      "description",
      "line2",
    ]);

    applyFirstMatch(fieldValues.series, [
      "series",
      "subtitle",
      "meta",
      "description",
      "supportingText",
      "details",
      "line2",
    ]);
  }

  if (categoryId === "event") {
    const candidates = CATEGORY_FIELD_CANDIDATES.event ?? {};
    applyFirstMatch(fieldValues.title, candidates.title ?? []);

    if (fieldValues.date && (themeVarKeys.has("month") || themeVarKeys.has("day"))) {
      const parts = extractMonthDayParts(fieldValues.date);
      if (parts.month && themeVarKeys.has("month") && !result.month) result.month = parts.month;
      if (parts.day && themeVarKeys.has("day") && !result.day) result.day = parts.day;
    } else {
      applyFirstMatch(fieldValues.date, candidates.date ?? []);
    }

    applyFirstMatch(fieldValues.location, candidates.location ?? []);
    applyFirstMatch(fieldValues.cta, candidates.cta ?? []);
  }

  if (categoryId === "event-highlight") {
    const candidates = CATEGORY_FIELD_CANDIDATES["event-highlight"] ?? {};
    applyFirstMatch(fieldValues.title, candidates.title ?? []);
    applyFirstMatch(fieldValues.subtitle, candidates.subtitle ?? []);
    applyFirstMatch(fieldValues.tag, candidates.tag ?? []);

    if (fieldValues.subtitle && (themeVarKeys.has("month") || themeVarKeys.has("day"))) {
      const parts = extractMonthDayParts(fieldValues.subtitle);
      if (parts.month && themeVarKeys.has("month") && !result.month) result.month = parts.month;
      if (parts.day && themeVarKeys.has("day") && !result.day) result.day = parts.day;
    }
  }

  if (categoryId === "prayer-request") {
    const candidates = CATEGORY_FIELD_CANDIDATES["prayer-request"] ?? {};
    applyFirstMatch(fieldValues.prompt, candidates.prompt ?? []);
    applyFirstMatch(fieldValues.contact, candidates.contact ?? []);
    applyFirstMatch(fieldValues.serviceTag, candidates.serviceTag ?? []);
  }

  if (categoryId === "giving") {
    // Legacy aliases -> modern giving theme keys
    applyFirstMatch(
      fieldValues.qrUrl || fieldValues.qrCodeUrl,
      ["qrUrl", "qrCodeUrl"],
    );

    applyFirstMatch(
      fieldValues.donationLink || fieldValues.url || fieldValues.website,
      ["url", "donationLink", "website", "link", "subtitle", "details", "line2", "line"],
    );

    applyFirstMatch(
      fieldValues.title || fieldValues.heading || fieldValues.headline || fieldValues.label || fieldValues.header || fieldValues.badge,
      ["heading", "headline", "title", "label", "header", "badge"],
    );

    applyFirstMatch(
      fieldValues.bank || fieldValues.bankName || fieldValues.bankValue,
      ["bank", "bankName", "bankValue", "line1", "leftText", "method1Line"],
    );

    applyFirstMatch(
      fieldValues.account || fieldValues.accountNumber || fieldValues.accValue || fieldValues.number,
      ["account", "accountNumber", "accValue", "number", "line2", "rightText", "method2Line"],
    );

    applyFirstMatch(
      fieldValues.accountName,
      ["accountName", "line", "details", "method3Line"],
    );
  }

  // Fill any remaining theme variables with defaults
  for (const v of theme.variables) {
    if (!(v.key in result)) {
      result[v.key] = v.defaultValue;
    }
  }

  return result;
}

export function mapThemeValuesToCategoryFields(
  categoryId: LTPresetCategoryId,
  theme: LowerThirdTheme,
  themeValues: Record<string, string>,
  previousValues: Record<string, string> = {},
): Record<string, string> {
  const candidatesByField = CATEGORY_FIELD_CANDIDATES[categoryId];
  if (!candidatesByField) return { ...previousValues };

  const result: Record<string, string> = { ...previousValues };
  const themeVarKeys = new Set(theme.variables.map((v) => v.key));
  const usedThemeKeys = new Set<string>();
  const category = getPresetCategory(categoryId);
  const orderedFieldKeys = category?.fields.map((field) => field.key) ?? Object.keys(candidatesByField);

  for (const fieldKey of orderedFieldKeys) {
    const candidates = candidatesByField[fieldKey];
    if (!candidates || candidates.length === 0) continue;

    if (categoryId === "event" && fieldKey === "date" && (themeVarKeys.has("month") || themeVarKeys.has("day"))) {
      const monthValue = Object.prototype.hasOwnProperty.call(themeValues, "month") ? themeValues.month : "";
      const dayValue = Object.prototype.hasOwnProperty.call(themeValues, "day") ? themeValues.day : "";
      result.date = [monthValue, dayValue].filter(Boolean).join(" ").trim();
      if (themeVarKeys.has("month")) usedThemeKeys.add("month");
      if (themeVarKeys.has("day")) usedThemeKeys.add("day");
      continue;
    }

    let matchedThemeKey: string | null = null;
    for (const key of candidates) {
      if (themeVarKeys.has(key) && !usedThemeKeys.has(key)) {
        matchedThemeKey = key;
        usedThemeKeys.add(key);
        break;
      }
    }
    if (!matchedThemeKey) continue;

    if (Object.prototype.hasOwnProperty.call(themeValues, matchedThemeKey)) {
      result[fieldKey] = themeValues[matchedThemeKey] ?? "";
    }
  }

  return result;
}
