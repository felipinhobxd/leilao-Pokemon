import ExcelJS from "exceljs";
import { authorize, failure, snapshot, type Table } from "@/lib/backend";
import { excelBrasiliaDate } from "@/lib/brasilia-time";
import { buildChangeRows, buildSalesRows, buildSummaryRows, changeKindLabel, cleanPhone, excelDateValue } from "@/lib/export-rows";

export const runtime = "nodejs";

const sheets: [Table, string, [string, string][]][] = [
  ["cards", "Cartas", [["ID","id"],["Nome","name"],["Número","card_number"],["Variante","variant"],["Imagem","image_url"],["Preço inicial","starting_price"],["ARREMATE","buyout_price"],["Status","status"],["Observações","notes"]]],
  ["participants", "Participantes", [["ID","id"],["Nome","display_name"],["Telefone","phone_e164"],["WhatsApp técnico","whatsapp_id"],["Status","status"],["Primeiro voto","first_seen_at"],["Último voto","last_seen_at"],["Observações","notes"]]],
  ["auctions", "Leilões", [["ID","id"],["Lote","lot_number"],["Carta","card_name"],["ID carta","card_id"],["Status","status"],["Inicial","starting_price"],["ARREMATE","buyout_price"],["Vencedor","participant_name"],["Telefone vencedor","participant_phone"],["WhatsApp técnico","participant_whatsapp"],["Valor final","final_price"],["Tipo de vitória","win_type"],["Início","started_at"],["Prazo","scheduled_end_at"],["Fim","ended_at"]]],
  ["bids", "Lances", [["ID","id"],["Leilão","auction_id"],["Participante","participant_name"],["Telefone","participant_phone"],["WhatsApp técnico","participant_whatsapp"],["Valor","amount"],["Tipo","kind"],["Status","status"],["Confirmado em","processed_at"],["Ordem","confirmation_order"],["Evento externo","whatsapp_event_id"],["Substituído por","replaced_by"]]],
  ["purchases", "Compras", [["ID","id"],["Leilão","auction_id"],["Carta","card_name"],["Comprador","participant_name"],["Telefone comprador","participant_phone"],["WhatsApp técnico","participant_whatsapp"],["Valor","amount"],["Status","status"],["Confirmada em","confirmed_at"]]],
  ["payments", "Pagamentos", [["ID","id"],["Compra","purchase_id"],["Valor","amount"],["Status","status"],["Método","method"],["Pago em","paid_at"],["Referência","reference"]]],
  ["deliveries", "Entregas", [["ID","id"],["Compra","purchase_id"],["Status","status"],["Rastreio","tracking_code"],["Enviado em","shipped_at"],["Entregue em","delivered_at"],["Observações","notes"]]],
  ["warnings", "Advertências", [["ID","id"],["Participante","participant_name"],["Leilão","auction_id"],["Tipo","type"],["Motivo","reason"],["Ativa","active"],["Início","starts_at"],["Fim","ends_at"]]],
  ["value_change_log", "Alterações (bruto)", [["ID","id"],["Leilão","auction_id"],["Participante","participant_id"],["Valor anterior","previous_amount"],["Novo valor","new_amount"],["Diferença","difference"],["Como","change_kind"],["Evento externo","external_event_id"],["Quando","occurred_at"]]],
  ["participant_warnings", "Avisos globais (bruto)", [["ID","id"],["Participante","participant_id"],["Carta","card_name"],["Lote","lot_number"],["Valor anterior","previous_amount"],["Novo valor","new_amount"],["Como","change_kind"],["Evento externo","external_event_id"],["Quando","occurred_at"]]],
  ["auction_events", "Auditoria", [["ID","id"],["Leilão","auction_id"],["Participante","participant_name"],["WhatsApp","participant_whatsapp"],["Telefone","participant_phone"],["Administrador","admin_user_id"],["Evento","event_type"],["ID externo","external_event_id"],["Ocorrido em","occurred_at"],["Registrado em","created_at"],["Detalhes","payload"]]],
];

