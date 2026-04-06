import { useEffect, useState } from "react";
import type { BibleThemeSettings } from "../../bible/types";
import Icon from "../DockIcon";

export type DockFullscreenQuickThemeSettings = Pick<
  BibleThemeSettings,
  | "fontSize"
  | "refFontSize"
  | "fontColor"
  | "refFontColor"
  | "fullscreenShadeColor"
  | "fullscreenShadeOpacity"
  | "textAlign"
  | "lineHeight"
  | "fontWeight"
  | "textTransform"
>;

interface Props {
  settings: DockFullscreenQuickThemeSettings;
  onChange: (settings: DockFullscreenQuickThemeSettings) => void;
  onReset: () => void;
  onSaveDefault: () => void | Promise<void>;
}

type ThemePreset = {
  id: string;
  label: string;
  settings: DockFullscreenQuickThemeSettings;
};

const PRESETS: ThemePreset[] = [
  {
    id: "faith",
    label: "Faith",
    settings: {
      fontSize: 58,
      refFontSize: 25,
      fontColor: "#FFF8E0",
      refFontColor: "#F4D17B",
      fullscreenShadeColor: "#1A2244",
      fullscreenShadeOpacity: 0.52,
      textAlign: "center",
      lineHeight: 1.34,
      fontWeight: "bold",
      textTransform: "none",
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    settings: {
      fontSize: 48,
      refFontSize: 20,
      fontColor: "#F8FAFC",
      refFontColor: "#CBD5E1",
      fullscreenShadeColor: "#0F172A",
      fullscreenShadeOpacity: 0.36,
      textAlign: "left",
      lineHeight: 1.48,
      fontWeight: "normal",
      textTransform: "none",
    },
  },
  {
    id: "bold",
    label: "Bold",
    settings: {
      fontSize: 68,
      refFontSize: 28,
      fontColor: "#FFFFFF",
      refFontColor: "#B9CCFF",
      fullscreenShadeColor: "#050816",
      fullscreenShadeOpacity: 0.66,
      textAlign: "center",
      lineHeight: 1.22,
      fontWeight: "bold",
      textTransform: "uppercase",
    },
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    settings: {
      fontSize: 56,
      refFontSize: 24,
      fontColor: "#FFFFFF",
      refFontColor: "#FDE68A",
      fullscreenShadeColor: "#000000",
      fullscreenShadeOpacity: 0.78,
      textAlign: "center",
      lineHeight: 1.32,
      fontWeight: "bold",
      textTransform: "uppercase",
    },
  },
];

function formatPx(value: number): string {
  return `${Math.round(value)}px`;
}

function formatOpacity(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatLineHeight(value: number): string {
  return `${value.toFixed(2)}x`;
}

function withPatch(
  current: DockFullscreenQuickThemeSettings,
  patch: Partial<DockFullscreenQuickThemeSettings>,
): DockFullscreenQuickThemeSettings {
  return {
    ...current,
    ...patch,
  };
}

export default function DockFullscreenThemeQuickSettings({
  settings,
  onChange,
  onReset,
  onSaveDefault,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handlePreset = (preset: ThemePreset) => {
    onChange(withPatch(settings, preset.settings));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSaveDefault();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`dock-theme-quick${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="dock-theme-quick__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Quick theme settings"
      >
        <Icon name="edit" size={10} />
      </button>

      {open && (
        <div
          className="dock-theme-quick__backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="dock-theme-quick__modal"
            role="dialog"
            aria-label="Quick theme settings"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dock-theme-quick__modal-head">
              <div>
                <div className="dock-theme-quick__heading">Quick Theme Settings</div>
                <div className="dock-theme-quick__sub">Fullscreen theme edits update the dock preview live.</div>
              </div>
              <button
                type="button"
                className="dock-theme-quick__close"
                onClick={() => setOpen(false)}
                aria-label="Close quick theme settings"
                title="Close"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="dock-theme-quick__body">
              <div className="dock-theme-quick__section">
                <label className="dock-theme-quick__field">
                  <span className="dock-theme-quick__field-head">
                    <span>Main text size</span>
                    <span>{formatPx(settings.fontSize)}</span>
                  </span>
                  <input
                    className="dock-theme-quick__range"
                    type="range"
                    min={28}
                    max={200}
                    step={1}
                    value={settings.fontSize}
                    onChange={(event) =>
                      onChange(withPatch(settings, { fontSize: Number(event.target.value) }))
                    }
                  />
                </label>

                <div className="dock-theme-quick__split-row">
                  <div className="dock-theme-quick__section">
                    <div className="dock-theme-quick__section-label">Weight</div>
                    <div className="dock-console-segmented dock-console-segmented--compact">
                      {(["normal", "bold"] as const).map((weight) => (
                        <button
                          key={weight}
                          type="button"
                          className={`dock-console-segmented__item${settings.fontWeight === weight ? " dock-console-segmented__item--active" : ""}`}
                          onClick={() => onChange(withPatch(settings, { fontWeight: weight }))}
                        >
                          {weight === "normal" ? "Normal" : "Bold"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="dock-theme-quick__section">
                    <div className="dock-theme-quick__section-label">Case</div>
                    <div className="dock-console-segmented dock-console-segmented--compact dock-theme-quick__segmented-wrap">
                      {([
                        ["none", "Aa"],
                        ["uppercase", "AA"],
                        ["lowercase", "aa"],
                        ["capitalize", "Ab"],
                      ] as const).map(([transform, label]) => (
                        <button
                          key={transform}
                          type="button"
                          className={`dock-console-segmented__item${settings.textTransform === transform ? " dock-console-segmented__item--active" : ""}`}
                          onClick={() => onChange(withPatch(settings, { textTransform: transform }))}
                          title={transform}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="dock-theme-quick__section">
                <label className="dock-theme-quick__field">
                  <span className="dock-theme-quick__field-head">
                    <span>Reference size</span>
                    <span>{formatPx(settings.refFontSize)}</span>
                  </span>
                  <input
                    className="dock-theme-quick__range"
                    type="range"
                    min={14}
                    max={150}
                    step={1}
                    value={settings.refFontSize}
                    onChange={(event) =>
                      onChange(withPatch(settings, { refFontSize: Number(event.target.value) }))
                    }
                  />
                </label>
              </div>

              <div className="dock-theme-quick__section">
                <div className="dock-theme-quick__color-grid">
                  <label className="dock-theme-quick__color-field">
                    <span>Main text</span>
                    <span className="dock-theme-quick__color-input-wrap">
                      <input
                        className="dock-theme-quick__color-input"
                        type="color"
                        value={settings.fontColor}
                        onChange={(event) =>
                          onChange(withPatch(settings, { fontColor: event.target.value }))
                        }
                      />
                      <span>{settings.fontColor.toUpperCase()}</span>
                    </span>
                  </label>

                  <label className="dock-theme-quick__color-field">
                    <span>Reference</span>
                    <span className="dock-theme-quick__color-input-wrap">
                      <input
                        className="dock-theme-quick__color-input"
                        type="color"
                        value={settings.refFontColor}
                        onChange={(event) =>
                          onChange(withPatch(settings, { refFontColor: event.target.value }))
                        }
                      />
                      <span>{settings.refFontColor.toUpperCase()}</span>
                    </span>
                  </label>

                  <label className="dock-theme-quick__color-field">
                    <span>Background</span>
                    <span className="dock-theme-quick__color-input-wrap">
                      <input
                        className="dock-theme-quick__color-input"
                        type="color"
                        value={settings.fullscreenShadeColor}
                        onChange={(event) =>
                          onChange(
                            withPatch(settings, {
                              fullscreenShadeColor: event.target.value,
                            }),
                          )
                        }
                      />
                      <span>{settings.fullscreenShadeColor.toUpperCase()}</span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="dock-theme-quick__section">
                <label className="dock-theme-quick__field">
                  <span className="dock-theme-quick__field-head">
                    <span>Background opacity</span>
                    <span>{formatOpacity(settings.fullscreenShadeOpacity)}</span>
                  </span>
                  <input
                    className="dock-theme-quick__range"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(settings.fullscreenShadeOpacity * 100)}
                    onChange={(event) =>
                      onChange(
                        withPatch(settings, {
                          fullscreenShadeOpacity: Number(event.target.value) / 100,
                        }),
                      )
                    }
                  />
                </label>
              </div>

              <div className="dock-theme-quick__split-row">
                <div className="dock-theme-quick__section">
                  <div className="dock-theme-quick__section-label">Text alignment</div>
                  <div className="dock-console-segmented dock-console-segmented--compact">
                    {(["left", "center", "right"] as const).map((align) => (
                      <button
                        key={align}
                        type="button"
                        className={`dock-console-segmented__item${settings.textAlign === align ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => onChange(withPatch(settings, { textAlign: align }))}
                      >
                        {align === "left" ? "Left" : align === "center" ? "Center" : "Right"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dock-theme-quick__section">
                  <label className="dock-theme-quick__field">
                    <span className="dock-theme-quick__field-head">
                      <span>Line height</span>
                      <span>{formatLineHeight(settings.lineHeight)}</span>
                    </span>
                    <input
                      className="dock-theme-quick__range"
                      type="range"
                      min={1.05}
                      max={1.8}
                      step={0.05}
                      value={settings.lineHeight}
                      onChange={(event) =>
                        onChange(withPatch(settings, { lineHeight: Number(event.target.value) }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="dock-theme-quick__section">
                <div className="dock-theme-quick__section-label">Presets</div>
                <div className="dock-theme-quick__preset-grid">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="dock-theme-quick__preset"
                      onClick={() => handlePreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="dock-theme-quick__actions">
              <button
                type="button"
                className="dock-btn dock-btn--ghost dock-btn--compact dock-theme-quick__action"
                onClick={onReset}
              >
                Reset to Default
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--preview dock-btn--compact dock-theme-quick__action"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
