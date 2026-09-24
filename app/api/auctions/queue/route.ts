import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readQueue(db: Awaited<ReturnType<typeof authorize>>["db"], queueId: string) {
  const { data: queue, error: queueError } = await db.from("auction_publish_queues").select("*").eq("id", queueId).maybeSingle();
  if (queueError) throw new Error("queue_read_failed");
  if (!queue) throw new HttpError(404, "Fila não encontrada.");

  const [{ data: group, error: groupError }, { data: dispatches, error: dispatchError }, { data: quickPolls, error: pollsError }] = await Promise.all([
    db.from("whatsapp_groups").select("id,name,group_jid").eq("id", queue.group_id).maybeSingle(),
    db.from("whatsapp_dispatches").select("id,auction_id,status,scheduled_at,sent_at,attempts,last_error,queue_position,announcement_sent_at,poll_sent_at").eq("queue_id", queueId).order("queue_position"),
    db.from("whatsapp_quick_polls").select("id,title,image_url,scheduled_at,sent_at,poll_message_id,queue_position").eq("queue_id", queueId).order("queue_position"),
  ]);
  if (groupError || dispatchError || pollsError) throw new Error("queue_read_failed");

  const auctionIds = (dispatches ?? []).map(row => row.auction_id);
  const { data: auctions, error: auctionError } = auctionIds.length
    ? await db.from("auctions").select("id,card_id,lot_number,status,scheduled_end_at,winner_participant_id,final_price,win_type").in("id", auctionIds)
    : { data: [], error: null };
  if (auctionError) throw new Error("queue_read_failed");
  const cardIds = (auctions ?? []).map(row => row.card_id);
  const { data: cards, error: cardError } = cardIds.length
    ? await db.from("cards").select("id,name,image_url,collection,card_number").in("id", cardIds)
    : { data: [], error: null };
  if (cardError) throw new Error("queue_read_failed");

  const items = [
    ...(dispatches ?? []).map(dispatch => {
      const auction = (auctions ?? []).find(row => row.id === dispatch.auction_id) ?? null;
      const card = auction ? (cards ?? []).find(row => row.id === auction.card_id) ?? null : null;
      return { dispatch, auction, card, poll: null };
    }),
    // Brindes da fila: sem dispatch (exige auction_id) — entram na lista na
    // própria posição, entre os leilões.
    ...(quickPolls ?? []).map(poll => ({ dispatch: null, auction: null, card: null, poll })),
  ].sort((a, b) => {
    const pa = a.dispatch?.queue_position ?? a.poll?.queue_position ?? 0;
    const pb = b.dispatch?.queue_position ?? b.poll?.queue_position ?? 0;
    return pa - pb;
  });
  const published = items.filter(item => item.dispatch?.status === "sent" || item.poll?.sent_at).length;
  const failed = items.filter(item => item.dispatch?.status === "failed").length;
  const pending = items.filter(item => item.dispatch ? ["scheduled", "sending"].includes(item.dispatch.status) : !item.poll?.sent_at).length;
  const next = items.find(item => item.dispatch ? item.dispatch.status === "scheduled" : !item.poll?.sent_at) ?? null;
  return { queue, group, items, summary: { total: items.length, published, failed, pending, nextScheduledAt: next?.dispatch?.scheduled_at ?? next?.poll?.scheduled_at ?? null } };
}

export async function GET(request: Request) {
  try {
    const { db, user } = await authorize(request);
    const params = new URL(request.url).searchParams;
    let queueId = params.get("queueId") ?? "";
    if (!queueId && params.get("latest") === "1") {
      const { data, error } = await db.from("auction_publish_queues")
        .select("id")
        .eq("created_by", user.id)
        .in("status", ["scheduled", "running", "paused"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("queue_read_failed");
      if (!data?.id) return Response.json({ queue: null }, { status: 200, headers: { "Cache-Control": "no-store" } });
      queueId = data.id;
    }
    if (!uuid.test(queueId)) throw new HttpError(400, "Fila inválida.");
    return Response.json(await readQueue(db, queueId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, unknown>;
    const queueId = String(body.queueId ?? "");
    const action = String(body.action ?? "");
    if (!uuid.test(queueId)) throw new HttpError(400, "Fila inválida.");
    if (!new Set(["pause", "resume", "cancel"]).has(action)) throw new HttpError(400, "Ação inválida.");
    const { error } = await db.rpc("control_auction_publish_queue", { p_queue_id: queueId, p_action: action, p_admin_user_id: user.id });
    if (error) {
      const message = String(error.message ?? "");
      if (/queue_not_found/i.test(message)) throw new HttpError(404, "Fila não encontrada.");
      if (/queue_not_pauseable/i.test(message)) throw new HttpError(409, "Essa fila não pode ser pausada agora.");
      if (/queue_not_resumable/i.test(message)) throw new HttpError(409, "Essa fila não está pausada.");
      if (/queue_not_cancellable/i.test(message)) throw new HttpError(409, "Essa fila já terminou ou foi cancelada.");
      throw new Error("queue_control_failed");
    }
    return Response.json(await readQueue(db, queueId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
