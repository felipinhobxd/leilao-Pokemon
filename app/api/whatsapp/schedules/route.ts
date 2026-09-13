import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

function parseValues(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "Informe os valores da enquete.");
  const values = value.map(Number);
  if (!values.length || values.length > 11 || values.some(v => !Number.isFinite(v) || v < 0 || Math.round(v * 100) !== v * 100)) {
    throw new HttpError(400, "Use entre 1 e 11 valores válidos, com no máximo 2 casas decimais.");
  }
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== values.length) throw new HttpError(400, "Não repita valores na enquete.");
  return unique;
}

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const [{ data: groups, error: groupError }, { data: dispatches, error: dispatchError }] = await Promise.all([
      db.from("whatsapp_groups")
        .select("id,group_jid,name,active,is_default,last_synced_at,updated_at")
        .eq("active", true)
        .order("name"),
      db.from("whatsapp_dispatches")
        .select("id,auction_id,group_id,scheduled_at,poll_title,poll_options,status,poll_message_id,sent_at,attempts,last_error,updated_at")
        .order("scheduled_at", { ascending: false })
        .limit(100),
    ]);
    if (groupError || dispatchError) throw new Error("whatsapp_schedule_read_failed");
    const activeGroups = groups ?? [];
    return Response.json({
      groups: activeGroups,
      defaultGroupId: activeGroups.find(group => group.is_default)?.id ?? null,
      dispatches: dispatches ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const auctionId = String(body.auctionId ?? "");
    const groupId = String(body.groupId ?? "");
    const scheduledAt = String(body.scheduledAt ?? "");
    const title = String(body.pollTitle ?? "💰 Para dar o seu lance, selecione um dos valores:").trim();
    const includeBuyout = body.includeBuyout !== false;
    if (!uuid.test(auctionId) || !uuid.test(groupId)) throw new HttpError(400, "Leilão ou grupo inválido.");
    if (!Number.isFinite(Date.parse(scheduledAt))) throw new HttpError(400, "Horário de envio inválido.");
    if (!title || title.length > 200) throw new HttpError(400, "Título da enquete inválido.");
    const values = parseValues(body.values);

    const { data: auction, error: auctionError } = await db.from("auctions").select("id,status,starting_price,buyout_price").eq("id", auctionId).single();
    if (auctionError || !auction) throw new HttpError(404, "Leilão não encontrado.");
    if (auction.status !== "draft") throw new HttpError(409, "Somente leilões em rascunho podem ser programados.");
    if (values.some(v => v < Number(auction.starting_price))) throw new HttpError(400, "Nenhum lance pode ficar abaixo do valor inicial.");

    const options: Array<{ label: string; amount: number; isBuyout: boolean }> = values.map(amount => ({
      label: money(amount), amount, isBuyout: false,
    }));
    const buyout = auction.buyout_price == null ? null : Number(auction.buyout_price);
    if (includeBuyout && buyout != null) {
      const buyoutLabel = `${money(buyout)} 🦭`;
      const existing = options.find(o => o.amount === buyout);
      if (existing) {
        existing.isBuyout = true;
        existing.label = buyoutLabel;
      } else {
        if (options.length >= 12) throw new HttpError(400, "Não há espaço para o ARREMATE: a enquete aceita no máximo 12 opções.");
        options.push({ label: buyoutLabel, amount: buyout, isBuyout: true });
      }
    }
    if (options.length > 12) throw new HttpError(400, "A enquete aceita no máximo 12 opções.");

    const { data: group, error: groupError } = await db.from("whatsapp_groups").select("id").eq("id", groupId).eq("active", true).single();
    if (groupError || !group) throw new HttpError(404, "Grupo do WhatsApp não encontrado.");

    const payload = {
      auction_id: auctionId,
      group_id: groupId,
      scheduled_at: new Date(scheduledAt).toISOString(),
      poll_title: title,
      poll_options: options,
      status: "scheduled",
      locked_at: null,
      locked_by: null,
      attempts: 0,
      last_error: null,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("whatsapp_dispatches").upsert(payload, { onConflict: "auction_id" }).select().single();
    if (error || !data) throw new Error("whatsapp_schedule_write_failed");
    return Response.json({ dispatch: data });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { db } = await authorize(request, true);
    const body = await request.json() as Record<string, unknown>;
    const auctionId = String(body.auctionId ?? "");
    if (!uuid.test(auctionId)) throw new HttpError(400, "Leilão inválido.");
    const { data: current } = await db.from("whatsapp_dispatches").select("status").eq("auction_id", auctionId).maybeSingle();
    if (!current) throw new HttpError(404, "Agendamento não encontrado.");
    if (["sending", "sent"].includes(current.status)) throw new HttpError(409, "Este disparo já está em processamento ou foi enviado.");
    const { error } = await db.from("whatsapp_dispatches").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("auction_id", auctionId);
    if (error) throw new Error("whatsapp_schedule_cancel_failed");
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
