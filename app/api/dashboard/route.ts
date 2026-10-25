import { Timing } from "@/lib/timing";
import { authorize, failure, snapshot, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

function isFresh(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const value = Date.parse(heartbeat);
  return Number.isFinite(value) && Date.now() - value <= 35_000;
}

const DISPATCH_STATUSES = ["sent", "failed", "scheduled", "sending", "cancelled"] as const;

export async function GET(request: Request) {
  const timing = new Timing();
  try {
    const { db, profile } = await timing.measure("authorize", () => authorize(request, false, timing));
    const params = new URL(request.url).searchParams;
    const operationsOnly = params.get("scope") === "operations";
    const auctionId = params.get("auction");
    if (auctionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auctionId)) throw new HttpError(400, "Leilão inválido.");
    // Janela de envios exibida no painel: últimas 24 horas.
    const DISPATCH_WINDOW_DAYS = 1;
    const windowStart = new Date(Date.now() - DISPATCH_WINDOW_DAYS * 86_400_000).toISOString();
    const [data, liveResult, workerResult, groupResult, ...countResults] = await Promise.all([
      operationsOnly ? null : timing.measure("read_dashboard_snapshot", () => snapshot(db, true)),
      operationsOnly ? null : db.rpc("read_dashboard_auction", { p_auction_id: auctionId }),
      db.from("whatsapp_bot_workers").select("worker_id,status,heartbeat_at,version").order("heartbeat_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      db.from("whatsapp_groups").select("id,name,is_default").eq("active", true).eq("is_default", true).maybeSingle(),
      // dispatch_success_rate (24h): a tabela de disparos é a fonte da verdade —
      // `sent` vs `failed` reais, nada estimado pela fila de transporte.
      // COUNT per status via head:true (PostgREST count only, no rows over
      // the wire): the old unbounded SELECT returned every dispatch row
      // updated in 7 days just to count 5 statuses in JS, on every poll.
      ...DISPATCH_STATUSES.map(status =>
        db.from("whatsapp_dispatches").select("status", { count: "exact", head: true })
          .eq("status", status).gte("updated_at", windowStart)),
    ]);
    if (liveResult?.error || workerResult.error || groupResult.error) throw new Error("dashboard_operations_read_failed");
    const counts: Record<(typeof DISPATCH_STATUSES)[number], number> = { sent: 0, failed: 0, scheduled: 0, sending: 0, cancelled: 0 };
    DISPATCH_STATUSES.forEach((status, index) => {
      const result = countResults[index] as { count: number | null; error: unknown };
      if (result.error) throw new Error("dashboard_operations_read_failed");
      counts[status] = result.count ?? 0;
    });
    const liveAuction=liveResult?.data ?? null;
    if(data){
      data.bids=[]; // Selected live state replaces the global history slice.
      if(Array.isArray(liveAuction?.purchases))data.purchases=liveAuction.purchases;
      data.payments=[]; // Each purchase already carries its authoritative paid state.
    }
    if(liveAuction)delete liveAuction.purchases; // Send the purchase list only once.
    const worker = workerResult.data;
    const online = Boolean(worker && isFresh(worker.heartbeat_at));
    const terminal = counts.sent + counts.failed;
    return Response.json({
      ...(data ? { data, liveAuction } : {}),
      role: profile.role,
      operations: {
        bot: worker ? { workerId: worker.worker_id, status: worker.status, online, connected: online && worker.status === "connected", version: worker.version } : null,
        group: groupResult.data ? { id: groupResult.data.id, name: groupResult.data.name } : null,
        dispatches: {
          successRate: terminal > 0 ? counts.sent / terminal : null,
          sent: counts.sent,
          failed: counts.failed,
          pending: counts.scheduled + counts.sending,
          windowDays: DISPATCH_WINDOW_DAYS,
        },
      },
    }, { headers: timing.headers() });
  } catch (error) { return failure(error); }
}
