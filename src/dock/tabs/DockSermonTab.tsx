/**
 * DockSermonTab.tsx — Quote / Point cue lists for the Ministry dock.
 *
 * Replaces the old message-details form with a Worship-like list/detail flow:
 * create a Quote or Point list, then manage slides that can be previewed or
 * sent live with the standard single-click / double-click interaction.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DockStagedItem } from "../dockTypes";
import { dockObsClient } from "../dockObsClient";
import type { BibleTheme } from "../../bible/types";
import { getVoiceBibleSettings } from "../../services/voiceBibleSettings";
import DockBibleThemePicker from "../components/DockBibleThemePicker";
import Icon from "../DockIcon";

const STORAGE_KEY = "ocs-dock-sermon-items-v1";
const OLD_STORAGE_KEY = "ocs-dock-sermon";
const VIEW_PREFS_KEY = "ocs-dock-sermon-view-v1";

type SermonItemType = "quote" | "point";
type OverlayMode = "fullscreen" | "lower-third";

interface SermonSlide {
  id: string;
  content: string;
  fontWeight?: "normal" | "bold";
  fontSizeDelta?: number;
  uppercase?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SermonItem {
  id: string;
  type: SermonItemType;
  topic: string;
  speakerName: string | null;
  seriesName: string | null;
  themeTag: "general";
  slides: SermonSlide[];
  createdAt: number;
  updatedAt: number;
}

interface ItemDraft {
  type: SermonItemType;
  content: string;
  speakerName: string;
  topic: string;
  seriesName: string;
}

interface ItemModalState {
  mode: "create" | "edit";
  itemId?: string;
  draft: ItemDraft;
}

interface SlideModalState {
  mode: "create" | "edit";
  itemId: string;
  slideId?: string;
  content: string;
  fontWeight: "normal" | "bold";
  fontSizeDelta: number;
  uppercase: boolean;
}

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function quoteText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const withoutWrappingQuotes = trimmed.replace(/^[“”"']+|[“”"']+$/g, "").trim();
  return `“${withoutWrappingQuotes}”`;
}

function attributionFor(item: SermonItem): string {
  if (item.type !== "quote") return "";
  return [item.speakerName, item.seriesName].filter(Boolean).join(" / ");
}

function displaySlideText(item: SermonItem, slide: SermonSlide): string {
  const text = item.type === "quote" ? quoteText(slide.content) : slide.content.trim();
  return slide.uppercase ? text.toUpperCase() : text;
}

function pointTopicFromContent(content: string): string {
  const firstLine = content
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean) ?? "Point";
  return firstLine.length > 56 ? `${firstLine.slice(0, 53).trim()}...` : firstLine;
}

function makeDraft(type: SermonItemType = "quote"): ItemDraft {
  return {
    type,
    content: "",
    speakerName: "",
    topic: "",
    seriesName: "",
  };
}

function makeItemFromDraft(draft: ItemDraft, existing?: SermonItem): SermonItem {
  const now = Date.now();
  const content = draft.content.trim();
  const firstSlide = existing?.slides[0];
  const slides = existing?.slides.length
    ? existing.slides.map((slide, index) =>
      index === 0
        ? { ...slide, content, updatedAt: now }
        : slide,
    )
    : [{ id: createId("sermon-slide"), content, createdAt: now, updatedAt: now }];

  return {
    id: existing?.id ?? createId("sermon-item"),
    type: draft.type,
    topic: draft.type === "quote" ? draft.topic.trim() : pointTopicFromContent(content),
    speakerName: draft.type === "quote" ? draft.speakerName.trim() : null,
    seriesName: draft.type === "quote" ? (draft.seriesName.trim() || null) : null,
    themeTag: "general",
    slides: firstSlide ? slides : slides.filter((slide) => slide.content.trim()),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function isSermonItem(value: unknown): value is SermonItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SermonItem>;
  return Boolean(
    typeof item.id === "string" &&
    (item.type === "quote" || item.type === "point") &&
    typeof item.topic === "string" &&
    Array.isArray(item.slides),
  );
}

function loadItems(): SermonItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isSermonItem);
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return [];
    const oldData = JSON.parse(raw) as {
      title?: string;
      series?: string;
      speaker?: string;
      points?: Array<{ id?: string; text?: string; type?: SermonItemType; attribution?: string }>;
    };
    const points = Array.isArray(oldData.points) ? oldData.points : [];
    if (!oldData.title && points.length === 0) return [];
    const now = Date.now();
    const type: SermonItemType = points.some((point) => point.type === "quote") ? "quote" : "point";
    return [{
      id: createId("sermon-item"),
      type,
      topic: oldData.title || "Imported sermon notes",
      speakerName: type === "quote" ? (oldData.speaker || points.find((point) => point.attribution)?.attribution || null) : null,
      seriesName: type === "quote" ? (oldData.series || null) : null,
      themeTag: "general",
      slides: points.length > 0
        ? points.map((point) => ({
          id: point.id || createId("sermon-slide"),
          content: normalizeText(point.text),
          createdAt: now,
          updatedAt: now,
        })).filter((slide) => slide.content)
        : [{
          id: createId("sermon-slide"),
          content: oldData.title || "Imported sermon notes",
          createdAt: now,
          updatedAt: now,
        }],
      createdAt: now,
      updatedAt: now,
    }];
  } catch {
    return [];
  }
}

function saveItems(items: SermonItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* ignore OBS CEF storage failures */ }
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function validateDraft(draft: ItemDraft): string {
  if (!draft.content.trim()) return draft.type === "quote" ? "Quote text is required." : "Point text is required.";
  if (draft.type === "quote" && !draft.topic.trim()) return "Topic / message title is required.";
  if (draft.type === "quote" && !draft.speakerName.trim()) return "Speaker name is required for quotes.";
  return "";
}

