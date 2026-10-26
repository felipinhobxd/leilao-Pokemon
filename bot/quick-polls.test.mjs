import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dispatchMessageId, dispatchPollSecret } from './dispatch-id.mjs';
import { createClient } from '@supabase/supabase-js';

// Run the real scheduler function without starting index.mjs or a WA socket.
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const start = source.indexOf('let quickPollsBusy = false;');
const end = source.indexOf('async function finalizeDueAuctions()', start);
assert.ok(start >= 0 && end > start);
const code = source.slice(start, end);

function fixture(overrides = {}) {
  const poll = { id: 'quiz', group_id: 'group', title: 'Qual?', options: ['A', 'B'], game_kind: 'quiz', prize_name: 'Carta' };
  const state = { pending: [poll], group: { data: { active: true, group_jid: 'fixture@g.us' } },
    writes: [], sends: [], errors: [], published: [], drains: [], selections: [], wakes: 0, ...overrides };
  const context = { socketReady: true, pollMessageCache: new Map(), voteQueue: Promise.resolve(),
    dispatchMessageId, dispatchPollSecret, serializeMessage: JSON.stringify,
    drainPendingPollVotes: async id => state.drains.push(id),
    auctionNoticeDrain: { wake: () => state.wakes++ },
    reportServiceError: (scope, error) => state.errors.push({ scope, message: error.message }),
    console: { log: value => state.published.push(value) },
    sock: { sendMessage: async (jid, content, options) => {
      state.sends.push({ jid, content, options });
      if (state.sendError) throw Error('network failure');
      if (state.emptySend) return {};
      if (state.missingPollBody && content.poll) return { key: { id: options.messageId } };
      return { key: { id: options.messageId }, message: content };
    } },
    db: { from: table => {
      let update, targetId;
      const filters = [], orders = [];
      const query = {
        select() { return this; },
        is(column, value) { filters.push({ kind: 'is', column, value }); return this; },
        lte(column, value) { filters.push({ kind: 'lte', column, value }); return this; },
        order(column) { orders.push(column); return this; },
        eq(column, value) { if (column === 'id') targetId = value; filters.push({ kind: 'eq', column, value }); return this; },
        limit: async count => {
          state.selections.push({ filters, orders, count });
          // Emulate the server's anti-join, THEN limit. The real client query
          // contract is separately checked against the serialized REST URL.
          const excludePaused = filters.some(f => f.kind === 'eq' && f.column === 'paused_queue.status' && f.value === 'paused')
            && filters.some(f => f.kind === 'is' && f.column === 'paused_queue' && f.value === null);
          const dueBefore = filters.find(f => f.kind === 'lte' && f.column === 'scheduled_at')?.value;
          const pending = state.pending.filter(row => !row.sent_at && (!row.scheduled_at || row.scheduled_at <= dueBefore)
            && (!excludePaused || row.queue?.status !== 'paused'));
          pending.sort((a, b) => {
            for (const column of orders) {
              if (a[column] < b[column]) return -1;
              if (a[column] > b[column]) return 1;
            }
            return 0;
          });
          return { data: pending.slice(0, count), error: state.pendingError };
        },
        update(value) { update = value; state.writes.push(value); return this; },
        maybeSingle: async () => {
          if (table === 'whatsapp_groups') return state.group;
          if (!update) return state.confirmationResult ?? { data: null };
          if (Object.hasOwn(state, 'recordResult')) return state.recordResult;
          return { data: { id: targetId ?? poll.id, ...update } };
        },
      };
      return query;
    } },
  };
  vm.createContext(context); vm.runInContext(code, context);
  return { state, context, poll, run: () => context.sendDueQuickPolls() };
}

for (const [name, group] of [
  ['query error', { error: { message: 'timeout' } }],
  ['missing group', { data: null }],
  ['inactive group', { data: { active: false, group_jid: 'fixture@g.us' } }],
  ['missing destination', { data: { active: true } }],
]) test(`group ${name} never marks an unsent game as published`, async () => {
  const { state, run } = fixture({ group }); await run();
  assert.equal(state.sends.length, 0); assert.equal(state.writes.length, 0);
  assert.equal(state.errors.length, 1); assert.equal(state.published.length, 0);
});

test('invalid options remain pending without a fake sent_at', async () => {
  const f = fixture(); f.poll.options = ['A']; await f.run();
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.sends.length, 0);
  assert.match(f.state.errors[0].message, /invalid_options/);
});

