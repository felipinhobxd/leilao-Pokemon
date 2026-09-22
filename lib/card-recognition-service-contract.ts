// Service contract for the local recognition service: pure mapping + queueing
// logic, free of heavy imports so tests (node --test) can exercise the real
// behavior instead of grepping source strings.
//
// The full collector number N/M must survive the WHOLE chain:
//   Python Candidate -> JSON -> ServiceCandidate -> RecognitionCandidate ->
//   wizard -> confirmRecognitionMemory.
// `denominator` used to be flattened to `null` here, which silently dropped
// the only evidence that separates same-artwork reprints of different sets.

import type { OcrHints, RecognitionCandidate, RecognitionLanguage, RecognitionResult } from "./card-recognition-core.ts";

export type ServiceCandidate = {
  cardId: string;
  language: string;
  setId?: string;
  setName?: string;
  name: string;
  cardNumber?: string;
  localId?: string;
  denominator?: number | null;
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
  ocrDenominatorMatch?: boolean | null;
  ocrFullNumberMatch?: boolean;
  ocrLanguageMatch?: boolean;
  ocrHpMatch?: boolean;
  imageUrl?: string;
  variant?: string | null;
  // Rarity as published by the catalog source ("Rare", "Illustration
  // Rare", …). Display metadata from the multi-source catalog; never used
  // for scoring.
  rarity?: string | null;
};

export type ServiceResult = {
  decision: "IDENTIFICADO" | "PROVAVEL" | "REVISAR" | "NAO_IDENTIFICADO";
  best?: ServiceCandidate | null;
  candidates?: ServiceCandidate[];
  routeA?: boolean;
  routeB?: boolean;
  normalization?: { method?: string; confidence?: number };
  orientation?: string;
  // Language of the winning entry AFTER the two-step decision:
  //   "confirmed"      — OCR language evidence agrees (or single-language print)
  //   "uncertain"      — same-card language twins compete with no language evidence
  //   "conflict"       — strong OCR read contradicts a twin-less winner
  //   "pt-br-pre-2011" — Devir case: pt-BR print pre-2011 whose catalog entry is
  //                      the EN twin (identity stands, flagged for the operator)
  languageStatus?: "confirmed" | "uncertain" | "conflict" | "pt-br-pre-2011";
  hints?: Record<string, unknown>;
  evidence?: string[];
  elapsedMs?: number;
  timings?: Record<string, number>;
  imageBytes?: number;
  totalMs?: number;
  queueMs?: number;
  executionMs?: number;
};

export type ServiceHealth = {
  status: string;
  ready?: boolean;
  authConfigured?: boolean;
  service: string;
  version: string;
  backend?: { providers?: string[]; embedding?: string; matcher?: string; ocr?: string; maxConcurrency?: number };
  catalog?: { cards?: number; indexSize?: number };
  modelsLoaded?: boolean;
  memory?: { examples?: number };
};

/** Fallback parse for older service builds that only send the cardNumber string. */
export function parseDenominatorFromCardNumber(cardNumber: string | null | undefined): number | null {
  if (typeof cardNumber !== "string") return null;
  const match = cardNumber.match(/[/|]\s*(\d{1,3})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function mapLanguage(value: string | undefined): RecognitionLanguage {
  if (value === "pt-BR" || value === "en" || value === "es" || value === "ja") return value;
  return "pt-BR";
}

/** Resolve a service image URL. The service returns "/scan/<lang>/<cardId>"
 * for scans served through the local endpoint (low.webp / EN-mirror cases
 * whose CDN high.webp URL would 404); prefix the service base for those. */
export function resolveServiceImageUrl(imageUrl: string | null | undefined, serviceBase: string): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("/")) return `${serviceBase}${imageUrl}`;
  return imageUrl;
}

