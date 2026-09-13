import type { RecognitionCandidate } from "./card-recognition-core";

export type VisualReply = { similarities: number[]; backend: string };
export function needsVisualFallback(candidates: RecognitionCandidate[]) {
  if (candidates.length < 2 || candidates.length > 5 || candidates.some(c => !c.image || !c.evidence?.strongEvidence)) return false;
  const [best, second] = candidates;
  return !(best.evidence?.fullNumberMatch && best.evidence.nameSimilarity >= 0.9 && best.score - second.score >= 8);
}

// Cosine similarity is additional evidence, never a calibrated probability or permission
// to admit candidates rejected by OCR. Keep uncertain outcomes reviewable.
export function applyVisualEvidence(candidates: RecognitionCandidate[], similarities: number[]) {
  if (similarities.length !== candidates.length || similarities.some(n => !Number.isFinite(n))) return candidates;
  const visual = candidates.map((candidate, i) => ({ ...candidate, visualSimilarity: similarities[i] }));
  const ordered = [...visual].sort((a, b) => b.visualSimilarity - a.visualSimilarity);
  if (ordered[0].visualSimilarity < 0.75 || ordered[0].visualSimilarity - ordered[1].visualSimilarity < 0.06) return visual;
  return ordered;
}

// Factory keeps the worker lazy and allows behavior tests without downloading model weights.
export function createVisualFallback(createWorker: () => Worker, idleMs = 120_000, timeoutMs = 90_000) {
  let worker: Worker | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let rejectActive: ((error: Error) => void) | undefined;
  let disabledUntil = 0;
  const dispose = () => {
    clearTimeout(idle);
    worker?.terminate();
    worker = null;
    rejectActive?.(new Error("Visual recognition stopped"));
    rejectActive = undefined;
  };
  const recognize = (photo: Blob, candidates: RecognitionCandidate[]) => {
    const run = async () => {
      if (!needsVisualFallback(candidates) || Date.now() < disabledUntil) return { candidates, used: false };
      clearTimeout(idle);
      try {
        worker ??= createWorker();
        const reply = await new Promise<VisualReply>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Visual recognition timed out")), timeoutMs);
          const finish = (error?: Error, result?: VisualReply) => {
            clearTimeout(timer);
            rejectActive = undefined;
            if (error) reject(error); else resolve(result!);
          };
          rejectActive = error => finish(error);
          worker!.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data);
          worker!.onerror = () => finish(new Error("Visual worker unavailable"));
          worker!.postMessage({ photo, images: candidates.map(c => c.image) });
        });
        return { candidates: applyVisualEvidence(candidates, reply.similarities), used: true, backend: reply.backend };
      } catch {
        dispose();
        disabledUntil = Date.now() + idleMs; // A broken model must not retry for every image in a batch.
        return { candidates, used: false };
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
