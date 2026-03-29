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
import { dockObsClient } from "../dockObsClient";
import { dockClient } from "../../services/dockBridge";
import type { DockStagedItem } from "../dockTypes";
import type { MediaItem } from "../../library/libraryTypes";
import Icon from "../DockIcon";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

/** Info for a single source in the current scene */
interface SceneSource {
  sourceName: string;
  sceneItemId: number;
  sceneItemIndex: number;
  enabled: boolean;
  inputKind: string;
}

/** Map of OBS input kinds → friendly labels + Material Icons icon name */
const KIND_META: Record<string, { label: string; icon: string }> = {
  browser_source:     { label: "Browser",    icon: "language" },
  ffmpeg_source:      { label: "Media",      icon: "movie" },
  vlc_source:         { label: "VLC",        icon: "movie" },
  image_source:       { label: "Image",      icon: "image" },
  slideshow:          { label: "Slideshow",  icon: "photo_library" },
  text_ft2_source_v2: { label: "Text",       icon: "text_fields" },
  text_gdiplus_v3:    { label: "Text",       icon: "text_fields" },
  color_source_v3:    { label: "Color",      icon: "palette" },
  dshow_input:        { label: "Camera",     icon: "videocam" },
  av_capture_input:   { label: "Camera",     icon: "videocam" },
  av_capture_input_v2:{ label: "Camera",     icon: "videocam" },
  coreaudio_input_capture:  { label: "Audio", icon: "mic" },
  coreaudio_output_capture: { label: "Audio", icon: "headphones" },
  wasapi_input_capture:     { label: "Audio", icon: "mic" },
  wasapi_output_capture:    { label: "Audio", icon: "headphones" },
  window_capture:     { label: "Window",     icon: "desktop_windows" },
  monitor_capture:    { label: "Display",    icon: "monitor" },
  game_capture:       { label: "Game",       icon: "sports_esports" },
  scene:              { label: "Scene",      icon: "layers" },
  ndi_source:         { label: "NDI",        icon: "cast" },
};

function getKindMeta(kind: string): { label: string; icon: string } {
  return KIND_META[kind] ?? { label: "Source", icon: "widgets" };
}

/** Video/media file extensions */
const MEDIA_EXTENSIONS = new Set([
  "mp4", "webm", "mov", "avi", "mkv", "wmv", "flv",
  "mp3", "wav", "ogg", "aac", "flac",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
]);

/** Determine icon for file type */
function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "webm", "mov", "avi", "mkv", "wmv", "flv"].includes(ext)) return "movie";
  if (["mp3", "wav", "ogg", "aac", "flac"].includes(ext)) return "audiotrack";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  return "insert_drive_file";
}

function isMediaFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return MEDIA_EXTENSIONS.has(ext);
}

