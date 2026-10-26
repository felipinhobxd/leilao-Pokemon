import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoteInbox, VoteNotReadyError, VoteReviewError } from './vote-inbox.mjs';

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'leilao-vote-inbox-'));
  t.after(() => { assert.ok(path.startsWith(join(tmpdir(), 'leilao-vote-inbox-'))); rmSync(path, { recursive: true, force: true }); });
  return path;
}
function event(id, poll = 'poll', timestamp = 1792987200123) {
  const message = { key: { id, remoteJid: 'group@g.us', participant: `${id}@lid` }, pushName: id };
  const content = { pollUpdateMessage: { pollCreationMessageKey: { id: poll }, senderTimestampMs: timestamp,
    vote: { encIv: Buffer.from([1, 2]), encPayload: Buffer.from([3, 4]) } } };
  return [message, content];
}
const files = path => readdirSync(path).filter(name => /^[a-f0-9]{64}\.json$/.test(name));

test('received votes are on disk before processing; failure cannot be overtaken in the same poll', async t => {
  const path = directory(t), calls = []; let clock = 100000, fail = true;
  const inbox = createVoteInbox({ directory: path, now: () => clock, processVote: async message => {
    assert.ok(files(path).length, 'persisted before any processor call');
    calls.push(message.key.id);
    if (fail && message.key.id === 'first') { fail = false; throw Error('network'); }
  } });
  inbox.enqueue(...event('first')); inbox.enqueue(...event('second')); inbox.enqueue(...event('unrelated', 'another'));
  await inbox.drain();
  assert.deepEqual(calls, ['first', 'unrelated']);
  assert.equal(inbox.status().pending, 2);
  await inbox.drain(); assert.deepEqual(calls, ['first', 'unrelated'], 'backoff does not touch the database');
  clock += 5000; await inbox.drain();
  assert.deepEqual(calls, ['first', 'unrelated', 'first', 'second']);
  assert.equal(files(path).length, 0);
});

test('restart preserves pending order, original timestamps, encrypted bytes and message IDs', async t => {
  const path = directory(t); let clock = 1792987200123; const seen = [];
  const first = createVoteInbox({ directory: path, now: () => clock, processVote: async message => { seen.push(message); throw Error('network'); } });
  first.enqueue(...event('first', 'poll', null)); first.enqueue(...event('second'));
  await first.drain();
  const originalTime = seen[0].message.pollUpdateMessage.senderTimestampMs;
  clock += 5000;
  const restored = createVoteInbox({ directory: path, now: () => clock, processVote: async message => seen.push(message) });
  assert.equal(restored.enqueue(...event('first', 'poll', null)), false);
  await restored.drain();
  assert.deepEqual(seen.map(message => message.key.id), ['first', 'first', 'second']);
  assert.equal(seen[1].message.pollUpdateMessage.senderTimestampMs, originalTime);
  assert.equal(originalTime, 1792987200123, 'missing timestamp is fixed once at receipt');
  assert.deepEqual(seen[1].message.pollUpdateMessage.vote.encIv, Buffer.from([1, 2]));
  assert.deepEqual(seen[1].message.pollUpdateMessage.vote.encPayload, Buffer.from([3, 4]));
});

test('exhausted retries retain a review file and hold only the affected poll across restart', async t => {
  const path = directory(t); let clock = 100000; const calls = [];
  const inbox = createVoteInbox({ directory: path, maxAttempts: 2, now: () => clock, processVote: async message => { calls.push(message.key.id); throw Error('network'); } });
  inbox.enqueue(...event('first')); inbox.enqueue(...event('second'));
  await inbox.drain(); clock += 5000; await inbox.drain();
  assert.deepEqual(calls, ['first', 'first']); assert.equal(inbox.status().review, 1);
  const record = files(path).map(name => JSON.parse(readFileSync(join(path, name), 'utf8'))).find(row => row.status === 'review');
  assert.match(record.lastError, /network/);
  const restored = createVoteInbox({ directory: path, now: () => clock + 1e7, processVote: async message => calls.push(message.key.id) });
  restored.enqueue(...event('other', 'other-poll')); await restored.drain();
  assert.deepEqual(calls, ['first', 'first', 'other']); assert.equal(restored.status().review, 1);
});

test('a pending publication defers without spending attempts, then resumes; abandoned readiness becomes review', async t => {
  const path = directory(t); let ready = false, clock = 100000;
  const inbox = createVoteInbox({ directory: path, now: () => clock, processVote: async () => { if (!ready) throw new VoteNotReadyError(); } });
  inbox.enqueue(...event('first')); await inbox.drain();
  assert.equal(JSON.parse(readFileSync(join(path, files(path)[0]), 'utf8')).attempts, 0);
  ready = true; clock += 5000; await inbox.drain(); assert.equal(inbox.status().pending, 0);
  ready = false; inbox.enqueue(...event('stuck')); clock += 30 * 60_000; await inbox.drain();
  assert.equal(inbox.status().review, 1);
});

