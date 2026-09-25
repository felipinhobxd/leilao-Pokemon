// P-05 — Figurinha de abertura do leilão: capturada pelo próprio operador e
// retransmitida pelo bot antes do primeiro lote de cada fila.
//
// COMO FUNCIONA (o WhatsApp não mostra ID de figurinha para ninguém):
//   1. Com o bot rodando (`npm run start`), o operador envia a figurinha em
//      QUALQUER conversa (vale "mensagem para você mesmo") e em seguida
//      digita `!figurinha` NA MESMA conversa.
//   2. O bot guarda a última figurinha vista nesse chat (mensagem serializada
//      + key) em bot/data/announcement-sticker.json — persiste entre restarts.
//   3. No agendamento: quando o PRIMEIRO lote de uma fila está a caminho
//      (default: 5 minutos, BOT_ANNOUNCE_MINUTES_BEFORE; 0 = na hora), o bot
//      retransmite a figurinha no grupo + mensagem com @todos (menção real
//      de todos os participantes via groupMetadata).
//
// Estado "já anunciado" por fila em bot/data/announce-state.json (idempotência
// entre restarts; arquivo local como sessão/logs/backups — não é dado do
// negócio, é estado de operação do PC).
//
// BOT_DATA_DIR permite aos TESTES redirecionar o diretório para um temp:
// sem isso a suíte escrevia no estado REAL do operador (bug real: a figurinha
// de produção virou "ABC" de teste — doctor acusou capturada sem captura).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
export const DATA_DIR = process.env.BOT_DATA_DIR ? join(process.env.BOT_DATA_DIR) : join(here, "data");
export const STICKER_FILE = join(DATA_DIR, "announcement-sticker.json");
export const ANNOUNCE_STATE_FILE = join(DATA_DIR, "announce-state.json");

export const ANNOUNCE_MINUTES_BEFORE = Number(process.env.BOT_ANNOUNCE_MINUTES_BEFORE ?? 5);
// Após o início da fila, o bot ainda avisa por esta janela (restart atrasado
// cobre); além disso a fila fica em silêncio — "vai começar" tardio seria
// mentira. Desacoplado do dispatch: fila "Agora" tem o 1º lote claimado
// antes do anúncio, e fila começando com BRINDE nem tem dispatch na pos. 1.
export const ANNOUNCE_GRACE_MINUTES = Number(process.env.BOT_ANNOUNCE_GRACE_MINUTES ?? 15);

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null; // arquivo corrompido = sem figurinha; o operador recaptura
  }
}

function writeJson(path, value) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 1), "utf8");
}

/** Última figurinha capturada: { key, message } serializáveis (WAMessage). */
export function loadAnnouncementSticker() {
  const sticker = readJson(STICKER_FILE);
  if (!sticker?.key?.id || !sticker?.message) return null;
  return sticker;
}

export function saveAnnouncementSticker(key, message) {
  if (!key?.id || !message) throw new Error("sticker_key_or_message_missing");
  writeJson(STICKER_FILE, { key, message, saved_at: new Date().toISOString() });
  return { key, message };
}

/** Filas que já receberam a figurinha de abertura (idempotência). */
export function loadAnnouncedQueueIds() {
  const state = readJson(ANNOUNCE_STATE_FILE);
  if (!Array.isArray(state?.announced)) return new Set();
  return new Set(state.announced);
}

export function markQueueAnnounced(queueId, announced = loadAnnouncedQueueIds()) {
  announced.add(String(queueId));
  // Compacta: listas enormes de filas antigas não justificam arquivo crescido.
  const list = [...announced].slice(-500);
  writeJson(ANNOUNCE_STATE_FILE, { announced: list });
  return announced;
}

/** Mensagem de texto do anúncio com @all (menção real de cada JID — o
 * WhatsApp renderiza a marcação de todos como @all). */
export function buildOpeningMessage(participantJids = []) {
  const jids = participantJids.filter(jid => typeof jid === "string" && jid.includes("@"));
  const text = `📣 ${jids.length > 1 ? "@all " : ""}O leilão vai começar!\nPreparem os lances — o primeiro lote chega em instantes. 🃏🔥`;
  return { text, mentions: jids };
}
