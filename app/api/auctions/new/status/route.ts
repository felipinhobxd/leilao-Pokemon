import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fresh(heartbeat: string | null | undefined) {
  if (!heartbeat) return false;
  const value = Date.parse(heartbeat);
  return Number.isFinite(value) && Date.now() - value <= 35_000;
}

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const auctionId = new URL(request.url).searchParams.get("auctionId") ?? "";
    if (!uuid.test(auctionId)) throw new HttpError(400, "Leilão inválido.");

    const [{ data: auction, error: auctionError }, { data: dispatch, error: dispatchError }, { data: worker, error: workerError }] = await Promise.all([
      db.from("auctions").select("id,card_id,lot_number,status,whatsapp_group_id,poll_id,message_id,updated_at").eq("id", auctionId).single(),
      db.from("whatsapp_dispatches").select("id,auction_id,group_id,status,scheduled_at,announcement_message_id,poll_message_id,announcement_sent_at,poll_sent_at,sent_at,attempts,last_error,updated_at").eq("auction_id", auctionId).single(),
      db.from("whatsapp_bot_workers").select("worker_id,status,heartbeat_at").order("heartbeat_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]);
    if (auctionError || !auction || dispatchError || !dispatch) throw new HttpError(404, "Publicação não encontrada.");
    if (workerError) throw new Error("worker_status_failed");

    const [{ data: card }, { data: group }] = await Promise.all([
      db.from("cards").select("name,image_url").eq("id", auction.card_id).single(),
      db.from("whatsapp_groups").select("name").eq("id", dispatch.group_id).single(),
    ]);
    const online = Boolean(worker && fresh(worker.heartbeat_at));
    const connected = Boolean(online && worker?.status === "connected");

    return Response.json({
      auction: { id: auction.id, lotNumber: auction.lot_number, status: auction.status },
      card: { name: card?.name ?? "Carta", hasImage: Boolean(card?.image_url) },
      group: { name: group?.name ?? "WhatsApp" },
      dispatch: {
        id: dispatch.id,
        status: dispatch.status,
        announcementSent: Boolean(dispatch.announcement_sent_at),
        pollSent: Boolean(dispatch.poll_sent_at),
        sentAt: dispatch.sent_at,
        attempts: dispatch.attempts,
        lastError: dispatch.last_error,
      },
      bot: { online, connected, status: worker?.status ?? "offline", workerId: worker?.worker_id ?? null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
