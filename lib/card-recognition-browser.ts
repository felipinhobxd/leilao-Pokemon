"use client";

import {
  buildOcrHints,
  visualCandidatePool,
  collectorPartVariants,
  extractCardNumber,
  extractLikelyName,
  normalizeCollectorPart,
  rankRecognitionCandidates,
  resultFromCandidates,
  safeVariant,
  stringSimilarity,
  type OcrHints,
  type RecognitionCandidate,
  type RecognitionLanguage,
  type RecognitionResult,
} from "@/lib/card-recognition-core";

import { needsVisualFallback, recognizeVisually, shutdownVisualRecognition, type VisualOutcome } from "@/lib/card-recognition-visual";

const TESSERACT_VERSION = "7.0.0";
const TESSERACT_SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const SESSION_CACHE_PREFIX = "leilao:card-recognition:v4:";
const CATALOG_TTL_MS = 30 * 60_000;
const MAX_CATALOG_DETAILS = 4;
const MAX_CATALOG_REQUESTS = 8;
const DETECTION_WIDTH = 300;
const OCR_MAX_WIDTH = 1500;
const OCR_MIN_LINE_HEIGHT = 180;

type TesseractData = { text: string; confidence?: number };
type TesseractWorker = {
  recognize(image: HTMLCanvasElement, options?: Record<string, unknown>): Promise<{ data: TesseractData }>;
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
};
type TesseractGlobal = {
  createWorker(langs: string | string[], oem?: number, options?: { logger?: (message: { status?: string; progress?: number }) => void }): Promise<TesseractWorker>;
};

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
    __cardRecognitionDebug?: unknown[];
  }
}

type TcgSet = { id: string; name: string; cardCount?: { official?: number; total?: number } };
type TcgCard = {
  id: string;
  localId: string | number;
  name: string;
  image?: string | null;
  hp?: number | null;
  set?: TcgSet;
  variants?: Record<string, unknown>;
};
type TcgCardBrief = { id: string; localId?: string | number; name?: string; image?: string | null };
type CatalogStats = { requests: number; queries: string[]; exhausted?: boolean };
type CacheEntry = { expires: number; value: unknown };
type CardBox = { x: number; y: number; width: number; height: number; score: number; fallback: boolean };
type OcrRead = { text: string; confidence: number };
type NumberRead = OcrRead & ReturnType<typeof extractCardNumber>;

type RecognitionDebug = {
  file: { name: string; width: number; height: number };
  cardBox: CardBox;
  nameReads: OcrRead[];
  numberReads: NumberRead[];
  languageReads: OcrRead[];
  hints: OcrHints;
  catalogQueries: string[];
  candidates: RecognitionCandidate[];
  elapsedMs: number;
};

const catalogCache = new Map<string, CacheEntry>();
const recognitionMemoryCache = new Map<string, RecognitionResult>();
let tesseractPromise: Promise<TesseractGlobal> | null = null;
let latinWorkerPromise: Promise<TesseractWorker> | null = null;
let japaneseWorkerPromise: Promise<TesseractWorker> | null = null;
let recognitionTail: Promise<unknown> = Promise.resolve();

function tcgLanguage(language: RecognitionLanguage) {
  return language === "pt-BR" ? "pt-br" : language;
}

function uniqueLanguages(hints: OcrHints, preferred?: string): RecognitionLanguage[] {
  const supported = new Set<RecognitionLanguage>(["pt-BR", "en", "es", "ja"]);
  const values: RecognitionLanguage[] = [];
  const add = (value: string | null | undefined) => {
    if (value && supported.has(value as RecognitionLanguage) && !values.includes(value as RecognitionLanguage)) values.push(value as RecognitionLanguage);
  };
  if (hints.language && hints.languageConfidence >= 55) add(hints.language);
  if (preferred) add(preferred);
  for (const fallback of ["pt-BR", "en", "es", "ja"] as const) add(fallback);
  return values;
}

