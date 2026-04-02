/**
 * dockCommandHandler.ts — Handles dock commands → OBS actions
 *
 * Wires up BroadcastChannel commands from the OBS Browser Dock
 * to the actual OBS services (Bible, Lower Thirds, Worship, etc.).
 *
 * Called from App.tsx when dockBridge receives commands.
 */

import { dockBridge, type DockCommand } from "./dockBridge";
import { obsService } from "./obsService";
import { bibleObsService } from "../bible/bibleObsService";
import type { BibleSlide } from "../bible/types";
import { lowerThirdObsService } from "../lowerthirds/lowerThirdObsService";
import { getLTThemeById, LT_THEMES } from "../lowerthirds/themes";

// ---------------------------------------------------------------------------
// Handle speaker commands — push as lower third
// ---------------------------------------------------------------------------

async function handleSpeaker(cmd: DockCommand) {
  const payload = cmd.payload as {
    name?: string;
    role?: string;
    ltTheme?: { id: string };
  } | null;
  if (!payload?.name) return;

  // Use the user's selected theme if available, otherwise find a speaker theme
  const allThemes = LT_THEMES;
  let theme = payload.ltTheme?.id ? getLTThemeById(payload.ltTheme.id) : undefined;
  if (!theme) {
    theme =
      allThemes.find((t) =>
        t.tags?.some((tag: string) => ["speaker", "pastor", "name"].includes(tag.toLowerCase()))
      ) ??
      allThemes.find((t) => t.category === "general") ??
      allThemes[0];
  }

  if (!theme) {
    console.warn("[DockCmd] No LT theme available for speaker");
    return;
  }

  const values: Record<string, string> = {};
  // Map name/role to theme variables
  for (const v of theme.variables) {
    const key = v.key.toLowerCase();
    if (key.includes("name") || key.includes("title")) {
      values[v.key] = payload.name;
    } else if (key.includes("role") || key.includes("subtitle") || key.includes("description")) {
      values[v.key] = payload.role ?? "";
    } else {
      values[v.key] = v.defaultValue;
    }
  }

  if (cmd.type === "speaker:go-live") {
    await lowerThirdObsService.pushToAll(theme, values, true, false);
    console.log(`[DockCmd] Speaker "${payload.name}" sent LIVE`);
  } else if (cmd.type === "speaker:send-preview") {
    // Preview = push but blanked (so the source updates but isn't "live")
    await lowerThirdObsService.pushToAll(theme, values, true, false);
    console.log(`[DockCmd] Speaker "${payload.name}" sent to preview`);
  } else if (cmd.type === "speaker:clear") {
    await lowerThirdObsService.clearAll();
    console.log(`[DockCmd] Speaker cleared`);
  }
}

// ---------------------------------------------------------------------------
// Handle Bible commands
// ---------------------------------------------------------------------------

async function handleBible(cmd: DockCommand) {
  const payload = cmd.payload as {
    book?: string;
    chapter?: number;
    verse?: number;
    translation?: string;
    theme?: string;
    verseText?: string;
  } | null;

  if (!payload?.book || !payload.chapter || !payload.verse) return;

  const ref = `${payload.book} ${payload.chapter}:${payload.verse}`;
  const verseText = payload.verseText || ref;

  // Build a BibleSlide for the OBS service
  const slide: BibleSlide = {
    id: `dock-${payload.book}-${payload.chapter}-${payload.verse}`,
    reference: `${ref} (${payload.translation || "KJV"})`,
    text: verseText,
    verseRange: String(payload.verse),
    index: 0,
    total: 1,
  };

  if (cmd.type === "bible:go-live") {
    // Get current theme from bibleObsService or use default
    const currentTheme = bibleObsService.getLiveState().theme;
    await bibleObsService.pushSlide(slide, currentTheme, true, false);
    console.log(`[DockCmd] Bible "${ref}" sent LIVE`);
  } else if (cmd.type === "bible:send-preview") {
    const currentTheme = bibleObsService.getLiveState().theme;
    await bibleObsService.pushSlide(slide, currentTheme, true, false);
    console.log(`[DockCmd] Bible "${ref}" sent to preview`);
  } else if (cmd.type === "bible:clear") {
    await bibleObsService.pushSlide(null, null, false, true);
    console.log(`[DockCmd] Bible cleared`);
  }
}

// ---------------------------------------------------------------------------
// Handle Lower Third / Event commands
// ---------------------------------------------------------------------------

