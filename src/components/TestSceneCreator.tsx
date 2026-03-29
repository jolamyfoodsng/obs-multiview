/**
 * TestSceneCreator — Creates a test scene in OBS
 *
 * Lets the user pick a source and create a "Test Layout" scene
 * with that source stretched to fill the entire canvas.
 */

import { useState, type FormEvent } from "react";
import type { OBSInput } from "../services/obsService";
import Icon from "./Icon";

interface Props {
    inputs: OBSInput[];
    onCreateTestScene: (sourceName: string) => Promise<void>;
}

export function TestSceneCreator({ inputs, onCreateTestScene }: Props) {
    const [selectedSource, setSelectedSource] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!selectedSource) return;

        setIsCreating(true);
        setError(null);
        setSuccess(false);

        try {
            await onCreateTestScene(selectedSource);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 4000);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to create test scene"
            );
        } finally {
            setIsCreating(false);
        }
    };

    // Filter to video-related inputs (cameras, capture cards, etc.)
    const videoInputs = inputs.filter((input) => {
        const kind = input.unversionedInputKind.toLowerCase();
        return (
            kind.includes("camera") ||
            kind.includes("v4l2") ||
            kind.includes("dshow") ||
            kind.includes("av_capture") ||
            kind.includes("display") ||
            kind.includes("monitor") ||
            kind.includes("screen") ||
            kind.includes("window") ||
            kind.includes("browser") ||
            kind.includes("media") ||
            kind.includes("ffmpeg") ||
            kind.includes("image") ||
            kind.includes("ndi")
        );
    });

    // Fallback to all inputs if no video ones detected
    const displayedInputs = videoInputs.length > 0 ? videoInputs : inputs;

    return (
        <div className="test-scene-card">
            <div className="test-scene-header">
                <div className="test-scene-icon-wrap">
                    <Icon name="auto_awesome" size={20} className="test-scene-icon" />
                </div>
                <div>
                    <h2 className="test-scene-title">Create Test Scene</h2>
                    <p className="test-scene-subtitle">
                        Creates "Test Layout" with a source stretched full-canvas
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="test-scene-form">
                <div className="form-group">
                    <label className="form-label">Select Camera / Source</label>
                    <div className="input-wrapper">
                        <select
                            value={selectedSource}
                            onChange={(e) => setSelectedSource(e.target.value)}
                            className="form-select"
                            disabled={isCreating}
                        >
                            <option value="" disabled>
                                Select source...
                            </option>
                            {displayedInputs.map((input) => (
                                <option key={input.inputUuid} value={input.inputName}>
                                    {input.inputName}
                                </option>
                            ))}
                        </select>
                        <Icon name="videocam" size={20} className="input-icon" />
                    </div>
                </div>

                <button
                    type="submit"
                    className="btn-primary"
                    disabled={!selectedSource || isCreating}
                >
                    <Icon name={isCreating ? "hourglass_empty" : "add_circle"} size={20} className="btn-icon" />
                    {isCreating ? "Creating..." : "Generate Test Layout"}
                </button>
            </form>

            {/* Success message */}
            {success && (
                <div className="success-banner">
                    <Icon name="check_circle" size={20} className="success-icon" />
                    <p>
                        "Test Layout" created! Check your OBS scene list.
                    </p>
                </div>
            )}

            {/* Error message */}
            {error && (
                <div className="error-banner">
                    <Icon name="error_outline" size={20} className="error-icon" />
                    <p className="error-text">{error}</p>
                </div>
            )}
        </div>
    );
}
