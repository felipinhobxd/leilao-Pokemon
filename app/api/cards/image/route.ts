import { createHash } from "node:crypto";
import { authorize, failure, HttpError } from "@/lib/backend";
import { DEFAULT_RATE_LIMIT, DEFAULT_RATE_WINDOW_SECONDS, enforceUserRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const bucket = "card-images";
const allowed: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function ensureBucket(db: Awaited<ReturnType<typeof authorize>>["db"]) {
  const { data } = await db.storage.getBucket(bucket);
  if (data) return;
  const { error } = await db.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: Object.keys(allowed),
  });
  if (error && !/already exists/i.test(error.message)) throw new Error("card_image_bucket_failed");
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    // Same guard as the signed-URL sibling: both entry points feed the same
    // Storage bucket and share its quota — one must not bypass the other.
    const limit = await enforceUserRateLimit("card-image", user.id, {
      limit: DEFAULT_RATE_LIMIT,
      windowSeconds: DEFAULT_RATE_WINDOW_SECONDS,
    });
    if (!limit.allowed) {
      return Response.json({ error: "Muitos uploads — tente novamente em instantes." }, {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, limit.retryAfterSeconds)), "Cache-Control": "no-store" },
      });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
    const extension = allowed[file.type];
    if (!extension) throw new HttpError(400, "Use uma imagem JPG, PNG ou WebP.");
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new HttpError(400, "A imagem deve ter no máximo 5 MB.");

    await ensureBucket(db);
    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    const path = `cards/${digest}.${extension}`;
    const { error } = await db.storage.from(bucket).upload(path, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error && !/already exists|duplicate|resource.*exists/i.test(error.message)) throw new Error("card_image_upload_failed");
    const { data } = db.storage.from(bucket).getPublicUrl(path);
    if (!data.publicUrl?.startsWith("https://")) throw new Error("card_image_url_failed");
    return Response.json({ url: data.publicUrl, path, deduplicated: Boolean(error) });
  } catch (error) {
    return failure(error);
  }
}
