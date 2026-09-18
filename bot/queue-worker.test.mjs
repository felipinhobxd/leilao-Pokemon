import test from "node:test";
import assert from "node:assert/strict";
import {
  SocketDownError,
  buildBackoffMs,
  isUnrecoverableDispatchError,
  processDispatchJob,
  queueEnabled,
  redisOptions,
} from "./queue-worker.mjs";

function fakeJob({ dispatchId = "d-1", attempts = 25, attemptsMade = 0 } = {}) {
  return { data: { dispatchId }, opts: { attempts }, attemptsMade };
}

function makeDeps({ dispatch, ready = true, sent = [], failed = [], logs = [], sendError = null } = {}) {
  const deps = {
    fetchDispatch: async () => dispatch,
    isSocketReady: () => ready,
    send: async d => { sent.push(d.id); if (sendError) throw sendError; },
    markFailed: async (d, error) => { failed.push({ id: d.id, error: String(error?.message || error) }); },
    log: (...args) => logs.push(args.join(" ")),
  };
  deps.sent = sent;
  deps.failed = failed;
  deps.logs = logs;
  return deps;
}

test("redisOptions parses host, port, credentials and TLS", () => {
  const plain = redisOptions("redis://127.0.0.1:6399");
  assert.equal(plain.host, "127.0.0.1");
  assert.equal(plain.port, 6399);
  assert.equal(plain.maxRetriesPerRequest, null, "BullMQ exige maxRetriesPerRequest=null");
  assert.equal(plain.tls, undefined);

  const tls = redisOptions("rediss://bot:p%40ss@redis.example.com:6380");
  assert.equal(tls.tls !== undefined, true, "rediss:// exige TLS");
  assert.equal(tls.password, "p@ss", "senha URL-decodificada");
  assert.equal(tls.port, 6380);

  const fallback = redisOptions("redis://localhost");
  assert.equal(fallback.port, 6379, "porta default");
});

test("buildBackoffMs cresce exponencialmente e trava em 60s", () => {
  assert.equal(buildBackoffMs(1), 5000);
  assert.equal(buildBackoffMs(2), 10000);
  assert.equal(buildBackoffMs(3), 20000);
  assert.equal(buildBackoffMs(5), 60000);
  assert.equal(buildBackoffMs(25), 60000, "cap de 60s nas tentativas longas");
});

test("queueEnabled depende de REDIS_URL", () => {
  const original = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  assert.equal(queueEnabled(), false);
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
  assert.equal(queueEnabled(), true);
  if (original === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = original;
});

test("erros de dados sao irrecuperaveis; socket e' retentavel", () => {
  assert.equal(isUnrecoverableDispatchError(new Error("whatsapp_group_unavailable")), true);
  assert.equal(isUnrecoverableDispatchError(new Error("auction_not_publishable")), true);
  assert.equal(isUnrecoverableDispatchError(new Error("invalid_poll_options")), true);
  assert.equal(isUnrecoverableDispatchError(new Error("card_not_found")), true);
  assert.equal(isUnrecoverableDispatchError(new Error("announcement_send_failed")), false, "falha de envio e' transitória");
  assert.equal(isUnrecoverableDispatchError(new Error("timeout")), false);
});

test("queda de socket: job espera a reconexao (retentável), lote NÃO e' perdido", async () => {
  const logs = [];
  const deps = makeDeps({
    dispatch: { id: "d-1", status: "sending" },
    ready: false,
    logs,
  });
  await assert.rejects(
    () => processDispatchJob(fakeJob(), deps),
    error => error instanceof SocketDownError,
    "socket down deve lançar SocketDownError para o BullMQ retentar com backoff",
  );
  assert.equal(deps.sent.length, 0, "nada é enviado com o socket caído");
  assert.equal(deps.failed.length, 0, "queda de socket NÃO marca o lote como failed");
  assert.ok(logs.some(l => l.includes("reconexão")), "o log deve mostrar a espera pela reconexão");
});

test("apos reconectar: o mesmo job envia o lote (reenvio automático)", async () => {
  const deps = makeDeps({ dispatch: { id: "d-1", status: "sending" }, ready: true });
  await processDispatchJob(fakeJob(), deps);
  assert.deepEqual(deps.sent, ["d-1"], "reconectado, o worker envia");
  assert.equal(deps.failed.length, 0);
});

test("lote ja concluido no SQL nunca e reenviado (idempotencia)", async () => {
  for (const status of ["sent", "cancelled", "failed"]) {
    const deps = makeDeps({ dispatch: { id: "d-1", status } });
    await processDispatchJob(fakeJob(), deps);
    assert.equal(deps.sent.length, 0, `status ${status} deve ser pulado`);
    assert.equal(deps.failed.length, 0, `status ${status} não marca nada`);
  }
});

test("dispatch sumido do SQL e' pulado em silencio", async () => {
  const deps = makeDeps({ dispatch: null });
  await processDispatchJob(fakeJob(), deps);
  assert.equal(deps.sent.length, 0);
});

test("erro irrecuperaVEL marca failed imediatamente, sem queimar retries", async () => {
  const deps = makeDeps({
    dispatch: { id: "d-1", status: "sending" },
    sendError: new Error("whatsapp_group_unavailable"),
  });
  await processDispatchJob(fakeJob(), deps);
  assert.equal(deps.sent.length, 1, "o envio foi tentado");
  assert.deepEqual(deps.failed.map(f => f.error), ["whatsapp_group_unavailable"]);
});

test("falha transitoria re-lanca para o backoff do BullMQ", async () => {
  const deps = makeDeps({
    dispatch: { id: "d-1", status: "sending" },
    sendError: new Error("announcement_send_failed"),
  });
  await assert.rejects(() => processDispatchJob(fakeJob({ attemptsMade: 0 }), deps), /announcement_send_failed/);
  assert.equal(deps.failed.length, 0, "falha transitória não marca failed");
});

test("ultima tentativa marca failed antes de encerrar o job", async () => {
  const deps = makeDeps({
    dispatch: { id: "d-1", status: "sending" },
    sendError: new Error("timeout sempre"),
  });
  await assert.rejects(() => processDispatchJob(fakeJob({ attemptsMade: 24, attempts: 25 }), deps), /timeout sempre/);
  assert.deepEqual(deps.failed.map(f => f.error), ["timeout sempre"], "tentativas esgotadas viram failed visível");
});

test("job sem dispatchId e' ignorado", async () => {
  const deps = makeDeps({});
  await processDispatchJob({ data: {} }, deps);
  assert.equal(deps.sent.length, 0);
});
