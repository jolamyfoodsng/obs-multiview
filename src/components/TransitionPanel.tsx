/**
 * TransitionPanel — Global scene transition control.
 *
 * Lets the user pick transition type (Cut, Fade, Swipe, Slide)
 * and duration. Changes are applied immediately to OBS.
 */

import { useState, useEffect, useCallback } from "react";
import {
    TRANSITION_OPTIONS,
    setTransition,
    getCurrentTransition,
    type TransitionKind,
    type TransitionConfig,
} from "../services/transitionService";
import Icon from "./Icon";

interface Props {
    onError: (message: string) => void;
    onSuccess: (message: string) => void;
}

const DURATION_PRESETS = [
    { value: 0, label: "0ms (Cut)" },
    { value: 150, label: "150ms" },
    { value: 300, label: "300ms" },
    { value: 500, label: "500ms" },
    { value: 1000, label: "1s" },
];

export function TransitionPanel({ onError, onSuccess }: Props) {
    const [config, setConfig] = useState<TransitionConfig>({
        kind: "Cut",
        durationMs: 300,
    });
    const [applying, setApplying] = useState(false);

    // Load current transition from OBS on mount
    useEffect(() => {
        getCurrentTransition().then(setConfig).catch(() => {});
    }, []);

    const handleApply = useCallback(
        async (newConfig: TransitionConfig) => {
            setConfig(newConfig);
            setApplying(true);
            try {
                await setTransition(newConfig);
                onSuccess(`Transition: ${newConfig.kind} (${newConfig.durationMs}ms)`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to set transition";
                onError(msg);
            } finally {
                setApplying(false);
            }
        },
        [onError, onSuccess]
    );

    const handleKindChange = (kind: TransitionKind) => {
        const newConfig = {
            ...config,
            kind,
            durationMs: kind === "Cut" ? 0 : config.durationMs || 300,
        };
        handleApply(newConfig);
    };

    const handleDurationChange = (durationMs: number) => {
        const newConfig = { ...config, durationMs };
        handleApply(newConfig);
    };

    return (
        <div className="overlay-section">
            <h3 className="overlay-section-title">
                <Icon name="swap_horiz" size={20} />
                Scene Transition
            </h3>

            {/* Transition Type */}
            <div className="transition-types">
                {TRANSITION_OPTIONS.map((opt) => (
                    <button
                        key={opt.kind}
                        className={`transition-btn ${config.kind === opt.kind ? "transition-btn-active" : ""}`}
                        onClick={() => handleKindChange(opt.kind)}
                        disabled={applying}
                    >
                        <Icon name={opt.icon} size={20} />
                        <span>{opt.label}</span>
                    </button>
                ))}
            </div>

            {/* Duration (only for non-Cut) */}
            {config.kind !== "Cut" && (
                <div className="transition-duration">
                    <label className="form-label">Duration</label>
                    <div className="duration-presets">
                        {DURATION_PRESETS.filter((d) => d.value > 0).map((preset) => (
                            <button
                                key={preset.value}
                                className={`duration-btn ${config.durationMs === preset.value ? "duration-btn-active" : ""}`}
                                onClick={() => handleDurationChange(preset.value)}
                                disabled={applying}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                    <input
                        type="range"
                        className="ratio-slider"
                        min="100"
                        max="2000"
                        step="50"
                        value={config.durationMs}
                        onChange={(e) => handleDurationChange(parseInt(e.target.value))}
                    />
                    <div className="slider-labels">
                        <span>100ms</span>
                        <span>1s</span>
                        <span>2s</span>
                    </div>
                </div>
            )}
        </div>
    );
}
