/**
 * LayoutSettings — Simple settings page for Scripture View layout
 *
 * Controls:
 * - Split ratio slider (40/60, 50/50, 60/40) with visual preview
 * - Apply button (applies to OBS immediately)
 * - Repair Layout button
 * - Back button to return to Service Mode
 *
 * Designed for church volunteers — minimal, clean, no jargon.
 */

import { useState } from "react";
import {
    applyScriptureViewLayout,
    repairSundayLayouts,
    type GenerationConfig,
    type LayoutSettings as LayoutSettingsType,
} from "../services/layoutService";
import { AppLogo } from "./AppLogo";
import Icon from "./Icon";

interface Props {
    config: GenerationConfig;
    layout: LayoutSettingsType;
    onLayoutChange: (layout: LayoutSettingsType) => void;
    onBack: () => void;
}

/** Preset ratio options — keeps it simple for non-technical users */
const RATIO_PRESETS = [
    { value: 0.4, label: "40 / 60", desc: "Smaller camera" },
    { value: 0.5, label: "50 / 50", desc: "Even split" },
    { value: 0.6, label: "60 / 40", desc: "Larger camera" },
];

export function LayoutSettings({
    config,
    layout,
    onLayoutChange,
    onBack,
}: Props) {
    const [localRatio, setLocalRatio] = useState(layout.splitRatio);
    const [isApplying, setIsApplying] = useState(false);
    const [isRepairing, setIsRepairing] = useState(false);
    const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

    const camPercent = Math.round(localRatio * 100);
    const scriptPercent = 100 - camPercent;

    const handleApply = async () => {
        setIsApplying(true);
        setFeedbackMsg(null);
        try {
            const newLayout: LayoutSettingsType = {
                ...layout,
                splitRatio: localRatio,
            };
            await applyScriptureViewLayout(config, newLayout);
            onLayoutChange(newLayout);
            setFeedbackMsg("Layout applied to OBS ✓");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Apply failed";
            setFeedbackMsg(`Error: ${msg}`);
            console.error("[LayoutSettings] Apply failed:", err);
        } finally {
            setIsApplying(false);
            setTimeout(() => setFeedbackMsg(null), 3000);
        }
    };

    const handleRepair = async () => {
        setIsRepairing(true);
        setFeedbackMsg(null);
        try {
            const currentLayout: LayoutSettingsType = {
                ...layout,
                splitRatio: localRatio,
            };
            await repairSundayLayouts(config, currentLayout);
            setFeedbackMsg("All layouts repaired ✓");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Repair failed";
            setFeedbackMsg(`Error: ${msg}`);
            console.error("[LayoutSettings] Repair failed:", err);
        } finally {
            setIsRepairing(false);
            setTimeout(() => setFeedbackMsg(null), 3000);
        }
    };

    const hasChanges = localRatio !== layout.splitRatio;

    return (
        <div className="layout-settings">
            {/* Header */}
            <header className="ls-header">
                <div className="header-brand">
                    <div className="header-logo">
                        <AppLogo alt="OBS Church Studio" />
                    </div>
                    <div>
                        <h1 className="header-title">OBS Church Studio</h1>
                        <p className="header-subtitle">Layout Settings</p>
                    </div>
                </div>

                <button className="btn-back" onClick={onBack}>
                    <Icon name="arrow_back" size={20} />
                    Back to Service
                </button>
            </header>

            {/* Content */}
            <main className="ls-main">
                <div className="ls-card">
                    {/* ── Section: Scripture View Split ── */}
                    <section className="ls-section">
                        <div className="ls-section-header">
                            <Icon name="vertical_split" size={20} className="ls-section-icon" />
                            <div>
                                <h2 className="ls-section-title">Scripture View Split</h2>
                                <p className="ls-section-desc">
                                    Adjust how the camera and scripture share the screen.
                                </p>
                            </div>
                        </div>

                        {/* Visual preview */}
                        <div className="preview-split">
                            <div
                                className="preview-cam"
                                style={{ width: `${camPercent}%` }}
                            >
                                <Icon name="videocam" size={20} className="preview-pane-icon" />
                                <span className="preview-pane-label">Camera</span>
                                <span className="preview-pane-percent">{camPercent}%</span>
                            </div>
                            <div className="preview-divider" />
                            <div
                                className="preview-script"
                                style={{ width: `${scriptPercent}%` }}
                            >
                                <Icon name="menu_book" size={20} className="preview-pane-icon" />
                                <span className="preview-pane-label">Scripture</span>
                                <span className="preview-pane-percent">{scriptPercent}%</span>
                            </div>
                        </div>

                        {/* Ratio presets */}
                        <div className="ratio-presets">
                            {RATIO_PRESETS.map((preset) => (
                                <button
                                    key={preset.value}
                                    className={`ratio-btn ${localRatio === preset.value ? "ratio-btn-active" : ""
                                        }`}
                                    onClick={() => setLocalRatio(preset.value)}
                                >
                                    <span className="ratio-label">{preset.label}</span>
                                    <span className="ratio-desc">{preset.desc}</span>
                                </button>
                            ))}
                        </div>

                        {/* Fine-tune slider */}
                        <div className="slider-group">
                            <label className="form-label">Fine-tune</label>
                            <input
                                type="range"
                                className="ratio-slider"
                                min="0.3"
                                max="0.7"
                                step="0.05"
                                value={localRatio}
                                onChange={(e) => setLocalRatio(parseFloat(e.target.value))}
                            />
                            <div className="slider-labels">
                                <span>30%</span>
                                <span>50%</span>
                                <span>70%</span>
                            </div>
                        </div>
                    </section>

                    <div className="ls-divider" />

                    {/* ── Section: Actions ── */}
                    <section className="ls-section">
                        {/* Feedback message */}
                        {feedbackMsg && (
                            <div
                                className={`ls-feedback ${feedbackMsg.startsWith("Error") ? "ls-feedback-error" : ""
                                    }`}
                            >
                                <Icon name={feedbackMsg.startsWith("Error")
                                        ? "error_outline"
                                        : "check_circle"} size={20} className="ls-feedback-icon" />
                                {feedbackMsg}
                            </div>
                        )}

                        <div className="ls-actions">
                            <button
                                className="btn-primary"
                                onClick={handleApply}
                                disabled={isApplying}
                            >
                                <Icon name={isApplying ? "hourglass_empty" : "check"} size={20} className="btn-icon" />
                                {isApplying ? "Applying..." : hasChanges ? "Apply Changes" : "Apply Layout"}
                            </button>

                            <button
                                className="btn-secondary"
                                onClick={handleRepair}
                                disabled={isRepairing}
                            >
                                <Icon name={isRepairing ? "hourglass_empty" : "build"} size={20} className="btn-icon" />
                                {isRepairing ? "Repairing..." : "Repair All Layouts"}
                            </button>
                        </div>

                        <p className="ls-hint">
                            <Icon name="info" size={20} className="ls-hint-icon" />
                            "Apply" updates Scripture View in OBS now. "Repair" re-applies all
                            scene transforms if something looks off.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}
