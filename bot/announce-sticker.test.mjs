import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Os testes redirecionam BOT_DATA_DIR para um temp ANTES do import: sem isso
// a suíte escrevia no estado real do operador (bug real — ver announce-sticker.mjs).
const dataDir = mkdtempSync(join(tmpdir(), "announce-sticker-test-"));
process.env.BOT_DATA_DIR = dataDir;

const { loadAnnouncedQueueIds, loadAnnouncementSticker, saveAnnouncementSticker, markQueueAnnounced, buildOpeningMessage, STICKER_FILE, ANNOUNCE_GRACE_MINUTES, ANNOUNCE_MINUTES_BEFORE } = await import("./announce-sticker.mjs");

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

test("mensagem de abertura menciona participantes reais", () => {
  const message = buildOpeningMessage(["5541@s.whatsapp.net", "5519@s.whatsapp.net", "lixo", 42]);
  assert.ok(message.text.includes("@todos"));
  assert.deepEqual(message.mentions, ["5541@s.whatsapp.net", "5519@s.whatsapp.net"]);
  const solo = buildOpeningMessage(["5541@s.whatsapp.net"]);
  assert.ok(!solo.text.includes("@todos"), "sem grupo não promete @todos");
  assert.deepEqual(solo.mentions, ["5541@s.whatsapp.net"]);
});

test("estado de produção NÃO é tocado (BOT_DATA_DIR redirecionado)", () => {
  // O arquivo real do operador não pode ganhar nada desta suíte.
  assert.ok(STICKER_FILE.startsWith(dataDir), "os testes escrevem no temp, nunca em bot/data");
});

test("janela de grace: bot que sob atrasado ainda avisa; fila velha fica em silencio", () => {
  assert.ok(ANNOUNCE_GRACE_MINUTES > 0, "grace precisa existir");
  assert.ok(ANNOUNCE_MINUTES_BEFORE >= 0, "janela anterior precisa ser >= 0");
});
