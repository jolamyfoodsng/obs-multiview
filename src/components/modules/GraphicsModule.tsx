/**
 * GraphicsModule.tsx — Merged Lower Third + Speaker tab
 *
 * A single Service Hub tab that contains two sub-modules:
 *   • Lower Third  — full LowerThirdsModule
 *   • Speaker      — full SpeakerModule
 *
 * A thin sub-tab bar at the top lets the user switch between the two.
 * Each sub-module is lazily mounted and hidden (not unmounted) for
 * instant switching, matching the ServiceHubPage pattern.
 */

import { useState, useCallback } from "react";
import { LowerThirdsModule } from "./LowerThirdsModule";
import { SpeakerModule } from "./SpeakerModule";
import "./graphics-module.css";
import Icon from "../Icon";

type GraphicsSubTab = "lower-third" | "speaker";

export interface GraphicsModuleProps {
  isActive?: boolean;
  /** Deep-link: auto-select this speaker preset when set */
  initialSelectPresetId?: string | null;
  /** Called after the deep-link selection has been consumed */
  onConsumeInitialSelect?: () => void;
}

export function GraphicsModule({
  isActive = true,
  initialSelectPresetId,
  onConsumeInitialSelect,
}: GraphicsModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<GraphicsSubTab>("lower-third");
  const [mountedTabs, setMountedTabs] = useState<Record<GraphicsSubTab, boolean>>({
    "lower-third": true,
    speaker: false,
  });

  const handleSubTabChange = useCallback((tab: GraphicsSubTab) => {
    setActiveSubTab(tab);
    setMountedTabs((prev) => {
      if (prev[tab]) return prev;
      return { ...prev, [tab]: true };
    });
  }, []);

  // If we receive a deep-link speaker preset, auto-switch to Speaker sub-tab
  if (initialSelectPresetId && activeSubTab !== "speaker") {
    handleSubTabChange("speaker");
  }

  return (
    <div className="graphics-module" data-active={isActive ? "true" : "false"}>
      {/* ── Sub-tab toggle bar ── */}
      <div className="graphics-module-subtabs" role="tablist" aria-label="Graphics sub-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "lower-third"}
          className={`graphics-module-subtab${activeSubTab === "lower-third" ? " is-active" : ""}`}
          onClick={() => handleSubTabChange("lower-third")}
        >
          <Icon name="subtitles" size={16} />
          Lower Third
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "speaker"}
          className={`graphics-module-subtab${activeSubTab === "speaker" ? " is-active" : ""}`}
          onClick={() => handleSubTabChange("speaker")}
        >
          <Icon name="mic" size={16} />
          Speaker
        </button>
      </div>

      {/* ── Sub-module panels ── */}
      <div className="graphics-module-body">
        {mountedTabs["lower-third"] && (
          <div
            className="graphics-module-panel"
            hidden={activeSubTab !== "lower-third"}
          >
            <LowerThirdsModule isActive={isActive && activeSubTab === "lower-third"} />
          </div>
        )}

        {mountedTabs.speaker && (
          <div
            className="graphics-module-panel"
            hidden={activeSubTab !== "speaker"}
          >
            <SpeakerModule
              isActive={isActive && activeSubTab === "speaker"}
              initialSelectPresetId={initialSelectPresetId}
              onConsumeInitialSelect={onConsumeInitialSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default GraphicsModule;
