import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createVoteInbox, VoteNotReadyError, VoteReviewError } from './vote-inbox.mjs';
import { handleGameVote } from './poll-game.mjs';

// Execute the real incoming-vote functions without importing index.mjs, which
// starts the real socket. Only the cryptographic/network boundaries are mocked.
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const incoming = source.slice(source.indexOf('async function processIncomingPollMessage('), source.indexOf('async function enrichParticipantFromMessage('));
function fixture(t, overrides = {}) {
  const path = mkdtempSync(join(tmpdir(), 'leilao-vote-pipeline-'));
  t.after(() => { assert.ok(path.startsWith(join(tmpdir(), 'leilao-vote-pipeline-'))); rmSync(path, { recursive: true, force: true }); });
  let clock = Date.parse('2026-10-26T04:00:00Z');
  const poll = { id: 'game', game_kind: 'quiz', options: ['A', 'B'], correct_index: 0, group: { group_jid: 'test@g.us' } };
  const context = { VoteNotReadyError, VoteReviewError, pollMessageCache: new Map(), unknownPollWarned: new Set(),
    unwrapMessageContent: message => message, sock: {}, handleGameVote,
    resolveVoterIdentity: async update => ({ id: update.pollUpdateMessageKey.id }), ensureParticipant: async identity => identity,
    eventTime: value => new Date(value).toISOString(), auctionNoticeDrain: { wake() {} }, console: { warn() {} },
    loadDispatchForPoll: async () => ({ gamePoll: poll, cached: { message: {} } }),
    decryptIncomingPollVote: async ({ message, content }) => ({ pollUpdate: { vote: { selectedOptions: [createHash('sha256').update('A').digest()] },
      pollUpdateMessageKey: message.key, senderTimestampMs: content.pollUpdateMessage.senderTimestampMs } }), ...overrides };
  vm.createContext(context); vm.runInContext(incoming, context);
  context.voteInbox = createVoteInbox({ directory: path, now: () => clock, processVote: (message, delivery) => context.applyIncomingPollMessage(message, delivery) });
  const message = id => ({ key: { id, remoteJid: 'test@g.us' }, message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'poll' }, senderTimestampMs: clock } } });
  return { context, poll, message, advance: () => { clock += 5000; } };
}

test('real pipeline: transient first correct answer failure is retried before the next contestant', async t => {
  const calls = []; let winner, fail = true;
  const { context, message, advance } = fixture(t, { db: { rpc: async (_, args) => {
    calls.push({ participant: args.p_participant_id, id: args.p_event_id, time: args.p_event_at });
    if (fail) { fail = false; return { error: { message: 'temporary network error' } }; }
    winner = args.p_participant_id; return { data: { won: true, finished: true } };
  } } });
  await context.processIncomingPollMessage(message('first'));
  await context.processIncomingPollMessage(message('second'));
  assert.equal(winner, undefined); assert.equal(calls.length, 1);
  advance(); await context.voteInbox.drain();
  assert.equal(winner, 'first'); assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0], 'RPC id and timestamp survive retry unchanged');
  assert.equal(context.voteInbox.status().pending, 0);
});

test('real pipeline: bid handler failures are propagated to persistent retry instead of swallowed', async t => {
  let calls = 0;
  const { context, message, advance } = fixture(t, {
    loadDispatchForPoll: async () => ({ dispatch: { poll_message_json: {} }, cached: { message: {} } }),
    handlePollVote: async () => { if (++calls === 1) throw Error('database failed'); },
  });
  await context.processIncomingPollMessage(message('bid'));
  assert.equal(context.voteInbox.status().pending, 1); advance(); await context.voteInbox.drain();
  assert.equal(calls, 2); assert.equal(context.voteInbox.status().pending, 0);
});

