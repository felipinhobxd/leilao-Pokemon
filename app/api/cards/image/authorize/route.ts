import { authorize, failure, HttpError } from "@/lib/backend";
import { CARD_IMAGE_BUCKET, CARD_IMAGE_MAX_STORED_BYTES, cardImagePath, type CardImageMime } from "@/lib/card-image";
import Redis from "ioredis";

export const runtime = "nodejs";

const allowedMime = new Set<CardImageMime>(["image/jpeg", "image/png", "image/webp"]);
const hashPattern = /^[a-f0-9]{64}$/;

type Descriptor = { sha256: string; mimeType: CardImageMime; sizeBytes: number };

// Rate limit configuration: 50 requests per minute per userId
const RATE_LIMIT_MAX_REQUESTS = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

let rateLimitClient: Redis | null = null;

function getRateLimitClient(): Redis {
  if (!rateLimitClient) {
    rateLimitClient = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
  }
  return rateLimitClient;
}

async function checkRateLimit(userId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const client = getRateLimitClient();
    const key = `ratelimit:image:authorize:${userId}`;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    
    // Remove old entries outside the window
    await client.zremrangebyscore(key, "-inf", windowStart.toString());
    
    // Count requests in current window
    const requestCount = await client.zcard(key);
    
    if (requestCount >= RATE_LIMIT_MAX_REQUESTS) {
      // Get the oldest entry to calculate retry-after
      const oldestEntries = await client.zrange(key, "0", "0", "WITHSCORES") as string[];
      let retryAfter = 60; // default
      if (oldestEntries && oldestEntries.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntries[1], 10);
        retryAfter = Math.ceil((oldestTimestamp + RATE_LIMIT_WINDOW_MS - now) / 1000);
        retryAfter = Math.max(1, Math.min(retryAfter, 60));
      }
      return { allowed: false, retryAfter };
    }
    
    // Add current request using sorted set (timestamp as score and member)
    const memberId = `${now}-${Math.random().toString(36).slice(2)}`;
    await client.zadd(key, Number(now), memberId);
    await client.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 1);
    
    return { allowed: true };
  } catch (error) {
    // If Redis fails, allow the request but log the error
    console.error("Rate limit check failed:", error);
    return { allowed: true };
  }
}

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
    
    // Check rate limit (50 req/min per userId)
    const rateLimitResult = await checkRateLimit(user.id);
    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.retryAfter || 60;
      throw new HttpError(429, "Limite de requisições excedido. Tente novamente em breve.", { "Retry-After": String(retryAfter) });
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
