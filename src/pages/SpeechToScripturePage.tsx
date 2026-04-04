import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPassage } from "../bible/bibleData";
import { getInstalledTranslations } from "../bible/bibleDb";
import { bibleObsService } from "../bible/bibleObsService";
import { useBible } from "../bible/bibleStore";
import type { BiblePassage } from "../bible/types";
import { dockObsClient } from "../dock/dockObsClient";
import { ensureDockObsClientConnected } from "../services/dockObsInterop";
import { voiceBibleService } from "../services/voiceBibleService";
import { getVoiceBibleSettings, listAudioInputDevices, listObsAudioInputs, saveVoiceBibleSettings } from "../services/voiceBibleSettings";
import type { VoiceBibleInputOption, VoiceBibleSnapshot } from "../services/voiceBibleTypes";
import { PreviewPanel } from "./speech-to-scripture/PreviewPanel";
import { RecentHistoryPanel } from "./speech-to-scripture/RecentHistoryPanel";
import { SpeechHeader } from "./speech-to-scripture/SpeechHeader";
import { SpeechInputTranscriptPanel } from "./speech-to-scripture/SpeechInputTranscriptPanel";
import type { SessionHistoryItem, TranscriptSegment, TranslationOption, VerseMatchViewModel } from "./speech-to-scripture/types";
import { VerseMatchesPanel } from "./speech-to-scripture/VerseMatchesPanel";
import "./speech-to-scripture/SpeechToScripturePage.css";

const DEFAULT_SNAPSHOT: VoiceBibleSnapshot = {
  status: "idle",
  matching: false,
  modelReady: false,
  semanticReady: false,
  candidates: [],
  lastResult: null,
};

function formatStatusLabel(snapshot: VoiceBibleSnapshot): string {
  switch (snapshot.status) {
    case "listening":
      return "Listening";
    case "transcribing":
      return "Preparing";
    case "matching":
      return "Matching";
    case "no-match":
      return "No match";
    case "error":
      return "Attention";
    default:
      return "Idle";
  }
}

