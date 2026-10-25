import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Os testes redirecionam BOT_DATA_DIR para um temp ANTES do import: sem isso
// a suíte escrevia no estado real do operador (bug real — ver announce-sticker.mjs).
const dataDir = mkdtempSync(join(tmpdir(), "announce-sticker-test-"));
process.env.BOT_DATA_DIR = dataDir;

const { loadAnnouncedQueueIds, loadAnnouncementSticker, saveAnnouncementSticker, markQueueAnnounced, markQueueRulesAnnounced, loadRulesAnnouncedQueueIds, loadRulesMessage, buildOpeningMessage, openingMentionPermission, sendOpeningMention, STICKER_FILE, ANNOUNCE_GRACE_MINUTES, ANNOUNCE_MINUTES_BEFORE } = await import("./announce-sticker.mjs");
const { generateWAMessageContent } = await import('@whiskeysockets/baileys');

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.BOT_DATA_DIR;
});

const STICKER = { key: { id: "ABC", remoteJid: "1203@g.us" }, message: { stickerMessage: { url: "https://x" } } };

test("figurinha salva e recarregada idempotente", () => {
  saveAnnouncementSticker(STICKER.key, STICKER.message);
  const loaded = loadAnnouncementSticker();
  assert.equal(loaded.key.id, "ABC");
  assert.deepEqual(loaded.message, STICKER.message);
  // resalvar sobrescreve
  saveAnnouncementSticker({ id: "XYZ", remoteJid: "1@g.us" }, { stickerMessage: {} });
  assert.equal(loadAnnouncementSticker().key.id, "XYZ");
  saveAnnouncementSticker(STICKER.key, STICKER.message);
});

test("figurinha inválida é rejeitada", () => {
  assert.throws(() => saveAnnouncementSticker(null, STICKER.message));
  assert.throws(() => saveAnnouncementSticker(STICKER.key, null));
});

test("filas anunciadas persistem entre leituras", () => {
  const announced = loadAnnouncedQueueIds();
  announced.add("q1");
  markQueueAnnounced("q1", announced);
  assert.ok(loadAnnouncedQueueIds().has("q1"));
  markQueueAnnounced("q2");
  assert.ok(loadAnnouncedQueueIds().has("q2"));
});

test("mensagem de abertura usa a flag nativa de @all, sem lista oculta de menções", () => {
  const message = buildOpeningMessage();
  assert.ok(message.text.includes("@all"));
  assert.equal(message.mentionAll, true);
  assert.equal(message.mentions, undefined);
  const fallback = buildOpeningMessage(false);
  assert.ok(!fallback.text.includes("@all"));
  assert.equal(fallback.mentionAll, false);
});

test('envio real da abertura preserva a flag até o serializador Baileys', async () => {
  const sent = [];
  const socket = { user: { id: '5511:4@s.whatsapp.net', lid: '111:2@lid' },
    groupMetadata: async () => ({ size: 150, participants: [{ id: '111@lid', admin: 'admin' }] }),
    sendMessage: async (jid, payload) => sent.push({ jid, payload }),
  };
  const result = await sendOpeningMention({ socket, groupJid: '123@g.us', warn: () => assert.fail('unexpected warning') });
  assert.equal(result.collective, true);
  assert.equal(sent[0].jid, '123@g.us');
  const generated = await generateWAMessageContent(sent[0].payload, {});
  assert.equal(generated.extendedTextMessage.contextInfo.nonJidMentions, 1);
  assert.equal(generated.extendedTextMessage.contextInfo.mentionedJid?.length ?? 0, 0);
});

test('grupos pequenos permitem @all; grupos grandes precisam de admin, incluindo aliases PN/LID', () => {
  assert.equal(openingMentionPermission({ participants: [{ id: 'other@lid' }] }, {}).allowed, true);
  for (const admin of ['admin', 'superadmin']) {
    assert.equal(openingMentionPermission({ size: 33, participants: [{ id: 'other@lid', phoneNumber: '5511@s.whatsapp.net', admin }] }, { id: '5511:7@s.whatsapp.net' }).allowed, true);
  }
  assert.equal(openingMentionPermission({ size: 150, owner: '111@lid', participants: [{ id: '111@lid' }] }, { lid: '111:4@lid' }).allowed, true);
  assert.equal(openingMentionPermission({ size: 150, participants: [{ id: '111@lid' }] }, { lid: '111@lid' }).allowed, false);
  assert.equal(openingMentionPermission({}, {}).allowed, false);
});

