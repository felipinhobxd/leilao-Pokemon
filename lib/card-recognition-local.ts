"use client";

/**
 * Local recognition service client (strong pipeline) with automatic fallback to
 * the in-browser pipeline when the service is offline.
 *
 * - Service: http://127.0.0.1:8765 (bound to localhost only; see recognition/)
 * - Detection: /health probe cached for 60s; failures back off for 60s.
 * - The local pipeline has two independent routes (visual retrieval + OCR) and
 *   geometric verification, so OCR garbage like "escia" can still identify the
 *   card visually (regression: Shroodle must be found).
 */

import {
  shutdownCardRecognition as shutdownBrowserRecognition,
  recognizePokemonCard as recognizeInBrowser,
} from "./card-recognition-browser-v10";
import type { OcrHints, RecognitionCandidate, RecognitionLanguage, RecognitionResult } from "./card-recognition-core";

const SERVICE_BASE = "http://127.0.0.1:8765";
const HEALTH_TIMEOUT_MS = 1200;
const STATUS_TTL_MS = 60_000;
const OFFLINE_BACKOFF_MS = 60_000;
const RECOGNIZE_TIMEOUT_MS = 120_000;

export type LocalServiceStatus = "checking" | "online" | "offline";

type ServiceHealth = {
  status: string;
  service: string;
  version: string;
  backend?: { providers?: string[]; embedding?: string; matcher?: string; ocr?: string };
  catalog?: { cards?: number; indexSize?: number };
  memory?: { examples?: number };
};

type ServiceCandidate = {
  cardId: string;
  language: string;
  setId?: string;
  setName?: string;
  name: string;
  cardNumber?: string;
  localId?: string;
  hp?: number | null;
  score?: number;
  visualSimilarity?: number | null;
  verification?: {
    inliers: number;
    matches: number;
    inlierRatio: number;
    reprojectionError: number;
    score: number;
    method: string;
  } | null;
  ocrNameSimilarity?: number;
  ocrNumberMatch?: boolean;
  ocrLanguageMatch?: boolean;
  ocrHpMatch?: boolean;
  imageUrl?: string;
  variant?: string | null;
};

type ServiceResult = {
  decision: "IDENTIFICADO" | "PROVAVEL" | "REVISAR" | "NAO_IDENTIFICADO";
  best?: ServiceCandidate | null;
  candidates?: ServiceCandidate[];
  routeA?: boolean;
  routeB?: boolean;
  normalization?: { method?: string; confidence?: number };
  orientation?: string;
  hints?: Record<string, unknown>;
  evidence?: string[];
  elapsedMs?: number;
  timings?: Record<string, number>;
  imageBytes?: number;
  totalMs?: number;
};

type StatusCache = { status: LocalServiceStatus; checkedAt: number; health?: ServiceHealth };
let statusCache: StatusCache = { status: "checking", checkedAt: 0 };
let probePromise: Promise<StatusCache> | null = null;

export function localServiceAddress() {
  return SERVICE_BASE;
}

export function cachedLocalServiceStatus(): LocalServiceStatus {
  return statusCache.status;
}

export function localServiceHealth(): ServiceHealth | undefined {
  return statusCache.health;
}

