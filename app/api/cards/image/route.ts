import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const allowed: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  try {
    const { db } = await authorize(request, true);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
    const extension = allowed[file.type];
    if (!extension) throw new HttpError(400, "Use uma imagem JPG, PNG ou WebP.");
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new HttpError(400, "A imagem deve ter no máximo 5 MB.");

    const now = new Date();
    const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const path = `${prefix}/${crypto.randomUUID()}.${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await db.storage.from("card-images").upload(path, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error("card_image_upload_failed");
    const { data } = db.storage.from("card-images").getPublicUrl(path);
    if (!data.publicUrl?.startsWith("https://")) throw new Error("card_image_url_failed");
    return Response.json({ url: data.publicUrl });
  } catch (error) {
    return failure(error);
  }
}
