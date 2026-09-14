"use client";

import type { RecognitionCandidate, RecognitionLanguage } from "./card-recognition-core";

const INDEX_META = "/card-recognition/index-v1.meta.tsv";
const INDEX_BIN = "/card-recognition/index-v1.bin";
const BYTES_PER_CARD = 36;
const DEFAULT_TOP_K = 24;
const MAX_VISUAL_FINALISTS = 20;
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const CATALOG_TIMEOUT_MS = 8_000;

type GlobalEntry = { id: string; image: string; localId: string; name: string };
type LoadedIndex = { entries: GlobalEntry[]; descriptors: Uint8Array };
type Descriptor = Uint8Array;

type GlobalCandidate = RecognitionCandidate & {
  globalVisualRank?: number;
  globalVisualDistance?: number;
};

export type GlobalVisualResult = {
  status: "disabled" | "unavailable" | "searched" | "compared" | "failed";
  candidates: GlobalCandidate[];
  winner?: GlobalCandidate;
  indexCandidates: number;
  catalogRequests: number;
  elapsedMs: number;
  backend?: string;
  error?: string;
};

type WorkerReply = {
  similarities?: number[];
  winnerIndex?: number;
  backend?: string;
  error?: string;
  progress?: string;
};

let indexPromise: Promise<LoadedIndex> | null = null;
let workerTail: Promise<unknown> = Promise.resolve();
let visualWorker: Worker | null = null;
let workerIdle: ReturnType<typeof setTimeout> | undefined;
const detailCache = new Map<string, Promise<RecognitionCandidate | null>>();

const POPCOUNT = new Uint8Array(Array.from({ length: 256 }, (_, value) => {
  let n = value;
  let count = 0;
  while (n) { n &= n - 1; count += 1; }
  return count;
}));

function parseMeta(text: string) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [id, image, localId, ...nameParts] = line.split("\t");
    return { id, image, localId, name: nameParts.join("\t") } satisfies GlobalEntry;
  }).filter(entry => entry.id && entry.image);
}

async function loadGlobalIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const [metaResponse, binResponse] = await Promise.all([
      fetch(INDEX_META, { cache: "force-cache" }),
      fetch(INDEX_BIN, { cache: "force-cache" }),
    ]);
    if (!metaResponse.ok || !binResponse.ok) throw new Error("Índice visual global ainda não está disponível.");
    const [metaText, buffer] = await Promise.all([metaResponse.text(), binResponse.arrayBuffer()]);
    const entries = parseMeta(metaText);
    const descriptors = new Uint8Array(buffer);
    if (!entries.length || descriptors.length !== entries.length * BYTES_PER_CARD) {
      throw new Error("Índice visual global incompatível; atualize os assets.");
    }
    return { entries, descriptors };
  })().catch(error => {
    indexPromise = null;
    throw error;
  });
  return indexPromise;
}

async function decodeBlob(blob: Blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function regionHash(
  image: ImageBitmap | HTMLImageElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível para fingerprint visual.");
  const sx = Math.max(0, Math.round(image.width * x0));
  const sy = Math.max(0, Math.round(image.height * y0));
  const sw = Math.max(1, Math.round(image.width * (x1 - x0)));
  const sh = Math.max(1, Math.round(image.height * (y1 - y0)));
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 9, 8);
  const rgba = ctx.getImageData(0, 0, 9, 8).data;
  const hash = new Uint8Array(8);
  for (let y = 0; y < 8; y += 1) {
    let value = 0;
    for (let x = 0; x < 8; x += 1) {
      const left = (y * 9 + x) * 4;
      const right = left + 4;
      const grayLeft = rgba[left] * 0.299 + rgba[left + 1] * 0.587 + rgba[left + 2] * 0.114;
      const grayRight = rgba[right] * 0.299 + rgba[right + 1] * 0.587 + rgba[right + 2] * 0.114;
      if (grayLeft > grayRight) value |= (1 << (7 - x));
    }
    hash[y] = value;
  }
  canvas.width = canvas.height = 0;
  return hash;
}

function artworkHistogram(image: ImageBitmap | HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 32;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível para histograma visual.");
  const sx = Math.round(image.width * 0.04);
  const sy = Math.round(image.height * 0.08);
  const sw = Math.max(1, Math.round(image.width * 0.92));
  const sh = Math.max(1, Math.round(image.height * 0.67));
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 24, 32);
  const rgba = ctx.getImageData(0, 0, 24, 32).data;
  const bins = new Float64Array(12);
  let pixels = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    bins[Math.min(3, Math.floor(rgba[i] / 64))] += 1;
    bins[4 + Math.min(3, Math.floor(rgba[i + 1] / 64))] += 1;
    bins[8 + Math.min(3, Math.floor(rgba[i + 2] / 64))] += 1;
    pixels += 1;
  }
  canvas.width = canvas.height = 0;
  const output = new Uint8Array(12);
  for (let i = 0; i < bins.length; i += 1) output[i] = Math.max(0, Math.min(255, Math.round(bins[i] / Math.max(1, pixels) * 255)));
  return output;
}

