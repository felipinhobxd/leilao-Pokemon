import type { SupabaseClient } from "@supabase/supabase-js";

export const CARD_IMAGE_BUCKET = "card-images";
export const CARD_IMAGE_CACHE_CONTROL = "31536000";
export const CARD_IMAGE_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const CARD_IMAGE_MAX_STORED_BYTES = 2 * 1024 * 1024;
export const CARD_IMAGE_TARGET_BYTES = 500 * 1024;
export const CARD_IMAGE_MAX_DIMENSION = 1600;
export const CARD_IMAGE_UPLOAD_CONCURRENCY = 3;
export const CARD_IMAGE_AUTH_BATCH = 12;

export type CardImageMime = "image/jpeg" | "image/png" | "image/webp";
export type CardImageStage = "idle" | "optimizing" | "authorizing" | "uploading" | "done" | "error";
export type PreparedCardImage = {
  file: File;
  sha256: string;
  mimeType: CardImageMime;
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
  originalBytes: number;
  sizeBytes: number;
  optimized: boolean;
};
export type UploadedCardImage = PreparedCardImage & { path: string; url: string; deduplicated: boolean };
export type CardImageAuthorization = {
  sha256: string;
  path: string;
  url: string;
  exists: boolean;
  token?: string;
};
export type CardImageUploadFailure = { id: string; message: string };
export type CardImageBatchResult = {
  /** Successfully uploaded (or deduplicated) images by item id. */
  uploaded: Map<string, UploadedCardImage>;
  /** Items that could not be uploaded, with the per-item reason. Never throws:
   * partial success is returned so the caller can decide what to do. */
  failures: CardImageUploadFailure[];
};

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;
type BatchItem = { id: string; file: File };
type StatusCallback = (id: string, stage: CardImageStage, message?: string) => void;
type UploadedCallback = (id: string, uploaded: UploadedCardImage) => void;

/**
 * WebP re-encode ladder. The first entries preserve the original behavior
 * (target ~500 KB at ≤1600 px). The EMERGENCY entries only run when the
 * smallest regular candidate still exceeds CARD_IMAGE_MAX_STORED_BYTES —
 * real photos of holo/full-art cards are extremely noisy (rainbow foil) and
 * can stay above 2 MB even at 1200 px/0.79. An 800 px @ 0.70 WebP is always
 * far below 2 MB, so the ladder guarantees a storable result instead of the
 * old deterministic "A imagem continuou acima de 2 MB" dead end.
 */
export const WEBP_OPTIMIZATION_LADDER: ReadonlyArray<{ maxDimension: number; quality: number }> = [
  { maxDimension: 1600, quality: 0.85 },
  { maxDimension: 1600, quality: 0.82 },
  { maxDimension: 1600, quality: 0.79 },
  { maxDimension: 1400, quality: 0.85 },
  { maxDimension: 1400, quality: 0.82 },
  { maxDimension: 1400, quality: 0.79 },
  { maxDimension: 1200, quality: 0.85 },
  { maxDimension: 1200, quality: 0.82 },
  { maxDimension: 1200, quality: 0.79 },
  { maxDimension: 1000, quality: 0.75 },
  { maxDimension: 900, quality: 0.75 },
  { maxDimension: 800, quality: 0.70 },
];
const REGULAR_LADDER_STEPS = 9;

/**
 * Returns the ladder steps that apply to a given input. Inputs that are
 * already small take the REGULAR steps only (byte-identical behavior to the
 * previous implementation); the emergency steps are appended exclusively
 * when needed to satisfy the storage budget.
 */
export function ladderStepsFor(originalBytes: number, originalMaxDimension: number): ReadonlyArray<{ maxDimension: number; quality: number }> {
  const needsRecompress = originalBytes > 750 * 1024 || originalMaxDimension > CARD_IMAGE_MAX_DIMENSION;
  if (!needsRecompress) return [];
  return WEBP_OPTIMIZATION_LADDER;
}

const extensionByMime: Record<CardImageMime, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function sniffImageMime(bytes: Uint8Array): CardImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function cardImagePath(sha256: string, mimeType: CardImageMime) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Hash de imagem inválido.");
  return `cards/${sha256}.${extensionByMime[mimeType]}`;
}

export function shouldUseOptimized(originalBytes: number, optimizedBytes: number, originalMaxDimension: number) {
  if (!Number.isFinite(optimizedBytes) || optimizedBytes <= 0) return false;
  if (originalMaxDimension > CARD_IMAGE_MAX_DIMENSION) return optimizedBytes < originalBytes;
  return optimizedBytes <= Math.floor(originalBytes * 0.95);
}