test('real pipeline: a committed prize with a lost response is recovered without a second winner', async t => {
  const applied = new Map(), calls = []; let lostResponse = true;
  const { context, message, advance } = fixture(t, { db: { rpc: async (_, args) => {
    calls.push(args.p_event_id);
    if (!applied.size) applied.set(args.p_event_id, args.p_participant_id);
    if (lostResponse) { lostResponse = false; return { error: { message: 'response lost after commit' } }; }
    return { data: { won: false, finished: true } };
  } } });
  await context.processIncomingPollMessage(message('first')); await context.processIncomingPollMessage(message('second'));
  advance(); await context.voteInbox.drain();
  assert.equal(applied.size, 1); assert.equal([...applied.values()][0], 'first');
  assert.equal(calls[0], calls[1]); assert.equal(context.voteInbox.status().pending, 0);
});

test('real pipeline: publication readiness retains votes until registration completes', async t => {
  const { context, message, advance } = fixture(t);
  context.pollMessageCache.set('poll', { ready: false });
  await context.processIncomingPollMessage(message('first'));
  assert.equal(context.voteInbox.status().pending, 1);
  context.pollMessageCache.set('poll', { ready: true }); context.db = { rpc: async () => ({ data: { won: true, finished: true } }) };
  advance(); await context.voteInbox.drain(); assert.equal(context.voteInbox.status().pending, 0);
});

test('real finalizer uses a bounded deadline snapshot, guards pending polls and fails closed on unreadable state', async () => {
  const code = source.slice(source.indexOf('async function finalizeDueAuctions()'), source.indexOf('async function connect()'));
  const calls = []; let guard = { safe: true, pollIds: ['poll'] };
  const context = { sock: {}, socketReady: true, finalizeBusy: false, voteQueue: Promise.resolve(),
    voteInbox: { finalizationGuard: () => guard }, ADMIN_USER_ID: 'admin',
    db: { rpc: async (...args) => { calls.push(args); return { data: 0 }; } }, auctionNoticeDrain: { tick: async () => {} }, reportServiceError() {} };
  vm.createContext(context); vm.runInContext(code, context);
  await context.finalizeDueAuctions();
  assert.equal(calls[0][0], 'finalize_due_auction_batch_guarded');
  assert.deepEqual([...calls[0][1].p_pending_poll_ids], ['poll']);
  assert.ok(Date.parse(calls[0][1].p_due_before) <= Date.now() - 5000);
  guard = { safe: false, pollIds: [] }; await context.finalizeDueAuctions(); assert.equal(calls.length, 1);
  guard = { safe: true, pollIds: [] }; await context.finalizeDueAuctions(); assert.equal(calls[1][0], 'finalize_due_auction_batch_guarded');
  assert.deepEqual([...calls[1][1].p_pending_poll_ids], []);
});

test('real bid handler sends an expired retry to review instead of accepting it or reopening the auction', async t => {
  const calls = [], audits = []; let fail = true;
  const { context, message, advance } = fixture(t, {
    loadDispatchForPoll: async () => ({ dispatch: { auction_id: 'auction', poll_message_id: 'poll', poll_message_json: {}, poll_options: [{ label: '10', amount: 10 }] }, cached: { message: {} } }),
    resolveVoterIdentity: async () => ({ voterJid: 'person@lid' }), ensureParticipant: async () => ({ id: 'person', display_name: 'Pessoa' }),
    logResolvedParticipant() {}, getAggregateVotesInPollMessage: () => [{ name: '10', voters: ['person'] }], findVoteState: async () => null,
    processCommand: async command => { calls.push(command); if (fail) { fail = false; throw Error('network'); } throw Error('deadline_expired'); },
    auditLateVote: async (...args) => audits.push(args), console: { log() {}, warn() {}, error() {} }, brl: String,
  });
  const handler = source.slice(source.indexOf('async function handlePollVote('), source.indexOf('async function loadDispatchForPoll('));
  vm.runInContext(handler, context);
  await context.processIncomingPollMessage(message('first'));
  advance(); await context.voteInbox.drain();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
  assert.equal(context.voteInbox.status().review, 1); assert.equal(audits.length, 1);
  assert.ok(calls.every(command => command.type === 'BID_PLACED'), 'never opens/finalizes an auction to bypass its deadline');
});