export function mapServiceCandidate(candidate: ServiceCandidate, serviceBase: string): RecognitionCandidate {
  const denominator = typeof candidate.denominator === "number" && Number.isFinite(candidate.denominator)
    ? candidate.denominator
    : parseDenominatorFromCardNumber(candidate.cardNumber);
  return {
    id: candidate.cardId,
    name: candidate.name ?? "",
    collection: candidate.setName ?? "",
    cardNumber: candidate.cardNumber ?? (candidate.localId ?? ""),
    localId: candidate.localId ?? "",
    denominator,
    language: mapLanguage(candidate.language),
    hp: candidate.hp ?? null,
    image: resolveServiceImageUrl(candidate.imageUrl, serviceBase),
    variant: candidate.variant ?? undefined,
    rarity: candidate.rarity ?? undefined,
    score: Math.max(0, Math.round(candidate.score ?? 0)),
    evidence: {
      // Full N/M agreement is its own evidence tier: a localId alone matching
      // is compatible with same-artwork reprints; the denominator is what
      // makes the exact print.
      fullNumberMatch: Boolean(candidate.ocrFullNumberMatch),
      localIdMatch: Boolean(candidate.ocrNumberMatch),
      denominatorMatch: candidate.ocrDenominatorMatch == null ? false : Boolean(candidate.ocrDenominatorMatch),
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

export function mapServiceHints(service: ServiceResult): OcrHints {
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

export function mapServiceResult(service: ServiceResult, serviceBase: string): RecognitionResult & {
  decisionStatus?: "IDENTIFICADA" | "PROVÁVEL" | "REVISAR" | "SEM RESULTADO";
  confidenceKind?: "evidence-score-not-calibrated-probability";
  localPipeline?: {
    backend: "local-service";
    embedding?: string;
    matcher?: string;
    routeA?: boolean;
    routeB?: boolean;
    orientation?: string;
    languageStatus?: "confirmed" | "uncertain" | "conflict" | "pt-br-pre-2011";
    evidence?: string[];
    timings?: Record<string, number>;
    queueMs?: number;
    executionMs?: number;
    verification?: ServiceCandidate["verification"];
  };
} {
  const candidates = (service.candidates ?? []).map(candidate => mapServiceCandidate(candidate, serviceBase));
  const best = service.best ? mapServiceCandidate(service.best, serviceBase) : candidates[0];
  const level: RecognitionResult["level"] = service.decision === "IDENTIFICADO" ? "high" : service.decision === "PROVAVEL" ? "medium" : "low";
  const decisionStatus = service.decision === "IDENTIFICADO" ? "IDENTIFICADA"
    : service.decision === "PROVAVEL" ? "PROVÁVEL"
    : service.decision === "REVISAR" ? "REVISAR" : "SEM RESULTADO";
  const result: RecognitionResult & {
    decisionStatus?: "IDENTIFICADA" | "PROVÁVEL" | "REVISAR" | "SEM RESULTADO";
    confidenceKind?: "evidence-score-not-calibrated-probability";
    localPipeline?: {
      backend: "local-service";
      embedding?: string;
      matcher?: string;
      routeA?: boolean;
      routeB?: boolean;
      orientation?: string;
      languageStatus?: "confirmed" | "uncertain" | "conflict" | "pt-br-pre-2011";
      evidence?: string[];
      timings?: Record<string, number>;
      queueMs?: number;
      executionMs?: number;
      verification?: ServiceCandidate["verification"];
    };
  } = {
    confidence: service.decision === "IDENTIFICADO" ? 90 : service.decision === "PROVAVEL" ? 70 : 0,
    level,
    candidates,
    hints: mapServiceHints(service),
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
      languageStatus: service.languageStatus,
      evidence: service.evidence,
      timings: service.timings,
      queueMs: service.queueMs,
      executionMs: service.executionMs,
      verification: service.best?.verification ?? undefined,
    },
  };
  if (best && level !== "low") {
    return { ...result, name: best.name, collection: best.collection, cardNumber: best.cardNumber,
      language: best.language, variant: best.variant };
  }
  return result;
}

/**
 * Bounded-concurrency scheduler for recognition jobs.
 *
 * The wizard fires one identifyCard per photo (1/10/20/50); recognition is
 * heavy and synchronous on the service side, so the client keeps at most
 * `concurrency` requests in flight and the rest wait here, reporting their
 * queue position. The per-request timeout then measures EXECUTION only —
 * waiting behind other cards never trips it, so a queued photo must not fall
 * back to the browser pipeline just for being patient.
 */
export function createRecognitionScheduler(options: { concurrency: number }) {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  let active = 0;
  const waiting: Array<() => void> = [];
  const start = (job: () => Promise<unknown>) => {
    active += 1;
    void job().catch(() => undefined).finally(() => {
      active -= 1;
      const next = waiting.shift();
      if (next) next();
    });
  };
  return {
    get active() { return active; },
    get waiting() { return waiting.length; },
    run<T>(job: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const launch = () => start(async () => {
          try { resolve(await job()); } catch (reason) { reject(reason); }
        });
        if (active < concurrency) launch();
        else waiting.push(launch);
      });
    },
  };
}

/** Human-facing queue status for the wizard's recognition box. */
export function queueStatusMessage(waiting: number, active: number): string | null {
  if (waiting <= 0) return null;
  const cards = waiting === 1 ? "carta" : "cartas";
  const verb = active > 0 ? "reconhecendo" : "aguardando";
  return `Na fila de reconhecimento… (${waiting} ${cards} na frente, ${verb} ${active})`;
}
