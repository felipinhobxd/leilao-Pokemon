// Contrato de transporte (Fase 3): esta rota APENAS ENFILEIRA comandos
// (reconnect/disconnect/sync_groups/logout) em `whatsapp_bot_commands` para o bot
// local consumir — ela NUNCA envia mensagens WhatsApp e não toca no Baileys.
// O fluxo completo de um lote é: auctions/new → `whatsapp_dispatches`
// (Supabase, fonte da verdade auditável) → fila persistente BullMQ/Redis no
// PC do bot → envio via Baileys. Se esta rota parasse de responder, nenhum
// lote é perdido — eles seguem programados no banco.
import { readBotStatus } from "@/lib/whatsapp-status";
import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const actions = ["reconnect", "disconnect", "sync_groups", "logout"] as const;
type BotAction = typeof actions[number];

function isOnline(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const time = Date.parse(heartbeat);
  return Number.isFinite(time) && Date.now() - time <= 35_000;
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
