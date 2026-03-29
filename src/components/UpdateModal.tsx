/**
 * UpdateModal.tsx — Auto-update modal with download + install
 *
 * Flow:
 *   1. Shows "Update Required" with version info
 *   2. User clicks "Update Now" → downloads with progress bar
 *   3. After download → installs automatically
 *   4. After install → relaunches the app
 *
 * Declining closes the application (mandatory update).
 */

import { useState, useCallback } from "react";
import {
  downloadAndInstallUpdate,
  type UpdateCheckResult,
  type DownloadProgress,
} from "../services/updateService";
import type { Update } from "@tauri-apps/plugin-updater";
import Icon from "./Icon";

interface UpdateModalProps {
  result: UpdateCheckResult;
  onDismiss: () => void;
}

type UpdateStatus = "prompt" | "downloading" | "installing" | "relaunching" | "error";

export default function UpdateModal({ result, onDismiss }: UpdateModalProps) {
  const [status, setStatus] = useState<UpdateStatus>("prompt");
  const [progress, setProgress] = useState<DownloadProgress>({ contentLength: 0, downloaded: 0 });
  const [errorMsg, setErrorMsg] = useState("");

  const percentComplete =
    progress.contentLength > 0
      ? Math.round((progress.downloaded / progress.contentLength) * 100)
      : 0;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleUpdate = useCallback(async () => {
    if (!result.update) return;

    try {
      setStatus("downloading");
      await downloadAndInstallUpdate(
        result.update as Update,
        (p) => setProgress(p),
        (s) => setStatus(s)
      );
      // relaunch happens inside downloadAndInstallUpdate
    } catch (err: any) {
      console.error("[UpdateModal] Update failed:", err);
      setErrorMsg(err?.message || "Update failed. Please try again.");
      setStatus("error");
    }
  }, [result.update]);

  const handleRetry = useCallback(() => {
    setStatus("prompt");
    setProgress({ contentLength: 0, downloaded: 0 });
    setErrorMsg("");
  }, []);

  // ── Status label + icon ──
  const statusConfig: Record<UpdateStatus, { icon: string; label: string }> = {
    prompt: { icon: "system_update", label: "Update Required" },
    downloading: { icon: "downloading", label: "Downloading Update..." },
    installing: { icon: "install_desktop", label: "Installing Update..." },
    relaunching: { icon: "restart_alt", label: "Relaunching..." },
    error: { icon: "error_outline", label: "Update Failed" },
  };

  const { icon, label } = statusConfig[status];
  const isBusy = status === "downloading" || status === "installing" || status === "relaunching";

  return (
    <div className="update-modal-backdrop">
      <div className="update-modal">
        {/* Header */}
        <div className="update-modal-header">
          <Icon name={icon} size={24} className={`update-modal-icon ${isBusy ? "update-modal-icon-spin" : ""}`} />
          <h2>{label}</h2>
        </div>

        {/* Body */}
        <div className="update-modal-body">
          {/* ── Prompt state ── */}
          {status === "prompt" && (
            <>
              <p className="update-modal-message">
                A new version of <strong>OBS Church Studio</strong> is available.
                This update is required to continue using the app.
              </p>

              <div className="update-modal-versions">
                <div className="update-modal-version">
                  <span className="update-modal-version-label">Current</span>
                  <span className="update-modal-version-value">
                    v{result.currentVersion ?? "?"}
                  </span>
                </div>
                <Icon name="arrow_forward" size={20} className="update-modal-arrow" />
                <div className="update-modal-version">
                  <span className="update-modal-version-label">Latest</span>
                  <span className="update-modal-version-value update-modal-version-new">
                    v{result.version ?? "?"}
                  </span>
                </div>
              </div>

              {result.notes && (
                <div className="update-modal-notes">
                  <h4>What's New</h4>
                  <p>{result.notes.slice(0, 500)}</p>
                </div>
              )}
            </>
          )}

          {/* ── Downloading state ── */}
          {status === "downloading" && (
            <div className="update-modal-progress">
              <div className="update-modal-progress-bar-track">
                <div
                  className="update-modal-progress-bar-fill"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
              <div className="update-modal-progress-info">
                <span>{percentComplete}%</span>
                <span>
                  {formatBytes(progress.downloaded)} / {formatBytes(progress.contentLength)}
                </span>
              </div>
              <p className="update-modal-progress-hint">
                Please don't close the app while the update is downloading.
              </p>
            </div>
          )}

          {/* ── Installing state ── */}
          {status === "installing" && (
            <div className="update-modal-progress">
              <div className="update-modal-progress-bar-track">
                <div className="update-modal-progress-bar-fill update-modal-progress-bar-pulse" style={{ width: "100%" }} />
              </div>
              <p className="update-modal-progress-hint">
                Installing the update... The app will restart automatically.
              </p>
            </div>
          )}

          {/* ── Relaunching state ── */}
          {status === "relaunching" && (
            <div className="update-modal-progress">
              <p className="update-modal-progress-hint">
                Restarting OBS Church Studio...
              </p>
            </div>
          )}

          {/* ── Error state ── */}
          {status === "error" && (
            <div className="update-modal-error">
              <p>{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="update-modal-actions">
          {status === "prompt" && (
            <>
              <button className="update-modal-btn-dismiss" onClick={onDismiss}>
                <Icon name="close" size={20} />
                Close App
              </button>
              <button className="update-modal-btn-download" onClick={handleUpdate}>
                <Icon name="install_desktop" size={20} />
                Install Update
              </button>
            </>
          )}

          {status === "error" && (
            <>
              <button className="update-modal-btn-dismiss" onClick={onDismiss}>
                <Icon name="close" size={20} />
                Close App
              </button>
              <button className="update-modal-btn-download" onClick={handleRetry}>
                <Icon name="refresh" size={20} />
                Try Again
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        {status === "prompt" && (
          <p className="update-modal-footer">
            Closing this dialog will exit the application.
          </p>
        )}
      </div>
    </div>
  );
}
