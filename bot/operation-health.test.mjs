import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationHealth } from './operation-health.mjs';

test('vote telemetry is bounded, survives supervisor restart and never includes raw votes or errors', () => {
  const health = createOperationHealth(() => '2026-10-26T04:00:00Z');
  health.votes({ pending: 2, review: 1, issue: 'review', message: 'private vote', token: 'secret' });
  const restored = createOperationHealth(); restored.restore(health.state);
  assert.equal(restored.state.votes.pending, 2); assert.equal(restored.state.votes.review, 1);
  assert.equal(restored.state.votes.at, '2026-10-26T04:00:00Z');
  assert.ok(!JSON.stringify(restored.state).includes('secret'));
  health.votes({ pending: Infinity, review: -1, issue: 'https://private.invalid/token' });
  assert.equal(health.state.votes.pending, 0); assert.equal(health.state.votes.review, 0); assert.equal(health.state.votes.issue, '');
});

test('bounded telemetry keeps backup failures until the next attempt and survives supervisor restart', () => {
  let at='2026-10-25T07:00:00Z';const health=createOperationHealth(()=>at);
  health.database(false);assert.equal(health.state.database.failedAt,at);
  at='2026-10-25T07:01:00Z';health.database(true);assert.equal(health.state.database.recoveredAt,at);
  at='2026-10-25T07:02:00Z';health.database(true);assert.equal(health.state.database.recoveredAt,'2026-10-25T07:01:00Z');
  health.backup('failed',new Error('521'));health.mention('Conta precisa ser admin');
  const next=createOperationHealth(()=>at);next.restore(JSON.parse(JSON.stringify(health.state)));
  assert.equal(next.state.backup.status,'failed');assert.match(next.state.backup.error,/521/);assert.equal(next.state.mention.issue,'Conta precisa ser admin');
  next.backup('success',null,true);next.mention('');assert.equal(next.state.backup.error,undefined);assert.equal(next.state.backup.cloud,true);assert.equal(next.state.mention.issue,'');
  for(let i=0;i<10000;i++)next.database(false);
  assert.ok(JSON.stringify(next.state).length<1000);
});

test('cleanup telemetry is bounded, records deferred maintenance, and restores without claiming a new attempt',()=>{
 const health=createOperationHealth(()=> '2026-10-26T03:00:00Z');
 health.cleanup('blocked','backup_coverage_incomplete');
 assert.equal(health.state.protectionVersion,1);
 assert.deepEqual(health.state.cleanup,{status:'blocked',at:'2026-10-26T03:00:00Z',reason:'backup_coverage_incomplete',deleted:0});
 const restored=createOperationHealth(()=> '2026-10-26T04:00:00Z');restored.restore(health.state);
 assert.equal(restored.state.cleanup.at,'2026-10-26T03:00:00Z');
 restored.cleanup('completed','',5);assert.equal(restored.state.cleanup.deleted,5);
 restored.cleanup('failed','https://secret.invalid/?token=secret',Infinity);
 assert.equal(restored.state.cleanup.reason,'');assert.equal(restored.state.cleanup.deleted,0);
 assert.ok(JSON.stringify(restored.state).length<1000);
});
