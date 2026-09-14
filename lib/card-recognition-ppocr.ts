"use client";

import { buildOcrHints, type OcrHints, type RecognitionLanguage } from "./card-recognition-core";

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
      model: { det: "small", rec: "small" },
      backend: "wasm",
      execution: "main",
      allowFallback: false,
      wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
      onProgress: (event: { phase?: string; component?: string; progress?: number }) => {
        const percent = typeof event.progress === "number" ? ` ${Math.round(event.progress * 100)}%` : "";
        const component = event.component ? ` ${event.component}` : "";
        if (event.phase === "download") progressSink?.(`📥 PP-OCRv6${component}${percent}`);
        else if (event.phase === "load") progressSink?.(`🧠 Carregando PP-OCRv6${component}${percent}`);
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
    .filter(line => String(line.text ?? "").trim() && Number(line.recognitionScore ?? 0) >= 0.15)
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
      ["fraqueza", 9], ["recuo", 9], ["baralho", 8], ["procure", 6], ["jogue", 6], ["voce", 7],
      ["mao", 5], ["jogador", 5], ["adversario", 7], ["coloque", 5], ["compre", 5], ["proximo", 4],
      ["descartar", 6], ["resistencia", 3], ["dano", 3], ["ataque", 2],
    ]) + ((text.match(/[ãõç]/gi)?.length ?? 0) * 4) },
    { language: "en", score: vocabularyScore(text, [
      ["weakness", 9], ["retreat", 9], ["deck", 8], ["search", 6], ["discard", 7], ["your", 5],
      ["opponent", 7], ["draw", 5], ["choose", 5], ["hand", 5], ["damage", 4], ["attach", 5], ["shuffle", 6],
      ["during", 3], ["this", 2], ["pokemon", 1],
    ]) },
    { language: "es", score: vocabularyScore(text, [
      ["debilidad", 9], ["retirada", 9], ["baraja", 8], ["busca", 6], ["descarta", 7], ["jugador", 5],
      ["rival", 6], ["elige", 6], ["roba", 6], ["mano", 5], ["puedes", 5], ["dano", 4], ["resistencia", 3],
    ]) + ((text.match(/[ñ¿¡]/gi)?.length ?? 0) * 5) },
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

export async function runPpOcr(file: File, onProgress?: (message: string) => void): Promise<PpOcrOutcome> {
  const started = performance.now();
  progressSink = onProgress;
  try {
    onProgress?.("🔤 PP-OCRv6 Small · lendo nome, número e idioma localmente…");
    const pipeline = await getPipeline();
    const result = await pipeline.ocr(file);
    const lines = cleanLines(result.lines);
    const height = Math.max(1, result.image.height || 624);
    const top = lines.filter(line => centerY(line) <= height * 0.34).map(line => line.text).join("\n");
    const bottom = lines.filter(line => centerY(line) >= height * 0.58).map(line => line.text).join("\n");
    const middle = lines.filter(line => centerY(line) > height * 0.25 && centerY(line) < height * 0.78).map(line => line.text).join("\n");
    const all = lines.map(line => line.text).join("\n");
    let hints = buildOcrHints(top || all, bottom || all, middle || all);
    hints = refineLanguage(hints, all);
    const averageConfidence = lines.length
      ? Math.round(lines.reduce((sum, line) => sum + Math.max(0, Math.min(1, Number(line.recognitionScore || 0))), 0) / lines.length * 100)
      : 0;
    return {
      status: lines.length ? "ok" : "unavailable",
      hints,
      text: all,
      lineCount: lines.length,
      averageConfidence,
      elapsedMs: Math.round(performance.now() - started),
      backend: `ppocrv6/${result.runtime.actualBackend}/${result.runtime.execution}`,
      error: lines.length ? undefined : "PP-OCRv6 não encontrou texto legível.",
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
  model: "PP-OCRv6 Small det+rec",
  backend: "wasm/cpu",
  execution: "main-thread",
  inference: "local-browser",
  modelCache: "sdk-indexeddb",
  sdkLoader: LOADER_PATH,
};
