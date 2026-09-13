import type { createServerSupabaseClient } from "./supabase-server";

function isOnline(heartbeat: unknown) {
  if (typeof heartbeat !== "string") return false;
  const time = Date.parse(heartbeat);
  return Number.isFinite(time) && Date.now() - time <= 35_000;
}


export async function readBotStatus(db: ReturnType<typeof createServerSupabaseClient>, profile: { role: string }) {
    const { data: worker, error } = await db
      .from("whatsapp_bot_workers")
      .select("worker_id,status,heartbeat_at,connected_at,account_jid,last_error,qr_render,qr_expires_at,groups_synced_at,version,session_active,updated_at")
      .order("heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("whatsapp_bot_status_read_failed");

    const canControl = ["admin", "operator"].includes(profile.role);
    const qrValid = canControl
      && isOnline(worker?.heartbeat_at)
      && worker?.status === "waiting_qr"
      && worker?.qr_render
      && worker?.qr_expires_at
      && Date.parse(worker.qr_expires_at) > Date.now();

    return {
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
    };
}
