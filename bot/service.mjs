import "./session-guard.mjs";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BOT_ADMIN_USER_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Variável obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ID = process.env.BOT_WORKER_ID || `bot-${process.pid}`;
const SESSION_DIR = path.resolve(here, process.env.WHATSAPP_SESSION_DIR || "./sessao");
const HEARTBEAT_MS = Math.min(15_000, Math.max(10_000, Number(process.env.BOT_HEARTBEAT_SECONDS || 12) * 1000));
const QR_TTL_MS = Math.min(180_000, Math.max(45_000, Number(process.env.BOT_QR_TTL_SECONDS || 90) * 1000));
const AUTO_GROUP_SYNC_MAX_AGE_MS = 5 * 60_000;
const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const BOT_VERSION = String(packageJson.version || "0.0.0");

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let child = null;
let desiredRunning = true;
let shuttingDown = false;
let restartTimer = null;
let heartbeatTimer = null;
let commandTimer = null;
let commandBusy = false;
let publishBusy = false;
let automaticSyncBusy = false;
let lastAutomaticSyncAttempt = 0;

const runtime = {
  status: "starting",
  connectedAt: null,
  accountJid: null,
  lastError: null,
  qrPayload: null,
  qrRender: null,
  qrExpiresAt: null,
  groupsSyncedAt: null,
  sessionActive: false,
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readSessionInfo() {
  try {
    const raw = await readFile(path.join(SESSION_DIR, "creds.json"), "utf8");
    const creds = JSON.parse(raw);
    return {
      sessionActive: Boolean(creds?.registered),
      accountJid: creds?.me?.id ? String(creds.me.id) : null,
    };
  } catch {
    return { sessionActive: false, accountJid: null };
  }
}

function clearExpiredQr() {
  if (runtime.qrExpiresAt && Date.parse(runtime.qrExpiresAt) <= Date.now()) {
    runtime.qrPayload = null;
    runtime.qrRender = null;
    runtime.qrExpiresAt = null;
  }
}

async function publishState(patch = {}) {
  Object.assign(runtime, patch);
  clearExpiredQr();
  if (publishBusy) return;
  publishBusy = true;
  try {
    const session = await readSessionInfo();
    runtime.sessionActive = session.sessionActive;
    if (session.accountJid) runtime.accountJid = session.accountJid;
    const now = new Date().toISOString();
    const { error } = await db.from("whatsapp_bot_workers").upsert({
      worker_id: WORKER_ID,
      status: runtime.status,
      heartbeat_at: now,
      connected_at: runtime.connectedAt,
      account_jid: runtime.accountJid,
      last_error: runtime.lastError,
      qr_payload: runtime.qrPayload,
      qr_render: runtime.qrRender,
      qr_expires_at: runtime.qrExpiresAt,
      groups_synced_at: runtime.groupsSyncedAt,
      version: BOT_VERSION,
      session_active: runtime.sessionActive,
      updated_at: now,
    }, { onConflict: "worker_id" });
    if (error) console.error("Falha ao publicar status do bot:", error.message);
  } catch (error) {
    console.error("Falha ao publicar status do bot:", error?.message || error);
  } finally {
    publishBusy = false;
  }
}

async function loadPreviousWorkerState() {
  const { data } = await db.from("whatsapp_bot_workers")
    .select("groups_synced_at,account_jid")
    .eq("worker_id", WORKER_ID)
    .maybeSingle();
  if (data?.groups_synced_at) runtime.groupsSyncedAt = data.groups_synced_at;
  if (data?.account_jid) runtime.accountJid = data.account_jid;
}

function decodeQrMarker(line) {
  const marker = "__LEILAO_QR__";
  if (!line.startsWith(marker)) return false;
  const body = line.slice(marker.length);
  const separator = body.indexOf(":");
  if (separator < 1) return true;
  try {
    runtime.qrPayload = Buffer.from(body.slice(0, separator), "base64url").toString("utf8");
    runtime.qrRender = Buffer.from(body.slice(separator + 1), "base64url").toString("utf8");
    runtime.qrExpiresAt = new Date(Date.now() + QR_TTL_MS).toISOString();
    runtime.status = "waiting_qr";
    runtime.lastError = null;
    void publishState();
    console.log("QR temporário publicado no painel administrativo.");
  } catch (error) {
    runtime.lastError = `qr_decode_failed: ${error?.message || error}`;
    void publishState({ status: "error" });
  }
  return true;
}

function groupsSyncIsFresh() {
  if (!runtime.groupsSyncedAt) return false;
  const time = Date.parse(runtime.groupsSyncedAt);
  return Number.isFinite(time) && Date.now() - time < AUTO_GROUP_SYNC_MAX_AGE_MS;
}

function handleChildLine(line, isError = false) {
  if (!line) return;
  if (!isError && decodeQrMarker(line)) return;

  if (line.includes("✅ WhatsApp conectado")) {
    runtime.status = "connected";
    runtime.connectedAt = new Date().toISOString();
    runtime.lastError = null;
    runtime.qrPayload = null;
    runtime.qrRender = null;
    runtime.qrExpiresAt = null;
    void publishState();
    if (!groupsSyncIsFresh() && Date.now() - lastAutomaticSyncAttempt >= AUTO_GROUP_SYNC_MAX_AGE_MS) {
      lastAutomaticSyncAttempt = Date.now();
      setTimeout(() => void syncGroupsWithRestart(true), 750);
    }
  } else if (line.includes("Reconectando em") || line.includes("Conexão encerrada")) {
    if (desiredRunning) void publishState({ status: "reconnecting" });
  } else if (line.includes("Erro 440")) {
    runtime.lastError = line.slice(0, 1000);
    void publishState({ status: "error" });
  } else if (isError && /(erro|falha|error)/i.test(line)) {
    runtime.lastError = line.slice(0, 1000);
  }

  (isError ? console.error : console.log)(line);
}

function attachChildLogs(activeChild) {
  const stdout = readline.createInterface({ input: activeChild.stdout });
  const stderr = readline.createInterface({ input: activeChild.stderr });
  stdout.on("line", line => handleChildLine(line, false));
  stderr.on("line", line => handleChildLine(line, true));
}

function scheduleRestart() {
  if (restartTimer || !desiredRunning || shuttingDown) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startChild();
  }, 5_000);
}