function loadTesseract() {
  if (typeof window === "undefined") return Promise.reject(new Error("OCR só funciona no navegador."));
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise<TesseractGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-card-ocr="${TESSERACT_VERSION}"]`);
    const finish = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("Tesseract.js carregou sem expor a API."));
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("Não foi possível carregar o OCR local.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = TESSERACT_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.cardOcr = TESSERACT_VERSION;
    script.onload = finish;
    script.onerror = () => reject(new Error("Não foi possível carregar o OCR local."));
    document.head.appendChild(script);
  });
  return tesseractPromise;
}

async function getLatinWorker(onProgress?: (message: string) => void) {
  if (!latinWorkerPromise) {
    latinWorkerPromise = loadTesseract().then(api => api.createWorker(["eng", "por", "spa"], 1, {
      logger: event => {
        if (event.status === "recognizing text" && typeof event.progress === "number") onProgress?.(`${Math.round(event.progress * 100)}%`);
      },
    }));
  }
  return latinWorkerPromise;
}

async function getJapaneseWorker(onProgress?: (message: string) => void) {
  if (!japaneseWorkerPromise) {
    japaneseWorkerPromise = loadTesseract().then(api => api.createWorker("jpn", 1, {
      logger: event => {
        if (event.status === "recognizing text" && typeof event.progress === "number") onProgress?.(`${Math.round(event.progress * 100)}%`);
      },
    }));
  }
  return japaneseWorkerPromise;
}

async function decodeImage(file: File) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file, { imageOrientation: "from-image" });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceCanvasForImage(image: ImageBitmap | HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new Error("Canvas indisponível para reconhecimento.");
  context.drawImage(image, 0, 0);
  if ("close" in image && typeof image.close === "function") image.close();
  return canvas;
}

function rotateCanvas(source: HTMLCanvasElement, degrees: 90 | 180 | 270) {
  const canvas = document.createElement("canvas");
  const swap = degrees === 90 || degrees === 270;
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível para orientação.");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degrees * Math.PI / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function detectionCanvas(source: HTMLCanvasElement) {
  const scale = Math.min(1, DETECTION_WIDTH / source.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas indisponível para localizar a carta.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function locateCard(source: HTMLCanvasElement): CardBox {
  const small = detectionCanvas(source);
  const context = small.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas indisponível para localizar a carta.");
  const image = context.getImageData(0, 0, small.width, small.height);
  const width = small.width;
  const height = small.height;
  const gray = new Float32Array(width * height);
  for (let index = 0, pixel = 0; index < image.data.length; index += 4, pixel += 1) {
    gray[pixel] = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
  }
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      gx[index] = Math.abs(gray[index + 1] - gray[index - 1]) / 2;
      gy[index] = Math.abs(gray[index + width] - gray[index - width]) / 2;
    }
  }

  const verticalBorder = (x: number, y0: number, y1: number) => {
    let total = 0; let covered = 0; let count = 0;
    for (let y = y0; y < y1; y += 1) {
      let local = 0;
      for (let dx = -1; dx <= 1; dx += 1) local = Math.max(local, gx[y * width + Math.max(0, Math.min(width - 1, x + dx))]);
      total += local; covered += local > 15 ? 1 : 0; count += 1;
    }
    return { mean: total / Math.max(1, count), coverage: covered / Math.max(1, count) };
  };
  const horizontalBorder = (y: number, x0: number, x1: number) => {
    let total = 0; let covered = 0; let count = 0;
    for (let x = x0; x < x1; x += 1) {
      let local = 0;
      for (let dy = -1; dy <= 1; dy += 1) local = Math.max(local, gy[Math.max(0, Math.min(height - 1, y + dy)) * width + x]);
      total += local; covered += local > 15 ? 1 : 0; count += 1;
    }
    return { mean: total / Math.max(1, count), coverage: covered / Math.max(1, count) };
  };

  let best: { score: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const aspects = [0.66, 0.69, 0.716, 0.74, 0.77];
  const minCardWidth = Math.round(width * 0.45);
  const maxCardWidth = Math.round(width * 0.70);
  const widthStep = Math.max(6, Math.round(width * 0.025));
  const centerXStep = Math.max(6, Math.round(width * 0.025));
  const centerYStep = Math.max(8, Math.round(height * 0.025));

  for (let cardWidth = minCardWidth; cardWidth <= maxCardWidth; cardWidth += widthStep) {
    for (const aspect of aspects) {
      const cardHeight = Math.round(cardWidth / aspect);
      if (cardHeight < height * 0.48 || cardHeight > height * 0.86) continue;
      for (let centerX = Math.round(width * 0.43); centerX <= width * 0.57; centerX += centerXStep) {
        const x0 = centerX - Math.floor(cardWidth / 2);
        const x1 = x0 + cardWidth;
        if (x0 < 4 || x1 >= width - 4) continue;
        for (let centerY = Math.round(height * 0.42); centerY <= height * 0.61; centerY += centerYStep) {
          const y0 = centerY - Math.floor(cardHeight / 2);
          const y1 = y0 + cardHeight;
          if (y0 < 4 || y1 >= height - 4) continue;
          const left = verticalBorder(x0, y0, y1);
          const right = verticalBorder(x1, y0, y1);
          const top = horizontalBorder(y0, x0, x1);
          const bottom = horizontalBorder(y1, x0, x1);
          const centerPenalty = Math.abs(centerX - width / 2) * 0.04 + Math.abs(centerY - height * 0.51) * 0.02;
          const score = left.mean + right.mean + top.mean + bottom.mean
            + 15 * (left.coverage + right.coverage + top.coverage + bottom.coverage) - centerPenalty;
          if (!best || score > best.score) best = { score, x0, y0, x1, y1 };
        }
      }
    }
  }

  if (!best || best.score < 55) {
    return {
      x: source.width * 0.14,
      y: source.height * 0.07,
      width: source.width * 0.72,
      height: source.height * 0.80,
      score: best?.score ?? 0,
      fallback: true,
    };
  }

  const scaleX = source.width / width;
  const scaleY = source.height / height;
  const rawX = best.x0 * scaleX;
  const rawY = best.y0 * scaleY;
  const rawWidth = (best.x1 - best.x0) * scaleX;
  const rawHeight = (best.y1 - best.y0) * scaleY;
  const x = Math.max(0, rawX - rawWidth * 0.08);
  const y = Math.max(0, rawY - rawHeight * 0.08);
  const right = Math.min(source.width, rawX + rawWidth * 1.08);
  const bottom = Math.min(source.height, rawY + rawHeight * 1.24);
  return { x, y, width: right - x, height: bottom - y, score: best.score, fallback: false };
}

function otsuThreshold(data: Uint8ClampedArray) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) histogram[data[index]] += 1;
  const total = data.length / 4;
  let weightedTotal = 0;
  for (let value = 0; value < 256; value += 1) weightedTotal += value * histogram[value];
  let backgroundWeight = 0; let backgroundTotal = 0; let bestVariance = -1; let threshold = 128;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundTotal += value * histogram[value];
    const backgroundMean = backgroundTotal / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundTotal) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = value; }
  }
  return threshold;
}

function cropCardRegion(
  source: HTMLCanvasElement,
  box: CardBox,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: "gray" | "contrast" | "threshold" = "gray",
) {
  const sourceX = Math.max(0, Math.round(box.x + box.width * x0));
  const sourceY = Math.max(0, Math.round(box.y + box.height * y0));
  const sourceWidth = Math.max(1, Math.min(source.width - sourceX, Math.round(box.width * (x1 - x0))));
  const sourceHeight = Math.max(1, Math.min(source.height - sourceY, Math.round(box.height * (y1 - y0))));
  const scale = Math.min(4, Math.max(1, OCR_MIN_LINE_HEIGHT / sourceHeight, Math.min(OCR_MAX_WIDTH / sourceWidth, 2.6)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: mode === "threshold" });
  if (!context) throw new Error("Canvas indisponível para OCR.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = mode === "gray" ? "grayscale(1) contrast(1.18)" : "grayscale(1) contrast(1.55)";
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  if (mode === "threshold") {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const threshold = otsuThreshold(image.data);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = image.data[index] >= threshold ? 255 : 0;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
    }
    context.putImageData(image, 0, 0);
  }
  return canvas;
}

async function recognizeWithWorker(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  psm: "6" | "7" | "11" | "13",
  whitelist = "",
): Promise<OcrRead> {
  try {
    await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist });
    const result = await worker.recognize(canvas, { rotateAuto: false });
    return { text: String(result.data.text ?? "").trim(), confidence: Number(result.data.confidence ?? 0) };
  } finally { canvas.width = canvas.height = 0; }
}

function nameReadScore(read: OcrRead) {
  const name = extractLikelyName(read.text);
  if (!name) return -100;
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  return Math.min(40, letters * 2) + Math.min(50, read.confidence) - (name.length > 32 ? 25 : 0);
}

async function recognizeName(source: HTMLCanvasElement, box: CardBox, worker: TesseractWorker) {
  const reads: OcrRead[] = [];
  const primary = cropCardRegion(source, box, 0, 0, 0.94, 0.14, "gray");
  reads.push(await recognizeWithWorker(worker, primary, "6"));
  if (nameReadScore(reads[0]) < 45) reads.push(await recognizeWithWorker(worker, cropCardRegion(source, box, 0, 0, 0.94, 0.14, "gray"), "11"));
  if (Math.max(...reads.map(nameReadScore)) < 50) {
    const alternate = cropCardRegion(source, box, 0, 0, 0.94, 0.19, "contrast");
    reads.push(await recognizeWithWorker(worker, alternate, "11"));
  }
  reads.sort((a, b) => nameReadScore(b) - nameReadScore(a));
  return { reads, best: reads[0] ?? { text: "", confidence: 0 } };
}

function plausibleNumber(read: NumberRead) {
  if (!read.localId || !read.denominator) return false;
  const localDigits = normalizeCollectorPart(read.localId).match(/\d+/)?.[0] ?? "";
  const local = Number(localDigits);
  const denominator = read.denominator;
  if (!Number.isFinite(local) || !Number.isFinite(denominator) || denominator < 20 || denominator > 700) return false;
  return local <= Math.max(denominator * 3, denominator + 180);
}

async function recognizeCollectorNumber(source: HTMLCanvasElement, box: CardBox, worker: TesseractWorker) {
  const reads: NumberRead[] = [];
  const bands: Array<[number, number]> = [[0.78, 0.91], [0.83, 0.96], [0.74, 0.87], [0.67, 0.80], [0.87, 0.99]];
  for (const [y0, y1] of bands) {
    const gray = cropCardRegion(source, box, 0, y0, 0.85, y1, "gray");
    const first = await recognizeWithWorker(worker, gray, "11");
    let parsed = { ...first, ...extractCardNumber(first.text) };
    reads.push(parsed);
    if (plausibleNumber(parsed)) return { reads, best: parsed };

    if (parsed.localId || parsed.denominator) {
      const contrast = cropCardRegion(source, box, 0, y0, 0.85, y1, "contrast");
      const second = await recognizeWithWorker(worker, contrast, "11");
      parsed = { ...second, ...extractCardNumber(second.text) };
      reads.push(parsed);
      if (plausibleNumber(parsed)) return { reads, best: parsed };
    }
  }
  const best = reads.filter(read => read.localId && read.denominator).sort((a, b) => Number(plausibleNumber(b)) - Number(plausibleNumber(a)) || b.confidence - a.confidence)[0];
  return { reads, best: best ?? { text: "", confidence: 0, cardNumber: "", localId: "", denominator: null, localIdVariants: [], denominatorVariants: [] } };
}

async function recognizeLanguage(source: HTMLCanvasElement, box: CardBox, worker: TesseractWorker, nameText: string, numberText: string) {
  const reads: OcrRead[] = [];
  const main = cropCardRegion(source, box, 0, 0.35, 0.98, 0.82, "gray");
  reads.push(await recognizeWithWorker(worker, main, "11"));
  let hints = buildOcrHints(nameText, numberText, reads.map(read => read.text).join("\n"));
  if (!hints.language || hints.languageConfidence < 70) {
    const lower = cropCardRegion(source, box, 0, 0.68, 0.98, 0.91, "contrast");
    reads.push(await recognizeWithWorker(worker, lower, "11"));
    hints = buildOcrHints(nameText, numberText, reads.map(read => read.text).join("\n"));
  }
  return { reads, hints };
}

function mergeNumberAlternatives(hints: OcrHints, reads: NumberRead[]) {
  const localIds = new Set(hints.localIdVariants ?? []);
  const denominators = new Set(hints.denominatorVariants ?? []);
  for (const read of reads) {
    for (const value of read.localIdVariants ?? []) localIds.add(value);
    for (const value of read.denominatorVariants ?? []) denominators.add(value);
    if (read.localId) for (const value of collectorPartVariants(read.localId, read.denominator)) localIds.add(value);
    if (read.denominator) denominators.add(read.denominator);
  }
  return { ...hints, localIdVariants: [...localIds], denominatorVariants: [...denominators] };
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

function sessionRecognition(hash: string) {
  const memory = recognitionMemoryCache.get(hash);
  if (memory) return { ...memory, source: "cache" as const, elapsedMs: 0, catalogRequests: 0 };
  try {
    const raw = sessionStorage.getItem(`${SESSION_CACHE_PREFIX}${hash}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecognitionResult;
    if (recognitionMemoryCache.size >= 64) recognitionMemoryCache.delete(recognitionMemoryCache.keys().next().value!);
    recognitionMemoryCache.set(hash, parsed);
    return { ...parsed, source: "cache" as const, elapsedMs: 0, catalogRequests: 0 };
  } catch { return null; }
}

