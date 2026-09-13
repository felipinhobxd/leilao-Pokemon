// This module is fetched only after OCR yields 2–5 plausible candidates.
import { pipeline, env, RawImage, type ImageFeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/dinov2-small-ONNX";
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
let extractor: ImageFeatureExtractionPipeline | null = null;
let backend = "";
let initMs = 0;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);
const embeddings = new Map<string, number[]>();

async function embed(image: Blob) {
  const bitmap = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  let raw: RawImage;
  try {
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    raw = new RawImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, 4);
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
  const inputs = await extractor!.processor(raw);
  try {
    const outputs = await extractor!.model(inputs);
    try {
      const pooled = outputs.pooler_output;
      if (!pooled) throw new Error("DINOv2 pooled output missing");
      return Array.from(pooled.data, Number);
    } finally {
      for (const tensor of Object.values(outputs)) (tensor as { dispose?: () => void })?.dispose?.();
    }
  } finally {
    for (const tensor of Object.values(inputs)) (tensor as { dispose?: () => void })?.dispose?.();
  }
}
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) throw new Error("Invalid embedding");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / (Math.sqrt(aa * bb) || 1);
}
async function compare(photo: Blob, images: string[]) {
  self.postMessage({ progress: "🧠 Comparando localmente…" });
  const query = await embed(photo);
  const similarities: number[] = [];
  for (const base of images) {
    // Catalog images only: never turn a supplied URL into an arbitrary worker fetch.
    const url = new URL(`${base}/low.webp`);
    if (url.protocol !== "https:" || url.hostname !== "assets.tcgdex.net") throw new Error("Unsupported catalog image");
    let embedding = embeddings.get(url.href);
    if (!embedding) {
      const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Imagem oficial indisponível: HTTP ${response.status}`);
      embedding = await embed(await response.blob());
      if (embeddings.size >= 64) embeddings.delete(embeddings.keys().next().value!);
      embeddings.set(url.href, embedding);
    }
    similarities.push(cosine(query, embedding));
  }
  return { similarities, backend, initMs };
}
self.onmessage = async (event: MessageEvent<{ photo: Blob; images: string[]; diagnostic?: boolean; testBackend?: string }>) => {
  const { photo, images, diagnostic, testBackend } = event.data;
  const errors: string[] = [];
  if (images.length < (diagnostic ? 1 : 2) || images.length > 5) { self.postMessage({ error: "Invalid candidate count" }); return; }
  try {
    if (extractor && testBackend && testBackend !== "auto" && backend !== testBackend) {
      await extractor.dispose(); extractor = null; embeddings.clear();
    }
    if (extractor) {
      try { self.postMessage(await compare(photo, images)); return; }
      catch (error) { errors.push(`${backend}: ${errorText(error)}`); await extractor.dispose(); extractor = null; embeddings.clear(); }
    }
    const options: Array<{ device: "webgpu" | "wasm"; dtype: "q4" | "int8" }> = [];
    if ("gpu" in navigator) options.push({ device: "webgpu", dtype: "q4" });
    options.push({ device: "wasm", dtype: "q4" }, { device: "wasm", dtype: "int8" });
    const selected = diagnostic && testBackend && testBackend !== "auto" ? options.filter(option => `${option.device}/${option.dtype}` === testBackend) : options;
    if (!selected.length) throw new Error(`${testBackend}: backend não disponível neste navegador`);
    for (const option of selected) {
      try {
        const started = performance.now();
        self.postMessage({ progress: "🧠 Preparando IA local pela primeira vez ou recuperando o cache…" });
        extractor = await pipeline("image-feature-extraction", MODEL, { ...option, progress_callback: () => {
          // Library progress confirms activity; do not invent percentages.
        } });
        initMs = Math.round(performance.now() - started);
        backend = `${option.device}/${option.dtype}`;
        const result = await compare(photo, images);
        self.postMessage(result);
        return;
      } catch (error) {
        errors.push(`${option.device}/${option.dtype}: ${errorText(error)}`);
        await extractor?.dispose(); extractor = null; embeddings.clear();
      }
    }
    throw new Error(errors.join(" | ") || "Modelo quantizado indisponível");
  } catch (error) { self.postMessage({ error: errorText(error) }); }
};
