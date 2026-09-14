"use client";

import { candidateEvidence, type OcrHints, type RecognitionCandidate, type RecognitionLanguage } from "./card-recognition-core";
import { preserveCandidateCollectorWidth } from "./card-recognition-format";

const MODEL_URL = "/card-recognition/milo/model.onnx";
const INDEX_URL = "/card-recognition/milo/index-int8.bin";
const META_URL = "/card-recognition/milo/index.meta.tsv";
const CACHE_NAME = "leilao-card-recognition-milo-v1";
const DIMENSIONS = 128;
const INT8_SCALE = 127;
const RETRIEVAL_K = 50;
const DISPLAY_K = 20;
const DETAIL_K = 8;
const TCGDEX_BASE = "https://api.tcgdex.net/v2";

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;
type Entry = { id: string; image: string; localId: string; name: string };
type LoadedIndex = { entries: Entry[]; vectors: Int8Array };
type MiloCandidate = RecognitionCandidate & { retrievalRank?: number; retrievalCosine?: number };

export type MiloVisualResult = {
  status: "unavailable" | "searched" | "compared" | "failed";
  candidates: MiloCandidate[];
  winner?: MiloCandidate;
  indexCandidates: number;
  catalogRequests: number;
  elapsedMs: number;
  backend?: string;
  error?: string;
};

let ortPromise: Promise<Ort> | null = null;
let sessionPromise: Promise<{ ort: Ort; session: Session; backend: string }> | null = null;
let indexPromise: Promise<LoadedIndex> | null = null;
let sessionIdle: ReturnType<typeof setTimeout> | undefined;
const details = new Map<string, Promise<MiloCandidate | null>>();

async function cachedFetch(url: string) {
  if (typeof caches === "undefined") return fetch(url, { cache: "force-cache" });
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) return hit;
  const response = await fetch(url, { cache: "force-cache" });
  if (response.ok) await cache.put(url, response.clone());
  return response;
}

function parseMeta(text: string) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [id, image, localId, ...name] = line.split("\t");
    return { id, image, localId, name: name.join("\t") };
  }).filter(entry => entry.id && entry.image);
}

async function loadIndex() {
  indexPromise ??= (async () => {
    const [metaResponse, indexResponse] = await Promise.all([cachedFetch(META_URL), cachedFetch(INDEX_URL)]);
    if (!metaResponse.ok || !indexResponse.ok) throw new Error("Índice neural Milo ainda não está disponível.");
    const [meta, buffer] = await Promise.all([metaResponse.text(), indexResponse.arrayBuffer()]);
    const entries = parseMeta(meta);
    const vectors = new Int8Array(buffer);
    if (!entries.length || vectors.length !== entries.length * DIMENSIONS) throw new Error("Índice Milo incompatível com os metadados.");
    return { entries, vectors };
  })().catch(error => { indexPromise = null; throw error; });
  return indexPromise;
}

async function loadSession() {
  clearTimeout(sessionIdle);
  sessionPromise ??= (async () => {
    const ort = await (ortPromise ??= import("onnxruntime-web"));
    ort.env.wasm.numThreads = 1;
    const response = await cachedFetch(MODEL_URL);
    if (!response.ok) throw new Error("Modelo Milo ainda não está disponível.");
    const model = await response.arrayBuffer();
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const session = await ort.InferenceSession.create(model.slice(0), { executionProviders: ["webgpu"] });
        return { ort, session, backend: "milo/webgpu" };
      } catch { /* RX 570 / browser may not expose a compatible WebGPU backend. */ }
    }
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    return { ort, session, backend: "milo/wasm" };
  })().catch(error => { sessionPromise = null; throw error; });
  const loaded = await sessionPromise;
  sessionIdle = setTimeout(() => {
    void sessionPromise?.then(({ session }) => session.release()).catch(() => undefined);
    sessionPromise = null;
  }, 120_000);
  return loaded;
}