for (const failure of ['sendError', 'emptySend', 'missingPollBody']) test(`${failure} does not record or activate the game`, async () => {
  const f = fixture({ [failure]: true }); await f.run();
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.drains.length, 0);
  assert.equal(f.state.wakes, 0); assert.equal(f.state.published.length, 0);
  assert.equal(f.state.errors.length, 1);
});

for (const [name, result] of [
  ['database error', { error: { message: 'timeout' } }],
  ['zero updated rows', { data: null }],
  ['wrong acknowledgement', { data: { id: 'quiz', sent_at: 'now', poll_message_id: 'other' } }],
]) test(`${name} retains an unready cache and never reports publication`, async () => {
  const f = fixture({ recordResult: result }); await f.run();
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.drains.length, 0);
  assert.equal(f.context.pollMessageCache.get(dispatchMessageId('quiz', 'quick-poll')).ready, false);
  assert.equal(f.state.published.length, 0); assert.equal(f.state.wakes, 0);
  assert.equal(f.state.errors.length, 1);
});

test('transient group failure recovers on the next cycle, with no earlier fake write', async () => {
  const f = fixture({ group: { error: { message: 'timeout' } } }); await f.run();
  assert.equal(f.state.writes.length, 0);
  f.state.group = { data: { active: true, group_jid: 'fixture@g.us' } }; await f.run();
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.published.length, 1);
  assert.ok(f.state.writes[0].sent_at); assert.ok(f.state.writes[0].poll_message_json);
  assert.equal(f.context.pollMessageCache.get(dispatchMessageId('quiz', 'quick-poll')).ready, true);
  assert.equal(f.state.drains.length, 1); assert.equal(f.state.wakes, 1);
});

test('retry after a lost recording response keeps the same announcement/poll IDs and poll secret', async () => {
  const f = fixture({ recordResult: { error: { message: 'response lost' } } });
  f.poll.image_url = 'https://example.invalid/card.jpg'; await f.run();
  delete f.state.recordResult; await f.run();
  assert.deepEqual(f.state.sends.slice(0, 2), f.state.sends.slice(2));
  assert.equal(f.state.published.length, 1); assert.equal(f.state.drains.length, 1);
});

test('a committed UPDATE with a lost response is reconciled before enabling votes', async () => {
  const id = dispatchMessageId('quiz', 'quick-poll');
  const f = fixture({ recordResult: { error: { message: 'response lost' } },
    confirmationResult: { data: { id: 'quiz', sent_at: '2026-10-26T05:00:00Z', poll_message_id: id } } });
  await f.run();
  assert.equal(f.state.sends.length, 2); assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.errors.length, 0); assert.equal(f.state.published.length, 1);
  assert.equal(f.context.pollMessageCache.get(id).ready, true);
});

test('an inconclusive recording confirmation never activates votes', async () => {
  const f = fixture({ recordResult: { error: { message: 'response lost' } },
    confirmationResult: { error: { message: 'still offline' } } }); await f.run();
  assert.equal(f.state.errors.length, 1); assert.equal(f.state.drains.length, 0);
  assert.equal(f.state.published.length, 0);
});

test('one invalid item does not abort the other item already selected', async () => {
  const f = fixture(); f.state.pending = [{ ...f.poll, id: 'invalid', options: [] }, f.poll]; await f.run();
  assert.equal(f.state.errors.length, 1); assert.equal(f.state.published.length, 1);
});

test('legacy giveaway still publishes without enabling automatic game votes', async () => {
  const f = fixture(); f.poll.game_kind = 'legacy'; await f.run();
  assert.equal(f.state.sends.length, 1); assert.equal(f.state.published.length, 1);
  assert.equal(f.context.pollMessageCache.size, 0); assert.equal(f.state.drains.length, 0);
  assert.equal(f.state.writes[0].poll_message_json, undefined);
});

test('paused queue, disconnected socket and pending query failure never publish', async () => {
  const f = fixture(); f.poll.queue = { status: 'paused' }; await f.run();
  delete f.poll.queue; f.context.socketReady = false; await f.run();
  f.context.socketReady = true; f.state.pendingError = { message: 'timeout' }; await f.run();
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.errors.length, 1);
});

