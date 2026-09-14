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
import { searchMiloVisual, shutdownMiloRecognition, miloRuntime, type MiloVisualResult } from "./card-recognition-milo";
import { preserveCandidateCollectorWidth, preserveResultCollectorWidth } from "./card-recognition-format";
import { resultFromCandidates, type RecognitionCandidate, type RecognitionResult } from "./card-recognition-core";

const CACHE_PREFIX = "leilao:card-recognition:v10-cornelius-ppocrv6-milo-v1:";
const memory = new Map<string, RecognitionResult>();
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
  globalVisual?: {
    status: MiloVisualResult["status"];
    indexCandidates: number;
    elapsedMs: number;
    catalogRequests: number;
    backend?: string;
    error?: string;
  };
  independentEvidence?: string[];
};

async function hashFile(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function cached(hash: string): V10RecognitionResult | null {
  const inMemory = memory.get(hash) as V10RecognitionResult | undefined;
  if (inMemory) return { ...inMemory, source: "cache", elapsedMs: 0, catalogRequests: 0 };
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${hash}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as V10RecognitionResult;
    memory.set(hash, parsed);
    return { ...parsed, source: "cache", elapsedMs: 0, catalogRequests: 0 };
  } catch { return null; }
}

function save(hash: string, result: V10RecognitionResult) {
  if (memory.size >= 64) memory.delete(memory.keys().next().value!);
  memory.set(hash, result);
  try { sessionStorage.setItem(`${CACHE_PREFIX}${hash}`, JSON.stringify(result)); } catch { /* optional cache */ }
}

function normalizedText(value: string | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sameCard(a: RecognitionCandidate | undefined, b: RecognitionCandidate | undefined) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
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
  return Boolean(hintLocal && candidateLocal && (hintLocal === candidateLocal || Number(hintLocal.replace(/\D/g, "")) === Number(candidateLocal.replace(/\D/g, "")))
    && denominator && candidate.denominator && denominator === candidate.denominator);
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
  for (const rawCandidate of values) {
    const candidate = preserveCandidateCollectorWidth(rawCandidate);
    const key = candidate.id ? `${candidate.language}:${candidate.id}` : `${candidate.language}:${candidate.name}:${candidate.cardNumber}`;
    const current = map.get(key);
    if (!current || candidate.score > current.score || candidate.evidence?.visualMatch) map.set(key, candidate);
  }
  return [...map.values()].sort((a, b) => Number(Boolean(b.evidence?.visualMatch)) - Number(Boolean(a.evidence?.visualMatch)) || b.score - a.score).slice(0, 5);
}

function withMetadata(
  rawResult: RecognitionResult,
  normalization: Normalization,
  pp: PpOcrOutcome | undefined,
  global: MiloVisualResult | undefined,
  started: number,
  evidence: string[],
): V10RecognitionResult {
  const value = preserveResultCollectorWidth(rawResult) as V10RecognitionResult;
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
  if (global) {
    value.globalVisual = {
      status: global.status,
      indexCandidates: global.indexCandidates,
      elapsedMs: global.elapsedMs,
      catalogRequests: global.catalogRequests,
      backend: global.backend,
      error: global.error,
    };
    value.catalogRequests += global.catalogRequests;
  }
  value.elapsedMs = Math.round(performance.now() - started);
  value.decisionStatus = value.level === "high" ? "IDENTIFICADA" : value.level === "medium" ? "PROVÁVEL" : "INCERTA";
  return value;
}

function promoteVisualWinner(base: RecognitionResult, global: MiloVisualResult, winnerRaw: RecognitionCandidate) {
  const winner = preserveCandidateCollectorWidth(winnerRaw);
  const baseTop = base.candidates[0];
  const exactNumber = numberAgrees(base, winner);
  const catalogAgreement = sameCard(baseTop, winner);
  const nameAgreement = Boolean(base.hints.name && normalizedText(base.hints.name) === normalizedText(winner.name));
  const independent = ["milo-visual-retrieval"];
  if (exactNumber) independent.push("collector-number");
  if (catalogAgreement) independent.push("catalog-id");
  if (nameAgreement) independent.push("ocr-name");

  const candidates = uniqueCandidates([winner, ...global.candidates, ...base.candidates]);
  const result: RecognitionResult = {
    ...base,
    candidates,
    name: winner.name,
    collection: winner.collection || base.collection,
    cardNumber: winner.cardNumber || base.cardNumber,
    language: winner.language || base.language,
    variant: winner.variant ?? base.variant,
  };

  if (exactNumber || (catalogAgreement && nameAgreement)) {
    result.level = "high";
    result.confidence = exactNumber && catalogAgreement ? 94 : 89;
  } else {
    result.level = "medium";
    result.confidence = Math.max(60, Math.min(79, base.confidence || 68));
  }
  return { result, independent };
}

function preserveExactBaseWithVisualCheck(base: RecognitionResult, global: MiloVisualResult) {
  const baseTop = base.candidates[0];
  const visualTop = global.winner ?? global.candidates[0];
  const candidates = uniqueCandidates([...(visualTop ? [visualTop] : []), ...global.candidates, ...base.candidates]);

  if (!visualTop || sameCard(baseTop, visualTop)) {
    const result: RecognitionResult = { ...base, candidates };
    result.level = "high";
    result.confidence = Math.min(94, Math.max(88, base.confidence));
    return { result, independent: visualTop ? ["collector-number", "catalog-set", "ocr-name", "milo-visual-retrieval"] : ["collector-number", "catalog-set", "ocr-name"] };
  }

  const result: RecognitionResult = { ...base, candidates };
  result.level = "medium";
  result.confidence = 72;
  delete result.name;
  delete result.collection;
  delete result.cardNumber;
  delete result.language;
  delete result.variant;
  return { result, independent: ["collector-number", "catalog-set", "ocr-name", "milo-conflict"] };
}