export async function fingerprintCard(blob: Blob): Promise<Descriptor> {
  const image = await decodeBlob(blob);
  try {
    const descriptor = new Uint8Array(BYTES_PER_CARD);
    descriptor.set(regionHash(image, 0.06, 0.12, 0.94, 0.60), 0);      // printed artwork box
    descriptor.set(regionHash(image, 0.03, 0.06, 0.97, 0.76), 8);      // broad artwork/full-art region
    descriptor.set(regionHash(image, 0.00, 0.00, 1.00, 1.00), 16);    // whole print
    descriptor.set(artworkHistogram(image), 24);
    return descriptor;
  } finally {
    if ("close" in image && typeof image.close === "function") image.close();
  }
}

function hamming(query: Uint8Array, queryOffset: number, all: Uint8Array, candidateOffset: number) {
  let distance = 0;
  for (let i = 0; i < 8; i += 1) distance += POPCOUNT[query[queryOffset + i] ^ all[candidateOffset + i]];
  return distance / 64;
}

function histogramDistance(query: Uint8Array, all: Uint8Array, candidateOffset: number) {
  let distance = 0;
  for (let i = 0; i < 12; i += 1) distance += Math.abs(query[24 + i] - all[candidateOffset + 24 + i]);
  return Math.min(1, distance / 1530);
}

export function descriptorDistance(query: Uint8Array, all: Uint8Array, candidateOffset: number) {
  // Retrieval only. Final identification is made by independent structural/OCR evidence.
  const art = hamming(query, 0, all, candidateOffset);
  const broad = hamming(query, 8, all, candidateOffset + 8);
  const whole = hamming(query, 16, all, candidateOffset + 16);
  const color = histogramDistance(query, all, candidateOffset);
  return art * 0.52 + broad * 0.26 + whole * 0.14 + color * 0.08;
}

function topMatches(index: LoadedIndex, descriptor: Descriptor, limit = DEFAULT_TOP_K) {
  const best: Array<{ index: number; distance: number }> = [];
  for (let i = 0; i < index.entries.length; i += 1) {
    const distance = descriptorDistance(descriptor, index.descriptors, i * BYTES_PER_CARD);
    if (best.length < limit || distance < best[best.length - 1].distance) {
      let position = best.length;
      while (position > 0 && best[position - 1].distance > distance) position -= 1;
      best.splice(position, 0, { index: i, distance });
      if (best.length > limit) best.pop();
    }
  }
  return best;
}

function emptyEvidence() {
  return {
    fullNumberMatch: false,
    localIdMatch: false,
    denominatorMatch: false,
    localIdSimilarity: 0,
    nameSimilarity: 0,
    languageMatch: false,
    hpMatch: false,
    strongEvidence: false,
  };
}

function languageCode(language?: RecognitionLanguage) {
  if (language === "pt-BR") return "pt";
  return language ?? "en";
}

function shortlistCandidates(index: LoadedIndex, matches: Array<{ index: number; distance: number }>, language?: RecognitionLanguage) {
  return matches.slice(0, MAX_VISUAL_FINALISTS).map((match, rank): GlobalCandidate => {
    const entry = index.entries[match.index];
    return {
      id: entry.id,
      name: entry.name,
      collection: "",
      cardNumber: entry.localId,
      localId: entry.localId,
      denominator: null,
      language: language ?? "en",
      hp: null,
      image: entry.image,
      score: Math.max(0, Math.round((1 - match.distance) * 100)),
      evidence: emptyEvidence(),
      globalVisualRank: rank + 1,
      globalVisualDistance: match.distance,
    };
  });
}

function disposeVisualWorker() {
  clearTimeout(workerIdle);
  visualWorker?.terminate();
  visualWorker = null;
}

function compareShortlist(blob: Blob, candidates: GlobalCandidate[], onProgress?: (message: string) => void) {
  const run = async () => {
    if (candidates.length < 2) return { candidates, backend: "global-index-only" };
    clearTimeout(workerIdle);
    visualWorker ??= new Worker(new URL("./card-recognition-visual.worker.ts", import.meta.url), { type: "module" });
    onProgress?.(`🧭 Busca visual global encontrou ${candidates.length} finalistas; comparando scans…`);
    return new Promise<{ candidates: GlobalCandidate[]; winner?: GlobalCandidate; backend?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Comparação visual global excedeu o tempo limite.")), 90_000);
      const finish = (value?: { candidates: GlobalCandidate[]; winner?: GlobalCandidate; backend?: string }, error?: Error) => {
        clearTimeout(timer);
        visualWorker!.onmessage = null;
        visualWorker!.onerror = null;
        workerIdle = setTimeout(disposeVisualWorker, 120_000);
        if (error) reject(error); else resolve(value!);
      };
      visualWorker!.onmessage = event => {
        const reply = event.data as WorkerReply;
        if (reply.progress) { onProgress?.(reply.progress); return; }
        if (reply.error) { finish(undefined, new Error(reply.error)); return; }
        const similarities = reply.similarities ?? [];
        const enriched = candidates.map((candidate, index) => ({ ...candidate, visualSimilarity: similarities[index] }));
        const winner = Number.isInteger(reply.winnerIndex) && reply.winnerIndex! >= 0 && reply.winnerIndex! < enriched.length
          ? enriched[reply.winnerIndex!]
          : undefined;
        if (winner) {
          winner.evidence = { ...winner.evidence!, visualMatch: true, strongEvidence: true };
          enriched.sort((a, b) => Number(b.id === winner.id) - Number(a.id === winner.id) || (b.visualSimilarity ?? 0) - (a.visualSimilarity ?? 0));
        }
        finish({ candidates: enriched, winner, backend: reply.backend });
      };
      visualWorker!.onerror = event => finish(undefined, new Error(event.message || "Worker visual global falhou."));
      visualWorker!.postMessage({ photo: blob, images: candidates.map(candidate => candidate.image) });
    });
  };
  const queued = workerTail.then(run, run);
  workerTail = queued.then(() => undefined, () => undefined);
  return queued;
}

