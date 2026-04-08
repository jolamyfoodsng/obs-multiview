/**
 * DockMediaTab.tsx — Media tab for the OBS Browser Dock
 *
 * Lists all sources in the current OBS scene and lets the user:
 *   • Toggle source visibility (show/hide)
 *   • Refresh the source list
 *   • Browse uploaded media files and play them in OBS
 *
 * Replaces the former "Ticker" tab.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { dockObsClient, type DockAudioInputSource, type DockMediaSendOptions } from "../dockObsClient";
import { dockClient } from "../../services/dockBridge";
import type { DockStagedItem } from "../dockTypes";
import type { MediaItem } from "../../library/libraryTypes";
import Icon from "../DockIcon";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

type DockMediaKind = "video" | "image";

interface DockMediaEntry {
  key: string;
  name: string;
  kind: DockMediaKind;
  originLabel: string;
  mimeLabel?: string;
  thumbnailUrl?: string;
  uploadFile?: string;
  libraryItem?: MediaItem;
  playingKey: string;
}

interface ActiveMediaTargets {
  preview: DockMediaEntry | null;
  program: DockMediaEntry | null;
}

interface DockMediaPreference {
  videoMuted?: boolean;
  imageAudioInputName?: string | null;
}

type DockMediaPreferences = Record<string, DockMediaPreference>;

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv", "wmv", "flv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const MEDIA_PREFS_STORAGE_KEY = "ocs-dock-media-preferences-v1";

/** Determine icon for file type */
function getFileIcon(kind: DockMediaKind): string {
  return kind === "video" ? "movie" : "image";
}