function formatSessionLabel(startedAt: number | null, status: VoiceBibleSnapshot["status"], tick: number): string | undefined {
  if (!startedAt || (status !== "listening" && status !== "transcribing" && status !== "matching")) {
    return undefined;
  }

  const totalSeconds = Math.max(0, Math.floor((tick - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function splitTranscript(transcript: string): TranscriptSegment[] {
  return transcript
    .split(/(?<=[.!?])\s+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index, all) => ({
      id: `transcript-${index}`,
      text,
      tone: index === all.length - 1 ? "active" : "stable",
    }));
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVerseEchoInTranscript(segmentText: string, excerpt: string): boolean {
  const normalizedSegment = normalizeComparableText(segmentText);
  const normalizedExcerpt = normalizeComparableText(excerpt);

  if (!normalizedSegment || !normalizedExcerpt || normalizedSegment.length < 18) {
    return false;
  }

  if (
    normalizedSegment === normalizedExcerpt ||
    normalizedSegment.includes(normalizedExcerpt) ||
    normalizedExcerpt.includes(normalizedSegment)
  ) {
    return true;
  }

  const segmentWords = Array.from(new Set(normalizedSegment.split(" ").filter(Boolean)));
  const excerptWords = new Set(normalizedExcerpt.split(" ").filter(Boolean));
  if (segmentWords.length < 4) {
    return false;
  }

  const overlap = segmentWords.filter((word) => excerptWords.has(word)).length;
  return overlap / segmentWords.length >= 0.72;
}

function mergeUniqueHistory(items: SessionHistoryItem[]): SessionHistoryItem[] {
  const seen = new Set<string>();
  const next: SessionHistoryItem[] = [];

  for (const item of items) {
    const key = `${item.reference}:${item.translation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
    if (next.length >= 6) break;
  }

  return next;
}

function resolveSourceLabel(
  settings: Awaited<ReturnType<typeof getVoiceBibleSettings>>,
  devices: Awaited<ReturnType<typeof listAudioInputDevices>>,
  obsInputs: Awaited<ReturnType<typeof listObsAudioInputs>>,
): string {
  if (settings.audioSourceMode === "obs-input" && settings.obsInputName) {
    return obsInputs.find((item) => item.inputName === settings.obsInputName)?.label ?? settings.obsInputName;
  }

  if (settings.audioDeviceId) {
    return devices.find((device) => device.id === settings.audioDeviceId)?.label ?? "System microphone";
  }

  return "System microphone";
}

export default function SpeechToScripturePage() {
  const {
    state,
    dispatch,
    addToQueue,
    recordHistory,
    goLive,
    activeTheme,
  } = useBible();

  const [snapshot, setSnapshot] = useState<VoiceBibleSnapshot>(DEFAULT_SNAPSHOT);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sourceLabel, setSourceLabel] = useState("System microphone");
  const [audioInputOptions, setAudioInputOptions] = useState<VoiceBibleInputOption[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string | undefined>(undefined);
  const [translations, setTranslations] = useState<TranslationOption[]>([{ value: "KJV", label: "KJV" }]);
  const [selectedTranslation, setSelectedTranslation] = useState(() => state.translation.toUpperCase());
  const [previewPassage, setPreviewPassage] = useState<BiblePassage | null>(null);
  const [livePassage, setLivePassage] = useState<BiblePassage | null>(null);
  const [recentHistory, setRecentHistory] = useState<SessionHistoryItem[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [clearedMatchKey, setClearedMatchKey] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const lastResultRef = useRef<string | null>(null);

  useEffect(() => {
    return voiceBibleService.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });
  }, []);

  useEffect(() => {
    return voiceBibleService.subscribeInputLevel((nextLevel) => {
      setAudioLevel(nextLevel);
    });
  }, []);

  useEffect(() => {
    void voiceBibleService.refreshAvailability().then((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [installed, settings, devices, obsInputs] = await Promise.all([
        getInstalledTranslations().catch(() => []),
        getVoiceBibleSettings().catch(() => null),
        listAudioInputDevices().catch(() => []),
        listObsAudioInputs().catch(() => []),
      ]);

      if (cancelled) return;

      const installedTranslations = installed
        .map((item) => ({
          value: item.abbr.toUpperCase(),
          label: `${item.abbr.toUpperCase()} · ${item.name}`,
        }))
        .sort((a, b) => a.value.localeCompare(b.value));

      const mergedTranslations = installedTranslations.some((item) => item.value === "KJV")
        ? installedTranslations
        : [{ value: "KJV", label: "KJV · King James Version" }, ...installedTranslations];

      setTranslations(mergedTranslations);
      setAudioInputOptions(devices);
      setSelectedAudioInputId(settings?.audioSourceMode === "system-mic" ? settings.audioDeviceId : undefined);
      setSelectedTranslation((current) =>
        mergedTranslations.some((option) => option.value === current)
          ? current
          : (mergedTranslations.some((option) => option.value === state.translation.toUpperCase())
            ? state.translation.toUpperCase()
            : "KJV"),
      );

      if (settings) {
        setSourceLabel(resolveSourceLabel(settings, devices, obsInputs));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.translation]);

  useEffect(() => {
    const liveState = bibleObsService.getLiveState();
    if (!liveState.slide) return;

    const match = liveState.slide.reference.match(/^(.*?)(?:\s+)(\d+):(\d+)/);
    if (!match) return;

    const [, book, chapterText, verseText] = match;
    void getPassage(
      book,
      Number(chapterText),
      Number(verseText),
      Number(verseText),
      selectedTranslation,
    ).then((passage) => {
      setLivePassage(passage);
    }).catch(() => undefined);
  }, [selectedTranslation]);

  useEffect(() => {
    if (snapshot.status === "listening" && !sessionStartedAt) {
      setSessionStartedAt(Date.now());
    }

    if (snapshot.status === "idle" || snapshot.status === "error" || snapshot.status === "no-match") {
      setSessionStartedAt(null);
    }
  }, [sessionStartedAt, snapshot.status]);

  useEffect(() => {
    if (snapshot.status !== "listening" && snapshot.status !== "transcribing" && snapshot.status !== "matching") {
      return;
    }

    const timer = window.setInterval(() => {
      setClockTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [snapshot.status]);

  useEffect(() => {
    if (!state.history.length) return;

    const seeded = state.history.slice(0, 3).map((passage, index) => ({
      id: `seed-${index}-${passage.reference}`,
      reference: passage.reference,
      translation: passage.translation,
      timestamp: Date.now() - (index + 1) * 180000,
      passage,
    }));
    setRecentHistory((current) => mergeUniqueHistory([...current, ...seeded]));
  }, [state.history]);

  const resultKey = useMemo(() => JSON.stringify({
    transcript: snapshot.transcript,
    result: snapshot.lastResult,
    candidates: snapshot.candidates,
  }), [snapshot.candidates, snapshot.lastResult, snapshot.transcript]);

  useEffect(() => {
    if (snapshot.status === "listening" || snapshot.status === "transcribing" || snapshot.status === "matching") {
      return;
    }
    if (!snapshot.lastResult || snapshot.lastResult.action !== "stage-verse") return;
    const result = snapshot.lastResult;
    const dedupeKey = `${result.book}:${result.chapter}:${result.verse}:${result.translation ?? selectedTranslation}`;
    if (lastResultRef.current === dedupeKey) return;
    lastResultRef.current = dedupeKey;

    void (async () => {
      if (!result.book || !result.chapter || !result.verse) return;
      const passage = await getPassage(
        result.book,
        result.chapter,
        result.verse,
        result.verse,
        selectedTranslation,
      );
      setRecentHistory((current) => mergeUniqueHistory([{
        id: `detected-${Date.now()}`,
        reference: passage.reference,
        translation: passage.translation,
        timestamp: Date.now(),
        passage,
      }, ...current]));
    })().catch(() => undefined);
  }, [selectedTranslation, snapshot.lastResult]);

  const buildVoiceContext = useCallback(() => ({
    selectedBook: previewPassage?.book ?? livePassage?.book ?? snapshot.lastResult?.book ?? null,
    selectedChapter: previewPassage?.chapter ?? livePassage?.chapter ?? snapshot.lastResult?.chapter ?? null,
    selectedVerse: previewPassage?.startVerse ?? livePassage?.startVerse ?? snapshot.lastResult?.verse ?? null,
    translation: selectedTranslation,
    availableTranslations: translations,
    liveInterim: true,
  }), [livePassage, previewPassage, selectedTranslation, snapshot.lastResult, translations]);

  const actualMatches = useMemo(() => {
    const nextMatches: VerseMatchViewModel[] = [];
    const lastResult = snapshot.lastResult;

    if (
      lastResult &&
      lastResult.action === "stage-verse" &&
      lastResult.book &&
      lastResult.chapter &&
      lastResult.verse
    ) {
      nextMatches.push({
        id: `primary-${lastResult.book}-${lastResult.chapter}-${lastResult.verse}`,
        book: lastResult.book,
        chapter: lastResult.chapter,
        verse: lastResult.verse,
        reference: `${lastResult.book} ${lastResult.chapter}:${lastResult.verse}`,
        translation: (lastResult.translation ?? selectedTranslation).toUpperCase(),
        excerpt: "",
        confidence: lastResult.confidence ?? 0.98,
        rankLabel: "Best match",
        emphasis: "primary",
      });
    }

    snapshot.candidates.forEach((candidate, index) => {
      nextMatches.push({
        id: `candidate-${candidate.book}-${candidate.chapter}-${candidate.verse}-${index}`,
        book: candidate.book,
        chapter: candidate.chapter,
        verse: candidate.verse,
        reference: candidate.label,
        translation: candidate.translation.toUpperCase(),
        excerpt: candidate.snippet,
        confidence: candidate.confidence,
        rankLabel: index === 0 ? "Refined" : "Possible",
        emphasis: index === 0 ? "secondary" : "tertiary",
      });
    });

    return nextMatches;
  }, [selectedTranslation, snapshot.candidates, snapshot.lastResult]);

  const [hydratedMatches, setHydratedMatches] = useState<VerseMatchViewModel[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (!actualMatches.length) {
      setHydratedMatches([]);
      return;
    }

    (async () => {
      const nextMatches = await Promise.all(
        actualMatches.map(async (match) => {
          if (match.excerpt) return match;
          const passage = await getPassage(match.book, match.chapter, match.verse, match.verse, match.translation);
          return {
            ...match,
            excerpt: passage.verses[0]?.text ?? "",
          };
        }),
      );
      if (!cancelled) {
        setHydratedMatches(nextMatches);
      }
    })().catch(() => {
      if (!cancelled) {
        setHydratedMatches(actualMatches);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [actualMatches]);

  const matches = useMemo(() => {
    const sourceMatches = hydratedMatches.length > 0 ? hydratedMatches : actualMatches;
    if (sourceMatches.length > 0 && clearedMatchKey !== resultKey) {
      return sourceMatches;
    }
    return [];
  }, [actualMatches, clearedMatchKey, hydratedMatches, resultKey]);

  const transcriptSegments = useMemo(() => {
    if (snapshot.transcript && clearedMatchKey !== resultKey) {
      const rawSegments = splitTranscript(snapshot.transcript);
      const bestMatchExcerpt = matches[0]?.excerpt ?? "";
      if (!bestMatchExcerpt) {
        return rawSegments;
      }

      const filteredSegments = rawSegments.filter(
        (segment) => !isVerseEchoInTranscript(segment.text, bestMatchExcerpt),
      );
      return filteredSegments.length > 0 ? filteredSegments : rawSegments;
    }
    return [] as TranscriptSegment[];
  }, [clearedMatchKey, matches, resultKey, snapshot.transcript]);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? null,
    [matches, selectedMatchId],
  );

  useEffect(() => {
    if (matches.length === 0) {
      setSelectedMatchId(null);
      return;
    }

    if (!selectedMatchId || !matches.some((match) => match.id === selectedMatchId)) {
      setSelectedMatchId(matches[0]?.id ?? null);
    }
  }, [matches, selectedMatchId]);

  const stageMatchAsPassage = useCallback(
    async (match: VerseMatchViewModel): Promise<BiblePassage> => {
      const passage = await getPassage(match.book, match.chapter, match.verse, match.verse, selectedTranslation);
      dispatch({ type: "SET_TRANSLATION", translation: selectedTranslation });
      dispatch({ type: "SELECT_PASSAGE", passage });
      return passage;
    },
    [dispatch, selectedTranslation],
  );

  const addHistoryItem = useCallback((passage: BiblePassage) => {
    setRecentHistory((current) => mergeUniqueHistory([{
      id: `${passage.reference}-${Date.now()}`,
      reference: passage.reference,
      translation: passage.translation,
      timestamp: Date.now(),
      passage,
    }, ...current]));
  }, []);

  const loadMatchPassage = useCallback(
    async (match: VerseMatchViewModel): Promise<BiblePassage> =>
      getPassage(match.book, match.chapter, match.verse, match.verse, selectedTranslation),
    [selectedTranslation],
  );

  const pushPassageToObs = useCallback(async (passage: BiblePassage, live: boolean) => {
    await ensureDockObsClientConnected();
    await dockObsClient.pushBible({
      book: passage.book,
      chapter: passage.chapter,
      verse: passage.startVerse,
      verseEnd: passage.endVerse > passage.startVerse ? passage.endVerse : undefined,
      verseRange: passage.endVerse > passage.startVerse
        ? `${passage.startVerse}-${passage.endVerse}`
        : String(passage.startVerse),
      referenceLabel: passage.reference,
      translation: passage.translation,
      verseText: passage.verses.map((verse) => verse.text).join(" "),
      overlayMode: "fullscreen",
      bibleThemeSettings: activeTheme?.settings as unknown as Record<string, unknown> | null | undefined,
    }, live);
  }, [activeTheme]);

  const handlePreviewMatch = useCallback(async (match: VerseMatchViewModel) => {
    const passage = await loadMatchPassage(match);
    await pushPassageToObs(passage, false);
    setPreviewPassage(passage);
    setSelectedMatchId(match.id);
    addHistoryItem(passage);
  }, [addHistoryItem, loadMatchPassage, pushPassageToObs]);

  const handlePresentMatch = useCallback(async (match: VerseMatchViewModel) => {
    const passage = await stageMatchAsPassage(match);
    await pushPassageToObs(passage, true);
    goLive();
    recordHistory(passage);
    setPreviewPassage(passage);
    setLivePassage(passage);
    setSelectedMatchId(match.id);
    addHistoryItem(passage);
  }, [addHistoryItem, goLive, pushPassageToObs, recordHistory, stageMatchAsPassage]);

  const handleQueueMatch = useCallback(async (match: VerseMatchViewModel) => {
    const passage = await stageMatchAsPassage(match);
    addToQueue(passage);
    recordHistory(passage);
    setPreviewPassage((current) => current ?? passage);
    setSelectedMatchId(match.id);
    addHistoryItem(passage);
  }, [addHistoryItem, addToQueue, recordHistory, stageMatchAsPassage]);

  const handleReplayHistory = useCallback((item: SessionHistoryItem) => {
    dispatch({ type: "SET_TRANSLATION", translation: item.translation });
    dispatch({ type: "SELECT_PASSAGE", passage: item.passage });
    setSelectedTranslation(item.translation.toUpperCase());
    setPreviewPassage(item.passage);
  }, [dispatch]);

  const handlePrimaryMicAction = useCallback(() => {
    if (snapshot.status === "listening") {
      void voiceBibleService.stopSession(buildVoiceContext());
      return;
    }

    if (snapshot.status === "transcribing" || snapshot.status === "matching") {
      return;
    }

    setClearedMatchKey(null);
    void voiceBibleService.startSession(buildVoiceContext());
  }, [buildVoiceContext, snapshot.status]);

  const handleSelectAudioInput = useCallback(async (deviceId?: string) => {
    const currentSettings = await getVoiceBibleSettings();
    const nextSettings = await saveVoiceBibleSettings({
      ...currentSettings,
      audioSourceMode: "system-mic",
      audioDeviceId: deviceId,
      obsInputName: undefined,
    });
    const devices = await listAudioInputDevices().catch(() => []);
    setAudioInputOptions(devices);
    setSelectedAudioInputId(nextSettings.audioDeviceId);
    setSourceLabel(
      resolveSourceLabel(
        nextSettings,
        devices,
        [],
      ),
    );
  }, []);

  const handlePresentCurrent = useCallback(() => {
    if (!selectedMatch) return;
    void handlePresentMatch(selectedMatch);
  }, [handlePresentMatch, selectedMatch]);

  const handleQueueCurrent = useCallback(() => {
    if (!selectedMatch) return;
    void handleQueueMatch(selectedMatch);
  }, [handleQueueMatch, selectedMatch]);

  return (
    <div className="app-page speech-page">
      <div className="app-page__inner speech-page__inner">
        <SpeechHeader
          status={snapshot.status}
          statusLabel={formatStatusLabel(snapshot)}
          sessionLabel={formatSessionLabel(sessionStartedAt, snapshot.status, clockTick)}
          translation={selectedTranslation}
          translations={translations}
          onTranslationChange={setSelectedTranslation}
        />

        <div className="speech-layout">
          <div className="speech-layout__left">
            <SpeechInputTranscriptPanel
              status={snapshot.status}
              audioLevel={audioLevel}
              sourceLabel={snapshot.sourceLabel ?? sourceLabel}
              detail={snapshot.error ?? snapshot.detail}
              modelReady={snapshot.modelReady}
              sessionLabel={formatSessionLabel(sessionStartedAt, snapshot.status, clockTick)}
              onPrimaryAction={handlePrimaryMicAction}
              segments={transcriptSegments}
              inputOptions={audioInputOptions}
              selectedInputId={selectedAudioInputId}
              onSelectInput={handleSelectAudioInput}
              inputPickerDisabled={snapshot.status !== "idle" && snapshot.status !== "no-match" && snapshot.status !== "error"}
            />

            <RecentHistoryPanel items={recentHistory} onReplay={handleReplayHistory} />
          </div>

          <div className="speech-layout__center">
            <PreviewPanel
              livePassage={livePassage}
              selectedMatch={selectedMatch}
              queueCount={state.queue.length}
              onPresent={handlePresentCurrent}
              onQueue={handleQueueCurrent}
              actionDisabled={!selectedMatch}
            />
          </div>

          <div className="speech-layout__right">
            <VerseMatchesPanel
              matches={matches}
              selectedId={selectedMatchId}
              detail={snapshot.matchDetail}
              matching={snapshot.matching}
              onPreview={(match) => { void handlePreviewMatch(match); }}
              onPresent={(match) => { void handlePresentMatch(match); }}
              onQueue={(match) => { void handleQueueMatch(match); }}
              onClear={() => {
                setSelectedMatchId(null);
                setClearedMatchKey(resultKey);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
