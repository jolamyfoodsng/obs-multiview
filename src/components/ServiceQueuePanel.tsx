/**
 * ServiceQueuePanel — Right column
 *
 * Sections from top to bottom:
 *   1. Service Queue — ordered list, current + next highlight, reorder
 *   2. Stream Check — OBS connection, bitrate, upload estimate, stream health
 *   3. Emergency Controls — Fade to Black, Clear, Stop Stream
 */

import { useCallback } from "react";
import { useBroadcastStore } from "../hooks/useBroadcastStore";
import type { QueueItem } from "../services/broadcastStore";
import { BUILT_IN_PRESETS } from "../services/broadcastStore";
import Icon from "./Icon";

interface Props {
    onRefreshLibrary: () => Promise<void>;
}

export function ServiceQueuePanel({ onRefreshLibrary }: Props) {
    const {
        state,
        dispatch,
        loadPreview,
        nextInQueue,
        quickCut,
    } = useBroadcastStore();

    const handleRemove = useCallback((queueId: string) => {
        dispatch({ type: "QUEUE_REMOVE", queueId });
    }, [dispatch]);

    const handleGoTo = useCallback((queueId: string) => {
        dispatch({ type: "QUEUE_GO", queueId });
    }, [dispatch]);

    const handleMoveUp = useCallback((idx: number) => {
        if (idx <= 0) return;
        dispatch({ type: "QUEUE_REORDER", fromIndex: idx, toIndex: idx - 1 });
    }, [dispatch]);

    const handleMoveDown = useCallback((idx: number) => {
        if (idx >= state.queue.length - 1) return;
        dispatch({ type: "QUEUE_REORDER", fromIndex: idx, toIndex: idx + 1 });
    }, [dispatch, state.queue.length]);

    const handleClearQueue = useCallback(() => {
        dispatch({ type: "QUEUE_CLEAR" });
    }, [dispatch]);

    // Emergency: fade to black
    const handleFadeToBlack = useCallback(async () => {
        const blankPreset = BUILT_IN_PRESETS.find((p) => p.presetId === "blank");
        if (blankPreset) {
            await quickCut(blankPreset);
        }
    }, [quickCut]);

    // Emergency: full pastor (safe fallback)
    const handleSafeFallback = useCallback(async () => {
        const fullPastor = BUILT_IN_PRESETS.find((p) => p.presetId === "full-pastor");
        if (fullPastor) {
            await quickCut(fullPastor);
        }
    }, [quickCut]);

    return (
        <div className="service-queue-panel">
            {/* Queue Section */}
            <div className="panel-header">
                <h3 className="panel-title">
                    <Icon name="playlist_play" size={16} />
                    Service Queue
                </h3>
                <div className="panel-header-actions">
                    <button
                        className="panel-action-btn"
                        onClick={() => nextInQueue()}
                        disabled={state.queueIndex >= state.queue.length - 1}
                        title="Next Item"
                    >
                        <Icon name="skip_next" size={16} />
                    </button>
                    <button
                        className="panel-action-btn panel-action-danger"
                        onClick={handleClearQueue}
                        disabled={state.queue.length === 0}
                        title="Clear Queue"
                    >
                        <Icon name="playlist_remove" size={16} />
                    </button>
                </div>
            </div>

            <div className="queue-list">
                {state.queue.length === 0 ? (
                    <div className="queue-empty">
                        <Icon name="queue" size={28} style={{ opacity: 0.3 }} />
                        <span>Queue is empty</span>
                        <span className="queue-empty-hint">
                            Add items from the Content Library
                        </span>
                    </div>
                ) : (
                    state.queue.map((qItem, idx) => (
                        <QueueRow
                            key={qItem.queueId}
                            item={qItem}
                            index={idx}
                            isCurrentLive={state.queueIndex === idx && state.program?.id === qItem.content.id}
                            isNext={idx === state.queueIndex + 1}
                            isInPreview={state.preview?.id === qItem.content.id}
                            onGoTo={() => handleGoTo(qItem.queueId)}
                            onRemove={() => handleRemove(qItem.queueId)}
                            onMoveUp={() => handleMoveUp(idx)}
                            onMoveDown={() => handleMoveDown(idx)}
                            onLoadPreview={() => loadPreview(qItem.content)}
                            isFirst={idx === 0}
                            isLast={idx === state.queue.length - 1}
                        />
                    ))
                )}
            </div>

            {/* Stream Check */}
            <div className="system-status-section">
                <div className="stream-check-head">
                    <h4 className="section-title">
                        <Icon name="monitor_heart" size={14} />
                        Stream Check
                    </h4>
                    <div className="stream-check-platform-pill">
                        <span className="stream-check-platform-label">Platform</span>
                        <strong>{state.system.streamPlatformLabel}</strong>
                    </div>
                </div>
                <p className="stream-check-caption">
                    {state.system.streamPlatformHelper}
                </p>
                <div className="status-grid">
                    <StatusItem
                        icon="link"
                        label="OBS"
                        value={state.system.obsConnected ? "Connected" : "Disconnected"}
                        status={state.system.obsConnected ? "good" : "critical"}
                    />
                    <StatusItem
                        icon="speed"
                        label="FPS"
                        value={`${state.system.fps}`}
                        status={state.system.fps >= 25 ? "good" : state.system.fps >= 15 ? "warning" : "critical"}
                    />
                    <StatusItem
                        icon="warning"
                        label="Dropped"
                        value={`${state.system.droppedFrames}`}
                        status={state.system.droppedFrames <= 5 ? "good" : state.system.droppedFrames <= 50 ? "warning" : "critical"}
                    />
                    <StatusItem
                        icon="cell_tower"
                        label="Risk"
                        value={state.system.streaming ? state.system.overallStreamRiskTitle : "OFF"}
                        status={state.system.streaming ? state.system.streamHealth : "offline"}
                    />
                </div>
                <div className="stream-check-grid">
                    <StreamCheckCard
                        title="Video Quality"
                        headline={state.system.videoQualityTitle}
                        value={state.system.currentBitrateKbps != null ? `${Math.round(state.system.currentBitrateKbps).toLocaleString()} kbps` : "Waiting"}
                        technicalLabel="Bitrate"
                        meta={state.system.videoQualityAdvice}
                        status={state.system.videoQualityStatus}
                    />
                    <StreamCheckCard
                        title="Upload Speed"
                        headline={state.system.estimatedUploadCapacityMbps != null ? `${state.system.estimatedUploadCapacityMbps.toFixed(1)} Mbps` : "Waiting"}
                        value=""
                        technicalLabel="Estimated upload capacity"
                        meta={state.system.streaming
                            ? "Used to judge safe bitrate."
                            : "Refreshes lightly while you are off-air."}
                        status={state.system.streaming ? state.system.streamHealth : "offline"}
                    />
                </div>
                <div className="stream-check-summary">
                    <div className="stream-check-summary-title">Overall Stream Risk</div>
                    <div className={`stream-check-summary-value stream-check-summary-value-${state.system.streamHealth}`}>
                        {state.system.overallStreamRiskTitle}
                    </div>
                    <div className="stream-check-summary-meta">
                        {state.system.streamFormatLabel}
                    </div>
                    <p className="stream-check-cause">{state.system.streamProbableCause}</p>
                </div>
            </div>

            {/* Emergency Controls */}
            <div className="emergency-section">
                <h4 className="section-title">
                    <Icon name="emergency" size={14} />
                    Emergency
                </h4>
                <div className="emergency-buttons">
                    <button
                        className="emergency-btn emergency-btn-black"
                        onClick={handleFadeToBlack}
                        title="Immediately cut to black screen"
                    >
                        <Icon name="visibility_off" size={16} />
                        Fade to Black
                    </button>
                    <button
                        className="emergency-btn emergency-btn-safe"
                        onClick={handleSafeFallback}
                        title="Immediately cut to Full Pastor"
                    >
                        <Icon name="person" size={16} />
                        Safe Shot
                    </button>
                    <button
                        className="emergency-btn emergency-btn-refresh"
                        onClick={onRefreshLibrary}
                        title="Refresh content library from OBS"
                    >
                        <Icon name="refresh" size={16} />
                        Refresh
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Queue Row
// ---------------------------------------------------------------------------

interface QueueRowProps {
    item: QueueItem;
    index: number;
    isCurrentLive: boolean;
    isNext: boolean;
    isInPreview: boolean;
    onGoTo: () => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onLoadPreview: () => void;
    isFirst: boolean;
    isLast: boolean;
}

function QueueRow({
    item,
    index,
    isCurrentLive,
    isNext,
    isInPreview,
    onGoTo,
    onRemove,
    onMoveUp,
    onMoveDown,
    onLoadPreview,
    isFirst,
    isLast,
}: QueueRowProps) {
    return (
        <div
            className={`queue-item ${isCurrentLive ? "queue-item-live" : ""} ${isNext ? "queue-item-next" : ""} ${item.played ? "queue-item-played" : ""} ${isInPreview ? "queue-item-preview" : ""}`}
            onDoubleClick={onLoadPreview}
        >
            <span className="queue-item-number">{index + 1}</span>

            <div className="queue-item-icon-wrap">
                <Icon name={item.content.icon} size={20} className="queue-item-icon" />
            </div>

            <div className="queue-item-info">
                <span className="queue-item-title">{item.content.title}</span>
                {isCurrentLive && <span className="queue-badge queue-badge-live">LIVE</span>}
                {isNext && !isCurrentLive && <span className="queue-badge queue-badge-next">NEXT</span>}
                {isInPreview && !isCurrentLive && !isNext && <span className="queue-badge queue-badge-pvw">PVW</span>}
            </div>

            <div className="queue-item-actions">
                <button
                    className="queue-action-btn"
                    onClick={onGoTo}
                    title="Load to Preview"
                >
                    <Icon name="visibility" size={14} />
                </button>
                <button
                    className="queue-action-btn"
                    onClick={onMoveUp}
                    disabled={isFirst}
                    title="Move Up"
                >
                    <Icon name="arrow_upward" size={14} />
                </button>
                <button
                    className="queue-action-btn"
                    onClick={onMoveDown}
                    disabled={isLast}
                    title="Move Down"
                >
                    <Icon name="arrow_downward" size={14} />
                </button>
                <button
                    className="queue-action-btn queue-action-remove"
                    onClick={onRemove}
                    title="Remove from Queue"
                >
                    <Icon name="close" size={14} />
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Status Item
// ---------------------------------------------------------------------------

interface StatusItemProps {
    icon: string;
    label: string;
    value: string;
    status: "good" | "warning" | "critical" | "offline";
}

function StatusItem({ icon, label, value, status }: StatusItemProps) {
    return (
        <div className={`status-item status-item-${status}`}>
            <Icon name={icon} size={14} className="status-item-icon" />
            <span className="status-item-label">{label}</span>
            <span className="status-item-value">{value}</span>
        </div>
    );
}

interface StreamCheckCardProps {
    title: string;
    headline: string;
    value: string;
    technicalLabel: string;
    meta: string;
    status: "good" | "warning" | "critical" | "offline";
}

function StreamCheckCard({ title, headline, value, technicalLabel, meta, status }: StreamCheckCardProps) {
    return (
        <div className={`stream-check-card stream-check-card-${status}`}>
            <span className="stream-check-card-title">{title}</span>
            <span className="stream-check-card-headline">{headline}</span>
            {value ? <span className="stream-check-card-value">{value}</span> : null}
            <span className="stream-check-card-technical">{technicalLabel}</span>
            <span className="stream-check-card-meta">{meta}</span>
        </div>
    );
}
