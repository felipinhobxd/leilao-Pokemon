import { authorize, failure, HttpError } from "@/lib/backend";
import { isCompletedAuctionsConfirmed, normalizePurgePhrase } from "@/lib/purge";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { db, user, profile } = await authorize(request, true);
    if (profile.role !== "admin") throw new HttpError(403, "Somente administradores podem excluir os leilões encerrados.");
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !isCompletedAuctionsConfirmed(body.confirm1, body.confirm2)) throw new HttpError(400, "Digite as duas frases de confirmação corretamente.");
    const eventId = String(body.eventId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) throw new HttpError(400, "Identificador da operação inválido.");
    const { data, error } = await db.rpc("delete_completed_auctions", {
      p_event_id: eventId,
      p_confirm1: normalizePurgePhrase(body.confirm1),
      p_confirm2: normalizePurgePhrase(body.confirm2),
      p_admin_user_id: user.id,
    });
    if (error) {
      if (/delete_not_confirmed/i.test(error.message)) throw new HttpError(400, "Digite as duas frases de confirmação corretamente.");
      if (/forbidden/i.test(error.message)) throw new HttpError(403, "Conta sem permissão para esta operação.");
      if (/event_id_conflict/i.test(error.message)) throw new HttpError(409, "Identificador já usado em outra operação. Feche e abra a confirmação novamente.");
      if (error.code === "PGRST202") throw new HttpError(503, "A função de exclusão dos encerrados ainda não foi instalada no banco.");
      throw new Error("completed_auction_delete_failed");
    }
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
