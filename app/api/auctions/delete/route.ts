import { authorize, failure, HttpError } from "@/lib/backend";
import { isAuctionDeleteConfirm } from "@/lib/purge";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Excluir leilão DE VERDADE (não é o 'Remover' que só cancela): remove a
// árvore inteira (lances, votos, publicações, eventos, compras) e a carta
// quando órfã — o leilão de teste sai do Excel. Frase "sim quero" validada
// aqui E no RPC (tripla: UI → API → banco).
export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const auctionId = String(body.auctionId ?? "");
    if (!uuid.test(auctionId)) throw new HttpError(400, "Leilão inválido.");
    const confirm = String(body.confirm ?? "");
    if (!isAuctionDeleteConfirm(confirm)) throw new HttpError(400, "Digite exatamente “sim quero” para excluir.");
    const { data, error } = await db.rpc("delete_auction", { p_auction_id: auctionId, p_confirm: confirm.trim(), p_admin_user_id: user.id });
    if (error) {
      const message = String(error.message ?? "");
      if (/delete_not_confirmed/i.test(message)) throw new HttpError(400, "Digite exatamente “sim quero” para excluir.");
      if (/auction_not_found/i.test(message)) throw new HttpError(404, "Leilão não encontrado.");
      if (/auction_not_deletable/i.test(message)) throw new HttpError(409, "Leilão aberto não pode ser excluído — finalize ou remova antes.");
      throw new Error("auction_delete_failed");
    }
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
