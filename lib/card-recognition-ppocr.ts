"use client";

import { buildOcrHints, extractCardNumber, stringSimilarity, type OcrHints, type RecognitionLanguage } from "./card-recognition-core";

const SDK_VERSION = "0.2.0";
const LOADER_PATH = `/card-recognition/ppocrv6-loader.mjs?v=${SDK_VERSION}`;
const READY_EVENT = "leilao:ppocrv6-ready";
const ERROR_EVENT = "leilao:ppocrv6-error";
const LOAD_TIMEOUT_MS = 45_000;

type PpPoint = { readonly x: number; readonly y: number };
type PpLine = {
  readonly polygon: readonly PpPoint[];
  readonly score: number;
  readonly text: string;
  readonly recognitionScore: number;
};
type PpResult = {
  readonly lines: readonly PpLine[];
  readonly image: { readonly width: number; readonly height: number };
  readonly runtime: { readonly actualBackend: string; readonly execution: string; readonly runtimeVersion: string };
  readonly timings: { readonly totalMs: number };
};
type PpPipeline = {
  load(): Promise<void>;
  ocr(input: unknown): Promise<PpResult>;
  dispose(): Promise<void>;
};
type PpSdk = { createOCR(options: Record<string, unknown>): PpPipeline };
type PpGlobal = typeof globalThis & {
  __LEILAO_PPOCRV6__?: PpSdk;
  __LEILAO_PPOCRV6_ERROR__?: string;
};

type OcrPass = {
  label: string;
  result: PpResult;
  lines: PpLine[];
};

export type PpOcrOutcome = {
  status: "ok" | "unavailable" | "failed";
  hints?: OcrHints;
  text?: string;
  lineCount: number;
  averageConfidence: number;
  elapsedMs: number;
  backend?: string;
  error?: string;
};

let sdkPromise: Promise<PpSdk> | null = null;
let pipelinePromise: Promise<PpPipeline> | null = null;
let progressSink: ((message: string) => void) | undefined;

function state() {
  return globalThis as PpGlobal;
}