function loadViewPrefs(): { activeItemId: string | null; selectedSlideId: string | null; overlayMode: OverlayMode } {
  try {
    const parsed = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || "{}") as {
      activeItemId?: unknown;
      selectedSlideId?: unknown;
      overlayMode?: unknown;
    };
    return {
      activeItemId: typeof parsed.activeItemId === "string" ? parsed.activeItemId : null,
      selectedSlideId: typeof parsed.selectedSlideId === "string" ? parsed.selectedSlideId : null,
      overlayMode: parsed.overlayMode === "fullscreen" ? "fullscreen" : "lower-third",
    };
  } catch {
    return { activeItemId: null, selectedSlideId: null, overlayMode: "lower-third" };
  }
}

function saveViewPrefs(activeItemId: string | null, selectedSlideId: string | null, overlayMode: OverlayMode): void {
  try {
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify({ activeItemId, selectedSlideId, overlayMode }));
  } catch { /* ignore OBS CEF storage failures */ }
}

function clampFontSizeDelta(value: number): number {
  return Math.max(-20, Math.min(172, value));
}

function slideFontSizeValue(slide: SermonSlide): number {
  return Math.max(10, Math.min(200, 28 + (slide.fontSizeDelta ?? 0)));
}

function fontSizeDeltaFromValue(value: number): number {
  return clampFontSizeDelta(Math.round(value) - 28);
}

function getSlideStyleOverrides(slide: SermonSlide, theme: BibleTheme | null): Record<string, unknown> | null {
  const overrides: Record<string, unknown> = {};
  if (slide.fontWeight) {
    overrides.fontWeight = slide.fontWeight;
    overrides.refFontWeight = slide.fontWeight;
  }
  if (slide.uppercase) {
    overrides.textTransform = "uppercase";
  }

  const delta = slide.fontSizeDelta ?? 0;
  if (delta !== 0 && theme?.settings) {
    const baseFontSize = theme.settings.fontSize;
    const baseRefFontSize = theme.settings.refFontSize;
    if (Number.isFinite(baseFontSize)) {
      overrides.fontSize = Math.max(10, Math.round(baseFontSize + delta));
    }
    if (Number.isFinite(baseRefFontSize)) {
      overrides.refFontSize = Math.max(8, Math.round(baseRefFontSize + Math.round(delta * 0.55)));
    }
  }

  return Object.keys(overrides).length ? overrides : null;
}

function looksLikeEmbeddingModel(model: string): boolean {
  return /\b(embed|embedding|bge|e5|nomic-embed|text-embedding)\b/i.test(model);
}

