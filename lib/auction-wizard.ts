export type PollOption = { label: string; amount: number; isBuyout: boolean };
export type PollPlan = { options: PollOption[]; overflow: boolean; minimumIncrement: number | null; optionCount: number };

export const MAX_POLL_OPTIONS = 12;
export const DEFAULT_POLL_OPTIONS = 6;

export const cardConditions = [
  "NM — Near Mint",
  "LP/SP — Levemente jogada",
  "MP — Moderadamente jogada",
  "HP — Muito jogada",
  "DMG — Danificada",
] as const;

export const cardLanguages = [
  { value: "pt-BR", label: "Português 🇧🇷", flag: "🇧🇷" },
  { value: "en", label: "Inglês 🇺🇸", flag: "🇺🇸" },
  { value: "ja", label: "Japonês 🇯🇵", flag: "🇯🇵" },
  { value: "es", label: "Espanhol 🇪🇸", flag: "🇪🇸" },
  { value: "other", label: "Outro 🌐", flag: "🌐" },
] as const;

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;
const label = (value: number) => `R$ ${value.toFixed(2).replace(".", ",")}`;

export function conditionCode(condition: string | null | undefined) {
  const value = String(condition ?? "").trim();
  if (!value) return "";
  return value.split(/\s+[—-]\s+/)[0]?.trim() ?? value;
}

export function languageFlag(language: string | null | undefined) {
  return cardLanguages.find(item => item.value === language)?.flag ?? "";
}

export function buildAuctionCaption(input: { lotNumber: number | string; name: string; cardNumber?: string | null; condition?: string | null; language?: string | null }) {
  const number = String(input.cardNumber ?? "").trim();
  const condition = conditionCode(input.condition);
  const flag = languageFlag(input.language);
  return `♡ ${input.lotNumber}. ${String(input.name).trim()}${number ? ` (${number})` : ""}${condition ? ` ${condition}` : ""}${flag ? ` ${flag}` : ""}\n· ☆`;
}

export function buildPollTitle(lotNumber: number | string) {
  return `${lotNumber}. Lances`;
}

export function minimumIncrementForBuyout(startingPrice: number, buyoutPrice: number): number | null {
  if (!Number.isFinite(startingPrice) || !Number.isFinite(buyoutPrice) || buyoutPrice <= startingPrice) return null;
  const gap = toCents(buyoutPrice) - toCents(startingPrice);
  const regularSlots = MAX_POLL_OPTIONS - 1;
  return fromCents(Math.max(1, Math.ceil(gap / regularSlots)));
}

export function buildPollPlan(startingPrice: number, increment: number, buyoutPrice: number | null, requestedOptionCount = DEFAULT_POLL_OPTIONS): PollPlan {
  if (!Number.isFinite(startingPrice) || startingPrice < 0 || !Number.isFinite(increment) || increment <= 0) {
    return { options: [], overflow: false, minimumIncrement: null, optionCount: 0 };
  }
  if (buyoutPrice != null && (!Number.isFinite(buyoutPrice) || buyoutPrice <= startingPrice)) {
    // buyout == starting price would produce a degenerate single-option poll
    // (ARREMATE-only): the batch route already rejects it — the plan builder
    // must agree instead of silently emitting one option.
    return { options: [], overflow: false, minimumIncrement: null, optionCount: 0 };
  }

  const startCents = toCents(startingPrice);
  const incrementCents = Math.max(1, toCents(increment));

  if (buyoutPrice == null) {
    const count = Number(requestedOptionCount);
    if (!Number.isSafeInteger(count) || count < 2 || count > MAX_POLL_OPTIONS) {
      return { options: [], overflow: count > MAX_POLL_OPTIONS, minimumIncrement: null, optionCount: Number.isFinite(count) ? count : 0 };
    }
    const options = Array.from({ length: count }, (_, index) => {
      const amount = fromCents(startCents + incrementCents * index);
      return { label: label(amount), amount, isBuyout: false };
    });
    return { options, overflow: false, minimumIncrement: null, optionCount: options.length };
  }

  const buyoutCents = toCents(buyoutPrice);
  const gap = buyoutCents - startCents;
  const regularCount = gap <= 0 ? 0 : Math.ceil(gap / incrementCents);
  const total = regularCount + 1;
  if (total > MAX_POLL_OPTIONS) {
    return { options: [], overflow: true, minimumIncrement: minimumIncrementForBuyout(startingPrice, buyoutPrice), optionCount: total };
  }

  const options: PollOption[] = [];
  for (let index = 0; index < regularCount; index++) {
    const amount = fromCents(startCents + incrementCents * index);
    if (toCents(amount) >= buyoutCents) break;
    options.push({ label: label(amount), amount, isBuyout: false });
  }
  const buyout = fromCents(buyoutCents);
  options.push({ label: `${label(buyout)} 🦭`, amount: buyout, isBuyout: true });
  return { options, overflow: false, minimumIncrement: null, optionCount: options.length };
}

export function buildPollOptions(startingPrice: number, increment: number, buyoutPrice: number | null, requestedOptionCount = DEFAULT_POLL_OPTIONS): PollOption[] {
  return buildPollPlan(startingPrice, increment, buyoutPrice, requestedOptionCount).options;
}