function loadSdk() {
  if (typeof window === "undefined") return Promise.reject(new Error("PP-OCRv6 só funciona no navegador."));
  if (state().__LEILAO_PPOCRV6__) return Promise.resolve(state().__LEILAO_PPOCRV6__!);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<PpSdk>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener(READY_EVENT, ready);
      window.removeEventListener(ERROR_EVENT, failed);
    };
    const ready = () => {
      const sdk = state().__LEILAO_PPOCRV6__;
      cleanup();
      if (sdk) resolve(sdk);
      else reject(new Error("PP-OCRv6 carregou sem expor createOCR."));
    };
    const failed = () => {
      cleanup();
      reject(new Error(state().__LEILAO_PPOCRV6_ERROR__ || "Não foi possível carregar PP-OCRv6."));
    };
    window.addEventListener(READY_EVENT, ready, { once: true });
    window.addEventListener(ERROR_EVENT, failed, { once: true });
    const existing = document.querySelector<HTMLScriptElement>(`script[data-ppocrv6="${SDK_VERSION}"]`);
    if (!existing) {
      const script = document.createElement("script");
      script.type = "module";
      script.src = LOADER_PATH;
      script.dataset.ppocrv6 = SDK_VERSION;
      script.onerror = failed;
      document.head.appendChild(script);
    }
    timer = setTimeout(() => failed(), LOAD_TIMEOUT_MS);
  }).catch(error => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

function getPipeline() {
  pipelinePromise ??= loadSdk().then(async sdk => {
    const pipeline = sdk.createOCR({
      model: { det: "medium", rec: "medium" },
      backend: "wasm",
      execution: "main",
      allowFallback: false,
      wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
      onProgress: (event: { phase?: string; component?: string; progress?: number }) => {
        const percent = typeof event.progress === "number" ? ` ${Math.round(event.progress * 100)}%` : "";
        const component = event.component ? ` ${event.component}` : "";
        if (event.phase === "download") progressSink?.(`📥 PP-OCRv6 Medium${component}${percent}`);
        else if (event.phase === "load") progressSink?.(`🧠 Carregando PP-OCRv6 Medium${component}${percent}`);
      },
    });
    await pipeline.load();
    return pipeline;
  }).catch(error => {
    pipelinePromise = null;
    throw error;
  });
  return pipelinePromise;
}

function centerY(line: PpLine) {
  if (!line.polygon.length) return 0;
  return line.polygon.reduce((sum, point) => sum + point.y, 0) / line.polygon.length;
}

function cleanLines(lines: readonly PpLine[]) {
  return lines
    .filter(line => String(line.text ?? "").trim() && Number(line.recognitionScore ?? 0) >= 0.08)
    .sort((a, b) => centerY(a) - centerY(b));
}

function normalizedLanguageText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function vocabularyScore(text: string, entries: Array<[string, number]>) {
  const padded = ` ${normalizedLanguageText(text)} `;
  return entries.reduce((score, [word, weight]) => padded.includes(` ${normalizedLanguageText(word)} `) ? score + weight : score, 0);
}

function refineLanguage(hints: OcrHints, text: string): OcrHints {
  const japanese = text.match(/[ぁ-んァ-ン一-龯]/g)?.length ?? 0;
  if (japanese >= 2) return { ...hints, language: "ja", languageConfidence: Math.max(hints.languageConfidence, Math.min(99, 82 + japanese * 2)) };

  const scores: Array<{ language: Exclude<RecognitionLanguage, "ja">; score: number }> = [
    { language: "pt-BR", score: vocabularyScore(text, [
      ["fraqueza", 10], ["recuo", 10], ["baralho", 9], ["procure", 7], ["jogue", 7], ["voce", 8],
      ["mao", 6], ["jogador", 6], ["adversario", 8], ["coloque", 6], ["compre", 6], ["proximo", 5],
      ["descartar", 7], ["resistencia", 4], ["dano", 4], ["ataque", 3], ["turno", 3], ["basico", 3],
    ]) + ((text.match(/[ãõçáéíóúâêô]/gi)?.length ?? 0) * 5) },
    { language: "en", score: vocabularyScore(text, [
      ["weakness", 10], ["retreat", 10], ["deck", 9], ["search", 7], ["discard", 8], ["your", 6],
      ["opponent", 8], ["draw", 6], ["choose", 6], ["hand", 6], ["damage", 5], ["attach", 6], ["shuffle", 7],
      ["during", 4], ["this", 3], ["basic", 3], ["pokemon", 1],
    ]) },
    { language: "es", score: vocabularyScore(text, [
      ["debilidad", 10], ["retirada", 10], ["baraja", 9], ["busca", 7], ["descarta", 8], ["jugador", 6],
      ["rival", 7], ["elige", 7], ["roba", 7], ["mano", 6], ["puedes", 6], ["dano", 5], ["resistencia", 4],
    ]) + ((text.match(/[ñ¿¡]/gi)?.length ?? 0) * 6) },
  ];
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1];
  if (best.score >= 5 && best.score - second.score >= 3) {
    const confidence = Math.min(99, 58 + best.score * 3 + (best.score - second.score) * 3);
    if (!hints.language || confidence > hints.languageConfidence) return { ...hints, language: best.language, languageConfidence: confidence };
  }
  return hints;
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
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

function enhanceGray(context: CanvasRenderingContext2D, width: number, height: number, contrast: number) {
  const image = context.getImageData(0, 0, width, height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
    const value = Math.max(0, Math.min(255, Math.round((gray - 128) * contrast + 128)));
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

function canvasFile(canvas: HTMLCanvasElement, name: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error("Não foi possível preparar a região para PP-OCRv6."));
      resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });
}

