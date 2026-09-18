// Fila persistente de disparos (BullMQ + Redis) para o envio via Baileys.
//
// CONTRATO (Fase 3 — estabilidade do bot):
// - O Supabase (`whatsapp_dispatches`) continua sendo a FONTE DA VERDADE:
//   claim/attempts/status/erros vivem lá, auditáveis pelo painel.
// - O Redis/BullMQ é a CAMADA DE TRANSPORTE: o job sobrevive a quedas de
//   socket E a reinícios do processo, e é retentado com backoff exponencial
//   (5s -> 60s) até o WhatsApp reconectar. Enquanto o socket está down o
//   job NÃO gasta as 5 tentativas do SQL — ele apenas espera.
// - Sem REDIS_URL configurada o bot usa o caminho direto (sendDispatch
//   inline) — degradação graciosa, zero mudança de comportamento.
// - O processor é idempotente por desenho: re-lê o dispatch do Supabase e
//   pula linhas já `sent`/`cancelled`/`failed` (o sendDispatch também é
//   idempotente por etapa: announcement_sent_at / poll_sent_at).
// - session-guard.mjs + connect() continuam sendo os ÚNICOS donos da
//   reconexão do Baileys; esta fila nunca toca no socket.
//
// Erros:
// - socket down / falha transitória  -> retentável (backoff);
// - erros de dados (grupo indisponível, leilão não publicável, opções
//   inválidas, carta sumiu) -> IRRECUPERÁVEIS: marcado failed no Supabase
//   na hora, sem queimar retries.
import { Queue, Worker } from "bullmq";

export const DISPATCH_QUEUE_NAME = "whatsapp-dispatch";
// 25 tentativas com backoff 5s..60s ≈ 23 min de paciência total — mais que
// o suficiente para atravessar qualquer reconexão do Baileys sem deixar o
// lote preso para sempre.
export const MAX_JOB_ATTEMPTS = 25;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;

// Erros que retry nenhum resolve: o lote em si está inválido. O texto é o
// `message` das exceções lançadas pelo sendDispatch.
const UNRECOVERABLE_ERROR_MARKERS = [
  "whatsapp_group_unavailable",
  "auction_not_found",
  "auction_not_publishable",
  "invalid_poll_options",
  "card_not_found",
];

export function queueEnabled() {
  return Boolean(String(process.env.REDIS_URL || "").trim());
}

export function redisOptions(rawUrl = process.env.REDIS_URL || "") {
  const parsed = new URL(rawUrl);
  const options = {
    host: parsed.hostname || "127.0.0.1",
    port: Number(parsed.port || 6379),
    // Exigido pelo BullMQ: sem isso o iorednis aborta comandos bloqueantes
    // após o padrão de 20 retries e o Worker morre em silêncio.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (parsed.username) options.username = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === "rediss:") options.tls = {};
  return options;
}

export function buildBackoffMs(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_CAP_MS);
}

export class SocketDownError extends Error {
  constructor() {
    super("socket_whatsapp_down");
    this.name = "SocketDownError";
  }
}

export function isUnrecoverableDispatchError(error) {
  const message = String(error?.message || error);
  return UNRECOVERABLE_ERROR_MARKERS.some(marker => message.includes(marker));
}

/**
 * Processor puro de um job de disparo (testável sem Redis).
 *
 * deps: { fetchDispatch, isSocketReady, send, markFailed, log }
 * - fetchDispatch(id)       -> linha atual de whatsapp_dispatches (ou null);
 * - isSocketReady()          -> bool (socket Baileys conectado);
 * - send(dispatch)           -> sendDispatch existente (idempotente por etapa);
 * - markFailed(dispatch, err)-> status='failed' + last_error no Supabase.
 */
