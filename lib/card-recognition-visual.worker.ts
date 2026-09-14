// Exact-print matcher. Cheap structural comparison runs first; DINOv2 is only a tie-breaker.
import { pipeline, env, RawImage, type ImageFeatureExtractionPipeline } from "@huggingface/transformers";

import { extractDinoEmbedding, cosineSimilarity } from "./card-recognition-embedding";

const MODEL = "onnx-community/dinov2-small-ONNX";
const MATCH_WIDTH = 48;
const MATCH_HEIGHT = 66;
const MAX_NORMAL_CANDIDATES = 100;
const MAX_DINO_CANDIDATES = 5;

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

let extractor: ImageFeatureExtractionPipeline | null = null;
let backend = "";
let initMs = 0;
let embeddingDimension = 0;
let embeddingOutput = "";
const embeddings = new Map<string, number[]>();
const officialBlobs = new Map<string, Blob>();
const fingerprints = new Map<string, Fingerprint>();

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

type Fingerprint = {
  gray: Float32Array;
  edge: Float32Array;
  histogram: Float32Array;
};

type BackendOption = { device: "webgpu" | "wasm"; dtype: "q4" | "int8" };

function cachePut<T>(cache: Map<string, T>, key: string, value: T, limit = 96) {
  if (cache.size >= limit) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

function catalogImageUrl(base: string) {
  const url = new URL(`${base}/low.webp`);
  if (url.protocol !== "https:" || url.hostname !== "assets.tcgdex.net") throw new Error("Unsupported catalog image");
  return url.href;
}

async function getOfficialBlob(base: string) {
  const url = catalogImageUrl(base);
  const cached = officialBlobs.get(url);
  if (cached) return { url, blob: cached };
  const response = await fetch(url, { credentials: "omit", cache: "force-cache", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Imagem oficial indisponível: HTTP ${response.status}`);
  const blob = await response.blob();
  cachePut(officialBlobs, url, blob);
  return { url, blob };
}

async function makeFingerprint(blob: Blob): Promise<Fingerprint> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(MATCH_WIDTH, MATCH_HEIGHT);
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas visual indisponível");
    context.drawImage(bitmap, 0, 0, MATCH_WIDTH, MATCH_HEIGHT);
    const data = context.getImageData(0, 0, MATCH_WIDTH, MATCH_HEIGHT).data;
    const gray = new Float32Array(MATCH_WIDTH * MATCH_HEIGHT);
    const histogram = new Float32Array(24);
    const pixels = MATCH_WIDTH * MATCH_HEIGHT;
    for (let offset = 0, pixel = 0; offset < data.length; offset += 4, pixel += 1) {
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      gray[pixel] = r * 0.299 + g * 0.587 + b * 0.114;
      histogram[Math.min(7, Math.floor(r * 8))] += 1 / pixels;
      histogram[8 + Math.min(7, Math.floor(g * 8))] += 1 / pixels;
      histogram[16 + Math.min(7, Math.floor(b * 8))] += 1 / pixels;
    }
    const edge = new Float32Array(gray.length);
    for (let y = 1; y < MATCH_HEIGHT - 1; y += 1) {
      for (let x = 1; x < MATCH_WIDTH - 1; x += 1) {
        const index = y * MATCH_WIDTH + x;
        const dx = gray[index + 1] - gray[index - 1];
        const dy = gray[index + MATCH_WIDTH] - gray[index - MATCH_WIDTH];
        edge[index] = Math.sqrt(dx * dx + dy * dy);
      }
    }
    return { gray, edge, histogram };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

function shiftedNcc(
  left: Float32Array,
  right: Float32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxShift = 2,
) {
  let best = -1;
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      let n = 0;
      let sumA = 0; let sumB = 0; let sumAA = 0; let sumBB = 0; let sumAB = 0;
      for (let y = y0; y < y1; y += 1) {
        const by = y + dy;
        if (by < 0 || by >= MATCH_HEIGHT) continue;
        for (let x = x0; x < x1; x += 1) {
          const bx = x + dx;
          if (bx < 0 || bx >= MATCH_WIDTH) continue;
          const a = left[y * MATCH_WIDTH + x];
          const b = right[by * MATCH_WIDTH + bx];
          n += 1; sumA += a; sumB += b; sumAA += a * a; sumBB += b * b; sumAB += a * b;
        }
      }
      if (n < 64) continue;
      const numerator = n * sumAB - sumA * sumB;
      const denominator = Math.sqrt(Math.max(1e-10, (n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB)));
      best = Math.max(best, numerator / denominator);
    }
  }
  return Math.max(0, Math.min(1, (best + 1) / 2));
}

function shiftedEdgeCosine(left: Float32Array, right: Float32Array, maxShift = 2) {
  let best = 0;
  const x0 = 4; const x1 = MATCH_WIDTH - 4;
  const y0 = 10; const y1 = Math.round(MATCH_HEIGHT * 0.68);
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      let dot = 0; let aa = 0; let bb = 0;
      for (let y = y0; y < y1; y += 1) {
        const by = y + dy;
        if (by < 0 || by >= MATCH_HEIGHT) continue;
        for (let x = x0; x < x1; x += 1) {
          const bx = x + dx;
          if (bx < 0 || bx >= MATCH_WIDTH) continue;
          const a = left[y * MATCH_WIDTH + x];
          const b = right[by * MATCH_WIDTH + bx];
          dot += a * b; aa += a * a; bb += b * b;
        }
      }
      if (aa > 0 && bb > 0) best = Math.max(best, dot / Math.sqrt(aa * bb));
    }
  }
  return Math.max(0, Math.min(1, best));
}

function histogramIntersection(left: Float32Array, right: Float32Array) {
  let overlap = 0;
  for (let index = 0; index < left.length; index += 1) overlap += Math.min(left[index], right[index]);
  return Math.max(0, Math.min(1, overlap / 3));
}

function structuralSimilarity(photo: Fingerprint, official: Fingerprint) {
  const artwork = shiftedNcc(photo.gray, official.gray, 4, 10, MATCH_WIDTH - 4, Math.round(MATCH_HEIGHT * 0.67), 2);
  const whole = shiftedNcc(photo.gray, official.gray, 2, 2, MATCH_WIDTH - 2, MATCH_HEIGHT - 2, 2);
  const edges = shiftedEdgeCosine(photo.edge, official.edge, 2);
  const color = histogramIntersection(photo.histogram, official.histogram);
  return Math.max(0, Math.min(1, artwork * 0.52 + whole * 0.23 + edges * 0.20 + color * 0.05));
}

async function compareStructurally(photo: Blob, images: string[]) {
  self.postMessage({ progress: `🖼 Comparando arte e estrutura com ${images.length} impressões…` });
  const query = await makeFingerprint(photo);
  const similarities: number[] = [];
  for (const base of images) {
    const { url, blob } = await getOfficialBlob(base);
    let fingerprint = fingerprints.get(url);
    if (!fingerprint) {
      fingerprint = await makeFingerprint(blob);
      cachePut(fingerprints, url, fingerprint);
    }
    similarities.push(structuralSimilarity(query, fingerprint));
  }
  const order = similarities.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  const top = order[0];
  const second = order[1];
  const margin = top ? top.score - (second?.score ?? 0) : 0;
  const winnerIndex = top && top.score >= 0.58 && margin >= 0.05 ? top.index : undefined;
  return { similarities, winnerIndex, order };
}

async function embed(image: Blob) {
  const bitmap = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  let raw: RawImage;
  try {
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    raw = new RawImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, 4);
  } finally {
    bitmap.close(); canvas.width = canvas.height = 0;
  }
  const inputs = await extractor!.processor(raw);
  try {
    const outputs = await extractor!.model(inputs);
    try {
      const embedding = extractDinoEmbedding(outputs);
      embeddingDimension = embedding.values.length;
      embeddingOutput = embedding.output;
      return embedding.values;
    } finally {
      for (const tensor of Object.values(outputs)) (tensor as { dispose?: () => void })?.dispose?.();
    }
  } finally {
    for (const tensor of Object.values(inputs)) (tensor as { dispose?: () => void })?.dispose?.();
  }
}

function backendOptions(testBackend?: string) {
  const options: BackendOption[] = [];
  if ("gpu" in navigator) options.push({ device: "webgpu", dtype: "q4" });
  options.push({ device: "wasm", dtype: "q4" }, { device: "wasm", dtype: "int8" });
  return testBackend && testBackend !== "auto"
    ? options.filter(option => `${option.device}/${option.dtype}` === testBackend)
    : options;
}

async function ensureExtractor(testBackend?: string) {
  if (extractor && testBackend && testBackend !== "auto" && backend !== testBackend) {
    await extractor.dispose(); extractor = null; embeddings.clear();
  }
  if (extractor) return;
  const errors: string[] = [];
  const options = backendOptions(testBackend);
  if (!options.length) throw new Error(`${testBackend}: backend não disponível neste navegador`);
  for (const option of options) {
    try {
      const started = performance.now();
      self.postMessage({ progress: "🧠 Preparando IA local pela primeira vez ou recuperando o cache…" });
      extractor = await pipeline("image-feature-extraction", MODEL, { ...option, progress_callback: () => {} });
      initMs = Math.round(performance.now() - started);
      backend = `${option.device}/${option.dtype}`;
      return;
    } catch (error) {
      errors.push(`${option.device}/${option.dtype}: ${errorText(error)}`);
      await extractor?.dispose(); extractor = null; embeddings.clear();
    }
  }
  throw new Error(errors.join(" | ") || "Modelo quantizado indisponível");
}

async function dinoSimilarities(photo: Blob, images: string[]) {
  self.postMessage({ progress: "🧠 Desempate local por embeddings…" });
  const query = await embed(photo);
  const similarities: number[] = [];
  for (const base of images) {
    const { url, blob } = await getOfficialBlob(base);
    let embedding = embeddings.get(url);
    if (!embedding) {
      embedding = await embed(blob);
      cachePut(embeddings, url, embedding, 64);
    }
    similarities.push(cosineSimilarity(query, embedding));
  }
  return similarities;
}

async function diagnosticCompare(photo: Blob, images: string[], testBackend?: string) {
  await ensureExtractor(testBackend);
  const similarities = await dinoSimilarities(photo, images);
  return { similarities, backend, initMs, embeddingDimension, embeddingOutput };
}

async function normalCompare(photo: Blob, images: string[]) {
  const structural = await compareStructurally(photo, images);
  if (structural.winnerIndex != null) {
    return {
      similarities: structural.similarities,
      winnerIndex: structural.winnerIndex,
      backend: "structural",
      initMs: 0,
      embeddingDimension: 0,
      embeddingOutput: "structural/artwork+ncc+edges+histogram",
    };
  }

  const selected = structural.order.slice(0, MAX_DINO_CANDIDATES);
  if (selected.length < 2) return {
    similarities: structural.similarities,
    backend: "structural",
    initMs: 0,
    embeddingDimension: 0,
    embeddingOutput: "structural/artwork+ncc+edges+histogram",
  };

  try {
    await ensureExtractor();
    const dino = await dinoSimilarities(photo, selected.map(item => images[item.index]));
    const dinoOrder = dino.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const structuralTop = selected[0];
    const dinoTop = dinoOrder[0];
    const structuralMargin = structuralTop.score - (selected[1]?.score ?? 0);
    const dinoMargin = dinoTop.score - (dinoOrder[1]?.score ?? 0);
    // DINOv2 is semantic, not print-identification AI. It may confirm the structural winner,
    // but it is never allowed to override a different artwork winner.
    const winnerIndex = dinoTop.index === 0 && structuralTop.score >= 0.50 && structuralMargin >= 0.015 && dinoMargin >= 0.01
      ? structuralTop.index
      : undefined;
    return {
      similarities: structural.similarities,
      winnerIndex,
      backend: `${backend}+structural`,
      initMs,
      embeddingDimension,
      embeddingOutput,
    };
  } catch (error) {
    // Exact-art matching remains useful even when model download/WebGPU/WASM fails.
    return {
      similarities: structural.similarities,
      backend: `structural (DINO indisponível: ${errorText(error)})`,
      initMs: 0,
      embeddingDimension: 0,
      embeddingOutput: "structural/artwork+ncc+edges+histogram",
    };
  }
}

self.onmessage = async (event: MessageEvent<{ photo: Blob; images: string[]; diagnostic?: boolean; testBackend?: string }>) => {
  const { photo, images, diagnostic, testBackend } = event.data;
  const max = diagnostic ? 5 : MAX_NORMAL_CANDIDATES;
  if (images.length < (diagnostic ? 1 : 2) || images.length > max) {
    self.postMessage({ error: "Invalid candidate count" });
    return;
  }
  try {
    const result = diagnostic
      ? await diagnosticCompare(photo, images, testBackend)
      : await normalCompare(photo, images);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ error: errorText(error) });
  }
};
