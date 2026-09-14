import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const FINGERPRINT_HEX = /^[a-f0-9]{72}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const LANGUAGES = new Set(["pt-BR", "en", "es", "ja"]);
const MAX_ROWS = 1500;
const POPCOUNT = new Uint8Array(Array.from({ length: 256 }, (_, value) => {
  let n = value;
  let count = 0;
  while (n) { n &= n - 1; count += 1; }
  return count;
}));

type ExampleRow = {
  id: string;
  fingerprint: string;
  catalog_id: string | null;
  name: string;
  collection: string | null;
  card_number: string | null;
  language: string;
  variant: string | null;
  image_url: string | null;
  confirmations: number;
};

function parseFingerprint(value: unknown) {
  const fingerprint = String(value ?? "").toLowerCase();
  if (!FINGERPRINT_HEX.test(fingerprint)) throw new HttpError(400, "Fingerprint visual inválido.");
  const bytes = new Uint8Array(36);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(fingerprint.slice(i * 2, i * 2 + 2), 16);
  return { fingerprint, bytes };
}

function hamming(left: Uint8Array, leftOffset: number, right: Uint8Array, rightOffset: number) {
  let distance = 0;
  for (let i = 0; i < 8; i += 1) distance += POPCOUNT[left[leftOffset + i] ^ right[rightOffset + i]];
  return distance / 64;
}

function histogramDistance(left: Uint8Array, right: Uint8Array) {
  let distance = 0;
  for (let i = 0; i < 12; i += 1) distance += Math.abs(left[24 + i] - right[24 + i]);
  return Math.min(1, distance / 1530);
}

function descriptorDistance(left: Uint8Array, right: Uint8Array) {
  const art = hamming(left, 0, right, 0);
  const broad = hamming(left, 8, right, 8);
  const whole = hamming(left, 16, right, 16);
  const color = histogramDistance(left, right);
  return art * 0.52 + broad * 0.26 + whole * 0.14 + color * 0.08;
}

function safeText(value: unknown, max: number, required = false) {
  const text = String(value ?? "").trim().slice(0, max);
  if (required && !text) throw new HttpError(400, "Dados confirmados da carta estão incompletos.");
  return text || null;
}

async function searchMemory(db: Awaited<ReturnType<typeof authorize>>["db"], body: Record<string, unknown>) {
  const { bytes } = parseFingerprint(body.fingerprint);
  const requested = Math.max(1, Math.min(5, Number(body.limit) || 3));
  const { data, error } = await db
    .from("card_recognition_examples")
    .select("id,fingerprint,catalog_id,name,collection,card_number,language,variant,image_url,confirmations")
    .order("updated_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error("card_recognition_memory_read_failed");

  const matches = ((data ?? []) as ExampleRow[]).flatMap(row => {
    if (!FINGERPRINT_HEX.test(row.fingerprint)) return [];
    const other = new Uint8Array(36);
    for (let i = 0; i < other.length; i += 1) other[i] = Number.parseInt(row.fingerprint.slice(i * 2, i * 2 + 2), 16);
    const distance = descriptorDistance(bytes, other);
    return [{
      id: row.id,
      catalogId: row.catalog_id,
      name: row.name,
      collection: row.collection,
      cardNumber: row.card_number,
      language: row.language,
      variant: row.variant,
      imageUrl: row.image_url,
      confirmations: row.confirmations,
      distance,
      similarity: Math.max(0, Math.min(1, 1 - distance)),
    }];
  }).sort((a, b) => a.distance - b.distance).slice(0, requested);

  const first = matches[0];
  const second = matches[1];
  const margin = first ? (second?.distance ?? 1) - first.distance : 0;
  const confident = Boolean(first && first.distance <= 0.13 && (matches.length === 1 || margin >= 0.025));
  const veryStrong = Boolean(first && first.distance <= 0.07 && (first.confirmations >= 2 || margin >= 0.045));
  return { matches, confident, veryStrong };
}

async function learnMemory(db: Awaited<ReturnType<typeof authorize>>["db"], body: Record<string, unknown>) {
  const { fingerprint } = parseFingerprint(body.fingerprint);
  const imageSha256 = String(body.imageSha256 ?? "").toLowerCase();
  if (!SHA256_HEX.test(imageSha256)) throw new HttpError(400, "SHA-256 da imagem inválido.");
  const imageUrl = safeText(body.imageUrl, 2048, true)!;
  if (!imageUrl.startsWith("https://")) throw new HttpError(400, "URL da imagem inválida.");
  const name = safeText(body.name, 120, true)!;
  const collection = safeText(body.collection, 160);
  const cardNumber = safeText(body.cardNumber, 80);
  const variant = safeText(body.variant, 80);
  const catalogId = safeText(body.catalogId, 160);
  const language = String(body.language ?? "");
  if (!LANGUAGES.has(language)) throw new HttpError(400, "Idioma de carta inválido.");

  const { data: existing, error: existingError } = await db
    .from("card_recognition_examples")
    .select("confirmations")
    .eq("image_sha256", imageSha256)
    .maybeSingle();
  if (existingError) throw new Error("card_recognition_memory_lookup_failed");
  const confirmations = Math.min(1_000_000, Number(existing?.confirmations ?? 0) + 1);
  const { error } = await db.from("card_recognition_examples").upsert({
    image_sha256: imageSha256,
    fingerprint,
    image_url: imageUrl,
    catalog_id: catalogId,
    name,
    collection,
    card_number: cardNumber,
    language,
    variant,
    confirmations,
    updated_at: new Date().toISOString(),
  }, { onConflict: "image_sha256" });
  if (error) throw new Error("card_recognition_memory_write_failed");
  return { learned: true, confirmations };
}

export async function POST(request: Request) {
  try {
    const { db } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "search") return Response.json(await searchMemory(db, body), { headers: { "Cache-Control": "no-store" } });
    if (action === "learn") return Response.json(await learnMemory(db, body), { headers: { "Cache-Control": "no-store" } });
    throw new HttpError(400, "Ação de memória inválida.");
  } catch (error) {
    return failure(error);
  }
}