export async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

async function canvasWebp(bitmap: ImageBitmap, maxDimension: number, quality: number) {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
  return blob ? { blob, width: canvas.width, height: canvas.height } : null;
}

/**
 * Decode fallback: some real-world JPEGs (CMYK, exotic progressive scans)
 * make createImageBitmap throw while the regular <img> decoder handles them
 * fine. Both paths respect EXIF orientation in modern browsers.
 */
async function decodeImageBitmap(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file); }
  catch {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = document.createElement("img");
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("decode failed"));
        element.src = objectUrl;
      });
      const bitmap = await createImageBitmap(image);
      return bitmap;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function prepareCardImage(file: File): Promise<PreparedCardImage> {
  if (!file.size || file.size > CARD_IMAGE_MAX_INPUT_BYTES) throw new Error("A imagem original deve ter entre 1 byte e 25 MB.");
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const realMime = sniffImageMime(header);
  if (!realMime) throw new Error("A imagem real precisa ser JPG, PNG ou WebP.");

  let bitmap: ImageBitmap;
  try { bitmap = await decodeImageBitmap(file); }
  catch { throw new Error("Não foi possível ler as dimensões da imagem."); }
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const originalMaxDimension = Math.max(originalWidth, originalHeight);
  let chosen: { blob: Blob; width: number; height: number } | null = null;

  // Small, already practical assets are preserved exactly. Larger images are
  // recompressed once in the browser so Storage never needs the giant source.
  // The ladder stops at the first candidate within the ~500 KB target; the
  // emergency steps (1000/900/800 px) only run when the smallest regular
  // candidate would still exceed the 2 MB storage budget.
  const steps = ladderStepsFor(file.size, originalMaxDimension);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const isEmergency = index >= REGULAR_LADDER_STEPS;
    // Regular steps: stop as soon as we are within the ~500 KB target.
    if (chosen && chosen.blob.size <= CARD_IMAGE_TARGET_BYTES) break;
    // Emergency steps exist ONLY to satisfy the 2 MB storage budget: when the
    // regular ladder already produced a storable image, keep it (quality first).
    if (isEmergency && chosen && chosen.blob.size <= CARD_IMAGE_MAX_STORED_BYTES) break;
    const candidate = await canvasWebp(bitmap, step.maxDimension, step.quality);
    if (!candidate) continue;
    if (!chosen || candidate.blob.size < chosen.blob.size) chosen = candidate;
  }
  bitmap.close();

  const useOptimized = chosen && shouldUseOptimized(file.size, chosen.blob.size, originalMaxDimension);
  const finalBlob = useOptimized ? chosen!.blob : file;
  const mimeType = (useOptimized ? "image/webp" : realMime) as CardImageMime;
  if (finalBlob.size > CARD_IMAGE_MAX_STORED_BYTES) {
    throw new Error("A imagem continuou acima de 2 MB após a otimização. Reduza a resolução antes de enviar.");
  }
  const finalFile = useOptimized
    ? new File([finalBlob], `${file.name.replace(/\.[^.]+$/, "") || "carta"}.webp`, { type: mimeType, lastModified: file.lastModified })
    : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
  const sha256 = await sha256Hex(finalFile);
  return {
    file: finalFile,
    sha256,
    mimeType,
    extension: extensionByMime[mimeType],
    width: useOptimized ? chosen!.width : originalWidth,
    height: useOptimized ? chosen!.height : originalHeight,
    originalBytes: file.size,
    sizeBytes: finalFile.size,
    optimized: Boolean(useOptimized),
  };
}

async function authorizeImages(authFetch: AuthFetch, images: PreparedCardImage[]) {
  const response = await authFetch("/api/cards/image/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: images.map(image => ({ sha256: image.sha256, mimeType: image.mimeType, sizeBytes: image.sizeBytes })) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Não foi possível autorizar o upload das imagens.");
  return (body.images ?? []) as CardImageAuthorization[];
}

