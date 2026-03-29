/**
 * ResourcesPage.tsx — Unified Resources page
 *
 * Combines the Templates Library and Media Library into a single
 * page with top-level tabs.  Replaces the old separate /templates
 * and /library routes.
 *
 * Tabs:
 *   - Templates  → Theme & Template Library (TemplatesLibraryPage)
 *   - Library    → Media & Songs (LibraryPage)
 *
 * Persists the active tab to localStorage.
 */

import { useState, useEffect, useCallback } from "react";
import TemplatesLibraryPage from "./TemplatesLibraryPage";
import LibraryPage from "../library/LibraryPage";
import Icon from "../components/Icon";

type ResourcesTab = "templates" | "library";
const TAB_KEY = "resources-active-tab";

export default function ResourcesPage() {
  const [tab, setTab] = useState<ResourcesTab>(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return saved === "library" ? "library" : "templates";
  });

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  const handleTab = useCallback((t: ResourcesTab) => setTab(t), []);

  return (
    <div className="resources-page">
      {/* ── Tab bar ── */}
      <div className="resources-tab-bar">
        <button
          className={`resources-tab-btn${tab === "templates" ? " is-active" : ""}`}
          onClick={() => handleTab("templates")}
        >
          <Icon name="palette" size={18} />
          Templates
        </button>
        <button
          className={`resources-tab-btn${tab === "library" ? " is-active" : ""}`}
          onClick={() => handleTab("library")}
        >
          <Icon name="video_library" size={18} />
          Library
        </button>
      </div>

      {/* ── Tab content ── */}
      <div className="resources-content">
        {tab === "templates" ? <TemplatesLibraryPage /> : <LibraryPage />}
      </div>
    </div>
  );
}
