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
  if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    const result = excelBrasiliaDate(value);
    const original = value instanceof Date ? value : new Date(value);
    if (result && Number.isFinite(original.getTime())) result.setUTCMilliseconds(original.getUTCMilliseconds());
    return result;
  }
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

type TimedBid = { row: ExportRow; time: number; raw: string | number | Date; source: string };
type BidGroup = { auctionId: unknown; personId: unknown; count: number; changes: number; timed: TimedBid[] };
const groupKey = (auction: unknown, person: unknown) => JSON.stringify([String(auction), String(person)]);
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function money(value: unknown): number | null {
  if (value == null || value === "" || (typeof value !== "number" && typeof value !== "string")) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}
function instant(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return null;
  if (value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
function compareBids(a: TimedBid, b: TimedBid) {
  if (a.time !== b.time) return a.time - b.time;
  const aa = String(a.row.confirmation_order ?? ""), bb = String(b.row.confirmation_order ?? "");
  if (/^\d+$/.test(aa) && /^\d+$/.test(bb) && aa !== bb) return BigInt(aa) < BigInt(bb) ? -1 : 1;
  return String(a.row.id ?? "").localeCompare(String(b.row.id ?? ""));
}
function historyNote(group?: BidGroup) {
  if (!group) return "Histórico de lances indisponível.";
  const missing = group.count - group.timed.length;
  return missing ? `${missing} lance(s) sem horário válido; primeiro/último consideram apenas os horários disponíveis.` : "";
}

// Agrupamento por leilão + participante; retirados e substituídos continuam no histórico.
// Horários globais de identificação do participante não são horários de lance.
export function buildBidHistory(data: ExportSnapshot) {
  const groups = new Map<string, BidGroup>();
  const byEvent = new Map<string, TimedBid>();
  const linkedPrevious = new Map<string, TimedBid>();
  const previous = new Map<string, TimedBid>();
  for (const row of data.bids ?? []) {
    if (!["active", "replaced", "withdrawn"].includes(String(row.status)) || !row.auction_id || !row.participant_id) continue;
    const key = groupKey(row.auction_id, row.participant_id);
    let group = groups.get(key);
    if (!group) { group = { auctionId: row.auction_id, personId: row.participant_id, count: 0, changes: 0, timed: [] }; groups.set(key, group); }
    group.count++;
    for (const [field, source] of [["whatsapp_event_at", "WhatsApp"], ["processed_at", "Confirmação do bot"], ["received_at", "Recebimento no banco"]]) {
      const time = instant(row[field]);
      if (time == null) continue;
      const bid = { row, time, raw: row[field] as string | number | Date, source };
      group.timed.push(bid);
      if (row.whatsapp_event_id) byEvent.set(String(row.whatsapp_event_id), bid);
      if (row.replaced_by) linkedPrevious.set(String(row.replaced_by), bid);
      break;
    }
  }
  for (const group of groups.values()) {
    group.timed.sort(compareBids);
    for (let i = 1; i < group.timed.length; i++) previous.set(String(group.timed[i].row.id), group.timed[i - 1]);
  }
  for (const change of data.value_change_log ?? []) {
    const group = groups.get(groupKey(change.auction_id, change.participant_id));
    if (group) group.changes++;
  }
  return { groups, byEvent, linkedPrevious, previous };
}

export function buildBidSummaryRows(data: ExportSnapshot, history = buildBidHistory(data)) {
  const auctions = new Map((data.auctions ?? []).map(row => [String(row.id), row]));
  const cards = new Map((data.cards ?? []).map(row => [String(row.id), row]));
  const people = new Map((data.participants ?? []).map(row => [String(row.id), row]));
  return [...history.groups.values()].map(group => {
    const auction = auctions.get(String(group.auctionId));
    const person = people.get(String(group.personId));
    const first = group.timed[0], last = group.timed.at(-1);
    const status = String(last?.row.status ?? "");
    return {
      lot: auction?.lot_number ?? "", card: String(cards.get(String(auction?.card_id))?.name ?? ""),
      buyer: String(person?.display_name ?? ""), phone: cleanPhone(person?.phone_e164, person?.whatsapp_id),
      firstAmount: money(first?.row.amount), firstBidAt: excelDateValue(first?.raw), firstSource: first?.source ?? "",
      lastAmount: money(last?.row.amount), lastBidAt: excelDateValue(last?.raw), lastSource: last?.source ?? "",
      bidCount: group.count, changeCount: group.changes,
      lastStatus: ({ active: "Ativo", replaced: "Substituído", withdrawn: "Retirado" } as Record<string, string>)[status] ?? status,
      notes: historyNote(group), auctionId: group.auctionId, participantId: group.personId,
    };
  }).sort((a, b) => String(a.lot).localeCompare(String(b.lot), "pt-BR", { numeric: true }) || String(a.auctionId).localeCompare(String(b.auctionId)) || a.buyer.localeCompare(b.buyer, "pt-BR") || String(a.participantId).localeCompare(String(b.participantId)));
}

export type ChangeRow = {
  lot: unknown;
  card: string;
  buyer: string;
  previousAmount: number | null;
  newAmount: number | null;
  difference: number | null;
  globalWarnings: number;
  warning: string;
  how: string;
  occurredAt: Date | null;
  phone: string;
  transition: string;
  firstBidAt: Date | null;
  lastBidAt: Date | null;
  previousBidAt: Date | null;
  historyNote: string;
};

// "Alterações de valores": histórico detalhado de cada mudança de lance
// (troca direta e re-oferta pós-retirada) + total de avisos GLOBAIS do usuário.
export function buildChangeRows(data: ExportSnapshot, history = buildBidHistory(data)): ChangeRow[] {
  const cards = data.cards ?? [];
  const participants = data.participants ?? [];
  const auctions = data.auctions ?? [];
  const warningCount = buildGlobalWarningCount(data.participant_warnings);
  return (data.value_change_log ?? [])
    .slice()
    .sort((a, b) => (instant(b.occurred_at) ?? -Infinity) - (instant(a.occurred_at) ?? -Infinity) || String(a.id).localeCompare(String(b.id)))
    .map(change => {
      const auction = auctions.find(a => a.id === change.auction_id);
      const card = auction ? cards.find(c => c.id === auction.card_id) : undefined;
      const person = participants.find(p => p.id === change.participant_id);
      const previous = money(change.previous_amount);
      const next = money(change.new_amount);
      const group = history.groups.get(groupKey(change.auction_id, change.participant_id));
      const newBid = history.byEvent.get(String(change.external_event_id));
      const candidate = newBid ? history.linkedPrevious.get(String(newBid.row.id)) ?? history.previous.get(String(newBid.row.id)) : undefined;
      const sameGroup = (bid: TimedBid) => groupKey(bid.row.auction_id, bid.row.participant_id) === groupKey(change.auction_id, change.participant_id);
      const oldBid = candidate && newBid && previous != null && next != null && sameGroup(candidate) && sameGroup(newBid) && money(candidate.row.amount) === previous && money(newBid.row.amount) === next && compareBids(candidate, newBid) < 0 ? candidate : undefined;
      return {
        lot: auction?.lot_number ?? "",
        card: String(card?.name ?? ""),
        buyer: String(person?.display_name ?? ""),
        previousAmount: previous,
        newAmount: next,
        difference: next != null && previous != null ? next - previous : null,
        globalWarnings: change.participant_id ? (warningCount.get(String(change.participant_id)) ?? 0) : 0,
        warning: next != null && previous != null && next < previous ? "SIM" : "",
        how: changeKindLabel(change.change_kind),
        occurredAt: excelDateValue(change.occurred_at),
        phone: cleanPhone(person?.phone_e164, person?.whatsapp_id),
        transition: `${previous == null ? "Não registrado" : currency.format(previous)} → ${next == null ? "Não registrado" : currency.format(next)}`,
        firstBidAt: excelDateValue(group?.timed[0]?.raw),
        lastBidAt: excelDateValue(group?.timed.at(-1)?.raw),
        previousBidAt: excelDateValue(oldBid?.raw),
        historyNote: [historyNote(group), oldBid ? "" : "Horário do lance anterior não identificado."].filter(Boolean).join(" "),
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
    { metric: "Fuso dos horários", value: "Brasília (America/Sao_Paulo). Milissegundos quando registrados; a origem WhatsApp pode ter precisão de segundos." },
    { metric: "Primeiro e último lance", value: "Por participante e leilão, incluindo lances retirados/substituídos e excluindo rejeitados/fora do prazo. Origem: WhatsApp, confirmação do bot ou recebimento no banco." },
    { metric: "Histórico disponível", value: "Somente dados ainda existentes. Exporte antes da limpeza automática de 12 horas; dados excluídos não são recuperados neste Excel." },
    { metric: "Limites do histórico", value: (data.bids ?? []).length >= 50000 || (data.value_change_log ?? []).length >= 10000 ? "ATENÇÃO: limite de lances (50.000) ou alterações (10.000) atingido. Histórico pode estar parcial; primeiro/último consideram apenas os dados incluídos." : "Até 50.000 lances e 10.000 alterações por exportação; primeiro/último consideram os dados incluídos." },
  ];
}
