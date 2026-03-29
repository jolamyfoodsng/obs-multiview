/**
 * StartServiceModal.tsx — Scene mapping + service prep modal
 *
 * Lets the user:
 *   1. Name the service (auto-filled with date)
 *   2. Map OBS scenes to roles (main, pre-service, clean, worship, slides)
 *   3. Choose default overlay layout (lower-third / fullscreen)
 *   4. Start the service → navigate to pre-service automation
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { obsService } from "../services/obsService";
import { serviceStore, type SceneMapping } from "../services/serviceStore";
import Icon from "./Icon";

interface OBSScene {
  sceneName: string;
  sceneIndex: number;
  sceneUuid?: string;
}

interface StartServiceModalProps {
  open: boolean;
  onClose: () => void;
  onStart: (serviceName: string, mapping: SceneMapping) => void;
}

function getDefaultServiceName(): string {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${day} Morning – ${date}`;
}

export function StartServiceModal({ open, onClose, onStart }: StartServiceModalProps) {
  const [scenes, setScenes] = useState<OBSScene[]>([]);
  const [loading, setLoading] = useState(true);
  const [useLast, setUseLast] = useState(false);

  // Form state
  const [serviceName, setServiceName] = useState(getDefaultServiceName());
  const [mainScene, setMainScene] = useState("");
  const [preServiceScene, setPreServiceScene] = useState("");
  const [cleanCameraScene, setCleanCameraScene] = useState("");
  const [worshipScene, setWorshipScene] = useState("");
  const [slidesScene, setSlidesScene] = useState("");
  const [defaultLayout, setDefaultLayout] = useState<"lower-third" | "fullscreen">("lower-third");

  // Load OBS scenes
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    obsService
      .getSceneList()
      .then((sceneList: OBSScene[]) => {
        setScenes(sceneList);
        setLoading(false);
      })
      .catch(() => {
        setScenes([]);
        setLoading(false);
      });
  }, [open]);

  // Load stored scene mapping on mount
  useEffect(() => {
    if (!open) return;
    const stored = serviceStore.loadSceneMapping();
    if (stored.mainScene) {
      setMainScene(stored.mainScene);
      setPreServiceScene(stored.preServiceScene);
      setCleanCameraScene(stored.cleanCameraScene);
      setWorshipScene(stored.worshipScene);
      setSlidesScene(stored.slidesScene);
    }
  }, [open]);

  const handleUseLast = useCallback(() => {
    const next = !useLast;
    setUseLast(next);
    if (next) {
      const stored = serviceStore.loadSceneMapping();
      setMainScene(stored.mainScene);
      setPreServiceScene(stored.preServiceScene);
      setCleanCameraScene(stored.cleanCameraScene);
      setWorshipScene(stored.worshipScene);
      setSlidesScene(stored.slidesScene);
    }
  }, [useLast]);

  const [sceneWarning, setSceneWarning] = useState<string | null>(null);

  const isValid = useMemo(() => {
    return mainScene.trim() !== "";
  }, [mainScene]);

  const handleStart = useCallback(() => {
    if (!isValid) return;
    // Validate that the selected main scene exists in OBS
    const sceneNames = scenes.map((s) => s.sceneName);
    if (!sceneNames.includes(mainScene)) {
      setSceneWarning(`Scene "${mainScene}" was not found in OBS. Please select a valid scene or check your OBS connection.`);
      return;
    }
    setSceneWarning(null);
    const mapping: SceneMapping = {
      mainScene,
      preServiceScene,
      cleanCameraScene,
      worshipScene,
      slidesScene,
    };
    onStart(serviceName, mapping);
  }, [isValid, serviceName, mainScene, preServiceScene, cleanCameraScene, worshipScene, slidesScene, scenes, onStart]);

  if (!open) return null;

  const sceneOptions = scenes.map((s) => s.sceneName);

  return (
    <div className="ssm-backdrop" onClick={onClose}>
      <div className="ssm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssm-header">
          <div>
            <h1 className="ssm-title">Prepare Today's Service</h1>
            <p className="ssm-subtitle">Configure scenes and layout before going live</p>
          </div>
          <button className="ssm-close-btn" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="ssm-body">
          {/* Service Details */}
          <section className="ssm-section">
            <div className="ssm-section-header">
              <h2 className="ssm-section-label">Service Details</h2>
              <div className="ssm-toggle-row">
                <span className="ssm-toggle-label">Use last service settings</span>
                <button
                  className={`ssm-toggle${useLast ? " is-on" : ""}`}
                  onClick={handleUseLast}
                >
                  <span className="ssm-toggle-thumb" />
                </button>
              </div>
            </div>
            <div className="ssm-field">
              <label className="ssm-field-label">Service Name</label>
              <input
                className="ssm-input"
                type="text"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
              />
            </div>
          </section>

          {/* Scene Mapping */}
          <section className="ssm-section">
            <h2 className="ssm-section-label ssm-section-label--border">Scene Mapping</h2>

            {loading ? (
              <div className="ssm-loading">
                <Icon name="hourglass_top" size={20} className="ssm-loading-icon" />
                <span>Loading OBS scenes…</span>
              </div>
            ) : scenes.length === 0 ? (
              <div className="ssm-loading">
                <Icon name="warning" size={20} className="ssm-loading-icon" />
                <span>No scenes found. Make sure OBS is connected.</span>
              </div>
            ) : (
              <div className="ssm-scenes-grid">
                {/* Left column */}
                <div className="ssm-scenes-col">
                  <SceneSelect
                    label="Main Scene"
                    required
                    value={mainScene}
                    options={sceneOptions}
                    onChange={(val) => { setMainScene(val); setSceneWarning(null); }}
                  />

                </div>
                {/* Right column */}
                <div className="ssm-scenes-col">
                  <SceneSelect
                    label="Worship Scene"
                    value={worshipScene}
                    options={sceneOptions}
                    onChange={setWorshipScene}
                  />

                </div>
              </div>
            )}
          </section>

          {/* Default Layout */}
          <section className="ssm-section">
            <h2 className="ssm-section-label ssm-section-label--border">Default Layout</h2>
            <div className="ssm-layout-grid">
              <button
                className={`ssm-layout-card${defaultLayout === "lower-third" ? " is-selected" : ""}`}
                onClick={() => setDefaultLayout("lower-third")}
              >
                {defaultLayout === "lower-third" && (
                  <Icon name="check_circle" size={20} className="ssm-layout-check" />
                )}
                <div className="ssm-layout-icon">
                  <Icon name="call_to_action" size={20} />
                </div>
                <div>
                  <h3 className="ssm-layout-name">Lower Third</h3>
                  <p className="ssm-layout-desc">Graphics overlay on camera.</p>
                </div>
              </button>
              <button
                className={`ssm-layout-card${defaultLayout === "fullscreen" ? " is-selected" : ""}`}
                onClick={() => setDefaultLayout("fullscreen")}
              >
                {defaultLayout === "fullscreen" && (
                  <Icon name="check_circle" size={20} className="ssm-layout-check" />
                )}
                <div className="ssm-layout-icon">
                  <Icon name="branding_watermark" size={20} />
                </div>
                <div>
                  <h3 className="ssm-layout-name">Full Screen</h3>
                  <p className="ssm-layout-desc">Full screen content emphasis.</p>
                </div>
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="ssm-footer">
          {sceneWarning && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#ff6b6b",
              flex: 1,
              marginRight: 12,
            }}>
              <Icon name="warning" size={16} />
              {sceneWarning}
            </div>
          )}
          <button className="ssm-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="ssm-btn-start"
            disabled={!isValid}
            onClick={handleStart}
          >
            <Icon name="play_arrow" size={20} />
            Start Service
          </button>
        </div>
      </div>
    </div>
  );
}

/** Scene selector dropdown */
function SceneSelect({
  label,
  required,
  value,
  options,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  options: string[];
  onChange: (val: string) => void;
}) {
  return (
    <div className="ssm-field">
      <label className="ssm-field-label">
        {label}
        {required ? (
          <span className="ssm-badge-required">REQUIRED</span>
        ) : (
          <span className="ssm-badge-optional">OPTIONAL</span>
        )}
      </label>
      <div className="ssm-select-wrap">
        <select
          className="ssm-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Select a scene —</option>
          {options.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <Icon name="expand_more" size={20} className="ssm-select-chevron" />
      </div>
    </div>
  );
}

export default StartServiceModal;