export default function DockMediaTab({ staged: _staged, onStage: _onStage }: Props) {
  const [sources, setSources] = useState<SceneSource[]>([]);
  const [sceneName, setSceneName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [sendingFile, setSendingFile] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Track which file has its action buttons expanded
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // ── Absolute path to the uploads directory (for native OBS sources) ──
  const [uploadsDir, setUploadsDir] = useState<string | null>(null);

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

  // ── Fetch sources for the current program scene ──

  const fetchSources = useCallback(async () => {
    if (!dockObsClient.isConnected) {
      setError("Not connected to OBS");
      setSources([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Get the current program scene
      const sceneResp = (await dockObsClient.call("GetCurrentProgramScene")) as {
        currentProgramSceneName?: string;
        sceneName?: string;
      };
      const scene =
        sceneResp.currentProgramSceneName ?? sceneResp.sceneName ?? "";
      if (!mountedRef.current) return;
      setSceneName(scene);

      if (!scene) {
        setSources([]);
        setError("No active scene");
        setLoading(false);
        return;
      }

      // Get all items in the scene
      const itemsResp = (await dockObsClient.call("GetSceneItemList", {
        sceneName: scene,
      })) as {
        sceneItems: Array<{
          sourceName: string;
          sceneItemId: number;
          sceneItemIndex: number;
          sceneItemEnabled: boolean;
          inputKind?: string;
          sourceType?: string;
        }>;
      };

      if (!mountedRef.current) return;

      const items: SceneSource[] = itemsResp.sceneItems.map((item) => ({
        sourceName: item.sourceName,
        sceneItemId: item.sceneItemId,
        sceneItemIndex: item.sceneItemIndex,
        enabled: item.sceneItemEnabled,
        inputKind: item.inputKind ?? item.sourceType ?? "unknown",
      }));

      // Sort by index descending (topmost source first — matches OBS UI order)
      items.sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);

      setSources(items);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setSources([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Auto-fetch on mount and when OBS status changes
  useEffect(() => {
    mountedRef.current = true;
    fetchSources();

    const unsub = dockObsClient.onStatusChange((status) => {
      if (status === "connected") {
        fetchSources();
      } else {
        setSources([]);
        setSceneName("");
      }
    });

    // Poll every 5 seconds so the list stays fresh
    const poll = setInterval(fetchSources, 5000);

    return () => {
      mountedRef.current = false;
      unsub();
      clearInterval(poll);
    };
  }, [fetchSources]);

  // ── Toggle source visibility ──

  const toggleSource = useCallback(
    async (source: SceneSource) => {
      if (!dockObsClient.isConnected || !sceneName) return;

      const newEnabled = !source.enabled;

      // Optimistic update
      setSources((prev) =>
        prev.map((s) =>
          s.sceneItemId === source.sceneItemId
            ? { ...s, enabled: newEnabled }
            : s
        )
      );

      try {
        await dockObsClient.call("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: source.sceneItemId,
          sceneItemEnabled: newEnabled,
        });
      } catch {
        // Revert on failure
        setSources((prev) =>
          prev.map((s) =>
            s.sceneItemId === source.sceneItemId
              ? { ...s, enabled: source.enabled }
              : s
          )
        );
      }
    },
    [sceneName]
  );

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
    async (fileName: string, live: boolean) => {
      if (!dockObsClient.isConnected) {
        console.warn("[DockMediaTab] Not connected to OBS");
        return;
      }

      setSendingFile(fileName);
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
          return;
        }

        // Build the absolute local file path for OBS native sources
        const sep = dir.includes("\\") ? "\\" : "/";
        const filePath = `${dir}${sep}${fileName}`;
        console.log("[DockMediaTab] Sending media to OBS:", filePath, "live:", live);
        await dockObsClient.pushMedia(filePath, fileName, live);
        setPlayingFile(fileName);
        setExpandedFile(null);
      } catch (err) {
        console.warn("[DockMediaTab] Play media failed:", err);
      } finally {
        setSendingFile(null);
      }
    },
    [uploadsDir]
  );

  const stopMedia = useCallback(async () => {
    setPlayingFile(null);
    setExpandedFile(null);
    try {
      await dockObsClient.clearMedia();
    } catch (err) {
      console.warn("[DockMediaTab] Stop media failed:", err);
    }
  }, []);

  // ── Play library media item via OBS ──

  const playLibraryMedia = useCallback(
    async (item: MediaItem, live: boolean) => {
      if (!dockObsClient.isConnected) return;

      setSendingFile(item.id);
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

        await dockObsClient.pushMedia(filePath, item.name, live);
        setPlayingFile(item.id);
        setExpandedFile(null);
      } catch (err) {
        console.warn("[DockMediaTab] Play library media failed:", err);
      } finally {
        setSendingFile(null);
      }
    },
    [uploadsDir]
  );

  // ── Render ──

  return (
    <>
      {/* Header with scene name + refresh button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div className="dock-section-label" style={{ margin: 0 }}>
          {sceneName ? `Scene: ${sceneName}` : "Scene Sources"}
        </div>
        <button
          className="dock-btn"
          style={{ padding: "2px 6px", fontSize: 11, minWidth: 0 }}
          onClick={fetchSources}
          disabled={loading || !dockObsClient.isConnected}
          title="Refresh source list"
        >
          <Icon name="refresh" size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            color: "#ff6b6b",
            fontSize: 10,
            marginBottom: 6,
            padding: "4px 6px",
            background: "rgba(255,107,107,.1)",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && sources.length === 0 && (
        <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: 16 }}>
          Loading sources…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && sources.length === 0 && (
        <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: 16 }}>
          No sources in the current scene.
        </div>
      )}

      {/* Source list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {sources.map((source) => {
          const meta = getKindMeta(source.inputKind);
          return (
            <div
              key={source.sceneItemId}
              className="dock-card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                opacity: source.enabled ? 1 : 0.5,
                cursor: "pointer",
              }}
              onClick={() => toggleSource(source)}
              title={`${source.enabled ? "Hide" : "Show"} "${source.sourceName}"`}
            >
              {/* Kind icon */}
              <Icon name={meta.icon} size={14} style={{ color: "#888", flexShrink: 0 }} />

              {/* Name + kind label */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="dock-card__title"
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {source.sourceName}
                </div>
                <div className="dock-card__subtitle">{meta.label}</div>
              </div>

              {/* Visibility toggle icon */}
              <Icon name={source.enabled ? "visibility" : "visibility_off"} size={16} style={{ color: source.enabled ? "#4ecdc4" : "#666", flexShrink: 0 }} />
            </div>
          );
        })}
      </div>

      {/* ── Uploaded Media Files ── */}
      <div style={{ marginTop: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <div className="dock-section-label" style={{ margin: 0 }}>
            Uploaded Media
          </div>
          <button
            className="dock-btn"
            style={{ padding: "2px 6px", fontSize: 10, minWidth: 0 }}
            onClick={fetchUploads}
            disabled={uploadsLoading}
            title="Refresh uploaded files"
          >
            <Icon name="refresh" size={12} style={{ animation: uploadsLoading ? "spin 1s linear infinite" : undefined }} />
          </button>
        </div>

        {uploadedFiles.length === 0 && !uploadsLoading && (
          <div style={{ color: "#888", fontSize: 10, textAlign: "center", padding: 10 }}>
            No uploaded media files found.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {uploadedFiles.map((file) => {
            const isPlaying = playingFile === file;
            const isExpanded = expandedFile === file;
            const isSending = sendingFile === file;
            return (
              <div key={file} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div
                  className="dock-card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    cursor: "pointer",
                    background: isPlaying ? "var(--dock-accent-soft)" : undefined,
                    borderColor: isPlaying ? "var(--dock-accent)" : undefined,
                    borderBottomLeftRadius: isExpanded ? 0 : undefined,
                    borderBottomRightRadius: isExpanded ? 0 : undefined,
                  }}
                  onClick={() => {
                    if (isPlaying) {
                      stopMedia();
                    } else {
                      setExpandedFile(isExpanded ? null : file);
                    }
                  }}
                  title={isPlaying ? `Stop "${file}"` : `Send "${file}" to OBS`}
                >
                  <Icon name={getFileIcon(file)} size={14} style={{ color: isPlaying ? "var(--dock-accent)" : "#888", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="dock-card__title"
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: 10,
                      }}
                    >
                      {file}
                    </div>
                  </div>
                  <Icon name={isPlaying ? "stop" : "play_arrow"} size={14} style={{ color: isPlaying ? "var(--dock-accent)" : "var(--dock-text-dim)", flexShrink: 0 }} />
                </div>
                {/* Action buttons: Preview / Go Live */}
                {isExpanded && !isPlaying && (
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      padding: "4px 8px",
                      background: "var(--dock-card-bg, #22242d)",
                      borderTop: "1px solid var(--dock-border, #2a2d3a)",
                      borderBottomLeftRadius: 6,
                      borderBottomRightRadius: 6,
                    }}
                  >
                    <button
                      className="dock-btn"
                      style={{
                        flex: 1,
                        fontSize: 10,
                        padding: "4px 6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                      }}
                      disabled={isSending}
                      onClick={(e) => { e.stopPropagation(); playMedia(file, false); }}
                      title="Send to Preview"
                    >
                      <Icon name="preview" size={13} />
                      Preview
                    </button>
                    <button
                      className="dock-btn"
                      style={{
                        flex: 1,
                        fontSize: 10,
                        padding: "4px 6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        background: "var(--dock-accent, #6c63ff)",
                        color: "#fff",
                        border: "none",
                      }}
                      disabled={isSending}
                      onClick={(e) => { e.stopPropagation(); playMedia(file, true); }}
                      title="Send to Live"
                    >
                      <Icon name="live_tv" size={13} />
                      Go Live
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Library Media (synced from the Library page) ── */}
      <div style={{ marginTop: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <div className="dock-section-label" style={{ margin: 0 }}>
            Library Media
          </div>
          <button
            className="dock-btn"
            style={{ padding: "2px 6px", fontSize: 10, minWidth: 0 }}
            onClick={loadLibraryMedia}
            disabled={libraryLoading}
            title="Refresh library media"
          >
            <Icon name="refresh" size={12} style={{ animation: libraryLoading ? "spin 1s linear infinite" : undefined }} />
          </button>
        </div>

        {libraryMedia.length === 0 && !libraryLoading && (
          <div style={{ color: "#888", fontSize: 10, textAlign: "center", padding: 10 }}>
            No library media found. Add media in the app's Library page.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {libraryMedia.map((item) => {
            const icon = item.type === "video" ? "movie" : "image";
            const isPlaying = playingFile === item.id;
            const isExpanded = expandedFile === item.id;
            const isSending = sendingFile === item.id;
            return (
              <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div
                  className="dock-card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    cursor: "pointer",
                    background: isPlaying ? "var(--dock-accent-soft)" : undefined,
                    borderColor: isPlaying ? "var(--dock-accent)" : undefined,
                    borderBottomLeftRadius: isExpanded ? 0 : undefined,
                    borderBottomRightRadius: isExpanded ? 0 : undefined,
                  }}
                  onClick={() => {
                    if (isPlaying) {
                      stopMedia();
                    } else {
                      setExpandedFile(isExpanded ? null : item.id);
                    }
                  }}
                  title={isPlaying ? `Stop "${item.name}"` : `Send "${item.name}" to OBS`}
                >
                  {/* Thumbnail or icon */}
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      style={{
                        width: 24,
                        height: 24,
                        objectFit: "cover",
                        borderRadius: 3,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <Icon name={icon} size={14} style={{ color: isPlaying ? "var(--dock-accent)" : "#888", flexShrink: 0 }} />
                  )}

                  {/* Name + type badge */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="dock-card__title"
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: 10,
                      }}
                    >
                      {item.name}
                    </div>
                    <div className="dock-card__subtitle" style={{ fontSize: 9, textTransform: "uppercase" }}>
                      {item.type}{item.mimeType ? ` · ${item.mimeType.split("/")[1]}` : ""}
                    </div>
                  </div>

                  {/* Play/Stop icon */}
                  <Icon name={isPlaying ? "stop" : "play_arrow"} size={14} style={{ color: isPlaying ? "var(--dock-accent)" : "var(--dock-text-dim)", flexShrink: 0 }} />
                </div>
                {/* Action buttons: Preview / Go Live */}
                {isExpanded && !isPlaying && (
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      padding: "4px 8px",
                      background: "var(--dock-card-bg, #22242d)",
                      borderTop: "1px solid var(--dock-border, #2a2d3a)",
                      borderBottomLeftRadius: 6,
                      borderBottomRightRadius: 6,
                    }}
                  >
                    <button
                      className="dock-btn"
                      style={{
                        flex: 1,
                        fontSize: 10,
                        padding: "4px 6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                      }}
                      disabled={isSending}
                      onClick={(e) => { e.stopPropagation(); playLibraryMedia(item, false); }}
                      title="Send to Preview"
                    >
                      <Icon name="preview" size={13} />
                      Preview
                    </button>
                    <button
                      className="dock-btn"
                      style={{
                        flex: 1,
                        fontSize: 10,
                        padding: "4px 6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        background: "var(--dock-accent, #6c63ff)",
                        color: "#fff",
                        border: "none",
                      }}
                      disabled={isSending}
                      onClick={(e) => { e.stopPropagation(); playLibraryMedia(item, true); }}
                      title="Send to Live"
                    >
                      <Icon name="live_tv" size={13} />
                      Go Live
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spin animation for refresh icon */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
