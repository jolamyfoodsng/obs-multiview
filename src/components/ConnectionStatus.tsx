/**
 * ConnectionStatus — OBS connection UI
 *
 * Shows connection state with a connect/disconnect form.
 * Design follows the OBS Church Studio design system from multiview.html.
 */

import { useState, type FormEvent } from "react";
import type { ConnectionStatus as ConnectionStatusType } from "../services/obsService";
import Icon from "./Icon";

interface Props {
    status: ConnectionStatusType;
    error: string | null;
    onConnect: (url?: string, password?: string) => Promise<void>;
    onDisconnect: () => Promise<void>;
}

export function ConnectionStatus({
    status,
    error,
    onConnect,
    onDisconnect,
}: Props) {
    const [url, setUrl] = useState("ws://localhost:4455");
    const [password, setPassword] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConnect = async (e: FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await onConnect(url, password || undefined);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDisconnect = async () => {
        setIsSubmitting(true);
        try {
            await onDisconnect();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="connection-card">
            {/* Status indicator */}
            <div className="connection-header">
                <div className={`status-dot status-${status}`}>
                    {status === "connecting" && <div className="status-dot-ping" />}
                </div>
                <div className="connection-header-text">
                    <h2 className="connection-title">OBS Connection</h2>
                    <span className={`status-label status-label-${status}`}>
                        {status === "disconnected" && "Disconnected"}
                        {status === "connecting" && "Connecting..."}
                        {status === "connected" && "Connected to OBS"}
                        {status === "error" && "Connection Error"}
                    </span>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <div className="error-banner">
                    <Icon name="error_outline" size={20} className="error-icon" />
                    <p className="error-text">{error}</p>
                </div>
            )}

            {/* Connection form — shown when not connected */}
            {status !== "connected" && (
                <form onSubmit={handleConnect} className="connection-form">
                    <div className="form-group">
                        <label className="form-label">WebSocket URL</label>
                        <div className="input-wrapper">
                            <input
                                type="text"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="ws://localhost:4455"
                                className="form-input"
                                disabled={isSubmitting}
                            />
                            <Icon name="link" size={20} className="input-icon" />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password (optional)</label>
                        <div className="input-wrapper">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="WebSocket server password"
                                className="form-input"
                                disabled={isSubmitting}
                            />
                            <Icon name="lock" size={20} className="input-icon" />
                        </div>
                    </div>
                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={isSubmitting || status === "connecting"}
                    >
                        <Icon name={isSubmitting ? "hourglass_empty" : "power_settings_new"} size={20} className="btn-icon" />
                        {isSubmitting ? "Connecting..." : "Connect to OBS"}
                    </button>
                </form>
            )}

            {/* Connected state — disconnect button */}
            {status === "connected" && (
                <div className="connected-actions">
                    <div className="connected-info">
                        <Icon name="check_circle" size={20} className="connected-check" />
                        <p className="connected-text">
                            Connected to <strong>{url}</strong>
                        </p>
                    </div>
                    <button
                        onClick={handleDisconnect}
                        className="btn-disconnect"
                        disabled={isSubmitting}
                    >
                        <Icon name="power_off" size={20} className="btn-icon" />
                        Disconnect
                    </button>
                </div>
            )}
        </div>
    );
}
