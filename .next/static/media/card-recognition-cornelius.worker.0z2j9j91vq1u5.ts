// Cornelius worker: neural corner detection + perspective warp OFF the main
// thread. Both steps are heavy (ONNX WASM inference ~100-500 ms + a pure-JS
// bilinear warp over 448x624 px); running them on the main thread froze the
// whole UI during browser-fallback recognition. The main-thread module
// (card-recognition-cornelius.ts) keeps a full INLINE fallback for browsers
// without Worker support.
//
// Keep the model constants, the tensor preprocessing and the warp math in
// SYNC with card-recognition-cornelius.ts — they are deliberately duplicated
// here because workers cannot import "use client" modules.

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;

const MODEL_REVISION = "fa7aa3ed896bcb326d7ea218c61ea7289d06803b";
const MODEL_URL = `https://media.githubusercontent.com/media/HanClinto/CollectorVision/${MODEL_REVISION}/collector_vision/weights/cornelius.onnx`;
const MODEL_BYTES = 4_407_545;
const INPUT_SIZE = 384;
const MIN_SHARPNESS = 0.02;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const NORMALIZED_WIDTH = 448;
const NORMALIZED_HEIGHT = 624;

type Point = { x: number; y: number };
type Quad = { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point };

let sessionPromise: Promise<{ ort: Ort; session: Session }> | null = null;