function saveSessionRecognition(hash: string, result: RecognitionResult) {
  if (recognitionMemoryCache.size >= 64) recognitionMemoryCache.delete(recognitionMemoryCache.keys().next().value!);
  recognitionMemoryCache.set(hash, result);
  try { sessionStorage.setItem(`${SESSION_CACHE_PREFIX}${hash}`, JSON.stringify(result)); } catch { /* cache is optional */ }
}

async function fetchCatalog<T>(url: string, stats: CatalogStats): Promise<T> {
  const cached = catalogCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  if (stats.requests >= MAX_CATALOG_REQUESTS) { stats.exhausted = true; throw new Error("Catalog query budget exhausted"); }
  stats.requests += 1;
  stats.queries.push(url.replace(TCGDEX_BASE, ""));
  const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache", signal: AbortSignal.timeout(8_000) });
  if (response.status === 404) throw Object.assign(new Error("not-found"), { status: 404 });
  if (!response.ok) throw new Error(`TCGdex respondeu ${response.status}.`);
  const value = await response.json() as T;
  if (catalogCache.size >= 256) catalogCache.delete(catalogCache.keys().next().value!);
  catalogCache.set(url, { expires: Date.now() + CATALOG_TTL_MS, value });
  return value;
}

function candidateFromCard(card: TcgCard, language: RecognitionLanguage): Omit<RecognitionCandidate, "score" | "evidence"> | null {
  const set = card.set;
  if (!set?.name) return null;
  const denominator = Number(set.cardCount?.official ?? set.cardCount?.total ?? 0) || null;
  const localId = String(card.localId);
  return {
    id: card.id,
    name: card.name,
    collection: set.name,
    cardNumber: denominator ? `${localId}/${denominator}` : localId,
    localId,
    denominator,
    language,
    hp: card.hp == null ? null : Number(card.hp),
    image: card.image ?? null,
    variant: safeVariant(card.variants),
  };
}