function getUploadMediaKind(name: string): DockMediaKind | null {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

function isMediaFile(name: string): boolean {
  return getUploadMediaKind(name) !== null;
}

function loadMediaPreferences(): DockMediaPreferences {
  try {
    const stored = localStorage.getItem(MEDIA_PREFS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DockMediaPreferences;
  } catch {
    return {};
  }
}

export default function DockMediaTab({ staged: _staged, onStage: _onStage }: Props) {
  const [activeKind, setActiveKind] = useState<DockMediaKind>("video");
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [sendingFile, setSendingFile] = useState<string | null>(null);
  const [mediaPrefs, setMediaPrefs] = useState<DockMediaPreferences>(() => loadMediaPreferences());
  const [openOptionsKey, setOpenOptionsKey] = useState<string | null>(null);
  const [audioSources, setAudioSources] = useState<DockAudioInputSource[]>([]);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [activeTargets, setActiveTargets] = useState<ActiveMediaTargets>({
    preview: null,
    program: null,
  });
  const [clearingTarget, setClearingTarget] = useState<"preview" | "program" | "all" | null>(null);
  const mountedRef = useRef(true);

  // ── Absolute path to the uploads directory (for native OBS sources) ──
  const [uploadsDir, setUploadsDir] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MEDIA_PREFS_STORAGE_KEY, JSON.stringify(mediaPrefs));
    } catch {
      // Dock preferences are convenience-only; ignore storage failures.
    }
  }, [mediaPrefs]);

  const updateMediaPreference = useCallback((entryKey: string, patch: DockMediaPreference) => {
    setMediaPrefs((prev) => ({
      ...prev,
      [entryKey]: {
        ...prev[entryKey],
        ...patch,
      },
    }));
  }, []);

  const loadAudioSources = useCallback(async () => {
    if (!dockObsClient.isConnected) {
      setAudioSources([]);
      setAudioError("Connect OBS to list audio input sources.");
      return;
    }

    setAudioLoading(true);
    setAudioError(null);
    try {
      const sources = await dockObsClient.listAudioInputSources();
      setAudioSources(sources);
      if (sources.length === 0) {
        setAudioError("No OBS audio input capture sources found.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load audio input sources.";
      setAudioError(message);
      setAudioSources([]);
    } finally {
      setAudioLoading(false);
    }
  }, []);

  // Fetch uploads directory path on mount (with retries for startup timing)
  useEffect(() => {
    let cancelled = false;
    async function fetchDir(retries = 5) {
      for (let i = 0; i < retries; i++) {
        try {
          const res = await fetch("/api/uploads-dir");
          if (res.ok) {
            const data = await res.json();
            if (data.path && !cancelled) {
              setUploadsDir(data.path);
              console.log("[DockMediaTab] Uploads dir:", data.path);
              return;
            }
          }
        } catch { /* server not ready yet */ }
        // Wait before retrying (1s, 2s, 3s...)
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
      if (!cancelled) console.warn("[DockMediaTab] Could not fetch uploads dir after retries");
    }
    fetchDir();
    return () => { cancelled = true; };
  }, []);

  // ── Library media items (from main app) ──
  const [libraryMedia, setLibraryMedia] = useState<MediaItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const loadLibraryMedia = useCallback(async () => {
    setLibraryLoading(true);
    try {
      // Strategy 1: try localStorage (works when dock runs in same Tauri webview)
      try {
        const { getAllMedia } = await import("../../library/libraryDb");
        const all = getAllMedia();
        console.log("[DockMediaTab] localStorage returned", all.length, "media items");
        if (all.length > 0) {
          setLibraryMedia(all);
          return;
        }
      } catch (err) {
        console.log("[DockMediaTab] localStorage not available:", err);
      }

      // Strategy 2: fetch from overlay server (works when dock runs in OBS CEF)
      try {
        const res = await fetch("/uploads/dock-media-library.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const all = await res.json();
        console.log("[DockMediaTab] JSON fetch returned", Array.isArray(all) ? all.length : 0, "media items");
        if (Array.isArray(all) && all.length > 0) {
          setLibraryMedia(all);
          return;
        }
      } catch (err) {
        console.log("[DockMediaTab] JSON fetch failed:", err);
      }
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  // Load library media on mount
  useEffect(() => {
    loadLibraryMedia();
  }, [loadLibraryMedia]);

  // Listen for library-updated signal to refresh media
  useEffect(() => {
    const unsub = dockClient.onState((msg) => {
      if (msg.type === "state:library-updated" || msg.type === "state:media-data") {
        loadLibraryMedia();
      }
    });
    return unsub;
  }, [loadLibraryMedia]);

  // ── Fetch uploaded files from overlay server ──

  const fetchUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const resp = await fetch("/api/uploads");
      if (resp.ok) {
        const files: string[] = await resp.json();
        if (mountedRef.current) {
          setUploadedFiles(files.filter(isMediaFile));
        }
      }
    } catch {
      // Silently fail — uploads listing is optional
    } finally {
      if (mountedRef.current) setUploadsLoading(false);
    }
  }, []);

  // Fetch uploads on mount
  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  // ── Play uploaded media via OBS — send to Preview or Go Live ──

  const playMedia = useCallback(
    async (fileName: string, live: boolean, options?: DockMediaSendOptions): Promise<boolean> => {
      if (!dockObsClient.isConnected) {
        console.warn("[DockMediaTab] Not connected to OBS");
        return false;
      }

      setSendingFile(`upload:${fileName}`);
      try {
        // Resolve the uploads dir if we don't have it yet
        let dir = uploadsDir;
        if (!dir) {
          try {
            const res = await fetch("/api/uploads-dir");
            if (res.ok) {
              const data = await res.json();
              dir = data.path || null;
              if (dir) setUploadsDir(dir);
            }
          } catch { /* ignore */ }
        }
        if (!dir) {
          console.warn("[DockMediaTab] Could not resolve uploads directory");
          return false;
        }

        // Build the absolute local file path for OBS native sources
        const sep = dir.includes("\\") ? "\\" : "/";
        const filePath = `${dir}${sep}${fileName}`;
        console.log("[DockMediaTab] Sending media to OBS:", filePath, "live:", live);
        await dockObsClient.pushMedia(filePath, fileName, live, options);
        return true;
      } catch (err) {
        console.warn("[DockMediaTab] Play media failed:", err);
        return false;
      } finally {
        setSendingFile(null);
      }
    },
    [uploadsDir]
  );

  // ── Play library media item via OBS ──

  const playLibraryMedia = useCallback(
    async (item: MediaItem, live: boolean, options?: DockMediaSendOptions): Promise<boolean> => {
      if (!dockObsClient.isConnected) return false;

      setSendingFile(`library:${item.id}`);
      try {
        let filePath: string;

        if (item.filePath) {
          // New format: absolute disk path already stored on the item
          filePath = item.filePath;
        } else if (item.url.startsWith("data:")) {
          // Data-URL → save to disk first via overlay server API, get back absolute path
          const res = await fetch("/api/save-media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: item.name, dataUrl: item.url }),
          });
          if (!res.ok) throw new Error(`save-media failed: ${res.status}`);
          const data = await res.json();
          if (!data.path) throw new Error("No path returned from save-media");
          filePath = data.path;
        } else if (uploadsDir && !item.url.startsWith("http") && !item.url.startsWith("blob:")) {
          // Already a local path
          filePath = item.url;
        } else if (uploadsDir) {
          // HTTP URL from overlay server — resolve to local path
          const fileName = item.url.split("/").pop() || item.name;
          const sep = uploadsDir.includes("\\") ? "\\" : "/";
          filePath = `${uploadsDir}${sep}${decodeURIComponent(fileName)}`;
        } else {
          throw new Error("Cannot resolve media to a local file path");
        }

        await dockObsClient.pushMedia(filePath, item.name, live, options);
        return true;
      } catch (err) {
        console.warn("[DockMediaTab] Play library media failed:", err);
        return false;
      } finally {
        setSendingFile(null);
      }
    },
    [uploadsDir]
  );

  const refreshMedia = useCallback(async () => {
    await Promise.all([fetchUploads(), loadLibraryMedia()]);
  }, [fetchUploads, loadLibraryMedia]);

  const uploadedEntries: DockMediaEntry[] = uploadedFiles.reduce<DockMediaEntry[]>((entries, file) => {
      const kind = getUploadMediaKind(file);
      if (!kind) return entries;
      entries.push({
        key: `upload:${file}`,
        name: file,
        kind,
        originLabel: "Uploads",
        mimeLabel: file.split(".").pop()?.toUpperCase(),
        uploadFile: file,
        playingKey: `upload:${file}`,
      });
      return entries;
    }, []);

  const libraryEntries: DockMediaEntry[] = libraryMedia
    .filter((item) => item.type === "video" || item.type === "image")
    .map((item) => ({
      key: `library:${item.id}`,
      name: item.name,
      kind: item.type,
      originLabel: "Library",
      mimeLabel: item.mimeType?.split("/")[1]?.toUpperCase(),
      thumbnailUrl: item.thumbnailUrl,
      libraryItem: item,
      playingKey: `library:${item.id}`,
    }));

  const videoEntries = [...uploadedEntries, ...libraryEntries].filter((entry) => entry.kind === "video");
  const imageEntries = [...uploadedEntries, ...libraryEntries].filter((entry) => entry.kind === "image");
  const activeEntries = activeKind === "video" ? videoEntries : imageEntries;

  useEffect(() => {
    if (activeKind === "video" && videoEntries.length === 0 && imageEntries.length > 0) {
      setActiveKind("image");
      return;
    }
    if (activeKind === "image" && imageEntries.length === 0 && videoEntries.length > 0) {
      setActiveKind("video");
    }
  }, [activeKind, imageEntries.length, videoEntries.length]);

  const getEntryPrefs = useCallback(
    (entry: DockMediaEntry): DockMediaPreference => mediaPrefs[entry.key] ?? {},
    [mediaPrefs],
  );

  const getEntrySendOptions = useCallback(
    (entry: DockMediaEntry): DockMediaSendOptions => {
      const prefs = getEntryPrefs(entry);
      if (entry.kind === "video") {
        return { muted: prefs.videoMuted ?? true };
      }
      return { imageAudioInputName: prefs.imageAudioInputName || null };
    },
    [getEntryPrefs],
  );

  const toggleVideoMute = useCallback(
    async (entry: DockMediaEntry) => {
      const currentMuted = getEntryPrefs(entry).videoMuted ?? true;
      const nextMuted = !currentMuted;
      updateMediaPreference(entry.key, { videoMuted: nextMuted });

      const updates: Promise<void>[] = [];
      if (activeTargets.preview?.key === entry.key) {
        updates.push(dockObsClient.setMediaVideoMuted(false, nextMuted));
      }
      if (activeTargets.program?.key === entry.key) {
        updates.push(dockObsClient.setMediaVideoMuted(true, nextMuted));
      }
      if (updates.length > 0) {
        await Promise.all(updates);
      }
    },
    [activeTargets.preview, activeTargets.program, getEntryPrefs, updateMediaPreference],
  );

  const toggleEntryOptions = useCallback(
    (entry: DockMediaEntry) => {
      setOpenOptionsKey((current) => {
        const next = current === entry.key ? null : entry.key;
        if (next && entry.kind === "image") {
          void loadAudioSources();
        }
        return next;
      });
    },
    [loadAudioSources],
  );

  const handleSendEntry = useCallback(
    async (entry: DockMediaEntry, live: boolean) => {
      let success = false;
      const options = getEntrySendOptions(entry);
      if (entry.uploadFile) {
        success = await playMedia(entry.uploadFile, live, options);
      } else if (entry.libraryItem) {
        success = await playLibraryMedia(entry.libraryItem, live, options);
      }

      if (!success) return;

      if (live) {
        setActiveTargets((prev) => ({ ...prev, program: entry }));
      } else {
        setActiveTargets((prev) => ({ ...prev, preview: entry }));
      }
    },
    [getEntrySendOptions, playLibraryMedia, playMedia]
  );

  const clearPreview = useCallback(async () => {
    setClearingTarget("preview");
    try {
      await dockObsClient.clearMediaTarget(false);
      setActiveTargets((prev) => ({ ...prev, preview: null }));
    } catch (err) {
      console.warn("[DockMediaTab] Clear preview media failed:", err);
    } finally {
      setClearingTarget(null);
    }
  }, []);

  const clearProgram = useCallback(async () => {
    setClearingTarget("program");
    try {
      await dockObsClient.clearMediaTarget(true);
      setActiveTargets((prev) => ({ ...prev, program: null }));
    } catch (err) {
      console.warn("[DockMediaTab] Clear program media failed:", err);
    } finally {
      setClearingTarget(null);
    }
  }, []);

  const clearAll = useCallback(async () => {
    setClearingTarget("all");
    try {
      await dockObsClient.clearMedia();
      setActiveTargets({ preview: null, program: null });
    } catch (err) {
      console.warn("[DockMediaTab] Clear all media failed:", err);
    } finally {
      setClearingTarget(null);
    }
  }, []);

  const renderMediaRow = useCallback(
    (entry: DockMediaEntry) => {
      const isPreviewTarget = activeTargets.preview?.key === entry.key;
      const isProgramTarget = activeTargets.program?.key === entry.key;
      const isPlaying = isPreviewTarget || isProgramTarget;
      const isSending = sendingFile === entry.playingKey;
      const stateLabel = isPreviewTarget && isProgramTarget
        ? "Preview + Program"
        : isProgramTarget
          ? "Program"
          : isPreviewTarget
            ? "Preview"
            : "";
      const prefs = getEntryPrefs(entry);
      const videoMuted = prefs.videoMuted ?? true;
      const selectedAudioInput = prefs.imageAudioInputName || "";
      const isOptionsOpen = openOptionsKey === entry.key;
      const selectedAudioMissing = Boolean(
        selectedAudioInput && !audioSources.some((source) => source.inputName === selectedAudioInput),
      );
      const metaParts = [
        entry.originLabel,
        entry.mimeLabel,
        entry.kind === "video" ? (videoMuted ? "Muted" : "Audio on") : null,
        entry.kind === "image" && selectedAudioInput ? `Audio: ${selectedAudioInput}` : null,
      ].filter(Boolean);
      return (
        <div
          key={entry.key}
          className={[
            "dock-media-row",
            isPlaying ? "dock-media-row--playing" : "",
            isOptionsOpen ? "dock-media-row--options-open" : "",
          ].filter(Boolean).join(" ")}
        >
          <div className="dock-media-row__main">
            {entry.thumbnailUrl ? (
              <img
                src={entry.thumbnailUrl}
                alt=""
                className="dock-media-row__thumb"
              />
            ) : (
              <span className="dock-media-row__icon" aria-hidden="true">
                <Icon name={getFileIcon(entry.kind)} size={14} />
              </span>
            )}
            <div className="dock-media-row__body">
              <div className="dock-media-row__title">{entry.name}</div>
              <div className="dock-media-row__meta">
                {metaParts.join(" · ")}
              </div>
            </div>
            {isPlaying && <span className="dock-media-row__state">{stateLabel}</span>}
          </div>
          <div className="dock-hover-actions dock-media-row__actions">
            {entry.kind === "video" && (
              <button
                type="button"
                className={`dock-hover-actions__btn dock-media-row__icon-action${videoMuted ? " dock-media-row__icon-action--muted" : ""}`}
                disabled={isSending}
                aria-label={`${videoMuted ? "Unmute" : "Mute"} ${entry.name}`}
                title={videoMuted ? "Muted by default. Click to unmute." : "Audio on. Click to mute."}
                onClick={() => void toggleVideoMute(entry)}
              >
                <Icon name={videoMuted ? "volume_off" : "volume_up"} size={12} />
              </button>
            )}
            <button
              type="button"
              className="dock-btn dock-btn--preview dock-btn--compact dock-media-row__action"
              disabled={isSending}
              aria-label={`Send ${entry.name} to preview`}
              title="Send to Preview"
              onClick={() => void handleSendEntry(entry, false)}
            >
              Preview
            </button>
            <button
              type="button"
              className="dock-btn dock-btn--live dock-btn--compact dock-media-row__action"
              disabled={isSending}
              aria-label={`Send ${entry.name} to program`}
              title="Send to Program"
              onClick={() => void handleSendEntry(entry, true)}
            >
              Program
            </button>
            <button
              type="button"
              className="dock-hover-actions__btn dock-media-row__icon-action"
              aria-label={`Show more media options for ${entry.name}`}
              aria-expanded={isOptionsOpen}
              title="More media options"
              onClick={() => toggleEntryOptions(entry)}
            >
              <Icon name="more_horiz" size={13} />
            </button>
          </div>
          {isOptionsOpen && (
            <div className="dock-media-row__options">
              {entry.kind === "video" ? (
                <>
                  <div className="dock-media-row__options-head">
                    <span>Video audio</span>
                    <button
                      type="button"
                      className={`dock-media-row__toggle${!videoMuted ? " dock-media-row__toggle--active" : ""}`}
                      disabled={isSending}
                      onClick={() => void toggleVideoMute(entry)}
                    >
                      <Icon name={videoMuted ? "volume_off" : "volume_up"} size={12} />
                      {videoMuted ? "Muted" : "Unmuted"}
                    </button>
                  </div>
                  <div className="dock-media-row__hint">
                    Videos stay muted by default so graphics changes do not accidentally bring audio live.
                  </div>
                </>
              ) : (
                <>
                  <div className="dock-media-row__options-head">
                    <span>Image audio input</span>
                    <button
                      type="button"
                      className="dock-media-row__refresh-audio"
                      onClick={() => void loadAudioSources()}
                      disabled={audioLoading}
                    >
                      {audioLoading ? "Loading" : "Refresh"}
                    </button>
                  </div>
                  <select
                    className="dock-media-row__select"
                    value={selectedAudioInput}
                    onChange={(event) => {
                      updateMediaPreference(entry.key, {
                        imageAudioInputName: event.target.value || null,
                      });
                    }}
                    onFocus={() => void loadAudioSources()}
                    disabled={audioLoading}
                    aria-label={`Audio input to attach when showing ${entry.name}`}
                  >
                    <option value="">No audio attached</option>
                    {selectedAudioMissing && <option value={selectedAudioInput}>{selectedAudioInput}</option>}
                    {audioSources.map((source) => (
                      <option key={source.inputName} value={source.inputName}>
                        {source.inputName}
                      </option>
                    ))}
                  </select>
                  <div className="dock-media-row__hint">
                    {audioError || "Selected mic is copied into the media scene when you send this image."}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      );
    },
    [
      activeTargets.preview,
      activeTargets.program,
      audioError,
      audioLoading,
      audioSources,
      getEntryPrefs,
      handleSendEntry,
      loadAudioSources,
      openOptionsKey,
      sendingFile,
      toggleEntryOptions,
      toggleVideoMute,
      updateMediaPreference,
    ]
  );

  // ── Render ──

  return (
    <div className="dock-module dock-module--media">
      <section className="dock-console-panel dock-console-panel--workspace dock-media-shell">
        <div className="dock-console-header">
          <div>
            <div className="dock-console-header__eyebrow">Media</div>
            <div className="dock-console-header__title">Preview or send media live</div>
          </div>
          <button
            type="button"
            className="dock-shell-icon-btn"
            onClick={() => void refreshMedia()}
            disabled={uploadsLoading || libraryLoading}
            aria-label="Refresh media lists"
            title="Refresh media lists"
          >
            <Icon
              name="refresh"
              size={12}
              style={{ animation: uploadsLoading || libraryLoading ? "spin 1s linear infinite" : undefined }}
            />
          </button>
        </div>

        {videoEntries.length === 0 && imageEntries.length === 0 && !uploadsLoading && !libraryLoading && (
          <div className="dock-empty">
            <div className="dock-empty__text">No media found. Add media in the app or uploads folder first.</div>
          </div>
        )}

        {(videoEntries.length > 0 || imageEntries.length > 0) && (
          <>
            <div className="dock-console-segmented dock-media-tabs" role="tablist" aria-label="Media type">
              <button
                type="button"
                role="tab"
                aria-selected={activeKind === "video"}
                className={`dock-console-segmented__item${activeKind === "video" ? " dock-console-segmented__item--active" : ""}`}
                onClick={() => setActiveKind("video")}
              >
                Video
                <span className="dock-media-tabs__count">{videoEntries.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeKind === "image"}
                className={`dock-console-segmented__item${activeKind === "image" ? " dock-console-segmented__item--active" : ""}`}
                onClick={() => setActiveKind("image")}
              >
                Picture Media
                <span className="dock-media-tabs__count">{imageEntries.length}</span>
              </button>
            </div>

            <div className="dock-media-scroll">
              {activeEntries.length === 0 ? (
                <div className="dock-empty dock-empty--inline">
                  <div className="dock-empty__text">
                    {activeKind === "video" ? "No video media available." : "No picture media available."}
                  </div>
                </div>
              ) : (
                <div key={activeKind} className="dock-console-list dock-console-list--compact dock-media-list">
                  {activeEntries.map((entry) => renderMediaRow(entry))}
                </div>
              )}
            </div>

            {(activeTargets.preview || activeTargets.program) && (
              <div className="dock-media-clear-box">
                <div className="dock-media-clear-box__header">
                  <div className="dock-media-clear-box__title">Clear Output</div>
                  <div className="dock-media-clear-box__meta">
                    {activeTargets.preview ? `Preview: ${activeTargets.preview.name}` : "Preview empty"}
                    {" · "}
                    {activeTargets.program ? `Program: ${activeTargets.program.name}` : "Program empty"}
                  </div>
                </div>
                <div className="dock-media-clear-box__actions">
                  <button
                    type="button"
                    className="dock-btn dock-btn--compact dock-media-clear-box__btn"
                    onClick={() => void clearPreview()}
                    disabled={!activeTargets.preview || clearingTarget !== null}
                  >
                    Clear Preview
                  </button>
                  <button
                    type="button"
                    className="dock-btn dock-btn--compact dock-media-clear-box__btn"
                    onClick={() => void clearProgram()}
                    disabled={!activeTargets.program || clearingTarget !== null}
                  >
                    Clear Program
                  </button>
                  <button
                    type="button"
                    className="dock-btn dock-btn--danger dock-btn--compact dock-media-clear-box__btn"
                    onClick={() => void clearAll()}
                    disabled={clearingTarget !== null}
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
