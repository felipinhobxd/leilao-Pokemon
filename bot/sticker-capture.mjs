import { normalizeUserJid, isLidJid, isPhoneJid } from './poll-identities.mjs';
import { unwrapMessageContent } from './poll-votes.mjs';

export function createStickerCapture({ getSocket, adminJids, save, confirmation }) {
  const allowed = new Set(adminJids.map(normalizeUserJid));
  const stickers = new Map();
  async function author(key, socket) {
    if (key.fromMe === true) return 'connected-account';
    const group = String(key.remoteJid).endsWith('@g.us');
    const raw = normalizeUserJid(group ? key.participant : key.remoteJid);
    if (!raw) return null;
    if (allowed.has(raw)) return raw;
    if (isLidJid(raw)) {
      try {
        const pn = normalizeUserJid(await socket?.signalRepository?.lidMapping?.getPNForLID(raw));
        if (isPhoneJid(pn) && allowed.has(pn)) return pn;
      } catch { /* An unresolved identity is never granted access. */ }
    }
    return null;
  }
  return async message => {
    const key = message?.key;
    if (!key?.remoteJid || !message.message) return;
    const content = unwrapMessageContent(message.message);
    const command = String(content?.conversation ?? content?.extendedTextMessage?.text ?? '').trim().toLowerCase() === '!figurinha';
    if (!content?.stickerMessage && !command) return;
    const socket = getSocket();
    const sender = await author(key, socket);
    if (!sender) return;
    // Bind both messages to the same authorized author, even in a shared group.
    const cacheKey = `${key.remoteJid}|${sender}`;
    if (content?.stickerMessage) {
      stickers.delete(cacheKey);
      stickers.set(cacheKey, { key, message: content });
      if (stickers.size > 100) stickers.delete(stickers.keys().next().value);
      return;
    }
    const sticker = stickers.get(cacheKey);
    if (!sticker) {
      await socket.sendMessage(key.remoteJid, { text: '❗ Envie sua figurinha nesta conversa e depois digite !figurinha.' });
      return;
    }
    await save(sticker.key, sticker.message);
    await socket.sendMessage(key.remoteJid, { text: confirmation });
  };
}
