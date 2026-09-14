import type { RecognitionCandidate } from "./card-recognition-core";

// Fixed diagnostic fixture documented by TCGdex; never enters recognition/ranking.
// https://tcgdex.dev/rest/filtering-sorting-pagination
export function visualDiagnosticReference(pool: RecognitionCandidate[] = []): RecognitionCandidate {
  const existing = pool.find(candidate => candidate.image?.startsWith("https://assets.tcgdex.net/"));
  return existing ?? {
    id: "diagnostic-basep-1", name: "Referência de teste", image: "https://assets.tcgdex.net/en/base/basep/1",
    collection: "", cardNumber: "", localId: "", denominator: null, language: "en", hp: null, score: 0,
  };
}

export type VisualReply = { similarities: number[]; backend: string; initMs?: number; embeddingDimension?: number; embeddingOutput?: string };
export type VisualOutcome = { candidates: RecognitionCandidate[]; used: boolean; status: "not-needed" | "no-candidates" | "insufficient-clues" | "compared" | "failed"; reason?: string; error?: string; backend?: string; similarities?: number[]; initMs?: number; embeddingDimension?: number; embeddingOutput?: string };
export type VisualTestBackend = "auto" | "webgpu/q4" | "wasm/q4" | "wasm/int8";
export function recognitionDebugEnabled() {
  return typeof window !== "undefined" &&
    (process.env.NODE_ENV === "development" || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) &&
    new URLSearchParams(window.location.search).get("recognitionDebug") === "1";
}
export function needsVisualFallback(candidates: RecognitionCandidate[]) {
  if (candidates.length < 2 || candidates.length > 5 || candidates.some(c => !c.image || !c.evidence || !(c.evidence.localIdMatch || c.evidence.nameSimilarity >= 0.55 || (c.evidence.denominatorMatch && c.evidence.localIdSimilarity >= 0.66)))) return false;
  const [best, second] = candidates;
  return !(best.evidence?.fullNumberMatch && best.evidence.nameSimilarity >= 0.9 && best.score - second.score >= 8);
}

// Only a plausible shortlist plus strong, separated visual evidence can promote a candidate.
// Similarity is never a calibrated probability.
export function applyVisualEvidence(candidates: RecognitionCandidate[], similarities: number[]) {
  if (similarities.length !== candidates.length || similarities.some(n => !Number.isFinite(n))) return candidates;
  const visual = candidates.map((candidate, i) => ({ ...candidate, visualSimilarity: similarities[i] }));
  const ordered = [...visual].sort((a, b) => b.visualSimilarity - a.visualSimilarity);
  if (ordered.length < 2 || ordered[0].visualSimilarity < 0.85 || ordered[0].visualSimilarity - ordered[1].visualSimilarity < 0.08) return visual;
  ordered[0] = { ...ordered[0], evidence: { ...ordered[0].evidence!, visualMatch: true, strongEvidence: true } };
  return ordered;
}

// Factory keeps the worker lazy and allows behavior tests without downloading model weights.
export function createVisualFallback(createWorker: () => Worker, idleMs = 120_000, timeoutMs = 90_000) {
  let worker: Worker | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let rejectActive: ((error: Error) => void) | undefined;
  let disabledUntil = 0;
  let lastError = "";
  const dispose = () => {
    clearTimeout(idle);
    worker?.terminate();
    worker = null;
    rejectActive?.(new Error("Visual recognition stopped"));
    rejectActive = undefined;
  };
  const recognize = (photo: Blob, candidates: RecognitionCandidate[], onProgress?: (message: string) => void, testBackend?: VisualTestBackend) => {
    const run = async (): Promise<VisualOutcome> => {
      const forced = testBackend !== undefined && typeof window !== "undefined";
      if (!forced && !needsVisualFallback(candidates)) return { candidates, used: false, status: candidates.length < 2 ? "no-candidates" : "not-needed", reason: candidates.length < 2 ? "Menos de dois candidatos visuais plausíveis" : "OCR inequívoco ou shortlist inadequada" };
      if (!forced && Date.now() < disabledUntil) return { candidates, used: false, status: "failed", error: lastError, reason: "Nova tentativa suspensa temporariamente após falha" };
      clearTimeout(idle);
      try {
        onProgress?.("🧠 Preparando IA local pela primeira vez ou recuperando o cache…");
        worker ??= createWorker();
        const reply = await new Promise<VisualReply>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Visual recognition timed out")), timeoutMs);
          const finish = (error?: Error, result?: VisualReply) => {
            clearTimeout(timer);
            rejectActive = undefined;
            if (error) reject(error); else resolve(result!);
          };
          rejectActive = error => finish(error);
          worker!.onmessage = event => {
            if (event.data.progress) { onProgress?.(event.data.progress); return; }
            event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data);
          };
          worker!.onerror = event => finish(new Error(event.message || "Não foi possível iniciar o worker visual"));
          worker!.postMessage({ photo, images: candidates.map(c => c.image), diagnostic: forced, testBackend: forced ? testBackend : undefined });
        });
        if (reply.similarities.length !== candidates.length || reply.similarities.some(n => !Number.isFinite(n))) throw new Error("Embedding/cosseno inválido");
        return { candidates: forced ? candidates : applyVisualEvidence(candidates, reply.similarities), used: true, status: "compared", backend: reply.backend, similarities: reply.similarities, initMs: reply.initMs, embeddingDimension: reply.embeddingDimension, embeddingOutput: reply.embeddingOutput, reason: "Comparação concluída; similaridade não é probabilidade" };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        dispose();
        disabledUntil = Date.now() + idleMs; // A broken model must not retry for every image in a batch.
        return { candidates, used: false, status: "failed", error: lastError, reason: "Modelo ou worker indisponível" };
      } finally {
        if (worker) idle = setTimeout(dispose, idleMs);
      }
    };
    const queued = tail.then(run, run);
    tail = queued.then(() => undefined, () => undefined);
    return queued;
  };
  return { recognize, dispose };
}

const visual = createVisualFallback(() => new Worker(new URL("./card-recognition-visual.worker.ts", import.meta.url), { type: "module" }));
export const recognizeVisually = visual.recognize;
export const shutdownVisualRecognition = visual.dispose;
