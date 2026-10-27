import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnectionHistory } from './connection-history.mjs';

function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'connection-health-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let time = Date.parse('2026-10-27T00:00:00Z'), mono = 100;
  const options = { directory, now: () => time, monotonic: () => mono };
  return { directory, options, history: createConnectionHistory(options), advance(ms) { time += ms; mono += ms; }, clockJump(ms) { time += ms; } };
}
test('one continuous outage survives retries, tracks process restart and measures monotonic recovery', t => {
  const s = setup(t); s.history.disconnect({ cause: 'timeout', code: 408 });
  s.advance(5000); s.history.disconnect({ cause: 'timeout', code: 408 }); s.history.processExit(1); s.history.processStarted();
  s.clockJump(30000); s.advance(2000); s.history.connected();
  const value = s.history.summary();
  assert.equal(value.count24h, 1); assert.equal(value.processRestarts24h, 1);
  assert.equal(value.last.durationMs, 7000); assert.equal(value.last.estimated, false); assert.equal(value.ongoing, false);
  assert.equal(value.last.exitCode, 1);
});
test('supervisor restart restores open outage with an explicitly estimated duration', t => {
  const s = setup(t); s.history.disconnect({ cause: 'timeout', code: 408 }); s.advance(9000);
  const next = createConnectionHistory(s.options); next.connected();
  assert.equal(next.summary().last.durationMs, 9000); assert.equal(next.summary().last.estimated, true);
  assert.equal(next.summary().count24h, 1);
});
test('planned stops do not count as failures or pretend an open outage recovered', t => {
  const s = setup(t); s.history.connected(); s.history.plannedStop(); s.history.connected();
  assert.equal(s.history.summary().count24h, 0);
  s.history.disconnect({ cause: 'timeout', code: 408 }); s.history.plannedStop(); s.history.connected();
  assert.equal(s.history.summary().count24h, 1); assert.equal(s.history.summary().last.recoveredAt, null);
});
test('rolling count expires and bounded local retention reports saturation', t => {
  const s = setup(t);
  for (let i = 0; i < 2050; i++) { s.history.disconnect({ cause: 'timeout', code: 408 }); s.history.connected(); s.advance(1); }
  assert.equal(s.history.summary().count24h, 2048); assert.equal(s.history.summary().countLimited, true);
  const file = path.join(s.directory, 'connection-history.json');
  assert.ok(readFileSync(file).length < 1024 * 1024);
  s.advance(86400001); assert.equal(s.history.summary().count24h, 0);
  s.advance(7 * 86400000); s.history.connected();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).events.length, 0);
});
test('corrupt history is preserved and disk failures cannot throw into bot processing', t => {
  const s = setup(t), file = path.join(s.directory, 'connection-history.json');
  writeFileSync(file, '{broken');
  const next = createConnectionHistory(s.options); next.processExit(); next.connected();
  assert.equal(next.summary().storageIssue, true); assert.equal(readFileSync(file, 'utf8'), '{broken');
  const bad = createConnectionHistory({ ...s.options, directory: file });
  assert.doesNotThrow(() => { bad.processExit(); bad.connected(); }); assert.equal(bad.summary().storageIssue, true);
});
