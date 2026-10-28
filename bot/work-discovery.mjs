// Never cache an idle result: remote work is discovered on the next normal
// five-second cycle. Only positive/uncertain results are cached.
export function createWorkDiscovery({ db, openingMinutes = 5, graceMinutes = 15, now = () => performance.now(), onError = () => {} }) {
  let activeUntil = -Infinity;
  return async function hasWork() {
    if (now() < activeUntil) return true;
    try {
      const { data, error } = await db.rpc('bot_has_due_work', { p_opening_minutes: openingMinutes, p_grace_minutes: graceMinutes });
      if (error) throw error;
      if (typeof data !== 'boolean') throw new Error('invalid_work_discovery_response');
      if (data) activeUntil = now() + 60_000;
      return data;
    } catch (error) {
      // Missing migration, timeout or invalid response: keep the original
      // workers running. An uncertain read must never suppress work.
      activeUntil = now() + 60_000;
      onError(error);
      return true;
    }
  };
}
