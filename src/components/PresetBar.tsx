/**
 * PresetBar — Quick-switch row of service mode presets.
 *
 * Shows 6 buttons: Full Pastor, Scripture View, Worship,
 * Picture-in-Picture, Full Scripture, Blank Screen.
 *
 * Clicking a preset applies transforms to OBS and switches scenes.
 * The active preset is highlighted. Volunteer mode hides advanced presets.
 */

import { useState, useCallback } from "react";
import {
    PRESETS,
    applyPreset,
    type PresetId,
    type PresetOptions,
} from "../services/presetService";
import Icon from "./Icon";

interface Props {
    activePreset: PresetId;
    cameraSource: string;
    scriptureSource: string;
    options: PresetOptions;
    volunteerMode: boolean;
    disabled: boolean;
    onPresetApplied: (presetId: PresetId) => void;
    onError: (message: string) => void;
}

/** Presets hidden in volunteer mode (only show the 3 basics) */
const VOLUNTEER_PRESETS: PresetId[] = ["full-pastor", "scripture-view", "worship"];

export function PresetBar({
    activePreset,
    cameraSource,
    scriptureSource,
    options,
    volunteerMode,
    disabled,
    onPresetApplied,
    onError,
}: Props) {
    const [applying, setApplying] = useState<PresetId | null>(null);

    const visiblePresets = volunteerMode
        ? PRESETS.filter((p) => VOLUNTEER_PRESETS.includes(p.id))
        : PRESETS;

    const handleClick = useCallback(
        async (presetId: PresetId) => {
            if (applying || disabled) return;

            setApplying(presetId);
            try {
                await applyPreset(presetId, cameraSource, scriptureSource, options);
                onPresetApplied(presetId);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to apply preset";
                console.error(`[PresetBar] Error applying ${presetId}:`, msg);
                onError(msg);
            } finally {
                setApplying(null);
            }
        },
        [applying, disabled, cameraSource, scriptureSource, options, onPresetApplied, onError]
    );

    return (
        <div className="preset-bar">
            <div className="preset-bar-label">
                <Icon name="dashboard" size={20} />
                <span>Quick Presets</span>
            </div>
            <div className="preset-bar-buttons">
                {visiblePresets.map((preset) => {
                    const isActive = activePreset === preset.id;
                    const isApplying = applying === preset.id;
                    const isBlank = preset.id === "blank";

                    return (
                        <button
                            key={preset.id}
                            className={`preset-btn ${isActive ? "preset-btn-active" : ""} ${isBlank ? "preset-btn-danger" : ""}`}
                            onClick={() => handleClick(preset.id)}
                            disabled={disabled || applying !== null}
                            title={preset.description}
                        >
                            <Icon name={isApplying ? "hourglass_empty" : preset.icon} size={20} className="preset-btn-icon" />
                            <span className="preset-btn-label">{preset.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
