"use client";

import { createPublicSupabaseClient } from "./supabase";
import type { RecognitionCandidate, RecognitionLanguage } from "./card-recognition-core";

const DESCRIPTOR_BYTES = 36;
const MAX_MATCHES = 3;

type MemoryRow = {
  id: string;
  catalogId: string | null;
  name: string;
  collection: string | null;
  cardNumber: string | null;
  language: RecognitionLanguage;
  variant: string | null;
  imageUrl: string | null;
  confirmations: number;
  distance: number;
  similarity: number;
};

export type RecognitionMemoryOutcome = {
  status: "matched" | "no-match" | "unavailable" | "failed";
  fingerprint: string;
  matches: MemoryRow[];
  confident: boolean;
  veryStrong: boolean;
  elapsedMs: number;
  error?: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

async function decodeBlob(blob: Blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
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

function regionHash(image: ImageBitmap | HTMLImageElement, x0: number, y0: number, x1: number, y1: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível para memória visual.");
  const sx = Math.max(0, Math.round(image.width * x0));
  const sy = Math.max(0, Math.round(image.height * y0));
  const sw = Math.max(1, Math.round(image.width * (x1 - x0)));
  const sh = Math.max(1, Math.round(image.height * (y1 - y0)));
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 9, 8);
  const rgba = ctx.getImageData(0, 0, 9, 8).data;
  const hash = new Uint8Array(8);
  for (let y = 0; y < 8; y += 1) {
    let value = 0;
    for (let x = 0; x < 8; x += 1) {
      const left = (y * 9 + x) * 4;
      const right = left + 4;
      const grayLeft = rgba[left] * 0.299 + rgba[left + 1] * 0.587 + rgba[left + 2] * 0.114;
      const grayRight = rgba[right] * 0.299 + rgba[right + 1] * 0.587 + rgba[right + 2] * 0.114;
      if (grayLeft > grayRight) value |= 1 << (7 - x);
    }
    hash[y] = value;
  }
  canvas.width = canvas.height = 0;
  return hash;
}

function artworkHistogram(image: ImageBitmap | HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 32;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível para memória visual.");
  const sx = Math.round(image.width * 0.04);
  const sy = Math.round(image.height * 0.08);
  const sw = Math.max(1, Math.round(image.width * 0.92));
  const sh = Math.max(1, Math.round(image.height * 0.67));
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 24, 32);
  const rgba = ctx.getImageData(0, 0, 24, 32).data;
  const bins = new Float64Array(12);
  let pixels = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    bins[Math.min(3, Math.floor(rgba[i] / 64))] += 1;
    bins[4 + Math.min(3, Math.floor(rgba[i + 1] / 64))] += 1;
    bins[8 + Math.min(3, Math.floor(rgba[i + 2] / 64))] += 1;
    pixels += 1;
  }
  canvas.width = canvas.height = 0;
  const output = new Uint8Array(12);
  for (let i = 0; i < bins.length; i += 1) output[i] = Math.max(0, Math.min(255, Math.round(bins[i] / Math.max(1, pixels) * 255)));
  return output;
}

export async function fingerprintRecognitionExample(blob: Blob) {
  const image = await decodeBlob(blob);
  try {
    const descriptor = new Uint8Array(DESCRIPTOR_BYTES);
    descriptor.set(regionHash(image, 0.06, 0.12, 0.94, 0.60), 0);
    descriptor.set(regionHash(image, 0.03, 0.06, 0.97, 0.76), 8);
    descriptor.set(regionHash(image, 0.00, 0.00, 1.00, 1.00), 16);
    descriptor.set(artworkHistogram(image), 24);
    return bytesToHex(descriptor);
  } finally {
    if ("close" in image && typeof image.close === "function") image.close();
  }
}

async function authenticatedRequest(body: Record<string, unknown>) {
  const db = createPublicSupabaseClient();
  const { data } = await db.auth.getSession();
  if (!data.session) return null;
  return fetch("/api/card-recognition/memory", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function lookupRecognitionMemory(blob: Blob, onProgress?: (message: string) => void): Promise<RecognitionMemoryOutcome> {
  const started = performance.now();
  let fingerprint = "";
  try {
    fingerprint = await fingerprintRecognitionExample(blob);
    onProgress?.("🧠 Consultando memória de cartas já confirmadas…");
    const response = await authenticatedRequest({ action: "search", fingerprint, limit: MAX_MATCHES });
    if (!response) return { status: "unavailable", fingerprint, matches: [], confident: false, veryStrong: false, elapsedMs: Math.round(performance.now() - started) };
    const payload = await response.json() as { matches?: MemoryRow[]; confident?: boolean; veryStrong?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error || "Memória de reconhecimento indisponível.");
    const matches = Array.isArray(payload.matches) ? payload.matches.slice(0, MAX_MATCHES) : [];
    return {
      status: matches.length ? "matched" : "no-match",
      fingerprint,
      matches,
      confident: Boolean(payload.confident),
      veryStrong: Boolean(payload.veryStrong),
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      status: "failed",
      fingerprint,
      matches: [],
      confident: false,
      veryStrong: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function memoryMatchCandidate(match: MemoryRow): RecognitionCandidate {
  const parts = String(match.cardNumber ?? "").split("/");
  const localId = parts[0] ?? "";
  const denominator = Number(parts[1]) || null;
  return {
    id: match.catalogId || `memory:${match.id}`,
    name: match.name,
    collection: match.collection ?? "",
    cardNumber: match.cardNumber ?? localId,
    localId,
    denominator,
    language: match.language,
    hp: null,
    image: match.imageUrl,
    variant: match.variant ?? undefined,
    score: Math.max(0, Math.min(99, Math.round(match.similarity * 100))),
    visualSimilarity: match.similarity,
    evidence: {
      fullNumberMatch: false,
      localIdMatch: false,
      denominatorMatch: false,
      localIdSimilarity: 0,
      nameSimilarity: 0,
      languageMatch: false,
      hpMatch: false,
      strongEvidence: false,
      visualMatch: true,
    },
  };
}

export async function rememberConfirmedCard(input: {
  fingerprint: string;
  imageSha256: string;
  imageUrl: string;
  catalogId?: string | null;
  name: string;
  collection?: string;
  cardNumber?: string;
  language: string;
  variant?: string;
}) {
  if (!/^[a-f0-9]{72}$/.test(input.fingerprint) || !/^[a-f0-9]{64}$/.test(input.imageSha256)) return false;
  const response = await authenticatedRequest({ action: "learn", ...input });
  if (!response) return false;
  if (!response.ok) return false;
  return true;
}

export const recognitionMemoryRuntime = {
  descriptor: "36-byte-artwork+broad+whole-dhash+rgb-histogram",
  storage: "supabase-confirmed-examples-metadata-only",
  imageStorage: "reuse-existing-card-images-object",
  learning: "confirmed-example-memory-no-gradient-training",
};
