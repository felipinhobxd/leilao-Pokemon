"use client";

/**
 * Local recognition service client (strong pipeline) with automatic fallback to
 * the in-browser pipeline when the service is offline.
 *
 * - Service: http://127.0.0.1:8765 (bound to localhost only; see recognition/)
 * - Detection: /health probe cached for 60s; failures back off for 60s. The
 *   service is only considered online when health.ready === true (models +
 *   index loaded), never on status alone.
 * - The local pipeline has two independent routes (visual retrieval + OCR) and
 *   geometric verification, so OCR garbage like "escia" can still identify the
 *   card visually (regression: Shroodle must be found).
 * - Batch (20/50 photos): requests go through a bounded-concurrency scheduler
 *   ("Na fila de reconhecimento…"); the per-request timeout measures execution
 *   only, so waiting in queue never degrades a photo to the browser pipeline.
 * - The whole feature can be switched off before uploads (imageRecognitionEnabled).
 */

import {
  shutdownCardRecognition as shutdownBrowserRecognition,
  recognizePokemonCard as recognizeInBrowser,
} from "./card-recognition-browser-v10";
import type { OcrHints, RecognitionCandidate, RecognitionLanguage, RecognitionResult } from "./card-recognition-core";
import {
  createRecognitionScheduler,
  mapLanguage,
  mapServiceCandidate,
  mapServiceHints,
  mapServiceResult,
  queueStatusMessage,
  type ServiceCandidate,
  type ServiceHealth,
  type ServiceResult,
} from "./card-recognition-service-contract";
import { createPublicSupabaseClient } from "./supabase";

const SERVICE_BASE = "http://127.0.0.1:8765";
const HEALTH_TIMEOUT_MS = 1200;
const STATUS_TTL_MS = 60_000;
const OFFLINE_BACKOFF_MS = 60_000;
// Execution timeout only: a request starts when a scheduler slot frees, so
// this never includes time spent waiting behind other cards (queueMs reports
// that separately in the response payload).
const RECOGNIZE_TIMEOUT_MS = 120_000;
// Client-side in-flight cap. The service enforces its own hard limit
// (RECOGNITION_MAX_CONCURRENCY, default 1); the client keeps one extra
// request warm so the service never idles between photos of a batch.
const RECOGNITION_CONCURRENCY = 2;
const IMAGE_RECOGNITION_STORAGE_KEY = "leilao-pokemon:image-recognition-enabled";
export const imageRecognitionPreferenceEvent = "leilao-pokemon:image-recognition-change";

/**
 * Diagnose a failed /recognize call. "Failed to fetch" is a SYMPTOM, never a
 * cause: the browser raises it for connection refused / service down, which
 * on this setup means the local Python process died (e.g. the Windows native
 * crash, exit code 0xC0000005) or never started. Timeouts and real HTTP
 * errors get their own wording so the user (and the debug panel) can tell
 * them apart at a glance.
 */
function diagnoseServiceFailure(reason: unknown): string {
  if (reason instanceof DOMException && (reason.name === "AbortError" || reason.name === "TimeoutError")) {
    return "tempo esgotado (serviço ocupado ou travado)";
  }
  if (reason instanceof TypeError) {
    // fetch() network failure: connection refused / process down / port closed.
    return "serviço local fora do ar (processo encerrado ou não iniciado — veja o terminal do recognition)";
  }
  const message = reason instanceof Error ? reason.message : String(reason);
  const httpMatch = message.match(/HTTP (\d{3})/);
  if (httpMatch) return `erro HTTP ${httpMatch[1]} do serviço local`;
  return message;
}

export type LocalServiceStatus = "checking" | "online" | "offline";

export type { ServiceCandidate, ServiceHealth, ServiceResult };

type StatusCache = { status: LocalServiceStatus; checkedAt: number; health?: ServiceHealth };
let statusCache: StatusCache = { status: "checking", checkedAt: 0 };
let probePromise: Promise<StatusCache> | null = null;

type ServiceTokenCache = { token: string; expiresAt: number; userId: string };
const authDb = createPublicSupabaseClient();
let serviceTokenCache: ServiceTokenCache | null = null;
let serviceTokenPromise: Promise<string> | null = null;

async function localServiceToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && serviceTokenCache && serviceTokenCache.expiresAt - now > 30_000) {
    return serviceTokenCache.token;
  }
  if (serviceTokenPromise) return serviceTokenPromise;

  serviceTokenPromise = (async () => {
    const { data } = await authDb.auth.getSession();
    if (!data.session) throw new Error("Sessão administrativa ausente.");
    const response = await fetch("/api/card-recognition/token", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.token !== "string" || !body.expiresAt) {
      throw new Error(body?.error ?? "Não foi possível autorizar o reconhecimento local.");
    }
    const expiresAt = Date.parse(body.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("Token do reconhecimento local inválido.");
    }
    serviceTokenCache = { token: body.token, expiresAt, userId: data.session.user.id };
    return body.token;
  })().finally(() => {
    serviceTokenPromise = null;
  });

  return serviceTokenPromise;
}

function clearLocalServiceToken() {
  serviceTokenCache = null;
}

export function imageRecognitionEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(IMAGE_RECOGNITION_STORAGE_KEY) !== "false";
}

export function setImageRecognitionEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IMAGE_RECOGNITION_STORAGE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent(imageRecognitionPreferenceEvent, { detail: { enabled } }));
}

