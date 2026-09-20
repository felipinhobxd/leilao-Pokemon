import { authorize, failure, HttpError } from "@/lib/backend";
import { CARD_IMAGE_BUCKET } from "@/lib/card-image";
import { isPurgeFinalPhrase } from "@/lib/purge";

export const runtime = "nodejs";

/** Best-effort cleanup of the content-addressed card-images bucket: cards are
 * gone, so their Storage objects would dangle forever. Each listed batch is
 * deleted before the next list (always offset 0 — deleting shifts the window,
 * so a moving offset would skip half the objects); failures are reported,
 * never fatal — the database purge already succeeded. */
async function emptyCardImagesBucket(db: Awaited<ReturnType<typeof authorize>>["db"]) {
  let removed = 0;
  let failed = 0;
  for (;;) {
    const { data, error } = await db.storage.from(CARD_IMAGE_BUCKET).list("cards", { limit: 1000 });
    if (error || !data) throw new Error(error?.message ?? "card_image_list_failed");
    if (!data.length) break;
    const paths = data.map(object => `cards/${object.name}`).filter(path => !path.endsWith("/.emptyFolderPlaceholder"));
    if (!paths.length) break;
    const { error: removeError } = await db.storage.from(CARD_IMAGE_BUCKET).remove(paths);
    if (removeError) { failed += paths.length; break; }
    removed += paths.length;
  }
  return { removed, failed };
}

export async function POST(request: Request) {
  try {
    const { db, profile, user } = await authorize(request, true);
    // Nuclear action: operators can run auctions but not erase history.
    if (profile.role !== "admin") throw new HttpError(403, "Somente administradores podem excluir tudo.");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!isPurgeFinalPhrase(body.confirm)) throw new HttpError(400, 'Digite exatamente "quero excluir mesmo" para confirmar.');

    const { data: result, error } = await db.rpc("purge_all_business_data", { p_confirm: String(body.confirm ?? "") });
    if (error || !result) throw new Error(error?.message ?? "purge_failed");

    // Leave a first-class audit trail in the (now empty) activity feed so the
    // restart is visible on the dashboard and in the Excel export.
    await db.from("auction_events").insert({
      admin_user_id: user.id,
      event_type: "DATA_PURGED",
      external_event_id: `purge:${user.id}:${new Date().toISOString()}`,
      payload: { deleted: (result as { deleted?: Record<string, number> }).deleted ?? {}, by: user.id },
    });

    let storage: { removed: number; failed: number } | null = null;
    try { storage = await emptyCardImagesBucket(db); }
    catch (issue) { console.error("card-images bucket cleanup failed:", issue); }

    return Response.json({ ok: true, result, storage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
