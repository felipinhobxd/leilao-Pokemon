import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startAll } from '../scripts/start-all.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
test('launcher starts both children and shuts them down', async () => {
  const app = startAll([0, 1].map(() => ({ cwd: process.cwd(), args: ['-e', 'setInterval(() => {}, 1000)'] })));
  await wait(100);
  assert.equal(app.children.length, 2);
  assert.ok(app.children.every(child => child.pid && child.exitCode === null));
  await app.stop();
  for (const child of app.children) assert.throws(() => process.kill(child.pid, 0));
});

test('session guard rejects another owner and releases automatically at exit', async () => {
  const guard = new URL('../bot/session-guard.mjs', import.meta.url).href;
  const script = `await import(${JSON.stringify(guard)}); console.log('ready'); setInterval(() => {}, 1000)`;
  const options = { env: { ...process.env, WHATSAPP_SESSION_DIR: `guard-test-${process.pid}`, LEILAO_SESSION_OWNER_PID: '' }, stdio: ['ignore', 'pipe', 'pipe'] };
  const owner = spawn(process.execPath, ['--input-type=module', '-e', script], options);
  try {
    await once(owner.stdout, 'data');
    const second = spawn(process.execPath, ['--input-type=module', '-e', script], options);
    const [code] = await once(second, 'exit');
    assert.equal(code, 1);
  } finally { const exited = once(owner, 'exit'); owner.kill(); await exited; }
  const next = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(guard)})`], options);
  assert.equal((await once(next, 'exit'))[0], 0);
});
