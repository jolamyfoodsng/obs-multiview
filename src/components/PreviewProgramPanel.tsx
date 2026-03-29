/**
 * PreviewProgramPanel — Center column
 *
 * Two monitors side by side:
 *   Left:  Preview (what's queued next, neutral border)
 *   Right: Program (what's live, red border)
 *
 * Below: TAKE button + transition controls
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useBroadcastStore } from "../hooks/useBroadcastStore";
import { obsService } from "../services/obsService";
import Icon from "./Icon";

export function PreviewProgramPanel() {
    const {
        state,
        executeTake,
        setTransition,
    } = useBroadcastStore();

    const [previewImg, setPreviewImg] = useState<string | null>(null);
    const [programImg, setProgramImg] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Screenshot polling for program monitor ──
    const pollScreenshots = useCallback(async () => {
        try {
            // Program: always show current OBS output
            if (state.system.obsScene) {
                const shot = await obsService.getSourceScreenshot(
                    state.system.obsScene,
                    480
                );
                if (shot) setProgramImg(shot);
            }

            // Preview: try OBS Studio Mode preview first, then fall back to scene screenshot
            if (state.preview) {
                let previewScene: string | null = null;

                // Try to get the actual OBS preview scene (Studio Mode)
                try {
                    const pvw = await obsService.call("GetCurrentPreviewScene", {}) as { currentPreviewSceneName: string };
                    previewScene = pvw.currentPreviewSceneName;
                } catch {
                    // Studio Mode may not be enabled — fall back to item's sceneName
                    previewScene = state.preview.sceneName ?? null;
                }

                if (previewScene) {
                    const shot = await obsService.getSourceScreenshot(previewScene, 480);
                    if (shot) {
                        setPreviewImg(shot);
                    } else {
                        setPreviewImg(null);
                    }
                } else {
                    setPreviewImg(null);
                }
            } else {
                setPreviewImg(null);
            }
        } catch {
            // Ignore — will retry
        }
    }, [state.system.obsScene, state.preview]);

    useEffect(() => {
        pollScreenshots();
        pollRef.current = setInterval(pollScreenshots, 800);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [pollScreenshots]);

    const handleTake = async () => {
        await executeTake();
        // Refresh screenshots after take
        setTimeout(pollScreenshots, 600);
    };

    const handleTransitionType = (type: "cut" | "fade") => {
        setTransition({ type });
    };

    const handleDuration = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTransition({ durationMs: parseInt(e.target.value, 10) });
    };

    return (
        <div className="preview-program-panel">
            {/* Monitor Row */}
            <div className="monitor-row">
                {/* Preview Monitor */}
                <div className="monitor monitor-preview">
                    <div className="monitor-label">
                        <Icon name="visibility" size={14} />
                        PREVIEW
                    </div>
                    <div className="monitor-screen">
                        {state.preview ? (
                            previewImg ? (
                                <img
                                    src={previewImg}
                                    alt="Preview"
                                    className="monitor-img"
                                    draggable={false}
                                />
                            ) : (
                                <div className="monitor-placeholder">
                                    <Icon name={state.preview.icon} size={20} className="monitor-placeholder-icon" />
                                    <span className="monitor-placeholder-text">
                                        {state.preview.title}
                                    </span>
                                </div>
                            )
                        ) : (
                            <div className="monitor-empty">
                                <Icon name="tv_off" size={32} style={{ opacity: 0.3 }} />
                                <span className="monitor-empty-text">No Preview</span>
                            </div>
                        )}
                    </div>
                    {state.preview && (
                        <div className="monitor-info">
                            <Icon name={state.preview.icon} size={14} />
                            <span className="monitor-info-title">{state.preview.title}</span>
                        </div>
                    )}
                </div>

                {/* TAKE Arrow */}
                <div className="take-arrow-col">
                    <button
                        className={`take-btn ${state.takePending ? "take-btn-pending" : ""}`}
                        onClick={handleTake}
                        disabled={!state.preview || state.takePending}
                        title="TAKE — Send preview to program"
                    >
                        <span className="take-btn-label">TAKE</span>
                        <Icon name="arrow_forward" size={20} className="take-btn-arrow" />
                    </button>
                </div>

                {/* Program Monitor */}
                <div className="monitor monitor-program">
                    <div className="monitor-label monitor-label-live">
                        <Icon name="cast" size={14} />
                        PROGRAM
                        {state.system.streaming && (
                            <span className="monitor-live-dot" />
                        )}
                    </div>
                    <div className="monitor-screen monitor-screen-live">
                        {programImg ? (
                            <img
                                src={programImg}
                                alt="Program"
                                className="monitor-img"
                                draggable={false}
                            />
                        ) : state.program ? (
                            <div className="monitor-placeholder">
                                <Icon name={state.program.icon} size={20} className="monitor-placeholder-icon" />
                                <span className="monitor-placeholder-text">
                                    {state.program.title}
                                </span>
                            </div>
                        ) : (
                            <div className="monitor-empty">
                                <Icon name="live_tv" size={32} style={{ opacity: 0.3 }} />
                                <span className="monitor-empty-text">No Program</span>
                            </div>
                        )}
                    </div>
                    {state.program && (
                        <div className="monitor-info monitor-info-live">
                            <Icon name={state.program.icon} size={14} />
                            <span className="monitor-info-title">{state.program.title}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Transition Controls */}
            <div className="transition-controls">
                <div className="transition-type-group">
                    <button
                        className={`transition-type-btn ${state.transition.type === "cut" ? "active" : ""}`}
                        onClick={() => handleTransitionType("cut")}
                    >
                        CUT
                    </button>
                    <button
                        className={`transition-type-btn ${state.transition.type === "fade" ? "active" : ""}`}
                        onClick={() => handleTransitionType("fade")}
                    >
                        FADE
                    </button>
                </div>

                {state.transition.type === "fade" && (
                    <div className="transition-duration-group">
                        <label className="transition-duration-label">
                            Duration: {state.transition.durationMs}ms
                        </label>
                        <input
                            type="range"
                            className="transition-duration-slider"
                            min={100}
                            max={2000}
                            step={50}
                            value={state.transition.durationMs}
                            onChange={handleDuration}
                        />
                    </div>
                )}

                <div className="transition-auto-group">
                    <button
                        className="auto-btn"
                        onClick={handleTake}
                        disabled={!state.preview || state.takePending}
                        title="AUTO — Take with current transition settings"
                    >
                        AUTO
                    </button>
                </div>
            </div>
        </div>
    );
}
