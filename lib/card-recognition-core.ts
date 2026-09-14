// Compatibility wrapper around the proven recognition core. It keeps the existing
// scoring/parser implementation intact while tightening two high-impact real-photo cases:
// slash-less collector numbers from OCR and overconfident name-only matches.
export * from "./card-recognition-core-legacy.ts";

import * as legacy from "./card-recognition-core-legacy.ts";
import type { OcrHints, RecognitionCandidate, RecognitionResult } from "./card-recognition-core-legacy.ts";

const LOOSE_NUMBER_RE = /(?<![\p{L}\p{N}])([A-Z]{0,3}\s*[0-9OQILlS]{1,4})\s*(?:[-:·•]|\s{1,5})\s*([A-Z]{0,3}\s*[0-9OQILlS]{2,4})(?![\p{L}\p{N}])/giu;

function numericPart(value: string) {
  const digits = legacy.normalizeCollectorPart(value).replace(/^[A-Z]+/i, "").replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
}

function plausibleLooseNumber(localId: string, denominatorPart: string) {
  const local = numericPart(localId);
  const denominator = numericPart(denominatorPart);
  if (!Number.isFinite(local) || !Number.isFinite(denominator)) return false;
  if (denominator < 20 || denominator > 700 || local < 0) return false;
  if (local >= 1900 && local <= 2100) return false; // copyright years are not collector ids
  return local <= Math.max(denominator * 3, denominator + 180);
}

export function extractCardNumber(text: string) {
  const strict = legacy.extractCardNumber(text);
  if (strict.localId && strict.denominator) return strict;

  const cleaned = legacy.normalizeRecognitionText(text).replace(/\\/g, "/");
  const matches = [...cleaned.matchAll(LOOSE_NUMBER_RE)]
    .map(match => {
      const localId = legacy.normalizeCollectorPart(match[1]);
      const denominatorPart = legacy.normalizeCollectorPart(match[2]);
      const denominator = numericPart(denominatorPart);
      const local = numericPart(localId);
      const prefixBonus = /^[A-Z]/i.test(localId) ? 2 : 0;
      const widthBonus = String(Math.max(0, local)).length <= 3 ? 2 : 0;
      return { localId, denominatorPart, denominator, score: prefixBonus + widthBonus };
    })
    .filter(value => plausibleLooseNumber(value.localId, value.denominatorPart))
    .sort((a, b) => b.score - a.score);

  const best = matches[0];
  if (!best) return strict;
  return {
    cardNumber: `${best.localId}/${best.denominatorPart}`,
    localId: best.localId,
    denominator: best.denominator,
    localIdVariants: legacy.collectorPartVariants(best.localId, best.denominator),
    denominatorVariants: [best.denominator],
  };
}

export function buildOcrHints(topText: string, bottomText: string, centerText = ""): OcrHints {
  const combined = [topText, centerText, bottomText].filter(Boolean).join("\n");
  const number = extractCardNumber(bottomText || combined);
  const detected = legacy.detectRecognitionLanguage(combined);
  return {
    name: legacy.extractLikelyName(topText),
    cardNumber: number.cardNumber,
    localId: number.localId,
    denominator: number.denominator,
    hp: legacy.extractHp(topText),
    language: detected.language,
    languageConfidence: detected.confidence,
    text: legacy.normalizeRecognitionText(combined),
    localIdVariants: number.localIdVariants,
    denominatorVariants: number.denominatorVariants,
  };
}

// Keep the public return type intentionally broad. The legacy implementation internally
// produces candidates with evidence populated, but consumers such as visual rescue can
// legally enrich/reorder RecognitionCandidate objects where evidence remains optional.
export function rankRecognitionCandidates(
  candidates: Parameters<typeof legacy.rankRecognitionCandidates>[0],
  hints: OcrHints,
): RecognitionCandidate[] {
  const safe = catalogHints(hints);
  return candidates.map(candidate => {
    const evidence = legacy.candidateEvidence(candidate, safe);
    let score = legacy.scoreRecognitionCandidate(candidate, safe);
    if (hints.name && (hints.nameConfidence ?? 0.8) >= 0.8 && evidence.nameSimilarity < 0.55) score -= 80;
    if (evidence.nameSimilarity >= 0.90) score = Math.max(score, 48);
    return { ...candidate, score: Math.max(0, score), evidence };
  }).filter(candidate => candidate.score >= 40 && candidate.evidence.strongEvidence)
    .sort((a, b) => b.score - a.score || b.evidence.nameSimilarity - a.evidence.nameSimilarity).slice(0, 12);
}

function removeAutofillFields(result: RecognitionResult) {
  delete result.name;
  delete result.collection;
  delete result.cardNumber;
  delete result.language;
  delete result.variant;
}

export function resultFromCandidates(
  hints: OcrHints,
  candidates: RecognitionCandidate[],
  elapsedMs: number,
  catalogRequests: number,
  source: "cache" | "ocr" = "ocr",
): RecognitionResult {
  const result = legacy.resultFromCandidates(hints, candidates, elapsedMs, catalogRequests, source);
  const best = candidates[0];
  if (!best) return result;
  const evidence = best.evidence ?? legacy.candidateEvidence(best, hints);

  // Precision first: a Pokémon name (even exact) identifies the species, not the printing.
  // High confidence requires the printed number or a decisive exact-art visual match.
  if (!evidence.fullNumberMatch && !evidence.visualMatch) {
    let cap = 59;
    if ((evidence.localIdMatch || evidence.denominatorMatch) && evidence.nameSimilarity >= 0.90) cap = 79;
    else if (evidence.nameSimilarity >= 0.98 && evidence.hpMatch && evidence.languageMatch) cap = 69;
    result.confidence = Math.min(result.confidence, cap);
    result.level = legacy.recognitionLevel(result.confidence);
    if (result.level === "low") removeAutofillFields(result);
  }
  return result;
}

/** Weak OCR is a hypothesis, never a catalog filter. Confidence is in [0, 1]. */
export function catalogHints(hints: OcrHints): OcrHints {
  const reliable = Boolean(hints.localId && hints.denominator && (hints.numberConfidence ?? 0.8) >= 0.8);
  return reliable ? hints : { ...hints, localId: "", cardNumber: "", denominator: null, localIdVariants: [], denominatorVariants: [] };
}
