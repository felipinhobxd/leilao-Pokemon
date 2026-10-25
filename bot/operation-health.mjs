import { describeError } from './error-log.mjs';

// Bounded state is included in the existing heartbeat, never sent separately.
export function createOperationHealth(now = () => new Date().toISOString()) {
  const state = { database: {}, backup: {} };
  return {
    state,
    restore(previous) {
      if (previous?.backup && typeof previous.backup === 'object') state.backup = previous.backup;
      if (previous?.database && typeof previous.database === 'object') state.database = previous.database;
      if (previous?.mention && typeof previous.mention === 'object') state.mention = previous.mention;
    },
    database(ok) {
      if (!ok) { state.database.failedAt = now(); delete state.database.recoveredAt; }
      else if (state.database.failedAt && !state.database.recoveredAt) state.database.recoveredAt = now();
    },
    backup(status, error, cloud = false) {
      state.backup = { status, at: now(), cloud, ...(error ? { error: describeError(error).slice(0, 400) } : {}) };
    },
    mention(issue) { state.mention = { at: now(), issue: String(issue ?? '').slice(0, 400) }; },
  };
}
