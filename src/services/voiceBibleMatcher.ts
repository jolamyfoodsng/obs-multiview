import {
  getBibleCorpus,
  getPassage,
  getVerse,
  getVerseCount,
  type BibleCorpusEntry,
} from "../bible/bibleData";
import { BOOK_CHAPTERS } from "../dock/dockTypes";
import { parseBibleSearch } from "../dock/bibleSearchParser";
import type {
  VoiceBibleCandidate,
  VoiceBibleContextPayload,
  VoiceBibleResult,
  VoiceBibleSettings,
} from "./voiceBibleTypes";

type VoiceBibleResolvedIntent =
  | {
      kind: "result";
      result: VoiceBibleResult;
      candidates: VoiceBibleCandidate[];
    }
  | {
      kind: "candidates";
      transcript: string;
      candidates: VoiceBibleCandidate[];
      detail: string;
    }
  | {
      kind: "none";
      transcript: string;
      detail: string;
    };

interface ScoredCandidate {
  entry: BibleCorpusEntry;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
}

interface NormalizedCorpusEntry {
  entry: BibleCorpusEntry;
  paddedText: string;
}

const normalizedCorpusCache = new Map<string, NormalizedCorpusEntry[]>();
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "bible",
  "can",
  "chapter",
  "for",
  "go",
  "let",
  "lets",
  "next",
  "of",
  "open",
  "our",
  "please",
  "previous",
  "the",
  "to",
  "turn",
  "us",
  "verse",
]);

