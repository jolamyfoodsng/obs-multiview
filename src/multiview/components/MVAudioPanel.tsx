/**
 * MVAudioPanel.tsx — Real-time Audio Monitoring
 *
 * Provides:
 *  - Live VU level meters for each audio input
 *  - Mute/unmute toggle per input
 *  - Volume (dB) slider per input
 *  - Auto-refresh when OBS connection changes
 *
 * Uses OBS WebSocket 5.x:
 *  - GetInputList (kind filter for audio)
 *  - GetInputVolume / SetInputVolume
 *  - GetInputMute / SetInputMute / ToggleInputMute
 *  - InputVolumeMeters event (high-frequency level data)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { obsService } from "../../services/obsService";
import Icon from "../../components/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AudioInput {
  name: string;
  kind: string;
  muted: boolean;
  /** Volume in dB (OBS uses mul internally; we convert) */
  volumeDb: number;
  /** Level meter peak (0–1), derived from InputVolumeMeters event */
  levelL: number;
  levelR: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert OBS multiplier (0..1+) to dB. */
function mulToDb(mul: number): number {
  if (mul <= 0) return -Infinity;
  return 20 * Math.log10(mul);
}

/** Convert dB to OBS multiplier. */
function dbToMul(db: number): number {
  if (db <= -96) return 0;
  return Math.pow(10, db / 20);
}

