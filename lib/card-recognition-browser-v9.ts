"use client";

import * as current from "./card-recognition-browser";
import * as previous from "./card-recognition-browser-v7";
import { rescuePokemonCard, rescueRecognitionRuntime, shutdownRescueRecognition } from "./card-recognition-rescue";
import type { RecognitionResult } from "./card-recognition-core";

const FUSION_CACHE_PREFIX = "leilao:card-recognition:fusion-v9:";
const fusionMemory = new Map<string, RecognitionResult>();
let fusionTail: Promise<unknown> = Promise.resolve();

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

function cached(hash: string) {
  const memory = fusionMemory.get(hash);
  if (memory) return { ...memory, source: "cache" as const, elapsedMs: 0, catalogRequests: 0 };
  try {
    const raw = sessionStorage.getItem(`${FUSION_CACHE_PREFIX}${hash}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecognitionResult;
    if (fusionMemory.size >= 64) fusionMemory.delete(fusionMemory.keys().next().value!);
    fusionMemory.set(hash, parsed);
    return { ...parsed, source: "cache" as const, elapsedMs: 0, catalogRequests: 0 };
  } catch {
    return null;
  }
}

function save(hash: string, result: RecognitionResult) {
  if (fusionMemory.size >= 64) fusionMemory.delete(fusionMemory.keys().next().value!);
  fusionMemory.set(hash, result);
  try { sessionStorage.setItem(`${FUSION_CACHE_PREFIX}${hash}`, JSON.stringify(result)); } catch { /* optional */ }
}

function normalized(value: string | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function sameIdentity(left: RecognitionResult, right: RecognitionResult) {
  const leftName = normalized(left.name ?? left.hints?.name);
  const rightName = normalized(right.name ?? right.hints?.name);
  const leftNumber = normalized(left.cardNumber ?? left.hints?.cardNumber);
  const rightNumber = normalized(right.cardNumber ?? right.hints?.cardNumber);
  if (leftName && rightName && leftNumber && rightNumber) return leftName === rightName && leftNumber === rightNumber;
  return Boolean(leftName && rightName && leftName === rightName && left.collection && right.collection && normalized(left.collection) === normalized(right.collection));
}

function evidenceOf(result: RecognitionResult) {
  return result.candidates?.[0]?.evidence;
}

function decisive(result: RecognitionResult) {
  const evidence = evidenceOf(result);
  if (!evidence) return false;
  if (evidence.fullNumberMatch && evidence.nameSimilarity >= 0.86) return true;
  if (evidence.visualMatch && evidence.nameSimilarity >= 0.78) return true;
  return false;
}

function resultQuality(result: RecognitionResult) {
  const evidence = evidenceOf(result);
  const level = result.level === "high" ? 75 : result.level === "medium" ? 45 : 10;
  const complete = Number(Boolean(result.name)) * 12 + Number(Boolean(result.cardNumber)) * 20 + Number(Boolean(result.collection)) * 18 + Number(Boolean(result.language)) * 5;
  const evidenceBonus = Number(Boolean(evidence?.fullNumberMatch)) * 90
    + Number(Boolean(evidence?.visualMatch)) * 85
    + Number(Boolean(evidence?.localIdMatch)) * 30
    + Number(Boolean(evidence?.denominatorMatch)) * 18
    + Math.round((evidence?.nameSimilarity ?? 0) * 45);
  return level + Math.min(100, result.confidence) + complete + evidenceBonus + (decisive(result) ? 120 : 0);
}

function choose(results: RecognitionResult[]) {
  const scored = results.map(result => {
    const agreement = results.filter(other => other !== result && sameIdentity(result, other)).length;
    return { result, score: resultQuality(result) + agreement * 150, agreement };
  }).sort((a, b) => b.score - a.score || b.agreement - a.agreement);

  const winner = scored[0];
  const best = { ...winner.result };
  if (winner.agreement > 0) {
    const agreeing = results.filter(result => result !== winner.result && sameIdentity(best, result));
    const agreedConfidence = Math.max(best.confidence, ...agreeing.map(result => result.confidence));
    if (best.level === "low") {
      best.confidence = Math.max(60, Math.min(79, agreedConfidence + 7));
      best.level = "medium";
    } else if (best.level === "medium") {
      best.confidence = Math.min(85, Math.max(60, agreedConfidence + 5));
    }
  }
  return best;
}

async function performFusion(
  file: File,
  preferredLanguage?: string,
  onProgress?: (message: string) => void,
  bypassCache = false,
) {
  const started = performance.now();
  const hash = await sha256(file);
  if (!bypassCache) {
    const hit = cached(hash);
    if (hit) {
      onProgress?.("Resultado reutilizado do cache de reconhecimento v9");
      return hit;
    }
  }

  const results: RecognitionResult[] = [];

  onProgress?.("🔎 Estratégia 1/3 · reconhecimento principal");
  const primary = await current.recognizePokemonCard(file, preferredLanguage, onProgress, { bypassCache });
  results.push(primary);
  // Only stop early when both the printed number and name (or exact visual print) agree.
  // A generic 'high' score alone is not enough to suppress the regression safety net.
  if (decisive(primary)) {
    save(hash, primary);
    return primary;
  }

  onProgress?.("🔁 Estratégia 2/3 · conferindo com o reconhecedor anterior");
  try {
    const legacy = await previous.recognizePokemonCard(file, preferredLanguage, onProgress, { bypassCache });
    results.push(legacy);
    if (decisive(legacy) && (primary.level === "low" || sameIdentity(primary, legacy))) {
      const final = { ...legacy, elapsedMs: Math.round(performance.now() - started) };
      save(hash, final);
      return final;
    }
  } catch {
    // The previous pipeline is a regression safety net; rescue remains available.
  }

  onProgress?.("🛟 Estratégia 3/3 · resgate por foto inteira + catálogo fuzzy + arte");
  const rescued = await rescuePokemonCard(file, preferredLanguage, onProgress);
  if (rescued) results.push(rescued);

  const final = choose(results);
  final.elapsedMs = Math.round(performance.now() - started);
  final.catalogRequests = results.reduce((sum, result) => sum + Number(result.catalogRequests || 0), 0);
  save(hash, final);
  onProgress?.(final.level === "high"
    ? `✅ ${final.name ?? "Carta"} identificada — ${final.confidence}%`
    : final.level === "medium"
      ? `🟡 ${final.name ?? "Possível carta"} — ${final.confidence}% — confirme os dados`
      : "🔴 As três estratégias não chegaram a uma identificação segura");
  return final;
}

export function recognizePokemonCard(
  file: File,
  preferredLanguage?: string,
  onProgress?: (message: string) => void,
  options: { bypassCache?: boolean } = {},
) {
  const run = () => performFusion(file, preferredLanguage, onProgress, Boolean(options.bypassCache));
  const queued = fusionTail.then(run, run);
  fusionTail = queued.then(() => undefined, () => undefined);
  return queued;
}

export async function shutdownCardRecognition() {
  await fusionTail;
  await Promise.allSettled([
    current.shutdownCardRecognition(),
    previous.shutdownCardRecognition(),
    shutdownRescueRecognition(),
  ]);
}

export const resolveCatalog = current.resolveCatalog;

export const cardRecognitionRuntime = {
  ...current.cardRecognitionRuntime,
  fusionVersion: 9,
  strategies: ["current", "previous-regression-safety-net", rescueRecognitionRuntime.strategy],
};