async function correctSermonSlideText(text: string): Promise<string> {
  const settings = await getVoiceBibleSettings();
  const baseUrl = settings.ollamaBaseUrl?.trim();
  const model =
    settings.ollamaNormalizerModel?.trim() ||
    (settings.ollamaModel?.trim() && !looksLikeEmbeddingModel(settings.ollamaModel) ? settings.ollamaModel.trim() : "");

  if (!baseUrl || !model || looksLikeEmbeddingModel(model)) {
    throw new Error("No Ollama text model is configured for spelling correction.");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        prompt: [
          "Correct spelling, casing, and punctuation in this sermon slide.",
          "Keep the meaning and line breaks. Do not add commentary.",
          "Return only the corrected text.",
          "",
          text,
        ].join("\n"),
        options: {
          temperature: 0,
          top_p: 0.05,
          num_predict: Math.max(64, Math.min(320, Math.round(text.length * 1.35))),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Spelling correction failed with ${response.status}`);
    }

    const payload = await response.json() as { response?: string };
    const corrected = (payload.response || "")
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    return corrected || text;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function DockSermonTab({ staged, onStage }: Props) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewPrefsRef = useRef(loadViewPrefs());
  const [items, setItems] = useState<SermonItem[]>(() => loadItems());
  const [activeItemId, setActiveItemId] = useState<string | null>(() => viewPrefsRef.current.activeItemId);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(() => viewPrefsRef.current.selectedSlideId);
  const [itemModal, setItemModal] = useState<ItemModalState | null>(null);
  const [slideModal, setSlideModal] = useState<SlideModalState | null>(null);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [sending, setSending] = useState(false);
  const [correctingSlideText, setCorrectingSlideText] = useState(false);
  const [showSlideSettings, setShowSlideSettings] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(() => viewPrefsRef.current.overlayMode);
  const [fullscreenTheme, setFullscreenTheme] = useState<BibleTheme | null>(null);
  const [lowerThirdTheme, setLowerThirdTheme] = useState<BibleTheme | null>(null);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) ?? null,
    [activeItemId, items],
  );
  const activeSelectedSlide = useMemo(
    () => activeItem?.slides.find((slide) => slide.id === selectedSlideId) ?? null,
    [activeItem, selectedSlideId],
  );
  const stagedSermonData = staged?.type === "sermon" && staged.data && typeof staged.data === "object"
    ? staged.data as Record<string, unknown>
    : null;
  const isProgramLive = staged?.type === "sermon" && Boolean(stagedSermonData?._dockLive);
  const activeTheme = overlayMode === "fullscreen" ? fullscreenTheme : lowerThirdTheme;
  const activeThemeTemplate: BibleTheme["templateType"] = overlayMode === "fullscreen" ? "fullscreen" : "lower-third";

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    if (!activeItemId) return;
    const active = items.find((item) => item.id === activeItemId);
    if (!active) {
      setActiveItemId(null);
      setSelectedSlideId(null);
      return;
    }
    if (selectedSlideId && !active.slides.some((slide) => slide.id === selectedSlideId)) {
      setSelectedSlideId(active.slides[0]?.id ?? null);
    }
  }, [activeItemId, items, selectedSlideId]);

  useEffect(() => {
    saveViewPrefs(activeItemId, selectedSlideId, overlayMode);
  }, [activeItemId, overlayMode, selectedSlideId]);

  useEffect(() => {
    if (!activeSelectedSlide) {
      setShowSlideSettings(false);
    }
  }, [activeSelectedSlide]);

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  const openCreateModal = useCallback(() => {
    setFormError("");
    setItemModal({ mode: "create", draft: makeDraft("quote") });
  }, []);

  const openEditItemModal = useCallback((item: SermonItem) => {
    setFormError("");
    setItemModal({
      mode: "edit",
      itemId: item.id,
      draft: {
        type: item.type,
        content: item.slides[0]?.content ?? "",
        speakerName: item.speakerName ?? "",
        topic: item.topic,
        seriesName: item.seriesName ?? "",
      },
    });
  }, []);

  const closeItemModal = useCallback(() => {
    setFormError("");
    setItemModal(null);
  }, []);

  const saveItemModal = useCallback(() => {
    if (!itemModal) return;
    const error = validateDraft(itemModal.draft);
    if (error) {
      setFormError(error);
      return;
    }

    const existing = itemModal.itemId ? items.find((item) => item.id === itemModal.itemId) : undefined;
    const nextItem = makeItemFromDraft(itemModal.draft, existing);
    setItems((current) => {
      if (existing) return current.map((item) => (item.id === existing.id ? nextItem : item));
      return [nextItem, ...current];
    });
    setActiveItemId(nextItem.id);
    setSelectedSlideId(nextItem.slides[0]?.id ?? null);
    setFormError("");
    setItemModal(null);
  }, [itemModal, items]);

  const deleteItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
    setActiveItemId((current) => (current === itemId ? null : current));
    setSelectedSlideId(null);
    if (staged?.type === "sermon" && stagedSermonData?.itemId === itemId) {
      onStage(null);
    }
  }, [onStage, staged, stagedSermonData]);

  const openSlideModal = useCallback((item: SermonItem, slide?: SermonSlide) => {
    setFormError("");
    setSlideModal({
      mode: slide ? "edit" : "create",
      itemId: item.id,
      slideId: slide?.id,
      content: slide?.content ?? "",
      fontWeight: slide?.fontWeight ?? "bold",
      fontSizeDelta: slide?.fontSizeDelta ?? 0,
      uppercase: Boolean(slide?.uppercase),
    });
  }, []);

  const closeSlideModal = useCallback(() => {
    setFormError("");
    setSlideModal(null);
  }, []);

  const saveSlideModal = useCallback(() => {
    if (!slideModal) return;
    const content = slideModal.content.trim();
    if (!content) {
      setFormError("Slide text is required.");
      return;
    }

    const now = Date.now();
    let nextSlideId = slideModal.slideId ?? "";
    setItems((current) => current.map((item) => {
      if (item.id !== slideModal.itemId) return item;
      if (slideModal.mode === "edit" && slideModal.slideId) {
        return {
          ...item,
          slides: item.slides.map((slide) =>
            slide.id === slideModal.slideId
              ? {
                ...slide,
                content,
                fontWeight: slideModal.fontWeight,
                fontSizeDelta: slideModal.fontSizeDelta,
                uppercase: slideModal.uppercase,
                updatedAt: now,
              }
              : slide,
          ),
          updatedAt: now,
        };
      }

      nextSlideId = createId("sermon-slide");
      return {
        ...item,
        slides: [
          ...item.slides,
          {
            id: nextSlideId,
            content,
            fontWeight: slideModal.fontWeight,
            fontSizeDelta: slideModal.fontSizeDelta,
            uppercase: slideModal.uppercase,
            createdAt: now,
            updatedAt: now,
          },
        ],
        updatedAt: now,
      };
    }));
    setSelectedSlideId(nextSlideId);
    setFormError("");
    setSlideModal(null);
  }, [slideModal]);

  const updateSlideModal = useCallback((updates: Partial<SlideModalState>) => {
    setFormError("");
    setSlideModal((current) => current ? { ...current, ...updates } : current);
  }, []);

  const handleCorrectSlideText = useCallback(async () => {
    if (!slideModal || correctingSlideText) return;
    const content = slideModal.content.trim();
    if (!content) {
      setFormError("Add slide text before checking spelling.");
      return;
    }

    setCorrectingSlideText(true);
    setFormError("");
    try {
      const corrected = await correctSermonSlideText(content);
      setSlideModal((current) => current ? { ...current, content: corrected } : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Spelling correction failed.";
      setFormError(message);
    } finally {
      setCorrectingSlideText(false);
    }
  }, [correctingSlideText, slideModal]);

  const updateSelectedSlideFormatting = useCallback((patch: Partial<Pick<SermonSlide, "fontWeight" | "fontSizeDelta" | "uppercase">>) => {
    if (!activeItemId || !selectedSlideId) return;
    const now = Date.now();
    setItems((current) => current.map((item) => {
      if (item.id !== activeItemId) return item;
      return {
        ...item,
        slides: item.slides.map((slide) =>
          slide.id === selectedSlideId
            ? {
              ...slide,
              ...patch,
              fontSizeDelta: typeof patch.fontSizeDelta === "number"
                ? clampFontSizeDelta(patch.fontSizeDelta)
                : slide.fontSizeDelta,
              updatedAt: now,
            }
            : slide,
        ),
        updatedAt: now,
      };
    }));
  }, [activeItemId, selectedSlideId]);

  const pushSlide = useCallback(async (item: SermonItem, slide: SermonSlide, live: boolean) => {
    if (!slide.content.trim()) return;
    const displayText = displaySlideText(item, slide);
    const attribution = attributionFor(item);
    const subtitle = item.type === "quote" ? attribution : "";
    const themeSettings = (activeTheme?.settings as Record<string, unknown> | undefined) ?? null;
    const liveOverrides = getSlideStyleOverrides(slide, activeTheme);

    setSelectedSlideId(slide.id);
    setActionError("");
    onStage({
      type: "sermon",
      label: displayText,
      subtitle,
      data: {
        itemId: item.id,
        slideId: slide.id,
        itemType: item.type,
        topic: item.topic,
        speakerName: item.speakerName,
        seriesName: item.seriesName,
        content: slide.content,
        overlayMode,
        bibleThemeId: activeTheme?.id ?? null,
        bibleThemeSettings: themeSettings,
        liveOverrides,
        _dockLive: live,
      },
    });

    if (!dockObsClient.isConnected) return;

    setSending(true);
    try {
      await dockObsClient.pushSermonCue({
        text: displayText,
        label: subtitle || undefined,
        topic: item.type === "quote" ? item.topic : undefined,
        itemType: item.type,
        overlayMode,
        bibleThemeSettings: themeSettings,
        liveOverrides,
      }, live);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[DockSermonTab] ${live ? "Go live" : "Send preview"} failed:`, error);
      setActionError(message);
    } finally {
      setSending(false);
    }
  }, [activeTheme, onStage, overlayMode]);

  const handlePreviewSlide = useCallback((item: SermonItem, slide: SermonSlide) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void pushSlide(item, slide, false);
    }, 220);
  }, [pushSlide]);

  const handleProgramSlide = useCallback((item: SermonItem, slide: SermonSlide) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void pushSlide(item, slide, true);
  }, [pushSlide]);

  const renderListPage = () => (
    <div className="dock-sermon-view">
      <div className="dock-sermon-toolbar">
        <div>
          <div className="dock-section-label">Sermon</div>
          <div className="dock-sermon-title">Quotes & Points</div>
        </div>
        <button type="button" className="dock-btn dock-btn--primary" onClick={openCreateModal}>
          <Icon name="add" size={14} />
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <div className="dock-empty dock-sermon-empty">
          <Icon name="format_quote" size={20} />
          <div className="dock-empty__title">No sermon cues yet</div>
          <div className="dock-empty__text">Add a quote or point list to build slides for live use.</div>
          <button type="button" className="dock-btn dock-btn--preview" onClick={openCreateModal}>
            Add Quote / Point
          </button>
        </div>
      ) : (
        <div className="dock-sermon-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="dock-sermon-item"
              onClick={() => {
                setActiveItemId(item.id);
                setSelectedSlideId(item.slides[0]?.id ?? null);
              }}
            >
              <span className={`dock-sermon-item__type dock-sermon-item__type--${item.type}`}>
                {item.type === "quote" ? "Quote" : "Point"}
              </span>
              <span className="dock-sermon-item__main">
                <span className="dock-sermon-item__topic">{item.topic}</span>
                <span className="dock-sermon-item__meta">
                  {item.type === "quote"
                    ? [item.speakerName, item.seriesName].filter(Boolean).join(" / ")
                    : `${item.slides.length} point slide${item.slides.length === 1 ? "" : "s"}`}
                  {item.updatedAt ? ` · ${formatDate(item.updatedAt)}` : ""}
                </span>
              </span>
              <span className="dock-sermon-item__count">{item.slides.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderDetailPage = () => {
    if (!activeItem) return renderListPage();
    const activeAttribution = attributionFor(activeItem);
    const selectedSlide = activeSelectedSlide;

    return (
      <div className="dock-sermon-view dock-sermon-view--detail">
        <div className="dock-sermon-main">
          <div className="dock-sermon-detail-head">
            <button type="button" className="dock-sermon-back" onClick={() => setActiveItemId(null)} aria-label="Back to sermon list">
              <Icon name="arrow_back" size={13} />
            </button>
            <div className="dock-sermon-detail-head__copy">
              <div className="dock-section-label">{activeItem.type === "quote" ? "Quote list" : "Point list"}</div>
              <div className="dock-sermon-title">{activeItem.topic}</div>
              {activeItem.type === "quote" && activeAttribution && (
                <div className="dock-sermon-detail-head__meta">{activeAttribution}</div>
              )}
            </div>
            <div className="dock-sermon-detail-head__actions">
              <button type="button" className="dock-lyric-card__action" onClick={() => openEditItemModal(activeItem)} aria-label="Edit sermon item">
                <Icon name="edit" size={12} />
              </button>
              <button type="button" className="dock-lyric-card__action" onClick={() => deleteItem(activeItem.id)} aria-label="Delete sermon item">
                <Icon name="close" size={12} />
              </button>
            </div>
          </div>

          <div className="dock-cue-hint">
            Click a slide to Preview. Double-click to Program. Hover for Edit. Add cues as the message progresses.
          </div>

          <div className="dock-sermon-slide-list">
            {activeItem.slides.length === 0 ? (
              <div className="dock-empty dock-sermon-empty">
                <Icon name={activeItem.type === "quote" ? "format_quote" : "checklist"} size={20} />
                <div className="dock-empty__title">No cues inside this list</div>
                <div className="dock-empty__text">Add the first cue to begin sending sermon content.</div>
              </div>
            ) : activeItem.slides.map((slide, index) => {
              const isSelected = selectedSlideId === slide.id;
              const isLive = isSelected && isProgramLive;
              return (
                <div
                  key={slide.id}
                  className={`dock-sermon-slide${isSelected ? " dock-sermon-slide--active" : ""}${isLive ? " dock-sermon-slide--live" : ""}${slide.fontWeight === "normal" ? " dock-sermon-slide--normal" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handlePreviewSlide(activeItem, slide)}
                  onDoubleClick={() => handleProgramSlide(activeItem, slide)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handlePreviewSlide(activeItem, slide);
                    }
                  }}
                >
                  <div className="dock-sermon-slide__index">{index + 1}</div>
                  <div className="dock-sermon-slide__copy">
                    <div className="dock-sermon-slide__text">{displaySlideText(activeItem, slide)}</div>
                    {activeItem.type === "quote" && activeAttribution && (
                      <div className="dock-sermon-slide__meta">{activeAttribution}</div>
                    )}
                  </div>
                  <div className="dock-lyric-card__actions">
                    <button
                      type="button"
                      className="dock-lyric-card__action"
                      onClick={(event) => {
                        event.stopPropagation();
                        openSlideModal(activeItem, slide);
                      }}
                      aria-label="Edit slide"
                    >
                      <Icon name="edit" size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {actionError && <div className="dock-dialog__error">{actionError}</div>}
          {sending && <div className="dock-dialog__status">Sending...</div>}
        </div>

        <div className="dock-sermon-bottom-deck">
          {showSlideSettings && selectedSlide && (
            <div className="dock-sermon-bottom-settings-panel" aria-label="Selected cue text settings">
              <div className="dock-sermon-bottom-settings-row">
                <span className="dock-worship-inline-control__label">Text</span>
                <div className="dock-console-segmented dock-console-segmented--compact" role="group" aria-label="Selected cue text weight">
                  <button
                    type="button"
                    className={`dock-console-segmented__item${selectedSlide.fontWeight !== "normal" ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => updateSelectedSlideFormatting({ fontWeight: "bold" })}
                  >
                    Bold
                  </button>
                  <button
                    type="button"
                    className={`dock-console-segmented__item${selectedSlide.fontWeight === "normal" ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => updateSelectedSlideFormatting({ fontWeight: "normal" })}
                  >
                    Normal
                  </button>
                </div>
                <div className="dock-console-segmented dock-console-segmented--compact" role="group" aria-label="Selected cue text case">
                  <button
                    type="button"
                    className={`dock-console-segmented__item${!selectedSlide.uppercase ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => updateSelectedSlideFormatting({ uppercase: false })}
                  >
                    Aa
                  </button>
                  <button
                    type="button"
                    className={`dock-console-segmented__item${selectedSlide.uppercase ? " dock-console-segmented__item--active" : ""}`}
                    onClick={() => updateSelectedSlideFormatting({ uppercase: true })}
                  >
                    AA
                  </button>
                </div>
              </div>
              <div className="dock-sermon-bottom-settings-row dock-sermon-bottom-settings-row--size">
                <span className="dock-worship-inline-control__label">Size</span>
                <input
                  className="dock-theme-quick__range dock-sermon-size-slider"
                  type="range"
                  min={10}
                  max={200}
                  step={1}
                  value={slideFontSizeValue(selectedSlide)}
                  onChange={(event) =>
                    updateSelectedSlideFormatting({
                      fontSizeDelta: fontSizeDeltaFromValue(Number(event.target.value)),
                    })
                  }
                  aria-label="Selected cue font size"
                />
                <span className="dock-sermon-size-readout">{slideFontSizeValue(selectedSlide)}px</span>
              </div>
            </div>
          )}

          <div className="dock-sermon-theme-row">
            <span className="dock-worship-inline-control__label">Mode</span>
            <div className="dock-console-segmented" role="group" aria-label="Sermon overlay mode">
              <button
                type="button"
                className={overlayMode === "fullscreen" ? "active" : ""}
                onClick={() => setOverlayMode("fullscreen")}
              >
                Full
              </button>
              <button
                type="button"
                className={overlayMode === "lower-third" ? "active" : ""}
                onClick={() => setOverlayMode("lower-third")}
              >
                LT
              </button>
            </div>
            <DockBibleThemePicker
              selectedThemeId={activeTheme?.id ?? null}
              onSelect={overlayMode === "fullscreen" ? setFullscreenTheme : setLowerThirdTheme}
              label=""
              templateType={activeThemeTemplate}
              allowedCategories={["general"]}
              browserTitle="Select General Theme"
              sampleText={activeItem.type === "quote" ? "Quote" : "Point"}
              sampleReference={activeItem.type === "quote" ? activeAttribution || "Speaker" : ""}
            />
          </div>

          <div className="dock-sermon-bottom-actions">
            <button type="button" className="dock-btn dock-btn--preview dock-btn--block" onClick={() => openSlideModal(activeItem)}>
              <Icon name="add" size={14} />
              {activeItem.type === "quote" ? "Add Quote" : "Add Point"}
            </button>
            <button
              type="button"
              className={`dock-sermon-bottom-settings-trigger${showSlideSettings ? " dock-sermon-bottom-settings-trigger--active" : ""}`}
              onClick={() => setShowSlideSettings((value) => !value)}
              disabled={!selectedSlide}
              aria-label="Open selected cue text settings"
              title={selectedSlide ? "Selected cue text settings" : "Select a cue first"}
            >
              <Icon name="settings" size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {activeItem ? renderDetailPage() : renderListPage()}

      {itemModal && (
        <div className="dock-dialog-backdrop" role="presentation">
          <div className="dock-dialog" role="dialog" aria-modal="true" aria-labelledby="dock-sermon-item-title">
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">{itemModal.mode === "edit" ? "Edit Sermon Cue" : "Add Sermon Cue"}</div>
                <h2 id="dock-sermon-item-title" className="dock-dialog__title">Quote or point list</h2>
              </div>
              <button type="button" className="dock-dialog__close" onClick={closeItemModal} aria-label="Close sermon cue dialog">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <div className="dock-sermon-type-toggle" role="group" aria-label="Sermon cue type">
                {(["quote", "point"] as SermonItemType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`dock-theme-pill${itemModal.draft.type === type ? " dock-theme-pill--active" : ""}`}
                    onClick={() => {
                      setFormError("");
                      setItemModal((current) => current ? {
                        ...current,
                        draft: {
                          ...current.draft,
                          type,
                          speakerName: type === "point" ? "" : current.draft.speakerName,
                          seriesName: type === "point" ? "" : current.draft.seriesName,
                        },
                      } : current);
                    }}
                  >
                    {type === "quote" ? "Quote" : "Point"}
                  </button>
                ))}
              </div>

              {itemModal.draft.type === "quote" && (
                <div className="dock-sermon-quote-meta-row">
                  <label className="dock-dialog-field">
                    <span>Speaker name</span>
                    <input
                      className="dock-input"
                      value={itemModal.draft.speakerName}
                      onChange={(event) => setItemModal((current) => current ? {
                        ...current,
                        draft: { ...current.draft, speakerName: event.target.value },
                      } : current)}
                    />
                  </label>
                  <label className="dock-dialog-field">
                    <span>Topic / message title</span>
                    <input
                      className="dock-input"
                      value={itemModal.draft.topic}
                      onChange={(event) => setItemModal((current) => current ? {
                        ...current,
                        draft: { ...current.draft, topic: event.target.value },
                      } : current)}
                    />
                  </label>
                </div>
              )}

              {itemModal.draft.type === "quote" && (
                <label className="dock-dialog-field">
                  <span>Series name optional</span>
                  <input
                    className="dock-input"
                    value={itemModal.draft.seriesName}
                    onChange={(event) => setItemModal((current) => current ? {
                      ...current,
                      draft: { ...current.draft, seriesName: event.target.value },
                    } : current)}
                  />
                </label>
              )}

              <label className="dock-dialog-field">
                <span>{itemModal.draft.type === "quote" ? "Quote text" : "Point text"}</span>
                <textarea
                  className="dock-input dock-dialog-textarea dock-dialog-textarea--short"
                  value={itemModal.draft.content}
                  onChange={(event) => setItemModal((current) => current ? {
                    ...current,
                    draft: { ...current.draft, content: event.target.value },
                  } : current)}
                />
              </label>

              {formError && <div className="dock-dialog__error">{formError}</div>}
            </div>
            <div className="dock-dialog__footer">
              <button type="button" className="dock-btn dock-btn--ghost" onClick={closeItemModal}>Cancel</button>
              <button type="button" className="dock-btn dock-btn--primary" onClick={saveItemModal}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {slideModal && (
        <div className="dock-dialog-backdrop" role="presentation">
          <div className="dock-dialog dock-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="dock-sermon-slide-title">
            <div className="dock-dialog__header">
              <div>
                <div className="dock-dialog__eyebrow">{slideModal.mode === "edit" ? "Edit Slide" : "Add Slide"}</div>
                <h2 id="dock-sermon-slide-title" className="dock-dialog__title">Sermon slide text</h2>
              </div>
              <div className="dock-sermon-slide-tools" aria-label="Slide text tools">
                <button
                  type="button"
                  className={`dock-sermon-tool-button${slideModal.fontWeight === "bold" ? " dock-sermon-tool-button--active" : ""}`}
                  onClick={() => updateSlideModal({ fontWeight: "bold" })}
                  aria-label="Bold text"
                  title="Bold"
                >
                  B
                </button>
                <button
                  type="button"
                  className={`dock-sermon-tool-button${slideModal.fontWeight === "normal" ? " dock-sermon-tool-button--active" : ""}`}
                  onClick={() => updateSlideModal({ fontWeight: "normal" })}
                  aria-label="Normal text"
                  title="Normal"
                >
                  N
                </button>
                <button
                  type="button"
                  className="dock-sermon-tool-button"
                  onClick={() => updateSlideModal({ fontSizeDelta: clampFontSizeDelta(slideModal.fontSizeDelta - 2) })}
                  aria-label="Decrease font size"
                  title="Decrease font size"
                >
                  A-
                </button>
                <button
                  type="button"
                  className="dock-sermon-tool-button"
                  onClick={() => updateSlideModal({ fontSizeDelta: clampFontSizeDelta(slideModal.fontSizeDelta + 2) })}
                  aria-label="Increase font size"
                  title="Increase font size"
                >
                  A+
                </button>
                <button
                  type="button"
                  className={`dock-sermon-tool-button${slideModal.uppercase ? " dock-sermon-tool-button--active" : ""}`}
                  onClick={() => updateSlideModal({ uppercase: !slideModal.uppercase })}
                  aria-label="Toggle uppercase"
                  title="Uppercase"
                >
                  AA
                </button>
                <button
                  type="button"
                  className="dock-sermon-tool-button dock-sermon-tool-button--icon"
                  onClick={() => void handleCorrectSlideText()}
                  disabled={correctingSlideText}
                  aria-label="Check spelling with LLM"
                  title="Check spelling"
                >
                  <Icon name={correctingSlideText ? "sync" : "preview"} size={12} />
                </button>
              </div>
              <button type="button" className="dock-dialog__close" onClick={closeSlideModal} aria-label="Close sermon slide dialog">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="dock-dialog__body">
              <label className="dock-dialog-field">
                <span>Slide text</span>
                <textarea
                  className="dock-input dock-dialog-textarea dock-dialog-textarea--short"
                  spellCheck
                  value={slideModal.content}
                  onChange={(event) => setSlideModal((current) => current ? { ...current, content: event.target.value } : current)}
                />
              </label>
              {formError && <div className="dock-dialog__error">{formError}</div>}
            </div>
            <div className="dock-dialog__footer">
              <button type="button" className="dock-btn dock-btn--ghost" onClick={closeSlideModal}>Cancel</button>
              <button type="button" className="dock-btn dock-btn--primary" onClick={saveSlideModal}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
