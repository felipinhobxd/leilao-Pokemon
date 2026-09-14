"use client";

import { candidateEvidence, type OcrHints, type RecognitionCandidate, type RecognitionLanguage } from "./card-recognition-core";
import { preserveCandidateCollectorWidth } from "./card-recognition-format";

const ASSET_VERSION = "milo-v1-19501x128-20260914";
const ASSET_BASE = "/card-recognition/milo";
const MODEL_PATH = `${ASSET_BASE}/model.onnx`;
const INDEX_PATH = `${ASSET_BASE}/index-int8.bin`;
const META_PATH = `${ASSET_BASE}/index.meta.tsv`;
const STATS_PATH = `${ASSET_BASE}/index.stats.json`;
const CACHE_NAME = `leilao-card-recognition-${ASSET_VERSION}`;
const LEGACY_CACHE_NAMES = ["leilao-card-recognition-milo-v1"];
const DIMENSIONS = 128;
const EXPECTED_CARDS = 19_501;
const EXPECTED_INDEX_BYTES = EXPECTED_CARDS * DIMENSIONS;
const EXPECTED_MODEL_BYTES = 5_191_100;
const INT8_SCALE = 127;
const RETRIEVAL_K = 50;
const DISPLAY_K = 20;
const DETAIL_K = 8;
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const QUERY_AUTOCONTRAST_CUTOFF = 0.005; // 0.5% from each histogram tail, per RGB channel.

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;
type Entry = { id: string; image: string; localId: string; name: string };
type LoadedIndex = { entries: Entry[]; vectors: Int8Array };
type MiloCandidate = RecognitionCandidate & { retrievalRank?: number; retrievalCosine?: number };
type MiloStats = {
  version?: number;
  cardsIndexed?: number;
  embeddingDimension?: number;
  int8IndexBytes?: number;
  modelBytes?: number;
  int8Scale?: number;
};

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

