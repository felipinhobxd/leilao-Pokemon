import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ADMIN_JIDS, createAdminNotificationDrain, createParticipantWarningDrain, formatParticipantWarning, formatWarningNotification, parseAdminJids } from "./warning-notify.mjs";

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
  assert.ok(text.includes("GLOBAL"));
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

// ---------------------------------------------------------------------------
// DM do aviso para o PRÓPRIO participante (20260924180000): qual enquete/
// lote, valores, horário e o nº do aviso (de 3).
// ---------------------------------------------------------------------------
const WARNING = {
  id: "w1",
  participant_id: "p1",
  card_name: "Gengar",
  lot_number: 7,
  previous_amount: 30,
  new_amount: 22,
  external_event_id: "wa-vote:x:p:1:22",
  occurred_at: "2026-09-24T23:10:00.000Z",
};

function fakeParticipantDb(rows, participant = { display_name: "Ana" }) {
  const state = { rows: rows.map(row => ({ notified_at: null, ...row })), count: 1 };
  const warningsChain = () => {
    const c = {
      head: false,
      select: (_columns, options) => { c.head = Boolean(options?.head); return c; },
      is: () => c,
      order: () => c,
      limit: () => (c.head
        ? Promise.resolve({ data: [], count: state.count, error: null })
        : Promise.resolve({ data: state.rows.filter(row => !row.notified_at).slice(), error: null })),
      eq: () => c,
      lte: () => Promise.resolve({ data: [], count: state.count, error: null }),
      update: payload => ({ eq: (_col, value) => { const target = state.rows.find(row => row.id === value); if (target) Object.assign(target, payload); return Promise.resolve({ error: null }); } }),
    };
    return c;
  };
  return {
    state,
    from: table => {
      if (table === "participants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: participant, error: null }),
            }),
          }),
        };
      }
      return warningsChain();
    },
  };
}

test("formatParticipantWarning: DM nomeia enquete/lote, valores, horário e o no do aviso", () => {
  const text = formatParticipantWarning(WARNING, 1);
  assert.ok(text.includes("AVISO DE ALTERAÇÃO DE LANCE"));
  assert.ok(text.includes("lote 7 (Gengar)"));
  assert.ok(text.includes("R$ 30,00"));
  assert.ok(text.includes("R$ 22,00"));
  assert.ok(text.includes("Horário"));
  assert.ok(text.includes("aviso 1 de 3"));
});

test("formatParticipantWarning: no 3o aviso diz que os admins foram notificados; depois continua contando", () => {
  assert.ok(formatParticipantWarning(WARNING, 3).includes("n\u00BA 3"));
  const after = formatParticipantWarning(WARNING, 5);
  assert.ok(after.includes("n\u00BA 5"));
  assert.ok(after.includes("j\u00E1 foram notificados"));
});

test("participant drain: entrega a DM e marca notified_at (segunda passada nao reenvia)", async () => {
  const db = fakeParticipantDb([{ ...WARNING }]);
  const sent = [];
  const drain = createParticipantWarningDrain({
    db,
    getSocket: () => ({ sendMessage: async (jid, payload) => { sent.push([jid, payload.text]); } }),
    resolveJid: async () => "5511999999999@s.whatsapp.net",
    intervalMs: 0,
  });
  assert.equal(await drain.tick(1000), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "5511999999999@s.whatsapp.net");
  assert.ok(sent[0][1].includes("lote 7 (Gengar)"));
  assert.equal(db.state.rows[0].notified_at != null, true);
  assert.equal(await drain.tick(9999), 0);
  assert.equal(sent.length, 1);
});

test("participant drain: sem JID resolvivel marca sem DM (nao roda em circulo)", async () => {
  const db = fakeParticipantDb([{ ...WARNING }]);
  const sent = [];
  const drain = createParticipantWarningDrain({
    db,
    getSocket: () => ({ sendMessage: async (jid, payload) => { sent.push([jid, payload.text]); } }),
    resolveJid: async () => null,
    intervalMs: 0,
  });
  assert.equal(await drain.tick(1000), 0);
  assert.equal(sent.length, 0, "sem JID não há DM");
  assert.equal(db.state.rows[0].notified_at != null, true, "marca para não travar o dreno");
});

test("participant drain: falha no envio deixa pendente e reenvia depois", async () => {
  const db = fakeParticipantDb([{ ...WARNING }]);
  const sent = [];
  let fail = true;
  const drain = createParticipantWarningDrain({
    db,
    getSocket: () => ({ sendMessage: async () => { if (fail) throw new Error("network"); sent.push("ok"); } }),
    resolveJid: async () => "5511999999999@s.whatsapp.net",
    intervalMs: 0,
  });
  await drain.tick(1000);
  assert.equal(db.state.rows[0].notified_at, null, "falha mantém pendente");
  fail = false;
  assert.equal(await drain.tick(9999), 1);
  assert.equal(sent.length, 1);
  assert.equal(db.state.rows[0].notified_at != null, true);
});

test("participant drain: sem socket nao faz nada", async () => {
  const db = fakeParticipantDb([{ ...WARNING }]);
  const drain = createParticipantWarningDrain({ db, getSocket: () => null, resolveJid: async () => "x@s.whatsapp.net", intervalMs: 0 });
  assert.equal(await drain.tick(1000), 0);
  assert.equal(db.state.rows[0].notified_at, null);
});