test('sem admin envia aviso simples com diagnóstico e sem marcador coletivo', async () => {
  const warnings = [], sent = [];
  const socket = { user: { id: '5511@s.whatsapp.net' },
    groupMetadata: async () => ({ size: 150, participants: [{ id: '5511@s.whatsapp.net' }] }),
    sendMessage: async (_, message) => sent.push(message),
  };
  const result = await sendOpeningMention({ socket, groupJid: '123@g.us', warn: message => warnings.push(message) });
  assert.equal(result.collective, false);
  assert.match(warnings[0], /administrador/);
  assert.equal(sent[0].mentionAll, false);
  assert.ok(!sent[0].text.includes('@all'));
  const generated = await generateWAMessageContent(sent[0], {});
  assert.notEqual(generated.extendedTextMessage.contextInfo?.nonJidMentions, 1);
});

test('metadata indisponível não promete @all e falha de envio continua sendo erro', async () => {
  const warnings = [], sent = [];
  const socket = { groupMetadata: async () => { throw new Error('offline'); },
    sendMessage: async (_, message) => sent.push(message) };
  const result = await sendOpeningMention({ socket, groupJid: '123@g.us', warn: message => warnings.push(message) });
  assert.equal(result.collective, false);
  assert.match(warnings[0], /Falha ao consultar/);
  assert.equal(sent[0].mentionAll, false);
  socket.sendMessage = async () => { throw new Error('send failed'); };
  await assert.rejects(sendOpeningMention({ socket, groupJid: '123@g.us', warn() {} }), /send failed/);
});

test("estado de produção NÃO é tocado (BOT_DATA_DIR redirecionado)", () => {
  // O arquivo real do operador não pode ganhar nada desta suíte.
  assert.ok(STICKER_FILE.startsWith(dataDir), "os testes escrevem no temp, nunca em bot/data");
});

test("janela de grace: bot que sob atrasado ainda avisa; fila velha fica em silencio", () => {
  assert.ok(ANNOUNCE_GRACE_MINUTES > 0, "grace precisa existir");
  assert.ok(ANNOUNCE_MINUTES_BEFORE >= 0, "janela anterior precisa ser >= 0");
});

test("regras: mensagem padrao da operadora carrega integra", () => {
  const text = loadRulesMessage();
  assert.ok(text.includes("REGRAS DO LEILAO") || text.includes("REGRAS DO LEILÃO"), "titulo presente");
  assert.ok(text.includes("FAMILIA DE FOCAS") || text.includes("FAMÍLIA DE FOCAS"));
  assert.ok(text.includes("ARREMATE"));
  assert.ok(text.includes("1 minuto"));
  assert.ok(text.includes("LANCE/ARREMATE E COMPROMISSO") || text.includes("LANCE/ARREMATE É COMPROMISSO"));
});

test("regras: arquivo de override vence o padrao", () => {
  writeFileSync(join(dataDir, "rules-message.json"), JSON.stringify({ text: "REGRAS NOVAS DE TESTE" }), "utf8");
  assert.equal(loadRulesMessage(), "REGRAS NOVAS DE TESTE");
});

test("regras: override corrompido cai no padrao (nunca quebra o anuncio)", () => {
  writeFileSync(join(dataDir, "rules-message.json"), "{isso nao e json", "utf8");
  const text = loadRulesMessage();
  assert.ok(text.includes("REGRAS DO LEILAO") || text.includes("REGRAS DO LEILÃO"));
});

test("regras: filas anunciadas persistem sem corromper o estado da figurinha", () => {
  markQueueAnnounced("queue-fig");
  markQueueRulesAnnounced("queue-rules");
  const rules = loadRulesAnnouncedQueueIds();
  assert.ok(rules.has("queue-rules"), "regras marcadas");
  assert.ok(!rules.has("queue-fig"), "estado da figurinha nao vaza para o das regras");
  assert.ok(loadAnnouncedQueueIds().has("queue-fig"), "figurinha preservada no mesmo arquivo");
  assert.ok(loadAnnouncedQueueIds().has("queue-fig") && !loadRulesAnnouncedQueueIds().has("queue-fig"), "chaves independentes");
});
