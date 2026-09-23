import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentReminderDrain, formatPaymentReminder } from "./payment-reminder.mjs";

const PURCHASE = {
  id: "p1", participant_id: "u1", card_id: "c1", auction_id: "a1",
  amount: 45.5, confirmed_at: "2026-09-01T12:00:00.000Z",
};

function fakeSupabase({ deliveries = [], purchases = [], payments = [], reminders = [] } = {}) {
  const state = { deliveries, purchases, payments, reminders, upserts: [], sent: [] };
  const chain = rows => {
    const filtered = { value: rows };
    const api = {
      value: null,
      select() { return api; },
      eq(_column, _value) { return api; },
      lte(_column, _value) { return api; },
      in(_column, values) {
        // a coluna pode ser id OU purchase_id: casa por qualquer uma.
        filtered.value = filtered.value.filter(row => values.includes(row.id) || values.includes(row.purchase_id));
        return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle: () => Promise.resolve({ data: filtered.value[0] ?? null, error: null }),
      then: (resolve, _reject) => resolve({ data: filtered.value, error: null }),
    };
    return api;
  };
  return {
    state,
    from(table) {
      if (table === "payment_reminders") {
        const rows = state.reminders;
        return {
          ...chain(rows),
          upsert: payload => {
            state.upserts.push(payload);
            // simula o ON CONFLICT (purchase_id) do banco real
            const index = state.reminders.findIndex(row => row.purchase_id === payload.purchase_id);
            if (index >= 0) state.reminders[index] = { ...state.reminders[index], ...payload };
            else state.reminders.push({ id: `r${state.reminders.length + 1}`, ...payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      const store = { deliveries: state.deliveries, purchases: state.purchases, payments: state.payments, participants: [{ display_name: "Ana" }], cards: [{ name: "Charizard EX" }], auctions: [{ lot_number: 184 }] };
      return chain(store[table] ?? []);
    },
  };
}

test("formatPaymentReminder: DM completa com menção", () => {
  const message = formatPaymentReminder({
    participant_name: "Ana", card_name: "Charizard EX", lot_number: 184,
    amount: 100, confirmed_at: "2026-09-16T02:15:32.000Z", jid: "5541999999999@s.whatsapp.net",
  });
  assert.ok(message.text.includes("@5541999999999"));
  assert.deepEqual(message.mentions, ["5541999999999@s.whatsapp.net"]);
  assert.ok(message.text.includes("Charizard EX"));
  assert.ok(message.text.includes("Lote 184"));
  assert.ok(message.text.includes("R$ 100,00"));
  // 2026-09-16T02:15:32Z em America/Sao_Paulo = 2026-09-15 23:15 (UTC-3).
  assert.ok(message.text.includes("15/09/2026"));
  assert.ok(!message.text.includes("undefined"));
});

test("formatPaymentReminder: sem JID usa nome e não menciona", () => {
  const message = formatPaymentReminder({ participant_name: "Bia", card_name: "Pikachu", amount: 2.5, confirmed_at: "2026-09-20T15:00:00.000Z" });
  assert.ok(message.text.includes("Bia"));
  assert.deepEqual(message.mentions, []);
});

test("drain: pendência vencida gera 1 lembrete com upsert idempotente", async () => {
  const db = fakeSupabase({
    deliveries: [{ purchase_id: "p1" }],
    purchases: [PURCHASE],
    payments: [],
    reminders: [],
  });
  const drain = createPaymentReminderDrain({
    db,
    getSocket: () => ({ sendMessage: async (jid, message) => { db.state.sent.push({ jid, message }); } }),
    resolveJid: async () => "5541999999999@s.whatsapp.net",
    intervalMs: 0,
    reminderDays: 7,
    maxReminders: 5,
  });
  assert.equal(await drain.tick(Date.parse("2026-09-18T12:00:00.000Z")), 1);
  assert.equal(db.state.sent.length, 1);
  assert.equal(db.state.upserts.length, 1);
  assert.equal(db.state.upserts[0].reminded_count, 1);
  // dentro da janela de 7 dias: nada novo
  const tick2 = createPaymentReminderDrain({
    db, getSocket: () => ({ sendMessage: async () => {} }),
    resolveJid: async () => "5541999999999@s.whatsapp.net", intervalMs: 0, reminderDays: 7, maxReminders: 5,
  });
  assert.equal(await tick2.tick(Date.parse("2026-09-19T12:00:00.000Z")), 0);
  assert.equal(db.state.upserts.length, 1);
});

test("drain: pagamento dado de baixa exclui a compra do ciclo", async () => {
  const db = fakeSupabase({
    deliveries: [{ purchase_id: "p1" }],
    purchases: [PURCHASE],
    payments: [{ purchase_id: "p1", status: "paid" }],
    reminders: [],
  });
  const drain = createPaymentReminderDrain({
    db, getSocket: () => ({ sendMessage: async () => { throw new Error("não deve enviar"); } }),
    resolveJid: async () => "5541999999999@s.whatsapp.net", intervalMs: 0, reminderDays: 7, maxReminders: 5,
  });
  assert.equal(await drain.tick(Date.parse("2026-09-18T12:00:00.000Z")), 0);
  assert.equal(db.state.sent.length, 0);
});

test("drain: limite máximo de lembretes respeitado (0 = ilimitado)", async () => {
  const db = fakeSupabase({
    deliveries: [{ purchase_id: "p1" }],
    purchases: [PURCHASE],
    payments: [],
    reminders: [{ purchase_id: "p1", id: "r1", reminded_count: 5, last_reminded_at: "2026-09-01T12:00:00.000Z" }],
  });
  const drain = createPaymentReminderDrain({
    db, getSocket: () => ({ sendMessage: async () => {} }),
    resolveJid: async () => "5541999999999@s.whatsapp.net", intervalMs: 0, reminderDays: 7, maxReminders: 5,
  });
  assert.equal(await drain.tick(Date.parse("2026-09-20T12:00:00.000Z")), 0, "máx 5 atingido");
});

test("drain: sem socket não faz nada", async () => {
  const db = fakeSupabase({ deliveries: [{ purchase_id: "p1" }], purchases: [PURCHASE] });
  const drain = createPaymentReminderDrain({ db, getSocket: () => null, intervalMs: 0 });
  assert.equal(await drain.tick(Date.now()), 0);
});
