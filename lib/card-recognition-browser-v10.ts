"use client";

import * as v9 from "./card-recognition-browser-v9";
import { normalizeCardPhoto, cardNormalizationRuntime, type CardNormalization } from "./card-recognition-normalize";
import {
  normalizeCardWithCornelius,
  shutdownCorneliusRecognition,
  corneliusRuntime,
  type CorneliusNormalization,
} from "./card-recognition-cornelius";
import { runPpOcr, shutdownPpOcr, ppOcrRuntime, type PpOcrOutcome } from "./card-recognition-ppocr";
import { recognizeVisually, shutdownVisualRecognition, type VisualOutcome } from "./card-recognition-visual";
import {
  lookupRecognitionMemory,
  memoryMatchCandidate,
  recognitionMemoryRuntime,
  type RecognitionMemoryOutcome,
} from "./card-recognition-memory";
import { preserveCandidateCollectorWidth, preserveResultCollectorWidth } from "./card-recognition-format";
import { resultFromCandidates, type RecognitionCandidate, type RecognitionResult } from "./card-recognition-core";

let tail: Promise<unknown> = Promise.resolve();
type Normalization = CardNormalization | CorneliusNormalization;

export type RecognitionDecision = "IDENTIFICADA" | "PROVÁVEL" | "INCERTA";
export type V10RecognitionResult = RecognitionResult & {
  decisionStatus?: RecognitionDecision;
  confidenceKind?: "evidence-score-not-calibrated-probability";
  normalization?: { method: Normalization["method"]; confidence: number; rotation: number };
  neuralOcr?: {
    status: PpOcrOutcome["status"];
    lineCount: number;
    averageConfidence: number;
    elapsedMs: number;
    backend?: string;
    error?: string;
  };
  recognitionMemory?: {
    status: RecognitionMemoryOutcome["status"];
    fingerprint: string;
    matches: number;
    confident: boolean;
    veryStrong: boolean;
    elapsedMs: number;
    error?: string;
  };
  exactVisual?: {
    status: VisualOutcome["status"];
    used: boolean;
    backend?: string;
    candidateCount: number;
    error?: string;
    reason?: string;
  };
  independentEvidence?: string[];
};

function normalizedText(value: string | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sameCard(a: RecognitionCandidate | undefined, b: RecognitionCandidate | undefined) {
  if (!a || !b) return false;
  if (a.id && b.id && !a.id.startsWith("memory:") && !b.id.startsWith("memory:") && a.id === b.id) return true;
  const numberA = normalizedText(a.cardNumber);
  const numberB = normalizedText(b.cardNumber);
  const nameA = normalizedText(a.name);
  const nameB = normalizedText(b.name);
  return Boolean(numberA && numberB && numberA === numberB && nameA && nameB && nameA === nameB);
}

function numberAgrees(result: RecognitionResult, candidate: RecognitionCandidate) {
  const evidence = candidate.evidence;
  if (evidence?.fullNumberMatch) return true;
  const hintLocal = normalizedText(result.hints.localId);
  const candidateLocal = normalizedText(candidate.localId);
  const denominator = result.hints.denominator;
  return Boolean(
    hintLocal && candidateLocal &&
    (hintLocal === candidateLocal || Number(hintLocal.replace(/\D/g, "")) === Number(candidateLocal.replace(/\D/g, ""))) &&
    denominator && candidate.denominator && denominator === candidate.denominator
  );
}

function exactCatalogDecision(result: RecognitionResult) {
  const first = result.candidates[0];
  const second = result.candidates[1];
  const evidence = first?.evidence;
  if (!first || !evidence?.fullNumberMatch || evidence.nameSimilarity < 0.90) return false;
  if (second?.evidence?.fullNumberMatch && second.score >= first.score - 6) return false;
  return true;
}

function ocrQuality(result: RecognitionResult) {
  const evidence = result.candidates[0]?.evidence;
  return Number(exactCatalogDecision(result)) * 500
    + Number(Boolean(evidence?.fullNumberMatch)) * 220
    + Number(Boolean(evidence?.localIdMatch)) * 80
    + Math.round((evidence?.nameSimilarity ?? 0) * 100)
    + (result.level === "high" ? 60 : result.level === "medium" ? 30 : 0)
    + result.confidence;
}

function chooseOcr(primary: RecognitionResult | undefined, fallback: RecognitionResult | undefined) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return ocrQuality(primary) >= ocrQuality(fallback) ? primary : fallback;
}