const TRANSLATION_ALIASES: Record<string, string[]> = {
  KJV: ["kjv", "king james", "king james version"],
  NIV: ["niv", "new international version"],
  ESV: ["esv", "english standard version"],
  NKJV: ["nkjv", "new king james", "new king james version"],
  NLT: ["nlt", "new living translation"],
  NASB: ["nasb", "new american standard bible"],
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(let'?s|please|can we|could we|would you|now)\b/g, " ")
    .replace(/\b(open|turn|take|bring|move|switch)\b/g, " ")
    .replace(/\b(our|your|the|to|into|in)\b/g, " ")
    .replace(/\bverses?\b/g, " verse ")
    .replace(/\bvs\b/g, " verse ")
    .replace(/[^\w\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

async function fetchOllamaEmbeddings(
  baseUrl: string,
  model: string,
  input: string[],
): Promise<number[][]> {
  const normalizedBase = baseUrl.replace(/\/$/, "");

  const embedResponse = await fetch(`${normalizedBase}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).catch(() => null);

  if (embedResponse?.ok) {
    const payload = await embedResponse.json() as { embeddings?: number[][] };
    if (Array.isArray(payload.embeddings) && payload.embeddings.length === input.length) {
      return payload.embeddings;
    }
  }

  const singleEmbeddings = await Promise.all(
    input.map(async (text) => {
      const response = await fetch(`${normalizedBase}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!response.ok) {
        throw new Error(`Ollama embeddings failed with ${response.status}`);
      }
      const payload = await response.json() as { embedding?: number[] };
      if (!Array.isArray(payload.embedding)) {
        throw new Error("Ollama did not return an embedding");
      }
      return payload.embedding;
    }),
  );

  return singleEmbeddings;
}

async function getNormalizedCorpus(
  translation: string,
): Promise<NormalizedCorpusEntry[]> {
  const key = translation.toUpperCase();
  const cached = normalizedCorpusCache.get(key);
  if (cached) return cached;

  const corpus = await getBibleCorpus(key, 3);
  const normalized = corpus.map((entry) => ({
    entry,
    paddedText: ` ${normalizeSearchText(entry.text)} `,
  }));
  normalizedCorpusCache.set(key, normalized);
  return normalized;
}

function scoreLexicalMatch(
  entry: NormalizedCorpusEntry,
  normalizedQuery: string,
  queryTokens: string[],
): number {
  if (!normalizedQuery || queryTokens.length === 0) return 0;

  let tokenMatches = 0;
  for (const token of queryTokens) {
    if (entry.paddedText.includes(` ${token} `)) {
      tokenMatches += 1;
    }
  }

  const queryBigrams = queryTokens
    .slice(0, -1)
    .map((token, index) => `${token} ${queryTokens[index + 1]}`);
  let bigramMatches = 0;
  for (const bigram of queryBigrams) {
    if (entry.paddedText.includes(` ${bigram} `)) {
      bigramMatches += 1;
    }
  }

  const tokenCoverage = tokenMatches / queryTokens.length;
  const bigramCoverage =
    queryBigrams.length > 0 ? bigramMatches / queryBigrams.length : tokenCoverage;
  const exactPhraseBonus = entry.paddedText.includes(` ${normalizedQuery} `) ? 0.2 : 0;

  return Math.min(1, tokenCoverage * 0.68 + bigramCoverage * 0.22 + exactPhraseBonus);
}

async function buildCandidate(
  entry: BibleCorpusEntry,
  targetTranslation: string,
  confidence: number,
): Promise<VoiceBibleCandidate> {
  let snippet = entry.text;

  if (entry.translation.toUpperCase() !== targetTranslation.toUpperCase()) {
    if (entry.verse === entry.endVerse) {
      const verse = await getVerse(entry.book, entry.chapter, entry.verse, targetTranslation);
      snippet = verse?.text ?? entry.text;
    } else {
      const passage = await getPassage(
        entry.book,
        entry.chapter,
        entry.verse,
        entry.endVerse,
        targetTranslation,
      );
      snippet = passage.verses.map((verse) => verse.text).join(" ");
    }
  }

  return {
    book: entry.book,
    chapter: entry.chapter,
    verse: entry.verse,
    translation: targetTranslation.toUpperCase(),
    label:
      entry.verse === entry.endVerse
        ? `${entry.book} ${entry.chapter}:${entry.verse}`
        : `${entry.book} ${entry.chapter}:${entry.verse}-${entry.endVerse}`,
    snippet,
    confidence,
  };
}

function resolveTranslationCommand(
  transcript: string,
  availableTranslations: Array<{ value: string; label: string }>,
): string | null {
  const normalized = normalizeSearchText(transcript);
  const installed = new Set(availableTranslations.map((item) => item.value.toUpperCase()));

  for (const translation of installed) {
    const aliases = TRANSLATION_ALIASES[translation] ?? [translation.toLowerCase()];
    if (
      aliases.some((alias) =>
        normalized === alias ||
        normalized.endsWith(` ${alias}`) ||
        normalized.includes(` use ${alias} `),
      )
    ) {
      return translation;
    }
  }

  return null;
}

function buildReferenceQuery(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/\b(let'?s|please|can we|could we|would you)\b/g, " ")
    .replace(/\b(open|turn|take|bring|move)\b/g, " ")
    .replace(/\b(our|your|the|to|into|in)\b/g, " ")
    .replace(/\b(bible|scripture)\b/g, " ")
    .replace(/\bchapter\s+(\d+)\s+verse\s+(\d+)\b/g, "$1:$2")
    .replace(/\b(\d+)\s+verse\s+(\d+)\b/g, "$1:$2")
    .replace(/\b(\d+)\s+vs\s+(\d+)\b/g, "$1:$2")
    .replace(/\bverse\s+(\d+)\b/g, ":$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveRelativeNavigation(
  transcript: string,
  context: VoiceBibleContextPayload,
): Promise<VoiceBibleResult | null> {
  const normalized = normalizeSearchText(transcript);
  const currentBook = context.selectedBook ?? undefined;
  const currentChapter = context.selectedChapter ?? undefined;
  const currentVerse = context.selectedVerse ?? undefined;
  const currentTranslation = context.translation.toUpperCase();

  if (!currentBook || !currentChapter) return null;

  const maxChapter = BOOK_CHAPTERS[currentBook] ?? currentChapter;

  if (/\bnext verse\b/.test(normalized)) {
    const verseCount = await getVerseCount(currentBook, currentChapter, currentTranslation);
    let nextChapter = currentChapter;
    let nextVerse = currentVerse ?? 1;

    if (nextVerse < verseCount) {
      nextVerse += 1;
    } else if (currentChapter < maxChapter) {
      nextChapter = currentChapter + 1;
      nextVerse = 1;
    }

    return {
      action: "stage-verse",
      transcript,
      book: currentBook,
      chapter: nextChapter,
      verse: nextVerse,
      translation: currentTranslation,
      detail: `Moved to ${currentBook} ${nextChapter}:${nextVerse}`,
      confidence: 0.92,
    };
  }

  if (/\b(previous|prev) verse\b/.test(normalized)) {
    let nextChapter = currentChapter;
    let nextVerse = currentVerse ?? 1;

    if (nextVerse > 1) {
      nextVerse -= 1;
    } else if (currentChapter > 1) {
      nextChapter = currentChapter - 1;
      nextVerse = await getVerseCount(currentBook, nextChapter, currentTranslation);
    }

    return {
      action: "stage-verse",
      transcript,
      book: currentBook,
      chapter: nextChapter,
      verse: nextVerse,
      translation: currentTranslation,
      detail: `Moved to ${currentBook} ${nextChapter}:${nextVerse}`,
      confidence: 0.92,
    };
  }

  const chapterMatch = normalized.match(/\b(?:go to )?chapter (\d+)\b/);
  if (chapterMatch) {
    const nextChapter = Number.parseInt(chapterMatch[1], 10);
    if (Number.isFinite(nextChapter) && nextChapter >= 1 && nextChapter <= maxChapter) {
      return {
        action: "set-chapter",
        transcript,
        book: currentBook,
        chapter: nextChapter,
        translation: currentTranslation,
        detail: `Moved to ${currentBook} chapter ${nextChapter}`,
        confidence: 0.9,
      };
    }
  }

  if (/\b(last chapter|final chapter)\b/.test(normalized)) {
    return {
      action: "set-chapter",
      transcript,
      book: currentBook,
      chapter: maxChapter,
      translation: currentTranslation,
      detail: `Moved to ${currentBook} chapter ${maxChapter}`,
      confidence: 0.9,
    };
  }

  return null;
}

async function runLexicalSearch(
  transcript: string,
  translation: string,
): Promise<ScoredCandidate[]> {
  const normalizedQuery = normalizeSearchText(transcript);
  const queryTokens = tokenize(transcript);
  const corpus = await getNormalizedCorpus(translation);
  const scored: ScoredCandidate[] = [];

  for (const entry of corpus) {
    const lexicalScore = scoreLexicalMatch(entry, normalizedQuery, queryTokens);
    if (lexicalScore < 0.33) continue;

    scored.push({
      entry: entry.entry,
      score: lexicalScore,
      lexicalScore,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 25);
}

async function maybeSemanticRerank(
  transcript: string,
  candidates: ScoredCandidate[],
  settings: VoiceBibleSettings,
): Promise<ScoredCandidate[]> {
  if (
    settings.semanticMode !== "ollama" ||
    !settings.ollamaBaseUrl ||
    !settings.ollamaModel ||
    candidates.length === 0
  ) {
    return candidates;
  }

  try {
    const embeddings = await fetchOllamaEmbeddings(
      settings.ollamaBaseUrl,
      settings.ollamaModel,
      [transcript, ...candidates.map((candidate) => candidate.entry.text)],
    );
    const [queryEmbedding, ...candidateEmbeddings] = embeddings;
    if (!queryEmbedding || candidateEmbeddings.length !== candidates.length) {
      return candidates;
    }

    const reranked = candidates.map((candidate, index) => {
      const semanticScore = cosineSimilarity(queryEmbedding, candidateEmbeddings[index]);
      const combinedScore = candidate.lexicalScore * 0.65 + semanticScore * 0.35;
      return {
        ...candidate,
        semanticScore,
        score: combinedScore,
      };
    });

    reranked.sort((a, b) => b.score - a.score);
    return reranked;
  } catch (err) {
    console.warn("[voiceBibleMatcher] Ollama rerank failed:", err);
    return candidates;
  }
}

export async function resolveVoiceBibleIntent(
  transcript: string,
  context: VoiceBibleContextPayload,
  settings: VoiceBibleSettings,
): Promise<VoiceBibleResolvedIntent> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return {
      kind: "none",
      transcript,
      detail: "No transcript captured",
    };
  }

  const translationCommand = resolveTranslationCommand(
    trimmed,
    context.availableTranslations,
  );
  if (translationCommand) {
    return {
      kind: "result",
      result: {
        action: "set-translation",
        transcript: trimmed,
        translation: translationCommand,
        detail: `Using ${translationCommand}`,
        confidence: 0.96,
      },
      candidates: [],
    };
  }

  const referenceQuery = buildReferenceQuery(trimmed);
  const referenceMatch = parseBibleSearch(referenceQuery).find(
    (candidate) => candidate.chapter !== null && candidate.verse !== null,
  );
  if (
    referenceMatch &&
    referenceMatch.chapter !== null &&
    referenceMatch.verse !== null
  ) {
    return {
      kind: "result",
      result: {
        action: "stage-verse",
        transcript: trimmed,
        book: referenceMatch.book,
        chapter: referenceMatch.chapter,
        verse: referenceMatch.verse,
        translation: context.translation.toUpperCase(),
        detail: referenceMatch.label,
        confidence: 0.97,
      },
      candidates: [],
    };
  }

  const relativeCommand = await resolveRelativeNavigation(trimmed, context);
  if (relativeCommand) {
    return {
      kind: "result",
      result: relativeCommand,
      candidates: [],
    };
  }

  const selectedTranslation = context.translation.toUpperCase();
  const primaryResults = await runLexicalSearch(trimmed, selectedTranslation);
  const shouldSearchKjv =
    selectedTranslation !== "KJV" &&
    (primaryResults.length === 0 || primaryResults[0].score < 0.72);
  const fallbackResults = shouldSearchKjv
    ? await runLexicalSearch(trimmed, "KJV")
    : [];

  const combined = [...primaryResults, ...fallbackResults]
    .reduce<ScoredCandidate[]>((accumulator, candidate) => {
      if (
        accumulator.some(
          (existing) =>
            existing.entry.book === candidate.entry.book &&
            existing.entry.chapter === candidate.entry.chapter &&
            existing.entry.verse === candidate.entry.verse &&
            existing.entry.endVerse === candidate.entry.endVerse,
        )
      ) {
        return accumulator;
      }
      accumulator.push(candidate);
      return accumulator;
    }, [])
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const reranked = await maybeSemanticRerank(trimmed, combined, settings);
  const topCandidates = reranked.slice(0, 5);

  if (topCandidates.length === 0) {
    return {
      kind: "none",
      transcript: trimmed,
      detail: "No confident verse match",
    };
  }

  const candidatePayloads = await Promise.all(
    topCandidates.map((candidate) =>
      buildCandidate(candidate.entry, selectedTranslation, candidate.score),
    ),
  );
  const [bestCandidate] = candidatePayloads;
  const bestScore = topCandidates[0].score;
  const scoreGap =
    topCandidates.length > 1 ? topCandidates[0].score - topCandidates[1].score : bestScore;

  if (bestScore >= 0.82 || (bestScore >= 0.72 && scoreGap >= 0.08)) {
    return {
      kind: "result",
      result: {
        action: "stage-verse",
        transcript: trimmed,
        book: bestCandidate.book,
        chapter: bestCandidate.chapter,
        verse: bestCandidate.verse,
        translation: bestCandidate.translation,
        detail: bestCandidate.label,
        confidence: bestCandidate.confidence,
      },
      candidates: candidatePayloads,
    };
  }

  if (bestScore >= 0.52) {
    return {
      kind: "candidates",
      transcript: trimmed,
      candidates: candidatePayloads,
      detail: "Choose the closest match",
    };
  }

  return {
    kind: "none",
    transcript: trimmed,
    detail: "No confident verse match",
  };
}
