import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const actions = ["reconnect", "disconnect", "sync_groups"] as const;
type BotAction = typeof actions[number];

function isOnline(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const time = Date.parse(heartbeat);
  return Number.isFinite(time) && Date.now() - time <= 35_000;
}

export async function GET(request: Request) {
  try {
    const { db, profile } = await authorize(request);
    const { data: worker, error } = await db
      .from("whatsapp_bot_workers")
      .select("worker_id,status,heartbeat_at,connected_at,account_jid,last_error,qr_render,qr_expires_at,groups_synced_at,version,session_active,updated_at")
      .order("heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("whatsapp_bot_status_read_failed");

    const canControl = ["admin", "operator"].includes(profile.role);
    const qrValid = canControl
      && worker?.qr_render
      && worker?.qr_expires_at
      && Date.parse(worker.qr_expires_at) > Date.now();

    return Response.json({
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
      online: Boolean(worker && isOnline(worker.heartbeat_at)),
      canControl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) {
      throw new HttpError(415, "Envie JSON.");
    }
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "") as BotAction;
    if (!actions.includes(action)) throw new HttpError(400, "Comando do bot inválido.");

    let query = db
      .from("whatsapp_bot_workers")
      .select("worker_id,heartbeat_at,status")
      .order("heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const requestedWorker = typeof body.workerId === "string" ? body.workerId.trim() : "";
    if (requestedWorker) {
      if (requestedWorker.length > 200) throw new HttpError(400, "Worker inválido.");
      query = db.from("whatsapp_bot_workers").select("worker_id,heartbeat_at,status").eq("worker_id", requestedWorker).limit(1);
    }
    const { data: workers, error: workerError } = await query;
    if (workerError) throw new Error("whatsapp_bot_worker_read_failed");
    const worker = workers?.[0];
    if (!worker) throw new HttpError(404, "Nenhum worker do WhatsApp foi instalado ainda.");
    if (!isOnline(worker.heartbeat_at)) {
      throw new HttpError(409, "O PC/worker está offline. O painel não consegue iniciar um computador desligado.");
    }
    if (action === "sync_groups" && worker.status !== "connected") {
      throw new HttpError(409, "Conecte o WhatsApp antes de atualizar os grupos.");
    }

    const { data: existing } = await db
      .from("whatsapp_bot_commands")
      .select("id,status")
      .eq("worker_id", worker.worker_id)
      .eq("command", action)
      .in("status", ["pending", "running"])
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return Response.json({ command: existing, queued: false });

    const { data: command, error } = await db.from("whatsapp_bot_commands").insert({
      worker_id: worker.worker_id,
      command: action,
      requested_by: user.id,
    }).select("id,worker_id,command,status,requested_at").single();
    if (error || !command) throw new Error("whatsapp_bot_command_write_failed");
    return Response.json({ command, queued: true }, { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
