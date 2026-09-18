import { authorize, failure, HttpError } from "@/lib/backend";
import { CARD_IMAGE_BUCKET, CARD_IMAGE_MAX_STORED_BYTES, cardImagePath, type CardImageMime } from "@/lib/card-image";
import { DEFAULT_RATE_LIMIT, DEFAULT_RATE_WINDOW_SECONDS, enforceUserRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const allowedMime = new Set<CardImageMime>(["image/jpeg", "image/png", "image/webp"]);
const hashPattern = /^[a-f0-9]{64}$/;

type Descriptor = { sha256: string; mimeType: CardImageMime; sizeBytes: number };

async function ensureBucket(db: Awaited<ReturnType<typeof authorize>>["db"]) {
  const { data, error } = await db.storage.getBucket(CARD_IMAGE_BUCKET);
  if (data) return;
  if (error && !/not found/i.test(error.message)) throw new Error("card_image_bucket_check_failed");
  const { error: createError } = await db.storage.createBucket(CARD_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: [...allowedMime],
  });
  if (createError && !/already exists/i.test(createError.message)) throw new Error("card_image_bucket_failed");
}

function parseDescriptors(value: unknown): Descriptor[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new HttpError(400, "Envie entre 1 e 20 imagens por autorização.");
  const unique = new Map<string, Descriptor>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Descrição de imagem inválida.");
    const record = raw as Record<string, unknown>;
    const sha256 = String(record.sha256 ?? "").toLowerCase();
    const mimeType = String(record.mimeType ?? "") as CardImageMime;
    const sizeBytes = Number(record.sizeBytes);
    if (!hashPattern.test(sha256)) throw new HttpError(400, "Hash de imagem inválido.");
    if (!allowedMime.has(mimeType)) throw new HttpError(400, "Use somente JPG, PNG ou WebP.");
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > CARD_IMAGE_MAX_STORED_BYTES) throw new HttpError(400, "A imagem otimizada deve ter no máximo 2 MB.");
    const key = `${sha256}:${mimeType}`;
    unique.set(key, { sha256, mimeType, sizeBytes });
  }
  return [...unique.values()];
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    // Fase 4.2: 50 autorizações/minuto por usuário — sem isso, um único
    // usuário esgota a cota de signedUrl do Supabase para todo mundo.
    const limit = await enforceUserRateLimit("card-image", user.id, {
      limit: DEFAULT_RATE_LIMIT,
      windowSeconds: DEFAULT_RATE_WINDOW_SECONDS,
    });
    if (!limit.allowed) {
      return Response.json(
        { error: "Muitas autorizações de upload em pouco tempo. Aguarde e tente novamente." },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfterSeconds),
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const descriptors = parseDescriptors(body.images);
    await ensureBucket(db);

    const images = await Promise.all(descriptors.map(async descriptor => {
      const path = cardImagePath(descriptor.sha256, descriptor.mimeType);
      const bucket = db.storage.from(CARD_IMAGE_BUCKET);
      const { data: exists, error: existsError } = await bucket.exists(path);
      if (existsError) throw new Error("card_image_exists_check_failed");
      const { data: publicData } = bucket.getPublicUrl(path);
      const url = publicData.publicUrl;
      if (!url?.startsWith("https://")) throw new Error("card_image_url_failed");
      if (exists) return { sha256: descriptor.sha256, path, url, exists: true };

      const { data: signed, error: signedError } = await bucket.createSignedUploadUrl(path, { upsert: false });
      if (signedError || !signed?.token) throw new Error("card_image_sign_failed");
      return { sha256: descriptor.sha256, path, url, exists: false, token: signed.token };
    }));

    return Response.json({ images }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