/** Clamp a number. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Map a 0–1 peak value to a color. */
function levelColor(peak: number): string {
  if (peak > 0.9) return "#e74856"; // red — clipping
  if (peak > 0.7) return "#f9a825"; // yellow — hot
  return "#16c60c"; // green — normal
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MVAudioPanel() {
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [connected, setConnected] = useState(obsService.status === "connected");
  const [error, setError] = useState<string | null>(null);
  const levelsRef = useRef<Map<string, { l: number; r: number }>>(new Map());
  const animRef = useRef<number>(0);
  const [, forceUpdate] = useState(0);

  // Track connection
  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setConnected(s === "connected"));
    return unsub;
  }, []);

  // Fetch audio inputs when connected
  const fetchInputs = useCallback(async () => {
    if (!connected) {
      setInputs([]);
      return;
    }
    try {
      setError(null);
      const all = await obsService.getInputList();

      // Build audio input list — fetch mute & volume for each
      const audioInputs: AudioInput[] = [];
      for (const inp of all) {
        // Include all — OBS can report audio for any input
        // We'll show what we can
        try {
          const vol = await obsService.call("GetInputVolume", { inputName: inp.inputName });
          const mute = await obsService.call("GetInputMute", { inputName: inp.inputName });
          audioInputs.push({
            name: inp.inputName,
            kind: inp.inputKind,
            muted: mute.inputMuted ?? false,
            volumeDb: mulToDb(vol.inputVolumeMul ?? 1),
            levelL: 0,
            levelR: 0,
          });
        } catch {
          // Not all inputs support volume queries — skip silently
        }
      }

      setInputs(audioInputs);
    } catch (err) {
      console.error("[MVAudioPanel] Failed to fetch inputs:", err);
      setError("Failed to load audio inputs from OBS.");
    }
  }, [connected]);

  useEffect(() => {
    fetchInputs();
  }, [fetchInputs]);

  // Subscribe to InputVolumeMeters for live levels
  useEffect(() => {
    if (!connected) return;

    const unsub = obsService.on("InputVolumeMeters", (data: { inputs: Array<{ inputName: string; inputLevelsMul: number[][] }> }) => {
      if (!data?.inputs) return;
      for (const inp of data.inputs) {
        const channels = inp.inputLevelsMul;
        if (!channels || channels.length === 0) continue;
        const l = channels[0]?.[0] ?? 0; // peak
        const r = channels.length > 1 ? (channels[1]?.[0] ?? 0) : l;
        levelsRef.current.set(inp.inputName, { l, r });
      }
    });

    // Animation loop to update rendered levels smoothly
    let running = true;
    const tick = () => {
      if (!running) return;
      forceUpdate((n) => n + 1);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      unsub();
    };
  }, [connected]);

  // Mute toggle
  const handleToggleMute = useCallback(async (name: string) => {
    try {
      await obsService.call("ToggleInputMute", { inputName: name });
      setInputs((prev) =>
        prev.map((inp) => (inp.name === name ? { ...inp, muted: !inp.muted } : inp))
      );
    } catch (err) {
      console.error("[MVAudioPanel] Failed to toggle mute:", err);
    }
  }, []);

  // Volume change
  const handleVolumeChange = useCallback(async (name: string, db: number) => {
    const mul = dbToMul(db);
    try {
      await obsService.call("SetInputVolume", { inputName: name, inputVolumeMul: mul });
      setInputs((prev) =>
        prev.map((inp) => (inp.name === name ? { ...inp, volumeDb: db } : inp))
      );
    } catch (err) {
      console.error("[MVAudioPanel] Failed to set volume:", err);
    }
  }, []);

  // ─── Render ───

  if (!connected) {
    return (
      <div className="mv-audio-panel mv-audio-panel--disconnected" role="region" aria-label="Audio monitoring">
        <div className="mv-audio-empty">
          <Icon name="volume_off" size={36} style={{ opacity: 0.3 }} />
          <p>Connect to OBS to monitor audio levels.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mv-audio-panel" role="region" aria-label="Audio monitoring">
        <div className="mv-audio-empty">
          <Icon name="error" size={36} style={{ color: "var(--error)" }} />
          <p>{error}</p>
          <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={fetchInputs}>Retry</button>
        </div>
      </div>
    );
  }

  if (inputs.length === 0) {
    return (
      <div className="mv-audio-panel" role="region" aria-label="Audio monitoring">
        <div className="mv-audio-header">
          <Icon name="equalizer" size={16} />
          <span>Audio Mixer</span>
          <button className="mv-btn mv-btn--ghost mv-btn--xs" title="Refresh" onClick={fetchInputs}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
        <div className="mv-audio-empty">
          <Icon name="mic_off" size={32} style={{ opacity: 0.3 }} />
          <p>No audio inputs found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mv-audio-panel" role="region" aria-label="Audio monitoring">
      <div className="mv-audio-header">
        <Icon name="equalizer" size={16} />
        <span>Audio Mixer</span>
        <span className="mv-history-count">{inputs.length}</span>
        <span style={{ flex: 1 }} />
        <button className="mv-btn mv-btn--ghost mv-btn--xs" title="Refresh inputs" onClick={fetchInputs}>
          <Icon name="refresh" size={16} />
        </button>
      </div>
      <div className="mv-audio-list">
        {inputs.map((inp) => {
          const levels = levelsRef.current.get(inp.name);
          const peakL = clamp(levels?.l ?? inp.levelL, 0, 1);
          const peakR = clamp(levels?.r ?? inp.levelR, 0, 1);
          const peak = Math.max(peakL, peakR);

          return (
            <div key={inp.name} className={`mv-audio-channel${inp.muted ? " mv-audio-channel--muted" : ""}`}>
              <div className="mv-audio-channel-header">
                <button
                  className="mv-audio-mute-btn"
                  title={inp.muted ? "Unmute" : "Mute"}
                  aria-label={`${inp.muted ? "Unmute" : "Mute"} ${inp.name}`}
                  onClick={() => handleToggleMute(inp.name)}
                >
                  <Icon name={inp.muted ? "volume_off" : peak > 0.01 ? "volume_up" : "volume_mute"} size={18} />
                </button>
                <span className="mv-audio-channel-name" title={inp.name}>{inp.name}</span>
                <span className="mv-audio-db-label">
                  {inp.volumeDb <= -96 ? "-∞" : `${inp.volumeDb.toFixed(1)}`} dB
                </span>
              </div>

              {/* Level meters */}
              <div className="mv-audio-meters" aria-label={`Audio level for ${inp.name}`}>
                <div className="mv-audio-meter">
                  <div
                    className="mv-audio-meter-fill"
                    style={{
                      width: `${(inp.muted ? 0 : peakL) * 100}%`,
                      background: levelColor(peakL),
                    }}
                  />
                </div>
                <div className="mv-audio-meter">
                  <div
                    className="mv-audio-meter-fill"
                    style={{
                      width: `${(inp.muted ? 0 : peakR) * 100}%`,
                      background: levelColor(peakR),
                    }}
                  />
                </div>
              </div>

              {/* Volume slider */}
              <div className="mv-audio-volume-row">
                <input
                  type="range"
                  className="mv-audio-slider"
                  min={-96}
                  max={26}
                  step={0.1}
                  value={inp.volumeDb <= -96 ? -96 : inp.volumeDb}
                  onChange={(e) => handleVolumeChange(inp.name, parseFloat(e.target.value))}
                  aria-label={`Volume for ${inp.name}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
