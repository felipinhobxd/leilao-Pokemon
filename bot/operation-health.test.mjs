import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationHealth } from './operation-health.mjs';

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
