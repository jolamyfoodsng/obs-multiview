/**
 * BroadcastHome.tsx — Original OBS Church Studio broadcast controls
 *
 * Extracted from App.tsx so routing can live there.
 * Three conditional states:
 * 1. Disconnected → Connection screen
 * 2. Connected, no Sunday scenes → SetupWizard
 * 3. Connected, Sunday scenes exist → BroadcastLayout
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useOBS } from "./hooks/useOBS";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { SetupWizard } from "./components/SetupWizard";
import { BroadcastLayout } from "./components/BroadcastLayout";
import { AppLogo } from "./components/AppLogo";
import { BroadcastProvider } from "./hooks/useBroadcastStore";
import {
  autoDetectConfig,
  type GenerationConfig,
} from "./services/layoutService";
import { loadData, updateData } from "./services/store";
import Icon from "./components/Icon";

export function BroadcastHome() {
  const navigate = useNavigate();
  const {
    connectionStatus,
    error,
    connect,
    disconnect,
    inputs,
    hasSundayScenes,
    refreshData,
    checkSundayScenes,
  } = useOBS();

  const [config, setConfig] = useState<GenerationConfig | null>(null);

  const isConnected = connectionStatus === "connected";

  // ── Load config from store on mount ──────────────────────
  useEffect(() => {
    (async () => {
      const data = await loadData();
      if (data.sources.cameraSource && data.sources.scriptureSource) {
        console.log("[BroadcastHome] Loaded config from store:", data.sources);
        setConfig({
          cameraSource: data.sources.cameraSource,
          scriptureSource: data.sources.scriptureSource,
        });
      }
    })();
  }, []);

  // ── If connected + Sunday scenes exist but config still null, auto-detect ──
  useEffect(() => {
    if (isConnected && hasSundayScenes === true && config === null) {
      console.log("[BroadcastHome] Sunday scenes exist but no config — auto-detecting...");
      autoDetectConfig().then(async (detected) => {
        if (detected) {
          console.log("[BroadcastHome] Config auto-detected:", detected);
          setConfig(detected);
          await updateData({
            sources: {
              cameraSource: detected.cameraSource,
              scriptureSource: detected.scriptureSource,
            },
          });
        } else {
          console.warn(
            "[BroadcastHome] Could not auto-detect config — user may need to re-run wizard"
          );
        }
      });
    }
  }, [isConnected, hasSundayScenes, config]);

  // ── Wizard complete handler ──────────────────────────────
  const handleWizardComplete = async (generationConfig: GenerationConfig) => {
    console.log("[BroadcastHome] Wizard complete:", generationConfig);
    setConfig(generationConfig);

    await updateData({
      sources: {
        cameraSource: generationConfig.cameraSource,
        scriptureSource: generationConfig.scriptureSource,
      },
    });

    await refreshData();
    await checkSundayScenes();
  };

  const showWizard = isConnected && hasSundayScenes === false;
  const showServiceMode = isConnected && hasSundayScenes === true;

  return (
    <>
      {!isConnected ? (
        <div className="connect-screen-full">
          <div className="connect-screen">
            <div className="connect-hero">
              <div className="connect-icon-wrap">
                <Icon name="church" size={20} className="connect-icon" />
              </div>
              <h2 className="connect-heading">OBS Church Studio</h2>
              <p className="connect-subheading">
                Connect to OBS Studio to get started.
              </p>
            </div>
            <ConnectionStatus
              status={connectionStatus}
              error={error}
              onConnect={connect}
              onDisconnect={disconnect}
            />
            {/* Quick-nav to multi-view editor (works without OBS) */}
            <button
              className="mv-nav-link"
              onClick={() => navigate("/")}
            >
              <Icon name="grid_view" size={18} style={{ marginRight: 6 }} />
              Open Multi-View Editor
            </button>
          </div>
        </div>
      ) : showWizard ? (
        <div className="wizard-screen">
          <header className="app-header">
            <div className="header-brand">
              <div className="header-logo">
                <AppLogo alt="OBS Church Studio" />
              </div>
              <div>
                <h1 className="header-title">OBS Church Studio</h1>
                <p className="header-subtitle">First-Time Setup</p>
              </div>
            </div>
            <div className="status-pill">
              <span className="status-pill-dot">
                <span className="status-pill-ping" />
                <span className="status-pill-solid" />
              </span>
              <span className="status-pill-text">CONNECTED TO OBS</span>
            </div>
            <div className="header-right" />
          </header>
          <main className="wizard-main">
            <SetupWizard inputs={inputs} onComplete={handleWizardComplete} />
          </main>
        </div>
      ) : showServiceMode ? (
        <BroadcastProvider config={config}>
          <BroadcastLayout onDisconnect={disconnect} />
        </BroadcastProvider>
      ) : (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">Checking OBS scenes...</p>
        </div>
      )}
    </>
  );
}