async function imageTensor(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 448;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas indisponível para o encoder Milo.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, 448, 448);
    const pixels = ctx.getImageData(0, 0, 448, 448).data;
    const plane = 448 * 448;
    const data = new Float32Array(plane * 3);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    for (let p = 0, i = 0; p < plane; p += 1, i += 4) {
      data[p] = (pixels[i] / 255 - mean[0]) / std[0];
      data[plane + p] = (pixels[i + 1] / 255 - mean[1]) / std[1];
      data[plane * 2 + p] = (pixels[i + 2] / 255 - mean[2]) / std[2];
    }
    canvas.width = canvas.height = 0;
    return data;
  } finally { bitmap.close(); }
}

function normalizeEmbedding(values: Float32Array) {
  let squared = 0;
  for (const value of values) squared += value * value;
  const norm = Math.sqrt(squared) || 1;
  for (let i = 0; i < values.length; i += 1) values[i] /= norm;
  return values;
}

async function embed(blob: Blob) {
  const [{ ort, session, backend }, data] = await Promise.all([loadSession(), imageTensor(blob)]);
  const input = new ort.Tensor("float32", data, [1, 3, 448, 448]);
  const feeds = { [session.inputNames[0]]: input };
  const outputs = await session.run(feeds);
  const raw = outputs[session.outputNames[0]]?.data;
  if (!raw || raw.length !== DIMENSIONS) throw new Error("Saída inesperada do encoder Milo.");
  return { embedding: normalizeEmbedding(Float32Array.from(raw as ArrayLike<number>)), backend };
}

function topMatches(index: LoadedIndex, query: Float32Array) {
  const top: Array<{ index: number; cosine: number }> = [];
  for (let row = 0; row < index.entries.length; row += 1) {
    const offset = row * DIMENSIONS;
    let cosine = 0;
    for (let d = 0; d < DIMENSIONS; d += 1) cosine += query[d] * (index.vectors[offset + d] / INT8_SCALE);
    if (top.length < RETRIEVAL_K || cosine > top[top.length - 1].cosine) {
      let position = top.length;
      while (position > 0 && top[position - 1].cosine < cosine) position -= 1;
      top.splice(position, 0, { index: row, cosine });
      if (top.length > RETRIEVAL_K) top.pop();
    }
  }
  return top;
}

function emptyEvidence() {
  return { fullNumberMatch: false, localIdMatch: false, denominatorMatch: false, localIdSimilarity: 0, nameSimilarity: 0, languageMatch: false, hpMatch: false, strongEvidence: false };
}

function languageCode(language?: RecognitionLanguage) {
  if (language === "pt-BR") return "pt";
  return language ?? "en";
}

function shortlist(index: LoadedIndex, matches: ReturnType<typeof topMatches>, language?: RecognitionLanguage) {
  return matches.slice(0, DISPLAY_K).map((match, rank): MiloCandidate => {
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
      score: 0,
      evidence: emptyEvidence(),
      visualSimilarity: match.cosine,
      retrievalRank: rank + 1,
      retrievalCosine: match.cosine,
    };
  });
}