async function uploadOne(client: SupabaseClient, authFetch: AuthFetch, prepared: PreparedCardImage, authorization: CardImageAuthorization) {
  if (authorization.exists) return { ...prepared, path: authorization.path, url: authorization.url, deduplicated: true } satisfies UploadedCardImage;
  if (!authorization.token) throw new Error("Autorização de upload incompleta.");
  const { error } = await client.storage.from(CARD_IMAGE_BUCKET).uploadToSignedUrl(
    authorization.path,
    authorization.token,
    prepared.file,
    { contentType: prepared.mimeType, cacheControl: CARD_IMAGE_CACHE_CONTROL },
  );
  if (!error) return { ...prepared, path: authorization.path, url: authorization.url, deduplicated: false } satisfies UploadedCardImage;

  // Another browser may have won the race for the same content-addressed path.
  // Re-authorize once: if the object now exists, reuse it instead of overwriting.
  const retry = await authorizeImages(authFetch, [prepared]);
  const resolved = retry[0];
  if (resolved?.exists) return { ...prepared, path: resolved.path, url: resolved.url, deduplicated: true } satisfies UploadedCardImage;
  throw new Error(error.message || "Falha no upload direto ao Storage.");
}

export async function uploadCardImageBatch(options: {
  client: SupabaseClient;
  authFetch: AuthFetch;
  items: BatchItem[];
  onStatus?: StatusCallback;
  /** Fired per item as soon as its upload (or dedup) is confirmed. Callers
   * use it to persist completed images immediately, so a later failure never
   * discards work that already succeeded ("preservadas" must be true). */
  onUploaded?: UploadedCallback;
}): Promise<CardImageBatchResult> {
  const { client, authFetch, items, onStatus, onUploaded } = options;
  const output = new Map<string, UploadedCardImage>();
  const byHash = new Map<string, UploadedCardImage>();
  const failures: CardImageUploadFailure[] = [];

  for (let offset = 0; offset < items.length; offset += CARD_IMAGE_AUTH_BATCH) {
    const chunk = items.slice(offset, offset + CARD_IMAGE_AUTH_BATCH);
    const prepared = await mapWithConcurrency(chunk, CARD_IMAGE_UPLOAD_CONCURRENCY, async item => {
      onStatus?.(item.id, "optimizing", "Otimizando…");
      try { return { item, prepared: await prepareCardImage(item.file) }; }
      catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao otimizar.";
        onStatus?.(item.id, "error", message); failures.push({ id: item.id, message }); return null;
      }
    });
    const valid = prepared.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (!valid.length) continue;

    const unique = new Map<string, PreparedCardImage>();
    for (const entry of valid) if (!byHash.has(entry.prepared.sha256) && !unique.has(entry.prepared.sha256)) unique.set(entry.prepared.sha256, entry.prepared);
    for (const entry of valid) if (!byHash.has(entry.prepared.sha256)) onStatus?.(entry.item.id, "authorizing", "Autorizando…");

    let authorizations = new Map<string, CardImageAuthorization>();
    if (unique.size) {
      try {
        const authorized = await authorizeImages(authFetch, [...unique.values()]);
        authorizations = new Map(authorized.map(item => [item.sha256, item]));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao autorizar upload.";
        for (const entry of valid) if (!byHash.has(entry.prepared.sha256)) { onStatus?.(entry.item.id, "error", message); failures.push({ id: entry.item.id, message }); }
        continue;
      }

      await mapWithConcurrency([...unique.values()], CARD_IMAGE_UPLOAD_CONCURRENCY, async image => {
        const matching = valid.filter(entry => entry.prepared.sha256 === image.sha256);
        matching.forEach(entry => onStatus?.(entry.item.id, "uploading", "Enviando…"));
        const authorization = authorizations.get(image.sha256);
        try {
          if (!authorization) throw new Error("Servidor não retornou autorização para a imagem.");
          const uploaded = await uploadOne(client, authFetch, image, authorization);
          byHash.set(image.sha256, uploaded);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha no upload.";
          // Every item sharing this content failed together — record them all,
          // not just the first (the wizard highlights each affected card).
          matching.forEach(entry => {
            onStatus?.(entry.item.id, "error", message);
            failures.push({ id: entry.item.id, message });
          });
        }
      });
    }

    for (const entry of valid) {
      const uploaded = byHash.get(entry.prepared.sha256);
      if (!uploaded) continue;
      output.set(entry.item.id, uploaded);
      onUploaded?.(entry.item.id, uploaded);
      const saved = entry.prepared.originalBytes - entry.prepared.sizeBytes;
      const label = uploaded.deduplicated ? "Reutilizada, sem novo armazenamento" : saved > 0 ? `Concluída · ${Math.round(saved / 1024)} KB economizados` : "Concluída";
      onStatus?.(entry.item.id, "done", label);
    }
  }

  // Never throw here: partial success is real success. The caller decides
  // whether failures block the auction or are sent without those images.
  return { uploaded: output, failures };
}