function uniqueCandidates(values: RecognitionCandidate[]) {
  const map = new Map<string, RecognitionCandidate>();
  for (const raw of values) {
    const candidate = preserveCandidateCollectorWidth(raw);
    const key = candidate.id && !candidate.id.startsWith("memory:")
      ? `${candidate.language}:${candidate.id}`
      : `${candidate.language}:${normalizedText(candidate.name)}:${normalizedText(candidate.cardNumber)}`;
    const current = map.get(key);
    if (!current || candidate.score > current.score || candidate.evidence?.visualMatch) map.set(key, candidate);
  }
  return [...map.values()]
    .sort((a, b) => Number(Boolean(b.evidence?.visualMatch)) - Number(Boolean(a.evidence?.visualMatch)) || b.score - a.score)
    .slice(0, 12);
}

function exactVisualWinner(outcome: VisualOutcome | undefined) {
  return outcome?.candidates.find(candidate => candidate.evidence?.visualMatch);
}

function memoryWinner(memory: RecognitionMemoryOutcome | undefined) {
  return memory?.matches[0] ? memoryMatchCandidate(memory.matches[0]) : undefined;
}

function withMetadata(
  raw: RecognitionResult,
  normalization: Normalization,
  pp: PpOcrOutcome | undefined,
  memory: RecognitionMemoryOutcome | undefined,
  visual: VisualOutcome | undefined,
  started: number,
  evidence: string[],
): V10RecognitionResult {
  const value = preserveResultCollectorWidth(raw) as V10RecognitionResult;
  value.normalization = { method: normalization.method, confidence: normalization.confidence, rotation: normalization.rotation };
  value.confidenceKind = "evidence-score-not-calibrated-probability";
  value.independentEvidence = [...new Set(evidence)];
  if (pp) {
    value.neuralOcr = {
      status: pp.status,
      lineCount: pp.lineCount,
      averageConfidence: pp.averageConfidence,
      elapsedMs: pp.elapsedMs,
      backend: pp.backend,
      error: pp.error,
    };
  }
  if (memory) {
    value.recognitionMemory = {
      status: memory.status,
      fingerprint: memory.fingerprint,
      matches: memory.matches.length,
      confident: memory.confident,
      veryStrong: memory.veryStrong,
      elapsedMs: memory.elapsedMs,
      error: memory.error,
    };
  }
  if (visual) {
    value.exactVisual = {
      status: visual.status,
      used: visual.used,
      backend: visual.backend,
      candidateCount: visual.candidates.length,
      error: visual.error,
      reason: visual.reason,
    };
    value.visualUsed = visual.used;
    value.visualStatus = visual.status;
    value.visualBackend = visual.backend;
    value.visualError = visual.error;
    value.visualReason = visual.reason;
    value.visualCandidateCount = visual.candidates.length;
    value.visualInitMs = visual.initMs;
    value.visualSimilarities = visual.similarities;
  }
  value.elapsedMs = Math.round(performance.now() - started);
  value.decisionStatus = value.level === "high" ? "IDENTIFICADA" : value.level === "medium" ? "PROVÁVEL" : "INCERTA";
  return value;
}

async function normalizeBest(file: File, onProgress?: (message: string) => void): Promise<Normalization> {
  try {
    const neural = await normalizeCardWithCornelius(file, onProgress);
    if ("normalization" in neural && neural.normalization) return neural.normalization;
    onProgress?.(neural.detection.status === "failed"
      ? "↩️ Cornelius indisponível; usando detector geométrico seguro…"
      : "↩️ Cornelius não encontrou um contorno confiável; usando detector geométrico…");
  } catch {
    onProgress?.("↩️ Cornelius falhou; usando detector geométrico seguro…");
  }
  return normalizeCardPhoto(file, onProgress);
}

