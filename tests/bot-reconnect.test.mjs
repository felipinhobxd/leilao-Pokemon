import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('replacement sockets retry after consecutive failures and ignore old close events', async () => {
  const source = readFileSync(new URL('../bot/index.mjs', import.meta.url), 'utf8');
  const connect = source.slice(source.indexOf('async function connect()'), source.indexOf('process.on("SIGINT"'));
  const sockets = [], retries = [];
  const context = vm.createContext({
    SESSION_DIR: 'unused', logger: {}, sock: null, schedulerTimer: null,
    dispatchQueue: null, socketReady: false, queueEnabled: () => false,
    useMultiFileAuthState: async () => ({ state: {}, saveCreds() {} }),
    makeWASocket: config => {
      const handlers = {};
      const socket = { config, handlers, ev: { on(event, fn) { handlers[event] = fn; } } };
      sockets.push(socket); return socket;
    },
    getStoredPollMessage() {}, rememberContact() {},
    DisconnectReason: { loggedOut: 401, connectionReplaced: 440 },
    clearInterval() {}, setTimeout(fn) { retries.push(fn); },
    console: { log() {}, error() {} },
    process: { exit() { throw new Error('unexpected exit'); } },
  });
  vm.runInContext(connect, context);
  await context.connect();
  const close = socket => socket.handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  close(sockets[0]); close(sockets[0]);
  assert.equal(retries.length, 1, 'one retry per closed socket');
  retries.shift()(); await new Promise(setImmediate);
  assert.equal(sockets.length, 2);
  close(sockets[0]); assert.equal(retries.length, 0, 'ignore stale socket');
  close(sockets[1]); assert.equal(retries.length, 1, 'replacement also retries');
  retries.shift()(); await new Promise(setImmediate);
  assert.equal(sockets.length, 3);
});
