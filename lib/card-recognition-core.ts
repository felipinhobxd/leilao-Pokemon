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
};

export type ManualFieldMap = Partial<Record<RecognizableField, boolean>>;

const CARD_NUMBER_RE = /\b([A-Z]{0,3}\s*\d{1,4}[A-Z]?)\s*[\/|]\s*([A-Z]{0,3}\s*\d{1,4}[A-Z]?)\b/i;
const HP_RE = /\bHP\s*([0-9]{2,3})\b/i;

const stopNameLines = [
  "basic", "stage", "trainer", "energy", "pokémon", "pokemon", "item", "supporter", "stadium",
  "básico", "basico", "fase", "treinador", "energia", "objeto", "apoiador",
  "básico", "etapa", "entrenador", "energía", "energia", "objeto",
];

const languageWords: Record<Exclude<RecognitionLanguage, "ja">, string[]> = {
  "pt-BR": ["fraqueza", "resistência", "recuo", "básico", "durante", "próximo", "dano", "seu", "sua", "ataque", "jogue", "baralho", "descartar"],
  en: ["weakness", "resistance", "retreat", "basic", "during", "next", "damage", "your", "attack", "discard", "deck", "opponent"],
  es: ["debilidad", "resistencia", "retirada", "básico", "durante", "turno", "daño", "ataque", "baraja", "descarta", "rival", "energía"],
};

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

function normalizeNumberPart(value: string) {
  return value.toUpperCase().replace(/\s+/g, "").replace(/(?<=\d)[OQ](?=\d|$)/g, "0");
}

export function extractCardNumber(text: string) {
  const cleaned = normalizeRecognitionText(text).replace(/\\/g, "/");
  const match = cleaned.match(CARD_NUMBER_RE);
  if (!match) return { cardNumber: "", localId: "", denominator: null as number | null };
  const localId = normalizeNumberPart(match[1]);
  const denominatorRaw = normalizeNumberPart(match[2]);
  const denominatorDigits = denominatorRaw.match(/\d{1,4}/)?.[0] ?? "";
  return {
    cardNumber: `${localId}/${denominatorRaw}`,
    localId,
    denominator: denominatorDigits ? Number(denominatorDigits) : null,
  };
}

export function extractHp(text: string) {
  const match = normalizeRecognitionText(text).match(HP_RE);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 10 && value <= 1000 ? value : null;
}

export function extractLikelyName(topText: string) {
  const lines = String(topText ?? "")
    .split(/\r?\n/)
    .map(line => normalizeRecognitionText(line).replace(/\bHP\s*\d{2,3}\b/gi, "").trim())
    .filter(Boolean);

  const scored = lines.map(line => {
    const normalized = normalizeForCompare(line);
    if (!normalized || line.length > 44 || line.length < 2) return { line, score: -100 };
    const words = normalized.split(/\s+/);
    let score = /[A-Za-zÀ-ÿぁ-んァ-ン一-龯]/.test(line) ? 20 : 0;
    if (words.length <= 5) score += 8;
    if (/^[\p{L}\p{N} .:'’\-♀♂]+$/u.test(line)) score += 6;
    if (/\d{2,}/.test(line)) score -= 12;
    if (stopNameLines.some(stop => normalized.includes(normalizeForCompare(stop)))) score -= 18;
    if (/weakness|resistance|retreat|fraqueza|resistencia|debilidad|energia|energy/i.test(normalized)) score -= 30;
    return { line: line.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}♀♂]+$/gu, "").trim(), score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 18 ? scored[0].line : "";
}

export function detectRecognitionLanguage(text: string): { language: RecognitionLanguage | null; confidence: number } {
  const raw = String(text ?? "");
  const japanese = raw.match(/[ぁ-んァ-ン一-龯]/g)?.length ?? 0;
  const visible = raw.replace(/\s/g, "").length;
  if (japanese >= 3 && (visible === 0 || japanese / visible >= 0.08)) {
    return { language: "ja", confidence: Math.min(99, 72 + japanese * 2) };
  }

  const normalized = ` ${normalizeForCompare(raw)} `;
  const scores = (Object.entries(languageWords) as Array<[Exclude<RecognitionLanguage, "ja">, string[]]>).map(([language, words]) => {
    let score = 0;
    for (const word of words) {
      const needle = ` ${normalizeForCompare(word)} `;
      if (normalized.includes(needle)) score += word.length >= 8 ? 3 : 2;
    }
    return { language, score };
  }).sort((a, b) => b.score - a.score);
  const first = scores[0];
  const second = scores[1];
  if (!first || first.score < 2) return { language: null, confidence: 0 };
  const margin = first.score - (second?.score ?? 0);
  return { language: first.language, confidence: Math.min(96, 48 + first.score * 6 + margin * 5) };
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

export function safeVariant(variants: Record<string, unknown> | null | undefined) {
  if (!variants) return undefined;
  const mapped: Array<[string, string]> = [["normal", "Normal"], ["holo", "Holo"], ["reverse", "Reverse Holo"]];
  const available = mapped.filter(([key]) => variants[key] === true).map(([, label]) => label);
  return available.length === 1 ? available[0] : undefined;
}

export function scoreRecognitionCandidate(candidate: Omit<RecognitionCandidate, "score">, hints: OcrHints) {
  let score = 0;
  if (hints.localId && normalizeNumberPart(candidate.localId) === normalizeNumberPart(hints.localId)) score += 36;
  if (hints.denominator && candidate.denominator === hints.denominator) score += 20;
  if (hints.name) {
    const similarity = stringSimilarity(hints.name, candidate.name);
    score += Math.round(similarity * 28);
    if (similarity >= 0.92) score += 6;
  }
  if (hints.language && hints.language === candidate.language) score += Math.round(5 + 7 * hints.languageConfidence / 100);
  if (hints.hp && candidate.hp && hints.hp === candidate.hp) score += 8;
  return Math.max(0, Math.min(100, score));
}

export function rankRecognitionCandidates(candidates: Array<Omit<RecognitionCandidate, "score">>, hints: OcrHints) {
  return candidates
    .map(candidate => ({ ...candidate, score: scoreRecognitionCandidate(candidate, hints) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function recognitionLevel(confidence: number): RecognitionLevel {
  if (confidence >= 82) return "high";
  if (confidence >= 58) return "medium";
  return "low";
}

export function resultFromCandidates(hints: OcrHints, candidates: RecognitionCandidate[], elapsedMs: number, catalogRequests: number, source: "cache" | "ocr" = "ocr"): RecognitionResult {
  const best = candidates[0];
  const runnerUp = candidates[1];
  const separation = best ? best.score - (runnerUp?.score ?? 0) : 0;
  const confidence = best ? Math.max(0, Math.min(99, Math.round(best.score * 0.86 + Math.min(13, separation)))) : 0;
  const level = recognitionLevel(confidence);
  if (!best || level === "low") return { confidence, level, candidates, hints, source, elapsedMs, catalogRequests };
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