async function fetchDetail(candidate: MiloCandidate, language: RecognitionLanguage | undefined, stats: { requests: number }) {
  const codes = [...new Set([languageCode(language), language === "pt-BR" ? "pt-br" : "", "en"].filter(Boolean))];
  for (const code of codes) {
    const key = `${code}:${candidate.id}`;
    let pending = details.get(key);
    if (!pending) {
      pending = (async () => {
        stats.requests += 1;
        const response = await fetch(`${TCGDEX_BASE}/${code}/cards/${encodeURIComponent(candidate.id)}`, { cache: "force-cache", mode: "cors", credentials: "omit", signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return null;
        const card = await response.json() as { id?: string; localId?: string | number; name?: string; image?: string; hp?: number | null; set?: { name?: string; cardCount?: { official?: number; total?: number } }; variants?: Record<string, unknown> };
        const localId = String(card.localId ?? candidate.localId);
        const denominator = Number(card.set?.cardCount?.official ?? card.set?.cardCount?.total ?? 0) || null;
        const variants = card.variants ?? {};
        const available = [["normal", "Normal"], ["holo", "Holo"], ["reverse", "Reverse Holo"]] as const;
        const variantNames = available.filter(([keyName]) => variants[keyName] === true).map(([, value]) => value);
        const recognizedLanguage: RecognitionLanguage = code === "pt" || code === "pt-br" ? "pt-BR" : code as RecognitionLanguage;
        return preserveCandidateCollectorWidth({
          ...candidate,
          id: card.id ?? candidate.id,
          name: card.name ?? candidate.name,
          collection: card.set?.name ?? candidate.collection,
          cardNumber: denominator ? `${localId}/${denominator}` : localId,
          localId,
          denominator,
          language: recognizedLanguage,
          hp: card.hp == null ? null : Number(card.hp),
          image: card.image ?? candidate.image,
          variant: variantNames.length === 1 ? variantNames[0] : undefined,
        });
      })().catch(() => null);
      details.set(key, pending);
    }
    const value = await pending;
    if (value) return value;
  }
  return candidate;
}

function normalized(value: string | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function chooseDetailIndexes(candidates: MiloCandidate[], hints?: OcrHints) {
  const indexes = new Set<number>(Array.from({ length: Math.min(DETAIL_K, candidates.length) }, (_, i) => i));
  if (!hints) return [...indexes];
  const local = normalized(hints.localId);
  const name = normalized(hints.name);
  candidates.forEach((candidate, index) => {
    if (index >= DISPLAY_K) return;
    if (local && normalized(candidate.localId) === local) indexes.add(index);
    if (name && normalized(candidate.name) === name) indexes.add(index);
  });
  return [...indexes].slice(0, 12);
}

function selectWinner(candidates: MiloCandidate[], hints?: OcrHints) {
  if (!candidates.length) return undefined;
  if (!hints) return candidates[0];
  const enriched = candidates.map(candidate => ({ candidate, evidence: candidateEvidence(candidate, hints) }));
  const exact = enriched.find(value => value.evidence.fullNumberMatch);
  if (exact) { exact.candidate.evidence = { ...exact.evidence, visualMatch: true, strongEvidence: true }; return exact.candidate; }
  const named = enriched.find(value => value.evidence.nameSimilarity >= 0.90 && (value.candidate.retrievalRank ?? 99) <= 20);
  if (named) { named.candidate.evidence = { ...named.evidence, visualMatch: true, strongEvidence: true }; return named.candidate; }
  const first = candidates[0];
  first.evidence = { ...candidateEvidence(first, hints), visualMatch: true };
  return first;
}

export async function searchMiloVisual(blob: Blob, language?: RecognitionLanguage, hints?: OcrHints, onProgress?: (message: string) => void): Promise<MiloVisualResult> {
  const started = performance.now();
  const stats = { requests: 0 };
  try {
    onProgress?.("🧠 IA visual Milo: carregando índice neural local…");
    const [index, encoded] = await Promise.all([loadIndex(), embed(blob)]);
    onProgress?.(`🧠 IA visual Milo (${encoded.backend}): procurando entre ${index.entries.length.toLocaleString("pt-BR")} impressões…`);
    const matches = topMatches(index, encoded.embedding);
    let candidates = shortlist(index, matches, language);
    const detailIndexes = chooseDetailIndexes(candidates, hints);
    const enriched = await Promise.all(detailIndexes.map(async indexPosition => [indexPosition, await fetchDetail(candidates[indexPosition], language, stats)] as const));
    const replacements = new Map(enriched.filter(([, value]) => value).map(([indexPosition, value]) => [indexPosition, value!]));
    candidates = candidates.map((candidate, indexPosition) => replacements.get(indexPosition) ?? candidate);
    const winner = selectWinner(candidates, hints);
    return {
      status: "compared",
      candidates,
      winner,
      indexCandidates: index.entries.length,
      catalogRequests: stats.requests,
      elapsedMs: Math.round(performance.now() - started),
      backend: encoded.backend,
    };
  } catch (error) {
    return { status: "failed", candidates: [], indexCandidates: 0, catalogRequests: stats.requests, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  }
}

export function shutdownMiloRecognition() {
  clearTimeout(sessionIdle);
  void sessionPromise?.then(({ session }) => session.release()).catch(() => undefined);
  sessionPromise = null;
}

export const miloRuntime = {
  model: "HanClinto/milo v1.0.0",
  modelLicense: "AGPL-3.0",
  dimensions: DIMENSIONS,
  indexQuantization: "int8/127",
  retrievalK: RETRIEVAL_K,
  browserCache: CACHE_NAME,
  discoveryDependsOnOcr: false,
};
