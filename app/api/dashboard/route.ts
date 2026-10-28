import { readDashboardOperations } from '@/lib/dashboard-operations';
import { Timing } from "@/lib/timing";
import { authorize, failure, snapshot, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

function isFresh(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const value = Date.parse(heartbeat);
  return Number.isFinite(value) && Date.now() - value <= 35_000;
}


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
    const [data, liveResult, operationData] = await Promise.all([
      operationsOnly ? null : timing.measure("read_dashboard_snapshot", () => snapshot(db, true)),
      operationsOnly ? null : db.rpc("read_dashboard_auction", { p_auction_id: auctionId }),
      timing.measure("read_dashboard_operations", () => readDashboardOperations(db, windowStart)),
    ]);
    if (liveResult?.error) throw new Error("dashboard_operations_read_failed");
    const { counts, worker, group } = operationData;
    const liveAuction=liveResult?.data ?? null;
    if(data){
      data.bids=[]; // Selected live state replaces the global history slice.
      if(Array.isArray(liveAuction?.purchases))data.purchases=liveAuction.purchases;
      data.payments=[]; // Each purchase already carries its authoritative paid state.
    }
    if(liveAuction)delete liveAuction.purchases; // Send the purchase list only once.
    const online = Boolean(worker && isFresh(worker.heartbeat_at));
    const terminal = counts.sent + counts.failed;
    return Response.json({
      ...(data ? { data, liveAuction } : {}),
      role: profile.role,
      operations: {
        bot: worker ? { workerId: worker.worker_id, status: worker.status, online, connected: online && worker.status === "connected", version: worker.version } : null,
        group: group ? { id: group.id, name: group.name } : null,
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
