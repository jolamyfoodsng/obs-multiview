/**
 * MediaTab.tsx — Media grid tab for the Library page
 *
 * Features:
 *   • Search by name
 *   • Filter: All / Images / Videos
 *   • Responsive card grid with thumbnails, type/duration badges
 *   • 3-dot menu: Rename, Delete (with confirmation)
 *   • Add Media modal with drag-and-drop + file browse
 *   • ESC closes modals
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MediaItem } from "./libraryTypes";
import { getAllMedia, saveMedia, deleteMedia, renameMedia } from "./libraryDb";
import { getOverlayBaseUrl } from "../services/overlayUrl";
import Icon from "../components/Icon";

type FilterType = "all" | "image" | "video";

/* ---------- helpers ---------- */

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function getVideoDuration(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => resolve(0);
    v.src = dataUrl;
  });
}

function generateVideoThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, v.duration / 4);
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    v.onerror = () => resolve("");
    v.src = dataUrl;
  });
}

/**
 * Generate a small thumbnail data-URL for an image (max 320×180).
 * Keeps the stored data small for localStorage.
 */
function generateImageThumbnail(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const MAX_W = 320;
      const MAX_H = 180;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_W || h > MAX_H) {
        const ratio = Math.min(MAX_W / w, MAX_H / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

/* ========================================================================= */
/* MediaTab                                                                  */
/* ========================================================================= */

export function MediaTab() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => setItems(getAllMedia()), []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ESC handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddModal) { setShowAddModal(false); return; }
        if (deleteConfirmId) { setDeleteConfirmId(null); return; }
        if (renameId) { setRenameId(null); return; }
        setMenuOpenId(null);
        setShowFilter(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAddModal, deleteConfirmId, renameId]);

  // Filter + search
  const visible = items.filter((m) => {
    if (filter !== "all" && m.type !== filter) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  /* ---- actions ---- */

  const handleDelete = useCallback(
    (id: string) => {
      deleteMedia(id);
      reload();
      setDeleteConfirmId(null);
      setMenuOpenId(null);
    },
    [reload]
  );

  const handleRenameSubmit = useCallback(
    (id: string) => {
      if (renameValue.trim()) {
        renameMedia(id, renameValue.trim());
        reload();
      }
      setRenameId(null);
    },
    [renameValue, reload]
  );

  const handleAddComplete = useCallback(() => {
    reload();
    setShowAddModal(false);
  }, [reload]);

  const filterLabel = filter === "all" ? "All" : filter === "image" ? "Images" : "Videos";

  return (
    <>
      {/* Toolbar */}
      <div className="lib-toolbar">
        <div className="lib-toolbar-left">
          {/* Search */}
          <div className="lib-search-wrap">
            <Icon name="search" size={20} className="lib-search-icon" />
            <input
              className="lib-search-input"
              type="text"
              placeholder="Search media..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search media"
            />
            {search && (
              <button
                type="button"
                className="lib-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear media search"
                title="Clear media search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>

          {/* Filter dropdown */}
          <div className="lib-filter-wrap" ref={filterRef}>
            <button
              className="lib-filter-btn"
              onClick={() => setShowFilter((v) => !v)}
            >
              <Icon name="filter_list" size={18} />
              <span>Filter: {filterLabel}</span>
              <Icon name="arrow_drop_down" size={18} />
            </button>
            {showFilter && (
              <div className="lib-filter-dropdown">
                {(["all", "image", "video"] as FilterType[]).map((f) => (
                  <button
                    key={f}
                    className={`lib-filter-option${filter === f ? " is-active" : ""}`}
                    onClick={() => { setFilter(f); setShowFilter(false); }}
                  >
                    {f === "all" ? "All" : f === "image" ? "Images" : "Videos"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button className="lib-add-btn" onClick={() => setShowAddModal(true)}>
          <Icon name="add" size={20} />
          Add Media
        </button>
      </div>

      {/* Grid */}
      <div className="lib-media-grid">
        {visible.length === 0 && (
          <div className="lib-empty">
            <Icon name="perm_media" size={48} style={{ opacity: 0.3 }} />
            <p>No media found</p>
            <button className="lib-add-btn" onClick={() => setShowAddModal(true)}>
              <Icon name="add" size={20} />
              Add Media
            </button>
          </div>
        )}

        {visible.map((m) => (
          <div
            className={`lib-media-card${menuOpenId === m.id ? " lib-media-card--menu-open" : ""}`}
            key={m.id}
          >
            {/* Thumbnail */}
            <div className="lib-media-thumb">
              {(m.thumbnailUrl || m.url) && (
                <img
                  src={m.thumbnailUrl || m.url}
                  alt={m.name}
                  className="lib-media-thumb-img"
                />
              )}
              <div className="lib-media-thumb-overlay" />
              {/* Type badge */}
              <span className="lib-media-badge-type">
                {m.type === "video" ? "VIDEO" : "IMAGE"}
              </span>
              {/* Duration badge */}
              {m.type === "video" && m.durationSec != null && (
                <span className="lib-media-badge-dur">
                  {fmtDuration(m.durationSec)}
                </span>
              )}
              {/* Play button overlay */}
              {m.type === "video" && (
                <div className="lib-media-play-overlay">
                  <div className="lib-media-play-btn">
                    <Icon name="play_arrow" size={20} className="filled" />
                  </div>
                </div>
              )}
            </div>

            {/* Info row */}
            <div className="lib-media-info">
              <div className="lib-media-info-text">
                {renameId === m.id ? (
                  <input
                    className="lib-rename-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(m.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSubmit(m.id);
                      if (e.key === "Escape") setRenameId(null);
                    }}
                  />
                ) : (
                  <>
                    <h4 className="lib-media-name" title={m.name}>{m.name}</h4>
                    <p className="lib-media-meta">
                      {m.type === "image" && m.mimeType
                        ? `${m.mimeType.split("/")[1]?.toUpperCase() || "IMG"}`
                        : ""}
                      {m.fileSize ? (m.type === "image" ? " • " : "") + fmtFileSize(m.fileSize) : ""}
                      {!m.fileSize && m.createdAt ? timeAgo(m.createdAt) : ""}
                    </p>
                  </>
                )}
              </div>

              {/* 3-dot menu */}
              <div className="lib-media-menu-wrap" ref={menuOpenId === m.id ? menuRef : undefined}>
                <button
                  className="lib-media-menu-btn"
                  onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === m.id ? null : m.id); }}
                >
                  <Icon name="more_vert" size={20} />
                </button>
                {menuOpenId === m.id && (
                  <div className="lib-media-menu-dropdown">
                    <button
                      className="lib-media-menu-action"
                      onClick={() => {
                        setRenameId(m.id);
                        setRenameValue(m.name);
                        setMenuOpenId(null);
                      }}
                    >
                      <Icon name="edit" size={16} />
                      Rename
                    </button>
                    <button
                      className="lib-media-menu-action lib-media-menu-action--danger"
                      onClick={() => { setDeleteConfirmId(m.id); setMenuOpenId(null); }}
                    >
                      <Icon name="delete" size={16} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="lib-modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="lib-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Media?</h3>
            <p>This media item will be permanently removed from your library.</p>
            <div className="lib-confirm-actions">
              <button className="lib-confirm-cancel" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button className="lib-confirm-delete" onClick={() => handleDelete(deleteConfirmId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Media Modal */}
      {showAddModal && (
        <AddMediaModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddComplete}
        />
      )}
    </>
  );
}

/* ========================================================================= */
/* AddMediaModal                                                             */
/* ========================================================================= */

function AddMediaModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [category, setCategory] = useState<"image" | "video">("video");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setFileName(f.name);
    setCategory(f.type.startsWith("video") ? "video" : "image");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleSave = useCallback(async () => {
    if (!file || !fileName.trim()) return;
    setSaving(true);
    try {
      // 1) Save the file to disk via Tauri
      const bytes = new Uint8Array(await file.arrayBuffer());
      const safeName = `media_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const diskPath = await invoke<string>("save_upload_file", {
        fileName: safeName,
        fileData: Array.from(bytes),
      });

      // 2) Build the overlay URL for UI preview / OBS browser sources
      const baseUrl = await getOverlayBaseUrl();
      const overlayUrl = `${baseUrl}/uploads/${encodeURIComponent(safeName)}`;

      // 3) Generate thumbnail + duration using a temporary object URL
      //    (cheap – never stored in localStorage)
      let thumbnailUrl: string | undefined;
      let durationSec: number | undefined;
      const objectUrl = URL.createObjectURL(file);

      try {
        if (category === "video") {
          durationSec = await getVideoDuration(objectUrl);
          thumbnailUrl = await generateVideoThumbnail(objectUrl);
        } else {
          // For images, generate a small thumbnail via canvas
          thumbnailUrl = await generateImageThumbnail(objectUrl);
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      const item: MediaItem = {
        id: uid(),
        name: fileName.trim(),
        type: category,
        url: overlayUrl,
        filePath: diskPath,
        diskFileName: safeName,
        thumbnailUrl,
        durationSec: durationSec ? Math.round(durationSec) : undefined,
        fileSize: file.size,
        mimeType: file.type,
        createdAt: new Date().toISOString(),
      };

      saveMedia(item);
      onSave();
    } catch (err) {
      console.error("[MediaTab] Failed to save media:", err);
      alert("Failed to save media. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [file, fileName, category, onSave]);

  return (
    <div className="lib-modal-backdrop" onClick={onClose}>
      <div className="lib-add-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lib-add-modal-header">
          <h3>Add Media to Library</h3>
          <button className="lib-modal-close-btn" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="lib-add-modal-body">
          {/* Drop zone */}
          <label
            className={`lib-dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="lib-dropzone-content">
              <div className="lib-dropzone-icon-wrap">
                <Icon name="cloud_upload" size={20} className="lib-dropzone-icon" />
              </div>
              {file ? (
                <p className="lib-dropzone-text">{file.name}</p>
              ) : (
                <>
                  <p className="lib-dropzone-text">
                    Drag & drop media here or <span className="lib-dropzone-browse">browse</span>
                  </p>
                  <p className="lib-dropzone-hint">PNG, JPG, MP4, MOV up to 50MB</p>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              className="lib-dropzone-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          {/* File name */}
          <div className="lib-field">
            <label className="lib-field-label">File Name</label>
            <div className="lib-field-input-wrap">
              <input
                className="lib-field-input"
                type="text"
                placeholder="Enter file name"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
              <Icon name="edit" size={20} className="lib-field-input-icon" />
            </div>
          </div>

          {/* Category toggle */}
          <div className="lib-field">
            <label className="lib-field-label">Category</label>
            <div className="lib-category-toggle">
              <label className={`lib-category-opt${category === "image" ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="media-category"
                  className="sr-only"
                  checked={category === "image"}
                  onChange={() => setCategory("image")}
                />
                <Icon name="image" size={16} />
                Image
              </label>
              <label className={`lib-category-opt${category === "video" ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="media-category"
                  className="sr-only"
                  checked={category === "video"}
                  onChange={() => setCategory("video")}
                />
                <Icon name="videocam" size={16} />
                Video
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="lib-add-modal-footer">
          <button className="lib-modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="lib-modal-save-btn"
            disabled={!file || !fileName.trim() || saving}
            onClick={handleSave}
          >
            {saving ? "Saving…" : "Save to Library"}
          </button>
        </div>
      </div>
    </div>
  );
}
