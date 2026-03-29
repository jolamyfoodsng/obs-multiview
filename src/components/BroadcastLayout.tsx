/**
 * BroadcastLayout — 3-column broadcast control interface
 *
 * Layout: Content Library (25%) | Preview + Program (50%) | Service Queue (25%)
 *
 * ProPresenter / vMix / ATEM inspired.
 * Nothing goes live without an explicit TAKE.
 */

import { useEffect, useRef, useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useBroadcastStore } from "../hooks/useBroadcastStore";
import { ContentLibraryPanel } from "./ContentLibraryPanel";
import { PreviewProgramPanel } from "./PreviewProgramPanel";
import { ServiceQueuePanel } from "./ServiceQueuePanel";
import { obsService } from "../services/obsService";
import { buildContentLibrary, type ContentItem } from "../services/broadcastStore";
import { getSettings } from "../multiview/mvStore";
import { assessStreamQuality, createInitialStreamAssessmentMemory } from "../services/streamQuality";
import "./BroadcastLayout.css";
import Icon from "./Icon";

interface Props {
    onDisconnect: () => Promise<void>;
}

// Column width constraints (px)
const MIN_SIDE = 200;
const MAX_SIDE = 500;
const MIN_CENTER = 400;

export function BroadcastLayout({ onDisconnect }: Props) {
    const { state, updateSystem } = useBroadcastStore();
    const navigate = useNavigate();
    const [library, setLibrary] = useState<ContentItem[]>([]);
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamSampleRef = useRef<{
        lastSampleAt: number | null;
        lastOutputBytes: number | null;
        lastBitrateKbps: number | null;
        memory: ReturnType<typeof createInitialStreamAssessmentMemory>;
    }>({
        lastSampleAt: null,
        lastOutputBytes: null,
        lastBitrateKbps: null,
        memory: createInitialStreamAssessmentMemory(),
    });

    // ── Resizable columns ──
    const [leftWidth, setLeftWidth] = useState(280);
    const [rightWidth, setRightWidth] = useState(280);
    const bodyRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef<"left" | "right" | null>(null);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    const onDividerPointerDown = useCallback(
        (side: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            draggingRef.current = side;
            startXRef.current = e.clientX;
            startWidthRef.current = side === "left" ? leftWidth : rightWidth;
            (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
        },
        [leftWidth, rightWidth]
    );

    const onDividerPointerMove = useCallback(
        (e: ReactPointerEvent<HTMLDivElement>) => {
            if (!draggingRef.current || !bodyRef.current) return;
            const totalWidth = bodyRef.current.clientWidth;
            const delta = e.clientX - startXRef.current;

            if (draggingRef.current === "left") {
                const newLeft = Math.max(MIN_SIDE, Math.min(MAX_SIDE, startWidthRef.current + delta));
                // Ensure center doesn't get too small
                if (totalWidth - newLeft - rightWidth >= MIN_CENTER) {
                    setLeftWidth(newLeft);
                }
            } else {
                // Right divider: dragging right makes it smaller, left makes it bigger
                const newRight = Math.max(MIN_SIDE, Math.min(MAX_SIDE, startWidthRef.current - delta));
                if (totalWidth - leftWidth - newRight >= MIN_CENTER) {
                    setRightWidth(newRight);
                }
            }
        },
        [leftWidth, rightWidth]
    );

    const onDividerPointerUp = useCallback(() => {
        draggingRef.current = null;
    }, []);

    // ── Build content library from OBS scenes ──
    const refreshLibrary = useCallback(async () => {
        try {
            const scenes = await obsService.getSceneList();
            setLibrary(buildContentLibrary(scenes));
        } catch {
            // Silently ignore — will retry on next poll
        }
    }, []);

    useEffect(() => {
        refreshLibrary();
    }, [refreshLibrary]);

    // ── Poll system stats ──
    useEffect(() => {
        let cancelled = false;

        const scheduleNextPoll = (delayMs: number) => {
            if (pollRef.current) clearTimeout(pollRef.current);
            pollRef.current = setTimeout(() => {
                void poll();
            }, delayMs);
        };

        const poll = async () => {
            try {
                const [
                    stats,
                    streamStatus,
                    recordStatus,
                    scene,
                    videoSettings,
                ] = await Promise.all([
                    obsService.call("GetStats", {}) as Promise<{
                        activeFps: number;
                        renderSkippedFrames: number;
                        cpuUsage: number;
                    }>,
                    obsService.call("GetStreamStatus", {}).catch(() => null) as Promise<{
                        outputActive: boolean;
                        outputSkippedFrames?: number;
                        outputTotalFrames?: number;
                        outputBytes?: number;
                        outputCongestion?: number | null;
                        outputReconnecting?: boolean;
                    } | null>,
                    obsService.call("GetRecordStatus", {}).catch(() => null) as Promise<{
                        outputActive: boolean;
                    } | null>,
                    obsService.getCurrentProgramScene().catch(() => null),
                    obsService.getVideoSettings().catch(() => null),
                ]);

                const fps = Math.round(stats?.activeFps ?? 0);
                const dropped = streamStatus?.outputSkippedFrames ?? 0;
                const streaming = streamStatus?.outputActive ?? false;
                const recording = recordStatus?.outputActive ?? false;
                const totalFrames = streamStatus?.outputTotalFrames ?? 0;
                const droppedFrameRatio = totalFrames > 0 ? dropped / totalFrames : 0;
                const now = Date.now();

                let currentBitrateKbps = streamSampleRef.current.lastBitrateKbps;
                if (
                    streaming &&
                    typeof streamStatus?.outputBytes === "number" &&
                    streamSampleRef.current.lastOutputBytes !== null &&
                    streamSampleRef.current.lastSampleAt !== null &&
                    streamStatus.outputBytes >= streamSampleRef.current.lastOutputBytes
                ) {
                    const deltaBytes = streamStatus.outputBytes - streamSampleRef.current.lastOutputBytes;
                    const deltaSeconds = Math.max(0.5, (now - streamSampleRef.current.lastSampleAt) / 1000);
                    const sampledBitrate = (deltaBytes * 8) / deltaSeconds / 1000;
                    currentBitrateKbps = currentBitrateKbps == null
                        ? sampledBitrate
                        : currentBitrateKbps * 0.55 + sampledBitrate * 0.45;
                } else if (!streaming) {
                    currentBitrateKbps = null;
                }

                if (typeof streamStatus?.outputBytes === "number") {
                    streamSampleRef.current.lastOutputBytes = streamStatus.outputBytes;
                    streamSampleRef.current.lastSampleAt = now;
                    streamSampleRef.current.lastBitrateKbps = currentBitrateKbps;
                } else if (!streaming) {
                    streamSampleRef.current.lastOutputBytes = null;
                    streamSampleRef.current.lastSampleAt = null;
                    streamSampleRef.current.lastBitrateKbps = null;
                }

                const settings = getSettings();
                const { assessment, memory } = assessStreamQuality({
                    streaming,
                    platform: settings.streamingPlatform,
                    width: videoSettings?.outputWidth ?? 0,
                    height: videoSettings?.outputHeight ?? 0,
                    fps,
                    bitrateKbps: currentBitrateKbps,
                    droppedFrameRatio,
                    congestion: streamStatus?.outputCongestion ?? null,
                    reconnecting: Boolean(streamStatus?.outputReconnecting),
                }, streamSampleRef.current.memory);
                streamSampleRef.current.memory = memory;

                if (cancelled) return;

                updateSystem({
                    obsConnected: true,
                    obsScene: scene,
                    streaming,
                    recording,
                    droppedFrames: dropped,
                    fps,
                    cpuUsage: stats?.cpuUsage ?? 0,
                    streamHealth: assessment.overallRisk,
                    streamingPlatform: settings.streamingPlatform,
                    streamFormatLabel: assessment.formatLabel,
                    currentBitrateKbps,
                    estimatedUploadCapacityMbps: assessment.estimatedUploadCapacityMbps,
                    reconnecting: Boolean(streamStatus?.outputReconnecting),
                    overallStreamRiskTitle: assessment.overallTitle,
                    streamProbableCause: assessment.probableCause,
                    videoQualityStatus: assessment.videoQualityStatus,
                    videoQualityTitle: assessment.videoQualityTitle,
                    videoQualityAdvice: assessment.videoQualityAdvice,
                    streamPlatformLabel: assessment.platformLabel,
                    streamPlatformHelper: assessment.platformHelper,
                });
                scheduleNextPoll(streaming ? 2000 : 8000);
            } catch {
                if (cancelled) return;
                updateSystem({
                    obsConnected: false,
                    streamHealth: "offline",
                    reconnecting: false,
                    currentBitrateKbps: null,
                    estimatedUploadCapacityMbps: streamSampleRef.current.memory.uploadCapacityMbps,
                    overallStreamRiskTitle: "Offline",
                    streamProbableCause: "OBS is disconnected.",
                    videoQualityStatus: "offline",
                    videoQualityTitle: "OBS not connected",
                    videoQualityAdvice: "Reconnect OBS to resume Stream Check.",
                });
                scheduleNextPoll(8000);
            }
        };

        void poll();
        return () => {
            cancelled = true;
            if (pollRef.current) clearTimeout(pollRef.current);
        };
    }, [updateSystem]);

    // ── Filter library based on tab + search ──
    const filteredLibrary = library.filter((item) => {
        if (state.libraryTab !== "all" && item.type !== state.libraryTab) return false;
        if (state.librarySearch) {
            const q = state.librarySearch.toLowerCase();
            return (
                item.title.toLowerCase().includes(q) ||
                item.subtitle?.toLowerCase().includes(q) ||
                item.type.toLowerCase().includes(q)
            );
        }
        return true;
    });

    return (
        <div className="broadcast-layout">
            {/* Header bar */}
            <header className="broadcast-header">
                <div className="broadcast-header-brand">
                    <Icon name="cameraswitch" size={20} className="broadcast-logo-icon" />
                    <span className="broadcast-header-title">OBS Church Studio</span>
                </div>

                <div className="broadcast-header-center">
                    {state.system.streaming && (
                        <span className="broadcast-live-badge">
                            <span className="broadcast-live-dot" />
                            LIVE
                        </span>
                    )}
                    {state.system.recording && (
                        <span className="broadcast-rec-badge">
                            <Icon name="fiber_manual_record" size={14} />
                            REC
                        </span>
                    )}
                    {!state.system.streaming && !state.system.recording && (
                        <span className="broadcast-idle-badge">STANDBY</span>
                    )}
                </div>

                <div className="broadcast-header-right">
                    <span className="broadcast-stat">
                        <Icon name="speed" size={14} />
                        {state.system.fps} FPS
                    </span>
                    {state.system.streaming && (
                        <span className={`broadcast-stat broadcast-health-${state.system.streamHealth}`}>
                            <Icon name="cell_tower" size={14} />
                            {state.system.streamHealth.toUpperCase()}
                        </span>
                    )}
                    <button
                        className="broadcast-mv-btn"
                        onClick={() => navigate("/")}
                        title="Open Multi-View Editor"
                    >
                        <Icon name="grid_view" size={16} />
                    </button>
                    <button
                        className="broadcast-disconnect-btn"
                        onClick={onDisconnect}
                        title="Disconnect from OBS"
                    >
                        <Icon name="power_settings_new" size={16} />
                    </button>
                </div>
            </header>

            {/* 3-column body with draggable dividers */}
            <div className="broadcast-body" ref={bodyRef}>
                <div className="broadcast-col broadcast-col-left" style={{ width: leftWidth, minWidth: MIN_SIDE, maxWidth: MAX_SIDE }}>
                    <ContentLibraryPanel items={filteredLibrary} />
                </div>

                {/* Left divider */}
                <div
                    className={`broadcast-divider ${draggingRef.current === "left" ? "broadcast-divider-active" : ""}`}
                    onPointerDown={(e) => onDividerPointerDown("left", e)}
                    onPointerMove={onDividerPointerMove}
                    onPointerUp={onDividerPointerUp}
                >
                    <div className="broadcast-divider-line" />
                </div>

                <div className="broadcast-col broadcast-col-center" style={{ flex: 1, minWidth: MIN_CENTER }}>
                    <PreviewProgramPanel />
                </div>

                {/* Right divider */}
                <div
                    className={`broadcast-divider ${draggingRef.current === "right" ? "broadcast-divider-active" : ""}`}
                    onPointerDown={(e) => onDividerPointerDown("right", e)}
                    onPointerMove={onDividerPointerMove}
                    onPointerUp={onDividerPointerUp}
                >
                    <div className="broadcast-divider-line" />
                </div>

                <div className="broadcast-col broadcast-col-right" style={{ width: rightWidth, minWidth: MIN_SIDE, maxWidth: MAX_SIDE }}>
                    <ServiceQueuePanel onRefreshLibrary={refreshLibrary} />
                </div>
            </div>
        </div>
    );
}
