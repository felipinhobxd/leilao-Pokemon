import { describeError } from './error-log.mjs';

// Bounded state is included in the existing heartbeat, never sent separately.
export function createOperationHealth(now = () => new Date().toISOString()) {
  const state = { protectionVersion: 1, database: {}, backup: {}, cleanup: {} };
  return {
    state,
    restore(previous) {
      if (previous?.backup && typeof previous.backup === 'object') state.backup = previous.backup;
      if (previous?.database && typeof previous.database === 'object') state.database = previous.database;
      if (previous?.mention && typeof previous.mention === 'object') state.mention = previous.mention;
      if (previous?.cleanup && typeof previous.cleanup === 'object') state.cleanup = previous.cleanup;
      if (previous?.votes && typeof previous.votes === 'object') state.votes = previous.votes;
    },
    database(ok) {
      if (!ok) { state.database.failedAt = now(); delete state.database.recoveredAt; }
      else if (state.database.failedAt && !state.database.recoveredAt) state.database.recoveredAt = now();
    },
    backup(status, error, cloud = false) {
      state.backup = { status, at: now(), cloud, ...(error ? { error: describeError(error).slice(0, 400) } : {}) };
    },
    cleanup(status, reason = '', deleted = 0) {
      const known = ['confirmed_cloud_backup_missing','daily_cloud_backup_missing','backup_coverage_incomplete','maintenance_busy','unsupported_cleanup_isolation','backup_unavailable','cleanup_failed'];
      state.cleanup = {status, at: now(), reason: known.includes(reason) ? reason : '', deleted: Number.isSafeInteger(deleted) && deleted >= 0 ? deleted : 0};
    },
    mention(issue) { state.mention = { at: now(), issue: String(issue ?? '').slice(0, 400) }; },
    votes(value) {
      const count = key => Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? Math.min(10000, value[key]) : 0;
      state.votes = { at: now(), pending: count('pending'), review: count('review'),
        issue: ['storage_error', 'capacity', 'corrupt', 'review', 'retrying'].includes(value?.issue) ? value.issue : '' };
    },
  };
}
