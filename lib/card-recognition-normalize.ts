"use client";

export type CardPoint = { x: number; y: number };
export type CardQuad = { topLeft: CardPoint; topRight: CardPoint; bottomRight: CardPoint; bottomLeft: CardPoint };
export type CardNormalization = {
  file: File;
  blob: Blob;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  method: "quad" | "aspect-fallback";
  confidence: number;
  quad?: CardQuad;
};

const OUTPUT_WIDTH = 448;
const OUTPUT_HEIGHT = 624;
const DETECT_MAX = 460;
const CARD_ASPECT = 63 / 88;

type Line = { intercept: number; slope: number; score: number; coverage: number };
type Detection = { quad: CardQuad; score: number; confidence: number; valid: boolean };

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

function imageCanvas(image: ImageBitmap | HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para normalizar a carta.");
  ctx.drawImage(image, 0, 0);
  if ("close" in image && typeof image.close === "function") image.close();
  return canvas;
}

function rotate(source: HTMLCanvasElement, degrees: 0 | 90 | 180 | 270) {
  if (degrees === 0) return source;
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para orientar a carta.");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function detectionPixels(source: HTMLCanvasElement) {
  const scale = Math.min(1, DETECT_MAX / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível para detectar os cantos.");
  ctx.drawImage(source, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  }
  const gx = new Float32Array(gray.length);
  const gy = new Float32Array(gray.length);
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const dx = Math.abs(gray[i + 1] - gray[i - 1]) * 0.5;
      const dy = Math.abs(gray[i + width] - gray[i - width]) * 0.5;
      gx[i] = dx;
      gy[i] = dy;
      const magnitude = Math.max(dx, dy);
      sum += magnitude;
      sum2 += magnitude * magnitude;
      count += 1;
    }
  }
  canvas.width = canvas.height = 0;
  const mean = sum / Math.max(1, count);
  const std = Math.sqrt(Math.max(0, sum2 / Math.max(1, count) - mean * mean));
  return { width, height, gx, gy, threshold: Math.max(8, mean + std * 0.55), scale };
}

function scoreVertical(gx: Float32Array, width: number, height: number, intercept: number, slope: number, threshold: number) {
  let sum = 0;
  let hits = 0;
  let samples = 0;
  const centerY = (height - 1) / 2;
  for (let y = Math.round(height * 0.05); y < height * 0.95; y += 2) {
    const x = Math.round(intercept + slope * (y - centerY));
    if (x < 2 || x >= width - 2) continue;
    let edge = 0;
    for (let dx = -2; dx <= 2; dx += 1) edge = Math.max(edge, gx[y * width + x + dx]);
    sum += edge;
    if (edge >= threshold) hits += 1;
    samples += 1;
  }
  return { score: sum / Math.max(1, samples), coverage: hits / Math.max(1, samples) };
}

function scoreHorizontal(gy: Float32Array, width: number, height: number, intercept: number, slope: number, threshold: number) {
  let sum = 0;
  let hits = 0;
  let samples = 0;
  const centerX = (width - 1) / 2;
  for (let x = Math.round(width * 0.05); x < width * 0.95; x += 2) {
    const y = Math.round(intercept + slope * (x - centerX));
    if (y < 2 || y >= height - 2) continue;
    let edge = 0;
    for (let dy = -2; dy <= 2; dy += 1) edge = Math.max(edge, gy[(y + dy) * width + x]);
    sum += edge;
    if (edge >= threshold) hits += 1;
    samples += 1;
  }
  return { score: sum / Math.max(1, samples), coverage: hits / Math.max(1, samples) };
}

function bestVertical(
  gx: Float32Array,
  width: number,
  height: number,
  minFraction: number,
  maxFraction: number,
  threshold: number,
): Line {
  let best: Line = { intercept: width * (minFraction + maxFraction) / 2, slope: 0, score: 0, coverage: 0 };
  const step = Math.max(2, Math.round(width / 180));
  for (let intercept = Math.round(width * minFraction); intercept <= width * maxFraction; intercept += step) {
    for (let slope = -0.22; slope <= 0.2201; slope += 0.035) {
      const value = scoreVertical(gx, width, height, intercept, slope, threshold);
      const combined = value.score * (0.58 + value.coverage * 0.42);
      const current = best.score * (0.58 + best.coverage * 0.42);
      if (combined > current) best = { intercept, slope, ...value };
    }
  }
  return best;
}