test('malformed ciphertext is visible for review without blocking valid voters in the same poll', async t => {
  const calls = [], inbox = createVoteInbox({ directory: directory(t), processVote: async message => {
    calls.push(message.key.id); if (message.key.id === 'malformed') throw Error('poll_vote_decrypt_failed');
  } });
  inbox.enqueue(...event('malformed')); inbox.enqueue(...event('valid'));
  await inbox.drain(); assert.deepEqual(calls, ['malformed', 'valid']); assert.equal(inbox.status().review, 1);
  assert.deepEqual(inbox.finalizationGuard(), { safe: true, pollIds: [] });
});

test('deadline/identity rejection after a retry is retained for review instead of silently reopening or discarding', async t => {
  let calls = 0, clock = 100000;
  const inbox = createVoteInbox({ directory: directory(t), now: () => clock, processVote: async () => {
    if (++calls === 1) throw Error('network');
    return { review: true, reason: 'deadline_expired' };
  } });
  inbox.enqueue(...event('late')); await inbox.drain(); clock += 5000; await inbox.drain();
  assert.equal(inbox.status().review, 1); clock += 1e6; await inbox.drain(); assert.equal(calls, 2);
  assert.deepEqual(inbox.finalizationGuard(), { safe: true, pollIds: ['poll'] });
});

test('disk write failure preserves the in-memory event and performs no RPC until it can persist', async t => {
  const root = directory(t), path = join(root, 'inbox'); let calls = 0;
  const inbox = createVoteInbox({ directory: path, processVote: async () => calls++ });
  writeFileSync(path, 'filesystem temporarily unavailable');
  assert.throws(() => inbox.enqueue(...event('first')));
  await inbox.drain(); assert.equal(calls, 0); assert.equal(inbox.status().issue, 'storage_error');
  unlinkSync(path); await inbox.drain();
  assert.equal(calls, 1); assert.equal(inbox.status().pending, 0);
});

test('capacity never evicts old pending records; corrupt state fails closed and remains on disk', async t => {
  const path = directory(t), inbox = createVoteInbox({ directory: path, maxRecords: 1, processVote: async () => {} });
  inbox.enqueue(...event('first')); assert.throws(() => inbox.enqueue(...event('second')), /capacity/);
  assert.equal(inbox.status().issue, 'capacity'); assert.equal(files(path).length, 1);
  assert.equal(inbox.finalizationGuard().safe, false);
  const capacityRestored = createVoteInbox({ directory: path, processVote: async () => { throw Error('must not run'); } });
  assert.equal(capacityRestored.status().issue, 'capacity'); assert.equal(capacityRestored.finalizationGuard().safe, false);
  unlinkSync(join(path, 'attention.json')); // Operator acknowledgment in an isolated fixture only.
  const broken = join(path, '0'.repeat(64) + '.json'); writeFileSync(broken, '{broken'); let calls = 0;
  const restored = createVoteInbox({ directory: path, processVote: async () => calls++ });
  await restored.drain(); assert.equal(calls, 0); assert.equal(restored.status().issue, 'corrupt'); assert.equal(files(path).length, 2);
  assert.equal(restored.finalizationGuard().safe, false);
});

test('duplicate events and concurrent drains cannot run the same received vote twice', async t => {
  let release, calls = 0;
  const inbox = createVoteInbox({ directory: directory(t), processVote: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  inbox.enqueue(...event('one')); assert.equal(inbox.enqueue(...event('one')), false);
  const first = inbox.drain(), second = inbox.drain(); assert.equal(first, second);
  release(); await first;
  assert.equal(inbox.enqueue(...event('one')), false); await inbox.drain(); assert.equal(calls, 1);
});

test('byte limit and interrupted atomic writes remain visible and cannot certify automatic results', async t => {
  const limited = createVoteInbox({ directory: directory(t), maxBytes: 1, processVote: async () => { throw Error('must not process'); } });
  assert.throws(() => limited.enqueue(...event('large')), /capacity/);
  assert.equal(limited.finalizationGuard().safe, false);
  const path = directory(t); writeFileSync(join(path, `${'a'.repeat(64)}.1234-abcd.tmp`), '{interrupted write');
  const interrupted = createVoteInbox({ directory: path, processVote: async () => { throw Error('must not process'); } });
  assert.equal(interrupted.status().issue, 'corrupt'); assert.equal(interrupted.status().review, 1);
  assert.equal(interrupted.finalizationGuard().safe, false); assert.equal(await interrupted.drain(), 0);
});
