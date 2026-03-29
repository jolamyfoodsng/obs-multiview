/**
 * SetupWizard — First-time setup flow
 *
 * Runs when Sunday scenes don't exist in OBS.
 *
 * Steps:
 * 1. Auto-detect camera    → show dropdown if multiple / auto-select if one
 * 2. Auto-detect scripture → show dropdown if unsure
 * 3. (Future) Logo/background upload
 * 4. "Generate Sunday Layouts" button
 */

import { useState, useEffect, useCallback } from "react";
import type { OBSInput } from "../services/obsService";
import {
    detectCameraSources,
    detectScriptureSources,
    generateSundayScenes,
    type GenerationConfig,
} from "../services/layoutService";
import Icon from "./Icon";

interface Props {
    inputs: OBSInput[];
    onComplete: (config: GenerationConfig) => void;
}

type WizardStep = 1 | 2 | 3;

export function SetupWizard({ inputs, onComplete }: Props) {
    const [step, setStep] = useState<WizardStep>(1);

    // Detected sources
    const [cameras, setCameras] = useState<OBSInput[]>([]);
    const [scriptures, setScriptures] = useState<OBSInput[]>([]);

    // User selections
    const [selectedCamera, setSelectedCamera] = useState("");
    const [selectedScripture, setSelectedScripture] = useState("");

    // Generation state
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Auto-detect on mount
    useEffect(() => {
        const detectedCameras = detectCameraSources(inputs);
        const detectedScriptures = detectScriptureSources(inputs);

        setCameras(detectedCameras);
        setScriptures(detectedScriptures);

        // Auto-select if only one option
        if (detectedCameras.length === 1) {
            setSelectedCamera(detectedCameras[0].inputName);
        }
        if (detectedScriptures.length === 1) {
            setSelectedScripture(detectedScriptures[0].inputName);
        }
    }, [inputs]);

    const handleGenerate = useCallback(async () => {
        if (!selectedCamera || !selectedScripture) return;

        setIsGenerating(true);
        setError(null);

        try {
            const config: GenerationConfig = {
                cameraSource: selectedCamera,
                scriptureSource: selectedScripture,
            };

            await generateSundayScenes(config);
            onComplete(config);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Scene generation failed";
            console.error("[SetupWizard] Generation error:", message);
            setError(message);
            setIsGenerating(false);
        }
    }, [selectedCamera, selectedScripture, onComplete]);

    const canProceedStep1 = !!selectedCamera;
    const canProceedStep2 = !!selectedScripture;

    return (
        <div className="wizard">
            {/* Wizard header */}
            <div className="wizard-header">
                <div className="wizard-icon-wrap">
                    <Icon name="church" size={20} className="wizard-icon" />
                </div>
                <h2 className="wizard-title">Set Up Sunday Stream</h2>
                <p className="wizard-subtitle">
                    We'll configure your camera and presentation sources, then auto-generate your scene layouts.
                </p>
            </div>

            {/* Step indicator */}
            <div className="wizard-steps">
                {[1, 2, 3].map((s) => (
                    <div
                        key={s}
                        className={`wizard-step-dot ${s === step ? "step-active" : s < step ? "step-done" : ""
                            }`}
                    >
                        {s < step ? (
                            <Icon name="check" size={20} className="step-check" />
                        ) : (
                            s
                        )}
                    </div>
                ))}
            </div>

            {/* Step content */}
            <div className="wizard-body">
                {/* ─── Step 1: Camera Selection ─── */}
                {step === 1 && (
                    <div className="wizard-step-content">
                        <div className="step-header">
                            <Icon name="videocam" size={20} className="step-icon" />
                            <div>
                                <h3 className="step-title">Camera Source</h3>
                                <p className="step-desc">
                                    {cameras.length === 0
                                        ? "No camera sources detected — select any video source below."
                                        : cameras.length === 1
                                            ? `Auto-detected: "${cameras[0].inputName}"`
                                            : `Found ${cameras.length} cameras — pick your main one.`}
                                </p>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Select Camera</label>
                            <div className="input-wrapper">
                                <select
                                    className="form-select"
                                    value={selectedCamera}
                                    onChange={(e) => setSelectedCamera(e.target.value)}
                                >
                                    <option value="" disabled>
                                        Choose camera...
                                    </option>
                                    {/* Show detected cameras first, then all inputs as fallback */}
                                    {(cameras.length > 0 ? cameras : inputs).map((input) => (
                                        <option key={input.inputUuid} value={input.inputName}>
                                            {input.inputName}
                                        </option>
                                    ))}
                                </select>
                                <Icon name="videocam" size={20} className="input-icon" />
                            </div>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={() => setStep(2)}
                            disabled={!canProceedStep1}
                        >
                            <Icon name="arrow_forward" size={20} className="btn-icon" />
                            Continue
                        </button>
                    </div>
                )}

                {/* ─── Step 2: Scripture / Lyrics Selection ─── */}
                {step === 2 && (
                    <div className="wizard-step-content">
                        <div className="step-header">
                            <Icon name="menu_book" size={20} className="step-icon" />
                            <div>
                                <h3 className="step-title">Scripture / Lyrics Source</h3>
                                <p className="step-desc">
                                    {scriptures.length === 0
                                        ? "No presentation sources detected — select any source below."
                                        : scriptures.length === 1
                                            ? `Auto-detected: "${scriptures[0].inputName}"`
                                            : `Found ${scriptures.length} likely sources — pick the one for scriptures or lyrics.`}
                                </p>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Select Source</label>
                            <div className="input-wrapper">
                                <select
                                    className="form-select"
                                    value={selectedScripture}
                                    onChange={(e) => setSelectedScripture(e.target.value)}
                                >
                                    <option value="" disabled>
                                        Choose source...
                                    </option>
                                    {(scriptures.length > 0 ? scriptures : inputs).map(
                                        (input) => (
                                            <option key={input.inputUuid} value={input.inputName}>
                                                {input.inputName}
                                            </option>
                                        )
                                    )}
                                </select>
                                <Icon name="menu_book" size={20} className="input-icon" />
                            </div>
                        </div>

                        <div className="wizard-btn-row">
                            <button
                                className="btn-secondary"
                                onClick={() => setStep(1)}
                            >
                                <Icon name="arrow_back" size={20} className="btn-icon" />
                                Back
                            </button>
                            <button
                                className="btn-primary"
                                onClick={() => setStep(3)}
                                disabled={!canProceedStep2}
                            >
                                <Icon name="arrow_forward" size={20} className="btn-icon" />
                                Continue
                            </button>
                        </div>
                    </div>
                )}

                {/* ─── Step 3: Confirm & Generate ─── */}
                {step === 3 && (
                    <div className="wizard-step-content">
                        <div className="step-header">
                            <Icon name="auto_awesome" size={20} className="step-icon" />
                            <div>
                                <h3 className="step-title">Generate Sunday Layouts</h3>
                                <p className="step-desc">
                                    We'll create three scenes in OBS, ready for your Sunday service.
                                </p>
                            </div>
                        </div>

                        {/* Summary */}
                        <div className="wizard-summary">
                            <div className="summary-row">
                                <span className="summary-label">Camera</span>
                                <span className="summary-value">{selectedCamera}</span>
                            </div>
                            <div className="summary-row">
                                <span className="summary-label">Scripture / Lyrics</span>
                                <span className="summary-value">{selectedScripture}</span>
                            </div>
                        </div>

                        {/* Scene preview list */}
                        <div className="wizard-preview">
                            <div className="preview-item">
                                <Icon name="person" size={20} className="preview-icon" />
                                <div>
                                    <span className="preview-name">Sunday - Full Pastor</span>
                                    <span className="preview-desc">Camera stretched to fill canvas</span>
                                </div>
                            </div>
                            <div className="preview-item">
                                <Icon name="menu_book" size={20} className="preview-icon" />
                                <div>
                                    <span className="preview-name">Sunday - Scripture View</span>
                                    <span className="preview-desc">Camera left 50% · Scripture right 50%</span>
                                </div>
                            </div>
                            <div className="preview-item">
                                <Icon name="music_note" size={20} className="preview-icon" />
                                <div>
                                    <span className="preview-name">Sunday - Worship</span>
                                    <span className="preview-desc">Camera with lyrics overlay</span>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="error-banner">
                                <Icon name="error_outline" size={20} className="error-icon" />
                                <p className="error-text">{error}</p>
                            </div>
                        )}

                        <div className="wizard-btn-row">
                            <button
                                className="btn-secondary"
                                onClick={() => setStep(2)}
                                disabled={isGenerating}
                            >
                                <Icon name="arrow_back" size={20} className="btn-icon" />
                                Back
                            </button>
                            <button
                                className="btn-primary btn-generate"
                                onClick={handleGenerate}
                                disabled={isGenerating}
                            >
                                <Icon name={isGenerating ? "hourglass_empty" : "auto_awesome"} size={20} className="btn-icon" />
                                {isGenerating ? "Generating..." : "Generate Sunday Layouts"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