function briefScore(brief: TcgCardBrief, hints: OcrHints) {
  const name = brief.name ? stringSimilarity(hints.name, brief.name) : 0;
  const local = brief.localId != null && hints.localId ? stringSimilarity(normalizeCollectorPart(hints.localId), normalizeCollectorPart(String(brief.localId))) : 0;
  return name * 72 + local * 28;
}

async function searchBriefs(code: string, params: URLSearchParams, stats: CatalogStats) {
  return fetchCatalog<TcgCardBrief[]>(`${TCGDEX_BASE}/${code}/cards?${params.toString()}`, stats);
}

export async function resolveCatalog(hints: OcrHints, preferredLanguage: string | undefined, stats: CatalogStats) {
  const candidates = new Map<string, Omit<RecognitionCandidate, "score" | "evidence">>();
  const snapshot = () => ({ ranked: rankRecognitionCandidates([...candidates.values()], hints),
    pool: visualCandidatePool([...candidates.values()], hints), before: candidates.size });
  if (!hints.localId && hints.name.replace(/[^\p{L}]/gu, "").length < 4) return snapshot();
  const trusted = hints.language != null && hints.languageConfidence >= 55;
  const languages = trusted ? [hints.language!] : uniqueLanguages(hints, preferredLanguage).slice(0, 2);
  const ids = [...new Set([...(hints.localIdVariants ?? []), hints.localId])].filter(Boolean).slice(0, 2);
  const name = hints.name.trim();
  const attempted = new Set<string>();
  for (const language of languages) {
    const code = tcgLanguage(language);
    const probes: Array<Record<string, string>> = [];
    if (name.length >= 4) for (const id of ids) probes.push({ name, localId: `eq:${id}` });
    for (const id of ids) probes.push({ localId: `eq:${id}` });
    if (name.length >= 4) {
      probes.push({ name });
      if (name.length >= 6) probes.push({ name: name.slice(0, 6) });
    }
    for (const probe of probes) {
      if (stats.requests >= MAX_CATALOG_REQUESTS) { stats.exhausted = true; return snapshot(); }
      try {
        const briefs = await searchBriefs(code, new URLSearchParams({ ...probe, "pagination:page": "1", "pagination:itemsPerPage": "10" }), stats);
        const sorted = [...briefs].sort((a, b) => briefScore(b, hints) - briefScore(a, hints)).slice(0, MAX_CATALOG_DETAILS);
        for (const brief of sorted) {
          const key = `${language}:${brief.id}`;
          if (attempted.has(key)) continue;
          if (stats.requests >= MAX_CATALOG_REQUESTS) { stats.exhausted = true; return snapshot(); }
          attempted.add(key);
          try {
            const card = await fetchCatalog<TcgCard>(`${TCGDEX_BASE}/${code}/cards/${encodeURIComponent(brief.id)}`, stats);
            const candidate = candidateFromCard(card, language);
            if (candidate) candidates.set(key, candidate);
          } catch { /* Keep already retrieved candidates. */ }
          const current = snapshot();
          // Only OCR evidence supports early identification; the form language is just search order.
          if (sorted.length === 1 && current.ranked[0]?.evidence?.fullNumberMatch && current.ranked[0].evidence.nameSimilarity >= 0.9) return current;
        }
        const current = snapshot();
        if (current.pool.length >= 2) return current;
      } catch { /* Offline catalog never blocks manual entry. */ }
    }
  }
  return snapshot();
}

