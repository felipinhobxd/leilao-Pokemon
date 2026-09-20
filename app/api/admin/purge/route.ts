import { authorize, failure, HttpError } from "@/lib/backend";
import { CARD_IMAGE_BUCKET } from "@/lib/card-image";
import { isPurgeFinalPhrase, normalizePurgePhrase, parsePurgeRpcError } from "@/lib/purge";

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

    // Capture the worker before the purge. Old bot commands are deleted by the purge,
    // so the session logout command is queued again only after the destructive transaction commits.
    const { data: worker, error: workerError } = await db
      .from("whatsapp_bot_workers")
      .select("worker_id")
      .order("heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (workerError) throw new Error("whatsapp_bot_worker_read_failed");

    // The UI unlocks the button on the NORMALIZED phrase ("Quero Excluir Mesmo"
    // passes), but the RPC compares the literal 'quero excluir mesmo' — send
    // the normalized form or every mixed-case confirmation 500s as
    // purge_not_confirmed.
    const confirm = normalizePurgePhrase(body.confirm);
    const { data: result, error } = await db.rpc("purge_all_business_data", { p_confirm: confirm });
    if (error || !result) {
      const parsed = parsePurgeRpcError(error);
      throw new HttpError(parsed.status, parsed.message);
    }

    // Queue the local session wipe after the database purge so this command
    // cannot be deleted by the purge itself.
    if (worker?.worker_id) {
      const { error: logoutError } = await db.from("whatsapp_bot_commands").insert({
        worker_id: worker.worker_id,
        command: "logout",
        requested_by: user.id,
      });
      if (logoutError) console.error("Falha ao enfileirar logout da sessão WhatsApp:", logoutError.message);
    }

    // Leave a first-class audit trail in the (now empty) activity feed so the
    // restart is visible on the dashboard and in the Excel export. Best-effort:
    // the database is already wiped at this point — a post-purge hiccup must
    // never surface as "the purge failed".
    try {
      await db.from("auction_events").insert({
        admin_user_id: user.id,
        event_type: "DATA_PURGED",
        external_event_id: `purge:${user.id}:${new Date().toISOString()}`,
        payload: { deleted: (result as { deleted?: Record<string, number> }).deleted ?? {}, by: user.id },
      });
    } catch (issue) { console.error("DATA_PURGED audit insert failed:", issue); }

    let storage: { removed: number; failed: number } | null = null;
    try { storage = await emptyCardImagesBucket(db); }
    catch (issue) { console.error("card-images bucket cleanup failed:", issue); }

    return Response.json({ ok: true, result, storage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
