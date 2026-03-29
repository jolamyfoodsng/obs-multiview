/**
 * LayoutTile — A single scene card for Service Mode
 *
 * Shows a real OBS scene screenshot as the tile background.
 * Falls back to a faded material icon when no screenshot is available.
 */

import Icon from "./Icon";

interface Props {
    sceneName: string;
    label: string;
    sceneNumber: number;
    icon: string;
    isLive: boolean;
    disabled: boolean;
    screenshotUrl?: string | null;
    onSwitch: () => void;
}

export function LayoutTile({
    label,
    sceneNumber,
    icon,
    isLive,
    disabled,
    screenshotUrl,
    onSwitch,
}: Props) {
    return (
        <button
            className={`layout-tile ${isLive ? "layout-tile-live" : ""}`}
            onClick={onSwitch}
            disabled={isLive || disabled}
            aria-label={`Switch to ${label}`}
        >
            {/* Background: real screenshot or fallback icon */}
            <div className="tile-bg">
                {screenshotUrl ? (
                    <img
                        src={screenshotUrl}
                        alt={`${label} preview`}
                        className="tile-bg-screenshot"
                    />
                ) : (
                    <Icon name={icon} size={20} className="tile-bg-icon" />
                )}
            </div>

            {/* Gradient overlay */}
            <div className="tile-gradient" />

            {/* LIVE badge */}
            {isLive && (
                <div className="tile-live-badge">
                    <span className="tile-live-dot" />
                    LIVE
                </div>
            )}

            {/* Bottom label */}
            <div className="tile-label">
                <div className="tile-label-text">
                    <span className="tile-scene-number">
                        Scene {sceneNumber}
                        {isLive && " • Active"}
                    </span>
                    <h3 className="tile-scene-name">{label}</h3>
                </div>

                {/* Play arrow on hover (inactive only) */}
                {!isLive && !disabled && (
                    <div className="tile-play">
                        <Icon name="play_arrow" size={20} />
                    </div>
                )}

                {/* Live indicator icon */}
                {isLive && (
                    <Icon name="podcasts" size={20} className="tile-live-icon" />
                )}
            </div>
        </button>
    );
}