export async function probeLocalService(force = false): Promise<LocalServiceStatus> {
  const now = Date.now();
  if (!force) {
    if (now - statusCache.checkedAt < STATUS_TTL_MS && statusCache.status !== "checking") return statusCache.status;
    if (statusCache.status === "offline" && now - statusCache.checkedAt < OFFLINE_BACKOFF_MS) return "offline";
  }
  if (probePromise) return (await probePromise).status;
  const pending = (async (): Promise<StatusCache> => {
    try {
      const response = await fetch(`${SERVICE_BASE}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`health ${response.status}`);
      const health = (await response.json()) as ServiceHealth;
      if (health?.status !== "ok") throw new Error("health inválido");
      statusCache = { status: "online", checkedAt: Date.now(), health };
    } catch {
      statusCache = { status: "offline", checkedAt: Date.now() };
    } finally {
      probePromise = null;
    }
    return statusCache;
  })();
  probePromise = pending;
  return (await pending).status;
}

function mapLanguage(value: string | undefined): RecognitionLanguage {
  if (value === "pt-BR" || value === "en" || value === "es" || value === "ja") return value;
  return "pt-BR";
}

function mapCandidate(candidate: ServiceCandidate): RecognitionCandidate {
  return {
    id: candidate.cardId,
    name: candidate.name ?? "",
    collection: candidate.setName ?? "",
    cardNumber: candidate.cardNumber ?? (candidate.localId ?? ""),
    localId: candidate.localId ?? "",
    denominator: candidate.hp === undefined ? null : null,
    language: mapLanguage(candidate.language),
    hp: candidate.hp ?? null,
    image: candidate.imageUrl ?? null,
    variant: candidate.variant ?? undefined,
    score: Math.max(0, Math.round(candidate.score ?? 0)),
    evidence: {
      fullNumberMatch: Boolean(candidate.ocrNumberMatch),
      localIdMatch: Boolean(candidate.ocrNumberMatch),
      denominatorMatch: false,
      localIdSimilarity: candidate.ocrNumberMatch ? 1 : 0,
      nameSimilarity: candidate.ocrNameSimilarity ?? 0,
      languageMatch: Boolean(candidate.ocrLanguageMatch),
      hpMatch: Boolean(candidate.ocrHpMatch),
      strongEvidence: Boolean(candidate.verification && candidate.verification.inliers >= 12),
      visualMatch: Boolean(candidate.verification && candidate.verification.score >= 0.5),
    },
    visualSimilarity: candidate.visualSimilarity ?? undefined,
  };
}

function mapHints(service: ServiceResult): OcrHints {
  const hints = (service.hints ?? {}) as Record<string, unknown>;
  const language = typeof hints.language === "string" ? mapLanguage(hints.language) : null;
  return {
    name: typeof hints.name === "string" ? hints.name : "",
    cardNumber: hints.localId ? `${hints.localId}/${hints.denominator ?? "?"}` : "",
    localId: typeof hints.localId === "string" ? hints.localId : "",
    denominator: typeof hints.denominator === "number" ? hints.denominator : null,
    hp: typeof hints.hp === "number" ? hints.hp : null,
    language,
    languageConfidence: typeof hints.languageConfidence === "number" ? Math.round(hints.languageConfidence * 100) : 0,
    text: "",
    nameConfidence: typeof hints.nameConfidence === "number" ? hints.nameConfidence : undefined,
    numberConfidence: typeof hints.numberConfidence === "number" ? hints.numberConfidence : undefined,
    hpConfidence: typeof hints.hpConfidence === "number" ? hints.hpConfidence : undefined,
  };
}

export type LocalRecognitionResult = RecognitionResult & {
  decisionStatus?: "IDENTIFICADA" | "PROVÁVEL" | "REVISAR" | "SEM RESULTADO";
  confidenceKind?: "evidence-score-not-calibrated-probability";
  localPipeline?: {
    backend: "local-service";
    embedding?: string;
    matcher?: string;
    routeA?: boolean;
    routeB?: boolean;
    orientation?: string;
    evidence?: string[];
    timings?: Record<string, number>;
    verification?: ServiceCandidate["verification"];
  };
};

function mapResult(service: ServiceResult): LocalRecognitionResult {
  const candidates = (service.candidates ?? []).map(mapCandidate);
  const best = service.best ? mapCandidate(service.best) : candidates[0];
  const level = service.decision === "IDENTIFICADO" ? "high" : service.decision === "PROVAVEL" ? "medium" : "low";
  const decisionStatus = service.decision === "IDENTIFICADO" ? "IDENTIFICADA"
    : service.decision === "PROVAVEL" ? "PROVÁVEL"
    : service.decision === "REVISAR" ? "REVISAR" : "SEM RESULTADO";
  const result: LocalRecognitionResult = {
    confidence: service.decision === "IDENTIFICADO" ? 90 : service.decision === "PROVAVEL" ? 70 : 0,
    level,
    candidates,
    hints: mapHints(service),
    source: "ocr",
    elapsedMs: service.elapsedMs ?? service.totalMs ?? 0,
    catalogRequests: 0,
    visualUsed: Boolean(service.routeA),
    visualStatus: service.routeA ? "compared" : "failed",
    visualBackend: "local-service",
    visualCandidateCount: candidates.length,
    decisionStatus,
    confidenceKind: "evidence-score-not-calibrated-probability",
    localPipeline: {
      backend: "local-service",
      routeA: service.routeA,
      routeB: service.routeB,
      orientation: service.orientation,
      evidence: service.evidence,
      timings: service.timings,
      verification: service.best?.verification ?? undefined,
    },
  };
  if (best && level !== "low") {
    result.name = best.name;
    result.collection = best.collection;
    result.cardNumber = best.cardNumber;
    result.language = best.language;
    result.variant = best.variant;
  }
  return result;
}

async function recognizeWithLocalService(file: File, onProgress?: (message: string) => void): Promise<LocalRecognitionResult> {
  onProgress?.("🖥️ Serviço local de reconhecimento · duas rotas (visual + OCR)…");
  const form = new FormData();
  form.append("file", file, file.name || "card.jpg");
  const response = await fetch(`${SERVICE_BASE}/recognize`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Serviço local HTTP ${response.status}`);
  }
  const service = (await response.json()) as ServiceResult;
  onProgress?.(service.decision === "IDENTIFICADO" ? "✅ Carta identificada pelo pipeline local"
    : service.decision === "PROVAVEL" ? "🟡 Carta provável — confirme os dados"
    : "🔎 Pipeline local não confirmou — revise os candidatos");
  return mapResult(service);
}

export async function recognizePokemonCard(
  file: File,
  selectedLanguage?: string,
  onProgress?: (message: string) => void,
  options: { bypassCache?: boolean } = {},
): Promise<LocalRecognitionResult> {
  const status = await probeLocalService();
  if (status === "online") {
    try {
      return await recognizeWithLocalService(file, onProgress);
    } catch (reason) {
      // Service flaked mid-request: degrade to the browser pipeline instead of failing.
      onProgress?.(reason instanceof Error ? `↩️ Serviço local falhou (${reason.message}); usando pipeline do navegador…` : "↩️ Serviço local falhou; usando pipeline do navegador…");
      statusCache = { status: "offline", checkedAt: Date.now() };
    }
  } else {
    onProgress?.("↩️ Serviço local offline · pipeline do navegador (PP-OCRv6 + catálogo)…");
  }
  return recognizeInBrowser(file, selectedLanguage, onProgress, options);
}

export async function confirmRecognitionMemory(file: File, card: {
  cardId: string;
  language: RecognitionLanguage;
  name: string;
  setId?: string;
  setName?: string;
  localId?: string;
  denominator?: number | null;
}) {
  const status = await probeLocalService();
  if (status !== "online") return { status: "offline" as const };
  const form = new FormData();
  form.append("file", file, file.name || "confirmed.jpg");
  form.append("card", JSON.stringify(card));
  const response = await fetch(`${SERVICE_BASE}/memory/confirm`, { method: "POST", body: form,
    signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`memory/confirm HTTP ${response.status}`);
  return (await response.json()) as { status: string; example: Record<string, unknown> };
}

export async function shutdownCardRecognition() {
  await shutdownBrowserRecognition();
}

export const cardRecognitionLocalRuntime = {
  serviceBase: SERVICE_BASE,
  strategy: "local-service-first-with-browser-fallback",
  localPipeline: {
    routes: ["A: normalize->embedding->ANN search->SIFT homography verification", "B: region OCR->hints->catalog candidates"],
    fusion: "verification-dominant + OCR metadata validation + confirmed memory prior",
    confidence: "honest-categories-not-calibrated-probability",
  },
};
