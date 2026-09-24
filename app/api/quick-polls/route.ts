import { authorize, failure, HttpError } from "@/lib/backend";

// P-07 — Brinde rápido: enquete livre (texto/emoji) criada no painel e
// publicada pelo bot no horário agendado ("quem clicar primeiro leva").
// Vota em whatsapp_quick_polls (tabela própria — dispatches exige auction_id).
// GET lista os recentes (agendados + enviados) para /auctions/brinde.
export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request, false);
    const { data, error } = await db.from("whatsapp_quick_polls")
      .select("id,group_id,title,options,scheduled_at,sent_at,poll_message_id,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("quick_polls_read_failed");
    return Response.json({ data: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const eventId = String(body.eventId ?? "").trim();
    if (eventId.length < 1 || eventId.length > 200) throw new HttpError(400, "Evento inválido.");
    const groupId = String(body.groupId ?? "");
    if (!uuid.test(groupId)) throw new HttpError(400, "Selecione o grupo do WhatsApp.");
    const title = String(body.title ?? "").trim();
    if (title.length < 1 || title.length > 200) throw new HttpError(400, "O título precisa ter entre 1 e 200 caracteres.");
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const options = rawOptions.map(option => String(option ?? "").trim()).filter(Boolean);
    if (options.length < 2 || options.length > 12) throw new HttpError(400, "A enquete precisa de 2 a 12 opções.");
    if (options.some(option => option.length > 100)) throw new HttpError(400, "Cada opção precisa ter até 100 caracteres.");
    const scheduledAtRaw = String(body.scheduledAt ?? "").trim();
    const scheduledTime = scheduledAtRaw ? Date.parse(scheduledAtRaw) : Date.now();
    if (!Number.isFinite(scheduledTime)) throw new HttpError(400, "Horário de publicação inválido.");
    if (scheduledTime < Date.now() - 120_000) throw new HttpError(400, "O horário de publicação já passou.");
    const externalEventId = `quick-poll:${eventId}`.slice(0, 200);

    const { data: group } = await db.from("whatsapp_groups").select("id,active").eq("id", groupId).maybeSingle();
    if (!group?.active) throw new HttpError(409, "O grupo escolhido não está mais disponível.");

    // Idempotência leve pelo evento (unique external_event_id): reenviar o
    // mesmo eventId devolve a mesma enquete em vez de criar duas.
    const { data: existing } = await db.from("whatsapp_quick_polls").select("id,scheduled_at,sent_at,title,options").eq("external_event_id", externalEventId).maybeSingle();
    if (existing) return Response.json({ data: existing }, { headers: { "Cache-Control": "no-store" } });

    const { data: created, error } = await db.from("whatsapp_quick_polls")
      .insert({
        group_id: groupId,
        title,
        options,
        scheduled_at: new Date(scheduledTime).toISOString(),
        external_event_id: externalEventId,
        created_by: user.id,
      })
      .select("id,group_id,title,options,scheduled_at,sent_at")
      .single();
    if (error || !created) throw new HttpError(409, "Não foi possível agendar o brinde.");
    return Response.json({ data: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