const dateKeys = new Set([
  "first_seen_at", "last_seen_at", "started_at", "scheduled_end_at", "ended_at",
  "processed_at", "confirmed_at", "paid_at", "shipped_at", "delivered_at",
  "starts_at", "ends_at", "occurred_at", "created_at", "updated_at", "suspension_until",
]);

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).height = 24;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18243D" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, sheet.columnCount) } };
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFD9DEE7" } },
    left: { style: "thin", color: { argb: "FFD9DEE7" } },
    bottom: { style: "thin", color: { argb: "FFD9DEE7" } },
    right: { style: "thin", color: { argb: "FFD9DEE7" } },
  };
  for (let row = 1; row <= sheet.rowCount; row++) {
    const active = sheet.getRow(row);
    active.alignment = { vertical: "middle" };
    active.eachCell({ includeEmpty: true }, cell => { cell.border = thinBorder; });
    if (row > 1 && row % 2 === 0) active.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
  }
}

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const data = await snapshot(db);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Leilão Pokémon";
    workbook.created = excelBrasiliaDate(new Date()) ?? new Date();

    // Lógica de linhas extraída para lib/export-rows.ts (testável via npm test).
    const { rows: salesRows, totalFormula } = buildSalesRows(data);

    const sales = workbook.addWorksheet("Vendas");
    sales.columns = [
      { header: "Lote", key: "lot", width: 8 },
      { header: "Carta", key: "card", width: 32 },
      { header: "Número", key: "cardNumber", width: 14 },
      { header: "Variante", key: "variant", width: 18 },
      { header: "Comprador", key: "buyer", width: 28 },
      { header: "Telefone / WhatsApp", key: "phone", width: 22 },
      { header: "Valor", key: "amount", width: 14 },
      { header: "Tipo", key: "winType", width: 16 },
      { header: "Avisos (global)", key: "globalWarnings", width: 14 },
      { header: "Pagamento", key: "payment", width: 16 },
      { header: "Data da venda", key: "confirmedAt", width: 22 },
      { header: "Observações", key: "notes", width: 34 },
    ];

    for (const row of salesRows) sales.addRow(row);
    sales.getColumn("amount").numFmt = '"R$" #,##0.00';
    sales.getColumn("confirmedAt").numFmt = "dd/mm/yyyy hh:mm:ss";
    // TOTAL: soma SOMENTE as linhas de valores (a fórmula cobre exatamente as
    // compras listadas — sem textos nem células soltas) e se atualiza sozinha
    // no Excel se algum valor for editado.
    if (totalFormula) {
      const totalRow = sales.addRow({ lot: "TOTAL", amount: totalFormula });
      totalRow.font = { bold: true };
      totalRow.getCell("amount").numFmt = '"R$" #,##0.00';
      totalRow.getCell("lot").font = { bold: true };
      totalRow.eachCell({ includeEmpty: true }, cell => { cell.border = { top: { style: "thin", color: { argb: "FF18243D" } } }; });
    }
    styleSheet(sales);

    // ---------------------------------------------------------------------------
    // "Alterações de valores": histórico detalhado de cada mudança de lance
    // (valor anterior, novo valor, diferença, quem, quando) + o total de avisos
    // GLOBAIS do usuário no momento da exportação.
    // ---------------------------------------------------------------------------
    const changes = workbook.addWorksheet("Alterações de valores");
    changes.columns = [
      { header: "Lote", key: "lot", width: 8 },
      { header: "Carta", key: "card", width: 32 },
      { header: "Participante", key: "buyer", width: 28 },
      { header: "Valor anterior", key: "previousAmount", width: 16 },
      { header: "Novo valor", key: "newAmount", width: 16 },
      { header: "Diferença", key: "difference", width: 14 },
      { header: "Avisos (global)", key: "globalWarnings", width: 14 },
      { header: "Redução (aviso)", key: "warning", width: 14 },
      { header: "Como", key: "how", width: 18 },
      { header: "Data e horário", key: "occurredAt", width: 22 },
    ];
    for (const row of buildChangeRows(data)) changes.addRow(row);
    for (const key of ["previousAmount", "newAmount", "difference"]) changes.getColumn(key).numFmt = '"R$" #,##0.00';
    changes.getColumn("occurredAt").numFmt = "dd/mm/yyyy hh:mm:ss";
    styleSheet(changes);

    const summary = workbook.addWorksheet("Resumo");
    summary.columns = [
      { header: "Indicador", key: "metric", width: 34 },
      { header: "Valor", key: "value", width: 28 },
    ];
    summary.addRows(buildSummaryRows(data));
    summary.getCell("B2").numFmt = "dd/mm/yyyy hh:mm:ss";
    summary.getCell("B5").numFmt = '"R$" #,##0.00';
    summary.getCell("B6").numFmt = '"R$" #,##0.00';
    styleSheet(summary);

    for (const [table, title, columns] of sheets) {
      const sheet = workbook.addWorksheet(title);
      sheet.columns = columns.map(([header, key]) => ({
        header,
        key,
        width: key === "payload" ? 70 : dateKeys.has(key) ? 24 : key === "id" || key.endsWith("_id") ? 38 : 24,
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
        sheet.addRow(Object.fromEntries(Object.entries(enriched).map(([key, value]) => {
          if (dateKeys.has(key)) return [key, excelDateValue(value)];
          if (key === "change_kind") return [key, changeKindLabel(value)];
          return [key, value !== null && typeof value === "object" ? JSON.stringify(value) : value];
        })));
      }

      for (const [, key] of columns) {
        if (["amount", "starting_price", "buyout_price", "final_price"].includes(key)) sheet.getColumn(key).numFmt = '"R$" #,##0.00';
        if (dateKeys.has(key)) sheet.getColumn(key).numFmt = "dd/mm/yyyy hh:mm:ss";
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
