import type { RecognitionCandidate, RecognitionResult } from "./card-recognition-core";

export function formatPrintedCollectorNumber(localId: string | null | undefined, denominator: number | string | null | undefined) {
  const rawLocal = String(localId ?? "").trim();
  const rawDenominator = String(denominator ?? "").trim();
  if (!rawLocal) return rawDenominator;
  if (!rawDenominator) return rawLocal;

  const localDigits = rawLocal.match(/\d+/)?.[0] ?? "";
  const denominatorDigits = rawDenominator.match(/\d+/)?.[0] ?? "";
  if (!localDigits || !denominatorDigits) return `${rawLocal}/${rawDenominator}`;

  // Modern Pokémon printings commonly use a zero-padded collector number on both sides
  // (e.g. 066/088). TCGdex stores the set's official count numerically (88), so retain
  // the printed width implied by a zero-padded localId instead of displaying 066/88.
  const shouldPadDenominator = localDigits.length > 1 && localDigits.startsWith("0") && denominatorDigits.length < localDigits.length;
  const formattedDenominator = shouldPadDenominator ? denominatorDigits.padStart(localDigits.length, "0") : denominatorDigits;
  return `${rawLocal}/${formattedDenominator}`;
}

export function preserveCandidateCollectorWidth(candidate: RecognitionCandidate): RecognitionCandidate {
  if (!candidate.localId || !candidate.denominator) return candidate;
  return { ...candidate, cardNumber: formatPrintedCollectorNumber(candidate.localId, candidate.denominator) };
}

export function preserveResultCollectorWidth(result: RecognitionResult): RecognitionResult {
  const candidates = (result.candidates ?? []).map(preserveCandidateCollectorWidth);
  const selected = candidates[0];
  const next = { ...result, candidates };
  if (result.cardNumber && selected?.cardNumber) next.cardNumber = selected.cardNumber;
  return next;
}
