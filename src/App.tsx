/**
 * App.tsx — OBS Church Studio
 *
 * Root component with React Router.
 *
 * Startup sequence:
 *   1. Splash screen shown (introductory_loading_image.png)
 *   2. Resources pre-loaded + GitHub update check runs in parallel
 *   3. If update available → mandatory UpdateModal (decline = exit app)
 *   4. App continues polling for updates while running
 *   5. Otherwise → OBSConnectGate → AppShell with routes
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { OBSConnectGate } from "./components/OBSConnectGate";
import { AppShell } from "./AppShell";
import { MVSettings } from "./multiview/pages/MVSettings";
import { BibleProvider } from "./bible/bibleStore";
import { LowerThirdProvider } from "./lowerthirds/lowerThirdStore";
import SplashScreen from "./components/SplashScreen";
import UpdateModal from "./components/UpdateModal";
import { checkForUpdate, type UpdateCheckResult } from "./services/updateService";
import { initOverlayUrl } from "./services/overlayUrl";
import { migrateFromLegacyDatabases } from "./services/db";
import { getSettings } from "./multiview/mvStore";
import { applyBrandingSettingsToDom } from "./services/branding";
import { useAppTheme } from "./hooks/useAppTheme";
import DevDashboard from "./pages/DevDashboard";
import { dockBridge } from "./services/dockBridge";
import { initDockCommandHandler } from "./services/dockCommandHandler";
import { obsService } from "./services/obsService";
import { serviceStore as svcStore } from "./services/serviceStore";
import { syncSongsToDock } from "./worship/worshipDb";
import { syncInstalledTranslationsToDock } from "./bible/bibleDb";
import ResourcesPage from "./pages/ResourcesPage";
import ProductionHomePage from "./pages/ProductionHomePage";
import ProductionThemeSettingsPage from "./pages/ProductionThemeSettingsPage";
import { buildDockProductionSettingsPayload, syncProductionSettingsToDock } from "./services/productionSettings";
import { voiceBibleService } from "./services/voiceBibleService";
import "./App.css";
import "./multiview/mv.css";
import "./bible/bible.css";
import "./lowerthirds/lowerthirds.css";

const UPDATE_POLL_INTERVAL_MS = 30_000;

function App() {
  // ── Global theme (dark/light) ──
  useAppTheme();

  useEffect(() => {
    const s = getSettings();
    applyBrandingSettingsToDom({ brandColor: s.brandColor, churchName: s.churchName });

    // Initialize dock bridge so the OBS Browser Dock can communicate
    dockBridge.init();

    // Wire up dock commands → OBS actions (bible:go-live, speaker:go-live, etc.)
    const unsubDockCmd = initDockCommandHandler();
    const unsubVoiceBible = voiceBibleService.init();

    // Relay OBS connection status to the dock
    const unsubObs = obsService.onStatusChange((status) => {
      dockBridge.sendObsStatus(status === "connected");
    });

    // Relay service status to the dock
    const unsubSvc = svcStore.subscribe((state) => {
      dockBridge.sendServiceStatus(state.status, state.serviceName);
    });

    // Handle state requests from the dock
    const unsubCmd = dockBridge.onCommand(async (cmd) => {
      if (cmd.type === "request-state") {
        const productionSettings = await buildDockProductionSettingsPayload().catch(() => undefined);
        const voiceBible = await voiceBibleService.refreshAvailability().catch(() => voiceBibleService.getSnapshot());
        dockBridge.sendFullState({
          obsConnected: obsService.status === "connected",
          serviceStatus: svcStore.status,
          productionSettings,
          voiceBible,
        });
      }

      // Dock is requesting library data (songs) via BroadcastChannel
      if (cmd.type === "request-library-data") {
        try {
          const { getAllSongs } = await import("./worship/worshipDb");
          const songs = await getAllSongs();
          dockBridge.sendState({
            type: "state:songs-data",
            payload: songs,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn("[App] Failed to send songs to dock:", err);
        }
      }
    });

    return () => {
      unsubObs();
      unsubSvc();
      unsubCmd();
      unsubDockCmd();
      unsubVoiceBible();
    };
  }, []);
  // ── Splash state ──
  const [splashVisible, setSplashVisible] = useState(true);
  const [resourcesReady, setResourcesReady] = useState(false);

  // ── Update state ──
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  const startupDone = useRef(false);
  const updatePollBusyRef = useRef(false);

  // ── Startup: load resources + check for updates in parallel ──
  useEffect(() => {
    if (startupDone.current) return;
    startupDone.current = true;

    const minSplashTime = new Promise((r) => setTimeout(r, 2000));

    const updateCheck = checkForUpdate()
      .then((result) => {
        if (result.available && result.update) {
          setUpdateResult(result);
        }
      })
      .catch(() => {
        // If update check fails (no internet, etc.), let the app proceed
      });

    // Initialize the overlay URL (queries Tauri for the local server port)
    const overlayInit = initOverlayUrl().catch(() => {
      // Fallback to window.location.origin if Tauri command fails
    });

    // Run one-time migration from legacy databases (non-blocking)
    migrateFromLegacyDatabases().catch((err) => {
      console.warn("[App] Legacy DB migration failed (non-critical):", err);
    });

    // Sync dock-first production data to dock JSON files on startup.
    syncSongsToDock().catch(() => {});
    syncInstalledTranslationsToDock().catch(() => {});
    syncProductionSettingsToDock().catch(() => {});

    // Rehydrate theme favorites from durable storage, then sync them to dock JSON.
    import("./services/favoriteThemes").then(({
      hydrateFavoriteThemes,
      syncLTFavoritesToDock,
      syncBibleFavoritesToDock,
      syncFavoriteBibleThemesToDock,
    }) => {
      hydrateFavoriteThemes()
        .then(() => Promise.all([
          syncLTFavoritesToDock(),
          syncBibleFavoritesToDock(),
          syncFavoriteBibleThemesToDock(),
        ]))
        .catch(() => {});
    }).catch(() => {});

    // Preload the splash image itself + any critical resources
    const preload = new Promise<void>((resolve) => {
      const img = new Image();
      img.src = "/introductory_loading_image.png";
      img.onload = () => resolve();
      img.onerror = () => resolve(); // proceed even if image fails
    });

    // Wait for: minimum splash time + preload + update check + overlay init
    Promise.all([minSplashTime, preload, updateCheck, overlayInit]).then(() => {
      setResourcesReady(true);
    });
  }, []);

  // ── Splash done callback ──
  const handleSplashDone = useCallback(() => {
    setSplashVisible(false);
  }, []);

  // ── Continuous update polling while app is running ──
  useEffect(() => {
    if (splashVisible) return;
    if (updateResult?.available && updateResult.update) return;

    let cancelled = false;

    const pollForUpdates = async () => {
      if (updatePollBusyRef.current) return;
      updatePollBusyRef.current = true;
      try {
        const result = await checkForUpdate();
        if (cancelled) return;
        if (result.available && result.update) {
          setUpdateResult((prev) => {
            if (prev?.available && prev.version === result.version) {
              return prev;
            }
            return result;
          });
        }
      } catch {
        // Keep polling.
      } finally {
        updatePollBusyRef.current = false;
      }
    };

    void pollForUpdates();
    const intervalId = window.setInterval(() => {
      void pollForUpdates();
    }, UPDATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [splashVisible, updateResult?.available, updateResult?.update, updateResult?.version]);

  // ── Update: dismiss (close the app) ──
  const handleDismissUpdate = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  }, []);

  return (
    <div className="app">
      {/* 1. Splash screen — shown until resources ready */}
      {splashVisible && (
        <SplashScreen ready={resourcesReady} onDone={handleSplashDone} />
      )}

      {/* 2. Mandatory update modal — downloads + installs + relaunches */}
      {!splashVisible && updateResult && (
        <UpdateModal
          result={updateResult}
          onDismiss={handleDismissUpdate}
        />
      )}

      {/* 3. Main app — only rendered when no update is blocking */}
      {!splashVisible && !updateResult && (
        <OBSConnectGate>
          <LowerThirdProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<ProductionHomePage />} />
                <Route path="resources" element={<BibleProvider><ResourcesPage /></BibleProvider>} />
                <Route path="songs" element={<Navigate to="/resources?tab=worship" replace />} />
                <Route path="bible-library" element={<Navigate to="/resources?tab=bible" replace />} />
                <Route path="bible/translations" element={<Navigate to="/resources?tab=bible" replace />} />
                <Route path="production/themes" element={<ProductionThemeSettingsPage />} />
                <Route path="settings" element={<BibleProvider><MVSettings /></BibleProvider>} />
                <Route path="library" element={<Navigate to="/resources" replace />} />
                <Route path="templates" element={<Navigate to="/production/themes" replace />} />
                <Route path="templates/*" element={<Navigate to="/production/themes" replace />} />
                <Route path="hub" element={<Navigate to="/" replace />} />
                <Route path="hub/*" element={<Navigate to="/" replace />} />
                <Route path="service-hub" element={<Navigate to="/" replace />} />
                <Route path="service-control-hub" element={<Navigate to="/" replace />} />
                <Route path="quick-merge" element={<Navigate to="/" replace />} />
                <Route path="broadcast" element={<Navigate to="/" replace />} />
                <Route path="bible" element={<Navigate to="/settings" replace />} />
                <Route path="bible/*" element={<Navigate to="/settings" replace />} />
                <Route path="worship" element={<Navigate to="/resources" replace />} />
                <Route path="lower-thirds" element={<Navigate to="/production/themes" replace />} />
                <Route path="scenes" element={<Navigate to="/settings" replace />} />
                <Route path="multiview" element={<Navigate to="/" replace />} />
                <Route path="multiview/*" element={<Navigate to="/" replace />} />
                <Route path="new" element={<Navigate to="/" replace />} />
                <Route path="edit/:layoutId" element={<Navigate to="/" replace />} />

                {/* Developer Tools */}
                <Route path="dev/db" element={<DevDashboard />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </LowerThirdProvider>
        </OBSConnectGate>
      )}
    </div>
  );
}

export default App;