async function recognizeWithPpOcr(file: File, onProgress?: (message: string) => void) {
  const pp = await runPpOcr(file, onProgress);
  if (pp.status !== "ok" || !pp.hints || (!pp.hints.name && !pp.hints.localId)) return { pp };
  const stats = { requests: 0, queries: [] as string[], exhausted: false };
  try {
    const catalogLanguage = pp.hints.language ?? "pt-BR";
    onProgress?.(`📚 Conferindo PP-OCRv6 no TCGdex · prioridade ${catalogLanguage}…`);
    const catalog = await v9.resolveCatalog(pp.hints, catalogLanguage, stats);
    const result = resultFromCandidates(pp.hints, catalog.ranked, pp.elapsedMs, stats.requests, "ocr");
    result.catalogCandidatesBefore = catalog.before;
    result.catalogCandidatesAfter = catalog.ranked.length;
    result.catalogBudgetExhausted = Boolean(stats.exhausted);
    result.catalogStrategy = catalog.strategy;
    result.catalogSetCandidates = catalog.setCandidates;
    result.catalogSetIndexSource = catalog.setIndexSource;
    result.catalogQueries = stats.queries;
    return { pp, result };
  } catch (error) {
    return {
      pp: { ...pp, error: `${pp.error ? `${pp.error} ` : ""}Catálogo PP-OCR: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

function applyConfirmedMemory(base: RecognitionResult, memory: RecognitionMemoryOutcome) {
  const remembered = memory.matches.map(memoryMatchCandidate);
  if (!remembered.length) return base;
  return { ...base, candidates: uniqueCandidates([...remembered, ...base.candidates]) };
}

function promoteWinner(base: RecognitionResult, winner: RecognitionCandidate, memory: RecognitionMemoryOutcome | undefined) {
  const previousTop = base.candidates[0];
  const exactNumber = numberAgrees(base, winner);
  const catalogAgreement = sameCard(previousTop, winner);
  const nameAgreement = Boolean(base.hints.name && normalizedText(base.hints.name) === normalizedText(winner.name));
  const remembered = memoryWinner(memory);
  const memoryAgreement = Boolean(memory?.confident && remembered && sameCard(remembered, winner));
  const candidates = uniqueCandidates([winner, ...base.candidates]);
  const result: RecognitionResult = {
    ...base,
    candidates,
    name: winner.name,
    collection: winner.collection || base.collection,
    cardNumber: winner.cardNumber || base.cardNumber,
    language: winner.language || base.language,
    variant: winner.variant ?? base.variant,
  };
  const independent = ["official-scan-visual-match"];
  if (exactNumber) independent.push("collector-number");
  if (catalogAgreement) independent.push("catalog-id");
  if (nameAgreement) independent.push("ocr-name");
  if (memoryAgreement) independent.push("confirmed-example-memory");

  if (exactNumber || (catalogAgreement && nameAgreement) || (memory?.veryStrong && memoryAgreement && nameAgreement)) {
    result.level = "high";
    result.confidence = exactNumber && catalogAgreement ? 96 : memoryAgreement ? 93 : 90;
  } else {
    result.level = "medium";
    result.confidence = Math.max(64, Math.min(82, base.confidence || 70));
  }
  return { result, independent };
}

async function perform(
  file: File,
  _selectedLanguage?: string,
  onProgress?: (message: string) => void,
  _bypassCache = false,
): Promise<V10RecognitionResult> {
  const started = performance.now();
  onProgress?.("🧠 Reconhecimento · PP-OCRv6 Medium + memória confirmada + comparação visual exata…");
  const normalization = await normalizeBest(file, onProgress);

  // Memory never replaces OCR. It is queried every time and only becomes decisive when
  // independent OCR/catalog or official-scan evidence agrees with the confirmed example.
  const memory = await lookupRecognitionMemory(normalization.blob, onProgress);
  const ppAttempt = await recognizeWithPpOcr(normalization.file, onProgress);
  const ppBase = ppAttempt.result;
  let fallbackBase: RecognitionResult | undefined;

  if (!ppBase || !exactCatalogDecision(ppBase)) {
    onProgress?.("🔎 Conferência independente com o reconhecedor anterior…");
    try {
      fallbackBase = await v9.recognizePokemonCard(normalization.file, undefined, onProgress, { bypassCache: true });
    } catch { /* PP-OCR + exact visual comparison can still finish. */ }
  }

  let base = chooseOcr(ppBase, fallbackBase);
  if (!base) base = await v9.recognizePokemonCard(file, undefined, onProgress, { bypassCache: true });
  const ppSelected = Boolean(ppBase && base === ppBase);
  const ocrAgreement = Boolean(ppBase && fallbackBase && sameCard(ppBase.candidates[0], fallbackBase.candidates[0]));
  base = applyConfirmedMemory(base, memory);

  // Compare only plausible catalog/memory candidates against official TCGdex scans. The
  // worker uses high-resolution structural matching first and DINOv2-base as a local tie-breaker.
  const visual = await recognizeVisually(normalization.blob, base.candidates, onProgress);
  if (visual.candidates.length) base = { ...base, candidates: uniqueCandidates(visual.candidates) };
  const visualWinner = exactVisualWinner(visual);

  const commonEvidence: string[] = [];
  if (ppSelected) commonEvidence.push("ppocrv6-medium-multipass");
  if (ocrAgreement) commonEvidence.push("ocr-cross-check");
  if (normalization.method === "cornelius") commonEvidence.push("cornelius-corners");
  if (memory.confident) commonEvidence.push("confirmed-example-memory");

  if (visualWinner) {
    const promoted = promoteWinner(base, visualWinner, memory);
    const final = withMetadata(promoted.result, normalization, ppAttempt.pp, memory, visual, started, [...commonEvidence, ...promoted.independent]);
    onProgress?.(final.level === "high" ? `✅ ${final.name ?? "Carta"} confirmada pela arte` : "🟡 Arte provável — confira os dados");
    return final;
  }

  const remembered = memoryWinner(memory);
  if (memory.veryStrong && remembered && sameCard(base.candidates[0], remembered)) {
    const result: RecognitionResult = {
      ...base,
      candidates: uniqueCandidates([remembered, ...base.candidates]),
      name: remembered.name,
      collection: remembered.collection || base.collection,
      cardNumber: remembered.cardNumber || base.cardNumber,
      language: remembered.language || base.language,
      variant: remembered.variant ?? base.variant,
      level: "high",
      confidence: Math.max(91, Math.min(95, base.confidence + 8)),
    };
    return withMetadata(result, normalization, ppAttempt.pp, memory, visual, started, [...commonEvidence, "memory+ocr-agreement"]);
  }

  let result: RecognitionResult = base;
  if (exactCatalogDecision(result)) {
    result = { ...result, level: "high", confidence: Math.min(94, Math.max(88, result.confidence)) };
    commonEvidence.push("collector-number", "catalog-set", "ocr-name");
  } else if (result.level === "high") {
    result = { ...result, level: "medium", confidence: Math.min(79, result.confidence) };
  }

  if (result.level === "low" && visual.status !== "compared") {
    onProgress?.("↩️ Última tentativa na foto original…");
    try {
      const legacy = await v9.recognizePokemonCard(file, undefined, onProgress, { bypassCache: true });
      if (ocrQuality(legacy) > ocrQuality(result)) result = legacy;
    } catch { /* manual review remains available */ }
  }

  const final = withMetadata(result, normalization, ppAttempt.pp, memory, visual, started, commonEvidence);
  onProgress?.(final.decisionStatus === "IDENTIFICADA"
    ? `✅ ${final.name ?? "Carta"} identificada`
    : final.decisionStatus === "PROVÁVEL"
      ? "🟡 Identificação provável — confirme os dados"
      : "🔴 Identificação incerta — veja os candidatos");
  return final;
}

export function recognizePokemonCard(
  file: File,
  selectedLanguage?: string,
  onProgress?: (message: string) => void,
  options: { bypassCache?: boolean } = {},
) {
  const run = () => perform(file, selectedLanguage, onProgress, Boolean(options.bypassCache));
  const queued = tail.then(run, run);
  tail = queued.then(() => undefined, () => undefined);
  return queued;
}

export async function shutdownCardRecognition() {
  await tail;
  shutdownCorneliusRecognition();
  shutdownVisualRecognition();
  await Promise.allSettled([shutdownPpOcr(), v9.shutdownCardRecognition()]);
}

export const resolveCatalog = v9.resolveCatalog;

export const cardRecognitionRuntime = {
  version: 11,
  engine: "cornelius+ppocrv6-medium+confirmed-memory+structural-dinov2",
  cache: "model-assets-only-no-final-result-cache",
  cascade: [
    "cornelius-neural-corner-normalization",
    "confirmed-example-memory-lookup",
    "ppocrv6-medium-full-card+top-name+bottom-number",
    "pt-br-first-catalog-validation-when-language-uncertain",
    "tcgdex-catalog-validation",
    "v9-tesseract-regression-safety-net",
    "official-scan-structural-exact-print-comparison",
    "dinov2-base-local-tiebreaker-on-webgpu",
    "confirmed-memory+independent-evidence-fusion",
    "v9-original-regression-fallback",
  ],
  confidence: "evidence-score-not-calibrated-probability",
  requiresIndependentEvidenceForIdentified: true,
  uiLanguageIsNotRecognitionEvidence: true,
  recognitionResultCacheReuse: false,
  selfTrainingFromUnconfirmedPredictions: false,
  cornelius: corneliusRuntime,
  neuralOcr: ppOcrRuntime,
  recognitionMemory: recognitionMemoryRuntime,
  normalizationFallback: cardNormalizationRuntime,
};
