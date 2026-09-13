import ExcelJS from "exceljs";
import { authorize, failure, snapshot, type Table } from "@/lib/backend";

export const runtime = "nodejs";

const sheets: [Table, string, [string, string][]][] = [
  ["cards", "Cartas", [["ID","id"],["Nome","name"],["Coleção","collection"],["Número","card_number"],["Imagem","image_url"],["Preço inicial","starting_price"],["ARREMATE","buyout_price"],["Status","status"],["Observações","notes"]]],
  ["participants", "Participantes", [["ID","id"],["Nome","display_name"],["Telefone","phone_e164"],["WhatsApp técnico","whatsapp_id"],["Status","status"],["Primeiro voto","first_seen_at"],["Último voto","last_seen_at"],["Observações","notes"]]],
  ["auctions", "Leilões", [["ID","id"],["Lote","lot_number"],["Carta","card_name"],["ID carta","card_id"],["Status","status"],["Inicial","starting_price"],["ARREMATE","buyout_price"],["Vencedor","participant_name"],["Telefone vencedor","participant_phone"],["WhatsApp técnico","participant_whatsapp"],["Valor final","final_price"],["Tipo de vitória","win_type"],["Início","started_at"],["Prazo","scheduled_end_at"],["Fim","ended_at"]]],
  ["bids", "Lances", [["ID","id"],["Leilão","auction_id"],["Participante","participant_name"],["Telefone","participant_phone"],["WhatsApp técnico","participant_whatsapp"],["Valor","amount"],["Tipo","kind"],["Status","status"],["Confirmado em","processed_at"],["Ordem","confirmation_order"],["Evento externo","whatsapp_event_id"],["Substituído por","replaced_by"]]],
  ["purchases", "Compras", [["ID","id"],["Leilão","auction_id"],["Carta","card_name"],["Comprador","participant_name"],["Telefone comprador","participant_phone"],["WhatsApp técnico","participant_whatsapp"],["Valor","amount"],["Status","status"],["Confirmada em","confirmed_at"]]],
  ["payments", "Pagamentos", [["ID","id"],["Compra","purchase_id"],["Valor","amount"],["Status","status"],["Método","method"],["Pago em","paid_at"],["Referência","reference"]]],
  ["deliveries", "Entregas", [["ID","id"],["Compra","purchase_id"],["Status","status"],["Rastreio","tracking_code"],["Enviado em","shipped_at"],["Entregue em","delivered_at"],["Observações","notes"]]],
  ["warnings", "Advertências", [["ID","id"],["Participante","participant_name"],["Leilão","auction_id"],["Tipo","type"],["Motivo","reason"],["Ativa","active"],["Início","starts_at"],["Fim","ends_at"]]],
  ["auction_events", "Auditoria", [["ID","id"],["Leilão","auction_id"],["Participante","participant_name"],["WhatsApp","participant_whatsapp"],["Telefone","participant_phone"],["Administrador","admin_user_id"],["Evento","event_type"],["ID externo","external_event_id"],["Ocorrido em","occurred_at"],["Registrado em","created_at"],["Detalhes","payload"]]],
];

function cleanPhone(phone: unknown, whatsapp: unknown) {
  const direct = String(phone ?? "").trim();
  if (direct) return direct;
  const raw = String(whatsapp ?? "").trim();
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  const local = raw.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(local) && raw.includes("@s.whatsapp.net") ? `+${local}` : "";
}

function winTypeLabel(value: unknown) {
  const type = String(value ?? "").toLowerCase();
  if (type.includes("buyout") || type.includes("arremate")) return "ARREMATE";
  if (type.includes("bid") || type.includes("highest")) return "Maior lance";
  return type ? String(value) : "Venda";
}

function asDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).height = 24;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18243D" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, sheet.columnCount) } };
  for (let row = 2; row <= sheet.rowCount; row++) {
    sheet.getRow(row).alignment = { vertical: "middle" };
    if (row % 2 === 0) {
      sheet.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
    }
  }
}

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const data = await snapshot(db);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Leilão Pokémon";
    workbook.created = new Date();

    const confirmedPurchases = data.purchases
      .filter(p => p.status === "confirmed")
      .sort((a, b) => String(b.confirmed_at ?? "").localeCompare(String(a.confirmed_at ?? "")));

    // Primeira aba: visão limpa para uso diário e fechamento das vendas.
    const sales = workbook.addWorksheet("Vendas");
    sales.columns = [
      { header: "Lote", key: "lot", width: 10 },
      { header: "Carta", key: "card", width: 30 },
      { header: "Coleção", key: "collection", width: 22 },
      { header: "Número", key: "cardNumber", width: 14 },
      { header: "Comprador", key: "buyer", width: 28 },
      { header: "Telefone / WhatsApp", key: "phone", width: 24 },
      { header: "Valor", key: "amount", width: 16 },
      { header: "Tipo", key: "winType", width: 18 },
      { header: "Data da venda", key: "confirmedAt", width: 22 },
    ];

    for (const purchase of confirmedPurchases) {
      const auction = data.auctions.find(a => a.id === purchase.auction_id);
      const card = data.cards.find(c => c.id === purchase.card_id);
      const person = data.participants.find(p => p.id === purchase.participant_id);
      sales.addRow({
        lot: auction?.lot_number ?? "",
        card: card?.name ?? "",
        collection: card?.collection ?? "",
        cardNumber: card?.card_number ?? "",
        buyer: person?.display_name ?? "",
        phone: cleanPhone(person?.phone_e164, person?.whatsapp_id),
        amount: Number(purchase.amount ?? 0),
        winType: winTypeLabel(auction?.win_type),
        confirmedAt: asDate(purchase.confirmed_at),
      });
    }
    sales.getColumn("amount").numFmt = '"R$" #,##0.00';
    sales.getColumn("confirmedAt").numFmt = "dd/mm/yyyy hh:mm";
    styleSheet(sales);

    // Segunda aba: resumo rápido para conferência financeira.
    const totalRevenue = confirmedPurchases.reduce((total, purchase) => total + Number(purchase.amount ?? 0), 0);
    const uniqueBuyers = new Set(confirmedPurchases.map(p => String(p.participant_id ?? "")).filter(Boolean)).size;
    const summary = workbook.addWorksheet("Resumo");
    summary.columns = [
      { header: "Indicador", key: "metric", width: 34 },
      { header: "Valor", key: "value", width: 28 },
    ];
    summary.addRows([
      { metric: "Exportado em", value: new Date() },
      { metric: "Vendas confirmadas", value: confirmedPurchases.length },
      { metric: "Compradores únicos", value: uniqueBuyers },
      { metric: "Total vendido", value: totalRevenue },
      { metric: "Ticket médio", value: confirmedPurchases.length ? totalRevenue / confirmedPurchases.length : 0 },
      { metric: "Leilões cadastrados", value: data.auctions.length },
      { metric: "Participantes identificados", value: data.participants.length },
    ]);
    summary.getCell("B2").numFmt = "dd/mm/yyyy hh:mm";
    summary.getCell("B5").numFmt = '"R$" #,##0.00';
    summary.getCell("B6").numFmt = '"R$" #,##0.00';
    styleSheet(summary);

    // Abas técnicas continuam disponíveis para auditoria e conferência detalhada.
    for (const [table, title, columns] of sheets) {
      const sheet = workbook.addWorksheet(title);
      sheet.columns = columns.map(([header, key]) => ({
        header,
        key,
        width: key === "payload" ? 70 : key === "id" || key.endsWith("_id") ? 38 : 24,
      }));

      for (const row of data[table]) {
        const participantId = row.participant_id ?? row.winner_participant_id;
        const person = data.participants.find(p => p.id === participantId);
        const enriched = {
          ...row,
          card_name: data.cards.find(c => c.id === row.card_id)?.name ?? "",
          participant_name: person?.display_name ?? "",
          participant_whatsapp: person?.whatsapp_id ?? "",
          participant_phone: cleanPhone(person?.phone_e164, person?.whatsapp_id),
        };
        sheet.addRow(Object.fromEntries(Object.entries(enriched).map(([key, value]) => [
          key,
          value !== null && typeof value === "object" ? JSON.stringify(value) : value,
        ])));
      }

      for (const [, key] of columns) {
        if (["amount", "starting_price", "buyout_price", "final_price"].includes(key)) {
          sheet.getColumn(key).numFmt = '"R$" #,##0.00';
        }
      }
      styleSheet(sheet);
    }

    return new Response(Buffer.from(await workbook.xlsx.writeBuffer()), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="leilao-pokemon.xlsx"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