test('two older paused games cannot block a later queued quiz or standalone giveaway', async () => {
  const f = fixture();
  const paused = [1, 2].map(n => ({ ...f.poll, id: `paused-${n}`, scheduled_at: `2020-01-0${n}T00:00:00Z`, queue: { status: 'paused' } }));
  const quiz = { ...f.poll, id: 'queued', title: 'Quiz ativo', scheduled_at: '2020-01-03T00:00:00Z', queue: { status: 'running' } };
  const giveaway = { ...f.poll, id: 'standalone', game_kind: 'giveaway', title: 'Brinde avulso', scheduled_at: '2020-01-04T00:00:00Z', queue: null };
  f.state.pending = [...paused, quiz, giveaway]; await f.run();
  assert.deepEqual(f.state.sends.filter(send => send.content.poll).map(send => send.content.poll.name), ['Quiz ativo', 'Brinde avulso']);
  assert.equal(f.state.published.length, 2); assert.equal(f.state.writes.length, 2);
  assert.equal(f.state.errors.length, 0); assert.equal(f.state.selections.length, 1);
  assert.ok(paused.every(row => !row.sent_at), 'paused records stay pending');
  assert.ok(f.state.sends.every(send => !paused.some(row => send.options.messageId === dispatchMessageId(row.id, 'quick-poll'))));
});

test('arbitrarily many paused items are skipped before the bounded two-item selection', async () => {
  const f = fixture();
  const paused = Array.from({ length: 1001 }, (_, n) => ({ ...f.poll, id: `paused-${n}`, scheduled_at: '2020-01-01T00:00:00Z', queue: { status: 'paused' } }));
  f.poll.scheduled_at = '2020-01-02T00:00:00Z';
  f.state.pending = [...paused, f.poll]; await f.run();
  assert.equal(f.state.published.length, 1); assert.equal(f.state.errors.length, 0);
  assert.equal(f.state.selections.length, 1); assert.equal(f.state.selections[0].count, 2);
});

test('all paused produces no writes and resumes safely in a later cycle', async () => {
  const f = fixture(); f.poll.queue = { status: 'paused' }; await f.run();
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.errors.length, 0);
  f.poll.queue.status = 'running'; await f.run();
  assert.equal(f.state.published.length, 1); assert.equal(f.state.writes.length, 1);
});

test('filtering still respects future dates, sent records, deterministic ties and the batch cap', async () => {
  const f = fixture();
  const row = id => ({ ...f.poll, id, title: id, scheduled_at: '2020-01-01T00:00:00Z' });
  f.state.pending = [row('c'), row('a'), row('b'), { ...row('sent'), sent_at: '2020-01-02T00:00:00Z' },
    { ...row('future'), scheduled_at: '2999-01-01T00:00:00Z' }];
  await f.run();
  assert.deepEqual(f.state.sends.filter(send => send.content.poll).map(send => send.content.poll.name), ['a', 'b']);
  assert.equal(f.state.writes.length, 2); assert.equal(f.state.errors.length, 0);
});

for (const affected of [true, false]) test(`real Supabase client confirms ${affected ? 'one updated row' : 'zero affected rows'} in the PATCH response`, async () => {
  const f = fixture(), requests = [];
  f.context.db = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input); requests.push({ url, method: init.method, headers: init.headers });
      let result;
      if (url.pathname.endsWith('/whatsapp_groups')) result = [f.state.group.data];
      else if (init.method === 'PATCH') result = affected ? { id: f.poll.id, ...JSON.parse(init.body) } : null;
      else result = [f.poll];
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await f.run();
  const patch = requests.find(request => request.method === 'PATCH');
  assert.equal(patch.url.searchParams.get('select'), 'id,sent_at,poll_message_id');
  assert.equal(patch.url.searchParams.get('id'), 'eq.quiz');
  const selection = requests[0].url.searchParams;
  assert.match(selection.get('select'), /paused_queue:auction_publish_queues\(\)/);
  assert.equal(selection.get('paused_queue.status'), 'eq.paused');
  assert.equal(selection.get('paused_queue'), 'is.null');
  assert.equal(selection.get('sent_at'), 'is.null');
  assert.equal(selection.get('limit'), '2');
  assert.equal(selection.get('order'), 'scheduled_at.asc,id.asc');
  assert.equal(requests.length, 3, 'normal confirmation adds no second request');
  assert.equal(f.state.published.length, affected ? 1 : 0);
  assert.equal(f.state.errors.length, affected ? 0 : 1);
});
