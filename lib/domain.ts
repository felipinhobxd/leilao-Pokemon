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

export const demoAuction: AuctionSummary = {
  id: "DEMO-001",
  cardName: "Charizard ex",
  collection: "151",
  cardNumber: "199/165",
  imageUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
  status: "open",
  startingPrice: 50,
  buyoutPrice: 120,
  highestBid: 80,
  leader: "Maria",
  participants: 7,
  bids: 14,
  endsAt: "21:30",
};

export const demoEvents: AuctionEvent[] = [
  { id: "1", time: "21:08:14", actor: "Maria", label: "Novo maior lance", amount: 80, tone: "positive" },
  { id: "2", time: "21:07:51", actor: "João", label: "Alterou o lance", amount: 70, tone: "neutral" },
  { id: "3", time: "21:06:32", actor: "Lucas", label: "Retirou o lance de R$ 65", tone: "warning" },
  { id: "4", time: "21:05:11", actor: "Maria", label: "Novo lance", amount: 60, tone: "neutral" },
];

export function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
