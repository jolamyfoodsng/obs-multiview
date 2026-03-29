/**
 * SongsTab.tsx — Songs list tab for the Library page
 *
 * Features:
 *   • Search by title / artist
 *   • Song list with lyrics preview, slide count, key badge
 *   • Add Song modal (title, key, leader, lyrics, auto-split)
 *   • Edit Song modal (same fields, pre-filled)
 *   • Archive with confirmation
 *   • ESC closes modals
 *
 * Songs are persisted in IndexedDB via worshipDb.ts.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Song } from "../worship/types";
import { archiveSong, getAllSongs, getArchivedSongs, restoreSong, saveSong } from "../worship/worshipDb";
import { generateSlides } from "../worship/slideEngine";
import Icon from "../components/Icon";

/* ---------- helpers ---------- */

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function firstNLines(text: string, n: number): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n);
}

/* ========================================================================= */
/* SongsTab                                                                  */
/* ========================================================================= */

export function SongsTab() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [archivedSongs, setArchivedSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editSong, setEditSong] = useState<Song | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  const reload = useCallback(async () => {
    const [all, archived] = await Promise.all([getAllSongs(), getArchivedSongs()]);
    setSongs(all);
    setArchivedSongs(archived);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // ESC handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddModal) { setShowAddModal(false); return; }
        if (editSong) { setEditSong(null); return; }
        if (deleteConfirmId) { setDeleteConfirmId(null); return; }
        if (showArchiveModal) { setShowArchiveModal(false); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAddModal, editSong, deleteConfirmId, showArchiveModal]);

  const visible = songs.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.metadata.title.toLowerCase().includes(q) ||
      s.metadata.artist.toLowerCase().includes(q)
    );
  });

  const handleArchive = useCallback(
    async (id: string) => {
      await archiveSong(id);
      reload();
      setDeleteConfirmId(null);
    },
    [reload]
  );

  const handleSaveComplete = useCallback(() => {
    reload();
    setShowAddModal(false);
    setEditSong(null);
  }, [reload]);

  const handleRestore = useCallback(async (id: string) => {
    await restoreSong(id);
    reload();
  }, [reload]);

  return (
    <>
      {/* Toolbar */}
      <div className="lib-toolbar">
        <div className="lib-toolbar-left">
          <div className="lib-search-wrap">
            <Icon name="search" size={18} className="lib-search-icon" />
            <input
              className="lib-search-input"
              type="text"
              placeholder="Search songs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="lib-archive-btn" onClick={() => setShowArchiveModal(true)}>
            <Icon name="archive" size={18} />
            View Archive
            {archivedSongs.length > 0 && (
              <span className="lib-archive-count">{archivedSongs.length}</span>
            )}
          </button>
        </div>
        <button className="lib-add-btn" onClick={() => setShowAddModal(true)}>
          <Icon name="add" size={20} />
          Add Song
        </button>
      </div>

      {/* Songs list */}
      <div className="lib-songs-list">
        {visible.length === 0 && (
          <div className="lib-empty">
            <Icon name="music_note" size={48} style={{ opacity: 0.3 }} />
            <p>No songs found</p>
            <button className="lib-add-btn" onClick={() => setShowAddModal(true)}>
              <Icon name="add" size={20} />
              Add Song
            </button>
          </div>
        )}

        {visible.map((s) => {
          const lines = firstNLines(s.lyrics, 2);
          return (
            <div className="lib-song-row" key={s.id}>
              {/* Icon */}
              <div className="lib-song-icon">
                <Icon name="lyrics" size={20} />
              </div>

              {/* Text content */}
              <div className="lib-song-content">
                <div className="lib-song-title-row">
                  <h3 className="lib-song-title">{s.metadata.title}</h3>
                  {s.metadata.artist && (
                    <span className="lib-song-artist-badge">{s.metadata.artist}</span>
                  )}
                </div>
                {lines[0] && <p className="lib-song-lyric-line">{lines[0]}</p>}
                {lines[1] && <p className="lib-song-lyric-line lib-song-lyric-line--faded">{lines[1]}</p>}
              </div>

              {/* Meta (slide count + key) */}
              <div className="lib-song-meta">
                <span className="lib-song-slides-badge">
                  {s.slides.length} slide{s.slides.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Actions (edit / archive) — visible on hover */}
              <div className="lib-song-actions">
                <button
                  className="lib-song-action-btn"
                  title="Edit"
                  onClick={() => setEditSong(s)}
                >
                  <Icon name="edit" size={16} />
                </button>
                <button
                  className="lib-song-action-btn lib-song-action-btn--danger"
                  title="Archive"
                  onClick={() => setDeleteConfirmId(s.id)}
                >
                  <Icon name="archive" size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Archive confirmation */}
      {deleteConfirmId && (
        <div className="lib-modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="lib-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Archive the song?</h3>
            <p>This song and its lyrics will be archived and removed from the active library.</p>
            <div className="lib-confirm-actions">
              <button className="lib-confirm-cancel" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button className="lib-confirm-delete" onClick={() => handleArchive(deleteConfirmId)}>Archive</button>
            </div>
          </div>
        </div>
      )}

      {showArchiveModal && (
        <div className="lib-modal-backdrop" onClick={() => setShowArchiveModal(false)}>
          <div className="lib-song-modal lib-archive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lib-add-modal-header">
              <h3>Archived Songs</h3>
              <button className="lib-modal-close-btn" onClick={() => setShowArchiveModal(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="lib-song-modal-body lib-archive-modal-body">
              {archivedSongs.length === 0 ? (
                <div className="lib-empty lib-empty--compact">
                  <Icon name="archive" size={44} style={{ opacity: 0.28 }} />
                  <p>No archived songs yet</p>
                </div>
              ) : (
                <div className="lib-archive-list">
                  {archivedSongs.map((song) => {
                    const lines = firstNLines(song.lyrics, 2);
                    return (
                      <div className="lib-archive-row" key={song.id}>
                        <div className="lib-song-icon">
                          <Icon name="lyrics" size={20} />
                        </div>

                        <div className="lib-song-content">
                          <div className="lib-song-title-row">
                            <h3 className="lib-song-title">{song.metadata.title}</h3>
                            {song.metadata.artist && (
                              <span className="lib-song-artist-badge">{song.metadata.artist}</span>
                            )}
                          </div>
                          {song.archivedAt && (
                            <p className="lib-archive-meta">
                              Archived {new Date(song.archivedAt).toLocaleString()}
                            </p>
                          )}
                          {lines[0] && <p className="lib-song-lyric-line">{lines[0]}</p>}
                          {lines[1] && <p className="lib-song-lyric-line lib-song-lyric-line--faded">{lines[1]}</p>}
                        </div>

                        <div className="lib-song-meta">
                          <span className="lib-song-slides-badge">
                            {song.slides.length} slide{song.slides.length !== 1 ? "s" : ""}
                          </span>
                        </div>

                        <div className="lib-song-actions lib-song-actions--visible">
                          <button
                            className="lib-song-action-btn"
                            title="Restore song"
                            onClick={() => handleRestore(song.id)}
                          >
                            <Icon name="unarchive" size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lib-add-modal-footer">
              <button className="lib-modal-cancel-btn" onClick={() => setShowArchiveModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Song Modal */}
      {showAddModal && (
        <SongFormModal onClose={() => setShowAddModal(false)} onSave={handleSaveComplete} />
      )}

      {/* Edit Song Modal */}
      {editSong && (
        <SongFormModal song={editSong} onClose={() => setEditSong(null)} onSave={handleSaveComplete} />
      )}
    </>
  );
}

/* ========================================================================= */
/* SongFormModal — shared for Add / Edit                                     */
/* ========================================================================= */

interface SongFormModalProps {
  song?: Song;
  onClose: () => void;
  onSave: () => void;
}

function SongFormModal({ song, onClose, onSave }: SongFormModalProps) {
  const [title, setTitle] = useState(song?.metadata.title ?? "");
  const [artist, setArtist] = useState(song?.metadata.artist ?? "");
  const [lyrics, setLyrics] = useState(song?.lyrics ?? "");
  const [autoSplit, setAutoSplit] = useState(true);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const slides = autoSplit ? generateSlides(lyrics, 2, true) : generateSlides(lyrics, 999, false);
      const now = new Date().toISOString();

      const updated: Song = {
        id: song?.id ?? uid(),
        metadata: {
          title: title.trim(),
          artist: artist.trim(),
        },
        lyrics,
        slides,
        createdAt: song?.createdAt ?? now,
        updatedAt: now,
      };

      await saveSong(updated);
      onSave();
    } catch (err) {
      console.error("[SongsTab] Failed to save song:", err);
    } finally {
      setSaving(false);
    }
  }, [title, artist, lyrics, autoSplit, song, onSave]);

  const isEdit = !!song;

  return (
    <div className="lib-modal-backdrop" onClick={onClose}>
      <div className="lib-song-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lib-add-modal-header">
          <h3>{isEdit ? "Edit Song" : "Add New Song"}</h3>
          <button className="lib-modal-close-btn" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="lib-song-modal-body">
          {/* Title + Key + Leader row */}
          <div className="lib-song-form-row">
            <div className="lib-field lib-field--grow">
              <label className="lib-field-label">Song Title <span style={{ color: "var(--primary)" }}>*</span></label>
              <input
                ref={titleRef}
                className="lib-field-input"
                type="text"
                placeholder="e.g. Way Maker"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="lib-field lib-field--sm">
              <label className="lib-field-label">Artist</label>
              <input
                className="lib-field-input"
                type="text"
                placeholder="Optional"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
              />
            </div>
          </div>

          {/* Lyrics editor */}
          <div className="lib-field lib-field--grow lib-field--lyrics">
            <div className="lib-lyrics-label-row">
              <label className="lib-field-label">Lyrics & Structure</label>
            </div>
            <textarea
              className="lib-lyrics-textarea"
              placeholder={`Verse 1:\nLine 1 lyrics goes here...\nLine 2 lyrics goes here...\n\nChorus:\nChorus line 1...`}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
            />
            <p className="lib-lyrics-hint">
              Use labels like <code>Verse 1:</code>, <code>Chorus:</code>, <code>Bridge:</code> to automatically section lyrics.
            </p>
          </div>

          {/* Auto-split toggle */}
          <div className="lib-autosplit-row">
            <Icon name="splitscreen" size={20} style={{ color: "var(--text-muted)" }} />
            <div className="lib-autosplit-text">
              <span className="lib-autosplit-label">Auto-split into slides</span>
              <span className="lib-autosplit-hint">Optimizes lyrics for readability (2-3 lines per slide)</span>
            </div>
            <label className="lib-toggle">
              <input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} />
              <span className="lib-toggle-slider" />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="lib-add-modal-footer">
          <button className="lib-modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="lib-modal-save-btn"
            disabled={!title.trim() || saving}
            onClick={handleSave}
          >
            <Icon name="save" size={18} />
            {saving ? "Saving…" : isEdit ? "Update Song" : "Save Song"}
          </button>
        </div>
      </div>
    </div>
  );
}