async function fetchDetail(id: string, language: RecognitionLanguage | undefined, fallback: GlobalCandidate, stats: { requests: number }) {
  const codes = [...new Set([languageCode(language), language === "pt-BR" ? "pt-br" : "", "en"].filter(Boolean))];
  for (const code of codes) {
    const cacheKey = `${code}:${id}`;
    let pending = detailCache.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        stats.requests += 1;
        const response = await fetch(`${TCGDEX_BASE}/${code}/cards/${encodeURIComponent(id)}`, {
          mode: "cors", credentials: "omit", cache: "force-cache", signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const card = await response.json() as {
          id: string; localId: string | number; name: string; image?: string | null; hp?: number | null;
          set?: { name?: string; cardCount?: { official?: number; total?: number } };
          variants?: Record<string, unknown>;
        };
        const denominator = Number(card.set?.cardCount?.official ?? card.set?.cardCount?.total ?? 0) || null;
        const localId = String(card.localId ?? fallback.localId);
        const variants = card.variants ?? {};
        const variantNames = [["normal", "Normal"], ["holo", "Holo"], ["reverse", "Reverse Holo"]] as const;
        const available = variantNames.filter(([key]) => variants[key] === true).map(([, value]) => value);
        const recognizedLanguage = code === "pt" || code === "pt-br" ? "pt-BR" : code as RecognitionLanguage;
        return {
          ...fallback,
          id: card.id || fallback.id,
          name: card.name || fallback.name,
          collection: card.set?.name ?? "",
          cardNumber: denominator ? `${localId}/${denominator}` : localId,
          localId,
          denominator,
          language: recognizedLanguage,
          hp: card.hp == null ? null : Number(card.hp),
          image: card.image ?? fallback.image,
          variant: available.length === 1 ? available[0] : undefined,
        } satisfies GlobalCandidate;
      })().catch(() => null);
      detailCache.set(cacheKey, pending);
      if (detailCache.size > 128) detailCache.delete(detailCache.keys().next().value!);
    }
    const value = await pending;
    if (value) return value;
  }
  return fallback;
}

export async function searchGlobalVisual(
  normalizedCard: Blob,
  detectedLanguage?: RecognitionLanguage,
  onProgress?: (message: string) => void,
  topK = DEFAULT_TOP_K,
): Promise<GlobalVisualResult> {
  const started = performance.now();
  const stats = { requests: 0 };
  try {
    onProgress?.("🧭 Pesquisando a carta no índice visual global — sem depender do nome OCR…");
    const [index, descriptor] = await Promise.all([loadGlobalIndex(), fingerprintCard(normalizedCard)]);
    const matches = topMatches(index, descriptor, Math.max(5, Math.min(50, topK)));
    const shortlist = shortlistCandidates(index, matches, detectedLanguage);
    const compared = await compareShortlist(normalizedCard, shortlist, onProgress);
    let winner = compared.winner;
    if (winner) winner = await fetchDetail(winner.id, detectedLanguage, winner, stats);
    const candidates = winner
      ? [winner, ...compared.candidates.filter(candidate => candidate.id !== winner!.id)].slice(0, 5)
      : compared.candidates.slice(0, 5);
    return {
      status: compared.winner ? "compared" : "searched",
      candidates,
      winner,
      indexCandidates: index.entries.length,
      catalogRequests: stats.requests,
      elapsedMs: Math.round(performance.now() - started),
      backend: compared.backend,
    };
  } catch (error) {
    return {
      status: error instanceof Error && /índice visual global/i.test(error.message) ? "unavailable" : "failed",
      candidates: [],
      indexCandidates: 0,
      catalogRequests: stats.requests,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function shutdownGlobalVisualRecognition() {
  disposeVisualWorker();
}

export const globalVisualRuntime = {
  version: 1,
  descriptorBytesPerCard: BYTES_PER_CARD,
  defaultTopK: DEFAULT_TOP_K,
  maxFinalists: MAX_VISUAL_FINALISTS,
  indexFiles: [INDEX_META, INDEX_BIN] as const,
  route: "photo→compact-index→Top-K→official-images→structural/DINO",
  independentFromOcrName: true,
};
