import type { RecognitionResult } from "./card-recognition-core";

export type RecognitionGroundTruth = {
  fixtureId: string;
  cardId: string;
  name: string;
  set: string;
  cardNumber: string;
  language: string;
  variant?: string | null;
  image?: string;
  publishable?: boolean;
};

export type RecognitionBenchmarkSample = {
  groundTruth: RecognitionGroundTruth;
  result: RecognitionResult;
  latencyMs?: number;
  ramMb?: number | null;
  vramMb?: number | null;
};

export type RecognitionBenchmarkSummary = {
  samples: number;
  top1ExactCardAccuracy: number;
  top3ExactCardAccuracy: number;
  top5ExactCardAccuracy: number;
  nameAccuracy: number;
  setAccuracy: number;
  collectorNumberAccuracy: number;
  languageAccuracy: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  meanCatalogRequests: number;
  meanRamMb: number | null;
  meanVramMb: number | null;
};

function canonical(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function sameCardId(candidateId: string | undefined, expectedId: string) {
  return Boolean(candidateId && canonical(candidateId) === canonical(expectedId));
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function optionalAverage(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? average(finite) : null;
}

export function evaluateRecognitionSample(sample: RecognitionBenchmarkSample) {
  const { groundTruth, result } = sample;
  const candidates = result.candidates ?? [];
  const rank = candidates.findIndex(candidate => sameCardId(candidate.id, groundTruth.cardId));
  const selected = candidates[0];
  return {
    exactRank: rank < 0 ? null : rank + 1,
    top1: rank === 0,
    top3: rank >= 0 && rank < 3,
    top5: rank >= 0 && rank < 5,
    nameCorrect: canonical(result.name ?? selected?.name) === canonical(groundTruth.name),
    setCorrect: canonical(result.collection ?? selected?.collection) === canonical(groundTruth.set),
    collectorNumberCorrect: canonical(result.cardNumber ?? selected?.cardNumber) === canonical(groundTruth.cardNumber),
    languageCorrect: canonical(result.language ?? selected?.language) === canonical(groundTruth.language),
  };
}

export function summarizeRecognitionBenchmark(samples: RecognitionBenchmarkSample[]): RecognitionBenchmarkSummary {
  if (!samples.length) {
    return {
      samples: 0,
      top1ExactCardAccuracy: 0,
      top3ExactCardAccuracy: 0,
      top5ExactCardAccuracy: 0,
      nameAccuracy: 0,
      setAccuracy: 0,
      collectorNumberAccuracy: 0,
      languageAccuracy: 0,
      meanLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      meanCatalogRequests: 0,
      meanRamMb: null,
      meanVramMb: null,
    };
  }

  const evaluations = samples.map(evaluateRecognitionSample);
  const ratio = (values: boolean[]) => values.filter(Boolean).length / samples.length;
  const latencies = samples.map(sample => sample.latencyMs ?? sample.result.elapsedMs).filter(Number.isFinite);
  return {
    samples: samples.length,
    top1ExactCardAccuracy: ratio(evaluations.map(value => value.top1)),
    top3ExactCardAccuracy: ratio(evaluations.map(value => value.top3)),
    top5ExactCardAccuracy: ratio(evaluations.map(value => value.top5)),
    nameAccuracy: ratio(evaluations.map(value => value.nameCorrect)),
    setAccuracy: ratio(evaluations.map(value => value.setCorrect)),
    collectorNumberAccuracy: ratio(evaluations.map(value => value.collectorNumberCorrect)),
    languageAccuracy: ratio(evaluations.map(value => value.languageCorrect)),
    meanLatencyMs: average(latencies),
    p50LatencyMs: percentile(latencies, 0.50),
    p95LatencyMs: percentile(latencies, 0.95),
    meanCatalogRequests: average(samples.map(sample => Number(sample.result.catalogRequests || 0))),
    meanRamMb: optionalAverage(samples.map(sample => sample.ramMb)),
    meanVramMb: optionalAverage(samples.map(sample => sample.vramMb)),
  };
}

export function formatRecognitionBenchmark(summary: RecognitionBenchmarkSummary) {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  return {
    samples: summary.samples,
    top1: percent(summary.top1ExactCardAccuracy),
    top3: percent(summary.top3ExactCardAccuracy),
    top5: percent(summary.top5ExactCardAccuracy),
    name: percent(summary.nameAccuracy),
    set: percent(summary.setAccuracy),
    collectorNumber: percent(summary.collectorNumberAccuracy),
    language: percent(summary.languageAccuracy),
    meanLatencyMs: Math.round(summary.meanLatencyMs),
    p50LatencyMs: Math.round(summary.p50LatencyMs),
    p95LatencyMs: Math.round(summary.p95LatencyMs),
    meanCatalogRequests: Number(summary.meanCatalogRequests.toFixed(2)),
    meanRamMb: summary.meanRamMb == null ? null : Number(summary.meanRamMb.toFixed(1)),
    meanVramMb: summary.meanVramMb == null ? null : Number(summary.meanVramMb.toFixed(1)),
  };
}
