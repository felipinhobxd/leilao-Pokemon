import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { syncParticipatingGroups } from "./groups.mjs";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Variável obrigatória ausente: ${key}`);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sessionDir = process.env.WHATSAPP_SESSION_DIR || "./sessao";
const logger = pino({ level: "silent" });
const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

let settled = false;
let timeout;
const finish = async (error, sock) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  try { sock?.end(error ? error : new Error("group_sync_complete")); } catch {}
  if (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
};

const sock = makeWASocket({
  auth: state,
  logger,
  markOnlineOnConnect: false,
  syncFullHistory: false,
});

sock.ev.on("creds.update", saveCreds);
sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
  if (settled) return;
  if (qr) {
    await finish(new Error("A sessão precisa de QR antes de sincronizar grupos."), sock);
    return;
  }
  if (connection === "open") {
    try {
      const result = await syncParticipatingGroups(sock, db);
      console.log(`Grupos sincronizados: ${result.count}`);
      console.log(`Sincronização concluída em ${result.syncedAt}`);
      await finish(null, sock);
    } catch (error) {
      await finish(error, sock);
    }
    return;
  }
  if (connection === "close") {
    const code = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.data?.reason;
    if (code === DisconnectReason.loggedOut) await finish(new Error("Sessão do WhatsApp desconectada."), sock);
  }
});

// 90s (era 30s): em 2 boots reais (2026-09-24) o socket descartável precisou
// de mais de 30s para abrir+syncar logo após o kill do bot principal (o
// servidor leva instantes para liberar a conexão anterior da mesma sessão) —
// a tentativa seguinte sincronizou ("Grupos sincronizados: 13"). O bound
// continua existindo: sync travada de verdade ainda é morta em 90s.
timeout = setTimeout(() => {
  void finish(new Error("Tempo esgotado ao sincronizar grupos."), sock);
}, 90_000);