async function startChild() {
  if (child || !desiredRunning || shuttingDown) return;
  runtime.status = runtime.sessionActive ? "connecting" : "starting";
  runtime.lastError = null;
  await publishState();

  const instrument = pathToFileURL(path.join(here, "instrument.mjs")).href;
  const activeChild = spawn(process.execPath, ["--import", instrument, path.join(here, "index.mjs")], {
    cwd: here,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = activeChild;
  attachChildLogs(activeChild);

  activeChild.on("error", error => {
    runtime.lastError = String(error?.message || error).slice(0, 1000);
    void publishState({ status: "error" });
  });

  activeChild.on("exit", (code, signal) => {
    if (child === activeChild) child = null;
    if (shuttingDown) return;
    if (!desiredRunning) {
      void publishState({ status: "disconnected" });
      return;
    }
    if (code === 2) {
      desiredRunning = false;
      void publishState({
        status: "error",
        lastError: "Erro 440: outra instância está usando a mesma sessão do WhatsApp. Feche a outra instância e use Reconectar.",
      });
      return;
    }
    runtime.lastError = `Processo do bot encerrou (${code ?? signal ?? "desconhecido"}). Reiniciando.`;
    void publishState({ status: "reconnecting" });
    scheduleRestart();
  });
}

async function stopChild() {
  if (!child) return;
  const activeChild = child;
  await new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    activeChild.once("exit", finish);
    try { activeChild.kill(); } catch { finish(); }
    setTimeout(() => {
      if (!done) {
        try { activeChild.kill("SIGKILL"); } catch {}
        finish();
      }
    }, 5_000);
  });
  if (child === activeChild) child = null;
}

