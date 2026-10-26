import type { PendingCreation } from "./wizard-state.ts";
import { normalizeDraftCard, restoreDraftState } from "./auction-draft.ts";
import { toBrasiliaInput } from "./brasilia-time.ts";

type Kind = "single" | "batch";
type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;
type CreationResult = { queue?: { id: string }; auction?: { id: string; lot_number?: number } };
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value: unknown, fallback = "") => value == null ? fallback : String(value);

export class CreationRejectedError extends Error {}

/** Keep an uncertain operation frozen until either its result is recovered or
 * an explicit validation rejection is followed by confirmed absence. Callers
 * retain the event ID even after unlocking edits: a delayed old request must
 * never become a second creation under a different key. */
export async function submitAuctionCreation({ authFetch, kind, operation, retry }: {
  authFetch: AuthFetch; kind: Kind; operation: PendingCreation; retry: boolean;
}): Promise<CreationResult> {
  const target = kind === "batch" ? "queue" : "auction";
  function result(value: unknown): CreationResult {
    const data = record(value);
    if (typeof data[target]?.id !== "string" || !data[target].id.trim()) {
      throw new Error("A resposta não confirmou o identificador da criação. Confirme o envio anterior.");
    }
    return data;
  }
  async function recover() {
    const response = await authFetch(`/api/auctions/recover?eventId=${encodeURIComponent(operation.eventId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Não foi possível confirmar a tentativa anterior.");
    // A malformed/missing data field is not proof of absence.
    return body.data === null ? null : result(body.data);
  }
  if (retry) {
    const recovered = await recover();
    if (recovered) return recovered;
  }
  const response = await authFetch(kind === "batch" ? "/api/auctions/batch" : "/api/auctions/new", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...operation.payload, eventId: operation.eventId }),
  });
  const body = await response.json();
  if (response.ok) return result(body.data);
  const message = typeof body.error === "string" ? body.error : "Não foi possível confirmar a criação.";
  if ([400, 409, 415, 422].includes(response.status)) {
    // Check AFTER rejection too: an earlier attempt may have committed while
    // this request was being validated. Recovery uses the existing DB lock.
    const recovered = await recover();
    if (recovered) return recovered;
    throw new CreationRejectedError(`${message} A criação não foi encontrada; revise os dados e tente novamente.`);
  }
  throw new Error(message);
}

/** Rebuild editable fields from the same frozen payload after a page reload.
 * Only published image URLs are recoverable; File/blob previews are not. */
export function restoreCreationCard(value: unknown) {
  const item = record(value), card = record(item.card), auction = record(item.auction), game = record(item.giveaway);
  return normalizeDraftCard({
    name: text(card.name), collection: text(card.collection), cardNumber: text(card.card_number),
    variant: text(card.variant, "Normal"), condition: text(card.condition), language: text(card.language, "pt-BR"),
    imageUrl: text(card.image_url), extraImages: card.extra_images,
    lotNumber: text(auction.lot_number, "1"), startingPrice: text(auction.starting_price, "5"),
    increment: text(auction.bid_increment, "1"), buyout: text(auction.buyout_price),
    optionCount: text(auction.option_count, "6"), durationMinutes: text(Number(auction.duration_seconds ?? 120) / 60),
    pricingMode: auction.pricing_mode, customValues: Array.isArray(auction.custom_values) ? auction.custom_values.join(", ") : "",
    customBuyoutLast: auction.custom_buyout_last !== false,
    giveaway: Boolean(item.giveaway), giveawayKind: game.kind,
    giveawayOptions: Array.isArray(game.options) ? game.options.join("\n") : "",
    giveawayCorrectIndex: text(game.correctIndex), giveawayQuestion: text(game.question),
  });
}

export function restoreBatchCreation(payload: Record<string, unknown>) {
  const queue = record(payload.queue);
  const cards = Array.isArray(payload.items) ? payload.items.map(restoreCreationCard) : [];
  return restoreDraftState({ version: 1, step: 1, cards,
    firstLot: cards.find(card => !card.giveaway)?.lotNumber ?? "1", groupId: text(queue.group_id),
    intervalValue: text(queue.interval_seconds, "30"), intervalUnit: "seconds",
    publication: "scheduled", scheduledInput: toBrasiliaInput(text(queue.starts_at)),
    endMode: queue.ends_at ? "common" : "duration", commonEndInput: queue.ends_at ? toBrasiliaInput(text(queue.ends_at)) : "",
  });
}
