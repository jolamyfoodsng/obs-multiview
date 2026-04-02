/**
 * dockBridge.ts — BroadcastChannel bridge for OBS Browser Dock
 *
 * When the dock page is loaded inside OBS's Custom Browser Dock
 * (via the overlay HTTP server), it shares the same origin as the
 * main Tauri app window. This means they can communicate via
 * BroadcastChannel without needing WebSockets.
 *
 * Architecture:
 *   Dock (OBS Browser Dock)  ──BroadcastChannel──►  Main App (Tauri)
 *     sends commands (e.g. "show-speaker", "send-bible-verse")
 *     receives state updates (e.g. OBS connected, current speaker, service status)
 *
 * The main app listens for dock commands and dispatches them to the
 * appropriate OBS services (bibleObsService, lowerThirdObsService, etc.)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DockCommandType =
  // Speaker
  | "speaker:send-preview"
  | "speaker:go-live"
  | "speaker:clear"
  // Bible
  | "bible:send-preview"
  | "bible:go-live"
  | "bible:clear"
  // Lower Third / Event
  | "lt:send-preview"
  | "lt:go-live"
  | "lt:clear"
  // Worship
  | "worship:send-preview"
  | "worship:go-live"
  | "worship:clear-lyrics"
  // Voice Bible
  | "voice-bible:start"
  | "voice-bible:stop"
  | "voice-bible:cancel"
  // General
  | "ping"
  | "request-state"
  | "request-library-data";

export interface DockCommand {
  type: DockCommandType;
  payload?: unknown;
  commandId?: string;
  timestamp: number;
}

export type DockStateType =
  | "state:update"
  | "state:obs-status"
  | "state:service-status"
  | "state:speakers"
  | "state:library-updated"
  | "state:songs-data"
  | "state:media-data"
  | "state:voice-bible-status"
  | "state:voice-bible-result"
  | "state:voice-bible-candidates"
  | "state:pong";

export interface DockStateMessage {
  type: DockStateType;
  payload: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Channel names
// ---------------------------------------------------------------------------

const DOCK_COMMAND_CHANNEL = "ocs-dock-commands";
const DOCK_STATE_CHANNEL = "ocs-dock-state";

// ---------------------------------------------------------------------------
// Dock Bridge — used by the main app to listen for dock commands
// and send state updates back to the dock
// ---------------------------------------------------------------------------

type CommandHandler = (cmd: DockCommand) => void;

class DockBridge {
  private commandChannel: BroadcastChannel | null = null;
  private stateChannel: BroadcastChannel | null = null;
  private handlers = new Set<CommandHandler>();
  private _initialized = false;

  /** Initialize the bridge (called once in the main app) */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      this.commandChannel = new BroadcastChannel(DOCK_COMMAND_CHANNEL);
      this.stateChannel = new BroadcastChannel(DOCK_STATE_CHANNEL);

      this.commandChannel.onmessage = (ev: MessageEvent<DockCommand>) => {
        const cmd = ev.data;
        if (!cmd || !cmd.type) return;

        // Handle ping internally
        if (cmd.type === "ping") {
          this.sendState({ type: "state:pong", payload: null, timestamp: Date.now() });
          return;
        }

        // Dispatch to registered handlers
        for (const handler of this.handlers) {
          try {
            handler(cmd);
          } catch (e) {
            console.error("[DockBridge] Handler error:", e);
          }
        }
      };

      console.log("[DockBridge] Initialized — listening for dock commands");
    } catch (e) {
      console.warn("[DockBridge] BroadcastChannel not available:", e);
    }
  }

  /** Register a handler for dock commands */
  onCommand(handler: CommandHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Send a state update to the dock */
  sendState(msg: DockStateMessage) {
    try {
      this.stateChannel?.postMessage(msg);
    } catch {
      // Channel might be closed
    }
  }

  /** Broadcast OBS connection status to the dock */
  sendObsStatus(connected: boolean) {
    this.sendState({
      type: "state:obs-status",
      payload: { connected },
      timestamp: Date.now(),
    });
  }

  /** Broadcast service status to the dock */
  sendServiceStatus(status: string, serviceName?: string) {
    this.sendState({
      type: "state:service-status",
      payload: { status, serviceName },
      timestamp: Date.now(),
    });
  }

  /** Broadcast full state snapshot to the dock */
  sendFullState(state: Record<string, unknown>) {
    this.sendState({
      type: "state:update",
      payload: state,
      timestamp: Date.now(),
    });
  }

  /** Notify the dock that library data (songs/media) changed so it can refresh */
  sendLibraryUpdated() {
    this.sendState({
      type: "state:library-updated",
      payload: null,
      timestamp: Date.now(),
    });
  }

  destroy() {
    this.commandChannel?.close();
    this.stateChannel?.close();
    this.handlers.clear();
    this._initialized = false;
  }
}

export const dockBridge = new DockBridge();

// ---------------------------------------------------------------------------
// Dock Client — used by the dock page to send commands and receive state
// ---------------------------------------------------------------------------

type StateHandler = (msg: DockStateMessage) => void;

class DockClient {
  private commandChannel: BroadcastChannel | null = null;
  private stateChannel: BroadcastChannel | null = null;
  private handlers = new Set<StateHandler>();
  private _initialized = false;

  init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      this.commandChannel = new BroadcastChannel(DOCK_COMMAND_CHANNEL);
      this.stateChannel = new BroadcastChannel(DOCK_STATE_CHANNEL);

      this.stateChannel.onmessage = (ev: MessageEvent<DockStateMessage>) => {
        const msg = ev.data;
        if (!msg || !msg.type) return;
        for (const handler of this.handlers) {
          try {
            handler(msg);
          } catch (e) {
            console.error("[DockClient] Handler error:", e);
          }
        }
      };

      // Send initial ping to check if main app is running
      this.sendCommand({ type: "ping", timestamp: Date.now() });
      console.log("[DockClient] Initialized — connected to main app");
    } catch (e) {
      console.warn("[DockClient] BroadcastChannel not available:", e);
    }
  }

  /** Send a command to the main app */
  sendCommand(cmd: DockCommand) {
    try {
      this.commandChannel?.postMessage(cmd);
    } catch {
      // Channel might be closed
    }
  }

  /** Register a handler for state updates from the main app */
  onState(handler: StateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Request full state from main app */
  requestState() {
    this.sendCommand({ type: "request-state", timestamp: Date.now() });
  }

  destroy() {
    this.commandChannel?.close();
    this.stateChannel?.close();
    this.handlers.clear();
    this._initialized = false;
  }
}

export const dockClient = new DockClient();