async function fetchModel(): Promise<ArrayBuffer> {
  if (typeof caches !== "undefined") {
    const cache = await caches.open(`leilao-card-recognition-cornelius-${MODEL_REVISION.slice(0, 12)}`);
    const cached = await cache.match(MODEL_URL);
    if (cached) {
      const buffer = await cached.arrayBuffer();
      if (buffer.byteLength === MODEL_BYTES) return buffer;
      await cache.delete(MODEL_URL);
    }
  }
  const response = await fetch(MODEL_URL, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Cornelius indisponível: HTTP ${response.status}.`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== MODEL_BYTES) {
    throw new Error(`Cornelius incompatível: bytes=${buffer.byteLength}, esperado=${MODEL_BYTES}.`);
  }
  if (typeof caches !== "undefined") {
    const cache = await caches.open(`leilao-card-recognition-cornelius-${MODEL_REVISION.slice(0, 12)}`);
    await cache.put(MODEL_URL, new Response(buffer.slice(0), {
      headers: { "content-type": "application/octet-stream" },
    }));
  }
  return buffer;
}

async function loadSession() {
  sessionPromise ??= (async () => {
    const [ort, model] = await Promise.all([import("onnxruntime-web"), fetchModel()]);
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    return { ort, session };
  })().catch(error => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

function tensorData(source: OffscreenCanvas) {
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas indisponível para o detector Cornelius.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const rgba = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  canvas.width = canvas.height = 0;
  const plane = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(plane * 3);
  for (let pixel = 0, i = 0; pixel < plane; pixel += 1, i += 4) {
    data[pixel] = (rgba[i] / 255 - MEAN[0]) / STD[0];
    data[plane + pixel] = (rgba[i + 1] / 255 - MEAN[1]) / STD[1];
    data[plane * 2 + pixel] = (rgba[i + 2] / 255 - MEAN[2]) / STD[2];
  }
  return data;
}

function orderAroundCenter(points: Array<[number, number]>) {
  const centerX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const centerY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const sorted = [...points].sort((a, b) => Math.atan2(a[1] - centerY, a[0] - centerX) - Math.atan2(b[1] - centerY, b[0] - centerX));
  let start = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  }
  let ordered = sorted.map((_, index) => sorted[(start + index) % sorted.length]);
  const signedArea = ordered.reduce((sum, [x1, y1], index) => {
    const [x2, y2] = ordered[(index + 1) % ordered.length];
    return sum + x1 * y2 - x2 * y1;
  }, 0);
  if (signedArea < 0) ordered = [ordered[0], ordered[3], ordered[2], ordered[1]];
  return ordered;
}

function orientPortrait(points: Array<[number, number]>, width: number, height: number) {
  const ordered = orderAroundCenter(points);
  const lengths = ordered.map(([x1, y1], index) => {
    const [x2, y2] = ordered[(index + 1) % ordered.length];
    return Math.hypot((x2 - x1) * width, (y2 - y1) * height);
  });
  let shortest = 0;
  for (let i = 1; i < lengths.length; i += 1) if (lengths[i] < lengths[shortest]) shortest = i;
  return ordered.map((_, index) => ordered[(shortest + index) % ordered.length]);
}

function area(points: Array<[number, number]>) {
  return Math.abs(points.reduce((sum, [x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    return sum + x1 * y2 - x2 * y1;
  }, 0)) / 2;
}

function validQuad(points: Array<[number, number]>) {
  if (points.length !== 4 || area(points) < 0.08) return false;
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < -0.08 || x > 1.08 || y < -0.08 || y > 1.08)) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[(i + 3) % 4];
    const b = points[i];
    const c = points[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 0.002) return false;
  }
  return true;
}

function toPixelPoint(point: [number, number], width: number, height: number): Point {
  return {
    x: Math.max(0, Math.min(width - 1, point[0] * width)),
    y: Math.max(0, Math.min(height - 1, point[1] * height)),
  };
}

function solvePerspective(matrix: number[][], values: number[]) {
  const n = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-9) throw new Error("Perspectiva Cornelius degenerada.");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let c = column; c <= n; c += 1) rows[column][c] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (!factor) continue;
      for (let c = column; c <= n; c += 1) rows[row][c] -= factor * rows[column][c];
    }
  }
  return rows.map(row => row[n]);
}

function inverseHomography(quad: Quad) {
  const destination = [
    { x: 0, y: 0 },
    { x: NORMALIZED_WIDTH - 1, y: 0 },
    { x: NORMALIZED_WIDTH - 1, y: NORMALIZED_HEIGHT - 1 },
    { x: 0, y: NORMALIZED_HEIGHT - 1 },
  ];
  const source = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x: u, y: v } = destination[i];
    const { x, y } = source[i];
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); values.push(x);
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]); values.push(y);
  }
  return solvePerspective(matrix, values);
}

function warp(source: OffscreenCanvas, quad: Quad): OffscreenCanvas {
  const srcCtx = source.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!srcCtx) throw new Error("Canvas indisponível para retificar Cornelius.");
  const src = srcCtx.getImageData(0, 0, source.width, source.height);
  const output = new OffscreenCanvas(NORMALIZED_WIDTH, NORMALIZED_HEIGHT);
  const outputCtx = output.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!outputCtx) throw new Error("Canvas de saída Cornelius indisponível.");
  const dst = outputCtx.createImageData(NORMALIZED_WIDTH, NORMALIZED_HEIGHT);
  const h = inverseHomography(quad);
  for (let yOut = 0; yOut < NORMALIZED_HEIGHT; yOut += 1) {
    for (let xOut = 0; xOut < NORMALIZED_WIDTH; xOut += 1) {
      const denominator = h[6] * xOut + h[7] * yOut + 1;
      const x = (h[0] * xOut + h[1] * yOut + h[2]) / denominator;
      const y = (h[3] * xOut + h[4] * yOut + h[5]) / denominator;
      const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const y1 = Math.min(source.height - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, x - x0));
      const fy = Math.max(0, Math.min(1, y - y0));
      const target = (yOut * NORMALIZED_WIDTH + xOut) * 4;
      const indexes = [
        (y0 * source.width + x0) * 4,
        (y0 * source.width + x1) * 4,
        (y1 * source.width + x0) * 4,
        (y1 * source.width + x1) * 4,
      ];
      for (let channel = 0; channel < 3; channel += 1) {
        const top = src.data[indexes[0] + channel] * (1 - fx) + src.data[indexes[1] + channel] * fx;
        const bottom = src.data[indexes[2] + channel] * (1 - fx) + src.data[indexes[3] + channel] * fx;
        dst.data[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
      dst.data[target + 3] = 255;
    }
  }
  outputCtx.putImageData(dst, 0, 0);
  return output;
}

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

async function normalize(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const source = new OffscreenCanvas(Math.max(1, bitmap.width), Math.max(1, bitmap.height));
  const sourceCtx = source.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!sourceCtx) throw new Error("Canvas indisponível para o Cornelius.");
  sourceCtx.drawImage(bitmap, 0, 0);
  bitmap.close();
  try {
    const { ort, session } = await loadSession();
    const input = tensorData(source);
    const outputs = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    });
    const cornerName = session.outputNames[0];
    const presenceName = session.outputNames[1];
    const sharpnessName = session.outputNames[2];
    const raw = Array.from(outputs[cornerName].data as ArrayLike<unknown>, value => Number(value)).slice(0, 8);
    if (raw.length !== 8 || raw.some(value => !Number.isFinite(value))) throw new Error("Saída de cantos Cornelius inválida.");
    const rawPoints: Array<[number, number]> = [];
    for (let i = 0; i < raw.length; i += 2) rawPoints.push([Math.max(0, Math.min(1, raw[i])), Math.max(0, Math.min(1, raw[i + 1]))]);
    const points = orientPortrait(rawPoints, source.width, source.height);
    const presenceLogit = Number(outputs[presenceName]?.data?.[0] ?? 0);
    const presence = sigmoid(presenceLogit);
    const sharpness = sharpnessName && outputs[sharpnessName] ? Number(outputs[sharpnessName].data[0]) : undefined;
    const confidence = typeof sharpness === "number" && Number.isFinite(sharpness) ? sharpness : presence;
    const detection = confidence < MIN_SHARPNESS || !validQuad(points)
      ? { status: "absent" as const, confidence, sharpness, presence, backend: "cornelius/wasm-worker", }
      : {
        status: "detected" as const,
        quad: {
          topLeft: toPixelPoint(points[0], source.width, source.height),
          topRight: toPixelPoint(points[1], source.width, source.height),
          bottomRight: toPixelPoint(points[2], source.width, source.height),
          bottomLeft: toPixelPoint(points[3], source.width, source.height),
        },
        confidence, sharpness, presence, backend: "cornelius/wasm-worker",
      };
    if (detection.status !== "detected" || !detection.quad) return { detection };
    const normalized = warp(source, detection.quad);
    try {
      const blob = await normalized.convertToBlob({ type: "image/jpeg", quality: 0.94 });
      return {
        detection,
        blob,
        width: NORMALIZED_WIDTH,
        height: NORMALIZED_HEIGHT,
      };
    } finally {
      normalized.width = normalized.height = 0;
    }
  } finally {
    source.width = source.height = 0;
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data;
  try {
    const result = await normalize(file);
    self.postMessage({ id, ...result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
