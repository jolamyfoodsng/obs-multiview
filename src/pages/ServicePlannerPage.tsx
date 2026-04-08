import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { getAllMedia } from "../library/libraryDb";
import type { MediaItem } from "../library/libraryTypes";
import {
  createNewServicePlan,
  deleteServicePlan,
  duplicateServicePlan,
  getAllServicePlans,
  saveServicePlan,
} from "../service-planner/servicePlannerStore";
import {
  createServicePlanItem,
  todayServiceDate,
  type ServicePlan,
  type ServicePlanItem,
  type ServicePlanItemType,
} from "../service-planner/types";
import { generateSlides } from "../worship/slideEngine";
import { getAllSongs } from "../worship/worshipDb";
import type { Song } from "../worship/types";

type CueDraftType = ServicePlanItemType;

interface CueDraft {
  type: CueDraftType;
  bibleReference: string;
  bibleText: string;
  bibleTranslation: string;
  worshipSongId: string;
  worshipSlideId: string;
  sermonKind: "quote" | "point";
  sermonText: string;
  sermonSpeaker: string;
  sermonSeries: string;
  mediaId: string;
  notes: string;
}

const emptyCueDraft: CueDraft = {
  type: "bible",
  bibleReference: "",
  bibleText: "",
  bibleTranslation: "KJV",
  worshipSongId: "",
  worshipSlideId: "",
  sermonKind: "point",
  sermonText: "",
  sermonSpeaker: "",
  sermonSeries: "",
  mediaId: "",
  notes: "",
};

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatPlanDate(value: string): string {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildBibleCue(draft: CueDraft): ServicePlanItem | null {
  const reference = cleanText(draft.bibleReference);
  const text = draft.bibleText.trim();
  const translation = cleanText(draft.bibleTranslation) || "KJV";
  if (!reference || !text) return null;

  const match = reference.match(/^(.+?)\s+(\d+):(\d+)(?:[-–](\d+))?$/);
  const book = match?.[1]?.trim() || reference.replace(/\s+\d+:.+$/, "");
  const chapter = Number(match?.[2] ?? 1);
  const verse = Number(match?.[3] ?? 1);
  const verseEnd = match?.[4] ? Number(match[4]) : undefined;
  const verseRange = verseEnd ? `${verse}-${verseEnd}` : String(verse);

  return createServicePlanItem({
    type: "bible",
    sourceKind: "bible-reference",
    label: reference,
    subtitle: text,
    notes: draft.notes,
    payloadSnapshot: {
      book,
      chapter,
      verse,
      verseEnd,
      verseRange,
      referenceLabel: reference,
      translation,
      verseText: text,
      overlayMode: "fullscreen",
    },
    lastResolvedAt: Date.now(),
  });
}

function buildWorshipCue(draft: CueDraft, songs: Song[]): ServicePlanItem | null {
  const song = songs.find((candidate) => candidate.id === draft.worshipSongId);
  if (!song) return null;
  const slides = song.slides?.length ? song.slides : generateSlides(song.lyrics, 2, true);
  const slide = slides.find((candidate) => candidate.id === draft.worshipSlideId) ?? slides[0];
  if (!slide) return null;

  return createServicePlanItem({
    type: "worship",
    sourceId: song.id,
    sourceKind: "worship-song-section",
    label: song.metadata.title,
    subtitle: `${slide.label} · ${slide.content.split("\n")[0] ?? ""}`,
    notes: draft.notes,
    payloadSnapshot: {
      sectionText: slide.content,
      sectionLabel: slide.label,
      songTitle: song.metadata.title,
      artist: song.metadata.artist,
      overlayMode: "lower-third",
    },
    lastResolvedAt: Date.now(),
  });
}

function buildSermonCue(draft: CueDraft): ServicePlanItem | null {
  const text = draft.sermonText.trim();
  if (!text) return null;
  const isQuote = draft.sermonKind === "quote";
  if (isQuote && !cleanText(draft.sermonSpeaker)) return null;
  const attribution = [draft.sermonSpeaker, draft.sermonSeries].map(cleanText).filter(Boolean).join(" / ");
  const displayText = isQuote ? `“${text}”` : text;

  return createServicePlanItem({
    type: "sermon",
    sourceKind: isQuote ? "sermon-quote" : "sermon-point",
    label: displayText.slice(0, 80),
    subtitle: isQuote ? attribution : "",
    notes: draft.notes,
    payloadSnapshot: {
      text: displayText,
      label: isQuote ? attribution : undefined,
      itemType: draft.sermonKind,
      overlayMode: "lower-third",
    },
    lastResolvedAt: Date.now(),
  });
}

function buildMediaCue(draft: CueDraft, media: MediaItem[]): ServicePlanItem | null {
  const item = media.find((candidate) => candidate.id === draft.mediaId);
  if (!item) return null;
  const filePath = item.filePath || item.url;
  if (!filePath) return null;

  return createServicePlanItem({
    type: "media",
    sourceId: item.id,
    sourceKind: "media-library-item",
    label: item.name,
    subtitle: item.type === "video" ? "Video media" : "Picture media",
    notes: draft.notes,
    payloadSnapshot: {
      filePath,
      fileName: item.diskFileName || item.name,
      mediaType: item.type,
    },
    lastResolvedAt: Date.now(),
  });
}

export default function ServicePlannerPage() {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activePlanId, setActivePlanId] = useState("");
  const [cueDraft, setCueDraft] = useState<CueDraft>(emptyCueDraft);
  const [editingItemId, setEditingItemId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? plans[0] ?? null,
    [activePlanId, plans],
  );
  const selectedSong = songs.find((song) => song.id === cueDraft.worshipSongId);
  const selectedSongSlides = selectedSong
    ? selectedSong.slides?.length ? selectedSong.slides : generateSlides(selectedSong.lyrics, 2, true)
    : [];

  const load = useCallback(async () => {
    const [nextPlans, nextSongs] = await Promise.all([getAllServicePlans(), getAllSongs()]);
    setPlans(nextPlans);
    setSongs(nextSongs);
    setMedia(getAllMedia());
    setActivePlanId((current) => current || nextPlans.find((plan) => plan.status === "active")?.id || nextPlans[0]?.id || "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreatePlan = useCallback(async () => {
    const plan = await createNewServicePlan({
      title: "Sunday Service",
      serviceDate: todayServiceDate(),
      status: "active",
    });
    await load();
    setActivePlanId(plan.id);
    setStatus("Service plan created.");
  }, [load]);

  const handleSavePlan = useCallback(async (plan: ServicePlan) => {
    const saved = await saveServicePlan(plan);
    await load();
    setActivePlanId(saved.id);
    setStatus("Service plan saved.");
  }, [load]);

  const handleAddCue = useCallback(async () => {
    if (!activePlan) return;
    setError("");
    const nextItem =
      cueDraft.type === "bible"
        ? buildBibleCue(cueDraft)
        : cueDraft.type === "worship"
          ? buildWorshipCue(cueDraft, songs)
          : cueDraft.type === "sermon"
            ? buildSermonCue(cueDraft)
            : buildMediaCue(cueDraft, media);

    if (!nextItem) {
      setError("Complete the required cue fields before adding it to the plan.");
      return;
    }

    await handleSavePlan({
      ...activePlan,
      items: [...activePlan.items, nextItem],
      selectedItemId: nextItem.id,
    });
    setCueDraft(emptyCueDraft);
    setEditingItemId(nextItem.id);
  }, [activePlan, cueDraft, handleSavePlan, media, songs]);

  const handleMoveItem = useCallback(async (itemId: string, direction: -1 | 1) => {
    if (!activePlan) return;
    const index = activePlan.items.findIndex((item) => item.id === itemId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= activePlan.items.length) return;
    const items = [...activePlan.items];
    const [item] = items.splice(index, 1);
    items.splice(nextIndex, 0, item);
    await handleSavePlan({ ...activePlan, items });
  }, [activePlan, handleSavePlan]);

  const handlePatchItem = useCallback(async (itemId: string, patch: Partial<ServicePlanItem>) => {
    if (!activePlan) return;
    await handleSavePlan({
      ...activePlan,
      items: activePlan.items.map((item) =>
        item.id === itemId ? { ...item, ...patch, updatedAt: Date.now() } : item,
      ),
    });
  }, [activePlan, handleSavePlan]);

  const handleRemoveItem = useCallback(async (itemId: string) => {
    if (!activePlan) return;
    await handleSavePlan({
      ...activePlan,
      items: activePlan.items.filter((item) => item.id !== itemId),
      completedItemIds: activePlan.completedItemIds.filter((id) => id !== itemId),
      selectedItemId: activePlan.selectedItemId === itemId ? undefined : activePlan.selectedItemId,
    });
  }, [activePlan, handleSavePlan]);

  return (
    <main className="service-planner-page app-page">
      <section className="service-planner-hero">
        <div>
          <p className="app-section-kicker">Service Planner</p>
          <h1>Build the service run-down before you go live.</h1>
          <p>
            Plan Bible verses, worship cues, sermon quotes or points, and media as one ordered list shared with the OBS dock.
          </p>
        </div>
        <button type="button" className="app-button app-button--primary" onClick={handleCreatePlan}>
          <Icon name="add" size={18} />
          New plan
        </button>
      </section>

      <div className="service-planner-layout">
        <aside className="service-planner-list" aria-label="Service plans">
          <div className="service-planner-list__header">
            <span>Plans</span>
            <button type="button" className="app-button app-button--ghost" onClick={() => void load()}>
              Refresh
            </button>
          </div>
          {plans.length === 0 && (
            <div className="service-planner-empty">
              <strong>No plans yet</strong>
              <span>Create a plan, then add cues for the dock operator.</span>
            </div>
          )}
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              className={`service-plan-row${activePlan?.id === plan.id ? " service-plan-row--active" : ""}`}
              onClick={() => setActivePlanId(plan.id)}
            >
              <span className="service-plan-row__title">{plan.title}</span>
              <span className="service-plan-row__meta">
                {formatPlanDate(plan.serviceDate)} · {plan.items.length} cues
              </span>
            </button>
          ))}
        </aside>

        <section className="service-planner-detail">
          {!activePlan ? (
            <div className="service-planner-empty service-planner-empty--large">
              <strong>Create your first service plan</strong>
              <span>The planner will keep the app and dock in sync from one shared store.</span>
              <button type="button" className="app-button app-button--primary" onClick={handleCreatePlan}>
                Create plan
              </button>
            </div>
          ) : (
            <>
              <div className="service-planner-editor">
                <label>
                  <span>Title</span>
                  <input
                    value={activePlan.title}
                    onChange={(event) => handleSavePlan({ ...activePlan, title: event.target.value })}
                  />
                </label>
                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={activePlan.serviceDate}
                    onChange={(event) => handleSavePlan({ ...activePlan, serviceDate: event.target.value })}
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={activePlan.status}
                    onChange={(event) =>
                      handleSavePlan({ ...activePlan, status: event.target.value as ServicePlan["status"] })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <div className="service-planner-editor__actions">
                  <button
                    type="button"
                    className="app-button app-button--secondary"
                    onClick={async () => {
                      const copy = await duplicateServicePlan(activePlan.id);
                      await load();
                      if (copy) setActivePlanId(copy.id);
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--danger"
                    onClick={async () => {
                      await deleteServicePlan(activePlan.id);
                      await load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="service-planner-workspace">
                <div className="service-planner-cues">
                  <div className="service-planner-section-head">
                    <div>
                      <p className="app-section-kicker">Run-down</p>
                      <h2>{activePlan.items.length} cues</h2>
                    </div>
                    <span>Click a cue in the dock to preview. Double-click sends Program.</span>
                  </div>

                  {activePlan.items.length === 0 && (
                    <div className="service-planner-empty">
                      <strong>No cues in this plan</strong>
                      <span>Add Bible, Worship, Sermon, or Media cues from the panel on the right.</span>
                    </div>
                  )}

                  {activePlan.items.map((item, index) => (
                    <article
                      key={item.id}
                      className={`service-cue-card${editingItemId === item.id ? " service-cue-card--editing" : ""}`}
                    >
                      <div className="service-cue-card__index">{index + 1}</div>
                      <div className="service-cue-card__body">
                        <div className="service-cue-card__topline">
                          <span className={`service-cue-card__badge service-cue-card__badge--${item.type}`}>
                            {item.type}
                          </span>
                          <span>{item.sourceKind ?? "snapshot"}</span>
                        </div>
                        <input
                          value={item.label}
                          aria-label="Cue label"
                          onFocus={() => setEditingItemId(item.id)}
                          onChange={(event) => handlePatchItem(item.id, { label: event.target.value })}
                        />
                        <input
                          value={item.subtitle ?? ""}
                          aria-label="Cue subtitle"
                          placeholder="Subtitle"
                          onFocus={() => setEditingItemId(item.id)}
                          onChange={(event) => handlePatchItem(item.id, { subtitle: event.target.value })}
                        />
                        <textarea
                          value={item.notes ?? ""}
                          aria-label="Cue notes"
                          placeholder="Operator notes"
                          onFocus={() => setEditingItemId(item.id)}
                          onChange={(event) => handlePatchItem(item.id, { notes: event.target.value })}
                        />
                      </div>
                      <div className="service-cue-card__actions">
                        <button type="button" onClick={() => handleMoveItem(item.id, -1)} disabled={index === 0}>
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveItem(item.id, 1)}
                          disabled={index === activePlan.items.length - 1}
                        >
                          Down
                        </button>
                        <button type="button" onClick={() => handleRemoveItem(item.id)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <aside className="service-planner-add">
                  <div className="service-planner-section-head">
                    <div>
                      <p className="app-section-kicker">Add cue</p>
                      <h2>Snapshot item</h2>
                    </div>
                  </div>
                  <label>
                    <span>Type</span>
                    <select
                      value={cueDraft.type}
                      onChange={(event) => setCueDraft({ ...emptyCueDraft, type: event.target.value as CueDraftType })}
                    >
                      <option value="bible">Bible</option>
                      <option value="worship">Worship</option>
                      <option value="sermon">Sermon</option>
                      <option value="media">Media</option>
                    </select>
                  </label>

                  {cueDraft.type === "bible" && (
                    <>
                      <label>
                        <span>Reference</span>
                        <input
                          placeholder="John 3:16"
                          value={cueDraft.bibleReference}
                          onChange={(event) => setCueDraft({ ...cueDraft, bibleReference: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Translation</span>
                        <input
                          value={cueDraft.bibleTranslation}
                          onChange={(event) => setCueDraft({ ...cueDraft, bibleTranslation: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Verse text</span>
                        <textarea
                          rows={4}
                          value={cueDraft.bibleText}
                          onChange={(event) => setCueDraft({ ...cueDraft, bibleText: event.target.value })}
                        />
                      </label>
                    </>
                  )}

                  {cueDraft.type === "worship" && (
                    <>
                      <label>
                        <span>Song</span>
                        <select
                          value={cueDraft.worshipSongId}
                          onChange={(event) =>
                            setCueDraft({ ...cueDraft, worshipSongId: event.target.value, worshipSlideId: "" })
                          }
                        >
                          <option value="">Select song</option>
                          {songs.map((song) => (
                            <option key={song.id} value={song.id}>{song.metadata.title}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Section</span>
                        <select
                          value={cueDraft.worshipSlideId}
                          onChange={(event) => setCueDraft({ ...cueDraft, worshipSlideId: event.target.value })}
                        >
                          <option value="">First section</option>
                          {selectedSongSlides.map((slide) => (
                            <option key={slide.id} value={slide.id}>{slide.label}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}

                  {cueDraft.type === "sermon" && (
                    <>
                      <label>
                        <span>Kind</span>
                        <select
                          value={cueDraft.sermonKind}
                          onChange={(event) =>
                            setCueDraft({ ...cueDraft, sermonKind: event.target.value as CueDraft["sermonKind"] })
                          }
                        >
                          <option value="point">Point</option>
                          <option value="quote">Quote</option>
                        </select>
                      </label>
                      {cueDraft.sermonKind === "quote" && (
                        <div className="service-planner-add__row">
                          <label>
                            <span>Speaker</span>
                            <input
                              value={cueDraft.sermonSpeaker}
                              onChange={(event) => setCueDraft({ ...cueDraft, sermonSpeaker: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>Series</span>
                            <input
                              value={cueDraft.sermonSeries}
                              onChange={(event) => setCueDraft({ ...cueDraft, sermonSeries: event.target.value })}
                            />
                          </label>
                        </div>
                      )}
                      <label>
                        <span>{cueDraft.sermonKind === "quote" ? "Quote" : "Point"}</span>
                        <textarea
                          rows={5}
                          value={cueDraft.sermonText}
                          onChange={(event) => setCueDraft({ ...cueDraft, sermonText: event.target.value })}
                        />
                      </label>
                    </>
                  )}

                  {cueDraft.type === "media" && (
                    <label>
                      <span>Media item</span>
                      <select
                        value={cueDraft.mediaId}
                        onChange={(event) => setCueDraft({ ...cueDraft, mediaId: event.target.value })}
                      >
                        <option value="">Select media</option>
                        {media.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label>
                    <span>Notes</span>
                    <textarea
                      rows={3}
                      value={cueDraft.notes}
                      onChange={(event) => setCueDraft({ ...cueDraft, notes: event.target.value })}
                    />
                  </label>

                  {error && <div className="service-planner-inline-error">{error}</div>}
                  {status && <div className="service-planner-inline-status">{status}</div>}

                  <button type="button" className="app-button app-button--primary" onClick={handleAddCue}>
                    Add cue
                  </button>
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
