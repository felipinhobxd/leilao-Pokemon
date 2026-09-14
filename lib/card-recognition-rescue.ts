"use client";

import {
  buildOcrHints,
  extractCardNumber,
  extractLikelyName,
  normalizeCollectorPart,
  rankRecognitionCandidates,
  resultFromCandidates,
  safeVariant,
  stringSimilarity,
  visualCandidatePool,
  type OcrHints,
  type RecognitionCandidate,
  type RecognitionLanguage,
  type RecognitionResult,
} from "./card-recognition-core";
import { resolveCatalog } from "./card-recognition-browser";
import { needsVisualFallback, recognizeVisually } from "./card-recognition-visual";

const TESSERACT_VERSION = "7.0.0";
const TESSERACT_SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const CARD_ASPECT = 63 / 88;
const RESCUE_TIMEOUT_MS = 10_000;

type TesseractRead = { text: string; confidence: number };
type TesseractWorker = {
  recognize(image: HTMLCanvasElement, options?: Record<string, unknown>): Promise<{ data: { text?: string; confidence?: number } }>;
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
};
type TesseractApi = {
  createWorker(langs: string | string[], oem?: number): Promise<TesseractWorker>;
};
type NumberRead = TesseractRead & ReturnType<typeof extractCardNumber>;
type CardBox = { x: number; y: number; width: number; height: number; label: string };
type BoxEvidence = {
  box: CardBox;
  nameReads: TesseractRead[];
  numberReads: NumberRead[];
  bestName: TesseractRead;
  bestNumber: NumberRead;
  score: number;
};
type TcgBrief = { id: string; localId?: string | number; name?: string; image?: string | null };
type TcgCard = {
  id: string;
  localId: string | number;
  name: string;
  image?: string | null;
  hp?: number | null;
  variants?: Record<string, unknown>;
  set?: {
    name?: string;
    logo?: string | null;
    symbol?: string | null;
    cardCount?: { official?: number; total?: number };
  };
};

const briefIndex = new Map<string, Promise<TcgBrief[]>>();
let rescueWorkerPromise: Promise<TesseractWorker> | null = null;
let rescueScriptPromise: Promise<TesseractApi> | null = null;

function tesseractApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("OCR rescue requires a browser"));
  const win = window as Window & { Tesseract?: TesseractApi };
  if (win.Tesseract) return Promise.resolve(win.Tesseract);
  if (rescueScriptPromise) return rescueScriptPromise;
  rescueScriptPromise = new Promise<TesseractApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-card-ocr="${TESSERACT_VERSION}"]`);
    const finish = () => win.Tesseract ? resolve(win.Tesseract) : reject(new Error("Tesseract.js unavailable"));
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load local OCR")), { once: true });
      if (win.Tesseract) finish();
      return;
    }
    const script = document.createElement("script");
    script.src = TESSERACT_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.cardOcr = TESSERACT_VERSION;
    script.onload = finish;
    script.onerror = () => reject(new Error("Could not load local OCR"));
    document.head.appendChild(script);
  });
  return rescueScriptPromise;
}

async function rescueWorker() {
  rescueWorkerPromise ??= tesseractApi().then(api => api.createWorker(["eng", "por", "spa"], 1));
  return rescueWorkerPromise;
}

async function decode(file: File) {
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

function toCanvas(image: ImageBitmap | HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(image, 0, 0);
  if ("close" in image && typeof image.close === "function") image.close();
  return canvas;
}

function rotate(source: HTMLCanvasElement, degrees: 90 | 270) {
  const canvas = document.createElement("canvas");
  canvas.width = source.height;
  canvas.height = source.width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degrees * Math.PI / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function fitCardBox(width: number, height: number, margin = 0.015): CardBox {
  const availableWidth = width * (1 - margin * 2);
  const availableHeight = height * (1 - margin * 2);
  let cardWidth = availableWidth;
  let cardHeight = cardWidth / CARD_ASPECT;
  if (cardHeight > availableHeight) {
    cardHeight = availableHeight;
    cardWidth = cardHeight * CARD_ASPECT;
  }
  return {
    x: (width - cardWidth) / 2,
    y: (height - cardHeight) / 2,
    width: cardWidth,
    height: cardHeight,
    label: "aspect-fit",
  };
}

function cardBoxes(source: HTMLCanvasElement) {
  const full: CardBox = { x: 0, y: 0, width: source.width, height: source.height, label: "full-frame" };
  const fit = fitCardBox(source.width, source.height);
  const centered: CardBox = {
    x: source.width * 0.05,
    y: source.height * 0.015,
    width: source.width * 0.90,
    height: source.height * 0.965,
    label: "center-90",
  };
  const boxes = [fit, full, centered];
  return boxes.filter((box, index) => boxes.findIndex(other =>
    Math.abs(other.x - box.x) < 3 && Math.abs(other.y - box.y) < 3 &&
    Math.abs(other.width - box.width) < 3 && Math.abs(other.height - box.height) < 3) === index);
}

function otsu(data: Uint8ClampedArray) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) histogram[data[i]] += 1;
  const total = data.length / 4;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let background = 0;
  let backgroundSum = 0;
  let best = -1;
  let threshold = 128;
  for (let i = 0; i < 256; i += 1) {
    background += histogram[i];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    backgroundSum += i * histogram[i];
    const meanBackground = backgroundSum / background;
    const meanForeground = (sum - backgroundSum) / foreground;
    const variance = background * foreground * (meanBackground - meanForeground) ** 2;
    if (variance > best) { best = variance; threshold = i; }
  }
  return threshold;
}

function crop(
  source: HTMLCanvasElement,
  box: CardBox,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: "gray" | "contrast" | "threshold",
  targetHeight: number,
) {
  const sx = Math.max(0, Math.round(box.x + box.width * x0));
  const sy = Math.max(0, Math.round(box.y + box.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(box.width * (x1 - x0))));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(box.height * (y1 - y0))));
  const scale = Math.min(6, Math.max(1, targetHeight / sh, Math.min(2600 / sw, 5)));
  const padding = targetHeight >= 300 ? 18 : 12;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + padding * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + padding * 2);
  const context = canvas.getContext("2d", { willReadFrequently: mode === "threshold" });
  if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = mode === "gray" ? "grayscale(1) contrast(1.18)" : "grayscale(1) contrast(1.72)";
  context.drawImage(source, sx, sy, sw, sh, padding, padding, canvas.width - padding * 2, canvas.height - padding * 2);
  if (mode === "threshold") {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const threshold = otsu(image.data);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = image.data[i] >= threshold ? 255 : 0;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
    }
    context.putImageData(image, 0, 0);
  }
  return canvas;
}

async function read(worker: TesseractWorker, image: HTMLCanvasElement, psm: "6" | "7" | "11" | "13", whitelist = "") {
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: whitelist,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      load_system_dawg: whitelist ? "0" : "1",
      load_freq_dawg: whitelist ? "0" : "1",
    });
    const result = await worker.recognize(image, { rotateAuto: false });
    return { text: String(result.data.text ?? "").trim(), confidence: Number(result.data.confidence ?? 0) } satisfies TesseractRead;
  } finally {
    image.width = image.height = 0;
  }
}

function nameScore(value: TesseractRead) {
  const name = extractLikelyName(value.text);
  if (!name) return -100;
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  return Math.min(55, letters * 3) + Math.min(45, value.confidence) - (name.length > 30 ? 25 : 0);
}

function plausibleNumber(value: NumberRead) {
  if (!value.localId || !value.denominator) return false;
  const digits = normalizeCollectorPart(value.localId).match(/\d+/)?.[0] ?? "";
  const local = Number(digits);
  return Number.isFinite(local) && value.denominator >= 20 && value.denominator <= 700 && local <= Math.max(value.denominator * 3, value.denominator + 180);
}

function numberRead(value: TesseractRead): NumberRead {
  return { ...value, ...extractCardNumber(value.text) };
}

async function quickEvidence(source: HTMLCanvasElement, box: CardBox, worker: TesseractWorker): Promise<BoxEvidence> {
  const nameReads = [await read(worker, crop(source, box, 0.06, 0.0, 0.88, 0.15, "gray", 260), "7")];
  const numberReads = [numberRead(await read(worker, crop(source, box, 0.0, 0.76, 1.0, 0.995, "gray", 330), "11", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/|-.: "))];
  const bestName = nameReads[0];
  const bestNumber = numberReads[0];
  const score = Math.max(0, nameScore(bestName)) + (plausibleNumber(bestNumber) ? 115 : bestNumber.localId ? 28 : 0);
  return { box, nameReads, numberReads, bestName, bestNumber, score };
}

async function refineEvidence(source: HTMLCanvasElement, evidence: BoxEvidence, worker: TesseractWorker) {
  const { box, nameReads, numberReads } = evidence;
  if (nameScore(evidence.bestName) < 72) {
    nameReads.push(await read(worker, crop(source, box, 0.12, 0.005, 0.82, 0.125, "contrast", 300), "7"));
    nameReads.push(await read(worker, crop(source, box, 0.0, 0.0, 0.95, 0.19, "gray", 280), "11"));
  }

  if (!numberReads.some(plausibleNumber)) {
    const whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/|-.: ";
    const regions: Array<[number, number, number, number]> = [
      [0.0, 0.84, 0.58, 0.995],
      [0.40, 0.84, 1.0, 0.995],
      [0.0, 0.70, 1.0, 0.93],
      [0.0, 0.88, 1.0, 1.0],
    ];
    for (const [x0, y0, x1, y1] of regions) {
      const gray = numberRead(await read(worker, crop(source, box, x0, y0, x1, y1, "gray", 380), "7", whitelist));
      numberReads.push(gray);
      if (plausibleNumber(gray)) break;
      const threshold = numberRead(await read(worker, crop(source, box, x0, y0, x1, y1, "threshold", 400), "13", whitelist));
      numberReads.push(threshold);
      if (plausibleNumber(threshold)) break;
    }
  }

  nameReads.sort((a, b) => nameScore(b) - nameScore(a));
  const parsed = numberReads.filter(reading => reading.localId && reading.denominator)
    .sort((a, b) => Number(plausibleNumber(b)) - Number(plausibleNumber(a)) || b.confidence - a.confidence);
  evidence.bestName = nameReads[0] ?? evidence.bestName;
  evidence.bestNumber = parsed[0] ?? evidence.bestNumber;
  evidence.score = Math.max(0, nameScore(evidence.bestName)) + (plausibleNumber(evidence.bestNumber) ? 115 : evidence.bestNumber.localId ? 28 : 0);
  return evidence;
}

async function languageText(source: HTMLCanvasElement, box: CardBox, worker: TesseractWorker, name: string, number: string) {
  const reads: TesseractRead[] = [];
  reads.push(await read(worker, crop(source, box, 0.03, 0.31, 0.97, 0.82, "gray", 220), "11"));
  let hints = buildOcrHints(name, number, reads.map(item => item.text).join("\n"));
  if (!hints.language || hints.languageConfidence < 70) {
    reads.push(await read(worker, crop(source, box, 0.03, 0.56, 0.97, 0.94, "contrast", 240), "11"));
    hints = buildOcrHints(name, number, reads.map(item => item.text).join("\n"));
  }
  return { reads, hints };
}

function tcgLanguage(language: RecognitionLanguage) {
  return language === "pt-BR" ? "pt" : language;
}

function languageOrder(hints: OcrHints, preferred?: string) {
  const allowed = new Set<RecognitionLanguage>(["pt-BR", "en", "es", "ja"]);
  const values: RecognitionLanguage[] = [];
  const add = (value: string | null | undefined) => {
    if (value && allowed.has(value as RecognitionLanguage) && !values.includes(value as RecognitionLanguage)) values.push(value as RecognitionLanguage);
  };
  if (hints.language && hints.languageConfidence >= 50) add(hints.language);
  add(preferred);
  add("pt-BR");
  add("en");
  add("es");
  return values.slice(0, 2);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
    signal: AbortSignal.timeout(RESCUE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TCGdex rescue HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function loadBriefIndex(code: string) {
  let promise = briefIndex.get(code);
  if (!promise) {
    promise = fetchJson<TcgBrief[]>(`${TCGDEX_BASE}/${code}/cards?image=notlike:/tcgp/`)
      .then(cards => cards.filter(card => card.id && card.name && card.image && !card.image.includes("/tcgp/")))
      .catch(error => { briefIndex.delete(code); throw error; });
    briefIndex.set(code, promise);
  }
  return promise;
}

function candidateFromCard(card: TcgCard, language: RecognitionLanguage): Omit<RecognitionCandidate, "score" | "evidence"> | null {
  if (!card.set?.name || !card.image || card.image.includes("/tcgp/") || card.set.logo?.includes("/tcgp/") || card.set.symbol?.includes("/tcgp/")) return null;
  const denominator = Number(card.set.cardCount?.official ?? card.set.cardCount?.total ?? 0) || null;
  const localId = String(card.localId ?? "");
  return {
    id: card.id,
    name: card.name,
    collection: card.set.name,
    cardNumber: denominator ? `${localId}/${denominator}` : localId,
    localId,
    denominator,
    language,
    hp: card.hp == null ? null : Number(card.hp),
    image: card.image,
    variant: safeVariant(card.variants),
  };
}

async function fuzzyCatalog(hints: OcrHints, preferred?: string) {
  const raw: Array<Omit<RecognitionCandidate, "score" | "evidence">> = [];
  let requests = 0;
  const name = hints.name.trim();
  const localId = normalizeCollectorPart(hints.localId);
  if (name.replace(/[^\p{L}]/gu, "").length < 4 && !localId) return { ranked: [] as RecognitionCandidate[], pool: [] as RecognitionCandidate[], requests };

  for (const language of languageOrder(hints, preferred)) {
    const code = tcgLanguage(language);
    let briefs: TcgBrief[];
    try {
      requests += 1;
      briefs = await loadBriefIndex(code);
    } catch {
      continue;
    }
    const scored = briefs.map(brief => {
      const nameSimilarity = brief.name && name ? stringSimilarity(name, brief.name) : 0;
      const candidateLocal = normalizeCollectorPart(String(brief.localId ?? ""));
      const localMatch = Boolean(localId && candidateLocal && (candidateLocal === localId || Number(candidateLocal.replace(/\D/g, "")) === Number(localId.replace(/\D/g, ""))));
      const score = nameSimilarity * 100 + (localMatch ? 45 : 0);
      return { brief, nameSimilarity, localMatch, score };
    }).filter(item => item.localMatch || item.nameSimilarity >= 0.52)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const item of scored.slice(0, 4)) {
      try {
        requests += 1;
        const detail = await fetchJson<TcgCard>(`${TCGDEX_BASE}/${code}/cards/${encodeURIComponent(item.brief.id)}`);
        const candidate = candidateFromCard(detail, language);
        if (candidate) raw.push(candidate);
      } catch { /* best-effort rescue */ }
    }
    if (raw.length >= 3) break;
  }

  const deduped = [...new Map(raw.map(card => [`${card.language}:${card.id}`, card])).values()];
  return {
    ranked: rankRecognitionCandidates(deduped, hints),
    pool: visualCandidatePool(deduped, hints),
    requests,
  };
}

function normalizedCardBlob(source: HTMLCanvasElement, box: CardBox) {
  const canvas = document.createElement("canvas");
  canvas.width = 448;
  canvas.height = 624;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null as Blob | null);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>(resolve => canvas.toBlob(blob => {
    canvas.width = canvas.height = 0;
    resolve(blob);
  }, "image/png"));
}

function dedupeCandidates(values: RecognitionCandidate[]) {
  return [...new Map(values.map(candidate => [`${candidate.language}:${candidate.id}`, candidate])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function rescuePokemonCard(
  file: File,
  preferredLanguage?: string,
  onProgress?: (message: string) => void,
): Promise<RecognitionResult | null> {
  const started = performance.now();
  onProgress?.("🛟 Modo de resgate: lendo a foto inteira sem depender do recorte automático…");
  const image = await decode(file);
  let source = toCanvas(image);
  const canvases: HTMLCanvasElement[] = [source];
  try {
    if (source.width > source.height * 1.08) {
      const clockwise = rotate(source, 90);
      const counterClockwise = rotate(source, 270);
      canvases.push(clockwise, counterClockwise);
      source = clockwise;
    }

    const worker = await rescueWorker();
    const evidence: BoxEvidence[] = [];
    for (const box of cardBoxes(source)) {
      const quick = await quickEvidence(source, box, worker);
      evidence.push(quick);
      if (nameScore(quick.bestName) >= 70 && plausibleNumber(quick.bestNumber)) break;
    }
    evidence.sort((a, b) => b.score - a.score);
    const best = await refineEvidence(source, evidence[0], worker);
    const nameText = best.bestName.text;
    const numberText = best.bestNumber.text;

    onProgress?.("🛟 Confirmando idioma pelo texto da carta…");
    const language = await languageText(source, best.box, worker, nameText, numberText);
    const hints = language.hints;

    onProgress?.("🛟 Tentando correspondência determinística no TCGdex…");
    const stats = { requests: 0, queries: [] as string[], exhausted: false };
    const direct = await resolveCatalog(hints, preferredLanguage, stats);
    let ranked = direct.ranked;
    let pool = direct.pool;
    let extraRequests = 0;

    if (!ranked.length || !pool.length) {
      onProgress?.("🛟 Fazendo busca fuzzy local no catálogo completo…");
      const fuzzy = await fuzzyCatalog(hints, preferredLanguage);
      extraRequests += fuzzy.requests;
      ranked = dedupeCandidates([...ranked, ...fuzzy.ranked]);
      pool = dedupeCandidates([...pool, ...fuzzy.pool]);
    }

    let visualUsed = false;
    let visualBackend: string | undefined;
    let visualError: string | undefined;
    let visualSimilarities: number[] | undefined;
    if (pool.length && needsVisualFallback(pool)) {
      const blob = await normalizedCardBlob(source, best.box);
      if (blob) {
        onProgress?.("🛟 Comparando a arte com impressões oficiais…");
        const visual = await recognizeVisually(blob, pool, onProgress);
        visualUsed = visual.used;
        visualBackend = visual.backend;
        visualError = visual.error;
        visualSimilarities = visual.similarities;
        const winner = visual.candidates.find(candidate => candidate.evidence?.visualMatch);
        if (winner) ranked = dedupeCandidates([winner, ...ranked, ...visual.candidates]);
        else pool = dedupeCandidates([...pool, ...visual.candidates]);
      }
    }

    const elapsedMs = Math.round(performance.now() - started);
    const totalRequests = stats.requests + extraRequests;
    const result = resultFromCandidates(hints, ranked.length ? ranked : pool, elapsedMs, totalRequests, "ocr");
    const winner = (ranked.length ? ranked : pool).find(candidate => candidate.evidence?.visualMatch);
    if (winner && winner.evidence) {
      const reliableVisual = winner.evidence.nameSimilarity >= 0.80 || winner.evidence.fullNumberMatch || winner.evidence.localIdMatch;
      if (reliableVisual) {
        result.confidence = winner.evidence.fullNumberMatch ? 99 : Math.max(result.confidence, 90);
        result.level = result.confidence >= 86 ? "high" : "medium";
        result.name = winner.name;
        result.collection = winner.collection;
        result.cardNumber = winner.cardNumber;
        result.language = winner.language;
        if (winner.variant) result.variant = winner.variant;
      }
    }
    Object.assign(result, {
      visualUsed,
      visualBackend,
      visualError,
      visualSimilarities,
      visualCandidatePool: pool,
      catalogCandidatesBefore: direct.before,
      catalogCandidatesAfter: ranked.length,
      catalogBudgetExhausted: stats.exhausted,
      catalogStrategy: direct.strategy,
      catalogSetCandidates: direct.setCandidates,
      catalogSetIndexSource: direct.setIndexSource,
      catalogQueries: stats.queries,
    });
    return result;
  } catch {
    return null;
  } finally {
    for (const canvas of canvases) canvas.width = canvas.height = 0;
  }
}

export async function shutdownRescueRecognition() {
  const worker = rescueWorkerPromise;
  rescueWorkerPromise = null;
  if (worker) await Promise.resolve(worker).then(instance => instance.terminate()).catch(() => undefined);
}

export const rescueRecognitionRuntime = {
  version: 1,
  strategy: "multi-box-full-frame-ocr+fuzzy-tcgdex+visual",
  tesseractVersion: TESSERACT_VERSION,
};
