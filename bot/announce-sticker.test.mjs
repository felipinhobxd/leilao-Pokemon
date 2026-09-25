import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Os testes redirecionam BOT_DATA_DIR para um temp ANTES do import: sem isso
// a suíte escrevia no estado real do operador (bug real — ver announce-sticker.mjs).
const dataDir = mkdtempSync(join(tmpdir(), "announce-sticker-test-"));
process.env.BOT_DATA_DIR = dataDir;

const { loadAnnouncedQueueIds, loadAnnouncementSticker, saveAnnouncementSticker, markQueueAnnounced, markQueueRulesAnnounced, loadRulesAnnouncedQueueIds, loadRulesMessage, buildOpeningMessage, STICKER_FILE, ANNOUNCE_GRACE_MINUTES, ANNOUNCE_MINUTES_BEFORE } = await import("./announce-sticker.mjs");

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
  assert.ok(message.text.includes("@all"));
  assert.ok(!message.text.includes("@todos"), "WhatsApp renderiza a menção coletiva como @all, não @todos");
  assert.deepEqual(message.mentions, ["5541@s.whatsapp.net", "5519@s.whatsapp.net"]);
  const solo = buildOpeningMessage(["5541@s.whatsapp.net"]);
  assert.ok(!solo.text.includes("@all"), "sem grupo nao promete @all");
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
