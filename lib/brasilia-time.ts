export const BRASILIA_TIME_ZONE = "America/Sao_Paulo";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRASILIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dateParts(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const entries = Object.fromEntries(
    partsFormatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );
  return {
    year: Number(entries.year),
    month: Number(entries.month),
    day: Number(entries.day),
    hour: Number(entries.hour),
    minute: Number(entries.minute),
    second: Number(entries.second),
  };
}

function zoneOffsetMs(date: Date) {
  const parts = dateParts(date);
  if (!parts) return 0;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function brasiliaInputToIso(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss = "00"] = match;
  const nominalUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  let probe = new Date(nominalUtc);
  let offset = zoneOffsetMs(probe);
  let instant = nominalUtc - offset;
  const secondOffset = zoneOffsetMs(new Date(instant));
  if (secondOffset !== offset) {
    offset = secondOffset;
    instant = nominalUtc - offset;
  }
  const result = new Date(instant);
  const confirmed = toBrasiliaInput(result, Boolean(match[6]));
  const expected = `${y}-${m}-${d}T${hh}:${mm}${match[6] ? `:${ss}` : ""}`;
  if (confirmed !== expected) return null;
  return result.toISOString();
}

export function toBrasiliaInput(value: Date | string | number, includeSeconds = false) {
  const parts = dateParts(value);
  if (!parts) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}${includeSeconds ? `:${pad(parts.second)}` : ""}`;
}

export function formatBrasiliaDateTime(value: Date | string | number | null | undefined, includeSeconds = true) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  }).format(date).replace(",", "");
}

export function formatBrasiliaTime(value: Date | string | number | null | undefined, includeSeconds = true) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  }).format(date);
}

// Excel stores wall-clock dates without timezone metadata. This creates a Date whose
// UTC fields equal the Sao Paulo wall clock, so the exported cell displays the exact
// Brasilia time regardless of the Node/Vercel host timezone.
export function excelBrasiliaDate(value: Date | string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parts = dateParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}