async function buildTargetedInputs(file: File) {
  const image = await decodeImage(file);
  try {
    const width = Math.max(1, image.width);
    const height = Math.max(1, image.height);
    const crop = async (label: string, y0: number, y1: number, scale: number, contrast: number, x0 = 0, x1 = 1) => {
      const sourceY = Math.round(height * y0);
      const sourceHeight = Math.max(1, Math.round(height * (y1 - y0)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * (x1 - x0) * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas indisponível para PP-OCRv6.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, width * x0, sourceY, width * (x1 - x0), sourceHeight, 0, 0, canvas.width, canvas.height);
      if (contrast !== 1) enhanceGray(context, canvas.width, canvas.height, contrast);
      return { label, file: await canvasFile(canvas, `ppocr-${label}.png`) };
    };

    return [
      await crop("top-name", 0.00, 0.20, 2, 1, 0, 0.80),
      await crop("top-hp", 0.00, 0.20, 2, 1, 0.72, 1),
      await crop("bottom-number", 0.80, 1.00, 2.5, 1.20),
    ];
  } finally {
    if ("close" in image && typeof image.close === "function") image.close();
  }
}

function lineText(lines: readonly PpLine[]) {
  return lines.map(line => line.text.trim()).filter(Boolean).join("\n");
}

function uniqueText(...texts: Array<string | undefined>) {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const text of texts) {
    for (const raw of String(text ?? "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const key = normalizedLanguageText(line) || line;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(line);
    }
  }
  return values.join("\n");
}

async function readPass(pipeline: PpPipeline, label: string, input: File, index: number, total: number, onProgress?: (message: string) => void): Promise<OcrPass> {
  onProgress?.(`🔤 PP-OCRv6 Medium ${index}/${total} · ${label}…`);
  const result = await pipeline.ocr(input);
  return { label, result, lines: cleanLines(result.lines) };
}

export async function runPpOcr(file: File, onProgress?: (message: string) => void): Promise<PpOcrOutcome> {
  const started = performance.now();
  progressSink = onProgress;
  try {
    onProgress?.("🔤 PP-OCRv6 Medium · leitura de alta precisão em múltiplas regiões…");
    const pipeline = await getPipeline();
    let targeted: Awaited<ReturnType<typeof buildTargetedInputs>> = [];
    try {
      targeted = await buildTargetedInputs(file);
    } catch {
      onProgress?.("↩️ Não foi possível preparar recortes; seguindo com a carta inteira.");
    }

    const inputs = [...targeted, { label: "carta inteira", file }];
    const passes: OcrPass[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      try {
        passes.push(await readPass(pipeline, input.label, input.file, index + 1, inputs.length, onProgress));
      } catch (error) {
        if (inputs.length === 1) throw error;
        onProgress?.(`↩️ PP-OCRv6 não conseguiu ler ${input.label}; mantendo os outros passes.`);
      }
    }

    const full = passes.find(pass => pass.label === "carta inteira");
    const topPass = passes.find(pass => pass.label === "top-name");
    const bottomPass = passes.find(pass => pass.label === "bottom-number");
    const fullLines = full?.lines ?? [];
    const fullHeight = Math.max(1, full?.result.image.height || 624);
    const fullTop = lineText(fullLines.filter(line => centerY(line) <= fullHeight * 0.20));
    const fullBottom = lineText(fullLines.filter(line => centerY(line) >= fullHeight * 0.80));
    const fullMiddle = lineText(fullLines.filter(line => centerY(line) > fullHeight * 0.22 && centerY(line) < fullHeight * 0.82));
    const top = uniqueText(lineText(topPass?.lines ?? []), fullTop);
    const bottom = uniqueText(lineText(bottomPass?.lines ?? []), fullBottom);
    const middle = uniqueText(fullMiddle, lineText(fullLines));
    const all = uniqueText(lineText(fullLines), lineText(topPass?.lines ?? []), lineText(bottomPass?.lines ?? []));
    let hints = buildOcrHints(top, bottom, middle);
    const nameLines = [...(topPass?.lines ?? []), ...fullLines.filter(line => centerY(line) <= fullHeight * 0.20)];
    const numberLines = [...(bottomPass?.lines ?? []), ...fullLines.filter(line => centerY(line) >= fullHeight * 0.80)];
    const confidence = (lines: PpLine[]) => Math.max(0, ...lines.map(line => Math.min(1, line.recognitionScore)));
    hints.nameConfidence = confidence(nameLines.filter(line => {
      const name = buildOcrHints(line.text, "").name;
      return name && hints.name && stringSimilarity(name, hints.name) >= 0.95;
    }));
    // Only a complete number on one footer line can be strong; concatenated fragments stay weak.
    hints.numberConfidence = confidence(numberLines.filter(line =>
      /[0-9]\s*[/|]\s*[0-9]/.test(line.text) && extractCardNumber(line.text).cardNumber === hints.cardNumber));
    const hpLines = passes.find(pass => pass.label === "top-hp")?.lines ?? [];
    const hpHints = buildOcrHints(lineText(hpLines), "");
    if (hpHints.hp) hints.hp = hpHints.hp;
    hints.hpConfidence = confidence(hpLines.filter(line => buildOcrHints(line.text, "").hp === hints.hp));
    hints = refineLanguage(hints, all);

    const allLines = passes.flatMap(pass => pass.lines);
    const averageConfidence = allLines.length
      ? Math.round(allLines.reduce((sum, line) => sum + Math.max(0, Math.min(1, Number(line.recognitionScore || 0))), 0) / allLines.length * 100)
      : 0;
    const runtime = full?.result.runtime ?? passes[0]?.result.runtime;
    return {
      status: allLines.length ? "ok" : "unavailable",
      hints,
      text: all,
      lineCount: allLines.length,
      averageConfidence,
      elapsedMs: Math.round(performance.now() - started),
      backend: runtime ? `ppocrv6-medium-multipass/${runtime.actualBackend}/${runtime.execution}` : "ppocrv6-medium-multipass",
      error: allLines.length ? undefined : "PP-OCRv6 não encontrou texto legível.",
    };
  } catch (error) {
    return {
      status: "failed",
      lineCount: 0,
      averageConfidence: 0,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    progressSink = undefined;
  }
}

export async function shutdownPpOcr() {
  const pipeline = await pipelinePromise?.catch(() => null);
  pipelinePromise = null;
  sdkPromise = null;
  if (pipeline) await pipeline.dispose().catch(() => undefined);
}

export const ppOcrRuntime = {
  sdk: `web-sdk-pp-ocrv6@${SDK_VERSION}`,
  model: "PP-OCRv6 Medium det+rec",
  strategy: "full-card+top-name+bottom-number",
  backend: "wasm/cpu",
  execution: "main-thread",
  inference: "local-browser",
  modelCache: "sdk-indexeddb",
  sdkLoader: LOADER_PATH,
};
