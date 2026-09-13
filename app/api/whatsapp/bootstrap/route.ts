import { Timing } from "@/lib/timing";
import { authorize, failure } from "@/lib/backend";
import { readBotStatus } from "@/lib/whatsapp-status";

export const runtime = "nodejs";

// The central page only renders status, groups and 25 recent dispatches.
// Do not load auction snapshots, cards or poll payloads that it does not use.
export async function GET(request: Request) {
  const timing = new Timing();
  try {
    const { db, profile } = await timing.measure("authorize", () => authorize(request, false, timing));
    const [botStatus, groups, dispatches] = await Promise.all([
      readBotStatus(db, profile),
      db.from("whatsapp_groups").select("id,name,group_jid,is_default,last_synced_at").eq("active", true).order("name"),
      db.from("whatsapp_dispatches").select("id,auction_id,group_id,scheduled_at,status,announcement_sent_at,poll_sent_at,sent_at,attempts,last_error").order("scheduled_at", { ascending: false }).limit(25),
    ]);
    if (groups.error || dispatches.error) throw new Error("whatsapp_bootstrap_read_failed");
    return Response.json({ botStatus, groups: groups.data ?? [], dispatches: dispatches.data ?? [] }, { headers: timing.headers() });
  } catch (error) { return failure(error); }
}
