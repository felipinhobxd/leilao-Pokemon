export type RecognitionLanguage = "pt-BR" | "en" | "es" | "ja";
export type RecognitionLevel = "high" | "medium" | "low";
export type RecognizableField = "name" | "collection" | "cardNumber" | "language" | "variant";

export type OcrHints = {
  name: string;
  cardNumber: string;
  localId: string;
  denominator: number | null;
  hp: number | null;
  language: RecognitionLanguage | null;
  languageConfidence: number;
  text: string;
  nameConfidence?: number;
  numberConfidence?: number;
  hpConfidence?: number;
  localIdVariants?: string[];
  denominatorVariants?: number[];
};

export type CandidateEvidence = {
  fullNumberMatch: boolean;
  localIdMatch: boolean;
  denominatorMatch: boolean;
  localIdSimilarity: number;
  nameSimilarity: number;
  languageMatch: boolean;
  hpMatch: boolean;
  strongEvidence: boolean;
  visualMatch?: boolean;
};

export type RecognitionCandidate = {
  id: string;
  name: string;
  collection: string;
  cardNumber: string;
  localId: string;
  denominator: number | null;
  language: RecognitionLanguage;
  hp: number | null;
  image: string | null;
  variant?: string;
  score: number;
  evidence?: CandidateEvidence;
  visualSimilarity?: number;
};

export type RecognitionResult = {
  confidence: number;
  level: RecognitionLevel;
  name?: string;
  collection?: string;
  cardNumber?: string;
  language?: RecognitionLanguage;
  variant?: string;
  candidates: RecognitionCandidate[];
  hints: OcrHints;
  source: "cache" | "ocr";
  elapsedMs: number;
  catalogRequests: number;
  visualUsed?: boolean;
  visualBackend?: string;
  visualStatus?: "not-needed" | "no-candidates" | "insufficient-clues" | "loading" | "compared" | "failed";
  visualError?: string;
  visualReason?: string;
  visualCandidateCount?: number;
  visualInitMs?: number;
  visualSimilarities?: number[];
  visualCandidatePool?: RecognitionCandidate[];
  catalogCandidatesBefore?: number;
  catalogCandidatesAfter?: number;
  catalogBudgetExhausted?: boolean;
  catalogStrategy?: "set+localId" | "set-index+search" | "search";
  catalogSetCandidates?: string[];
  catalogSetIndexSource?: "memory" | "persistent" | "network" | "stale";
  catalogQueries?: string[];
};

export type ManualFieldMap = Partial<Record<RecognizableField, boolean>>;

const CARD_NUMBER_RE = /(?<![\p{L}\p{N}])([A-Z]{0,3}\s*[0-9OQILlS]{1,4})\s*[\\/|]\s*([A-Z]{0,3}\s*[0-9OQILlS]{1,4})/giu;
const HP_RE = /\b(?:HP|PS)\s*([0-9]{2,3})\b/i;

const stopNameLines = [
  "basic", "stage", "trainer", "energy", "pokémon", "pokemon", "item", "supporter", "stadium",
  "básico", "basico", "fase", "treinador", "energia", "objeto", "apoiador",
  "etapa", "entrenador", "energía", "estágio", "estagio",
];

const languageWords: Record<Exclude<RecognitionLanguage, "ja">, Array<[string, number]>> = {
  "pt-BR": [
    ["fraqueza", 6], ["recuo", 6], ["baralho", 6], ["procure", 5], ["jogue", 4],
    ["resistência", 3], ["básico", 2], ["altura", 2], ["peso", 2], ["seu", 3], ["sua", 3],
    ["próximo", 3], ["dano", 3], ["ataque", 2], ["descartar", 4], ["pokémon", 1],
  ],
  en: [
    ["weakness", 6], ["retreat", 6], ["deck", 6], ["search", 5], ["discard", 5],
    ["resistance", 3], ["basic", 2], ["height", 2], ["weight", 2], ["your", 3],
    ["next", 3], ["damage", 3], ["attack", 2], ["opponent", 4], ["pokemon", 1],
  ],
  es: [
    ["debilidad", 6], ["retirada", 6], ["baraja", 6], ["busca", 5], ["descarta", 5],
    ["resistencia", 3], ["básico", 2], ["altura", 2], ["peso", 2], ["tu", 3],
    ["turno", 3], ["daño", 4], ["ataque", 2], ["rival", 4], ["pokémon", 1],
  ],
};

