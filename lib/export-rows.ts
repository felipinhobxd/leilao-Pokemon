// Lógica pura de montagem das linhas do export Excel, extraída de
// app/api/export/route.ts (2026-10-08) para ser testável com `npm test`
// (gap documentado em docs/agent/09_TESTS_AND_VALIDATION.md). A rota mantém
// apenas a montagem do workbook ExcelJS; nada aqui importa server-only.
//
// DELIBERADO: tipos estruturais locais (e não Snapshot/Row de lib/backend) —
// lib/backend importa supabase-server ("server-only"), que não pode ser
// carregado por teste em Node puro.
import { excelBrasiliaDate } from "./brasilia-time.ts";

export type ExportRow = Record<string, unknown>;
export type ExportSnapshot = { [table: string]: ExportRow[] | undefined };

export function excelDateValue(value: unknown) {
  if (value == null || value === "") return null;
  if (value instanceof Date || typeof value === "string" || typeof value === "number") return excelBrasiliaDate(value);
  return null;
}

// 20261007110000: como a alteração de valor aconteceu — troca direta na
// enquete (BID_CHANGED) ou retirada do lance + re-oferta menor (BID_PLACED
// pós-withdrawn). Legível em PT-BR nas abas de alterações.
export function changeKindLabel(value: unknown) {
  return value === "withdraw_rebid" ? "Após retirar lance" : "Troca direta";
}

export function winTypeLabel(value: unknown) {
  const type = String(value ?? "").toLowerCase();
  if (type.includes("buyout") || type.includes("arremate")) return "Arremate";
  if (type.includes("bid") || type.includes("highest")) return "Maior lance";
  return type ? String(value) : "Venda";
}

export function cleanPhone(phone: unknown, whatsapp: unknown) {
  const direct = String(phone ?? "").trim();
  if (/^\+\d{8,15}$/.test(direct)) return direct;
  const raw = String(whatsapp ?? "").trim();
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  const local = raw.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(local) && raw.includes("@s.whatsapp.net") ? `+${local}` : "";
}

export function buildGlobalWarningCount(rows: ExportRow[] = []) {
  const map = new Map<string, number>();
  for (const warning of rows) {
    const key = String(warning.participant_id ?? "");
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function buildPaidByPurchase(rows: ExportRow[] = []) {
  const map = new Map<string, { paid_at: string | null }>();
  for (const payment of rows) {
    if (String(payment.status ?? "") === "paid") {
      map.set(String(payment.purchase_id ?? ""), { paid_at: (payment.paid_at as string | null) ?? null });
    }
  }
  return map;
}

export type SalesRow = {
  lot: unknown;
  card: string;
  cardNumber: string;
  variant: string;
  buyer: string;
  phone: string;
  amount: number;
  winType: string;
  globalWarnings: number;
  payment: string;
  confirmedAt: Date | null;
  notes: string;
};

export function confirmedPurchases(data: ExportSnapshot): ExportRow[] {
  return (data.purchases ?? [])
    .filter(p => p.status === "confirmed")
    .sort((a, b) => String(b.confirmed_at ?? "").localeCompare(String(a.confirmed_at ?? "")));
}

// Vendas (aba principal). O TOTAL cobre exatamente as linhas de compra
// (coluna G = "Valor"), sem textos nem células soltas — mesma fórmula que a
// rota aplicava inline.
export function buildSalesRows(data: ExportSnapshot): { rows: SalesRow[]; totalFormula: { formula: string } | null } {
  const cards = data.cards ?? [];
  const participants = data.participants ?? [];
  const auctions = data.auctions ?? [];
  const warningCount = buildGlobalWarningCount(data.participant_warnings);
  const paidByPurchase = buildPaidByPurchase(data.payments);
  const rows = confirmedPurchases(data).map(purchase => {
    const auction = auctions.find(a => a.id === purchase.auction_id);
    const card = cards.find(c => c.id === purchase.card_id);
    const person = participants.find(p => p.id === purchase.participant_id);
    const paid = paidByPurchase.get(String(purchase.id));
    const paidDate = paid?.paid_at
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(paid.paid_at))
      : "";
    return {
      lot: auction?.lot_number ?? "",
      card: String(card?.name ?? ""),
      cardNumber: String(card?.card_number ?? ""),
      variant: String(card?.variant ?? ""),
      buyer: String(person?.display_name ?? ""),
      phone: cleanPhone(person?.phone_e164, person?.whatsapp_id),
      amount: Number(purchase.amount ?? 0),
      winType: winTypeLabel(auction?.win_type),
      globalWarnings: person ? (warningCount.get(String(person.id)) ?? 0) : 0,
      payment: paid ? (paidDate ? `✔ Pago (${paidDate})` : "✔ Pago") : "⏳ Pendente",
      confirmedAt: excelDateValue(purchase.confirmed_at),
      notes: "",
    };
  });
  const totalFormula = rows.length ? { formula: `SUM(G2:G${rows.length + 1})` } : null;
  return { rows, totalFormula };
}

export type ChangeRow = {
  lot: unknown;
  card: string;
  buyer: string;
  previousAmount: number;
  newAmount: number;
  difference: number;
  globalWarnings: number;
  warning: string;
  how: string;
  occurredAt: Date | null;
};

// "Alterações de valores": histórico detalhado de cada mudança de lance
// (troca direta e re-oferta pós-retirada) + total de avisos GLOBAIS do usuário.
export function buildChangeRows(data: ExportSnapshot): ChangeRow[] {
  const cards = data.cards ?? [];
  const participants = data.participants ?? [];
  const auctions = data.auctions ?? [];
  const warningCount = buildGlobalWarningCount(data.participant_warnings);
  return (data.value_change_log ?? [])
    .slice()
    .sort((a, b) => String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? "")))
    .map(change => {
      const auction = auctions.find(a => a.id === change.auction_id);
      const card = auction ? cards.find(c => c.id === auction.card_id) : undefined;
      const person = participants.find(p => p.id === change.participant_id);
      const previous = Number(change.previous_amount ?? 0);
      const next = Number(change.new_amount ?? 0);
      return {
        lot: auction?.lot_number ?? "",
        card: String(card?.name ?? ""),
        buyer: String(person?.display_name ?? ""),
        previousAmount: previous,
        newAmount: next,
        difference: next - previous,
        globalWarnings: change.participant_id ? (warningCount.get(String(change.participant_id)) ?? 0) : 0,
        warning: next < previous ? "SIM" : "",
        how: changeKindLabel(change.change_kind),
        occurredAt: excelDateValue(change.occurred_at),
      };
    });
}

export function buildSummaryRows(data: ExportSnapshot, now: Date = new Date()): { metric: string; value: unknown }[] {
  const purchases = confirmedPurchases(data);
  const totalRevenue = purchases.reduce((total, purchase) => total + Number(purchase.amount ?? 0), 0);
  const uniqueBuyers = new Set(purchases.map(p => String(p.participant_id ?? "")).filter(Boolean)).size;
  return [
    { metric: "Exportado em (Brasília)", value: excelBrasiliaDate(now) },
    { metric: "Vendas confirmadas", value: purchases.length },
    { metric: "Compradores únicos", value: uniqueBuyers },
    { metric: "Total vendido", value: totalRevenue },
    { metric: "Ticket médio", value: purchases.length ? totalRevenue / purchases.length : 0 },
    { metric: "Leilões cadastrados", value: (data.auctions ?? []).length },
    { metric: "Participantes identificados", value: (data.participants ?? []).length },
  ];
}