function pushDebug(debug: RecognitionDebug) {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const current = Array.isArray(window.__cardRecognitionDebug) ? window.__cardRecognitionDebug : [];
  window.__cardRecognitionDebug = [...current.slice(-19), debug];
}

async function recognizeFromOrientedSource(source: HTMLCanvasElement, fileName: string, preferredLanguage: string | undefined, onProgress: ((message: string) => void) | undefined, stats: CatalogStats) {
  onProgress?.("🔍 Localizando carta");
  const box = locateCard(source);
  const worker = await getLatinWorker();

  onProgress?.("🔤 Lendo nome");
  const name = await recognizeName(source, box, worker);

  onProgress?.("🔢 Lendo número");
  const number = await recognizeCollectorNumber(source, box, worker);

  onProgress?.("🌐 Identificando idioma");
  const language = await recognizeLanguage(source, box, worker, name.best.text, number.best.text);
  let hints = mergeNumberAlternatives(language.hints, number.reads);

  onProgress?.("🃏 Confirmando no catálogo");
  let catalog = await resolveCatalog(hints, preferredLanguage, stats);
  let ranked: RecognitionCandidate[] = catalog.ranked;

  const shouldTryJapanese = (!hints.language || hints.languageConfidence < 45) && (!ranked.length || ranked[0].score < 70);
  if (shouldTryJapanese) {
    try {
      const japaneseWorker = await getJapaneseWorker();
      const top = cropCardRegion(source, box, 0, 0, 0.95, 0.20, "gray");
      const middle = cropCardRegion(source, box, 0, 0.20, 0.98, 0.75, "gray");
      const topRead = await recognizeWithWorker(japaneseWorker, top, "11");
      const middleRead = await recognizeWithWorker(japaneseWorker, middle, "11");
      const japaneseHints = buildOcrHints(topRead.text, number.best.text, middleRead.text);
      if (japaneseHints.language === "ja") {
        hints = mergeNumberAlternatives(japaneseHints, number.reads);
        catalog = await resolveCatalog(hints, "ja", stats);
        ranked = catalog.ranked;
      }
    } catch { /* Japanese is an optional fallback */ }
  }

  return { box, name, number, language, hints, stats, ranked, catalog, fileName };
}

