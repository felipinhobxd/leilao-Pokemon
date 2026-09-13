import ExcelJS from "exceljs";
import { demoAuction, demoEvents } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Leilão Pokémon";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Resumo", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    { header: "Indicador", key: "metric", width: 30 },
    { header: "Valor", key: "value", width: 24 },
  ];
  summary.addRows([
    { metric: "Leilões na exportação", value: 1 },
    { metric: "Participantes", value: demoAuction.participants },
    { metric: "Lances", value: demoAuction.bids },
    { metric: "Maior lance", value: demoAuction.highestBid ?? 0 },
    { metric: "Valor de arremate", value: demoAuction.buyoutPrice ?? 0 },
  ]);

  const auctions = workbook.addWorksheet("Leilões", { views: [{ state: "frozen", ySplit: 1 }] });
  auctions.columns = [
    { header: "ID", key: "id", width: 18 },
    { header: "Carta", key: "card", width: 28 },
    { header: "Coleção", key: "collection", width: 16 },
    { header: "Número", key: "number", width: 15 },
    { header: "Status", key: "status", width: 16 },
    { header: "Preço inicial", key: "starting", width: 18 },
    { header: "Maior lance", key: "highest", width: 18 },
    { header: "Arremate", key: "buyout", width: 18 },
    { header: "Líder", key: "leader", width: 22 },
  ];
  auctions.addRow({
    id: demoAuction.id,
    card: demoAuction.cardName,
    collection: demoAuction.collection,
    number: demoAuction.cardNumber,
    status: demoAuction.status,
    starting: demoAuction.startingPrice,
    highest: demoAuction.highestBid,
    buyout: demoAuction.buyoutPrice,
    leader: demoAuction.leader,
  });

  const events = workbook.addWorksheet("Eventos", { views: [{ state: "frozen", ySplit: 1 }] });
  events.columns = [
    { header: "Horário", key: "time", width: 16 },
    { header: "Participante", key: "actor", width: 24 },
    { header: "Evento", key: "label", width: 35 },
    { header: "Valor", key: "amount", width: 18 },
  ];
  events.addRows(demoEvents);

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + sheet.columnCount)}1` };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { vertical: "middle" };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leilao-pokemon-demo.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