async function claimBotCommand() {
  const { data, error } = await db.rpc("claim_whatsapp_bot_command", { p_worker_id: WORKER_ID });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function finishBotCommand(command, error = null) {
  const patch = {
    status: error ? "failed" : "completed",
    completed_at: new Date().toISOString(),
    last_error: error ? String(error?.message || error).slice(0, 1000) : null,
  };
  await db.from("whatsapp_bot_commands").update(patch).eq("id", command.id);
}

async function runGroupSync() {
  const active = spawn(process.execPath, [path.join(here, "sync-groups.mjs")], {
    cwd: here,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = chunk => {
    output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
  };
  active.stdout.on("data", collect);
  active.stderr.on("data", collect);

  const code = await Promise.race([
    new Promise(resolve => active.once("exit", resolve)),
    delay(35_000).then(() => "timeout"),
  ]);
  if (code === "timeout") {
    try { active.kill("SIGKILL"); } catch {}
    throw new Error("Tempo esgotado ao sincronizar grupos.");
  }
  if (code !== 0) throw new Error(output.trim() || `Sincronização encerrou com código ${code}.`);
  if (output.trim()) console.log(output.trim());
  runtime.groupsSyncedAt = new Date().toISOString();
}

async function syncGroupsWithRestart(automatic = false) {
  if (automatic && automaticSyncBusy) return;
  if (automatic) automaticSyncBusy = true;
  const resume = desiredRunning;
  desiredRunning = false;
  clearTimeout(restartTimer);
  restartTimer = null;
  await stopChild();
  try {
    await publishState({ status: "connecting", lastError: null });
    await runGroupSync();
    await publishState({ lastError: null });
  } catch (error) {
    runtime.lastError = String(error?.message || error).slice(0, 1000);
    await publishState({ status: "error" });
    if (!automatic) throw error;
    console.error("Falha na sincronização automática de grupos:", error?.message || error);
  } finally {
    desiredRunning = resume;
    if (automatic) automaticSyncBusy = false;
    if (resume) await startChild();
    else await publishState({ status: "disconnected" });
  }
}

async function removeWhatsAppSession() {
  const resolved = path.resolve(SESSION_DIR);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === here) throw new Error("unsafe_whatsapp_session_dir");
  try {
    await readFile(path.join(resolved, "creds.json"), "utf8");
  } catch {
    return false;
  }
  await rm(resolved, { recursive: true, force: true });
  return true;
}

async function executeBotCommand(command) {
  if (command.command === "logout") {
    desiredRunning = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    await stopChild();
    await removeWhatsAppSession();
    runtime.qrPayload = null;
    runtime.qrRender = null;
    runtime.qrExpiresAt = null;
    runtime.accountJid = null;
    runtime.connectedAt = null;
    await publishState({ status: "disconnected", lastError: null, sessionActive: false, accountJid: null });
    return;
  }

  if (command.command === "disconnect") {
    desiredRunning = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    await stopChild();
    runtime.qrPayload = null;
    runtime.qrRender = null;
    runtime.qrExpiresAt = null;
    await publishState({ status: "disconnected", lastError: null });
    return;
  }

  if (command.command === "reconnect") {
    desiredRunning = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    await stopChild();
    desiredRunning = true;
    await publishState({ status: "connecting", lastError: null });
    await startChild();
    return;
  }

  if (command.command === "sync_groups") {
    await syncGroupsWithRestart(false);
    return;
  }

  throw new Error(`Comando desconhecido: ${command.command}`);
}

async function processPendingLogout() {
  const { data, error } = await db.from("whatsapp_bot_workers")
    .select("logout_requested")
    .eq("worker_id", WORKER_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.logout_requested) return false;

  desiredRunning = false;
  clearTimeout(restartTimer);
  restartTimer = null;
  await stopChild();
  await removeWhatsAppSession();
  runtime.qrPayload = null;
  runtime.qrRender = null;
  runtime.qrExpiresAt = null;
  runtime.accountJid = null;
  runtime.connectedAt = null;
  await db.from("whatsapp_bot_workers")
    .update({ logout_requested: false })
    .eq("worker_id", WORKER_ID);
  await publishState({ status: "disconnected", lastError: null, sessionActive: false, accountJid: null });
  console.log("🔐 Logout completo solicitado pelo painel: sessão WhatsApp apagada.");
  return true;
}

async function pollBotCommands() {
  if (commandBusy || shuttingDown) return;
  commandBusy = true;
  try {
    if (await processPendingLogout()) return;
    const command = await claimBotCommand();
    if (!command) return;
    try {
      await executeBotCommand(command);
      await finishBotCommand(command);
    } catch (error) {
      runtime.lastError = String(error?.message || error).slice(0, 1000);
      await publishState({ status: desiredRunning ? runtime.status : "error" });
      await finishBotCommand(command, error);
      console.error("Falha no comando do bot:", error?.message || error);
    }
  } catch (error) {
    console.error("Falha ao consultar comandos do bot:", error?.message || error);
  } finally {
    commandBusy = false;
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  desiredRunning = false;
  clearTimeout(restartTimer);
  clearInterval(heartbeatTimer);
  clearInterval(commandTimer);
  console.log(`Encerrando supervisor (${signal})...`);
  await stopChild();
  runtime.qrPayload = null;
  runtime.qrRender = null;
  runtime.qrExpiresAt = null;
  await publishState({ status: "disconnected" });
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", error => {
  runtime.lastError = String(error?.stack || error).slice(0, 1000);
  void publishState({ status: "error" });
  console.error(error);
});
process.on("unhandledRejection", error => {
  runtime.lastError = String(error?.stack || error).slice(0, 1000);
  void publishState({ status: "error" });
  console.error(error);
});

await loadPreviousWorkerState();
await publishState({ status: "starting" });
heartbeatTimer = setInterval(() => void publishState(), HEARTBEAT_MS);
commandTimer = setInterval(() => void pollBotCommands(), 3_000);
console.log(`Supervisor iniciado. Worker: ${WORKER_ID} · versão ${BOT_VERSION}`);
await startChild();
void pollBotCommands();