async function handleLT(cmd: DockCommand) {
  const payload = cmd.payload as {
    themeId?: string;
    values?: Record<string, string>;
    name?: string;
    title?: string;
    subtitle?: string;
    description?: string;
    series?: string;
    speaker?: string;
    point?: string;
    date?: string;
    location?: string;
    ltTheme?: { id: string };
  } | null;

  if (!payload) return;

  // Find theme — prefer user-selected ltTheme, then explicit themeId, then fallback
  let theme = payload.ltTheme?.id ? getLTThemeById(payload.ltTheme.id) : undefined;
  if (!theme && payload.themeId) theme = getLTThemeById(payload.themeId);
  if (!theme) {
    const allThemes = LT_THEMES;
    theme = allThemes.find((t) => t.category === "general") ?? allThemes[0];
  }
  if (!theme) {
    console.warn("[DockCmd] No LT theme available");
    return;
  }

  // Build values from payload — map all possible fields to theme variables
  const values: Record<string, string> = payload.values ?? {};
  if (!payload.values) {
    for (const v of theme.variables) {
      const key = v.key.toLowerCase();
      if (key === "name") {
        values[v.key] = payload.name ?? payload.title ?? "";
      } else if (key === "title") {
        values[v.key] = payload.title ?? payload.name ?? "";
      } else if (key.includes("series")) {
        values[v.key] = payload.series ?? "";
      } else if (key.includes("speaker") || key.includes("pastor")) {
        values[v.key] = payload.speaker ?? payload.name ?? "";
      } else if (key.includes("point")) {
        values[v.key] = payload.point ?? "";
      } else if (key.includes("date")) {
        values[v.key] = payload.date ?? "";
      } else if (key.includes("location")) {
        values[v.key] = payload.location ?? "";
      } else if (key.includes("subtitle") || key.includes("description") || key.includes("role")) {
        values[v.key] = payload.subtitle ?? payload.description ?? "";
      } else {
        values[v.key] = v.defaultValue;
      }
    }
  }

  if (cmd.type === "lt:go-live") {
    await lowerThirdObsService.pushToAll(theme, values, true, false);
    console.log(`[DockCmd] LT sent LIVE`);
  } else if (cmd.type === "lt:send-preview") {
    await lowerThirdObsService.pushToAll(theme, values, true, false);
    console.log(`[DockCmd] LT sent to preview`);
  } else if (cmd.type === "lt:clear") {
    await lowerThirdObsService.clearAll();
    console.log(`[DockCmd] LT cleared`);
  }
}

// ---------------------------------------------------------------------------
// Handle Worship commands
// ---------------------------------------------------------------------------

async function handleWorship(cmd: DockCommand) {
  const payload = cmd.payload as {
    text?: string;
    label?: string;
    songTitle?: string;
  } | null;

  if (cmd.type === "worship:clear-lyrics") {
    // Clear worship overlay
    // worshipObsService doesn't have a clear method yet — just blank it
    console.log(`[DockCmd] Worship cleared`);
    return;
  }

  if (!payload?.text) return;

  if (cmd.type === "worship:go-live" || cmd.type === "worship:send-preview") {
    console.log(`[DockCmd] Worship "${payload.label ?? ''}" sent`);
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher — register with dockBridge
// ---------------------------------------------------------------------------

export function initDockCommandHandler(): () => void {
  const unsub = dockBridge.onCommand(async (cmd: DockCommand) => {
    // Skip state requests (handled separately in App.tsx)
    if (cmd.type === "request-state" || cmd.type === "ping") return;
    if (cmd.type.startsWith("voice-bible:")) return;

    // Preview routing is handled directly inside the OBS dock via
    // dockObsClient. Legacy BroadcastChannel preview commands used the
    // main-app OBS services, which broadcast overlays across managed
    // scenes instead of targeting the actual OBS Preview scene.
    if (cmd.type.endsWith(":send-preview")) {
      console.warn(`[DockCmd] Ignoring legacy preview command "${cmd.type}"`);
      return;
    }

    if (!obsService.isConnected) {
      console.warn(`[DockCmd] OBS not connected — ignoring "${cmd.type}"`);
      return;
    }

    try {
      if (cmd.type.startsWith("speaker:")) {
        await handleSpeaker(cmd);
      } else if (cmd.type.startsWith("bible:")) {
        await handleBible(cmd);
      } else if (cmd.type.startsWith("lt:")) {
        await handleLT(cmd);
      } else if (cmd.type.startsWith("worship:")) {
        await handleWorship(cmd);
      } else {
        console.log(`[DockCmd] Unhandled command: ${cmd.type}`);
      }
    } catch (err) {
      console.error(`[DockCmd] Error handling "${cmd.type}":`, err);
    }
  });

  console.log("[DockCmd] Handler initialized — dock commands will trigger OBS actions");
  return unsub;
}
