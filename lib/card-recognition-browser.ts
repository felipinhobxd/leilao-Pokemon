"use client";

import {
  buildOcrHints,
  rankRecognitionCandidates,
  resultFromCandidates,
  safeVariant,
  type OcrHints,
  type RecognitionCandidate,
  type RecognitionLanguage,
  type RecognitionResult,
} from "@/lib/card-recognition-core";

const TESSERACT_VERSION = "7.0.0";
const TESSERACT_SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const OCR_MAX_DIMENSION = 1500;
const SESSION_CACHE_PREFIX = "leilao:card-recognition:v1:";
const CATALOG_TTL_MS = 30 * 60_000;
const MAX_CATALOG_DETAILS = 12;

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
  interface Window { Tesseract?: TesseractGlobal }
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
type TcgCardBrief = { id: string; localId?: string | number; name?: string };
type CatalogStats = { requests: number };
type CacheEntry = { expires: number; value: unknown };

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
  if (hints.languageConfidence >= 45) add(hints.language);
  add(preferred);
  add(hints.language);
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
        if (event.status === "recognizing text" && typeof event.progress === "number") onProgress?.(`OCR local ${Math.round(event.progress * 100)}%`);
      },
    }));
  }
  return latinWorkerPromise;
}

async function getJapaneseWorker(onProgress?: (message: string) => void) {
  if (!japaneseWorkerPromise) {
    japaneseWorkerPromise = loadTesseract().then(api => api.createWorker("jpn", 1, {
      logger: event => {
        if (event.status === "recognizing text" && typeof event.progress === "number") onProgress?.(`OCR japonês ${Math.round(event.progress * 100)}%`);
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

function canvasForImage(image: ImageBitmap | HTMLImageElement) {
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const scale = Math.min(1, OCR_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas indisponível para reconhecimento.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "contrast(1.12) saturate(.92)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ("close" in image && typeof image.close === "function") image.close();
  return canvas;
}

function cropCanvas(source: HTMLCanvasElement, topRatio: number, heightRatio: number, threshold = false) {
  const horizontalInset = Math.round(source.width * 0.025);
  const top = Math.max(0, Math.round(source.height * topRatio));
  const height = Math.min(source.height - top, Math.max(1, Math.round(source.height * heightRatio)));
  const width = Math.max(1, source.width - horizontalInset * 2);
  const scale = width < 900 ? Math.min(2, 900 / width) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: threshold });
  if (!context) throw new Error("Canvas indisponível para reconhecimento.");
  context.filter = threshold ? "grayscale(1) contrast(1.45)" : "grayscale(.15) contrast(1.18)";
  context.drawImage(source, horizontalInset, top, width, height, 0, 0, canvas.width, canvas.height);
  if (threshold) {
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
    const average = sum / Math.max(1, pixels.length / 4);
    const cutoff = Math.max(105, Math.min(190, average * .9));
    for (let i = 0; i < pixels.length; i += 4) {
      const value = pixels[i] >= cutoff ? 255 : 0;
      pixels[i] = value; pixels[i + 1] = value; pixels[i + 2] = value;
    }
    context.putImageData(data, 0, 0);
  }
  return canvas;
}

async function recognizeLatinRegions(source: HTMLCanvasElement, onProgress?: (message: string) => void) {
  const worker = await getLatinWorker(onProgress);
  const bottom = cropCanvas(source, .68, .31, true);
  await worker.setParameters({
    tessedit_pageseg_mode: "11",
    tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/- ",
  });
  const bottomResult = await worker.recognize(bottom, { rotateAuto: true });

  const top = cropCanvas(source, 0, .31, false);
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  const topResult = await worker.recognize(top, { rotateAuto: true });
  let hints = buildOcrHints(topResult.data.text, bottomResult.data.text);
  let centerText = "";
  let centerConfidence = 0;
  if (!hints.language || hints.languageConfidence < 58 || !hints.name) {
    const center = cropCanvas(source, .26, .48, false);
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
    const centerResult = await worker.recognize(center, { rotateAuto: true });
    centerText = centerResult.data.text;
    centerConfidence = Number(centerResult.data.confidence ?? 0);
    hints = buildOcrHints(topResult.data.text, bottomResult.data.text, centerText);
  }
  return {
    hints,
    topText: topResult.data.text,
    bottomText: bottomResult.data.text,
    centerText,
    confidence: Math.round((Number(topResult.data.confidence ?? 0) + Number(bottomResult.data.confidence ?? 0) + (centerText ? centerConfidence : 0)) / (centerText ? 3 : 2)),
  };
}

async function recognizeJapaneseRegions(source: HTMLCanvasElement, bottomText: string, onProgress?: (message: string) => void) {
  const worker = await getJapaneseWorker(onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
  const top = cropCanvas(source, 0, .34, false);
  const center = cropCanvas(source, .25, .52, false);
  const topResult = await worker.recognize(top, { rotateAuto: true });
  const centerResult = await worker.recognize(center, { rotateAuto: true });
  return {
    hints: buildOcrHints(topResult.data.text, bottomText, centerResult.data.text),
    confidence: Math.round((Number(topResult.data.confidence ?? 0) + Number(centerResult.data.confidence ?? 0)) / 2),
  };
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
    recognitionMemoryCache.set(hash, parsed);
    return { ...parsed, source: "cache" as const, elapsedMs: 0, catalogRequests: 0 };
  } catch { return null; }
}

function saveSessionRecognition(hash: string, result: RecognitionResult) {
  recognitionMemoryCache.set(hash, result);
  try { sessionStorage.setItem(`${SESSION_CACHE_PREFIX}${hash}`, JSON.stringify(result)); } catch { /* cache is optional */ }
}

async function fetchCatalog<T>(url: string, stats: CatalogStats): Promise<T> {
  const cached = catalogCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  stats.requests += 1;
  const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (response.status === 404) throw Object.assign(new Error("not-found"), { status: 404 });
  if (!response.ok) throw new Error(`TCGdex respondeu ${response.status}.`);
  const value = await response.json() as T;
  catalogCache.set(url, { expires: Date.now() + CATALOG_TTL_MS, value });
  return value;
}

function candidateFromCard(card: TcgCard, language: RecognitionLanguage): Omit<RecognitionCandidate, "score"> | null {
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

async function fetchCardDetails(briefs: TcgCardBrief[], code: string, language: RecognitionLanguage, stats: CatalogStats) {
  const result: Array<Omit<RecognitionCandidate, "score">> = [];
  await Promise.all(briefs.slice(0, MAX_CATALOG_DETAILS).map(async brief => {
    try {
      const card = await fetchCatalog<TcgCard>(`${TCGDEX_BASE}/${code}/cards/${encodeURIComponent(brief.id)}`, stats);
      const candidate = candidateFromCard(card, language);
      if (candidate) result.push(candidate);
    } catch { /* malformed/removed catalog entry: skip */ }
  }));
  return result;
}

async function candidatesForLanguage(hints: OcrHints, language: RecognitionLanguage, stats: CatalogStats) {
  const code = tcgLanguage(language);
  const params = new URLSearchParams({ "pagination:page": "1", "pagination:itemsPerPage": String(MAX_CATALOG_DETAILS) });
  if (hints.localId) params.set("localId", `eq:${hints.localId}`);
  if (hints.name) params.set("name", hints.name);

  if (hints.localId || hints.name) {
    const filtered = await fetchCatalog<TcgCardBrief[]>(`${TCGDEX_BASE}/${code}/cards?${params.toString()}`, stats);
    const details = await fetchCardDetails(filtered, code, language, stats);
    if (details.length) return details;
  }

  if (hints.localId && hints.name) {
    const localParams = new URLSearchParams({
      localId: `eq:${hints.localId}`,
      "pagination:page": "1",
      "pagination:itemsPerPage": String(MAX_CATALOG_DETAILS),
    });
    const byNumber = await fetchCatalog<TcgCardBrief[]>(`${TCGDEX_BASE}/${code}/cards?${localParams.toString()}`, stats);
    const details = await fetchCardDetails(byNumber, code, language, stats);
    if (details.length) return details;
  }

  if (hints.name) {
    const nameParams = new URLSearchParams({ name: hints.name, "pagination:page": "1", "pagination:itemsPerPage": "8" });
    const byName = await fetchCatalog<TcgCardBrief[]>(`${TCGDEX_BASE}/${code}/cards?${nameParams.toString()}`, stats);
    return fetchCardDetails(byName, code, language, stats);
  }
  return [];
}

async function resolveCatalog(hints: OcrHints, preferredLanguage: string | undefined, stats: CatalogStats) {
  const candidates: Array<Omit<RecognitionCandidate, "score">> = [];
  for (const language of uniqueLanguages(hints, preferredLanguage)) {
    try { candidates.push(...await candidatesForLanguage(hints, language, stats)); }
    catch { /* catalog failure for one language must not block manual flow */ }
    const ranked = rankRecognitionCandidates(candidates, hints);
    if ((ranked[0]?.score ?? 0) >= 84 && (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0) >= 8) return ranked;
  }
  return rankRecognitionCandidates(candidates, hints);
}

async function performRecognition(file: File, preferredLanguage?: string, onProgress?: (message: string) => void): Promise<RecognitionResult> {
  const started = performance.now();
  onProgress?.("Calculando hash local…");
  const hash = await sha256(file);
  const cached = sessionRecognition(hash);
  if (cached) { onProgress?.("Resultado reutilizado do cache"); return cached; }

  onProgress?.("Preparando imagem local…");
  const decoded = await decodeImage(file);
  const source = canvasForImage(decoded);
  onProgress?.("Lendo nome e número localmente…");
  const latin = await recognizeLatinRegions(source, onProgress);
  const stats = { requests: 0 };
  onProgress?.("Comparando com catálogo gratuito…");
  let ranked = await resolveCatalog(latin.hints, preferredLanguage, stats);
  let hints = latin.hints;

  const bestScore = ranked[0]?.score ?? 0;
  const shouldTryJapanese = (hints.language == null || hints.languageConfidence < 45) && (bestScore < 72 || !hints.name) && latin.confidence < 68;
  if (shouldTryJapanese) {
    try {
      onProgress?.("Tentando leitura japonesa local…");
      const japanese = await recognizeJapaneseRegions(source, latin.bottomText, onProgress);
      if (japanese.hints.language === "ja" || japanese.confidence > latin.confidence + 8) {
        hints = japanese.hints;
        ranked = await resolveCatalog(hints, "ja", stats);
      }
    } catch { /* Japanese model is optional fallback */ }
  }

  const result = resultFromCandidates(hints, ranked, Math.round(performance.now() - started), stats.requests, "ocr");
  saveSessionRecognition(hash, result);
  onProgress?.(result.level === "high" ? `Carta identificada · ${result.confidence}%` : result.level === "medium" ? `Confira os dados · ${result.confidence}%` : "Não consegui identificar com segurança");
  return result;
}

export function recognizePokemonCard(file: File, preferredLanguage?: string, onProgress?: (message: string) => void) {
  const run = () => performRecognition(file, preferredLanguage, onProgress);
  const queued = recognitionTail.then(run, run);
  recognitionTail = queued.then(() => undefined, () => undefined);
  return queued;
}

export async function shutdownCardRecognition() {
  const workers = [latinWorkerPromise, japaneseWorkerPromise].filter(Boolean) as Array<Promise<TesseractWorker>>;
  latinWorkerPromise = null;
  japaneseWorkerPromise = null;
  await Promise.allSettled(workers.map(async promise => (await promise).terminate()));
}

export const cardRecognitionRuntime = {
  tesseractVersion: TESSERACT_VERSION,
  catalog: "TCGdex REST v2",
  concurrency: 1,
  maxOcrDimension: OCR_MAX_DIMENSION,
  maxCatalogDetailsPerLanguage: MAX_CATALOG_DETAILS,
};
