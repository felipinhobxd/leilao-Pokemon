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

/** Where the fix for a missing/outdated purge function lives, so every error
 * message below can point the operator at the exact file to apply. */
export const PURGE_FIX_MIGRATION = "supabase/migrations/20260921140000_purge_security_definer.sql";

export type ParsedPurgeError = { status: number; message: string };

/**
 * Translate a purge RPC failure into an actionable PT-BR error. The old route
 * collapsed EVERY failure into a generic 500, which made "Excluir TUDO não
 * está funcionando" undiagnosable: a missing migration (PGRST202) and the
 * security-invoker ownership bug looked identical to the operator. Known
 * failures get specific causes + fixes; anything unknown surfaces the raw
 * database message so the next report is debuggable.
 */
export function parsePurgeRpcError(error: unknown): ParsedPurgeError {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  // PostgREST could not resolve the RPC at all → the purge migration was never applied.
  if (/PGRST20[0-9]|could not find|schema cache|does not exist/i.test(message)) {
    return {
      status: 503,
      message: `A função de exclusão ainda não existe no banco de dados. Aplique o arquivo ${PURGE_FIX_MIGRATION} no SQL Editor do Supabase e tente novamente.`,
    };
  }
  // The 130000 version shipped as SECURITY INVOKER: service_role is not the
  // owner of auction_events, so its DDL (trigger drop, sequence restarts) fails.
  if (/must be owner|permission denied/i.test(message)) {
    return {
      status: 503,
      message: `A função de exclusão no banco está desatualizada. Aplique o arquivo ${PURGE_FIX_MIGRATION} no SQL Editor do Supabase e tente novamente.`,
    };
  }
  if (/purge_not_confirmed/i.test(message)) {
    return {
      status: 400,
      message: 'Confirmação inválida — digite exatamente "quero excluir mesmo".',
    };
  }
  return {
    status: 500,
    message: message ? `Falha ao excluir tudo: ${message}` : "Falha ao excluir tudo.",
  };
}