const rulesVocabulary = new Set(
  Object.values(languageWords).flat().map(([word]) => normalizeForCompare(word)),
);

export function normalizeRecognitionText(value: string) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(value: string) {
  return normalizeRecognitionText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitCollectorPart(value: string) {
  const compact = String(value ?? "").toUpperCase().replace(/\s+/g, "");
  const prefix = compact.match(/^[A-Z]{1,3}(?=[0-9OQILS])/i)?.[0] ?? "";
  let digits = compact.slice(prefix.length);
  digits = digits
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/S/g, "5")
    .replace(/[^0-9]/g, "");
  return { prefix, digits };
}

export function normalizeCollectorPart(value: string) {
  const { prefix, digits } = splitCollectorPart(value);
  return `${prefix}${digits}`;
}

export function collectorPartVariants(value: string, denominator?: number | null) {
  const normalized = normalizeCollectorPart(value);
  const { prefix, digits } = splitCollectorPart(normalized);
  if (!digits) return normalized ? [normalized] : [];
  const variants = new Set<string>([normalized]);
  const numeric = Number(digits);
  if (Number.isFinite(numeric)) variants.add(`${prefix}${numeric}`);

  // OCR frequently absorbs a nearby set/rarity glyph as one extra leading digit.
  // Keep this only as a catalog-validated alternative, never as the displayed value.
  if (!prefix && digits.length === 4 && denominator && numeric > denominator * 3) {
    variants.add(String(Number(digits.slice(1))));
    variants.add(digits.slice(1));
  }
  return [...variants].filter(Boolean);
}

function denominatorAlternatives(raw: string) {
  const { digits } = splitCollectorPart(raw);
  if (!digits) return [] as number[];
  const variants = new Set<number>();
  const value = Number(digits);
  if (Number.isFinite(value)) variants.add(value);
  // Common OCR artifact: the rarity dot/copyright glyph becomes a trailing zero.
  if (digits.length === 4 && digits.endsWith("0")) {
    const trimmed = Number(digits.slice(0, -1));
    if (trimmed > 0) variants.add(trimmed);
  }
  return [...variants];
}

function numberMatchScore(localId: string, denominator: number | null) {
  const local = splitCollectorPart(localId);
  const localValue = Number(local.digits);
  let score = 0;
  if (local.digits) score += 4;
  if (denominator && denominator >= 20 && denominator <= 500) score += 5;
  if (Number.isFinite(localValue) && denominator && localValue <= denominator + 100) score += 3;
  if (local.prefix) score += 2;
  return score;
}

export function extractCardNumber(text: string) {
  const cleaned = normalizeRecognitionText(text).replace(/\\/g, "/");
  const matches = [...cleaned.matchAll(CARD_NUMBER_RE)];
  if (!matches.length) {
    return {
      cardNumber: "",
      localId: "",
      denominator: null as number | null,
      localIdVariants: [] as string[],
      denominatorVariants: [] as number[],
    };
  }

  const parsed = matches.map(match => {
    const localId = normalizeCollectorPart(match[1]);
    const denominatorPart = normalizeCollectorPart(match[2]);
    const denominatorVariants = denominatorAlternatives(denominatorPart);
    const denominator = denominatorVariants[0] ?? null;
    return {
      localId,
      denominatorPart,
      denominator,
      denominatorVariants,
      score: numberMatchScore(localId, denominator),
    };
  }).sort((a, b) => b.score - a.score);

  const best = parsed[0];
  const localIdVariants = collectorPartVariants(best.localId, best.denominator);
  return {
    cardNumber: `${best.localId}/${best.denominatorPart}`,
    localId: best.localId,
    denominator: best.denominator,
    localIdVariants,
    denominatorVariants: best.denominatorVariants,
  };
}

export function extractHp(text: string) {
  const match = normalizeRecognitionText(text).match(HP_RE);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 10 && value <= 1000 ? value : null;
}

