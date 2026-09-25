import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ADMIN_JIDS, createAdminNotificationDrain, formatAdminNotification, formatDispatchFailedNotification, formatWarningNotification, parseAdminJids } from "./warning-notify.mjs";

const PAYLOAD = {
  participant_name: "Exemplo",
  total_warnings: 3,
  card_name: "Charizard EX",
  lot_number: 184,
  previous_amount: 100,
  new_amount: 90,
  event_at: "2026-09-23T02:15:32.000Z",
  warnings: [
    { card_name: "Carta X", lot_number: 10, previous_amount: 50, new_amount: 40, occurred_at: "2026-09-20T10:00:00.000Z" },
    { card_name: "Carta Y", lot_number: 11, previous_amount: 80, new_amount: 70, occurred_at: "2026-09-21T10:00:00.000Z" },
    { card_name: "Charizard EX", lot_number: 184, previous_amount: 100, new_amount: 90, occurred_at: "2026-09-23T02:15:32.000Z" },
  ],
};

test("formatWarningNotification: mensagem completa da regra dos 3 avisos", () => {
  const text = formatWarningNotification(PAYLOAD);
  assert.ok(text.includes("⚠️ USUÁRIO ATINGIU 3 AVISOS"));
  assert.ok(text.includes("Usuário: Exemplo"));
  assert.ok(text.includes("Total de avisos: 3"));
  assert.ok(text.includes("ciclo atual"));
  assert.ok(text.includes("reinicia"));
  assert.ok(text.includes("Carta: Charizard EX"));
  assert.ok(text.includes("184"));
  assert.ok(text.includes("R$ 100,00"));
  assert.ok(text.includes("R$ 90,00"));
  // histórico ANTERIOR: os 2 primeiros avisos, sem repetir o último
  assert.ok(text.includes("1º — Carta X — R$ 50,00 → R$ 40,00"));
  assert.ok(text.includes("2º — Carta Y — R$ 80,00 → R$ 70,00"));
  assert.ok(!text.includes("3º —"));
});

test("formatWarningNotification: tolera payload sem histórico", () => {
  const text = formatWarningNotification({ participant_name: "Zé", total_warnings: 3, card_name: "A", previous_amount: 5, new_amount: 4 });
  assert.ok(text.includes("Usuário: Zé"));
  assert.ok(!text.includes("Avisos anteriores:"));
});

test("formatWarningNotification: valores formatados em BRL", () => {
  const text = formatWarningNotification({ ...PAYLOAD, previous_amount: 2.5, new_amount: 1.75 });
  assert.ok(text.includes("R$ 2,50"));
  assert.ok(text.includes("R$ 1,75"));
});

test("parseAdminJids: env e normalização", () => {
  assert.deepEqual(parseAdminJids("a@s.whatsapp.net, b@s.whatsapp.net"), ["a@s.whatsapp.net", "b@s.whatsapp.net"]);
  assert.deepEqual(parseAdminJids("  "), []);
  assert.deepEqual(DEFAULT_ADMIN_JIDS, ["554197285978@s.whatsapp.net", "5519989759121@s.whatsapp.net"]);
});

function fakeDb(rows) {
  const state = { rows: rows.map(row => ({ ...row })), updates: [] };
  const chain = () => {
    const c = {
      select: () => c,
      is: () => c,
      order: () => c,
      limit: () => Promise.resolve({ data: state.rows.filter(row => !row.sent_at).slice(), error: null }),
      update: payload => ({
        eq: (_column, value) => {
          state.updates.push(payload);
          const target = state.rows.find(row => row.id === value);
          if (target) Object.assign(target, payload);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return c;
  };
  return { state, from: () => chain() };
}

test("drain: entrega para todos os admins e marca sent_at (idempotente)", async () => {
  const db = fakeDb([{ id: "n1", payload: { ...PAYLOAD }, external_event_id: "e1" }]);
  const sent = [];
  const drain = createAdminNotificationDrain({
    db,
    getSocket: () => ({ sendMessage: async jid => { sent.push(jid); } }),
    adminJids: ["a@s.whatsapp.net", "b@s.whatsapp.net"],
    intervalMs: 0,
  });
  assert.equal(await drain.tick(1000), 1);
  assert.deepEqual(sent.sort(), ["a@s.whatsapp.net", "b@s.whatsapp.net"].sort());
  assert.equal(db.state.rows[0].sent_at != null, true);
  assert.deepEqual(db.state.rows[0].payload.sent_to.sort(), ["a@s.whatsapp.net", "b@s.whatsapp.net"].sort());
  // segunda passada: nada pendente, nada reenviado
  assert.equal(await drain.tick(9999), 0);
  assert.equal(sent.length, 2);
});

test("drain: falha parcial reenvia APENAS para o admin que não recebeu", async () => {
  const db = fakeDb([{ id: "n1", payload: { ...PAYLOAD }, external_event_id: "e1" }]);
  const sent = [];
  let failFor = "b@s.whatsapp.net";
  const drain = createAdminNotificationDrain({
    db,
    getSocket: () => ({
      sendMessage: async jid => {
        if (jid === failFor) throw new Error("network");
        sent.push(jid);
      },
    }),
    adminJids: ["a@s.whatsapp.net", "b@s.whatsapp.net"],
    intervalMs: 0,
  });
  // 1ª tentativa: "a" recebe, "b" falha -> segue pendente, sent_to só com "a"
  await drain.tick(1000);
  assert.deepEqual(sent, ["a@s.whatsapp.net"]);
  assert.equal(db.state.rows[0].sent_at, null);
  assert.deepEqual(db.state.rows[0].payload.sent_to, ["a@s.whatsapp.net"]);
  // 2ª tentativa: só "b" falta; sem reenvio para "a"
  failFor = null;
  assert.equal(await drain.tick(9999), 1);
  assert.deepEqual(sent.sort(), ["a@s.whatsapp.net", "b@s.whatsapp.net"].sort());
});

test("drain: sem socket não faz nada", async () => {
  const db = fakeDb([{ id: "n1", payload: {}, external_event_id: "e1" }]);
  const drain = createAdminNotificationDrain({ db, getSocket: () => null, adminJids: ["a@s.whatsapp.net"], intervalMs: 0 });
  assert.equal(await drain.tick(1000), 0);
});

test("formatDispatchFailedNotification: DM de lote falho com lote, carta, tentativas e erro", () => {
  const text = formatDispatchFailedNotification({ lot_number: 12, card_name: "Charizard EX", attempts: 5, error: "poll_send_failed" });
  assert.ok(text.includes("PUBLICAÇÃO DE LOTE FALHOU"));
  assert.ok(text.includes("Lote: 12"));
  assert.ok(text.includes("Charizard EX"));
  assert.ok(text.includes("Tentativas: 5"));
  assert.ok(text.includes("poll_send_failed"));
  assert.ok(text.includes("NÃO volta para a fila"));
});

test("formatAdminNotification: despacha por kind (WARNING_THRESHOLD vs DISPATCH_FAILED)", () => {
  const failed = formatAdminNotification({ kind: "DISPATCH_FAILED", payload: { lot_number: 3, error: "x" } });
  assert.ok(failed.includes("PUBLICAÇÃO DE LOTE FALHOU"));
  const warning = formatAdminNotification({ kind: "WARNING_THRESHOLD", payload: PAYLOAD });
  assert.ok(warning.includes("USUÁRIO ATINGIU 3 AVISOS"));
});
