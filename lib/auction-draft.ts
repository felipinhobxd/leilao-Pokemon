import { cardConditions, cardLanguages, GIVEAWAY_DEFAULT_OPTIONS } from "./auction-wizard.ts";

// Rascunho do wizard em lote: snapshot serializável do estado da tela para o
// operador continuar a programação do leilão em outra sessão/navegador. As
// FOTOS não vão no payload — no momento do salvar elas já foram enviadas ao
// Storage e o rascunho guarda as URLs HTTPS (é o que torna a restauração
// possível em qualquer máquina). Contract: POST /api/auctions/drafts → RPC
// upsert_auction_draft (mesmas regras de tamanho/contagem aplicadas no banco).

export const AUCTION_DRAFT_VERSION = 1;
export const AUCTION_DRAFT_MAX_CARDS = 200;
export const AUCTION_DRAFT_MAX_CANDIDATES = 5;
export const AUCTION_DRAFT_MAX_MESSAGE_CHARS = 300;
export const AUCTION_DRAFT_MAX_BYTES = 512 * 1024;

export type AuctionDraftCandidate = {
  id: string;
  name: string;
  collection: string;
  cardNumber: string;
  localId: string;
  denominator: number | null;
  language: string;
  variant: string | null;
  score: number;
};

export type AuctionDraftManualField = "name" | "collection" | "cardNumber" | "language" | "variant";

export type AuctionDraftCard = {
  imageUrl: string;
  extraImages: string[];
  name: string;
  collection: string;
  cardNumber: string;
  variant: string;
  condition: string;
  language: string;
  pricingMode: "increment" | "custom";
  customValues: string;
  customBuyoutLast: boolean;
  // Brinde: a carta vira enquete de brinde no lugar do leilão (foto + enquete
  // "quem clicar primeiro leva"); opções livres pré-preenchidas e editáveis.
  giveaway: boolean;
  giveawayOptions: string;
  lotNumber: string;
  startingPrice: string;
  increment: string;
  buyout: string;
  durationMinutes: string;
  optionCount: string;
  // Apenas estágios TERMINAIS sobrevivem ao rascunho: os transitórios
  // (queued/analyzing) dizem respeito à sessão que os criou.
  recognitionStage: "identified" | "review" | "not-found" | "error" | "idle";
  recognitionMessage: string;
  recognitionCandidates: AuctionDraftCandidate[];
  manualFields: Partial<Record<AuctionDraftManualField, boolean>>;
};

export type AuctionDraftState = {
  version: number;
  step: number;
  firstLot: string;
  groupId: string;
  intervalValue: string;
  intervalUnit: "seconds" | "minutes";
  publication: "now" | "scheduled";
  scheduledInput: string;
  cards: AuctionDraftCard[];
};

const manualFieldKeys = new Set<AuctionDraftManualField>(["name", "collection", "cardNumber", "language", "variant"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback = "") => {
  const result = typeof value === "string" ? value.trim() : "";
  return result || fallback;
};
const clampStep = (value: unknown) => {
  const step = Number(value);
  if (!Number.isSafeInteger(step)) return 1;
  return Math.min(4, Math.max(1, step));
};

function normalizeStage(value: unknown): AuctionDraftCard["recognitionStage"] {
  return value === "identified" || value === "review" || value === "not-found" || value === "error" ? value : "idle";
}

function normalizeCandidate(raw: unknown): AuctionDraftCandidate | null {
  if (!isObject(raw)) return null;
  const denominator = Number(raw.denominator);
  const score = Number(raw.score);
  if (!text(raw.id) || !text(raw.name)) return null;
  return {
    id: text(raw.id),
    name: text(raw.name),
    collection: text(raw.collection),
    cardNumber: text(raw.cardNumber),
    localId: text(raw.localId),
    denominator: Number.isFinite(denominator) ? denominator : null,
    language: text(raw.language, "en"),
    variant: typeof raw.variant === "string" && raw.variant.trim() ? raw.variant.trim() : null,
    score: Number.isFinite(score) ? score : 0,
  };
}

function normalizeCandidates(raw: unknown): AuctionDraftCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeCandidate)
    .filter((candidate): candidate is AuctionDraftCandidate => candidate !== null)
    .slice(0, AUCTION_DRAFT_MAX_CANDIDATES);
}

function normalizeManualFields(raw: unknown): AuctionDraftCard["manualFields"] {
  if (!isObject(raw)) return {};
  const output: AuctionDraftCard["manualFields"] = {};
  for (const key of manualFieldKeys) if (raw[key] === true) output[key] = true;
  return output;
}

/** Whitelist + defaults: o mesmo caminho normaliza o que o wizard envia e o
 * JSON guardado no banco, então restore(build(x)) é estável por construção. */
