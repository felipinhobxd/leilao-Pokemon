import ExcelJS from "exceljs";
import { authorize, failure, snapshot, type Table } from "@/lib/backend";
export const runtime = "nodejs";
const sheets: [Table, string, [string, string][]][] = [
  ["cards", "Cartas", [["ID","id"],["Nome","name"],["Coleção","collection"],["Número","card_number"],["Imagem","image_url"],["Preço inicial","starting_price"],["ARREMATE","buyout_price"],["Status","status"],["Observações","notes"]]],
  ["participants", "Participantes", [["ID","id"],["Nome","display_name"],["WhatsApp","whatsapp_id"],["Telefone","phone_e164"],["Status","status"],["Suspensão até","suspension_until"],["Observações","notes"]]],
  ["auctions", "Leilões", [["ID","id"],["Carta","card_name"],["ID carta","card_id"],["Status","status"],["Inicial","starting_price"],["ARREMATE","buyout_price"],["Vencedor","participant_name"],["Valor final","final_price"],["Tipo de vitória","win_type"],["Início","started_at"],["Prazo","scheduled_end_at"],["Fim","ended_at"]]],
  ["bids", "Lances", [["ID","id"],["Leilão","auction_id"],["Participante","participant_name"],["Valor","amount"],["Tipo","kind"],["Status","status"],["Confirmado em","processed_at"],["Ordem","confirmation_order"],["Evento externo","whatsapp_event_id"],["Substituído por","replaced_by"]]],
  ["purchases", "Compras", [["ID","id"],["Leilão","auction_id"],["Carta","card_name"],["Comprador","participant_name"],["Valor","amount"],["Status","status"],["Confirmada em","confirmed_at"]]],
  ["payments", "Pagamentos", [["ID","id"],["Compra","purchase_id"],["Valor","amount"],["Status","status"],["Método","method"],["Pago em","paid_at"],["Referência","reference"]]],
  ["deliveries", "Entregas", [["ID","id"],["Compra","purchase_id"],["Status","status"],["Rastreio","tracking_code"],["Enviado em","shipped_at"],["Entregue em","delivered_at"],["Observações","notes"]]],
  ["warnings", "Advertências", [["ID","id"],["Participante","participant_name"],["Leilão","auction_id"],["Tipo","type"],["Motivo","reason"],["Ativa","active"],["Início","starts_at"],["Fim","ends_at"]]],
  ["auction_events", "Auditoria", [["ID","id"],["Leilão","auction_id"],["Participante","participant_name"],["Administrador","admin_user_id"],["Evento","event_type"],["ID externo","external_event_id"],["Ocorrido em","occurred_at"],["Registrado em","created_at"],["Detalhes","payload"]]],
];
export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const data = await snapshot(db);
    const workbook = new ExcelJS.Workbook(); workbook.creator = "Leilão Pokémon"; workbook.created = new Date();
    const summary = workbook.addWorksheet("Resumo");
    summary.columns = [{ header: "Indicador", key: "metric", width: 32 }, { header: "Valor", key: "value", width: 32 }];
    summary.addRows([{ metric: "Exportado em (UTC)", value: new Date().toISOString() }, { metric: "Leilões", value: data.auctions.length }, { metric: "Participantes", value: data.participants.length }, { metric: "Compras confirmadas (R$)", value: data.purchases.filter(p=>p.status==="confirmed").reduce((total,p)=>total+Number(p.amount),0) }]);
    for (const [table, title, columns] of sheets) {
      const sheet = workbook.addWorksheet(title);
      sheet.columns = columns.map(([header,key])=>({header,key,width:key==="payload"?70:key==="id"||key.endsWith("_id")?38:26}));
      for (const row of data[table]) {
        const enriched = { ...row, card_name: data.cards.find(c=>c.id===row.card_id)?.name ?? "", participant_name: data.participants.find(p=>p.id===(row.participant_id??row.winner_participant_id))?.display_name ?? "" };
        // ExcelJS stores strings as literal cells, never formula objects.
        sheet.addRow(Object.fromEntries(Object.entries(enriched).map(([k,v])=>[k,v!==null&&typeof v==="object"?JSON.stringify(v):v])));
      }
      for (const [,key] of columns) if (["amount","starting_price","buyout_price","final_price"].includes(key)) sheet.getColumn(key).numFmt = '"R$" #,##0.00';
    }
    for (const sheet of workbook.worksheets) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18243D" } };
      sheet.autoFilter = { from: {row:1,column:1}, to: {row:sheet.rowCount,column:sheet.columnCount} };
    }
    return new Response(Buffer.from(await workbook.xlsx.writeBuffer()), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="leilao-pokemon.xlsx"', "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
