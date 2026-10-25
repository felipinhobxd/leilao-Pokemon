import { describeError } from './error-log.mjs';

// No automatic replay of writes: pause briefly after network/5xx failures,
// then permit one recovery probe. All callers share this client's circuit.
export function createSupabaseFetch({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15_000, onHealth = () => {} } = {}) {
  let nextAttempt = 0, failures = 0, probing = false;
  return async (input, init = {}) => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
    // A real bid/participant command must still get its own attempt even if
    // a background status request failed. Never replay it automatically.
    const essential = /\/rpc\/(process_auction_command|claim_quick_poll_prize|resolve_whatsapp_participant|prepare_business_backup|read_business_backup_chunk|discard_business_backup)(?:\?|$)/.test(url);
    if (!essential && (now() < nextAttempt || probing)) throw new Error('Supabase temporariamente indisponível; aguardando reconexão.');
    const isProbe = failures > 0 && !essential;
    if (isProbe) probing = true;
    const timeout = AbortSignal.timeout(/\/rpc\/(export_business_backup|prepare_business_backup)/.test(url) ? 65_000 : timeoutMs);
    const originalSignal = init.signal ?? input?.signal;
    const signal = originalSignal ? AbortSignal.any([originalSignal, timeout]) : timeout;
    try {
      const response = await fetchImpl(input, { ...init, signal });
      if ([408,429,500,502,503,504,520,521,522,523,524,525,526].includes(response.status)) {
        onHealth(false);
        failures = Math.min(4, failures+1);
        nextAttempt = now()+Math.min(60_000,10_000*2**(failures-1));
      } else { failures=0; nextAttempt=0; if (response.ok) onHealth(true); }
      return response;
    } catch (error) {
      onHealth(false);
      failures = Math.min(4, failures+1);
      nextAttempt = now()+Math.min(60_000,10_000*2**(failures-1));
      throw error;
    } finally { if (isProbe) probing=false; }
  };
}

export function createErrorReporter({ now=Date.now, write=console.error }={}) {
  const reported = new Map();
  return (scope,error) => {
    const last=reported.get(scope);
    if (last!=null && now()-last<60_000) return;
    reported.set(scope,now());
    write(`${scope}: ${describeError(error)}`);
  };
}
