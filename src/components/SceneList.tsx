/**
 * SceneList — Displays OBS scenes and inputs
 *
 * Shows the current program scene with a LIVE badge, allows scene switching,
 * and lists available inputs/sources.
 */

import type { OBSScene, OBSInput } from "../services/obsService";
import Icon from "./Icon";

interface Props {
    scenes: OBSScene[];
    inputs: OBSInput[];
    currentScene: string | null;
    onSwitchScene: (sceneName: string) => Promise<void>;
    onRefresh: () => Promise<void>;
}

export function SceneList({
    scenes,
    inputs,
    currentScene,
    onSwitchScene,
    onRefresh,
}: Props) {
    return (
        <div className="data-panel">
            {/* Header with refresh */}
            <div className="panel-header">
                <h2 className="panel-title">
                    <Icon name="movie" size={20} className="panel-icon" />
                    OBS Data
                </h2>
                <button onClick={onRefresh} className="btn-icon-only" title="Refresh">
                    <Icon name="refresh" size={20} />
                </button>
            </div>

            {/* Scenes Section */}
            <div className="panel-section">
                <div className="section-header">
                    <span className="section-label">Scenes</span>
                    <span className="section-count">{scenes.length}</span>
                </div>
                {scenes.length === 0 ? (
                    <p className="empty-text">No scenes found</p>
                ) : (
                    <div className="scene-grid">
                        {scenes.map((scene) => {
                            const isLive = scene.sceneName === currentScene;
                            return (
                                <button
                                    key={scene.sceneUuid}
                                    className={`scene-card ${isLive ? "scene-card-live" : ""}`}
                                    onClick={() => onSwitchScene(scene.sceneName)}
                                    disabled={isLive}
                                >
                                    {isLive && (
                                        <div className="live-badge">
                                            <span className="live-dot" />
                                            LIVE
                                        </div>
                                    )}
                                    <div className="scene-card-content">
                                        <span className="scene-index">
                                            Scene {scene.sceneIndex + 1}
                                        </span>
                                        <h3 className="scene-name">{scene.sceneName}</h3>
                                    </div>
                                    {!isLive && (
                                        <div className="scene-play-icon">
                                            <Icon name="play_arrow" size={20} />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Inputs Section */}
            <div className="panel-section">
                <div className="section-header">
                    <span className="section-label">Inputs / Sources</span>
                    <span className="section-count">{inputs.length}</span>
                </div>
                {inputs.length === 0 ? (
                    <p className="empty-text">No inputs found</p>
                ) : (
                    <div className="input-list">
                        {inputs.map((input) => (
                            <div key={input.inputUuid} className="input-item">
                                <div className="input-item-icon">
                                    <Icon name={getInputIcon(input.unversionedInputKind)} size={20} />
                                </div>
                                <div className="input-item-text">
                                    <span className="input-name">{input.inputName}</span>
                                    <span className="input-kind">
                                        {input.unversionedInputKind}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Map OBS input kinds to Material Icons */
function getInputIcon(kind: string): string {
    if (kind.includes("camera") || kind.includes("v4l2") || kind.includes("dshow"))
        return "videocam";
    if (kind.includes("audio") || kind.includes("pulse") || kind.includes("wasapi"))
        return "mic";
    if (kind.includes("monitor") || kind.includes("display") || kind.includes("screen"))
        return "monitor";
    if (kind.includes("window")) return "web_asset";
    if (kind.includes("image")) return "image";
    if (kind.includes("media") || kind.includes("ffmpeg")) return "movie";
    if (kind.includes("browser")) return "language";
    if (kind.includes("text")) return "text_fields";
    if (kind.includes("color")) return "palette";
    return "input";
}
