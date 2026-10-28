import test from 'node:test';
import assert from 'node:assert/strict';
import { createStickerCapture } from './sticker-capture.mjs';

test('only an authorized author can save their own sticker, in groups and DMs', async () => {
  const saved = [], replies = [];
  const capture = createStickerCapture({ adminJids: ['123@s.whatsapp.net'],
    getSocket: () => ({ sendMessage: async (...args) => replies.push(args),
      signalRepository: { lidMapping: { getPNForLID: async jid => jid === '456@lid' ? '123@s.whatsapp.net' : null } } }),
    save: key => saved.push(key.id), confirmation: 'ok' });
  const message = (sender, id, content, group = true, fromMe = false) => ({
    key: { id, remoteJid: group ? 'test@g.us' : sender, participant: group ? sender : undefined, fromMe },
    message: { ephemeralMessage: { message: content } },
  });
  const sticker = { stickerMessage: {} }, command = { conversation: '!figurinha' };
  await capture(message('999@s.whatsapp.net', 'bad', sticker));
  await capture(message('999@s.whatsapp.net', 'cmd', command));
  assert.equal(replies.length, 0);
  await capture(message('123@s.whatsapp.net', 'cmd', command));
  assert.deepEqual(saved, []);
  await capture(message('123:2@s.whatsapp.net', 'good', sticker));
  await capture(message('999@s.whatsapp.net', 'poison', sticker));
  await capture(message('456@lid', 'cmd', command));
  assert.deepEqual(saved, ['good']);
  await capture(message('999@s.whatsapp.net', 'bad-dm', sticker, false));
  await capture(message('999@s.whatsapp.net', 'cmd', command, false));
  assert.deepEqual(saved, ['good']);
  await capture(message('999@s.whatsapp.net', 'own', sticker, false, true));
  await capture(message('999@s.whatsapp.net', 'cmd', command, false, true));
  assert.deepEqual(saved, ['good', 'own']);
});

test('two authorized operators cannot replace each other’s pending sticker', async () => {
  const saved = [];
  const capture = createStickerCapture({ adminJids: ['1@s.whatsapp.net', '2@s.whatsapp.net'],
    getSocket: () => ({ sendMessage: async () => {} }), save: key => saved.push(key.id), confirmation: 'ok' });
  for (const [sender, id, message] of [
    ['1', 'one', { stickerMessage: {} }], ['2', 'two', { stickerMessage: {} }],
    ['1', 'cmd', { conversation: '!figurinha' }],
  ]) await capture({ key: { remoteJid: 'test@g.us', participant: `${sender}@s.whatsapp.net`, id }, message });
  assert.deepEqual(saved, ['one']);
});
