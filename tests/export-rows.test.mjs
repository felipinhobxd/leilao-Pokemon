import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChangeRows,
  buildSalesRows,
  buildSummaryRows,
  changeKindLabel,
  cleanPhone,
  winTypeLabel,
} from "../lib/export-rows.ts";

const snapshot = {
  participants: [
    { id: "p1", display_name: "Ana", phone_e164: "+5541999999999", whatsapp_id: "ana@s.whatsapp.net" },
    { id: "p2", display_name: "Bia", phone_e164: null, whatsapp_id: "5521888888888@s.whatsapp.net" },
  ],
  cards: [
    { id: "cardA", name: "Pikachu", card_number: "025/198", variant: "Holo" },
    { id: "cardB", name: "Charizard", card_number: "006/198", variant: null },
  ],
  auctions: [
    { id: "a1", card_id: "cardA", lot_number: 12, win_type: "highest_bid" },
    { id: "a2", card_id: "cardB", lot_number: 13, win_type: "buyout" },
  ],
  purchases: [
    { id: "purchase1", auction_id: "a1", card_id: "cardA", participant_id: "p1", amount: 120.5, status: "confirmed", confirmed_at: "2026-10-07T21:00:00Z" },
    { id: "purchase2", auction_id: "a2", card_id: "cardB", participant_id: "p2", amount: 80, status: "confirmed", confirmed_at: "2026-10-08T22:00:00Z" },
    { id: "purchase3", auction_id: "a1", card_id: "cardA", participant_id: "p2", amount: 10, status: "cancelled", confirmed_at: "2026-10-08T23:00:00Z" },
  ],
  payments: [
    { id: "pay1", purchase_id: "purchase1", status: "paid", paid_at: "2026-10-07T22:00:00Z" },
    { id: "pay2", purchase_id: "purchase2", status: "pending", paid_at: null },
  ],
  participant_warnings: [
    { id: "w1", participant_id: "p1" },
    { id: "w2", participant_id: "p1" },
    { id: "w3", participant_id: "p2" },
  ],
  value_change_log: [
    { id: "v1", auction_id: "a1", participant_id: "p1", previous_amount: 50, new_amount: 40, change_kind: "withdraw_rebid", occurred_at: "2026-10-07T20:00:00Z" },
    { id: "v2", auction_id: "a1", participant_id: "p1", previous_amount: 40, new_amount: 60, change_kind: "withdraw_rebid", occurred_at: "2026-10-07T20:30:00Z" },
    { id: "v3", auction_id: "a2", participant_id: "p2", previous_amount: 70, new_amount: 55, change_kind: "change", occurred_at: "2026-10-07T19:00:00Z" },
  ],
};

test("changeKindLabel: troca direta x re-oferta pós-retirada", () => {
  assert.equal(changeKindLabel("withdraw_rebid"), "Após retirar lance");
  assert.equal(changeKindLabel("change"), "Troca direta");
  assert.equal(changeKindLabel(undefined), "Troca direta");
  assert.equal(changeKindLabel(null), "Troca direta");
});

test("winTypeLabel: arremate, maior lance e fallback", () => {
  assert.equal(winTypeLabel("buyout"), "Arremate");
  assert.equal(winTypeLabel("ARREMATE"), "Arremate");
  assert.equal(winTypeLabel("highest_bid"), "Maior lance");
  assert.equal(winTypeLabel(""), "Venda");
  assert.equal(winTypeLabel(null), "Venda");
});

test("cleanPhone: E.164 direto, fallback do WhatsApp e lixo vira vazio", () => {
  assert.equal(cleanPhone("+5541999999999", "x@s.whatsapp.net"), "+5541999999999");
  assert.equal(cleanPhone(null, "5521888888888@s.whatsapp.net"), "+5521888888888");
  assert.equal(cleanPhone(null, "1234:5@s.whatsapp.net"), "");
  assert.equal(cleanPhone(null, null), "");
});

test("buildSalesRows: só confirmadas, ordenadas por data desc, pagamento e avisos globais", () => {
  const { rows, totalFormula } = buildSalesRows(snapshot);
  assert.equal(rows.length, 2, "compra cancelada não entra");
  assert.equal(rows[0].buyer, "Bia", "mais recente primeiro (08/10 > 07/10)");
  assert.equal(rows[0].payment, "⏳ Pendente");
  assert.equal(rows[0].winType, "Arremate");
  assert.equal(rows[0].phone, "+5521888888888", "telefone derivado do JID do WhatsApp");
  assert.ok(rows[0].confirmedAt instanceof Date, "confirmedAt vira Date de Brasília p/ Excel");
  assert.equal(rows[1].buyer, "Ana");
  assert.ok(rows[1].payment.startsWith("✔ Pago ("), `pagamento marcado: ${rows[1].payment}`);
  assert.equal(rows[1].globalWarnings, 2, "avisos globais contam TODO o histórico do usuário");
  assert.deepEqual(totalFormula, { formula: "SUM(G2:G3)" }, "TOTAL cobre exatamente as linhas de compra");
});

test("buildSalesRows: sem compras não gera fórmula de TOTAL", () => {
  const { rows, totalFormula } = buildSalesRows({ purchases: [] });
  assert.equal(rows.length, 0);
  assert.equal(totalFormula, null);
});

test("buildChangeRows: ordem desc, marca SIM só na redução e coluna Como pelos dois caminhos", () => {
  const rows = buildChangeRows(snapshot);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.newAmount), [60, 40, 55], "ordenado por occurred_at desc");
  assert.equal(rows[0].warning, "", "aumento não marca redução");
  assert.equal(rows[0].how, "Após retirar lance");
  assert.equal(rows[1].warning, "SIM", "redução marca SIM");
  assert.equal(rows[1].difference, -10);
  assert.equal(rows[1].lot, 12);
  assert.equal(rows[1].card, "Pikachu");
  assert.equal(rows[2].how, "Troca direta");
  assert.equal(rows[2].warning, "SIM");
  assert.equal(rows[2].card, "Charizard");
  assert.equal(rows[0].globalWarnings, 2, "avisos globais do Ana no momento da exportação");
});

test("buildSummaryRows: métricas fecham com os dados", () => {
  const rows = buildSummaryRows(snapshot, new Date("2026-10-08T12:00:00Z"));
  const byMetric = Object.fromEntries(rows.map(r => [r.metric, r.value]));
  assert.equal(byMetric["Vendas confirmadas"], 2);
  assert.equal(byMetric["Compradores únicos"], 2);
  assert.equal(byMetric["Total vendido"], 200.5);
  assert.equal(byMetric["Ticket médio"], 100.25);
  assert.equal(byMetric["Leilões cadastrados"], 2);
  assert.equal(byMetric["Participantes identificados"], 2);
  assert.ok(byMetric["Exportado em (Brasília)"] instanceof Date);
});
