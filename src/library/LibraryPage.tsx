/**
 * LibraryPage.tsx — Library page with Media / Songs tabs
 *
 * Persists active tab to localStorage.
 */

import { useState, useEffect, useCallback } from "react";
import { MediaTab } from "./MediaTab";
import { SongsTab } from "./SongsTab";
import Icon from "../components/Icon";
import "./library.css";

type LibraryTab = "media" | "songs";
const TAB_KEY = "library-active-tab";

export default function LibraryPage() {
  const [tab, setTab] = useState<LibraryTab>(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return saved === "songs" ? "songs" : "media";
  });

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  // ESC closes any open modal — handled by child components individually.
  // This page just manages tab state.

  const handleTab = useCallback((t: LibraryTab) => setTab(t), []);

  return (
    <div className="lib-page">
      {/* Header */}
      <div className="lib-header">
        <div className="lib-header-left">
          <h1 className="lib-title">{tab === "media" ? "Media Library" : "Songs"}</h1>
          <p className="lib-subtitle">
            {tab === "media"
              ? "Manage videos, images, and backgrounds for your service."
              : "Manage your worship song database and lyrics."}
          </p>
        </div>

        {/* Tab switcher pill */}
        <div className="lib-tab-switcher">
          <button
            className={`lib-tab-btn${tab === "media" ? " is-active" : ""}`}
            onClick={() => handleTab("media")}
          >
            <Icon name="image" size={18} />
            Media
          </button>
          <button
            className={`lib-tab-btn${tab === "songs" ? " is-active" : ""}`}
            onClick={() => handleTab("songs")}
          >
            <Icon name="music_note" size={18} />
            Songs
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === "media" ? <MediaTab /> : <SongsTab />}
    </div>
  );
}
