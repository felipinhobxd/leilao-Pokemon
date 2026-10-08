import test from "node:test";
import assert from "node:assert/strict";
import { describeVoteReceived } from "./vote-log.mjs";

// Intl.NumberFormat("pt-BR", currency) separa "R$" do valor com espaço
// INSEPARÁVEL (U+00A0) — normalizamos para comparar com espaço simples
// (mesmo tratamento do formatador BRL/nbsp em warning-notify.test.mjs).
const normalize = line => String(line).replace(/\u00A0/g, " ");

test("describeVoteReceived: primeiro voto (sem retirada) mantém o log atual", () => {
  const line = normalize(describeVoteReceived({ displayName: "Ana", contact: " (+5541...)", amount: 20 }));
  assert.ok(line.startsWith("🗳️ Voto recebido: Ana (+5541...) → R$ 20,00"), `log inesperado: ${line}`);
  assert.ok(!line.includes("retirou"), "primeiro voto não menciona retirada");
  assert.ok(!line.includes("⚠️"), "primeiro voto não marca redução");
});

test("describeVoteReceived: re-oferta MENOR após retirada marca a redução", () => {
  const line = normalize(describeVoteReceived({ displayName: "Ana", contact: "", amount: 40, lot: "12", withdrawnAmount: 50 }));
  assert.ok(line.startsWith("🗳️ Voto após retirada: Ana → retirou R$ 50,00 → R$ 40,00"), `log inesperado: ${line}`);
  assert.ok(line.includes("· lote 12"), `sem lote: ${line}`);
  assert.ok(line.includes("⚠️ redução: aviso global registrado"), `sem marca de redução: ${line}`);
});

test("describeVoteReceived: re-oferta MAIOR após retirada não marca redução", () => {
  const line = normalize(describeVoteReceived({ displayName: "Bia", contact: "", amount: 60, lot: "12", withdrawnAmount: 50 }));
  assert.ok(line.includes("retirou R$ 50,00 → R$ 60,00"), `log inesperado: ${line}`);
  assert.ok(!line.includes("⚠️"), `não deveria marcar redução: ${line}`);
});

test("describeVoteReceived: re-oferta de MESMO valor não marca redução", () => {
  const line = normalize(describeVoteReceived({ displayName: "Bia", contact: "", amount: 50, lot: "12", withdrawnAmount: 50 }));
  assert.ok(!line.includes("⚠️"), `igualar não avisa: ${line}`);
});

test("describeVoteReceived: lote ausente cai no placeholder", () => {
  const line = normalize(describeVoteReceived({ displayName: "Ana", contact: "", amount: 10, lot: null, withdrawnAmount: 20 }));
  assert.ok(line.includes("· lote —"), `sem placeholder de lote: ${line}`);
});