async function performRecognition(file: File, preferredLanguage?: string, onProgress?: (message: string) => void): Promise<RecognitionResult> {
  const started = performance.now();
  const hash = await sha256(file);
  const cached = sessionRecognition(hash);
  if (cached) { onProgress?.("Resultado reutilizado do cache local"); return cached; }

  const decoded = await decodeImage(file);
  let source = sourceCanvasForImage(decoded);
  const canvases = [source];
  try {
  if (source.width > source.height * 1.08) {
    const clockwise = rotateCanvas(source, 90);
    const counterClockwise = rotateCanvas(source, 270);
    canvases.push(clockwise, counterClockwise);
    source = locateCard(clockwise).score >= locateCard(counterClockwise).score ? clockwise : counterClockwise;
  }

  const stats: CatalogStats = { requests: 0, queries: [] };
  let run = await recognizeFromOrientedSource(source, file.name, preferredLanguage, onProgress, stats);
  // Cheap upside-down fallback only when the fast pass found no meaningful image evidence.
  if (!run.hints.name && !run.hints.localId && !run.ranked.length) {
    const rotated = rotateCanvas(source, 180);
    canvases.push(rotated);
    run = await recognizeFromOrientedSource(rotated, file.name, preferredLanguage, onProgress, stats);
    source = rotated;
  }

  const pool = run.catalog.pool;
  const best = run.ranked[0];
  const easy = best?.evidence?.fullNumberMatch && best.evidence.nameSimilarity >= 0.9 && best.score - (run.ranked[1]?.score ?? 0) >= 8;
  let visual: VisualOutcome = { candidates: pool, used: false,
    status: easy ? "not-needed" : !run.hints.localId && !run.hints.name ? "insufficient-clues" : "no-candidates",
    reason: easy ? "OCR inequívoco" : !run.hints.localId && !run.hints.name ? "Pistas insuficientes" : "Menos de dois candidatos visuais plausíveis" };
  if (!easy && needsVisualFallback(pool)) {
    const normalized = document.createElement("canvas");
    normalized.width = 224; normalized.height = 312;
    canvases.push(normalized);
    const ctx = normalized.getContext("2d");
    if (ctx) {
      ctx.drawImage(source, run.box.x, run.box.y, run.box.width, run.box.height, 0, 0, 224, 312);
      const blob = await new Promise<Blob | null>(resolve => normalized.toBlob(resolve, "image/png"));
      if (blob) visual = await recognizeVisually(blob, pool, onProgress);
      else visual = { ...visual, status: "failed", error: "Não foi possível preparar a imagem" };
    } else visual = { ...visual, status: "failed", error: "Canvas indisponível" };
  }
  // Only a visually confirmed winner may cross from the private shortlist into display.
  const winner = visual.candidates.find(c => c.evidence?.visualMatch);
  if (winner) run.ranked = [winner, ...run.ranked.filter(c => c.id !== winner.id || c.language !== winner.language)].slice(0, 5);
  const elapsedMs = Math.round(performance.now() - started);
  const result = resultFromCandidates(run.hints, run.ranked, elapsedMs, run.stats.requests, "ocr");
  if (visual.used && result.level === "high") { result.level = "medium"; result.confidence = Math.min(79, result.confidence); }
  if (winner) {
    Object.assign(result, { level: "medium", confidence: 60, name: winner.name, collection: winner.collection, cardNumber: winner.cardNumber });
  }
  if (!run.hints.language || run.hints.languageConfidence < 55) delete result.language;
  Object.assign(result, { visualUsed: visual.used, visualStatus: visual.status, visualBackend: visual.backend,
    visualError: visual.error, visualReason: visual.reason, visualCandidateCount: pool.length,
    visualInitMs: visual.initMs, visualSimilarities: visual.similarities, visualCandidatePool: pool,
    catalogCandidatesBefore: run.catalog.before, catalogCandidatesAfter: run.ranked.length, catalogBudgetExhausted: stats.exhausted ?? false });
  saveSessionRecognition(hash, result);
  pushDebug({
    file: { name: file.name, width: source.width, height: source.height },
    cardBox: run.box,
    nameReads: run.name.reads,
    numberReads: run.number.reads,
    languageReads: run.language.reads,
    hints: run.hints,
    catalogQueries: run.stats.queries,
    candidates: run.ranked,
    elapsedMs,
  });
  onProgress?.(result.level === "high"
    ? `✅ ${result.name ?? "Carta"} identificada — ${result.confidence}%`
    : result.level === "medium"
      ? `🟡 ${result.name ?? "Possível carta"} — ${result.confidence}% — confirme os dados`
      : "🔴 Não consegui identificar");
  return result;
  } finally { for (const canvas of canvases) canvas.width = canvas.height = 0; }
}

export function recognizePokemonCard(file: File, preferredLanguage?: string, onProgress?: (message: string) => void) {
  const run = () => performRecognition(file, preferredLanguage, onProgress);
  const queued = recognitionTail.then(run, run);
  recognitionTail = queued.then(() => undefined, () => undefined);
  return queued;
}

export async function shutdownCardRecognition() {
  await recognitionTail;
  shutdownVisualRecognition();
  const workers = [latinWorkerPromise, japaneseWorkerPromise].filter(Boolean) as Array<Promise<TesseractWorker>>;
  latinWorkerPromise = null;
  japaneseWorkerPromise = null;
  await Promise.allSettled(workers.map(async promise => (await promise).terminate()));
}

export const cardRecognitionRuntime = {
  tesseractVersion: TESSERACT_VERSION,
  catalog: "TCGdex REST v2",
  concurrency: 1,
  detectionWidth: DETECTION_WIDTH,
  maxCatalogDetailsPerSearch: MAX_CATALOG_DETAILS,
  maxCatalogRequests: MAX_CATALOG_REQUESTS,
  cacheVersion: 4,
};
