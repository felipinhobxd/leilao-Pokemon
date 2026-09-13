export type AuctionStatus = "draft" | "open" | "sold" | "closed" | "cancelled" | "review_required";
export type BidStatus = "active" | "withdrawn" | "replaced" | "rejected" | "late";
export type BidKind = "bid" | "buyout";

export type AuctionSummary = {
  id: string;
  cardName: string;
  collection: string;
  cardNumber: string;
  imageUrl: string;
  status: AuctionStatus;
  startingPrice: number;
  buyoutPrice: number | null;
  highestBid: number | null;
  leader: string | null;
  participants: number;
  bids: number;
  endsAt: string;
};

export type AuctionEvent = {
  id: string;
  time: string;
  actor: string;
  label: string;
  amount?: number;
  tone: "neutral" | "positive" | "warning";
};

export function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
