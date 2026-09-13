export const eventTypes = ["BID_PLACED", "BID_CHANGED", "BID_WITHDRAWN", "BUYOUT_REQUESTED", "BUYOUT_CONFIRMED"] as const;
export const commandTypes = [...eventTypes, "CARD_CREATE", "CARD_UPDATE", "CARD_DELETE", "PARTICIPANT_CREATE", "PARTICIPANT_UPDATE", "PARTICIPANT_DELETE", "AUCTION_CREATE", "AUCTION_UPDATE", "AUCTION_DELETE", "AUCTION_OPEN", "AUCTION_FINALIZE"] as const;
export type Command = {
  type: typeof commandTypes[number]; eventId: string; id?: string;
  auctionId?: string; participantId?: string; amount?: number;
  occurredAt?: string; data?: Record<string, unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validMoney(value: unknown, nullable = false): boolean {
  return (nullable && value === null) || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 9999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001);
}
export function parseCommand(value: unknown): Command {
  const fail = () => { throw new Error("Comando inválido. Confira os campos e os valores."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const c = value as Command;
  if (!commandTypes.includes(c.type) || typeof c.eventId !== "string" || !c.eventId.trim() || c.eventId.length > 200) return fail();
  if (Object.keys(c).some(k => !["type", "eventId", "id", "auctionId", "participantId", "amount", "occurredAt", "data"].includes(k))) return fail();
  for (const key of ["id", "auctionId", "participantId"] as const) if (c[key] !== undefined && (typeof c[key] !== "string" || !uuid.test(c[key]))) return fail();
  if (c.occurredAt !== undefined && (typeof c.occurredAt !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(c.occurredAt) || !Number.isFinite(Date.parse(c.occurredAt)))) return fail();
  const event = (eventTypes as readonly string[]).includes(c.type);
  if ((event || (c.type.startsWith("AUCTION_") && c.type !== "AUCTION_CREATE")) && !c.auctionId) return fail();
  if (event && !c.participantId) return fail();
  if (["BID_PLACED", "BID_CHANGED"].includes(c.type) && !validMoney(c.amount)) return fail();
  if (/^(CARD|PARTICIPANT)_(UPDATE|DELETE)$/.test(c.type) && !c.id) return fail();
  if (c.type.endsWith("CREATE") || c.type.endsWith("UPDATE")) {
    const d = c.data;
    if (!d || typeof d !== "object" || Array.isArray(d)) return fail();
    const text = (key: string) => typeof d[key] === "string" && (d[key] as string).trim().length > 0 && (d[key] as string).length <= 200;
    for (const v of Object.values(d)) if (typeof v === "string" && v.length > 2000) return fail();
    if (c.type.startsWith("CARD_") || c.type === "AUCTION_UPDATE") {
      if (!validMoney(d.starting_price) || !validMoney(d.buyout_price, true) || (d.buyout_price !== null && Number(d.buyout_price) < Number(d.starting_price))) return fail();
    }
    if (c.type.startsWith("CARD_")) {
      if (!text("name")) return fail();
      if (d.image_url && (typeof d.image_url !== "string" || !/^https:\/\//.test(d.image_url))) return fail();
    }
    if (c.type.startsWith("PARTICIPANT_") && (!text("display_name") || !text("whatsapp_id") || !["active", "suspended", "banned"].includes(String(d.status)))) return fail();
    if (c.type === "AUCTION_CREATE" && (typeof d.card_id !== "string" || !uuid.test(d.card_id))) return fail();
    if (d.scheduled_end_at != null && (typeof d.scheduled_end_at !== "string" || !Number.isFinite(Date.parse(d.scheduled_end_at)))) return fail();
  }
  return c;
}