function withdrawalFixture(t, { networkFirst = false, deadline = '2026-10-26T03:59:59Z', buyout = false, readError = false } = {}) {
  const calls = [], audits = [], saves = []; let failed = false;
  const f = fixture(t, {
    loadDispatchForPoll: async () => ({ dispatch: { auction_id: 'auction', poll_message_id: 'poll', poll_message_json: {} }, cached: { message: {} } }),
    resolveVoterIdentity: async () => ({ voterJid: 'person@lid' }), ensureParticipant: async () => ({ id: 'person', display_name: 'Pessoa' }),
    logResolvedParticipant() {}, getAggregateVotesInPollMessage: () => [],
    findVoteState: async () => ({ active: true, is_buyout: buyout, amount: 2 }),
    saveVoteState: async (...args) => saves.push(args), logCurrentLeader: async () => {}, brl: String,
    processCommand: async command => { calls.push(command); if (networkFirst && !failed) { failed = true; throw Error('network'); } throw Error('deadline_expired'); },
    auditLateVote: async (...args) => audits.push(args), console: { log() {}, warn() {}, error() {} },
    db: { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => readError ? { error: { message: 'read unavailable' } } : { data: { scheduled_end_at: deadline } } }) },
  });
  vm.runInContext(source.slice(source.indexOf('async function handlePollVote('), source.indexOf('async function loadDispatchForPoll(')), f.context);
  return { ...f, calls, audits, saves };
}

test('expired withdrawal is audited without pretending the accepted bid was removed', async t => {
  const f = withdrawalFixture(t); await f.context.processIncomingPollMessage(f.message('withdraw'));
  assert.equal(f.audits[0][2], 'BID_WITHDRAWN_AFTER_CLOSE'); assert.equal(f.saves.length, 0);
  assert.equal(f.context.voteInbox.status().pending, 0); assert.equal(f.context.voteInbox.status().review, 0);
});

test('provably late withdrawal retry releases finalization without accepting the withdrawal', async t => {
  const f = withdrawalFixture(t, { networkFirst: true });
  await f.context.processIncomingPollMessage(f.message('withdraw')); assert.equal(f.context.voteInbox.finalizationGuard().pollIds.length, 1);
  f.advance(); await f.context.voteInbox.drain();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.saves.length, 0);
  assert.equal(f.context.voteInbox.status().pending, 0); assert.equal(f.context.voteInbox.status().review, 0);
  assert.deepEqual(f.context.voteInbox.finalizationGuard().pollIds, []);
});

test('possibly timely withdrawal with failed delivery still requires review', async t => {
  const f = withdrawalFixture(t, { networkFirst: true, deadline: '2026-10-26T04:00:01Z' });
  await f.context.processIncomingPollMessage(f.message('withdraw')); f.advance(); await f.context.voteInbox.drain();
  assert.equal(f.context.voteInbox.status().review, 1); assert.equal(f.context.voteInbox.finalizationGuard().pollIds.length, 1);
  assert.equal(f.saves.length, 0);
});

function installActualAudit(context, { existing, readError, loseFirstResponse = false } = {}) {
  let stored = existing, inserts = 0, reads = 0;
  context.ADMIN_USER_ID = 'admin';
  context.db = {from(table) {
    if (table === 'auctions') return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{scheduled_end_at:'2026-10-26T03:59:59Z'}})};
    assert.equal(table, 'auction_events');
    return {
      async insert(row) {
        inserts++;
        if (stored) return {error:{code:'23505',message:'duplicate'}};
        stored = structuredClone(row);
        return loseFirstResponse ? {error:{message:'response lost after commit'}} : {};
      },
      select(){return this;},eq(key,value){assert.equal(key,'external_event_id');assert.equal(value,stored?.external_event_id ?? value);return this;},
      async maybeSingle(){reads++;return {data:stored,error:readError};},
    };
  }};
  const start=source.indexOf('async function auditLateVote(');
  vm.runInContext(source.slice(start,source.indexOf('async function ',start+1)),context);
  return {get stored(){return stored;},get inserts(){return inserts;},get reads(){return reads;}};
}

