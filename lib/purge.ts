/**
 * "Excluir TUDO" confirmation phrases. The UI collects TWO typed
 * confirmations (per the operator's spec): first "excluir tudo", then
 * "quero excluir mesmo". The API route re-validates the FINAL phrase
 * server-side, and the purge RPC validates it again inside the database —
 * a stray click, a CSRF or a buggy client can never wipe business data.
 */
export const PURGE_PHRASE_STEP1 = "excluir tudo";
export const PURGE_PHRASE_FINAL = "quero excluir mesmo";

/** Normalize typed input for comparison: trim + collapse spaces + lowercase. */
export function normalizePurgePhrase(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function isPurgeStep1(value: unknown): boolean {
  return normalizePurgePhrase(value) === PURGE_PHRASE_STEP1;
}

export function isPurgeFinalPhrase(value: unknown): boolean {
  return normalizePurgePhrase(value) === PURGE_PHRASE_FINAL;
}
