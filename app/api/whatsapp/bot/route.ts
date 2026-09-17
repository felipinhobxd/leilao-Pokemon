import { readBotStatus } from "@/lib/whatsapp-status";
import { authorize, failure, HttpError } from "@/lib/backend";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const actions = ["reconnect", "disconnect", "sync_groups"] as const;
type BotAction = typeof actions[number];

function isOnline(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const time = Date.parse(heartbeat);
  return Number.isFinite(time) && Date.now() - time <= 35_000;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

function getDb() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function enqueueDispatch(auctionId: string, userId: string) {
  const { Queue } = await import("bullmq");
  const db = getDb();
  
  const connection = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
  };

  const queue = new Queue("whatsapp-dispatches", { connection });

  const { data: dispatch, error: dispatchError } = await db
    .from("whatsapp_dispatches")
    .select("*")
    .eq("auction_id", auctionId)
    .in("status", ["pending", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dispatchError || !dispatch) {
    throw new Error("dispatch_not_found");
  }

  await queue.add("send-dispatch", { dispatch, userId }, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });

  await queue.close();

  return dispatch;
}

export async function GET(request: Request) {
  try {
    const { db, profile } = await authorize(request);
    return Response.json(await readBotStatus(db, profile), { headers: { "Cache-Control": "no-store" } });
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

    const { data: existing, error: existingError } = await db
      .from("whatsapp_bot_commands")
      .select("id,status")
      .eq("worker_id", worker.worker_id)
      .eq("command", action)
      .in("status", ["pending", "running"])
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error("whatsapp_bot_command_read_failed");
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
