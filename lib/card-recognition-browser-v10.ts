"use client";

import * as v9 from "./card-recognition-browser-v9";
import { normalizeCardPhoto, cardNormalizationRuntime, type CardNormalization } from "./card-recognition-normalize";
import { searchMiloVisual, shutdownMiloRecognition, miloRuntime, type MiloVisualResult } from "./card-recognition-milo";
import { preserveCandidateCollectorWidth, preserveResultCollectorWidth } from "./card-recognition-format";
import type { RecognitionCandidate, RecognitionResult } from "./card-recognition-core";

const CACHE_PREFIX = "leilao:card-recognition:v10:";
const memory = new Map<string, RecognitionResult>();
let tail: Promise<unknown> = Promise.resolve();

export type RecognitionDecision = "IDENTIFICADA" | "PROVÁVEL" | "INCERTA";
export type V10RecognitionResult = RecognitionResult & {
  decisionStatus?: RecognitionDecision;
  confidenceKind?: "evidence-score-not-calibrated-probability";
  normalization?: { method: CardNormalization["method"]; confidence: number; rotation: number };
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
  normalization: CardNormalization,
  global: MiloVisualResult | undefined,
  started: number,
  evidence: string[],
): V10RecognitionResult {
  const value = preserveResultCollectorWidth(rawResult) as V10RecognitionResult;
  value.normalization = { method: normalization.method, confidence: normalization.confidence, rotation: normalization.rotation };
  value.confidenceKind = "evidence-score-not-calibrated-probability";
  value.independentEvidence = evidence;
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

  // Retrieval similarity is not a probability. One visual opinion never becomes IDENTIFICADA.
  // High confidence still requires an independent collector-number/catalog agreement.
  if (exactNumber || (catalogAgreement && nameAgreement)) {
    result.level = "high";
    result.confidence = exactNumber && catalogAgreement ? 94 : 89;
  } else {
    result.level = "medium";
    result.confidence = Math.max(60, Math.min(79, base.confidence || 68));
  }
  return { result, independent };
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
    if (hit) { onProgress?.("Resultado reutilizado do cache v10"); return hit; }
  }

  // selectedLanguage is intentionally not forwarded here. A default UI value is not evidence.
  // Detected OCR language may localize TCGdex only after the image has produced its own Top-K.
  const normalization = await normalizeCardPhoto(file, onProgress);
  onProgress?.("🔎 OCR + catálogo sobre a carta retificada…");
  const base = await v9.recognizePokemonCard(normalization.file, undefined, onProgress, { bypassCache: true });

  if (exactCatalogDecision(base)) {
    const final = withMetadata({ ...base }, normalization, undefined, started, ["collector-number", "catalog-set", "ocr-name"]);
    final.level = "high";
    final.decisionStatus = "IDENTIFICADA";
    final.confidence = Math.min(92, Math.max(86, base.confidence));
    save(hash, final);
    return final;
  }

  const detectedLanguage = base.hints.language ?? undefined;
  // Candidate discovery is image-only. OCR hints are applied only after the neural Top-K exists,
  // when the shortlist is enriched/re-ranked with printed metadata.
  const global = await searchMiloVisual(normalization.blob, detectedLanguage, base.hints, onProgress);
  if (global.winner) {
    const fused = promoteVisualWinner(base, global, global.winner);
    const final = withMetadata(fused.result, normalization, global, started, fused.independent);
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

  const final = withMetadata(result, normalization, global, started, exactCatalogDecision(result) ? ["collector-number", "catalog-set", "ocr-name"] : []);
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
  shutdownMiloRecognition();
  await v9.shutdownCardRecognition();
}

export const resolveCatalog = v9.resolveCatalog;

export const cardRecognitionRuntime = {
  version: 10,
  cascade: ["four-corner-normalization", "v9-ocr-catalog", "ocr-independent-milo-exact-print-retrieval", "metadata-rerank", "v9-original-regression-fallback"],
  confidence: "evidence-score-not-calibrated-probability",
  requiresIndependentEvidenceForIdentified: true,
  uiLanguageIsNotRecognitionEvidence: true,
  normalization: cardNormalizationRuntime,
  globalVisual: miloRuntime,
};