async function normalizeBest(file: File, onProgress?: (message: string) => void): Promise<Normalization> {
  try {
    const neural = await normalizeCardWithCornelius(file, onProgress);
    if ("normalization" in neural && neural.normalization) return neural.normalization;
    if (neural.detection.status === "failed") onProgress?.("↩️ Cornelius indisponível; usando detector geométrico seguro…");
    else onProgress?.("↩️ Cornelius não encontrou um contorno confiável; usando detector geométrico…");
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
    onProgress?.("📚 Conferindo PP-OCRv6 no catálogo TCGdex…");
    const catalog = await v9.resolveCatalog(pp.hints, pp.hints.language ?? undefined, stats);
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

async function perform(
  file: File,
  _selectedLanguage?: string,
  onProgress?: (message: string) => void,
  bypassCache = false,
): Promise<V10RecognitionResult> {
  const started = performance.now();
  const hash = await hashFile(file);
  if (!bypassCache) {
    const hit = cached(hash);
    if (hit) { onProgress?.("Resultado reutilizado do cache neural"); return hit; }
  }

  onProgress?.("🧠 Reconhecimento neural · Cornelius + PP-OCRv6 Small + Milo…");
  const normalization = await normalizeBest(file, onProgress);

  const ppAttempt = await recognizeWithPpOcr(normalization.file, onProgress);
  const ppBase = ppAttempt.result;
  let fallbackBase: RecognitionResult | undefined;

  if (!ppBase || !exactCatalogDecision(ppBase)) {
    onProgress?.("🔎 Conferência de segurança com o reconhecedor anterior…");
    try {
      fallbackBase = await v9.recognizePokemonCard(normalization.file, undefined, onProgress, { bypassCache: true });
    } catch { /* PP-OCR + Milo can still finish the recognition. */ }
  }

  let base = chooseOcr(ppBase, fallbackBase);
  if (!base) {
    base = await v9.recognizePokemonCard(file, undefined, onProgress, { bypassCache: true });
  }
  const ppSelected = Boolean(ppBase && base === ppBase);
  const ocrAgreement = Boolean(ppBase && fallbackBase && sameCard(ppBase.candidates[0], fallbackBase.candidates[0]));

  const detectedLanguage = base.hints.language ?? undefined;
  const global = await searchMiloVisual(normalization.blob, detectedLanguage, base.hints, onProgress);

  if (exactCatalogDecision(base)) {
    const checked = preserveExactBaseWithVisualCheck(base, global);
    const evidence = [...checked.independent];
    if (ppSelected) evidence.push("ppocrv6-small");
    if (ocrAgreement) evidence.push("ocr-cross-check");
    if (normalization.method === "cornelius") evidence.push("cornelius-corners");
    const final = withMetadata(checked.result, normalization, ppAttempt.pp, global, started, evidence);
    save(hash, final);
    return final;
  }

  if (global.winner) {
    const fused = promoteVisualWinner(base, global, global.winner);
    const evidence = [...fused.independent];
    if (ppSelected) evidence.push("ppocrv6-small");
    if (ocrAgreement) evidence.push("ocr-cross-check");
    if (normalization.method === "cornelius") evidence.push("cornelius-corners");
    const final = withMetadata(fused.result, normalization, ppAttempt.pp, global, started, evidence);
    save(hash, final);
    return final;
  }

  let candidates = base.candidates;
  if (global.candidates.length) candidates = uniqueCandidates([...global.candidates, ...base.candidates]);
  let result: RecognitionResult = { ...base, candidates };

  if (base.level === "high") {
    result.level = "medium";
    result.confidence = Math.min(79, base.confidence);
    delete result.name;
    delete result.collection;
    delete result.cardNumber;
    delete result.language;
    delete result.variant;
  }

  if (result.level === "low" && global.status !== "compared") {
    onProgress?.("↩️ Última tentativa: pipeline anterior na foto original…");
    try {
      const legacy = await v9.recognizePokemonCard(file, undefined, onProgress, { bypassCache: true });
      if (exactCatalogDecision(legacy)) result = legacy;
      else if (legacy.level === "medium" && result.level === "low") result = legacy;
    } catch { /* manual flow remains available */ }
  }

  const evidence = exactCatalogDecision(result) ? ["collector-number", "catalog-set", "ocr-name"] : [];
  if (ppSelected) evidence.push("ppocrv6-small");
  if (ocrAgreement) evidence.push("ocr-cross-check");
  if (normalization.method === "cornelius") evidence.push("cornelius-corners");
  const final = withMetadata(result, normalization, ppAttempt.pp, global, started, evidence);
  save(hash, final);
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
  shutdownMiloRecognition();
  await Promise.allSettled([shutdownPpOcr(), v9.shutdownCardRecognition()]);
}

export const resolveCatalog = v9.resolveCatalog;

export const cardRecognitionRuntime = {
  version: 10,
  engine: "cornelius+ppocrv6-small+milo",
  cache: "v10-cornelius-ppocrv6-milo-v1",
  cascade: [
    "cornelius-neural-corner-normalization",
    "ppocrv6-small-primary-ocr",
    "tcgdex-catalog-validation",
    "v9-tesseract-regression-safety-net",
    "always-on-ocr-independent-milo-exact-print-retrieval",
    "metadata-rerank",
    "v9-original-regression-fallback",
  ],
  confidence: "evidence-score-not-calibrated-probability",
  requiresIndependentEvidenceForIdentified: true,
  uiLanguageIsNotRecognitionEvidence: true,
  cornelius: corneliusRuntime,
  neuralOcr: ppOcrRuntime,
  normalizationFallback: cardNormalizationRuntime,
  globalVisual: miloRuntime,
};
