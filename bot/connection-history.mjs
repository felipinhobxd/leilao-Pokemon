import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DAY = 86400000, LIMIT = 2048;
const causes = new Set(['timeout', 'session_replaced', 'logged_out', 'connection_closed', 'process_exit']);
// Local bounded history; only summary() goes into the existing worker heartbeat.
export function createConnectionHistory({ directory, now = Date.now, monotonic = () => performance.now() }) {
  const file = path.join(directory, 'connection-history.json');
  let state = { version: 1, monitoredSince: new Date(now()).toISOString(), events: [], current: null, droppedAt: null };
  let storageIssue = false, unreadable = false, started = null;
  try {
    if (statSync(file).size > 1024 * 1024) throw Error('history_too_large');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.events) || value.events.length > LIMIT || typeof value.monitoredSince !== 'string' || !Number.isFinite(Date.parse(value.monitoredSince)) || value.events.some(e => !e || typeof e.at !== 'string' || e.at.length > 40 || !Number.isFinite(Date.parse(e.at)) || !causes.has(e.cause))) throw Error('invalid_history');
    state = { version: 1, monitoredSince: value.monitoredSince, current: value.current, droppedAt: typeof value.droppedAt === 'string' && Number.isFinite(Date.parse(value.droppedAt)) ? value.droppedAt : null,
      events: value.events.map(e => ({ at: e.at, cause: e.cause, code: Number.isInteger(e.code) && e.code >= 100 && e.code <= 999 ? e.code : null,
        recoveredAt: typeof e.recoveredAt === 'string' && Number.isFinite(Date.parse(e.recoveredAt)) ? e.recoveredAt : null,
        durationMs: Number.isSafeInteger(e.durationMs) && e.durationMs >= 0 ? e.durationMs : null,
        estimated: e.estimated === true, processExited: e.processExited === true, processRestart: e.processRestart === true,
        exitCode: Number.isInteger(e.exitCode) && e.exitCode >= 0 && e.exitCode <= 255 ? e.exitCode : null })) };
    if (state.current !== null && (!Number.isInteger(state.current) || !state.events[state.current])) throw Error('invalid_current');
  } catch (error) {
    if (error.code !== 'ENOENT') { storageIssue = true; unreadable = true; state.events = []; state.current = null; }
  }
  const supervisorStartedAt = new Date(now()).toISOString();
  function persist() {
    if (unreadable) return; // Preserve corrupt evidence; diagnostics must never affect dispatch/votes.
    try {
      mkdirSync(directory, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
      renameSync(temp, file);
      storageIssue = false;
    } catch { storageIssue = true; }
  }
  function prune(reserve = 0) {
    const current = state.current === null ? null : state.events[state.current];
    const retained = state.events.filter(e => e === current || Date.parse(e.at) >= now() - 7 * DAY);
    if (retained.length > LIMIT - reserve) {
      const removed = retained.splice(0, retained.length - (LIMIT - reserve));
      state.droppedAt = removed.at(-1).at;
    }
    state.events = retained;
    state.current = current ? retained.indexOf(current) : null;
  }
  return {
    disconnect({ code, cause } = {}) {
      if (state.current !== null) return; // Repeated retries belong to one continuous outage.
      prune(1);
      const n = Number(code);
      state.events.push({ at: new Date(now()).toISOString(), cause: causes.has(cause) ? cause : 'connection_closed', code: Number.isInteger(n) && n >= 100 && n <= 999 ? n : null, recoveredAt: null, durationMs: null, estimated: false, processExited: false, processRestart: false, exitCode: null });
      state.current = state.events.length - 1;
      started = monotonic();
      persist();
    },
    processExit(code) {
      if (state.current === null) this.disconnect({ cause: 'process_exit' });
      const event = state.events[state.current];
      event.processExited = true;
      event.exitCode = Number.isInteger(code) && code >= 0 && code <= 255 ? code : null;
      persist();
    },
    processStarted() {
      if (state.current !== null && state.events[state.current].processExited) {
        state.events[state.current].processRestart = true; persist();
      }
    },
    connected() {
      if (state.current === null) { prune(); persist(); return; }
      const event = state.events[state.current];
      event.recoveredAt = new Date(now()).toISOString();
      event.estimated = started === null;
      event.durationMs = Math.max(0, Math.round(started === null ? now() - Date.parse(event.at) : monotonic() - started));
      state.current = null; started = null; prune(); persist();
    },
    plannedStop() {
      // A deliberate stop is not a new failure and does not certify recovery.
      state.current = null; started = null; persist();
    },
    summary() {
      const previousSize = state.events.length;
      prune();
      if (previousSize !== state.events.length) persist();
      const cutoff = now() - DAY;
      const events = state.events.filter(e => Date.parse(e.at) >= cutoff && Date.parse(e.at) <= now());
      const last = state.events.filter((e, i) => i === state.current || Date.parse(e.at) >= now() - 7 * DAY).at(-1);
      return { version: 1, monitoredSince: state.monitoredSince, supervisorStartedAt,
        count24h: events.length, processRestarts24h: events.filter(e => e.processRestart).length,
        countLimited: Boolean(state.droppedAt && Date.parse(state.droppedAt) >= cutoff), storageIssue,
        ongoing: state.current !== null,
        last: last ? { at: last.at, cause: last.cause, code: last.code, recoveredAt: last.recoveredAt, durationMs: last.durationMs, estimated: last.estimated, processExited: last.processExited, processRestart: last.processRestart, exitCode: last.exitCode } : null };
    },
  };
}