const recognitionScheduler = createRecognitionScheduler({ concurrency: RECOGNITION_CONCURRENCY });

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
      // status=ok only means the process is alive; the pipeline is usable
      // only once the models + index are loaded. STRICT contract: ready must
      // be exactly true — undefined/null/missing (partial JSON, older service)
      // must be treated as NOT usable, never as ready.
      if (health?.status !== "ok") throw new Error("health inválido");
      if (health.authConfigured !== true) throw new Error("autenticação local não configurada");
      if (health.ready !== true) throw new Error("serviço não pronto (ready != true)");
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

// Re-exported for tests and the wizard debug panel.
export { mapServiceCandidate, mapServiceHints, mapServiceResult, queueStatusMessage };

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
    languageStatus?: "confirmed" | "uncertain";
    evidence?: string[];
    timings?: Record<string, number>;
    queueMs?: number;
    executionMs?: number;
    verification?: ServiceCandidate["verification"];
  };
};

function disabledRecognitionResult(selectedLanguage?: string): LocalRecognitionResult {
  const language = selectedLanguage ? mapLanguage(selectedLanguage) : null;
  return {
    confidence: 0,
    level: "low",
    candidates: [],
    hints: {
      name: "",
      cardNumber: "",
      localId: "",
      denominator: null,
      hp: null,
      language,
      languageConfidence: 0,
      text: "",
    },
    source: "ocr",
    elapsedMs: 0,
    catalogRequests: 0,
    visualUsed: false,
    visualStatus: "not-needed",
    visualCandidateCount: 0,
    decisionStatus: "SEM RESULTADO",
    confidenceKind: "evidence-score-not-calibrated-probability",
  };
}

async function recognizeWithLocalService(file: File, onProgress?: (message: string) => void): Promise<LocalRecognitionResult> {
  const waiting = recognitionScheduler.waiting;
  const queued = queueStatusMessage(waiting, recognitionScheduler.active);
  if (queued) onProgress?.(queued);
  return recognitionScheduler.run(async () => {
    onProgress?.("🖥️ Serviço local de reconhecimento · duas rotas (visual + OCR)…");
    const form = new FormData();
    form.append("file", file, file.name || "card.jpg");
    let token = await localServiceToken();
    let response = await fetch(`${SERVICE_BASE}/recognize`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      clearLocalServiceToken();
      token = await localServiceToken(true);
      response = await fetch(`${SERVICE_BASE}/recognize`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail ?? `Serviço local HTTP ${response.status}`);
    }
    const service = (await response.json()) as ServiceResult;
    onProgress?.(service.decision === "IDENTIFICADO" ? "✅ Carta identificada pelo pipeline local"
      : service.decision === "PROVAVEL" ? "🟡 Carta provável — confirme os dados"
      : "🔎 Pipeline local não confirmou — revise os candidatos");
    if (service.queueMs != null && service.queueMs > 2500) {
      onProgress?.(`⏱️ Fila: ${service.queueMs} ms · execução: ${service.executionMs ?? service.elapsedMs ?? 0} ms`);
    }
    return mapServiceResult(service, SERVICE_BASE) as LocalRecognitionResult;
  });
}

export async function recognizePokemonCard(
  file: File,
  selectedLanguage?: string,
  onProgress?: (message: string) => void,
  options: { bypassCache?: boolean } = {},
): Promise<LocalRecognitionResult> {
  if (!imageRecognitionEnabled()) {
    onProgress?.("⏸️ Reconhecimento de imagens desativado");
    return disabledRecognitionResult(selectedLanguage);
  }
  const status = await probeLocalService();
  if (status === "online") {
    try {
      return await recognizeWithLocalService(file, onProgress);
    } catch (reason) {
      // Service flaked mid-request: degrade to the browser pipeline instead
      // of failing. The message names the DIAGNOSED cause (process down vs
      // HTTP status vs timeout), not just the raw "Failed to fetch" symptom.
      onProgress?.(`↩️ Serviço local falhou (${diagnoseServiceFailure(reason)}); usando pipeline do navegador…`);
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
  if (!imageRecognitionEnabled()) return { status: "disabled" as const };
  const status = await probeLocalService();
  if (status !== "online") return { status: "offline" as const };
  const form = new FormData();
  form.append("file", file, file.name || "confirmed.jpg");
  form.append("card", JSON.stringify(card));
  let token = await localServiceToken();
  let response = await fetch(`${SERVICE_BASE}/memory/confirm`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    clearLocalServiceToken();
    token = await localServiceToken(true);
    response = await fetch(`${SERVICE_BASE}/memory/confirm`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!response.ok) throw new Error(`memory/confirm HTTP ${response.status}`);
  return (await response.json()) as { status: string; example: Record<string, unknown> };
}

export async function shutdownCardRecognition() {
  await shutdownBrowserRecognition();
}

export const cardRecognitionLocalRuntime = {
  serviceBase: SERVICE_BASE,
  strategy: "local-service-first-with-browser-fallback",
  concurrency: RECOGNITION_CONCURRENCY,
  localPipeline: {
    routes: ["A: normalize->embedding->ANN search->SIFT homography verification", "B: region OCR->hints->catalog candidates"],
    fusion: "verification-dominant + OCR metadata validation + confirmed memory prior",
    confidence: "honest-categories-not-calibrated-probability",
  },
};
