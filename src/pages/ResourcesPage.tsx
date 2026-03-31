/**
 * ResourcesPage.tsx — Setup resources for the dock-first workflow
 *
 * Keeps Bible translations, worship songs, and media assets together so the
 * main app remains the setup surface while the OBS Dock stays focused on live control.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BibleLibrary from "../bible/components/BibleLibrary";
import { MediaTab } from "../library/MediaTab";
import { SongsTab } from "../library/SongsTab";
import Icon from "../components/Icon";
import "../library/library.css";

type ResourceTab = "bible" | "worship" | "media";

const TAB_KEY = "production-resources-active-tab";

function parseTab(value: string | null): ResourceTab | null {
  if (value === "bible" || value === "worship" || value === "media") {
    return value;
  }
  return null;
}

const TAB_COPY: Record<ResourceTab, { title: string; subtitle: string; icon: string }> = {
  bible: {
    title: "Bible Resources",
    subtitle: "Download translations like KJV and ASV or import custom XML Bibles for the OBS Dock.",
    icon: "menu_book",
  },
  worship: {
    title: "Worship Resources",
    subtitle: "Manage the worship songs and lyrics that appear in the OBS Dock.",
    icon: "music_note",
  },
  media: {
    title: "Media Resources",
    subtitle: "Manage videos, images, and backgrounds that the dock can send into OBS.",
    icon: "perm_media",
  },
};

export default function ResourcesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = parseTab(searchParams.get("tab"));
  const [tab, setTab] = useState<ResourceTab>(() => {
    const saved = parseTab(localStorage.getItem(TAB_KEY));
    return requestedTab ?? saved ?? "worship";
  });

  useEffect(() => {
    if (requestedTab && requestedTab !== tab) {
      setTab(requestedTab);
    }
  }, [requestedTab, tab]);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  const handleTab = useCallback((next: ResourceTab) => {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }, [setSearchParams]);

  const copy = TAB_COPY[tab];

  return (
    <div className="resources-page">
      <div className="resources-content">
        <div className="lib-page">
          <div className="lib-header">
            <div className="lib-header-left">
              <h1 className="lib-title">{copy.title}</h1>
              <p className="lib-subtitle">{copy.subtitle}</p>
            </div>

            <div className="lib-tab-switcher">
              <button
                className={`lib-tab-btn${tab === "bible" ? " is-active" : ""}`}
                onClick={() => handleTab("bible")}
              >
                <Icon name="menu_book" size={18} />
                Bible
              </button>
              <button
                className={`lib-tab-btn${tab === "worship" ? " is-active" : ""}`}
                onClick={() => handleTab("worship")}
              >
                <Icon name="music_note" size={18} />
                Worship
              </button>
              <button
                className={`lib-tab-btn${tab === "media" ? " is-active" : ""}`}
                onClick={() => handleTab("media")}
              >
                <Icon name="perm_media" size={18} />
                Media
              </button>
            </div>
          </div>

          {tab === "bible" && (
            <div className="resources-embedded-panel" data-resource-tab="bible">
              <BibleLibrary
                open
                onClose={() => {}}
                mode="embedded"
                closeOnUse={false}
              />
            </div>
          )}

          {tab === "worship" && <SongsTab />}
          {tab === "media" && <MediaTab />}
        </div>
      </div>
    </div>
  );
}