function versionedAssetUrl(path: string, retryToken?: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(ASSET_VERSION)}${retryToken ? `&retry=${encodeURIComponent(retryToken)}` : ""}`;
}

async function deleteNamedCache(name: string) {
  if (typeof caches === "undefined") return;
  try { await caches.delete(name); } catch { /* Cache Storage is an optimization only. */ }
}

async function clearMiloAssetCaches() {
  await Promise.all([CACHE_NAME, ...LEGACY_CACHE_NAMES].map(deleteNamedCache));
}

async function fetchAsset(path: string, bypassCache = false, retryToken?: string) {
  const url = versionedAssetUrl(path, retryToken);
  if (!bypassCache && typeof caches !== "undefined") {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit;
  }

  // Do not delegate asset generation consistency to the browser's HTTP cache. The Cache
  // Storage entry above is keyed by ASSET_VERSION, while the network fetch itself is fresh.
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (response.ok && !bypassCache && typeof caches !== "undefined") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, response.clone());
  }
  return response;
}

function parseMeta(text: string) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [id, image, localId, ...name] = line.split("\t");
    return { id, image, localId, name: name.join("\t") };
  }).filter(entry => entry.id && entry.image);
}

function validateStats(stats: MiloStats) {
  const cards = Number(stats.cardsIndexed ?? 0);
  const dimensions = Number(stats.embeddingDimension ?? 0);
  const bytes = Number(stats.int8IndexBytes ?? 0);
  const modelBytes = Number(stats.modelBytes ?? 0);
  const expectedBytes = cards * dimensions;
  if (cards !== EXPECTED_CARDS || dimensions !== DIMENSIONS || bytes !== expectedBytes || bytes !== EXPECTED_INDEX_BYTES) {
    throw new Error(`Manifesto Milo incompatível: cards=${cards}, dimensão=${dimensions}, bytes=${bytes}, esperado=${EXPECTED_CARDS}x${DIMENSIONS}=${EXPECTED_INDEX_BYTES}.`);
  }
  if (modelBytes && modelBytes !== EXPECTED_MODEL_BYTES) {
    throw new Error(`Modelo Milo incompatível com o manifesto: bytes=${modelBytes}, esperado=${EXPECTED_MODEL_BYTES}.`);
  }
  if (stats.int8Scale != null && Number(stats.int8Scale) !== INT8_SCALE) {
    throw new Error(`Escala Milo incompatível: ${stats.int8Scale}, esperado=${INT8_SCALE}.`);
  }
  return { cards, dimensions, bytes };
}

async function loadIndexAttempt(bypassCache: boolean, retryToken?: string) {
  const [statsResponse, metaResponse, indexResponse] = await Promise.all([
    fetchAsset(STATS_PATH, bypassCache, retryToken),
    fetchAsset(META_PATH, bypassCache, retryToken),
    fetchAsset(INDEX_PATH, bypassCache, retryToken),
  ]);
  if (!statsResponse.ok || !metaResponse.ok || !indexResponse.ok) {
    throw new Error(`Assets Milo indisponíveis: stats=${statsResponse.status}, meta=${metaResponse.status}, index=${indexResponse.status}.`);
  }

  const [statsRaw, meta, buffer] = await Promise.all([
    statsResponse.json() as Promise<MiloStats>,
    metaResponse.text(),
    indexResponse.arrayBuffer(),
  ]);
  const manifest = validateStats(statsRaw);
  const entries = parseMeta(meta);
  const vectors = new Int8Array(buffer);
  const expectedBytes = entries.length * manifest.dimensions;
  if (entries.length !== manifest.cards || vectors.byteLength !== manifest.bytes || vectors.byteLength !== expectedBytes) {
    throw new Error(
      `Índice Milo incompatível: meta=${entries.length}, bytes=${vectors.byteLength}, dimensão=${manifest.dimensions}, ` +
      `esperado=${manifest.cards} cards/${manifest.bytes} bytes.`,
    );
  }
  return { entries, vectors } satisfies LoadedIndex;
}

async function loadIndex() {
  indexPromise ??= (async () => {
    // Remove the old unversioned cache once. It can contain meta/index files from different
    // generations and was the source of the real-browser "incompatível" failure.
    await Promise.all(LEGACY_CACHE_NAMES.map(deleteNamedCache));
    try {
      return await loadIndexAttempt(false);
    } catch (firstError) {
      // Self-heal once: remove only Milo caches and bypass both Cache Storage and HTTP cache.
      await clearMiloAssetCaches();
      try {
        return await loadIndexAttempt(true, `${Date.now()}`);
      } catch (secondError) {
        const first = firstError instanceof Error ? firstError.message : String(firstError);
        const second = secondError instanceof Error ? secondError.message : String(secondError);
        throw new Error(`Falha ao carregar o índice Milo após atualização automática. 1ª tentativa: ${first} 2ª tentativa: ${second}`);
      }
    }
  })().catch(error => { indexPromise = null; throw error; });
  return indexPromise;
}

async function loadModelBytes() {
  let response = await fetchAsset(MODEL_PATH);
  let model = response.ok ? await response.arrayBuffer() : null;
  if (!response.ok || !model || model.byteLength !== EXPECTED_MODEL_BYTES) {
    await clearMiloAssetCaches();
    response = await fetchAsset(MODEL_PATH, true, `${Date.now()}`);
    model = response.ok ? await response.arrayBuffer() : null;
  }
  if (!response.ok || !model) throw new Error(`Modelo Milo indisponível: HTTP ${response.status}.`);
  if (model.byteLength !== EXPECTED_MODEL_BYTES) {
    throw new Error(`Modelo Milo incompatível: bytes=${model.byteLength}, esperado=${EXPECTED_MODEL_BYTES}.`);
  }
  return model;
}

async function loadSession() {
  clearTimeout(sessionIdle);
  sessionPromise ??= (async () => {
    const [ort, model] = await Promise.all([ortPromise ??= import("onnxruntime-web"), loadModelBytes()]);
    ort.env.wasm.numThreads = 1;
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

function channelAutocontrastBounds(pixels: Uint8ClampedArray, channel: number) {
  const histogram = new Uint32Array(256);
  const count = pixels.length / 4;
  for (let i = channel; i < pixels.length; i += 4) histogram[pixels[i]] += 1;
  const trim = Math.floor(count * QUERY_AUTOCONTRAST_CUTOFF);
  let low = 0;
  let removed = 0;
  while (low < 255 && removed + histogram[low] <= trim) {
    removed += histogram[low];
    low += 1;
  }
  let high = 255;
  removed = 0;
  while (high > low && removed + histogram[high] <= trim) {
    removed += histogram[high];
    high -= 1;
  }
  return { low, high };
}

function autocontrastRgbInPlace(pixels: Uint8ClampedArray) {
  const bounds = [0, 1, 2].map(channel => channelAutocontrastBounds(pixels, channel));
  for (let i = 0; i < pixels.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const { low, high } = bounds[channel];
      if (high <= low) continue;
      pixels[i + channel] = Math.max(0, Math.min(255, Math.round((pixels[i + channel] - low) * 255 / (high - low))));
    }
  }
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
    // Real phone photos often carry glare, warm lighting or foil reflections. A tiny,
    // deterministic per-channel histogram trim makes the query closer to clean catalog
    // scans without using OCR, metadata or any card-specific tuning.
    autocontrastRgbInPlace(pixels);
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
  assetVersion: ASSET_VERSION,
  expectedCards: EXPECTED_CARDS,
  dimensions: DIMENSIONS,
  indexQuantization: "int8/127",
  retrievalK: RETRIEVAL_K,
  browserCache: CACHE_NAME,
  queryPhotometricNormalization: "autocontrast-0.5%-per-channel",
  discoveryDependsOnOcr: false,
};