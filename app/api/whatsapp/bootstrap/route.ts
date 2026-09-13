import { authorize, failure } from "@/lib/backend";

export const runtime = "nodejs";

function isOnline(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const time = Date.parse(heartbeat);
  return Number.isFinite(time) && Date.now() - time <= 35_000;
}

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const authStarted = performance.now();
    const { db, profile } = await authorize(request);
    const authMs = performance.now() - authStarted;
    const queryStarted = performance.now();

    const [workerResult, groupsResult, auctionsResult, dispatchesResult] = await Promise.all([
      db.from("whatsapp_bot_workers")
        .select("worker_id,status,heartbeat_at,connected_at,account_jid,last_error,qr_render,qr_expires_at,groups_synced_at,version,session_active,updated_at")
        .order("heartbeat_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      db.from("whatsapp_groups")
        .select("id,name,group_jid,active,is_default,last_synced_at,updated_at")
        .eq("active", true)
        .order("name"),
      db.from("auctions")
        .select("id,card_id,status,lot_number,starting_price,bid_increment,buyout_price,scheduled_end_at,created_at,cards(id,name,card_number,image_url,condition,language)")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(50),
      db.from("whatsapp_dispatches")
        .select("id,auction_id,group_id,scheduled_at,status,announcement_sent_at,poll_sent_at,sent_at,attempts,last_error,updated_at")
        .order("scheduled_at", { ascending: false })
        .limit(25),
    ]);

    if (workerResult.error || groupsResult.error || auctionsResult.error || dispatchesResult.error) {
      throw new Error("whatsapp_bootstrap_read_failed");
    }

    const queryMs = performance.now() - queryStarted;
    const worker = workerResult.data;
    const canControl = ["admin", "operator"].includes(profile.role);
    const online = Boolean(worker && isOnline(worker.heartbeat_at));
    const qrValid = Boolean(canControl && worker?.qr_render && worker?.qr_expires_at && Date.parse(worker.qr_expires_at) > Date.now());
    const groups = groupsResult.data ?? [];
    const draftAuctions = auctionsResult.data ?? [];
    const cards = draftAuctions
      .map(row => row.cards)
      .flat()
      .filter((card, index, all) => card && all.findIndex(other => other?.id === card.id) === index);

    const totalMs = performance.now() - started;
    return Response.json({
      botStatus: {
        worker: worker ? {
          workerId: worker.worker_id,
          status: worker.status,
          heartbeatAt: worker.heartbeat_at,
          connectedAt: worker.connected_at,
          accountJid: worker.account_jid,
          lastError: worker.last_error,
          qrText: qrValid ? worker.qr_render : null,
          qrExpiresAt: qrValid ? worker.qr_expires_at : null,
          groupsSyncedAt: worker.groups_synced_at,
          version: worker.version,
          sessionActive: worker.session_active,
        } : null,
        online,
        canControl,
      },
      groups,
      defaultGroupId: groups.find(group => group.is_default)?.id ?? null,
      draftAuctions,
      cards,
      dispatches: dispatchesResult.data ?? [],
    }, {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `authorize;dur=${authMs.toFixed(1)}, queries;dur=${queryMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
