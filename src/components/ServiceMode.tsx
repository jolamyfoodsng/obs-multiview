/**
 * ServiceMode — Single-screen production dashboard
 *
 * Everything lives here, no routing:
 * - Feedback banner (health warnings)
 * - Preset bar (6 quick-switch presets)
 * - Scene grid with LayoutTile cards
 * - ON AIR footer
 * - Dropdown menu: Layout Settings / Repair / Volunteer Mode / Disconnect
 * - Layout Settings overlay (split ratio, background, logo, transitions)
 * - Toast notifications
 * - Auto-sync mode (debounced 300ms)
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { LayoutTile } from "./LayoutTile";
import { PresetBar } from "./PresetBar";
import { FeedbackBanner } from "./FeedbackBanner";
import { TransitionPanel } from "./TransitionPanel";
import { useLayoutStore } from "../hooks/useLayoutStore";
import { AppLogo } from "./AppLogo";
import {
    SUNDAY_SCENES,
    repairSundayLayouts,
    type GenerationConfig,
    DEFAULT_LAYOUT_SETTINGS,
} from "../services/layoutService";
import {
    applyFullLayout,
    saveUploadFile,
} from "../services/layoutEngine";
import { obsService } from "../services/obsService";
import { loadData, updateData } from "../services/store";
import type { PresetId, PresetOptions } from "../services/presetService";
import { DEFAULT_PRESET_OPTIONS } from "../services/presetService";
import Icon from "./Icon";

interface Props {
    currentScene: string | null;
    onSwitchScene: (sceneName: string) => Promise<void>;
    onDisconnect: () => Promise<void>;
    disabled: boolean;
    config: GenerationConfig | null;
}

const TILES = [
    { sceneName: SUNDAY_SCENES.FULL_PASTOR, label: "Full Pastor", icon: "person", sceneNumber: 1 },
    { sceneName: SUNDAY_SCENES.SCRIPTURE_VIEW, label: "Scripture View", icon: "menu_book", sceneNumber: 2 },
    { sceneName: SUNDAY_SCENES.WORSHIP, label: "Worship", icon: "music_note", sceneNumber: 3 },
];

const RATIO_PRESETS: { value: number; label: string; desc: string }[] = [
    { value: 0.4, label: "40 / 60", desc: "Left heavy" },
    { value: 0.5, label: "50 / 50", desc: "Balanced" },
    { value: 0.6, label: "60 / 40", desc: "Right heavy" },
];

const SERVICE_LOGO_UPLOAD_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;
const SERVICE_LOGO_UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"] as const;
const SERVICE_LOGO_UPLOAD_ACCEPT = [...SERVICE_LOGO_UPLOAD_MIME_TYPES, ...SERVICE_LOGO_UPLOAD_EXTENSIONS].join(",");

function hasAllowedServiceLogoExtension(filename: string): boolean {
    const dot = filename.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = filename.slice(dot).toLowerCase();
    return SERVICE_LOGO_UPLOAD_EXTENSIONS.includes(ext as (typeof SERVICE_LOGO_UPLOAD_EXTENSIONS)[number]);
}

interface Toast {
    id: number;
    message: string;
    type: "success" | "error";
}

export function ServiceMode({
    currentScene,
    onSwitchScene,
    onDisconnect,
    disabled,
    config,
}: Props) {
    // ── Global Layout State ──
    const { state: layoutState, updateLayout } = useLayoutStore();

    // ── Preset / Volunteer State ──
    const [activePreset, setActivePreset] = useState<PresetId>("full-pastor");
    const [volunteerMode, setVolunteerMode] = useState(false);
    const [presetOptions, setPresetOptions] = useState<PresetOptions>(DEFAULT_PRESET_OPTIONS);

    // ── UI State ──
    const [showMenu, setShowMenu] = useState(false);
    const [showOverlay, setShowOverlay] = useState(false);
    const [isRepairing, setIsRepairing] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    // ── Live Preview Screenshots ──
    const [camScreenshot, setCamScreenshot] = useState<string | null>(null);
    const [scriptScreenshot, setScriptScreenshot] = useState<string | null>(null);

    // ── Scene Tile Screenshots (always poll) ──
    const [sceneScreenshots, setSceneScreenshots] = useState<Record<string, string | null>>({});

    // ── Toast State ──
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastCounter = useRef(0);

    const addToast = useCallback((message: string, type: "success" | "error") => {
        const id = Date.now() + (toastCounter.current++);
        console.log(`[Toast] ${type}: ${message}`);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
    }, []);

    // ── Close menu on outside click ──
    useEffect(() => {
        if (!showMenu) return;
        const handleClick = () => setShowMenu(false);
        const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("click", handleClick);
        };
    }, [showMenu]);

    // ── LIVE PREVIEW: Poll OBS screenshots every 2s while overlay is open ──
    useEffect(() => {
        if (!showOverlay || !config) return;

        let cancelled = false;

        const fetchScreenshots = async () => {
            if (cancelled) return;
            try {
                const [cam, script] = await Promise.all([
                    obsService.getSourceScreenshot(config.cameraSource, 480),
                    obsService.getSourceScreenshot(config.scriptureSource, 480),
                ]);
                if (!cancelled) {
                    setCamScreenshot(cam);
                    setScriptScreenshot(script);
                }
            } catch (err) {
                console.warn("[ServiceMode] Screenshot poll error:", err);
            }
        };

        // Fetch immediately on overlay open
        fetchScreenshots();

        // Then poll every 2 seconds
        const interval = setInterval(fetchScreenshots, 2000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [showOverlay, config]);

    // ── SCENE TILE SCREENSHOTS: Poll every 3s for tile backgrounds ──
    useEffect(() => {
        let cancelled = false;

        const fetchSceneScreenshots = async () => {
            if (cancelled) return;
            const results: Record<string, string | null> = {};
            try {
                const shots = await Promise.all(
                    TILES.map((t) => obsService.getSourceScreenshot(t.sceneName, 320))
                );
                TILES.forEach((t, i) => {
                    results[t.sceneName] = shots[i];
                });
            } catch {
                // ignore — scenes may not exist yet
            }
            if (!cancelled) {
                setSceneScreenshots(results);
            }
        };

        fetchSceneScreenshots();
        const interval = setInterval(fetchSceneScreenshots, 3000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    // ── LOAD SAVED LAYOUT FROM STORE ON MOUNT ──
    const storeLoadedRef = useRef(false);
    useEffect(() => {
        if (storeLoadedRef.current) return;
        storeLoadedRef.current = true;
        (async () => {
            try {
                const data = await loadData();
                console.log("[ServiceMode] Loading saved layout from store:", data.layout);
                updateLayout({
                    splitRatio: data.layout.splitRatio,
                    backgroundColor: data.layout.backgroundColor,
                    logoScale: data.layout.logoScale,
                    logoUrl: data.logoPath || "",
                });
                if (data.logoPath) {
                    setLogoPreview(data.logoPath);
                }
                // Load preset / volunteer / transition state
                if (data.activePreset) {
                    setActivePreset(data.activePreset as PresetId);
                }
                setVolunteerMode(data.volunteerMode ?? false);
                if (data.pip) {
                    setPresetOptions({
                        splitRatio: data.layout.splitRatio,
                        pipSize: data.pip.size ?? DEFAULT_PRESET_OPTIONS.pipSize,
                        pipCorner: (data.pip.corner ?? DEFAULT_PRESET_OPTIONS.pipCorner) as PresetOptions["pipCorner"],
                    });
                }
            } catch (err) {
                console.warn("[ServiceMode] Failed to load saved layout:", err);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── AUTO-SAVE LAYOUT TO STORE (debounced 500ms) ──
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevSaveRef = useRef<string>("");

    useEffect(() => {
        const saveKey = JSON.stringify({
            splitRatio: layoutState.splitRatio,
            backgroundColor: layoutState.backgroundColor,
            logoScale: layoutState.logoScale,
            logoPath: layoutState.logoUrl,
            activePreset,
            volunteerMode,
        });
        if (prevSaveRef.current === saveKey) return;
        prevSaveRef.current = saveKey;

        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => {
            console.log("[ServiceMode] Auto-saving layout to store");
            updateData({
                layout: {
                    splitRatio: layoutState.splitRatio,
                    backgroundColor: layoutState.backgroundColor,
                    logoScale: layoutState.logoScale,
                },
                logoPath: layoutState.logoUrl || null,
                activePreset,
                volunteerMode,
                pip: {
                    size: presetOptions.pipSize,
                    corner: presetOptions.pipCorner,
                },
            }).catch((err) => console.error("[ServiceMode] Auto-save failed:", err));
        }, 500);

        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [layoutState.splitRatio, layoutState.backgroundColor, layoutState.logoScale, layoutState.logoUrl, activePreset, volunteerMode, presetOptions]);

    // ── AUTO-SYNC TO OBS: debounced 300ms push on every state change ──
    const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevStateRef = useRef<string>(JSON.stringify(layoutState));

    useEffect(() => {
        if (!layoutState.autoSync || !config) return;

        const currentJson = JSON.stringify(layoutState);
        if (prevStateRef.current === currentJson) return;
        prevStateRef.current = currentJson;

        if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);

        autoSyncTimerRef.current = setTimeout(() => {
            console.log("[ServiceMode] Auto-sync: pushing state to OBS (debounced 300ms)");
            applyFullLayout(config, layoutState)
                .then(() => console.log("[ServiceMode] Auto-sync: applied successfully"))
                .catch((err) => console.error("[ServiceMode] Auto-sync error:", err));
        }, 300);

        return () => {
            if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
        };
    }, [layoutState, config]);

    // ── Button Handlers ──

    const handlePresetApplied = useCallback((presetId: PresetId) => {
        setActivePreset(presetId);
        addToast(`Preset: ${presetId.replace(/-/g, " ")}`, "success");
    }, [addToast]);

    const handlePresetError = useCallback((msg: string) => {
        addToast(`Preset error: ${msg}`, "error");
    }, [addToast]);

    const handleOpenSettings = () => {
        console.log("[ServiceMode] Opening Layout Settings overlay");
        setShowMenu(false);
        setShowOverlay(true);
    };

    const handleCloseOverlay = () => {
        console.log("[ServiceMode] Closing Layout Settings overlay");
        setShowOverlay(false);
        setCamScreenshot(null);
        setScriptScreenshot(null);
    };

    const handleRepair = async () => {
        console.log("[ServiceMode] Repair Layouts clicked");
        if (!config) {
            addToast("No config available — run setup first", "error");
            return;
        }
        setIsRepairing(true);
        setShowMenu(false);
        try {
            await repairSundayLayouts(config, {
                ...DEFAULT_LAYOUT_SETTINGS,
                splitRatio: layoutState.splitRatio,
            });
            addToast("Layouts repaired successfully", "success");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error("[ServiceMode] Repair failed:", msg);
            addToast(`Repair failed: ${msg}`, "error");
        } finally {
            setIsRepairing(false);
        }
    };

    const handleDisconnect = async () => {
        console.log("[ServiceMode] Disconnect clicked");
        setShowMenu(false);
        try {
            await onDisconnect();
        } catch (err) {
            console.error("[ServiceMode] Disconnect error:", err);
        }
    };

    /**
     * APPLY TO OBS — sends real obs-websocket commands.
     * Calls applyFullLayout which:
     *  1. Creates/updates "Scripture Background" color source
     *  2. Resizes camera + scripture sources (split ratio)
     *  3. Creates/updates "Church Logo" image source
     */
    const handleApplyLayout = async () => {
        console.log("[ServiceMode] ═══ Apply to OBS clicked ═══");
        console.log("[ServiceMode] Current state:", JSON.stringify(layoutState, null, 2));
        if (!config) {
            addToast("No config — run setup first", "error");
            return;
        }
        setIsApplying(true);
        try {
            await applyFullLayout(config, layoutState);
            addToast("Layout applied to OBS ✓", "success");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Apply failed";
            console.error("[ServiceMode] Apply failed:", msg);
            addToast(`Apply failed: ${msg}`, "error");
        } finally {
            setIsApplying(false);
        }
    };

    /**
     * LOGO UPLOAD — saves file via Tauri Rust command, returns absolute path.
     * Then stores path in layout state for OBS image source.
     */
    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const isImageMime = file.type.startsWith("image/");
        const isAllowedExt = hasAllowedServiceLogoExtension(file.name);
        if (!isImageMime && !isAllowedExt) {
            addToast("Unsupported logo file type. Use PNG, JPG, WEBP, GIF, or SVG.", "error");
            e.target.value = "";
            return;
        }

        console.log(`[ServiceMode] Logo file selected: ${file.name} (${file.size} bytes)`);
        setIsUploading(true);

        try {
            // Create local preview for the UI
            const previewUrl = URL.createObjectURL(file);
            setLogoPreview(previewUrl);

            // Save file to disk via Tauri Rust command → get absolute path
            const absolutePath = await saveUploadFile(file);
            console.log(`[ServiceMode] Logo saved to: ${absolutePath}`);

            // Store absolute path in layout state (this is what OBS needs)
            updateLayout({ logoUrl: absolutePath });
            addToast(`Logo saved: ${file.name}`, "success");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            console.error("[ServiceMode] Logo upload failed:", msg);
            addToast(`Upload failed: ${msg}`, "error");
            setLogoPreview(null);
        } finally {
            setIsUploading(false);
        }
    };

    const handleSwitchScene = async (sceneName: string) => {
        console.log(`[ServiceMode] Switch scene → "${sceneName}"`);
        await onSwitchScene(sceneName);
    };

    const camPercent = Math.round(layoutState.splitRatio * 100);
    const scriptPercent = 100 - camPercent;

    return (
        <div className="service-mode">
            {/* ════════ HEADER ════════ */}
            <header className="sm-header">
                <div className="header-brand">
                    <div className="header-logo">
                        <AppLogo alt="OBS Church Studio" />
                    </div>
                    <div>
                        <h1 className="header-title">OBS Church Studio</h1>
                        <p className="header-subtitle">Service Mode</p>
                    </div>
                </div>

                <div className="status-pill">
                    <span className="status-pill-dot">
                        <span className="status-pill-ping" />
                        <span className="status-pill-solid" />
                    </span>
                    <span className="status-pill-text">CONNECTED TO OBS</span>
                </div>

                <div className="sm-header-actions">
                    <div className="sm-menu-wrap">
                        <button
                            className="btn-icon-only"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMenu(!showMenu);
                            }}
                            title="Settings"
                        >
                            <Icon name="more_vert" size={20} />
                        </button>
                        {showMenu && (
                            <div className="sm-dropdown" onClick={(e) => e.stopPropagation()}>
                                {!volunteerMode && (
                                    <button className="sm-dropdown-item" onClick={handleOpenSettings}>
                                        <Icon name="tune" size={20} />
                                        Layout Settings
                                    </button>
                                )}
                                {!volunteerMode && (
                                    <button
                                        className="sm-dropdown-item"
                                        onClick={handleRepair}
                                        disabled={isRepairing || !config}
                                    >
                                        <Icon name="build" size={20} />
                                        {isRepairing ? "Repairing..." : "Repair Layouts"}
                                    </button>
                                )}
                                <div className="sm-dropdown-divider" />
                                <button
                                    className="sm-dropdown-item"
                                    onClick={() => {
                                        setVolunteerMode(!volunteerMode);
                                        setShowMenu(false);
                                        addToast(
                                            volunteerMode ? "Advanced mode enabled" : "Volunteer mode enabled — simplified controls",
                                            "success"
                                        );
                                    }}
                                >
                                    <Icon name={volunteerMode ? "admin_panel_settings" : "person"} size={20} />
                                    {volunteerMode ? "Advanced Mode" : "Volunteer Mode"}
                                </button>
                                <div className="sm-dropdown-divider" />
                                <button className="sm-dropdown-item sm-dropdown-danger" onClick={handleDisconnect}>
                                    <Icon name="power_settings_new" size={20} />
                                    Disconnect
                                </button>
                            </div>
                        )}
                    </div>

                    <button className="sm-panic-btn" title="Emergency — switch to black">
                        <Icon name="pause_presentation" size={20} />
                        <span className="sm-panic-text">PAUSE STREAM</span>
                    </button>
                </div>
            </header>

            {/* ════════ FEEDBACK BANNER ════════ */}
            <FeedbackBanner config={config} />

            {/* ════════ PRESET BAR ════════ */}
            {config && (
                <PresetBar
                    activePreset={activePreset}
                    cameraSource={config.cameraSource}
                    scriptureSource={config.scriptureSource}
                    options={{ ...presetOptions, splitRatio: layoutState.splitRatio }}
                    volunteerMode={volunteerMode}
                    disabled={disabled}
                    onPresetApplied={handlePresetApplied}
                    onError={handlePresetError}
                />
            )}

            {/* ════════ SCENE GRID ════════ */}
            <main className="sm-grid">
                {TILES.map((tile) => (
                    <LayoutTile
                        key={tile.sceneName}
                        sceneName={tile.sceneName}
                        label={tile.label}
                        icon={tile.icon}
                        sceneNumber={tile.sceneNumber}
                        isLive={currentScene === tile.sceneName}
                        disabled={disabled}
                        screenshotUrl={sceneScreenshots[tile.sceneName]}
                        onSwitch={() => handleSwitchScene(tile.sceneName)}
                    />
                ))}
            </main>

            {/* ════════ ON AIR FOOTER ════════ */}
            <footer className="sm-footer">
                <div className="footer-content">
                    <div className="footer-dot-wrap">
                        <div className="footer-dot" />
                        <div className="footer-dot-ping" />
                    </div>
                    <div className="footer-text">
                        <span className="footer-label">Current Output</span>
                        <h2 className="footer-scene">
                            ON AIR:{" "}
                            <span className="footer-scene-name">
                                {currentScene
                                    ? currentScene.replace("Sunday - ", "").toUpperCase()
                                    : "NONE"}
                            </span>
                        </h2>
                    </div>
                    <div className="footer-dot-wrap">
                        <div className="footer-dot" />
                        <div className="footer-dot-ping" />
                    </div>
                </div>
            </footer>

            {/* ════════ TOAST NOTIFICATIONS ════════ */}
            <div className="toast-container">
                {toasts.map((toast) => (
                    <div key={toast.id} className={`toast toast-${toast.type}`}>
                        <Icon name={toast.type === "success" ? "check_circle" : "error_outline"} size={20} className="toast-icon" />
                        <span className="toast-msg">{toast.message}</span>
                    </div>
                ))}
            </div>

            {/* ════════ LAYOUT SETTINGS OVERLAY ════════ */}
            {showOverlay && (
                <div className="overlay-backdrop" onClick={handleCloseOverlay}>
                    <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="overlay-header">
                            <div className="overlay-header-left">
                                <Icon name="tune" size={20} className="overlay-icon" />
                                <div>
                                    <h2 className="overlay-title">Layout Settings</h2>
                                    <p className="overlay-subtitle">Controls real OBS scene transforms</p>
                                </div>
                            </div>
                            <button className="btn-back" onClick={handleCloseOverlay}>
                                <Icon name="close" size={20} />
                                Close
                            </button>
                        </div>

                        {/* Body */}
                        <div className="overlay-body">
                            {/* ── Live Preview ── */}
                            <div className="overlay-section">
                                <h3 className="overlay-section-title">
                                    <Icon name="preview" size={20} />
                                    Live Preview
                                </h3>
                                <div
                                    className="preview-canvas"
                                    style={{ backgroundColor: layoutState.backgroundColor }}
                                >
                                    <div className="preview-split">
                                        <div className="preview-cam" style={{ width: `${camPercent}%` }}>
                                            {camScreenshot ? (
                                                <img
                                                    src={camScreenshot}
                                                    alt="Camera preview"
                                                    className="preview-pane-screenshot"
                                                />
                                            ) : (
                                                <Icon name="videocam" size={20} className="preview-pane-icon" />
                                            )}
                                            <div className="preview-pane-overlay">
                                                <span className="preview-pane-label">Camera</span>
                                                <span className="preview-pane-percent">{camPercent}%</span>
                                            </div>
                                        </div>
                                        <div className="preview-script" style={{ width: `${scriptPercent}%` }}>
                                            {scriptScreenshot ? (
                                                <img
                                                    src={scriptScreenshot}
                                                    alt="Scripture preview"
                                                    className="preview-pane-screenshot"
                                                />
                                            ) : (
                                                <Icon name="menu_book" size={20} className="preview-pane-icon" />
                                            )}
                                            <div className="preview-pane-overlay">
                                                <span className="preview-pane-label">Scripture</span>
                                                <span className="preview-pane-percent">{scriptPercent}%</span>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Logo preview in canvas */}
                                    {(logoPreview || layoutState.logoUrl) && (
                                        <div
                                            className="preview-logo-img-wrap preview-logo-bottom"
                                            style={{ transform: `scale(${layoutState.logoScale * 5})` }}
                                        >
                                            <img
                                                src={logoPreview || ""}
                                                alt="Logo"
                                                className="preview-logo-img"
                                            />
                                        </div>
                                    )}
                                    {!logoPreview && !layoutState.logoUrl && (
                                        <div
                                            className="preview-logo-placeholder preview-logo-bottom"
                                            style={{
                                                width: `${Math.round(layoutState.logoScale * 150)}px`,
                                                height: `${Math.round(layoutState.logoScale * 150)}px`,
                                            }}
                                        >
                                            <Icon name="church" size={20} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Split Ratio ── */}
                            <div className="overlay-section">
                                <h3 className="overlay-section-title">
                                    <Icon name="vertical_split" size={20} />
                                    Split Ratio
                                </h3>
                                <div className="ratio-presets">
                                    {RATIO_PRESETS.map((preset) => (
                                        <button
                                            key={preset.value}
                                            className={`ratio-btn ${layoutState.splitRatio === preset.value ? "ratio-btn-active" : ""}`}
                                            onClick={() => {
                                                console.log(`[LayoutSettings] Ratio preset: ${preset.label}`);
                                                updateLayout({ splitRatio: preset.value });
                                            }}
                                        >
                                            <span className="ratio-label">{preset.label}</span>
                                            <span className="ratio-desc">{preset.desc}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="slider-group">
                                    <label className="form-label">Fine-tune</label>
                                    <input
                                        type="range"
                                        className="ratio-slider"
                                        min="0.3"
                                        max="0.7"
                                        step="0.05"
                                        value={layoutState.splitRatio}
                                        onChange={(e) => updateLayout({ splitRatio: parseFloat(e.target.value) })}
                                    />
                                    <div className="slider-labels">
                                        <span>30%</span>
                                        <span>50%</span>
                                        <span>70%</span>
                                    </div>
                                </div>
                            </div>

                            {/* ── Background Color ── */}
                            <div className="overlay-section">
                                <h3 className="overlay-section-title">
                                    <Icon name="palette" size={20} />
                                    Background Color
                                </h3>
                                <div className="color-picker-row">
                                    <input
                                        type="color"
                                        className="color-input"
                                        value={layoutState.backgroundColor}
                                        onChange={(e) => {
                                            console.log(`[LayoutSettings] Background color: ${e.target.value}`);
                                            updateLayout({ backgroundColor: e.target.value });
                                        }}
                                    />
                                    <span className="color-value">{layoutState.backgroundColor}</span>
                                </div>
                            </div>

                            {/* ── Church Logo ── */}
                            <div className="overlay-section">
                                <h3 className="overlay-section-title">
                                    <Icon name="image" size={20} />
                                    Church Logo
                                </h3>
                                <div className="logo-upload-area">
                                    {logoPreview ? (
                                        <img src={logoPreview} alt="Logo preview" className="logo-preview-thumb" />
                                    ) : (
                                        <>
                                            <Icon name={isUploading ? "hourglass_empty" : "cloud_upload"} size={20} className="logo-upload-icon" />
                                            <span className="logo-upload-text">
                                                {isUploading ? "Saving to disk..." : "Click to upload PNG or SVG"}
                                            </span>
                                        </>
                                    )}
                                    <input
                                        type="file"
                                        accept={SERVICE_LOGO_UPLOAD_ACCEPT}
                                        className="logo-file-input"
                                        onChange={handleLogoUpload}
                                        disabled={isUploading}
                                    />
                                </div>
                                {layoutState.logoUrl && (
                                    <>
                                        <p className="logo-path-display">
                                            📁 {layoutState.logoUrl}
                                        </p>
                                        <button
                                            className="btn-text-danger"
                                            onClick={() => {
                                                console.log("[LayoutSettings] Logo removed");
                                                setLogoPreview(null);
                                                updateLayout({ logoUrl: null });
                                            }}
                                        >
                                            <Icon name="delete" size={20} />
                                            Remove Logo
                                        </button>
                                    </>
                                )}
                                <div className="slider-group">
                                    <label className="form-label">Logo Size</label>
                                    <input
                                        type="range"
                                        className="ratio-slider"
                                        min="0.05"
                                        max="0.25"
                                        step="0.01"
                                        value={layoutState.logoScale}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            console.log(`[LayoutSettings] Logo size: ${Math.round(v * 100)}%`);
                                            updateLayout({ logoScale: v });
                                        }}
                                    />
                                    <div className="slider-labels">
                                        <span>Small</span>
                                        <span>Medium</span>
                                        <span>Large</span>
                                    </div>
                                </div>
                            </div>

                            {/* ── Auto-Sync Toggle ── */}
                            <div className="overlay-section">
                                <div className="auto-sync-row">
                                    <div className="auto-sync-info">
                                        <h3 className="overlay-section-title">
                                            <Icon name="sync" size={20} />
                                            Live Sync
                                        </h3>
                                        <p className="auto-sync-desc">
                                            Automatically push every change to OBS (debounced 300ms).
                                        </p>
                                    </div>
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={layoutState.autoSync}
                                            onChange={(e) => {
                                                console.log(`[LayoutSettings] Auto-sync: ${e.target.checked}`);
                                                updateLayout({ autoSync: e.target.checked });
                                                if (e.target.checked) {
                                                    addToast("Live Sync ON — changes push to OBS automatically", "success");
                                                }
                                            }}
                                        />
                                        <span className="toggle-slider" />
                                    </label>
                                </div>
                            </div>

                            {/* ── Scene Transition (not in volunteer mode) ── */}
                            {!volunteerMode && (
                                <TransitionPanel
                                    onError={(msg) => addToast(msg, "error")}
                                    onSuccess={(msg) => addToast(msg, "success")}
                                />
                            )}
                        </div>

                        {/* Footer / Actions */}
                        <div className="overlay-footer">
                            <button className="btn-secondary" onClick={handleCloseOverlay}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary"
                                onClick={handleApplyLayout}
                                disabled={isApplying || layoutState.autoSync}
                            >
                                <Icon name={isApplying ? "hourglass_empty" : "check"} size={20} className="btn-icon" />
                                {isApplying
                                    ? "Applying..."
                                    : layoutState.autoSync
                                        ? "Auto-sync ON"
                                        : "Apply to OBS"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
