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

function resultQuality(result: RecognitionResult) {
  const level = result.level === "high" ? 300 : result.level === "medium" ? 200 : 100;
  const complete = Number(Boolean(result.name)) * 12 + Number(Boolean(result.cardNumber)) * 18 + Number(Boolean(result.collection)) * 16 + Number(Boolean(result.language)) * 5;
  const evidence = result.candidates?.[0]?.evidence;
  const evidenceBonus = Number(Boolean(evidence?.fullNumberMatch)) * 35 + Number(Boolean(evidence?.visualMatch)) * 30 + Math.round((evidence?.nameSimilarity ?? 0) * 20);
  return level + result.confidence + complete + evidenceBonus;
}

function choose(results: RecognitionResult[]) {
  const ordered = [...results].sort((a, b) => resultQuality(b) - resultQuality(a));
  const best = { ...ordered[0] };
  const agreeing = ordered.filter(result => result !== ordered[0] && sameIdentity(best, result));
  if (best.level === "medium" && agreeing.length) {
    best.confidence = Math.min(85, Math.max(best.confidence, ...agreeing.map(result => result.confidence)) + 4);
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
  if (primary.level === "high") {
    save(hash, primary);
    return primary;
  }

  onProgress?.("🔁 Estratégia 2/3 · conferindo com o reconhecedor anterior");
  try {
    const legacy = await previous.recognizePokemonCard(file, preferredLanguage, onProgress, { bypassCache });
    results.push(legacy);
    if (legacy.level === "high") {
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