export function normalizeDraftCard(raw: unknown): AuctionDraftCard {
  if (!isObject(raw)) throw new Error("Rascunho corrompido (carta inválida).");
  const condition = text(raw.condition, cardConditions[0]);
  const language = text(raw.language, "pt-BR");
  return {
    imageUrl: text(raw.imageUrl),
    // extraImages só é escrita pelo uploader (sempre HTTPS do Storage) —
    // valor não-HTTPS indica payload adulterado/corrompido: descarta.
    extraImages: Array.isArray(raw.extraImages) ? raw.extraImages.map(value => text(value)).filter(value => /^https:\/\//i.test(value)).slice(0, 4) : [],
    name: text(raw.name),
    collection: text(raw.collection),
    cardNumber: text(raw.cardNumber),
    variant: text(raw.variant, "Normal"),
    condition: (cardConditions as readonly string[]).includes(condition) ? condition : cardConditions[0],
    language: cardLanguages.some(item => item.value === language) ? language : "other",
    pricingMode: raw.pricingMode === "custom" ? "custom" : "increment",
    customValues: text(raw.customValues),
    customBuyoutLast: raw.customBuyoutLast !== false,
    giveaway: raw.giveaway === true,
    giveawayOptions: text(raw.giveawayOptions, GIVEAWAY_DEFAULT_OPTIONS),
    lotNumber: text(raw.lotNumber, "1"),
    startingPrice: text(raw.startingPrice),
    increment: text(raw.increment),
    buyout: text(raw.buyout),
    durationMinutes: text(raw.durationMinutes),
    optionCount: text(raw.optionCount),
    recognitionStage: normalizeStage(raw.recognitionStage),
    recognitionMessage: text(raw.recognitionMessage).slice(0, AUCTION_DRAFT_MAX_MESSAGE_CHARS),
    recognitionCandidates: normalizeCandidates(raw.recognitionCandidates),
    manualFields: normalizeManualFields(raw.manualFields),
  };
}

export type AuctionDraftCardSource = {
  imageUrl: string;
  extraImages: string[];
  name: string;
  collection: string;
  cardNumber: string;
  variant: string;
  condition: string;
  language: string;
  pricingMode: string;
  customValues: string;
  customBuyoutLast: boolean;
  giveaway: boolean;
  giveawayOptions: string;
  lotNumber: string;
  startingPrice: string;
  increment: string;
  buyout: string;
  durationMinutes: string;
  optionCount: string;
  recognitionStage: string;
  recognitionMessage: string;
  recognitionCandidates: unknown;
  manualFields: unknown;
};

export function buildDraftState(input: {
  step: number;
  firstLot: string;
  groupId: string;
  intervalValue: string;
  intervalUnit: string;
  publication: string;
  scheduledInput: string;
  cards: readonly AuctionDraftCardSource[];
}): AuctionDraftState {
  if (!Array.isArray(input.cards) || !input.cards.length) throw new Error("Adicione pelo menos uma carta antes de salvar o rascunho.");
  if (input.cards.length > AUCTION_DRAFT_MAX_CARDS) throw new Error(`O rascunho aceita no máximo ${AUCTION_DRAFT_MAX_CARDS} cartas.`);
  return {
    version: AUCTION_DRAFT_VERSION,
    step: clampStep(input.step),
    firstLot: text(input.firstLot, "1"),
    groupId: text(input.groupId),
    intervalValue: text(input.intervalValue, "30"),
    intervalUnit: input.intervalUnit === "minutes" ? "minutes" : "seconds",
    publication: input.publication === "scheduled" ? "scheduled" : "now",
    scheduledInput: text(input.scheduledInput),
    cards: input.cards.map(normalizeDraftCard),
  };
}

export function restoreDraftState(raw: unknown): AuctionDraftState {
  if (!isObject(raw)) throw new Error("Rascunho corrompido.");
  if (raw.version !== AUCTION_DRAFT_VERSION) throw new Error("Rascunho de uma versão não suportada — atualize o painel e tente de novo.");
  if (!Array.isArray(raw.cards) || !raw.cards.length) throw new Error("Rascunho sem cartas.");
  if (raw.cards.length > AUCTION_DRAFT_MAX_CARDS) throw new Error(`Rascunho com cartas demais (máximo ${AUCTION_DRAFT_MAX_CARDS}).`);
  return buildDraftState({
    step: clampStep(raw.step),
    firstLot: text(raw.firstLot, "1"),
    groupId: text(raw.groupId),
    intervalValue: text(raw.intervalValue, "30"),
    intervalUnit: raw.intervalUnit === "minutes" ? "minutes" : "seconds",
    publication: raw.publication === "scheduled" ? "scheduled" : "now",
    scheduledInput: text(raw.scheduledInput),
    cards: raw.cards as AuctionDraftCardSource[],
  });
}

export function buildDraftTitle(when: Date, cardCount: number): string {
  const stamp = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(when).replace(",", "");
  const count = Number.isSafeInteger(cardCount) && cardCount > 0 ? cardCount : 0;
  return `Rascunho de ${stamp} · ${count} carta${count === 1 ? "" : "s"}`;
}

export function auctionDraftJson(state: AuctionDraftState): string {
  return JSON.stringify(state);
}
