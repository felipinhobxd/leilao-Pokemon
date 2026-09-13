import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMessageId, dispatchPollSecret } from '../bot/dispatch-id.mjs';

const id = '12345678-1234-1234-1234-123456789abc';

test('dispatch message ids are deterministic and stage-specific', () => {
  const announcement = dispatchMessageId(id, 'announcement');
  const poll = dispatchMessageId(id, 'poll');
  assert.equal(announcement, dispatchMessageId(id, 'announcement'));
  assert.equal(poll, dispatchMessageId(id, 'poll'));
  assert.notEqual(announcement, poll);
  assert.match(announcement, /^3EB0[A-F0-9]{16}$/);
  assert.match(poll, /^3EB0[A-F0-9]{16}$/);
});

test('poll secret is deterministic and 32 bytes', () => {
  const first = dispatchPollSecret(id);
  const second = dispatchPollSecret(id);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
});
