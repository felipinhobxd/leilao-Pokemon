import { authorize, failure, HttpError } from "@/lib/backend";

// P-09 — Baixa de pagamento: marca a compra como paga (payments → paid,
// delivery → ready) e PARA os lembretes DM do bot (a consulta de pendências
// só acha entregas em waiting_payment). Idempotente por estado no próprio
// RPC (mark_purchase_paid): chamar duas vezes devolve o mesmo resultado e
// audita apenas a transição.
export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const purchaseId = String(body.purchaseId ?? "");
    if (!uuid.test(purchaseId)) throw new HttpError(400, "Compra inválida.");
    const method = String(body.method ?? "").trim().slice(0, 40) || null;
    const reference = String(body.reference ?? "").trim().slice(0, 100) || null;
    const { data, error } = await db.rpc("mark_purchase_paid", {
      p_purchase_id: purchaseId,
      p_admin_user_id: user.id,
      p_method: method,
      p_reference: reference,
    });
    if (error) {
      if (/purchase_not_found/i.test(error.message)) throw new HttpError(404, "Compra não encontrada.");
      if (/forbidden/i.test(error.message)) throw new HttpError(403, "Sem permissão.");
      if (/purchase_not_confirmable/i.test(error.message)) throw new HttpError(409, "Esta compra não está mais confirmada.");
      throw new Error("purchase_mark_paid_failed");
    }
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
