/**
 * OBSConnectGate.tsx — Forces OBS connection before app access
 *
 * Full-screen gate that blocks the entire app until the user connects
 * to OBS WebSocket. Shows setup instructions, connection form, and
 * error feedback. Supports auto-connect from saved settings.
 */

import { useState, useEffect, useRef } from "react";
import { obsService, type ConnectionStatus } from "../services/obsService";
import { loadData, updateData } from "../services/store";
import { AppLogo } from "./AppLogo";
import Icon from "./Icon";

interface Props {
  children: React.ReactNode;
}

export function OBSConnectGate({ children }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>(obsService.status);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("ws://localhost:4455");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [autoConnectTried, setAutoConnectTried] = useState(false);
  const autoConnectRef = useRef(false);

  // Subscribe to OBS status changes
  useEffect(() => {
    const unsub = obsService.onStatusChange((s, err) => {
      setStatus(s);
      if (err) setError(err);
    });
    setStatus(obsService.status);
    return unsub;
  }, []);

  // Auto-connect on mount if saved settings exist
  useEffect(() => {
    if (autoConnectRef.current) return;
    autoConnectRef.current = true;

    (async () => {
      try {
        const data = await loadData();
        const { url: savedUrl, password: savedPw, autoConnect } = data.obsWebSocket;

        // Pre-fill the form with saved values
        if (savedUrl) setUrl(savedUrl);
        if (savedPw) setPassword(savedPw);

        if (autoConnect && savedUrl) {
          setConnecting(true);
          setError(null);
          try {
            await obsService.connect(savedUrl, savedPw || undefined);
            // Save that auto-connect succeeded
            await updateData({
              obsWebSocket: { url: savedUrl, password: savedPw, autoConnect: true },
            });
          } catch {
            // Auto-connect failed — show the form
          } finally {
            setConnecting(false);
          }
        }
      } catch {
        // store read failed
      } finally {
        setAutoConnectTried(true);
      }
    })();
  }, []);

  // Manual connect
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (connecting) return;

    setConnecting(true);
    setError(null);

    try {
      await obsService.connect(url, password || undefined);

      // Save connection settings + enable auto-connect for next launch
      await updateData({
        obsWebSocket: { url, password, autoConnect: true },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  };

  // If already connected, render the app
  if (status === "connected") {
    return <>{children}</>;
  }

  // Don't flash the gate while we're trying auto-connect
  if (!autoConnectTried) {
    return (
      <div className="obs-gate">
        <div className="obs-gate-card">
          <div className="obs-gate-spinner">
            <Icon name="refresh" size={20} className="obs-gate-spin" />
          </div>
          <p className="obs-gate-loading-text">Connecting to OBS…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="obs-gate">
      <div className="obs-gate-card">
        {/* Logo + Title */}
        <div className="obs-gate-header">
          <div className="obs-gate-logo">
            <AppLogo alt="OBS Church Studio" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <h1 className="obs-gate-title">OBS Church Studio</h1>
          <p className="obs-gate-subtitle">Complete Church Production Control for OBS</p>
        </div>

        {/* Setup Instructions */}
        <div className="obs-gate-instructions">
          <h3 className="obs-gate-instructions-title">
            <Icon name="info" size={16} />
            Before you begin
          </h3>
          <ol className="obs-gate-steps">
            <li>
              Open <strong>OBS Studio</strong> on this computer
            </li>
            <li>
              Go to <strong>Tools → WebSocket Server Settings</strong>
            </li>
            <li>
              Check <strong>"Enable WebSocket server"</strong>
            </li>
            <li>
              Note the <strong>port</strong> (default: 4455) and{" "}
              <strong>password</strong> if set
            </li>
            <li>Click <strong>OK</strong> in OBS, then connect below</li>
          </ol>
        </div>

        {/* Connection Form */}
        <form className="obs-gate-form" onSubmit={handleConnect}>
          <div className="obs-gate-field">
            <label className="obs-gate-label" htmlFor="obs-url">
              WebSocket URL
            </label>
            <input
              id="obs-url"
              className="obs-gate-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://localhost:4455"
              disabled={connecting}
              autoFocus
            />
          </div>

          <div className="obs-gate-field">
            <label className="obs-gate-label" htmlFor="obs-password">
              Password <span className="obs-gate-optional">(if set in OBS)</span>
            </label>
            <input
              id="obs-password"
              className="obs-gate-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank if no password"
              disabled={connecting}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="obs-gate-error">
              <Icon name="error" size={16} />
              {error}
            </div>
          )}

          <button
            type="submit"
            className="obs-gate-connect-btn"
            disabled={connecting || !url.trim()}
          >
            {connecting ? (
              <>
                <Icon name="refresh" size={18} className="obs-gate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Icon name="cast_connected" size={18} />
                Connect to OBS
              </>
            )}
          </button>
        </form>

        {/* Footer hint */}
        <p className="obs-gate-footer">
          Make sure OBS Studio is running before connecting.
        </p>
      </div>
    </div>
  );
}
