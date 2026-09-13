export type PollOption = { label: string; amount: number; isBuyout: boolean };

export const cardConditions = [
  "NM — Near Mint",
  "LP/SP — Levemente jogada",
  "MP — Moderadamente jogada",
  "HP — Muito jogada",
  "DMG — Danificada",
] as const;

export const cardLanguages = [
  { value: "pt-BR", label: "PT-BR 🇧🇷" },
  { value: "en", label: "EN 🇺🇸" },
  { value: "ja", label: "JP 🇯🇵" },
  { value: "es", label: "ES 🇪🇸" },
] as const;

const cents = (value: number) => Math.round(value * 100) / 100;
const label = (value: number) => `R$ ${value.toFixed(2).replace(".", ",")}`;

export function buildPollOptions(startingPrice: number, increment: number, buyoutPrice: number | null): PollOption[] {
  if (!Number.isFinite(startingPrice) || startingPrice < 0) return [];
  if (!Number.isFinite(increment) || increment <= 0) return [];
  if (buyoutPrice != null && (!Number.isFinite(buyoutPrice) || buyoutPrice < startingPrice)) return [];

  const options: PollOption[] = [];
  const regularLimit = buyoutPrice == null ? 12 : 11;
  let amount = cents(startingPrice);

  while (options.length < regularLimit) {
    if (buyoutPrice != null && amount >= cents(buyoutPrice)) break;
    options.push({ label: label(amount), amount, isBuyout: false });
    amount = cents(amount + increment);
  }

  if (buyoutPrice != null) {
    const buyout = cents(buyoutPrice);
    options.push({ label: `${label(buyout)} 🦭`, amount: buyout, isBuyout: true });
  }

  return options;
}