test('lost audit acknowledgement replays through durable inbox without review or duplicate event', async t => {
  const f=withdrawalFixture(t);
  const audit=installActualAudit(f.context,{loseFirstResponse:true});
  await f.context.processIncomingPollMessage(f.message('audit-response-lost'));
  assert.equal(f.context.voteInbox.status().pending,1);
  f.advance();await f.context.voteInbox.drain();
  assert.equal(audit.inserts,2);assert.equal(audit.reads,1);
  assert.equal(f.context.voteInbox.status().pending,0);assert.equal(f.context.voteInbox.status().review,0);
  assert.equal(f.saves.length,0);assert.deepEqual(f.context.voteInbox.finalizationGuard().pollIds,[]);
});

test('audit collision requires matching event identity and vote; failed read cannot acknowledge', async()=>{
  const payload={voter_jid:'voter',phone_e164:'10000000001',event_at:'2026-10-27T03:00:00Z',option:'R$ 2',amount:2};
  const row={auction_id:'auction',participant_id:'person',admin_user_id:'admin',event_type:'WHATSAPP_VOTE_REJECTED',external_event_id:'event',payload};
  const invoke=context=>context.auditLateVote('auction','person','WHATSAPP_VOTE_REJECTED','event',payload);
  for(const key of ['auction_id','participant_id','admin_user_id','event_type']) {
    const context=vm.createContext({});installActualAudit(context,{existing:{...row,[key]:'different'}});
    await assert.rejects(invoke(context),/audit_replay_conflict/);
  }
  for(const key of ['voter_jid','phone_e164','event_at','option','amount']) {
    const context=vm.createContext({});installActualAudit(context,{existing:{...row,payload:{...payload,[key]:'different'}}});
    await assert.rejects(invoke(context),/audit_replay_conflict/);
  }
  const offline=vm.createContext({});installActualAudit(offline,{existing:row,readError:{message:'read unavailable'}});
  await assert.rejects(invoke(offline),/read unavailable/);
  const missing=vm.createContext({ADMIN_USER_ID:'admin',db:{from:()=>({insert:async()=>({error:{code:'23505'}}),select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})}});
  const start=source.indexOf('async function auditLateVote(');
  vm.runInContext(source.slice(start,source.indexOf('async function ',start+1)),missing);
  await assert.rejects(invoke(missing),/audit_replay_conflict/);
  const compatible=vm.createContext({});
  installActualAudit(compatible,{existing:{...row,payload:{...payload,display_name:'enriched',reason:'auction_not_open',winner_participant_id:'winner',final_price:3}}});
  await invoke(compatible);
});

test('unavailable deadline lookup cannot acknowledge a rejected withdrawal', async t => {
  const f = withdrawalFixture(t, { readError: true }); await f.context.processIncomingPollMessage(f.message('withdraw'));
  assert.equal(f.context.voteInbox.status().pending, 1); assert.equal(f.audits.length, 0); assert.equal(f.saves.length, 0);
});

test('attempt to remove an immutable buyout never clears the accepted vote state', async t => {
  const f = withdrawalFixture(t, { buyout: true }); await f.context.processIncomingPollMessage(f.message('withdraw'));
  assert.equal(f.calls.length, 0); assert.equal(f.saves.length, 0); assert.equal(f.audits[0][2], 'BUYOUT_WITHDRAW_ATTEMPT');
  assert.equal(f.context.voteInbox.status().pending, 0);
});

test('rejection audit must be acknowledged before a durable vote can be removed', async () => {
  const code = source.slice(source.indexOf('async function auditLateVote('), source.indexOf('async function ', source.indexOf('async function auditLateVote(') + 1));
  const context = { ADMIN_USER_ID: 'admin', db: { from: () => ({ insert: async () => ({ error: { message: 'audit offline' } }) }) } };
  vm.createContext(context); vm.runInContext(code, context);
  await assert.rejects(context.auditLateVote('auction', 'person', 'rejected', 'event', {}), /audit offline/);
});
