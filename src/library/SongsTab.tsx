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

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Song } from "../worship/types";
import { archiveSong, getAllSongs, getArchivedSongs, restoreSong, saveSong } from "../worship/worshipDb";
import { generateSlides } from "../worship/slideEngine";
import {
  formatOnlineLyricsSearchError,
  isSpotifyTrackLyricsQuery,
  searchOnlineSongLyrics,
  type OnlineLyricsSearchResult,
} from "../worship/onlineLyricsService";
import { OnlineLyricsImportModal, type OnlineLyricsImportDraft } from "../worship/OnlineLyricsImportModal";
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

const MIN_ONLINE_LYRICS_QUERY_LENGTH = 3;
const ONLINE_LYRICS_SEARCH_DELAY_MS = 80;

function normalizeSongLookupPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSongLookupKeys(title: string, artist: string): string[] {
  const normalizedTitle = normalizeSongLookupPart(title);
  const normalizedArtist = normalizeSongLookupPart(artist);

  if (!normalizedTitle) {
    return [];
  }

  return normalizedArtist
    ? [`${normalizedTitle}::${normalizedArtist}`, normalizedTitle]
    : [normalizedTitle];
}

/* ========================================================================= */
/* SongsTab                                                                  */
/* ========================================================================= */

export function SongsTab() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [archivedSongs, setArchivedSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [onlineSearchResults, setOnlineSearchResults] = useState<OnlineLyricsSearchResult[]>([]);
  const [onlineSearchState, setOnlineSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [onlineSearchMessage, setOnlineSearchMessage] = useState("");
  const [importingOnlineId, setImportingOnlineId] = useState<string | null>(null);
  const [pendingOnlineImport, setPendingOnlineImport] = useState<OnlineLyricsSearchResult | null>(null);
  const [showOnlineSearchModal, setShowOnlineSearchModal] = useState(false);
  const [onlineSearchQuery, setOnlineSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editSong, setEditSong] = useState<Song | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const onlineSearchRequestRef = useRef(0);
  const spotifyAutoImportRef = useRef<string | null>(null);

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
        if (showOnlineSearchModal) { setShowOnlineSearchModal(false); return; }
        if (showArchiveModal) { setShowArchiveModal(false); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAddModal, editSong, deleteConfirmId, showOnlineSearchModal, showArchiveModal]);

  const visible = useMemo(
    () =>
      songs.filter((s) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          s.metadata.title.toLowerCase().includes(q) ||
          s.metadata.artist.toLowerCase().includes(q) ||
          s.lyrics.toLowerCase().includes(q)
        );
      }),
    [search, songs],
  );

  const importedSongsLookup = useMemo(() => {
    const lookup = new Map<string, Song>();

    for (const song of songs) {
      for (const key of buildSongLookupKeys(song.metadata.title, song.metadata.artist)) {
        if (!lookup.has(key)) {
          lookup.set(key, song);
        }
      }
    }

    return lookup;
  }, [songs]);

  const findImportedSong = useCallback((result: OnlineLyricsSearchResult): Song | undefined => {
    for (const key of buildSongLookupKeys(result.title, result.artist)) {
      const existing = importedSongsLookup.get(key);
      if (existing) {
        return existing;
      }
    }
    return undefined;
  }, [importedSongsLookup]);

  useEffect(() => {
    const trimmedSearch = onlineSearchQuery.trim();

    if (!showOnlineSearchModal || !trimmedSearch) {
      onlineSearchRequestRef.current += 1;
      setOnlineSearchResults([]);
      setOnlineSearchState("idle");
      setOnlineSearchMessage("");
      return;
    }

    if (trimmedSearch.length < MIN_ONLINE_LYRICS_QUERY_LENGTH) {
      onlineSearchRequestRef.current += 1;
      setOnlineSearchResults([]);
      setOnlineSearchState("idle");
      setOnlineSearchMessage(`Type at least ${MIN_ONLINE_LYRICS_QUERY_LENGTH} letters to search online lyrics.`);
      return;
    }

    const requestId = onlineSearchRequestRef.current + 1;
    onlineSearchRequestRef.current = requestId;
    setOnlineSearchState("loading");
    setOnlineSearchMessage("");

    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await searchOnlineSongLyrics(trimmedSearch);
        if (onlineSearchRequestRef.current !== requestId) {
          return;
        }
        setOnlineSearchResults(results);
        setOnlineSearchState("ready");
        setOnlineSearchMessage(results.length === 0 ? "No online lyrics found for this search yet." : "");
      } catch (error) {
        if (onlineSearchRequestRef.current !== requestId) {
          return;
        }
        console.warn("[SongsTab] Online lyrics search failed:", error);
        setOnlineSearchResults([]);
        setOnlineSearchState("error");
        setOnlineSearchMessage(formatOnlineLyricsSearchError(error));
      }
    }, ONLINE_LYRICS_SEARCH_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [onlineSearchQuery, showOnlineSearchModal]);

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

  const handleOpenOnlineImport = useCallback((result: OnlineLyricsSearchResult) => {
    const existingSong = findImportedSong(result);
    if (existingSong) {
      setShowOnlineSearchModal(false);
      setEditSong(existingSong);
      return;
    }
    setPendingOnlineImport(result);
  }, [findImportedSong]);

  const handleOpenOnlineSearch = useCallback(() => {
    setOnlineSearchQuery((current) => current || search.trim());
    setShowOnlineSearchModal(true);
  }, [search]);

  const handleConfirmOnlineImport = useCallback(
    async (result: OnlineLyricsSearchResult, draft: OnlineLyricsImportDraft) => {
      const existingSong = findImportedSong(result);
      if (existingSong) {
        setEditSong(existingSong);
        setPendingOnlineImport(null);
        return;
      }

      const lyrics = draft.lyrics.trim();
      if (!lyrics) {
        return;
      }

      const now = new Date().toISOString();
      const newSong: Song = {
        id: `song-online-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        metadata: {
          title: draft.title.trim() || onlineSearchQuery.trim() || "Imported Song",
          artist: draft.artist.trim(),
        },
        lyrics,
        slides: generateSlides(lyrics, 2, true),
        createdAt: now,
        updatedAt: now,
        importSourceName: result.sourceName,
        importSourceType: "online",
        importSourceUrl: result.url,
      };

      setImportingOnlineId(result.id);
      try {
        await saveSong(newSong);
        await reload();
        setPendingOnlineImport(null);
        setShowOnlineSearchModal(false);
        setSearch(newSong.metadata.title);
      } finally {
        setImportingOnlineId(null);
      }
    },
    [findImportedSong, onlineSearchQuery, reload],
  );

  useEffect(() => {
    const trimmedSearch = onlineSearchQuery.trim();
    const firstResult = onlineSearchResults[0];

    if (
      !showOnlineSearchModal ||
      !isSpotifyTrackLyricsQuery(trimmedSearch)
      || onlineSearchState !== "ready"
      || !firstResult
      || findImportedSong(firstResult)
    ) {
      return;
    }

    const importKey = `${trimmedSearch}::${firstResult.id}`;
    if (spotifyAutoImportRef.current === importKey) {
      return;
    }

    spotifyAutoImportRef.current = importKey;
    setPendingOnlineImport(firstResult);
  }, [findImportedSong, onlineSearchQuery, onlineSearchResults, onlineSearchState, showOnlineSearchModal]);

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
              aria-label="Search songs"
            />
            {search && (
              <button
                type="button"
                className="lib-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear song search"
                title="Clear song search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <button type="button" className="lib-add-btn" onClick={() => setShowAddModal(true)}>
            <Icon name="add" size={20} />
            Add Song
          </button>
          <button type="button" className="lib-archive-btn" onClick={() => setShowArchiveModal(true)}>
            <Icon name="archive" size={18} />
            View Archive
            {archivedSongs.length > 0 && (
              <span className="lib-archive-count">{archivedSongs.length}</span>
            )}
          </button>
        </div>
        <div className="lib-toolbar-actions">
          <button type="button" className="lib-online-search-trigger" onClick={handleOpenOnlineSearch}>
            <Icon name="travel_explore" size={18} />
            Search Online
          </button>
        </div>
      </div>

      {/* Songs list */}
      <div className="lib-songs-list">
        {search.trim() && (
          <div className="lib-song-section-head">
            <span className="lib-song-section-label">Library</span>
            <span className="lib-song-section-note">
              {visible.length} result{visible.length === 1 ? "" : "s"}
            </span>
          </div>
        )}

        {visible.length === 0 &&
          (search.trim() ? (
            <div className="lib-online-status">No library matches for this search.</div>
          ) : (
            <div className="lib-empty">
              <Icon name="music_note" size={48} style={{ opacity: 0.3 }} />
              <p>No songs found</p>
              <button type="button" className="lib-add-btn" onClick={() => setShowAddModal(true)}>
                <Icon name="add" size={20} />
                Add Song
              </button>
            </div>
          ))}

        {visible.length > 0 && (
          <div className="lib-song-grid">
            {visible.map((s) => {
              const lines = firstNLines(s.lyrics, 2);
              return (
                <div className="lib-song-row lib-song-row--card" key={s.id}>
                  <div className="lib-song-card-main">
                    <div className="lib-song-icon">
                      <Icon name="lyrics" size={20} />
                    </div>

                    <div className="lib-song-content">
                      <div className="lib-song-title-row">
                        <h3 className="lib-song-title">{s.metadata.title}</h3>
                        {s.metadata.artist && (
                          <span className="lib-song-artist-badge">{s.metadata.artist}</span>
                        )}
                        {s.importSourceType === "online" && (
                          <span className="lib-song-imported-badge">
                            Imported{s.importSourceName ? ` from ${s.importSourceName}` : ""}
                          </span>
                        )}
                      </div>
                      {lines[0] && <p className="lib-song-lyric-line">{lines[0]}</p>}
                      {lines[1] && <p className="lib-song-lyric-line lib-song-lyric-line--faded">{lines[1]}</p>}
                    </div>
                  </div>

                  <div className="lib-song-meta">
                    <span className="lib-song-slides-badge">
                      {s.slides.length} slide{s.slides.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="lib-song-actions lib-song-actions--card">
                    <button
                      type="button"
                      className="lib-song-action-btn"
                      title="Edit"
                      aria-label={`Edit ${s.metadata.title}`}
                      onClick={() => setEditSong(s)}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      className="lib-song-action-btn lib-song-action-btn--danger"
                      title="Archive"
                      aria-label={`Archive ${s.metadata.title}`}
                      onClick={() => setDeleteConfirmId(s.id)}
                    >
                      <Icon name="archive" size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showOnlineSearchModal && (
        <div className="lib-modal-backdrop" onClick={() => setShowOnlineSearchModal(false)}>
          <div
            className="lib-song-modal lib-online-search-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="online-lyrics-search-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lib-add-modal-header">
              <div>
                <h3 id="online-lyrics-search-title">Search Online Lyrics</h3>
                <p className="lib-online-search-subtitle">Find a song, then review the lyrics before saving it.</p>
              </div>
              <button
                type="button"
                className="lib-modal-close-btn"
                aria-label="Close online lyrics search"
                onClick={() => setShowOnlineSearchModal(false)}
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="lib-song-modal-body lib-online-search-modal-body">
              <div className="lib-search-wrap lib-online-search-wrap">
                <Icon name="search" size={18} className="lib-search-icon" />
                <input
                  className="lib-search-input"
                  type="text"
                  aria-label="Search online lyrics"
                  placeholder="Search title, artist, lyrics, or paste a Spotify track link..."
                  value={onlineSearchQuery}
                  autoFocus
                  onChange={(e) => setOnlineSearchQuery(e.target.value)}
                />
                {onlineSearchQuery && (
                  <button
                    type="button"
                    className="lib-search-clear"
                    onClick={() => setOnlineSearchQuery("")}
                    aria-label="Clear online lyrics search"
                    title="Clear online lyrics search"
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>

              <div className="lib-online-results">
                {onlineSearchState === "loading" && (
                  <div className="lib-online-status">Searching online lyrics…</div>
                )}

                {onlineSearchState !== "loading" && onlineSearchMessage && (
                  <div className={`lib-online-status${onlineSearchState === "error" ? " error" : ""}`}>
                    {onlineSearchMessage}
                  </div>
                )}

                {onlineSearchState === "idle" && !onlineSearchQuery.trim() && (
                  <div className="lib-online-status">Search by song title, artist, lyrics, or Spotify track link.</div>
                )}

                {onlineSearchResults.map((result) => {
                  const importedSong = findImportedSong(result);
                  const actionLabel = importedSong ? "Open" : "Import";
                  const isImporting = importingOnlineId === result.id;

                  return (
                    <div key={result.id} className="lib-online-result-row">
                      <div className="lib-song-icon">
                        <Icon name="lyrics" size={20} />
                      </div>

                      <div className="lib-song-content">
                        <div className="lib-song-title-row">
                          <h3 className="lib-song-title">{result.title}</h3>
                          {result.artist && (
                            <span className="lib-song-artist-badge">{result.artist}</span>
                          )}
                          <span className="lib-song-source-badge">{result.sourceName}</span>
                          {importedSong && <span className="lib-song-imported-badge">Imported</span>}
                        </div>
                        <p className="lib-song-lyric-line">{result.preview || "No preview available yet."}</p>
                      </div>

                      <button
                        type="button"
                        className="lib-online-action"
                        disabled={isImporting}
                        onClick={() => handleOpenOnlineImport(result)}
                      >
                        {isImporting ? "Saving…" : actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

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

      {pendingOnlineImport && (
        <OnlineLyricsImportModal
          result={pendingOnlineImport}
          saving={importingOnlineId === pendingOnlineImport.id}
          onClose={() => setPendingOnlineImport(null)}
          onImport={(draft) => handleConfirmOnlineImport(pendingOnlineImport, draft)}
        />
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