export async function processDispatchJob(job, deps) {
  const { fetchDispatch, isSocketReady, send, markFailed, log = () => {} } = deps;
  const dispatchId = job?.data?.dispatchId;
  if (!dispatchId) return;
  const dispatch = await fetchDispatch(dispatchId);
  if (!dispatch || ["sent", "cancelled", "failed"].includes(dispatch.status)) {
    // Idempotência: o SQL é a verdade. Um lote já concluído (por outro
    // worker, por re-claim após lock stale, ou por execução anterior do
    // job após reinício) nunca é reenviado.
    return;
  }
  if (!isSocketReady()) {
    log(`[queue] lote ${dispatchId}: aguardando reconexão do WhatsApp…`);
    throw new SocketDownError();
  }
  try {
    await send(dispatch);
  } catch (error) {
    const message = String(error?.message || error);
    const attempts = Number(job.opts?.attempts) || MAX_JOB_ATTEMPTS;
    const lastAttempt = Number(job.attemptsMade || 0) + 1 >= attempts;
    if (isUnrecoverableDispatchError(error)) {
      log(`[queue] lote ${dispatchId} IRRECUPERÁVEL (${message}) — marcando failed`);
      await markFailed(dispatch, error);
      return;
    }
    if (lastAttempt) {
      log(`[queue] lote ${dispatchId} esgotou as ${attempts} tentativas — marcando failed`);
      try {
        const fresh = await fetchDispatch(dispatchId);
        if (fresh && !["sent", "cancelled", "failed"].includes(fresh.status)) {
          await markFailed(fresh, error);
        }
      } catch { /* a intenção de marcar é melhor-esforço: o SQL mantém attempts/last_error */ }
      throw error;
    }
    log(`[queue] lote ${dispatchId}: falha transitória (${message}) — retentativa com backoff`);
    throw error;
  }
}

/**
 * Sobe a fila + o worker quando REDIS_URL está configurada; senão retorna
 * null (o caller usa o caminho direto). O worker roda NO PROCESSO DO BOT:
 * só ele tem o socket Baileys. Concurrency 1 preserva a ordem dos lotes.
 */
export function startQueueWorker(deps) {
  const { log = () => {} } = deps;
  if (!queueEnabled()) return null;
  const connection = redisOptions();
  // Estratégia custom registrada no Queue/Worker (exigência do BullMQ 6:
  // o job referencia por `type` — função direta no job NÃO é chamada) com
  // CAP de 60s: o "exponential" nativo cresce sem teto (5s*2^24 na 25ª
  // tentativa ≈ 23 dias — inaceitável).
  const backoffStrategy = attemptsMade => buildBackoffMs(attemptsMade);
  const settings = { backoffStrategy };
  const queue = new Queue(DISPATCH_QUEUE_NAME, { connection, settings });
  const worker = new Worker(DISPATCH_QUEUE_NAME, job => processDispatchJob(job, deps), {
    connection,
    concurrency: 1,
    autorun: true,
    settings,
  });
  worker.on("error", error => log(`[queue] erro do worker: ${error?.message || error}`));
  worker.on("failed", (job, error) => {
    if (error?.name === "SocketDownError" && job) {
      log(`[queue] lote ${job.data?.dispatchId} retido até a reconexão (tentativa ${job.attemptsMade})`);
    }
  });

  const enqueue = async dispatch => {
    if (!dispatch?.id) throw new Error("dispatch_id_missing");
    try {
      await queue.add("dispatch", { dispatchId: dispatch.id }, {
        jobId: `dispatch-${dispatch.id}`,
        attempts: MAX_JOB_ATTEMPTS,
        backoff: { type: "capped-exponential", delay: BACKOFF_BASE_MS },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      return true;
    } catch (error) {
      // jobId duplicado = o lote já está na fila (re-claim após lock stale):
      // exatamente o resultado desejado, não é erro.
      if (/already exist/i.test(String(error?.message || error))) return true;
      throw error;
    }
  };
  const close = async () => {
    try { await worker.close(); } catch { /* melhor-esforço no shutdown */ }
    try { await queue.close(); } catch { /* idem */ }
  };
  return { queue, worker, enqueue, close, name: DISPATCH_QUEUE_NAME };
}
