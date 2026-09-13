import { authorize, failure, HttpError } from "@/lib/backend";
import { parseCommand } from "@/lib/commands";
export const runtime = "nodejs";
const messages: Record<string, string> = {
  auction_not_open: "Leilão encerrado ou ainda não aberto.", auction_not_draft: "Só é possível alterar um leilão em rascunho.",
  participant_not_eligible: "Participante suspenso ou bloqueado.", active_bid_exists: "Este participante já tem um lance. Use trocar lance.",
  active_bid_not_found: "Nenhum lance ativo para alterar ou retirar.", event_id_conflict: "ID de evento já utilizado com outro conteúdo.",
  stale_event: "Evento antigo: o estado atual foi preservado.", deadline_expired: "O prazo do leilão terminou. Finalize para apurar o vencedor.",
  card_unavailable: "Carta indisponível para leilão.", card_in_use: "Carta vinculada a uma disputa ou venda.", invalid_bid_amount: "Valor abaixo do inicial ou inválido.",
  buyout_not_enabled: "Este leilão não tem ARREMATE.", forbidden: "Operação não autorizada.",
};
export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    // Limit actual bytes, including chunked requests (not just Content-Length).
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Corpo vazio.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new HttpError(413, "Comando muito grande."); }
      chunks.push(part.value);
    }
    let command;
    try { command = parseCommand(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch { throw new HttpError(400, "Comando inválido. Confira os campos e os valores."); }
    const { data, error } = await db.rpc("process_auction_command", { p_command: command, p_admin_user_id: user.id });
    if (error) {
      const known = Object.entries(messages).find(([key]) => error.message === key);
      throw new HttpError(409, known?.[1] ?? "Operação recusada pelo banco. Atualize o painel e confira os dados.");
    }
    return Response.json({ result: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
