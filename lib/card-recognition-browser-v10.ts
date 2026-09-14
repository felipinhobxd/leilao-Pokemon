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
import { preserveResultCollectorWidth } from "./card-recognition-format";
import { resultFromCandidates, type RecognitionCandidate, type RecognitionResult } from "./card-recognition-core";

import { decideRecognition } from "./card-recognition-decision";

let tail: Promise<unknown> = Promise.resolve();
type Normalization = CardNormalization | CorneliusNormalization;

export type RecognitionDecision = "IDENTIFICADA" | "PROVÁVEL" | "REVISAR" | "SEM RESULTADO";
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
  evidenceRanking?: ReturnType<typeof decideRecognition>["ranking"];
};

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
  value.decisionStatus = value.level === "high" ? "IDENTIFICADA" : value.level === "medium" ? "PROVÁVEL" : "REVISAR";
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

async function perform(
  file: File,
  _selectedLanguage?: string,
  onProgress?: (message: string) => void,
  _bypassCache = false,
): Promise<V10RecognitionResult> {
  const started = performance.now();
  onProgress?.("🧠 Reconhecimento · PP-OCRv6 Medium + memória confirmada + comparação visual exata…");
  const normalization = await normalizeBest(file, onProgress);

  // Memory never replaces OCR or supplies official scans.
  const memoryPromise = lookupRecognitionMemory(normalization.blob, onProgress);
  const ppAttempt = await recognizeWithPpOcr(normalization.file, onProgress);
  const memory = await memoryPromise;
  // No recursive legacy OCR/visual cascade: one bounded PP-OCR attempt per photo.
  const base: RecognitionResult = ppAttempt.result ?? {
    hints: ppAttempt.pp.hints ?? { name: "", localId: "", cardNumber: "", denominator: null,
      hp: null, language: null, languageConfidence: 0, text: "" },
    candidates: [], confidence: 0, level: "low", source: "ocr", elapsedMs: 0, catalogRequests: 0,
  };
  const visual = await recognizeVisually(normalization.blob, base.candidates, onProgress);
  const decision = decideRecognition(base, visual.candidates, visual.status, memory.matches.map(memoryMatchCandidate));
  const final = withMetadata(decision.result, normalization, ppAttempt.pp, memory, visual, started, decision.evidence);
  final.decisionStatus = decision.status;
  final.evidenceRanking = decision.ranking;
  onProgress?.(decision.status === "IDENTIFICADA" ? "✅ Carta identificada por OCR e scan oficial"
    : decision.status === "PROVÁVEL" ? "🟡 Carta provável — confirme os dados"
    : "🔎 Não consegui identificar com segurança — revise os candidatos");
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
    "official-scan-structural-exact-print-comparison",
    "dinov2-base-local-tiebreaker-on-webgpu",
    "confirmed-memory+independent-evidence-fusion",
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
