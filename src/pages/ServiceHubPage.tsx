import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { WorshipModule } from "../components/modules/WorshipModule";
import { BibleModule } from "../components/modules/BibleModule";
import { GraphicsModule } from "../components/modules/GraphicsModule";
import { TickerModule } from "../components/modules/TickerModule";
import PreServicePanel from "../components/preservice/PreServicePanel";
import { BibleProvider } from "../bible/bibleStore";
import GlobalSearchModal, { type GlobalSearchTarget } from "../components/GlobalSearchModal";
import Icon from "../components/Icon";

type ServiceHubMode = "live" | "automation";
type ServiceHubLiveTab = "worship" | "bible" | "graphics" | "media" | "ticker";
type AutomationSection = "pre-service";

type TabDef = {
  id: ServiceHubLiveTab;
  label: string;
  icon: string;
};

const LIVE_TABS: readonly TabDef[] = [
  { id: "worship", label: "Worship", icon: "music_note" },
  { id: "bible", label: "Bible", icon: "menu_book" },
  { id: "graphics", label: "Graphics", icon: "palette" },
  // { id: "media", label: "Media", icon: "movie" },
  { id: "ticker", label: "Ticker", icon: "text_rotation_none" },
];

const TAB_STORAGE_KEY = "service-hub.active-tab";
const MODE_STORAGE_KEY = "service-hub.active-mode";

function parseLiveTab(value: string | null): ServiceHubLiveTab | null {
  if (!value) return null;
  if (value === "worship" || value === "bible" || value === "graphics" || value === "media" || value === "ticker") {
    return value;
  }
  // Backward compat: redirect old tab names to the merged Graphics tab
  if (value === "lower-thirds" || value === "speaker") {
    return "graphics";
  }
  return null;
}

function parseHubMode(value: string | null): ServiceHubMode | null {
  if (!value) return null;
  if (value === "live") return "live";
  if (value === "automation" || value === "pre-service" || value === "queue") {
    return "automation";
  }
  return null;
}

function isCanonicalLiveTab(value: string | null): value is ServiceHubLiveTab {
  return parseLiveTab(value) === value;
}

function isCanonicalHubMode(value: string | null): value is ServiceHubMode {
  return value === "live" || value === "automation";
}

function loadStoredLiveTab(): ServiceHubLiveTab | null {
  try {
    return parseLiveTab(localStorage.getItem(TAB_STORAGE_KEY));
  } catch {
    return null;
  }
}

