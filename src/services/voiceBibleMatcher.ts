import {
  getBibleCorpus,
  getPassage,
  getVerse,
  getVerseCount,
  type BibleCorpusEntry,
} from "../bible/bibleData";
import { BOOK_CHAPTERS } from "../dock/dockTypes";
import { parseBibleSearch, type BibleSearchResult } from "../dock/bibleSearchParser";
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

interface ResolveVoiceBibleIntentOptions {
  fastInterim?: boolean;
}

interface OllamaNormalizationOptions {
  fastMode?: boolean;
}

interface ScoredCandidate {
  entry: BibleCorpusEntry;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
}

interface NormalizedCorpusEntry {
  entry: BibleCorpusEntry;
  paddedText: string;
  tokenCount: number;
}

interface VoiceBiblePlannedCommand {
  action?: "stage-verse" | "set-chapter" | "set-translation" | "none";
  book?: string | null;
  chapter?: number | null;
  verse?: number | null;
  translation?: string | null;
  relativeVerseDelta?: number | null;
  relativeChapterDelta?: number | null;
}

const normalizedCorpusCache = new Map<string, NormalizedCorpusEntry[]>();
const translationVocabularyCache = new Map<string, Map<string, number>>();
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
  "no",
  "of",
  "open",
  "our",
  "please",
  "previous",
  "so",
  "system",
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
const EMBEDDING_MODEL_PATTERN = /(embed|embedding|bge|gte|e5|nomic-embed)/i;
const PREFERRED_NORMALIZER_MODELS = [
  "qwen2.5",
  "qwen3",
  "llama",
  "mistral",
  "gemma",
  "phi",
  "deepseek",
];
const COMMON_QUOTE_TOKEN_ALIASES = new Map<string, string>([
  ["captity", "captivity"],
  ["captivty", "captivity"],
  ["captiviti", "captivity"],
  ["captivite", "captivity"],
  ["bonus", "bones"],
  ["word", "world"],
  ["load", "lord"],
  ["ion", "zion"],
  ["sheeps", "sheep"],
  ["vally", "valley"],
  ["rejoyce", "rejoice"],
]);
const NUMBER_WORD_ALIASES = new Map<string, string>([
  ["zero", "0"],
  ["oh", "0"],
  ["o", "0"],
  ["one", "1"],
  ["won", "1"],
  ["two", "2"],
  ["too", "2"],
  ["three", "3"],
  ["tree", "3"],
  ["free", "3"],
  ["tv", "3"],
  ["teevee", "3"],
  ["four", "4"],
  ["fore", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["ate", "8"],
  ["nine", "9"],
  ["ten", "10"],
  ["eleven", "11"],
  ["twelve", "12"],
  ["thirteen", "13"],
  ["fourteen", "14"],
  ["fifteen", "15"],
  ["sixteen", "16"],
  ["seventeen", "17"],
  ["eighteen", "18"],
  ["nineteen", "19"],
  ["twenty", "20"],
]);
const REFERENCE_TOKEN_ALIASES = new Map<string, string>([
  ["by", "verse"],
  ["bi", "verse"],
  ["bah", "verse"],
  ["bus", "verse"],
  ["bas", "verse"],
  ["vas", "verse"],
  ["vass", "verse"],
  ["buzz", "verse"],
  ["verse", "verse"],
  ["verses", "verse"],
  ["vs", "verse"],
  ["chapter", "chapter"],
  ["chap", "chapter"],
  ["ch", "chapter"],
  ["capter", "chapter"],
  ["captor", "chapter"],
  ["capture", "chapter"],
]);
const SPOKEN_BOOK_TOKEN_ALIASES = new Map<string, string>([
  ["obadia", "obadiah"],
  ["obadya", "obadiah"],
  ["obedia", "obadiah"],
  ["obediah", "obadiah"],
  ["obidiah", "obadiah"],
  ["collossians", "colossians"],
  ["colossians", "colossians"],
  ["colossins", "colossians"],
  ["colations", "colossians"],
  ["filemon", "philemon"],
  ["fileman", "philemon"],
  ["phileman", "philemon"],
  ["zekariah", "zechariah"],
]);

function normalizeReferenceSpeech(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s:.-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const spokenBookAlias = SPOKEN_BOOK_TOKEN_ALIASES.get(token);
      if (spokenBookAlias) return spokenBookAlias;

      const directAlias = REFERENCE_TOKEN_ALIASES.get(token);
      if (directAlias) return directAlias;

      if (/^\d+$/.test(token)) return token;

      const numberAlias = NUMBER_WORD_ALIASES.get(token);
      if (numberAlias) return numberAlias;

      const digitSuffixMatch = token.match(/^([a-z]+)(\d+)$/);
      if (digitSuffixMatch) {
        const prefix = digitSuffixMatch[1];
        const suffix = digitSuffixMatch[2];
        const prefixAlias =
          REFERENCE_TOKEN_ALIASES.get(prefix) ??
          NUMBER_WORD_ALIASES.get(prefix);
        if (prefixAlias) {
          return `${prefixAlias} ${suffix}`;
        }
      }

      return token;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

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

async function fetchOllamaModelNames(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama tags failed with ${response.status}`);
  }
  const payload = await response.json() as {
    models?: Array<{ model?: string; name?: string }>;
  };
  return (payload.models ?? [])
    .map((entry) => (entry.name ?? entry.model ?? "").trim())
    .filter(Boolean);
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
    tokenCount: normalizeSearchText(entry.text).split(/\s+/).filter(Boolean).length,
  }));
  normalizedCorpusCache.set(key, normalized);
  return normalized;
}

function getVerseSpanLength(entry: BibleCorpusEntry): number {
  return Math.max(1, entry.endVerse - entry.verse + 1);
}

async function getTranslationVocabulary(
  translation: string,
): Promise<Map<string, number>> {
  const key = translation.toUpperCase();
  const cached = translationVocabularyCache.get(key);
  if (cached) return cached;

  const corpus = await getNormalizedCorpus(key);
  const vocabulary = new Map<string, number>();

  for (const item of corpus) {
    for (const token of item.paddedText.trim().split(/\s+/)) {
      if (!token || token.length < 2) continue;
      vocabulary.set(token, (vocabulary.get(token) ?? 0) + 1);
    }
  }

  translationVocabularyCache.set(key, vocabulary);
  return vocabulary;
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  const aLength = a.length;
  const bLength = b.length;

  if (Math.abs(aLength - bLength) > maxDistance) {
    return maxDistance + 1;
  }

  const previous = new Array<number>(bLength + 1);
  const current = new Array<number>(bLength + 1);

  for (let column = 0; column <= bLength; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= aLength; row += 1) {
    current[0] = row;
    let rowMin = current[0];

    for (let column = 1; column <= bLength; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
      rowMin = Math.min(rowMin, current[column]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let column = 0; column <= bLength; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[bLength];
}

async function normalizeQuoteHeuristics(
  value: string,
  translation: string,
): Promise<string> {
  const normalized = normalizeSearchText(value);
  if (!normalized) return normalized;

  const vocabulary = await getTranslationVocabulary(translation);
  const tokens = normalized.split(/\s+/).filter(Boolean);

  const corrected = tokens.map((token) => {
    const alias = COMMON_QUOTE_TOKEN_ALIASES.get(token);
    if (alias) {
      return alias;
    }

    if (
      token.length < 4 ||
      STOP_WORDS.has(token) ||
      /^\d+$/.test(token) ||
      vocabulary.has(token)
    ) {
      return token;
    }

    let bestCandidate: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestFrequency = -1;

    for (const [candidate, frequency] of vocabulary) {
      if (
        candidate.length < 4 ||
        Math.abs(candidate.length - token.length) > 2 ||
        candidate[0] !== token[0]
      ) {
        continue;
      }

      const distance = boundedEditDistance(token, candidate, 2);
      if (distance > 2) continue;

      if (
        distance < bestDistance ||
        (distance === bestDistance && frequency > bestFrequency)
      ) {
        bestCandidate = candidate;
        bestDistance = distance;
        bestFrequency = frequency;
      }
    }

    if (bestCandidate && bestDistance <= 2) {
      return bestCandidate;
    }

    return token;
  });

  return corrected.join(" ")
    .replace(/\breverse\b(?=.*\bcaptivity\b)/g, "turn again")
    .replace(/\s+/g, " ")
    .trim();
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
  const spanLength = getVerseSpanLength(entry.entry);
  const exactPhraseBonus = entry.paddedText.includes(` ${normalizedQuery} `)
    ? spanLength === 1
      ? 0.24
      : 0.14
    : 0;
  const densityScore = Math.min(1, queryTokens.length / Math.max(queryTokens.length, entry.tokenCount));
  const spanPenalty = spanLength > 1 ? Math.min(0.12, (spanLength - 1) * 0.05) : 0;

  return Math.max(
    0,
    Math.min(
      1,
      tokenCoverage * 0.66 +
      bigramCoverage * 0.18 +
      exactPhraseBonus +
      densityScore * 0.1 -
      spanPenalty,
    ),
  );
}

function compareScoredCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  const scoreDelta = b.score - a.score;
  if (Math.abs(scoreDelta) > 0.0001) {
    return scoreDelta;
  }

  const spanDelta = getVerseSpanLength(a.entry) - getVerseSpanLength(b.entry);
  if (spanDelta !== 0) {
    return spanDelta;
  }

  const textLengthDelta = a.entry.text.length - b.entry.text.length;
  if (textLengthDelta !== 0) {
    return textLengthDelta;
  }

  if (a.entry.book !== b.entry.book) {
    return a.entry.book.localeCompare(b.entry.book);
  }

  if (a.entry.chapter !== b.entry.chapter) {
    return a.entry.chapter - b.entry.chapter;
  }

  return a.entry.verse - b.entry.verse;
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
  return normalizeReferenceSpeech(transcript)
    .toLowerCase()
    .replace(/\b(let'?s|please|can we|could we|would you|so|no)\b/g, " ")
    .replace(/\b(open|turn|take|bring|move)\b/g, " ")
    .replace(/\b(our|your|the|to|into|in)\b/g, " ")
    .replace(/\b(bible|scripture)\b/g, " ")
    .replace(/\bchapter\s+(\d+)\s+verse\s+(\d+)\b/g, "$1:$2")
    .replace(/\b(\d+)\s+verse\s+(\d+)\b/g, "$1:$2")
    .replace(/\b(\d+)\s+vs\s+(\d+)\b/g, "$1:$2")
    .replace(/\b(\d+)\s*[-–—]\s*(\d+)\b/g, "$1:$2")
    .replace(/\bverse\s+(\d+)\b/g, ":$1")
    .replace(/\s+/g, " ")
    .trim();
}

function compareReferenceCandidates(
  left: BibleSearchResult,
  right: BibleSearchResult,
): number {
  const leftHasVerse = left.chapter !== null && left.verse !== null;
  const rightHasVerse = right.chapter !== null && right.verse !== null;

  if (leftHasVerse !== rightHasVerse) {
    return leftHasVerse ? -1 : 1;
  }

  const leftHasChapter = left.chapter !== null;
  const rightHasChapter = right.chapter !== null;
  if (leftHasChapter !== rightHasChapter) {
    return leftHasChapter ? -1 : 1;
  }

  const scoreDelta = right.score - left.score;
  if (Math.abs(scoreDelta) > 0.0001) {
    return scoreDelta;
  }

  return left.label.length - right.label.length;
}

function extractReferenceCandidateFromSpeech(
  transcript: string,
): BibleSearchResult | null {
  const normalized = normalizeReferenceSpeech(transcript)
    .toLowerCase()
    .replace(/[^\w\s:.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const directCandidates = parseBibleSearch(normalized).filter(
    (candidate) => candidate.chapter !== null,
  );
  if (directCandidates.length > 0) {
    directCandidates.sort(compareReferenceCandidates);
    return directCandidates[0];
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const candidates: BibleSearchResult[] = [];

  for (let start = 0; start < tokens.length; start += 1) {
    const maxEnd = Math.min(tokens.length, start + 7);
    for (let end = start + 1; end <= maxEnd; end += 1) {
      const slice = tokens.slice(start, end);
      if (!slice.some((token) => /[a-z]/.test(token))) continue;
      if (!slice.some((token) => /\d/.test(token))) continue;

      const queries = new Set([
        slice.join(" "),
        slice.join(""),
      ]);

      for (const query of queries) {
        for (const result of parseBibleSearch(query)) {
          if (result.chapter !== null) {
            candidates.push(result);
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort(compareReferenceCandidates);
  return candidates[0];
}

function sanitizeGeneratedCommand(value: string): string {
  return value
    .split(/\r?\n/, 1)[0]
    .replace(/^command\s*:\s*/i, "")
    .replace(/^output\s*:\s*/i, "")
    .replace(/^query\s*:\s*/i, "")
    .replace(/[`"'“”]+/g, "")
    .trim();
}

function sanitizeGeneratedJson(value: string): string {
  const trimmed = value.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function looksLikeEmbeddingModel(model: string): boolean {
  return EMBEDDING_MODEL_PATTERN.test(model);
}

function normalizePlannedAction(value: unknown): VoiceBiblePlannedCommand["action"] {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "stage-verse" ||
    normalized === "set-chapter" ||
    normalized === "set-translation" ||
    normalized === "none"
  ) {
    return normalized;
  }
  return undefined;
}

function parsePlannedCommand(value: string): VoiceBiblePlannedCommand | null {
  const readNumber = (input: unknown): number | null => {
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input === "string" && input.trim()) {
      const parsed = Number.parseInt(input.trim(), 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  try {
    const payload = JSON.parse(sanitizeGeneratedJson(value)) as Record<string, unknown>;
    return {
      action: normalizePlannedAction(payload.action),
      book: typeof payload.book === "string" && payload.book.trim() ? payload.book.trim() : null,
      chapter: readNumber(payload.chapter),
      verse: readNumber(payload.verse),
      translation:
        typeof payload.translation === "string" && payload.translation.trim()
          ? payload.translation.trim()
          : null,
      relativeVerseDelta: readNumber(payload.relativeVerseDelta),
      relativeChapterDelta: readNumber(payload.relativeChapterDelta),
    };
  } catch {
    return null;
  }
}

async function resolveOllamaNormalizerModel(
  settings: VoiceBibleSettings,
): Promise<{ baseUrl: string; model: string } | null> {
  const baseUrl = settings.ollamaBaseUrl?.trim();
  if (!baseUrl) return null;

  const explicitModel = settings.ollamaNormalizerModel?.trim();
  if (explicitModel && !looksLikeEmbeddingModel(explicitModel)) {
    return { baseUrl, model: explicitModel };
  }

  const configuredModel = settings.ollamaModel?.trim();
  if (configuredModel && !looksLikeEmbeddingModel(configuredModel)) {
    return { baseUrl, model: configuredModel };
  }

  try {
    const models = await fetchOllamaModelNames(baseUrl);
    const generativeModels = models.filter((model) => !looksLikeEmbeddingModel(model));
    if (generativeModels.length === 0) return null;

    const preferred =
      generativeModels.find((model) =>
        PREFERRED_NORMALIZER_MODELS.some((prefix) => model.toLowerCase().includes(prefix)),
      ) ?? generativeModels[0];

    return { baseUrl, model: preferred };
  } catch (err) {
    console.warn("[voiceBibleMatcher] Ollama model discovery failed:", err);
    return null;
  }
}

function getExplicitVerseOverride(
  transcript: string,
  currentVerse?: number | null,
): number | null {
  const normalized = normalizeSearchText(normalizeReferenceSpeech(transcript));
  const goToVerseMatches = [...normalized.matchAll(/\b(?:go to|move to|take me to)\s+verse\s+(\d+)\b/g)];
  const directVerseMatches = [...normalized.matchAll(/\bverse\s+(\d+)\b/g)];
  const sourceMatch =
    goToVerseMatches[goToVerseMatches.length - 1]?.[1] ??
    (directVerseMatches.length > 1
      ? directVerseMatches[directVerseMatches.length - 1]?.[1]
      : undefined);

  if (!sourceMatch) return null;

  const verse = Number.parseInt(sourceMatch, 10);
  if (!Number.isFinite(verse) || verse < 1 || verse === currentVerse) {
    return null;
  }
  return verse;
}

async function normalizeVoiceCommandWithOllama(
  transcript: string,
  context: VoiceBibleContextPayload,
  settings: VoiceBibleSettings,
  options?: OllamaNormalizationOptions,
): Promise<string | null> {
  const resolved = await resolveOllamaNormalizerModel(settings);
  if (!resolved) {
    return null;
  }
  const { baseUrl, model } = resolved;
  const fastMode = Boolean(options?.fastMode);

  const currentReference =
    context.selectedBook && context.selectedChapter
      ? context.selectedVerse
        ? `${context.selectedBook} ${context.selectedChapter}:${context.selectedVerse}`
        : `${context.selectedBook} ${context.selectedChapter}`
      : "none";

  const prompt = fastMode
    ? [
        "Fix this noisy Bible navigation transcript.",
        "Return ONLY one command.",
        "Allowed outputs: <Book> <Chapter>:<Verse> | <Book> <Chapter> | go to verse <N> | chapter <N> | next verse | previous verse | use <TRANSLATION> | NONE",
        `Current reference: ${currentReference}`,
        `Current translation: ${context.translation.toUpperCase()}`,
        `Available translations: ${context.availableTranslations.map((item) => item.value.toUpperCase()).join(", ")}`,
        `Transcript: ${transcript}`,
      ].join("\n")
    : [
        "Rewrite noisy Bible voice transcripts into one canonical command.",
        "Return ONLY the command. Do not explain anything.",
        "Allowed outputs:",
        "- <Book> <Chapter>:<Verse>",
        "- <Book> <Chapter>",
        "- go to verse <N>",
        "- chapter <N>",
        "- next verse",
        "- previous verse",
        "- use <TRANSLATION>",
        "- NONE",
        "",
        "Examples:",
        'john 3-1 go to verse 5 -> John 3:5',
        'matthew 4-7 no go to verse 9 -> Matthew 4:9',
        '1 john 4 by 7 -> 1 John 4:7',
        '1 john 4 by 7 next verse -> 1 John 4:8',
        'let us go to genesis 10 verse 1 -> Genesis 10:1',
        'go to verse 7 -> go to verse 7',
        'use niv -> use NIV',
        "",
        `Current reference: ${currentReference}`,
        `Current translation: ${context.translation.toUpperCase()}`,
        `Available translations: ${context.availableTranslations.map((item) => item.value.toUpperCase()).join(", ")}`,
        `Transcript: ${transcript}`,
      ].join("\n");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), fastMode ? 1200 : 2500);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          top_p: fastMode ? 0.03 : 0.05,
          num_predict: fastMode ? 18 : 24,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama normalize failed with ${response.status}`);
    }

    const payload = await response.json() as { response?: string };
    const command = sanitizeGeneratedCommand(payload.response ?? "");
    if (!command || /^none$/i.test(command)) {
      return null;
    }
    return command;
  } catch (err) {
    console.warn("[voiceBibleMatcher] Ollama normalization failed:", err);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function resolvePlannedTranslation(
  translation: string | null | undefined,
  availableTranslations: Array<{ value: string; label: string }>,
): string | null {
  if (!translation) return null;

  const direct = availableTranslations.find(
    (item) => item.value.toUpperCase() === translation.trim().toUpperCase(),
  );
  if (direct) return direct.value.toUpperCase();

  return resolveTranslationCommand(`use ${translation}`, availableTranslations);
}

async function applyRelativeVerseDelta(
  book: string,
  chapter: number,
  verse: number,
  delta: number,
  translation: string,
): Promise<{ chapter: number; verse: number }> {
  let nextChapter = chapter;
  let nextVerse = verse;
  let remaining = delta;
  const maxChapter = BOOK_CHAPTERS[book] ?? chapter;

  while (remaining > 0) {
    const verseCount = await getVerseCount(book, nextChapter, translation);
    if (nextVerse < verseCount) {
      nextVerse += 1;
      remaining -= 1;
      continue;
    }
    if (nextChapter >= maxChapter) {
      break;
    }
    nextChapter += 1;
    nextVerse = 1;
    remaining -= 1;
  }

  while (remaining < 0) {
    if (nextVerse > 1) {
      nextVerse -= 1;
      remaining += 1;
      continue;
    }
    if (nextChapter <= 1) {
      break;
    }
    nextChapter -= 1;
    nextVerse = await getVerseCount(book, nextChapter, translation);
    remaining += 1;
  }

  return { chapter: nextChapter, verse: nextVerse };
}

async function resolvePlannedVoiceCommand(
  plan: VoiceBiblePlannedCommand,
  transcript: string,
  context: VoiceBibleContextPayload,
): Promise<VoiceBibleResult | null> {
  if (!plan.action || plan.action === "none") {
    return null;
  }

  const plannedTranslation = resolvePlannedTranslation(
    plan.translation,
    context.availableTranslations,
  );

  if (plan.action === "set-translation") {
    if (!plannedTranslation) return null;
    return {
      action: "set-translation",
      transcript,
      translation: plannedTranslation,
      detail: `Using ${plannedTranslation}`,
      confidence: 0.97,
    };
  }

  if (plan.action === "set-chapter") {
    const book = plan.book ?? context.selectedBook ?? null;
    if (!book) return null;

    const maxChapter = BOOK_CHAPTERS[book] ?? context.selectedChapter ?? 1;
    let chapter = plan.chapter ?? context.selectedChapter ?? null;
    if (!chapter) return null;

    if (plan.relativeChapterDelta) {
      chapter = Math.min(maxChapter, Math.max(1, chapter + plan.relativeChapterDelta));
    }

    if (chapter < 1 || chapter > maxChapter) return null;

    return {
      action: "set-chapter",
      transcript,
      book,
      chapter,
      translation: plannedTranslation ?? context.translation.toUpperCase(),
      detail: `${book} chapter ${chapter}`,
      confidence: 0.95,
    };
  }

  if (plan.action === "stage-verse") {
    const book = plan.book ?? context.selectedBook ?? null;
    let chapter = plan.chapter ?? context.selectedChapter ?? null;
    let verse = plan.verse ?? context.selectedVerse ?? null;
    const translation = plannedTranslation ?? context.translation.toUpperCase();

    if (!book || !chapter || !verse) {
      return null;
    }

    if (plan.relativeChapterDelta) {
      const maxChapter = BOOK_CHAPTERS[book] ?? chapter;
      chapter = Math.min(maxChapter, Math.max(1, chapter + plan.relativeChapterDelta));
      const verseCount = await getVerseCount(book, chapter, translation);
      verse = Math.min(verseCount, Math.max(1, verse));
    }

    if (plan.relativeVerseDelta) {
      const resolved = await applyRelativeVerseDelta(
        book,
        chapter,
        verse,
        plan.relativeVerseDelta,
        translation,
      );
      chapter = resolved.chapter;
      verse = resolved.verse;
    }

    const verseCount = await getVerseCount(book, chapter, translation);
    if (verse < 1 || verse > verseCount) return null;

    return {
      action: "stage-verse",
      transcript,
      book,
      chapter,
      verse,
      translation,
      detail: `${book} ${chapter}:${verse}`,
      confidence: 0.96,
    };
  }

  return null;
}

async function planVoiceCommandWithOllama(
  transcript: string,
  context: VoiceBibleContextPayload,
  settings: VoiceBibleSettings,
): Promise<VoiceBibleResult | null> {
  const resolved = await resolveOllamaNormalizerModel(settings);
  if (!resolved) {
    return null;
  }
  const { baseUrl, model } = resolved;

  const currentReference =
    context.selectedBook && context.selectedChapter
      ? context.selectedVerse
        ? `${context.selectedBook} ${context.selectedChapter}:${context.selectedVerse}`
        : `${context.selectedBook} ${context.selectedChapter}`
      : "none";

  const prompt = [
    "Convert the spoken Bible navigation transcript into ONE final structured JSON command.",
    "Return ONLY minified JSON.",
    "Schema:",
    '{"action":"stage-verse|set-chapter|set-translation|none","book":string|null,"chapter":number|null,"verse":number|null,"translation":string|null,"relativeVerseDelta":number|null,"relativeChapterDelta":number|null}',
    "Rules:",
    "- Extract a Bible reference from anywhere in the sentence.",
    "- Apply repeated relative navigation to the final result.",
    "- 'next page' means the same as 'next verse'.",
    "- 'previous page' means the same as 'previous verse'.",
    "- If there is an absolute reference plus relative moves, keep the base reference and use relativeVerseDelta.",
    "- For relative-only commands, use the current reference as the base.",
    "- If the user asks for a translation change, set action to set-translation.",
    "- If the request cannot be understood, return {\"action\":\"none\",\"book\":null,\"chapter\":null,\"verse\":null,\"translation\":null,\"relativeVerseDelta\":null,\"relativeChapterDelta\":null}.",
    "Examples:",
    'Let us go to Genesis 10 verse 1 next page next page -> {"action":"stage-verse","book":"Genesis","chapter":10,"verse":1,"translation":null,"relativeVerseDelta":2,"relativeChapterDelta":null}',
    '1 John 4 by 7 next verse -> {"action":"stage-verse","book":"1 John","chapter":4,"verse":7,"translation":null,"relativeVerseDelta":1,"relativeChapterDelta":null}',
    'next verse -> {"action":"stage-verse","book":null,"chapter":null,"verse":null,"translation":null,"relativeVerseDelta":1,"relativeChapterDelta":null}',
    'use NIV -> {"action":"set-translation","book":null,"chapter":null,"verse":null,"translation":"NIV","relativeVerseDelta":null,"relativeChapterDelta":null}',
    "",
    `Current reference: ${currentReference}`,
    `Current translation: ${context.translation.toUpperCase()}`,
    `Available translations: ${context.availableTranslations.map((item) => item.value.toUpperCase()).join(", ")}`,
    `Transcript: ${transcript}`,
  ].join("\n");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3200);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0,
          top_p: 0.05,
          num_predict: 120,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama plan failed with ${response.status}`);
    }

    const payload = await response.json() as { response?: string };
    const plan = parsePlannedCommand(payload.response ?? "");
    if (!plan) {
      return null;
    }

    return resolvePlannedVoiceCommand(plan, transcript, context);
  } catch (err) {
    console.warn("[voiceBibleMatcher] Ollama planner failed:", err);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function normalizeVoiceQuoteQueryWithOllama(
  transcript: string,
  context: VoiceBibleContextPayload,
  settings: VoiceBibleSettings,
  options?: OllamaNormalizationOptions,
): Promise<string | null> {
  const resolved = await resolveOllamaNormalizerModel(settings);
  if (!resolved) {
    return null;
  }
  const { baseUrl, model } = resolved;
  const fastMode = Boolean(options?.fastMode);

  const currentReference =
    context.selectedBook && context.selectedChapter
      ? context.selectedVerse
        ? `${context.selectedBook} ${context.selectedChapter}:${context.selectedVerse}`
        : `${context.selectedBook} ${context.selectedChapter}`
      : "none";

  const prompt = fastMode
    ? [
        "Correct this noisy Bible quote fragment into a scripture search query.",
        "Return ONLY the corrected query or NONE.",
        "Prefer wording likely to appear in a Bible verse.",
        `Current reference: ${currentReference}`,
        `Current translation: ${context.translation.toUpperCase()}`,
        `Transcript: ${transcript}`,
      ].join("\n")
    : [
        "Rewrite a noisy spoken Bible quote fragment into a corrected scripture-search query.",
        "Return ONLY the corrected query text. Do not add punctuation or explanations.",
        "Fix obvious speech-to-text mistakes, missing grammar, and near-sounding words.",
        "Prefer wording that is likely to appear in a Bible verse.",
        "If the fragment is unusable, return NONE.",
        "",
        "Examples:",
        "reverse the captivity of zion -> turned again the captivity of zion",
        "for god so loved word -> for god so loved the world",
        "the valley of dry bonus -> valley of dry bones",
        "",
        `Current reference: ${currentReference}`,
        `Current translation: ${context.translation.toUpperCase()}`,
        `Transcript: ${transcript}`,
      ].join("\n");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), fastMode ? 1400 : 2500);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          top_p: fastMode ? 0.04 : 0.08,
          num_predict: fastMode ? 20 : 32,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama quote normalize failed with ${response.status}`);
    }

    const payload = await response.json() as { response?: string };
    const query = sanitizeGeneratedCommand(payload.response ?? "");
    if (!query || /^none$/i.test(query)) {
      return null;
    }
    return query;
  } catch (err) {
    console.warn("[voiceBibleMatcher] Ollama quote normalization failed:", err);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function dedupeScoredCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return candidates.reduce<ScoredCandidate[]>((accumulator, candidate) => {
    const existingIndex = accumulator.findIndex(
      (existing) =>
        existing.entry.book === candidate.entry.book &&
        existing.entry.chapter === candidate.entry.chapter &&
        existing.entry.verse === candidate.entry.verse &&
        existing.entry.endVerse === candidate.entry.endVerse,
    );

    if (existingIndex < 0) {
      accumulator.push(candidate);
      return accumulator;
    }

    if (candidate.score > accumulator[existingIndex].score) {
      accumulator[existingIndex] = candidate;
    }

    return accumulator;
  }, []);
}

async function resolveStructuredCommand(
  commandText: string,
  sourceTranscript: string,
  context: VoiceBibleContextPayload,
): Promise<VoiceBibleResult | null> {
  const normalizedCommand = normalizeSearchText(normalizeReferenceSpeech(commandText));
  const translationCommand = resolveTranslationCommand(
    commandText,
    context.availableTranslations,
  );
  if (translationCommand) {
    return {
      action: "set-translation",
      transcript: sourceTranscript,
      translation: translationCommand,
      detail: `Using ${translationCommand}`,
      confidence: 0.96,
    };
  }

  const extractedReference = extractReferenceCandidateFromSpeech(commandText);
  const referenceQuery = buildReferenceQuery(commandText);
  const parsedCandidates = parseBibleSearch(referenceQuery);
  const referenceMatch =
    extractedReference &&
    extractedReference.chapter !== null &&
    extractedReference.verse !== null
      ? extractedReference
      : parsedCandidates.find(
          (candidate) => candidate.chapter !== null && candidate.verse !== null,
        );
  if (
    referenceMatch &&
    referenceMatch.chapter !== null &&
    referenceMatch.verse !== null
  ) {
    let nextVerse = referenceMatch.verse;
    let nextChapter = referenceMatch.chapter;
    const overrideVerse = getExplicitVerseOverride(commandText, referenceMatch.verse);
    const verseCount = await getVerseCount(
      referenceMatch.book,
      referenceMatch.chapter,
      context.translation.toUpperCase(),
    );

    if (overrideVerse !== null) {
      if (overrideVerse <= verseCount) {
        nextVerse = overrideVerse;
      }
    } else if (/\bnext verse\b/.test(normalizedCommand)) {
      if (nextVerse < verseCount) {
        nextVerse += 1;
      } else {
        const maxChapter = BOOK_CHAPTERS[referenceMatch.book] ?? referenceMatch.chapter;
        if (referenceMatch.chapter < maxChapter) {
          nextChapter = referenceMatch.chapter + 1;
          nextVerse = 1;
        }
      }
    } else if (/\b(previous|prev) verse\b/.test(normalizedCommand)) {
      if (nextVerse > 1) {
        nextVerse -= 1;
      } else if (referenceMatch.chapter > 1) {
        nextChapter = referenceMatch.chapter - 1;
        nextVerse = await getVerseCount(
          referenceMatch.book,
          nextChapter,
          context.translation.toUpperCase(),
        );
      }
    }

    return {
      action: "stage-verse",
      transcript: sourceTranscript,
      book: referenceMatch.book,
      chapter: nextChapter,
      verse: nextVerse,
      translation: context.translation.toUpperCase(),
      detail: `${referenceMatch.book} ${nextChapter}:${nextVerse}`,
      confidence: 0.97,
    };
  }

  const chapterMatch =
    extractedReference &&
    extractedReference.chapter !== null &&
    extractedReference.verse === null
      ? extractedReference
      : parsedCandidates.find(
          (candidate) => candidate.chapter !== null && candidate.verse === null,
        );
  if (chapterMatch && chapterMatch.chapter !== null) {
    return {
      action: "set-chapter",
      transcript: sourceTranscript,
      book: chapterMatch.book,
      chapter: chapterMatch.chapter,
      translation: context.translation.toUpperCase(),
      detail: `${chapterMatch.book} chapter ${chapterMatch.chapter}`,
      confidence: 0.94,
    };
  }

  return resolveRelativeNavigation(commandText, context);
}

async function resolveRelativeNavigation(
  transcript: string,
  context: VoiceBibleContextPayload,
): Promise<VoiceBibleResult | null> {
  const normalized = normalizeSearchText(normalizeReferenceSpeech(transcript));
  const currentBook = context.selectedBook ?? undefined;
  const currentChapter = context.selectedChapter ?? undefined;
  const currentVerse = context.selectedVerse ?? undefined;
  const currentTranslation = context.translation.toUpperCase();

  if (!currentBook || !currentChapter) return null;

  const maxChapter = BOOK_CHAPTERS[currentBook] ?? currentChapter;
  const explicitVerseMatch = normalized.match(/\b(?:go to |move to |take me to )?verse (\d+)\b/);

  if (explicitVerseMatch) {
    const nextVerse = Number.parseInt(explicitVerseMatch[1], 10);
    const verseCount = await getVerseCount(currentBook, currentChapter, currentTranslation);

    if (Number.isFinite(nextVerse) && nextVerse >= 1 && nextVerse <= verseCount) {
      return {
        action: "stage-verse",
        transcript,
        book: currentBook,
        chapter: currentChapter,
        verse: nextVerse,
        translation: currentTranslation,
        detail: `Moved to ${currentBook} ${currentChapter}:${nextVerse}`,
        confidence: 0.94,
      };
    }
  }

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

  scored.sort(compareScoredCandidates);
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

    reranked.sort(compareScoredCandidates);
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
  options?: ResolveVoiceBibleIntentOptions,
): Promise<VoiceBibleResolvedIntent> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return {
      kind: "none",
      transcript,
      detail: "No transcript captured",
    };
  }

  const plannedCommand = options?.fastInterim
    ? null
    : await planVoiceCommandWithOllama(trimmed, context, settings);
  if (plannedCommand) {
    return {
      kind: "result",
      result: plannedCommand,
      candidates: [],
    };
  }

  const directCommand = await resolveStructuredCommand(trimmed, trimmed, context);
  if (directCommand) {
    return {
      kind: "result",
      result: directCommand,
      candidates: [],
    };
  }

  const normalizedCommand = options?.fastInterim
    ? await normalizeVoiceCommandWithOllama(trimmed, context, settings, {
        fastMode: true,
      })
    : await normalizeVoiceCommandWithOllama(trimmed, context, settings);
  if (normalizedCommand) {
    const normalizedResult = await resolveStructuredCommand(normalizedCommand, trimmed, context);
    if (normalizedResult) {
      const detailPrefix = normalizedCommand !== trimmed ? `Normalized to ${normalizedCommand}` : null;
      return {
        kind: "result",
        result: {
          ...normalizedResult,
          detail: detailPrefix
            ? normalizedResult.detail
              ? `${normalizedResult.detail} · ${detailPrefix}`
              : detailPrefix
            : normalizedResult.detail,
          confidence: Math.max(normalizedResult.confidence ?? 0.9, 0.93),
        },
        candidates: [],
      };
    }
  }

  const selectedTranslation = context.translation.toUpperCase();
  const heuristicQuoteQuery = await normalizeQuoteHeuristics(trimmed, selectedTranslation);
  const normalizedQuoteQuery = options?.fastInterim
    ? await normalizeVoiceQuoteQueryWithOllama(
        heuristicQuoteQuery,
        context,
        settings,
        { fastMode: true },
      )
    : await normalizeVoiceQuoteQueryWithOllama(
        heuristicQuoteQuery,
        context,
        settings,
      );

  const searchQueries = [trimmed];
  if (heuristicQuoteQuery && heuristicQuoteQuery !== trimmed) {
    searchQueries.push(heuristicQuoteQuery);
  }
  if (
    normalizedQuoteQuery &&
    normalizedQuoteQuery !== trimmed &&
    normalizedQuoteQuery !== heuristicQuoteQuery
  ) {
    searchQueries.push(normalizedQuoteQuery);
  }
  const primaryResults = dedupeScoredCandidates(
    (
      await Promise.all(
        searchQueries.map((query) => runLexicalSearch(query, selectedTranslation)),
      )
    )
      .flat()
      .sort((a, b) => b.score - a.score),
  );
  const shouldSearchKjv =
    selectedTranslation !== "KJV" &&
    (primaryResults.length === 0 || primaryResults[0].score < 0.72);
  const fallbackResults = shouldSearchKjv
    ? dedupeScoredCandidates(
        (
          await Promise.all(
            searchQueries.map((query) => runLexicalSearch(query, "KJV")),
          )
        )
          .flat()
          .sort((a, b) => b.score - a.score),
      )
    : [];

  const combined = dedupeScoredCandidates([...primaryResults, ...fallbackResults])
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const semanticQuery =
    (normalizedQuoteQuery && normalizedQuoteQuery !== trimmed
      ? normalizedQuoteQuery
      : heuristicQuoteQuery && heuristicQuoteQuery !== trimmed
        ? heuristicQuoteQuery
        : trimmed);
  const reranked = options?.fastInterim
    ? combined
    : await maybeSemanticRerank(semanticQuery, combined, settings);
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
        detail:
          normalizedQuoteQuery && normalizedQuoteQuery !== trimmed
            ? `${bestCandidate.label} · Matched from "${normalizedQuoteQuery}"`
            : bestCandidate.label,
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
      detail:
        normalizedQuoteQuery && normalizedQuoteQuery !== trimmed
          ? `Choose the closest match · normalized from "${normalizedQuoteQuery}"`
          : "Choose the closest match",
    };
  }

  return {
    kind: "none",
    transcript: trimmed,
    detail: "No confident verse match",
  };
}
