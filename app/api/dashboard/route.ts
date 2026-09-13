import { authorize, failure, snapshot } from "@/lib/backend";

export const runtime = "nodejs";

function isFresh(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const value = Date.parse(heartbeat);
  return Number.isFinite(value) && Date.now() - value <= 35_000;
}

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const authStarted = performance.now();
    const { db, profile, timing } = await authorize(request);
    const authorizeMs = performance.now() - authStarted;
    const queryStarted = performance.now();
    const [data, workerResult, groupResult] = await Promise.all([
      snapshot(db),
      db.from("whatsapp_bot_workers")
        .select("worker_id,status,heartbeat_at,version")
        .order("heartbeat_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      db.from("whatsapp_groups")
        .select("id,name,is_default")
        .eq("active", true)
        .eq("is_default", true)
        .maybeSingle(),
    ]);
    if (workerResult.error || groupResult.error) throw new Error("dashboard_operations_read_failed");
    const queryMs = performance.now() - queryStarted;
    const worker = workerResult.data;
    const online = Boolean(worker && isFresh(worker.heartbeat_at));
    const totalMs = performance.now() - started;
    return Response.json({
      data,
      role: profile.role,
      operations: {
        bot: worker ? {
          workerId: worker.worker_id,
          status: worker.status,
          heartbeatAt: worker.heartbeat_at,
          online,
          connected: online && worker.status === "connected",
          version: worker.version,
        } : null,
        group: groupResult.data ? { id: groupResult.data.id, name: groupResult.data.name } : null,
      },
    }, { headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": [
        `claims;dur=${timing.claimsMs.toFixed(1)}`,
        `profile;dur=${timing.profileMs.toFixed(1)}`,
        `authorize;dur=${authorizeMs.toFixed(1)}`,
        `queries;dur=${queryMs.toFixed(1)}`,
        `total;dur=${totalMs.toFixed(1)}`,
      ].join(", "),
    } });
  } catch (error) { return failure(error); }
}
