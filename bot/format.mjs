const flags = {
  "pt-BR": "🇧🇷",
  en: "🇺🇸",
  ja: "🇯🇵",
  es: "🇪🇸",
};

export function conditionCode(condition) {
  const value = String(condition ?? "").trim();
  if (!value) return "";
  return value.split(/\s+[—-]\s+/)[0]?.trim() ?? value;
}

export function languageFlag(language) {
  return flags[String(language ?? "")] ?? "";
}

export function buildAuctionCaption(card, auction) {
  const number = String(card?.card_number ?? "").trim();
  const condition = conditionCode(card?.condition);
  const flag = languageFlag(card?.language);
  return `♡ ${auction?.lot_number}. ${String(card?.name ?? "Carta").trim()}${number ? ` (${number})` : ""}${condition ? ` ${condition}` : ""}${flag ? ` ${flag}` : ""}\n· ☆`;
}

export function buildPollTitle(auction) {
  return `${auction?.lot_number}. Lances`;
}
