export type PollOption = { label: string; amount: number; isBuyout: boolean };
export type PollPlan = { options: PollOption[]; overflow: boolean; minimumIncrement: number | null; optionCount: number };

export const MAX_POLL_OPTIONS = 12;
export const DEFAULT_POLL_OPTIONS = 6;

// Brinde (P-07, decisão do operador 2026-09-24): a carta marcada como brinde
// vira enquete de brinde no lugar do leilão — "quem clicar primeiro leva".
// Opções livres de texto/emoji, pré-preenchidas e editáveis por carta.
export const GIVEAWAY_DEFAULT_OPTIONS = "Quero! 🙋\nTô dentro 🔥\nBora! 🎉";

export const cardConditions = [
  "NM — Near Mint",
  "LP/SP — Levemente jogada",
  "MP — Moderadamente jogada",
  "HP — Muito jogada",
  "DMG — Danificada",
] as const;

// Idiomas de operação do leilão (decisão do operador 2026-09-24: espanhol
// NÃO faz parte — sem ele no dropdown a API rejeita lotes es novos; dados
// legados com es continuam renderizando via mapLanguage/languageFlag).
export const cardLanguages = [
  { value: "pt-BR", label: "Português 🇧🇷", flag: "🇧🇷" },
  { value: "en", label: "Inglês 🇺🇸", flag: "🇺🇸" },
  { value: "ja", label: "Japonês 🇯🇵", flag: "🇯🇵" },
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

// ---------------------------------------------------------------------------
// Valores personalizados: em vez de incrementos automáticos, o operador digita
// exatamente os valores da enquete ("1, 2, 5, 10"). O primeiro valor é o lance
// inicial; o maior valor pode ser marcado como ARREMATE. O incremento do leilão
// passa a ser o MENOR intervalo entre valores consecutivos — o guard do banco
// exige novo lance >= maior lance + incremento, e com o menor intervalo toda
// opção seguinte da lista sempre passa.
// ---------------------------------------------------------------------------

export type CustomValuesPlan = {
  options: PollOption[];
  startingPrice: number;
  bidIncrement: number | null;
  buyoutPrice: number | null;
  error: string | null;
};

const twoDecimalsOk = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;

/** Converte "1, 2,5 · 10" em [1, 2.5, 10]; null quando um token não é número válido. */
export function parseCustomValues(raw: string): number[] | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  // Separa por ponto-e-vírgula/quebra de linha; a vírgula só é separador de
  // lista quando o token não é um decimal vírgula ("1,50" = 1.50; "1, 2" =
  // dois valores).
  const tokens: string[] = [];
  for (const chunk of text.split(/[;\n]+/)) {
    const clean = chunk.trim();
    if (!clean) continue;
    if (/^\d{1,7},\d{1,2}$/.test(clean)) tokens.push(clean);
    else tokens.push(...clean.split(",").map(token => token.trim()).filter(Boolean));
  }
  if (!tokens.length) return null;
  const values: number[] = [];
  for (const token of tokens) {
    const value = Number(token.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || !twoDecimalsOk(value)) return null;
    values.push(value);
  }
  return values;
}

export function buildCustomValuesPlan(values: number[], buyoutLast: boolean): CustomValuesPlan {
  const empty: CustomValuesPlan = { options: [], startingPrice: 0, bidIncrement: null, buyoutPrice: null, error: "" };
  if (!Array.isArray(values) || values.length < 2) return { ...empty, error: "Informe ao menos 2 valores." };
  if (values.length > MAX_POLL_OPTIONS) return { ...empty, error: `A enquete aceita no máximo ${MAX_POLL_OPTIONS} valores.` };
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0 || !twoDecimalsOk(value)) return { ...empty, error: "Cada valor precisa ser positivo com até 2 casas decimais." };
  }
  const cents = values.map(toCents);
  for (let index = 1; index < cents.length; index++) {
    if (cents[index] <= cents[index - 1]) return { ...empty, error: "Os valores precisam estar em ordem crescente, sem repetições." };
  }
  let minGap = Infinity;
  for (let index = 1; index < cents.length; index++) minGap = Math.min(minGap, cents[index] - cents[index - 1]);
  const options = values.map((value, index) => {
    const isBuyout = Boolean(buyoutLast) && index === values.length - 1;
    return { label: isBuyout ? `${label(value)} 🦭` : label(value), amount: value, isBuyout };
  });
  return {
    options,
    startingPrice: values[0],
    bidIncrement: Math.max(1, minGap) / 100,
    buyoutPrice: buyoutLast ? values[values.length - 1] : null,
    error: null,
  };
}