function loadStoredHubMode(): ServiceHubMode | null {
  try {
    return parseHubMode(localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function getInitialLiveTab(queryTab: string | null): ServiceHubLiveTab {
  return parseLiveTab(queryTab) ?? loadStoredLiveTab() ?? "worship";
}

function getInitialHubMode(queryMode: string | null, queryTab: string | null): ServiceHubMode {
  const parsedMode = parseHubMode(queryMode);
  if (parsedMode) return parsedMode;
  if (parseLiveTab(queryTab)) return "live";
  return loadStoredHubMode() ?? "live";
}

export default function ServiceHubPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get("tab");
  const queryMode = searchParams.get("mode");

  const initialTab = useMemo(() => getInitialLiveTab(queryTab), []);
  const initialMode = useMemo(() => getInitialHubMode(queryMode, queryTab), []);

  const activeMode: ServiceHubMode = parseHubMode(queryMode) ?? initialMode;
  const activeTab: ServiceHubLiveTab = parseLiveTab(queryTab) ?? initialTab;

  const [automationSection, setAutomationSection] = useState<AutomationSection>("pre-service");

  const [mountedLiveTabs, setMountedLiveTabs] = useState<Record<ServiceHubLiveTab, boolean>>(() => ({
    worship: initialTab === "worship",
    bible: initialTab === "bible",
    graphics: initialTab === "graphics",
    media: initialTab === "media",
    ticker: initialTab === "ticker",
  }));
  const [automationMounted, setAutomationMounted] = useState(initialMode === "automation");

  // ── Global Search ──
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchInitial, setGlobalSearchInitial] = useState("");
  // Deep-link targets: passed to child modules so they auto-select an item
  const [pendingBibleTarget, setPendingBibleTarget] = useState<{ book: string; chapter: number; verse: number } | null>(null);
  const [pendingSongId, setPendingSongId] = useState<string | null>(null);
  const [pendingSpeakerId, setPendingSpeakerId] = useState<string | null>(null);
  const globalSearchOpenRef = useRef(false);
  globalSearchOpenRef.current = globalSearchOpen;

  // Open global search on any letter/number key (when no input focused)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't trigger when user is typing in an input/textarea/select
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      // Don't trigger with modifier keys
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Don't trigger if global search is already open
      if (globalSearchOpenRef.current) return;
      // Don't trigger if a module-level search/modal is open (e.g. Bible search dropdown)
      if (document.querySelector(".bible-search-dropdown, .bible-modal-overlay")) return;
      // Only trigger for single printable letter/number keys
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        setGlobalSearchInitial(e.key);
        setGlobalSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const handleGlobalSearchNavigate = useCallback((target: GlobalSearchTarget) => {
    const next = new URLSearchParams(searchParams);
    next.set("mode", "live");

    switch (target.type) {
      case "bible":
        next.set("tab", "bible");
        setPendingBibleTarget({ book: target.book, chapter: target.chapter, verse: target.verse });
        break;
      case "worship":
        next.set("tab", "worship");
        setPendingSongId(target.songId);
        break;
      case "speaker":
        next.set("tab", "graphics");
        setPendingSpeakerId(target.presetId);
        break;
    }

    setSearchParams(next, { replace: true });
    setGlobalSearchOpen(false);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (queryMode === "quick-merge") {
      navigate("/hub/quick-merge", { replace: true });
    }
  }, [queryMode, navigate]);

  useEffect(() => {
    setMountedLiveTabs((prev) => {
      if (prev[activeTab]) return prev;
      return { ...prev, [activeTab]: true };
    });
  }, [activeTab]);

  useEffect(() => {
    if (activeMode === "automation" && !automationMounted) {
      setAutomationMounted(true);
    }
  }, [activeMode, automationMounted]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
      localStorage.setItem(MODE_STORAGE_KEY, activeMode);
    } catch {
      // Ignore storage failures (private mode, etc.)
    }

    const next = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (!isCanonicalLiveTab(queryTab)) {
      next.set("tab", activeTab);
      shouldReplace = true;
    }

    if (!isCanonicalHubMode(queryMode)) {
      next.set("mode", activeMode);
      shouldReplace = true;
    }

    if (shouldReplace) {
      setSearchParams(next, { replace: true });
    }
  }, [activeMode, activeTab, queryMode, queryTab, searchParams, setSearchParams]);

  const tabLabels = useMemo(() => new Map(LIVE_TABS.map((tab) => [tab.id, tab.label])), []);

  const handleModeChange = (mode: ServiceHubMode) => {
    if (mode === activeMode) return;
    const next = new URLSearchParams(searchParams);
    next.set("mode", mode);
    if (mode === "live") {
      next.set("tab", activeTab);
    }
    setSearchParams(next, { replace: true });
  };

  const handleLiveTabChange = (tab: ServiceHubLiveTab) => {
    if (tab === activeTab && activeMode === "live") return;
    const next = new URLSearchParams(searchParams);
    next.set("mode", "live");
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="service-hub-page" data-mode={activeMode} data-tab={activeTab}>
      <header className="service-hub-header">
        {activeMode === "live" && (
          <div className="service-hub-tabs" role="tablist" aria-label="Live content tabs">
            {LIVE_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`service-hub-tab${isActive ? " is-active" : ""}`}
                  onClick={() => handleLiveTabChange(tab.id)}
                >
                  <Icon name={tab.icon} size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="service-hub-header-right">
          <div className="service-hub-mode-toggle" aria-label="Hub mode">
            <button
              className={`service-hub-mode-toggle-btn${activeMode === "live" ? " is-active" : ""}`}
              onClick={() => handleModeChange("live")}
            >
              LIVE
            </button>
            <button
              className={`service-hub-mode-toggle-btn${activeMode === "automation" ? " is-active" : ""}`}
              onClick={() => handleModeChange("automation")}
            >
              AUTOMATION
            </button>
          </div>
          <button
            type="button"
            className="service-hub-quickmerge-btn"
            onClick={() => navigate("/hub/quick-merge")}
          >
            QUICK MERGE
          </button>
        </div>
      </header>

      <div className="service-hub-main" aria-live="polite">
        {mountedLiveTabs.worship && (
          <section
            className="service-hub-panel"
            hidden={activeMode !== "live" || activeTab !== "worship"}
            aria-label={tabLabels.get("worship")}
          >
            <WorshipModule
              isActive={activeMode === "live" && activeTab === "worship"}
              initialSelectSongId={pendingSongId}
              onConsumeInitialSelect={() => setPendingSongId(null)}
            />
          </section>
        )}

        {mountedLiveTabs.bible && (
          <section
            className="service-hub-panel"
            hidden={activeMode !== "live" || activeTab !== "bible"}
            aria-label={tabLabels.get("bible")}
          >
            <BibleProvider>
              <BibleModule
                isActive={activeMode === "live" && activeTab === "bible"}
                initialSelectBible={pendingBibleTarget}
                onConsumeInitialSelect={() => setPendingBibleTarget(null)}
              />
            </BibleProvider>
          </section>
        )}

        {mountedLiveTabs.graphics && (
          <section
            className="service-hub-panel"
            hidden={activeMode !== "live" || activeTab !== "graphics"}
            aria-label={tabLabels.get("graphics")}
          >
            <GraphicsModule
              isActive={activeMode === "live" && activeTab === "graphics"}
              initialSelectPresetId={pendingSpeakerId}
              onConsumeInitialSelect={() => setPendingSpeakerId(null)}
            />
          </section>
        )}

        {mountedLiveTabs.media && (
          <section
            className="service-hub-panel"
            hidden={activeMode !== "live" || activeTab !== "media"}
            aria-label={tabLabels.get("media")}
          >
            {/* <LivePlaceholderPanel
              icon="movie"
              title="Media"
              description="Media workspace placeholder. Connect your media picker and preview panel here in the next task."
            /> */}
          </section>
        )}

        {mountedLiveTabs.ticker && (
          <section
            className="service-hub-panel"
            hidden={activeMode !== "live" || activeTab !== "ticker"}
            aria-label={tabLabels.get("ticker")}
          >
            <TickerModule isActive={activeMode === "live" && activeTab === "ticker"} />
          </section>
        )}

        {automationMounted && (
          <section
            className="service-hub-panel service-hub-panel--preservice"
            hidden={activeMode !== "automation"}
            aria-label="Automation"
          >
            <div className="service-hub-automation-tabs" role="tablist" aria-label="Automation pages">
              <button
                type="button"
                role="tab"
                aria-selected={automationSection === "pre-service"}
                className={`service-hub-automation-tab${automationSection === "pre-service" ? " is-active" : ""}`}
                onClick={() => setAutomationSection("pre-service")}
              >
                Pre-Service Sequence
              </button>
              <button type="button" className="service-hub-automation-tab is-placeholder" disabled>
                Post-Service (Soon)
              </button>
            </div>

            {automationSection === "pre-service" && <PreServicePanel />}
          </section>
        )}

      </div>

      {/* ── Global Spotlight Search ── */}
      <GlobalSearchModal
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onNavigate={handleGlobalSearchNavigate}
        initialQuery={globalSearchInitial}
      />
    </div>
  );
}