function bestHorizontal(
  gy: Float32Array,
  width: number,
  height: number,
  minFraction: number,
  maxFraction: number,
  threshold: number,
): Line {
  let best: Line = { intercept: height * (minFraction + maxFraction) / 2, slope: 0, score: 0, coverage: 0 };
  const step = Math.max(2, Math.round(height / 220));
  for (let intercept = Math.round(height * minFraction); intercept <= height * maxFraction; intercept += step) {
    for (let slope = -0.18; slope <= 0.1801; slope += 0.03) {
      const value = scoreHorizontal(gy, width, height, intercept, slope, threshold);
      const combined = value.score * (0.58 + value.coverage * 0.42);
      const current = best.score * (0.58 + best.coverage * 0.42);
      if (combined > current) best = { intercept, slope, ...value };
    }
  }
  return best;
}

function intersect(vertical: Line, horizontal: Line, width: number, height: number): CardPoint {
  // x = vi + vs * (y - cy), y = hi + hs * (x - cx)
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const vb = vertical.intercept - vertical.slope * cy;
  const hb = horizontal.intercept - horizontal.slope * cx;
  const divisor = 1 - vertical.slope * horizontal.slope;
  const x = Math.abs(divisor) < 1e-6 ? vertical.intercept : (vb + vertical.slope * hb) / divisor;
  const y = hb + horizontal.slope * x;
  return { x, y };
}

function distance(a: CardPoint, b: CardPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points: CardPoint[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function detectQuad(source: HTMLCanvasElement): Detection {
  const detected = detectionPixels(source);
  const { width, height, gx, gy, threshold, scale } = detected;
  const left = bestVertical(gx, width, height, 0.015, 0.45, threshold);
  const right = bestVertical(gx, width, height, 0.55, 0.985, threshold);
  const top = bestHorizontal(gy, width, height, 0.01, 0.37, threshold);
  const bottom = bestHorizontal(gy, width, height, 0.63, 0.99, threshold);
  const small: CardQuad = {
    topLeft: intersect(left, top, width, height),
    topRight: intersect(right, top, width, height),
    bottomRight: intersect(right, bottom, width, height),
    bottomLeft: intersect(left, bottom, width, height),
  };
  const points = [small.topLeft, small.topRight, small.bottomRight, small.bottomLeft];
  const area = polygonArea(points);
  const areaRatio = area / (width * height);
  const averageWidth = (distance(small.topLeft, small.topRight) + distance(small.bottomLeft, small.bottomRight)) / 2;
  const averageHeight = (distance(small.topLeft, small.bottomLeft) + distance(small.topRight, small.bottomRight)) / 2;
  const aspect = averageHeight > 0 ? averageWidth / averageHeight : 0;
  const margins = points.every(point => point.x >= -width * 0.04 && point.x <= width * 1.04 && point.y >= -height * 0.04 && point.y <= height * 1.04);
  const lineScores = [left, right, top, bottom];
  const meanScore = lineScores.reduce((sum, line) => sum + line.score, 0) / 4;
  const meanCoverage = lineScores.reduce((sum, line) => sum + line.coverage, 0) / 4;
  const aspectQuality = Math.max(0, 1 - Math.abs(aspect - CARD_ASPECT) / 0.35);
  const areaQuality = areaRatio >= 0.22 && areaRatio <= 0.94 ? 1 : areaRatio >= 0.14 && areaRatio <= 0.98 ? 0.45 : 0;
  const edgeQuality = Math.max(0, Math.min(1, (meanScore - threshold * 0.55) / Math.max(8, threshold * 1.35)));
  const confidence = Math.max(0, Math.min(1, edgeQuality * 0.42 + meanCoverage * 0.28 + aspectQuality * 0.20 + areaQuality * 0.10));
  const valid = margins && areaQuality > 0 && aspect >= 0.50 && aspect <= 0.93 && averageWidth > width * 0.34 && averageHeight > height * 0.42;
  const unscale = (point: CardPoint): CardPoint => ({ x: point.x / scale, y: point.y / scale });
  return {
    quad: {
      topLeft: unscale(small.topLeft),
      topRight: unscale(small.topRight),
      bottomRight: unscale(small.bottomRight),
      bottomLeft: unscale(small.bottomLeft),
    },
    score: meanScore * (0.5 + meanCoverage * 0.5) + confidence * 50,
    confidence,
    valid,
  };
}

function solve8(matrix: number[][], values: number[]) {
  const n = 8;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    if (Math.abs(augmented[pivot][col]) < 1e-9) throw new Error("Perspectiva degenerada.");
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const divisor = augmented[col][col];
    for (let c = col; c <= n; c += 1) augmented[col][c] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (!factor) continue;
      for (let c = col; c <= n; c += 1) augmented[row][c] -= factor * augmented[col][c];
    }
  }
  return augmented.map(row => row[n]);
}

