/**
 * DockMinistryTab.tsx — Unified Ministry tab for the OBS Browser Dock
 *
 * Restores speaker, sermon, and event lower-third control in a denser console shell.
 */

import { useEffect, useState } from "react";
import type { DockStagedItem } from "../dockTypes";
import DockSpeakerTab from "./DockSpeakerTab";
import DockSermonTab from "./DockSermonTab";
import DockEventTab from "./DockEventTab";
import DockAnimatedLTTab from "./DockAnimatedLTTab";
import Icon from "../DockIcon";

type MinistrySubTab = "speakers" | "sermon" | "events" | "animated-lt";

const DOCK_MINISTRY_PREFS_KEY = "ocs-dock-ministry-preferences";

const SUB_TABS: { id: MinistrySubTab; label: string; icon: string }[] = [
  { id: "speakers", label: "Speakers", icon: "person" },
  { id: "sermon", label: "Sermon", icon: "record_voice_over" },
  { id: "events", label: "Events", icon: "event" },
  { id: "animated-lt", label: "Animated LT", icon: "subtitles" },
];

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

function loadActiveSubTab(): MinistrySubTab {
  try {
    const raw = localStorage.getItem(DOCK_MINISTRY_PREFS_KEY);
    if (raw === "speakers" || raw === "sermon" || raw === "events" || raw === "animated-lt") {
      return raw;
    }
  } catch {
    // ignore persistence failures
  }
  return "speakers";
}

export default function DockMinistryTab({ staged, onStage }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<MinistrySubTab>(() => loadActiveSubTab());

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_MINISTRY_PREFS_KEY, activeSubTab);
    } catch {
      // ignore persistence failures
    }
  }, [activeSubTab]);

  return (
    <div className="dock-module dock-module--ministry">
      <section className="dock-console-panel dock-console-panel--toolbar">
        <div className="dock-console-header">
          <div>
            <div className="dock-console-header__eyebrow">Lower Third Console</div>
            <div className="dock-console-header__title">Ministry Cues</div>
          </div>
          <span className="dock-shell-chip">Click once to preview. Double-click to go live.</span>
        </div>

        <div className="dock-subtabs dock-subtabs--console">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`dock-subtab${activeSubTab === tab.id ? " dock-subtab--active" : ""}`}
              onClick={() => setActiveSubTab(tab.id)}
            >
              <Icon name={tab.icon} size={13} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="dock-console-panel dock-console-panel--workspace">
        {activeSubTab === "speakers" && <DockSpeakerTab staged={staged} onStage={onStage} />}
        {activeSubTab === "sermon" && <DockSermonTab staged={staged} onStage={onStage} />}
        {activeSubTab === "events" && <DockEventTab staged={staged} onStage={onStage} />}
        {activeSubTab === "animated-lt" && <DockAnimatedLTTab staged={staged} onStage={onStage} />}
      </section>

      {/* <section className="dock-console-panel dock-console-panel--deck dock-console-panel--deck-compact">
        <div className="dock-console-action-row">
          <button
            type="button"
            className="dock-btn dock-btn--danger"
            onClick={handleClearMinistry}
            disabled={!hasLowerThirdStage}
          >
            <Icon name="clear" size={16} />
            Clear Lower Third
          </button>
        </div>
      </section> */}
    </div>
  );
}
