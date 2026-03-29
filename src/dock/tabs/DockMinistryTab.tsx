/**
 * DockMinistryTab.tsx — Unified Ministry tab for the OBS Browser Dock
 *
 * Merges the Speaker, Sermon, and Event sections into a single tab
 * with internal sub-tabs for switching between them.
 *
 * Sub-tabs:
 *   Speakers — select saved speaker profiles → lower third
 *   Sermon   — sermon title + points/quotes → lower third
 *   Events   — event details → lower third
 */

import { useState } from "react";
import type { DockStagedItem } from "../dockTypes";
import DockSpeakerTab from "./DockSpeakerTab";
import DockSermonTab from "./DockSermonTab";
import DockEventTab from "./DockEventTab";
import Icon from "../DockIcon";

type MinistrySubTab = "speakers" | "sermon" | "events";

const SUB_TABS: { id: MinistrySubTab; label: string; icon: string }[] = [
  { id: "speakers", label: "Speakers", icon: "person" },
  { id: "sermon", label: "Sermon", icon: "record_voice_over" },
  { id: "events", label: "Events", icon: "event" },
];

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

export default function DockMinistryTab({ staged, onStage }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<MinistrySubTab>("speakers");

  return (
    <>
      {/* Sub-tab navigation */}
      <div className="dock-subtabs">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`dock-subtab${activeSubTab === tab.id ? " dock-subtab--active" : ""}`}
            onClick={() => setActiveSubTab(tab.id)}
          >
            <Icon name={tab.icon} size={13} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {activeSubTab === "speakers" && (
        <DockSpeakerTab staged={staged} onStage={onStage} />
      )}
      {activeSubTab === "sermon" && (
        <DockSermonTab staged={staged} onStage={onStage} />
      )}
      {activeSubTab === "events" && (
        <DockEventTab staged={staged} onStage={onStage} />
      )}
    </>
  );
}