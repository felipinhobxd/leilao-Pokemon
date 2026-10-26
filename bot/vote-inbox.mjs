import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializePollMessage, revivePollMessage } from './poll-store.mjs';
import { describeError } from './error-log.mjs';

export class VoteReviewError extends Error {
  constructor(message) { super(message); this.review = true; }
}
export class VoteNotReadyError extends Error {
  constructor() { super('vote_not_ready'); this.deferred = true; }
}

// One file per received event: fsync + atomic rename before any database call.
// Review records are NEVER pruned or retried automatically. They block only
// their poll, so another contestant cannot overtake a failed first answer.
export function createVoteInbox({ directory, processVote, now = Date.now, onStatus = () => {}, maxRecords = 5000, maxBytes = 16 * 1024 * 1024, maxAttempts = 8, maxPerDrain = 100 }) {
  const records = new Map(), completed = new Set();
  let sequence = 0, bytes = 0, running = null, corrupt = 0, storageIssue = false, loadFailure = false, capacityIssue = false, lastStatus = '';
  const cost = row => Buffer.byteLength(JSON.stringify(row.message)) + 2048; // Reserve retry metadata too.
  const identity = (message, update) => {
    const strings = [message?.key?.id, message?.key?.remoteJid, update?.pollCreationMessageKey?.id];
    if (strings.some(value => typeof value !== 'string' || !value || value.length > 200)) throw Error('invalid_vote_envelope');
    const pollKey = JSON.stringify([message.key.remoteJid, update.pollCreationMessageKey.id]);
    const id = createHash('sha256').update(JSON.stringify([pollKey, message.key.id, message.key.participant ?? '', message.key.participantAlt ?? ''])).digest('hex');
    return { id, pollKey };
  };
  const filename = id => join(directory, `${id}.json`);
  const notify = () => {
    const review = [...records.values()].filter(row => row.status === 'review').length + corrupt;
    const value = { pending: records.size - review + corrupt, review,
      issue: storageIssue ? 'storage_error' : capacityIssue ? 'capacity' : corrupt ? 'corrupt' : review ? 'review' : records.size ? 'retrying' : '' };
    const json = JSON.stringify(value);
    if (json !== lastStatus) { lastStatus = json; onStatus(value); }
    return value;
  };
  const save = row => {
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `${row.id}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(row));
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, filename(row.id));
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };
  try {
    capacityIssue = existsSync(filename('attention'));
    const names = existsSync(directory) ? readdirSync(directory) : [];
    // A process/power interruption before rename may leave the only copy of
    // an event in a temp file. Preserve it and require review, never ignore it.
    corrupt += names.filter(name => /^[a-f0-9]{64}\.[a-f0-9-]+\.tmp$/.test(name)).length;
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        if (statSync(join(directory, name)).size > 65536 || records.size >= maxRecords) throw Error('invalid_vote_record');
        const row = JSON.parse(readFileSync(join(directory, name), 'utf8'));
        if (row.version !== 1 || `${row.id}.json` !== name || !row.pollKey || !row.message?.key?.id || !Number.isSafeInteger(row.sequence) || !Number.isFinite(row.receivedAt) || !Number.isSafeInteger(row.attempts) || row.attempts < 0 || !Number.isFinite(row.nextAttempt) || !['pending', 'review'].includes(row.status)) throw Error('invalid_vote_record');
        const expected = identity(row.message, row.message.message?.pollUpdateMessage);
        if (expected.id !== row.id || expected.pollKey !== row.pollKey) throw Error('invalid_vote_identity');
        if (bytes + cost(row) > maxBytes) throw Error('vote_inbox_capacity');
        records.set(row.id, row); bytes += cost(row); sequence = Math.max(sequence, row.sequence);
      } catch { corrupt++; }
    }
  } catch { storageIssue = true; loadFailure = true; }
  notify();

  return {
    status: notify,
    finalizationGuard() {
      return { safe: !corrupt && !loadFailure && !storageIssue && !capacityIssue,
        pollIds: [...new Set([...records.values()].filter(row => row.status !== 'review' || row.blocksPoll !== false)
          .map(row => row.message.message.pollUpdateMessage.pollCreationMessageKey.id))] };
    },
    enqueue(message, content) {
      const update = content?.pollUpdateMessage;
      if (!update?.pollCreationMessageKey?.id) return false;
      const { id, pollKey } = identity(message, update);
      if (records.has(id) || completed.has(id)) return false;
      // Normalize protobuf Long timestamps once. Retry never invents a new
      // timestamp/event ID when the original WhatsApp field was absent.
      const timestamp = update.senderTimestampMs == null || update.senderTimestampMs === '' ? NaN : Number(update.senderTimestampMs?.toString?.() ?? update.senderTimestampMs);
      const stored = serializePollMessage({ key: message.key, pushName: message.pushName,
        message: { pollUpdateMessage: { ...update, senderTimestampMs: Number.isFinite(timestamp) ? timestamp : now() } } });
      const row = { version: 1, id, pollKey, sequence: ++sequence, receivedAt: now(), attempts: 0, nextAttempt: 0, status: 'pending', message: stored };
      if (Buffer.byteLength(JSON.stringify(row)) > 60000) throw Error('vote_envelope_too_large');
      if (records.size >= maxRecords || bytes + cost(row) > maxBytes) {
        capacityIssue = true;
        try { if (!existsSync(filename('attention'))) save({ id: 'attention', issue: 'capacity', at: now(), overflow: row }); }
        catch { storageIssue = true; }
        notify(); throw Error('vote_inbox_capacity');
      }
      bytes += cost(row);
      records.set(id, row); // Keep an in-memory copy even if the disk fails.
      try { save(row); notify(); return true; }
      catch (error) { storageIssue = true; notify(); throw error; }
    },
    drain() {
      if (running) return running;
      running = (async () => {
        // If a file could not be read, its position/poll is unknown. Never
        // process later votes while pretending there is no earlier event.
        if (corrupt || loadFailure || capacityIssue) return 0;
        if (storageIssue) {
          try { for (const row of records.values()) save(row); storageIssue = false; }
          catch { notify(); return 0; }
        }
        const blocked = new Set();
        let processed = 0;
        for (const row of [...records.values()].sort((a, b) => a.sequence - b.sequence)) {
          if (processed >= maxPerDrain) break;
          if (blocked.has(row.pollKey)) continue;
          if (row.status === 'review') { if (row.blocksPoll !== false) blocked.add(row.pollKey); continue; }
          if (row.nextAttempt > now()) { blocked.add(row.pollKey); continue; }
          processed++;
          try {
            const result = await processVote(revivePollMessage(row.message), row);
            if (result?.review) throw new VoteReviewError(result.reason ?? 'vote_needs_review');
            unlinkSync(filename(row.id));
            records.delete(row.id); bytes -= cost(row); completed.add(row.id);
            if (completed.size > 10000) completed.delete(completed.values().next().value);
          } catch (error) {
            const next = { ...row, attempts: row.attempts + (error?.deferred ? 0 : 1), lastError: describeError(error).slice(0, 400) };
            const badCipher = error?.message === 'poll_vote_decrypt_failed';
            const expiredReadiness = error?.deferred && now() - row.receivedAt >= 30 * 60_000;
            next.status = error?.review || badCipher || expiredReadiness || next.attempts >= maxAttempts ? 'review' : 'pending';
            next.blocksPoll = !badCipher;
            next.nextAttempt = now() + (error?.deferred ? 5000 : Math.min(300000, 5000 * 2 ** Math.max(0, next.attempts - 1)));
            try { save(next); records.set(row.id, next); }
            catch { storageIssue = true; break; }
            if (next.blocksPoll) blocked.add(row.pollKey);
          }
        }
        notify();
        return processed;
      })().finally(() => { running = null; });
      return running;
    },
  };
}