function cleanNameLine(line: string) {
  // Reject the original sentence before removing vocabulary; otherwise rule fragments become names.
  const rawWords = normalizeForCompare(line).split(/\s+/);
  if (rawWords.filter(word => rulesVocabulary.has(word)).length >= 2 ||
      /\b(?:during|durante|evolves from|evolui de|flip a coin|this pokemon|este pokemon)\b/.test(normalizeForCompare(line))) return "";
  let value = normalizeRecognitionText(line)
    .replace(/\b(?:HP|PS)\s*\d{2,3}\b/gi, " ")
    .replace(/\b\d{2,4}\b/g, " ")
    .replace(/\b(?:BASIC|BASICO|BÁSICO|STAGE|ESTAGIO|ESTÁGIO|FASE)\s*\d*\b/gi, " ");

  const tokens = value.match(/[\p{L}][\p{L}.'’\-♀♂]{1,24}/gu) ?? [];
  const useful = tokens.filter(token => {
    const normalized = normalizeForCompare(token);
    if (!normalized || (normalized.length < 3 && !["mr", "jr", "ex", "gx", "v"].includes(normalized))) return false;
    if (stopNameLines.some(stop => normalized === normalizeForCompare(stop))) return false;
    if (rulesVocabulary.has(normalized)) return false;
    return true;
  });

  // Preserve common multi-word Pokémon names while discarding short OCR garbage around them.
  value = useful.slice(0, 3).join(" ").trim();
  return value;
}

export function extractLikelyName(topText: string) {
  const lines = String(topText ?? "")
    .split(/\r?\n|\s{3,}/)
    .map(line => ({ raw: line, clean: cleanNameLine(line) }))
    .filter(item => item.clean);

  const scored = lines.map((item, index) => {
    const normalized = normalizeForCompare(item.clean);
    const words = normalized.split(/\s+/).filter(Boolean);
    const ruleWordCount = words.filter(word => rulesVocabulary.has(word)).length;
    let score = /[A-Za-zÀ-ÿぁ-んァ-ン一-龯]/.test(item.clean) ? 20 : 0;
    if (index === 0) score += 8;
    else if (index === 1) score += 4;
    if (words.length <= 3) score += 8;
    if (item.clean.length >= 4 && item.clean.length <= 24) score += 7;
    if (ruleWordCount >= 2) score -= 45;
    if (stopNameLines.some(stop => normalized.includes(normalizeForCompare(stop)))) score -= 22;
    return { line: item.clean, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 22 ? scored[0].line : "";
}

export function detectRecognitionLanguage(text: string): { language: RecognitionLanguage | null; confidence: number } {
  const raw = String(text ?? "");
  const japanese = raw.match(/[ぁ-んァ-ン一-龯]/g)?.length ?? 0;
  const visible = raw.replace(/\s/g, "").length;
  if (japanese >= 3 && (visible === 0 || japanese / visible >= 0.08)) {
    return { language: "ja", confidence: Math.min(99, 76 + japanese * 2) };
  }

  const normalized = ` ${normalizeForCompare(raw)} `;
  const scores = (Object.entries(languageWords) as Array<[Exclude<RecognitionLanguage, "ja">, Array<[string, number]>]>).map(([language, words]) => {
    let score = 0;
    let hits = 0;
    for (const [word, weight] of words) {
      const needle = ` ${normalizeForCompare(word)} `;
      if (normalized.includes(needle)) { score += weight; hits += 1; }
    }
    return { language, score, hits };
  }).sort((a, b) => b.score - a.score);

  const first = scores[0];
  const second = scores[1];
  if (!first || first.score < 4) return { language: null, confidence: 0 };
  const margin = first.score - (second?.score ?? 0);
  if (margin <= 0 && first.score < 9) return { language: null, confidence: 0 };
  const confidence = Math.min(98, 48 + first.score * 3 + Math.max(0, margin) * 4 + Math.min(10, first.hits * 2));
  return { language: first.language, confidence };
}

export function buildOcrHints(topText: string, bottomText: string, centerText = ""): OcrHints {
  const combined = [topText, centerText, bottomText].filter(Boolean).join("\n");
  const number = extractCardNumber(bottomText || combined);
  const detected = detectRecognitionLanguage(combined);
  return {
    name: extractLikelyName(topText),
    cardNumber: number.cardNumber,
    localId: number.localId,
    denominator: number.denominator,
    hp: extractHp(topText),
    language: detected.language,
    languageConfidence: detected.confidence,
    text: normalizeRecognitionText(combined),
    localIdVariants: number.localIdVariants,
    denominatorVariants: number.denominatorVariants,
  };
}

function levenshtein(a: string, b: string) {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let before = prev[0];
    prev[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, before + (left[i - 1] === right[j - 1] ? 0 : 1));
      before = old;
    }
  }
  return prev[right.length];
}

export function stringSimilarity(a: string, b: string) {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  const size = Math.max(left.length, right.length);
  if (!size) return 1;
  return Math.max(0, 1 - levenshtein(left, right) / size);
}

function collectorSimilarity(a: string, b: string) {
  const left = splitCollectorPart(a);
  const right = splitCollectorPart(b);
  if (!left.digits || !right.digits) return 0;
  if (left.prefix && right.prefix && left.prefix !== right.prefix) return 0;
  const direct = stringSimilarity(left.digits, right.digits);
  const numericEqual = Number(left.digits) === Number(right.digits);
  return numericEqual ? 1 : direct;
}

function denominatorMatches(candidate: number | null, hints: OcrHints) {
  if (!candidate) return false;
  const variants = hints.denominatorVariants?.length ? hints.denominatorVariants : (hints.denominator ? [hints.denominator] : []);
  return variants.includes(candidate);
}

function localIdMatches(candidate: string, hints: OcrHints) {
  const variants = hints.localIdVariants?.length ? hints.localIdVariants : collectorPartVariants(hints.localId, hints.denominator);
  return variants.some(value => collectorSimilarity(value, candidate) === 1);
}

export function candidateEvidence(candidate: Omit<RecognitionCandidate, "score" | "evidence">, hints: OcrHints): CandidateEvidence {
  const localIdMatch = Boolean(hints.localId) && localIdMatches(candidate.localId, hints);
  const denominatorMatch = denominatorMatches(candidate.denominator, hints);
  const fullNumberMatch = localIdMatch && denominatorMatch;
  const localIdSimilarity = hints.localId ? Math.max(
    collectorSimilarity(hints.localId, candidate.localId),
    ...(hints.localIdVariants ?? []).map(value => collectorSimilarity(value, candidate.localId)),
  ) : 0;
  const nameSimilarity = hints.name ? stringSimilarity(hints.name, candidate.name) : 0;
  const languageMatch = Boolean(hints.language && hints.language === candidate.language);
  const hpMatch = Boolean(hints.hp && candidate.hp && hints.hp === candidate.hp);
  const strongEvidence = fullNumberMatch || localIdMatch || nameSimilarity >= 0.72;
  return { fullNumberMatch, localIdMatch, denominatorMatch, localIdSimilarity, nameSimilarity, languageMatch, hpMatch, strongEvidence };
}

export function safeVariant(variants: Record<string, unknown> | null | undefined) {
  if (!variants) return undefined;
  const mapped: Array<[string, string]> = [["normal", "Normal"], ["holo", "Holo"], ["reverse", "Reverse Holo"]];
  const available = mapped.filter(([key]) => variants[key] === true).map(([, label]) => label);
  return available.length === 1 ? available[0] : undefined;
}

export function scoreRecognitionCandidate(candidate: Omit<RecognitionCandidate, "score" | "evidence">, hints: OcrHints) {
  const evidence = candidateEvidence(candidate, hints);
  let score = 0;

  if (evidence.fullNumberMatch) score += 55;
  else {
    if (evidence.localIdMatch) score += 38;
    else if (evidence.localIdSimilarity >= 0.66) score += Math.round(16 * evidence.localIdSimilarity);
    if (evidence.denominatorMatch) score += 16;
  }

  if (evidence.nameSimilarity >= 0.98) score += 40;
  else if (evidence.nameSimilarity >= 0.90) score += 32;
  else if (evidence.nameSimilarity >= 0.80) score += 23;
  else if (evidence.nameSimilarity >= 0.72) score += 14;

  if (evidence.languageMatch) score += Math.round(6 + 4 * hints.languageConfidence / 100);
  if (evidence.hpMatch) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function rankRecognitionCandidates(candidates: Array<Omit<RecognitionCandidate, "score" | "evidence">>, hints: OcrHints) {
  const ranked = candidates
    .map(candidate => {
      const evidence = candidateEvidence(candidate, hints);
      return { ...candidate, score: scoreRecognitionCandidate(candidate, hints), evidence };
    })
    .filter(candidate => candidate.score >= 45 && candidate.evidence.strongEvidence)
    .sort((a, b) => b.score - a.score || b.evidence.nameSimilarity - a.evidence.nameSimilarity)
    .slice(0, 5);
  return ranked;
}

// Partial evidence is eligible for comparison, not for display/autofill.
export function visualCandidatePool(candidates: Array<Omit<RecognitionCandidate, "score" | "evidence">>, hints: OcrHints): RecognitionCandidate[] {
  return candidates.map(candidate => ({ ...candidate, evidence: candidateEvidence(candidate, hints), score: scoreRecognitionCandidate(candidate, hints) }))
    .filter(c => c.image && (c.evidence.localIdMatch ||
      (hints.name.length >= 4 && c.evidence.nameSimilarity >= 0.55) ||
      (c.evidence.denominatorMatch && c.evidence.localIdSimilarity >= 0.66)))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5);
}

export function recognitionLevel(confidence: number): RecognitionLevel {
  if (confidence >= 86) return "high";
  if (confidence >= 60) return "medium";
  return "low";
}

export function resultFromCandidates(hints: OcrHints, candidates: RecognitionCandidate[], elapsedMs: number, catalogRequests: number, source: "cache" | "ocr" = "ocr"): RecognitionResult {
  const best = candidates[0];
  const runnerUp = candidates[1];
  if (!best) return { confidence: 0, level: "low", candidates: [], hints, source, elapsedMs, catalogRequests };

  const evidence = best.evidence ?? candidateEvidence(best, hints);
  const runnerEvidence = runnerUp?.evidence ?? (runnerUp ? candidateEvidence(runnerUp, hints) : undefined);
  const separation = best.score - (runnerUp?.score ?? 0);
  let confidence = Math.min(98, Math.round(best.score * 0.9 + Math.min(8, Math.max(0, separation))));

  if (evidence.fullNumberMatch && evidence.nameSimilarity >= 0.90) confidence = 99;
  else if (evidence.fullNumberMatch && evidence.nameSimilarity >= 0.72) confidence = Math.max(confidence, 95);
  else if (evidence.fullNumberMatch) confidence = Math.max(confidence, 89);
  else if (evidence.nameSimilarity >= 0.98 && evidence.denominatorMatch) confidence = Math.max(confidence, 91);
  else if (evidence.nameSimilarity >= 0.98 && evidence.languageMatch) confidence = Math.max(confidence, 84);

  // Two nearly-equal candidates must remain reviewable. This also covers the common
  // case where two different sets share the same printed collector number.
  if (runnerUp && separation < 7 && (runnerUp.score >= 60 || (evidence.fullNumberMatch && runnerEvidence?.fullNumberMatch))) {
    confidence = Math.min(confidence, 79);
  }

  const level = recognitionLevel(confidence);
  if (level === "low") return { confidence, level, candidates, hints, source, elapsedMs, catalogRequests };
  return {
    confidence,
    level,
    name: best.name,
    collection: best.collection,
    cardNumber: best.cardNumber,
    language: best.language,
    variant: best.variant,
    candidates,
    hints,
    source,
    elapsedMs,
    catalogRequests,
  };
}

export function mergeRecognitionFields<T extends Record<string, unknown>>(current: T, manual: ManualFieldMap, result: RecognitionResult, force = false): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const field of ["name", "collection", "cardNumber", "language", "variant"] as const) {
    const value = result[field];
    if (value != null && String(value).trim() && (force || !manual[field])) patch[field] = value;
  }
  return patch as Partial<T>;
}