function homographyDestinationToSource(quad: CardQuad) {
  const destination = [
    { x: 0, y: 0 },
    { x: OUTPUT_WIDTH - 1, y: 0 },
    { x: OUTPUT_WIDTH - 1, y: OUTPUT_HEIGHT - 1 },
    { x: 0, y: OUTPUT_HEIGHT - 1 },
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
  return solve8(matrix, values);
}

function warpQuad(source: HTMLCanvasElement, quad: CardQuad) {
  const inputCtx = source.getContext("2d", { willReadFrequently: true });
  if (!inputCtx) throw new Error("Canvas indisponível para corrigir perspectiva.");
  const src = inputCtx.getImageData(0, 0, source.width, source.height);
  const output = document.createElement("canvas");
  output.width = OUTPUT_WIDTH;
  output.height = OUTPUT_HEIGHT;
  const outputCtx = output.getContext("2d", { willReadFrequently: true });
  if (!outputCtx) throw new Error("Canvas indisponível para corrigir perspectiva.");
  const result = outputCtx.createImageData(OUTPUT_WIDTH, OUTPUT_HEIGHT);
  const h = homographyDestinationToSource(quad);
  for (let v = 0; v < OUTPUT_HEIGHT; v += 1) {
    for (let u = 0; u < OUTPUT_WIDTH; u += 1) {
      const denominator = h[6] * u + h[7] * v + 1;
      const x = (h[0] * u + h[1] * v + h[2]) / denominator;
      const y = (h[3] * u + h[4] * v + h[5]) / denominator;
      const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const y1 = Math.min(source.height - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, x - x0));
      const fy = Math.max(0, Math.min(1, y - y0));
      const out = (v * OUTPUT_WIDTH + u) * 4;
      const indexes = [(y0 * source.width + x0) * 4, (y0 * source.width + x1) * 4, (y1 * source.width + x0) * 4, (y1 * source.width + x1) * 4];
      for (let channel = 0; channel < 3; channel += 1) {
        const top = src.data[indexes[0] + channel] * (1 - fx) + src.data[indexes[1] + channel] * fx;
        const bottom = src.data[indexes[2] + channel] * (1 - fx) + src.data[indexes[3] + channel] * fx;
        result.data[out + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
      result.data[out + 3] = 255;
    }
  }
  outputCtx.putImageData(result, 0, 0);
  return output;
}

function aspectFallback(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para preparar a carta.");
  const availableW = source.width * 0.96;
  const availableH = source.height * 0.96;
  let cropW = availableW;
  let cropH = cropW / CARD_ASPECT;
  if (cropH > availableH) { cropH = availableH; cropW = cropH * CARD_ASPECT; }
  const x = (source.width - cropW) / 2;
  const y = (source.height - cropH) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x, y, cropW, cropH, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar a carta normalizada.")), "image/jpeg", 0.94));
}

export async function normalizeCardPhoto(file: File, onProgress?: (message: string) => void): Promise<CardNormalization> {
  onProgress?.("📐 Detectando os quatro cantos da carta…");
  const decoded = await decodeImage(file);
  const original = imageCanvas(decoded);
  const orientations: Array<{ rotation: 0 | 90 | 180 | 270; canvas: HTMLCanvasElement; detection: Detection }> = [];
  try {
    for (const rotation of [0, 90, 180, 270] as const) {
      const canvas = rotate(original, rotation);
      const detection = detectQuad(canvas);
      orientations.push({ rotation, canvas, detection });
    }
    orientations.sort((a, b) => (Number(b.detection.valid) - Number(a.detection.valid)) || b.detection.score - a.detection.score);
    const chosen = orientations[0];
    const useQuad = chosen.detection.valid && chosen.detection.confidence >= 0.34;
    onProgress?.(useQuad ? "📐 Corrigindo perspectiva e rotação…" : "📐 Contorno incerto; usando recorte de proporção seguro…");
    let normalized: HTMLCanvasElement;
    try {
      normalized = useQuad ? warpQuad(chosen.canvas, chosen.detection.quad) : aspectFallback(chosen.canvas);
    } catch {
      normalized = aspectFallback(chosen.canvas);
    }
    const blob = await canvasBlob(normalized);
    normalized.width = normalized.height = 0;
    const normalizedFile = new File([blob], `normalized-${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
    return {
      file: normalizedFile,
      blob,
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      rotation: chosen.rotation,
      method: useQuad ? "quad" : "aspect-fallback",
      confidence: chosen.detection.confidence,
      quad: useQuad ? chosen.detection.quad : undefined,
    };
  } finally {
    for (const item of orientations) if (item.canvas !== original) item.canvas.width = item.canvas.height = 0;
    original.width = original.height = 0;
  }
}

export const cardNormalizationRuntime = {
  output: [OUTPUT_WIDTH, OUTPUT_HEIGHT] as const,
  detectorMaxDimension: DETECT_MAX,
  cardAspect: CARD_ASPECT,
  perspective: "four-edge-homography+bilinear",
};
