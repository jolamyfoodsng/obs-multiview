/**
 * LibraryPage.tsx — Library page with optional songs-only mode
 *
 * The pre-release production surface uses songs-only mode so the main app
 * stays focused on Bible/Worship setup while media workflows remain out of scope.
 */

import { useState, useEffect, useCallback } from "react";
import { MediaTab } from "./MediaTab";
import { SongsTab } from "./SongsTab";
import Icon from "../components/Icon";
import "./library.css";

type LibraryTab = "media" | "songs";
const TAB_KEY = "library-active-tab";

interface Props {
  songsOnly?: boolean;
}

export default function LibraryPage({ songsOnly = false }: Props) {
  const [tab, setTab] = useState<LibraryTab>(() => {
    if (songsOnly) return "songs";
    const saved = localStorage.getItem(TAB_KEY);
    return saved === "songs" ? "songs" : "media";
  });

  useEffect(() => {
    if (songsOnly) return;
    localStorage.setItem(TAB_KEY, tab);
  }, [songsOnly, tab]);

  useEffect(() => {
    if (songsOnly && tab !== "songs") {
      setTab("songs");
    }
  }, [songsOnly, tab]);

  // ESC closes any open modal — handled by child components individually.
  // This page just manages tab state.

  const handleTab = useCallback((t: LibraryTab) => setTab(t), []);

  return (
    <div className="lib-page">
      {/* Header */}
      <div className="lib-header">
        <div className="lib-header-left">
          <h1 className="lib-title">
            {songsOnly ? "Song Library" : tab === "media" ? "Media Library" : "Songs"}
          </h1>
          <p className="lib-subtitle">
            {songsOnly
              ? "Manage the worship songs and lyrics that appear in the OBS Dock."
              : tab === "media"
              ? "Manage videos, images, and backgrounds for your service."
              : "Manage your worship song database and lyrics."}
          </p>
        </div>

        {/* Tab switcher pill */}
        {!songsOnly && (
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
        )}
      </div>

      {/* Tab content */}
      {songsOnly || tab === "songs" ? <SongsTab /> : <MediaTab />}
    </div>
  );
}
