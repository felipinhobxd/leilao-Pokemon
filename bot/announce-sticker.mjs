import { finiteNumber } from './numeric-config.mjs';
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
//      retransmite a figurinha no grupo + @all nativo (mentionAll), após
//      validar a permissão da conta com groupMetadata.
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
import { normalizeUserJid } from "./poll-identities.mjs";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
export const DATA_DIR = process.env.BOT_DATA_DIR ? join(process.env.BOT_DATA_DIR) : join(here, "data");
export const STICKER_FILE = join(DATA_DIR, "announcement-sticker.json");
export const ANNOUNCE_STATE_FILE = join(DATA_DIR, "announce-state.json");

export const ANNOUNCE_MINUTES_BEFORE = finiteNumber(process.env.BOT_ANNOUNCE_MINUTES_BEFORE, 5, 0);
// Após o início da fila, o bot ainda avisa por esta janela (restart atrasado
// cobre); além disso a fila fica em silêncio — "vai começar" tardio seria
// mentira. Desacoplado do dispatch: fila "Agora" tem o 1º lote claimado
// antes do anúncio, e fila começando com BRINDE nem tem dispatch na pos. 1.
export const ANNOUNCE_GRACE_MINUTES = finiteNumber(process.env.BOT_ANNOUNCE_GRACE_MINUTES, 15, 0);
// REGRAS DO LEILÃO: enviadas ANTES da figurinha+"O leilão vai começar!" —
// o operador pediu "uns 2 minutos antes" (do anúncio), sempre antes dele.
// O texto é o da operadora (verbatim); sobreponível em
// bot/data/rules-message.json {"text": "..."} sem tocar no código.
export const ANNOUNCE_RULES_MINUTES_BEFORE = Number(process.env.BOT_RULES_MINUTES_BEFORE ?? 2);

// Texto padrão original de 2026-09-25, atualizado pelas decisões de 2026-10-27.
export const DEFAULT_RULES_MESSAGE = `ㅤ𓈒ㅤ📘 REGRAS DO LEILÃO 🗯️ ♡ ┈─╯

OLÁ, MINHA FAMÍLIA DE FOCAS! 🦭

Estamos testando um bot para facilitar a dinâmica dos nossos leilões! Ele registra os votos e mostra os arremates na hora, deixando tudo mais organizado. Ainda estamos em fase de testes, então pedimos um pouquinho de paciência! Tudo continua sendo preparado com muito amor e carinho para vocês. ♡

→ As fotos e enquetes serão enviadas com um intervalo de aproximadamente 30 a 40 segundos cada. Fiquem de olho! ;)

♡ 1. A última opção da enquete sempre será o ARREMATE, acompanhada da nossa foquinha (🦭). Ao clicar nela, a carta é sua, e o bot mostra o arremate na hora!

♡ 2. Se duas pessoas arrematarem juntas, vale o primeiro registro confirmado pelo bot. Caso haja alguma falha no registro, os ADMs vão conferir!

♡ 3. Nos lances sem arremate, se você marcar um valor maior e depois mudar para um menor, sem que outra pessoa tenha dado lance, será considerado o maior valor selecionado. O bot registra todas as alterações e avisa sempre que alguém muda o voto! Isso não permite desfazer um arremate nem retirar um lance após o prazo de 1 minuto.

♡ 4. Os lances valem até o horário de encerramento anunciado para a fila. No dia seguinte, enviamos os relatórios no privado de cada um.

♡ 5. No brinde e no quiz, ganha quem marcar primeiro a única resposta correta, conforme o registro confirmado pelo bot. Não é necessário comprar ou arrematar uma carta para participar.

╭── 💳 . ࣪ PAGAMENTOS ୭ ࣪♡

♡ 6. Vocês têm até 10 dias para pagar. A data de vencimento será informada em cada leilão. Aceitamos PIX, OLX e cartão de crédito — consulte as taxas com a gente!

♡ 7. A falta de pagamento, sem justificativa ou retorno após 3 tentativas de contato, resultará em banimento e inclusão na blacklist global de grupos de TCG.

→ Teve algum problema ou imprevisto? Converse com a gente! Dúvidas sobre cobranças, lances, arremates, funcionamento do bot ou assuntos gerais do leilão devem ser encaminhadas ao ADM Murilo. ♡

╭── 📦 . ࣪ ENVIO E CAIXINHA ୭ ࣪♡

♡ 8. FRETE GRÁTIS para compras acima de R$ 300 (Sul/Sudeste) ou R$ 450 (demais regiões).

♡ 9. Guardamos suas cartas por até 1 mês. Depois disso, chamamos você para combinar se prefere estender o prazo ou pedir o envio.

♡ 10. Você pode pedir suas cartas a qualquer momento! Postamos em até 2 dias úteis após a solicitação e a confirmação dos pagamentos das cartas e do frete, quando houver.

Obrigada por fazerem parte da nossa família de focas e acompanharem essa novidade com a gente! Bons lances! 🦭♡ e

⚠️ LANCE/ARREMATE É COMPROMISSO!

Dê lances apenas se tiver CERTEZA de que poderá pagar. Você tem até 1 minuto após seu último lance comum aceito para retirá-lo, desde que o leilão ainda esteja aberto e dentro do horário anunciado. Depois desse minuto, a retirada não é permitida. ARREMATE é definitivo e não pode ser retirado! O bot registra tudo automaticamente, e desistências fora do prazo prejudicam nossa organização e os outros membros que também queriam a carta. ⚠️`;

/** Texto das regras: arquivo em bot/data/rules-message.json vence o default
 * (a operadora pode editar sem redeploy); ausente/corrompido = default. */
export const RULES_MESSAGE_FILE = join(DATA_DIR, "rules-message.json");

export function loadRulesMessage() {
  const override = readJson(RULES_MESSAGE_FILE);
  const text = typeof override?.text === "string" ? override.text.trim() : "";
  return text || DEFAULT_RULES_MESSAGE;
}

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

/** Filas que já receberam as REGRAS (mesmo arquivo, chave própria). */
export function loadRulesAnnouncedQueueIds() {
  const state = readJson(ANNOUNCE_STATE_FILE);
  if (!Array.isArray(state?.rules_announced)) return new Set();
  return new Set(state.rules_announced);
}

export function markQueueRulesAnnounced(queueId, announced = loadRulesAnnouncedQueueIds()) {
  announced.add(String(queueId));
  const state = readJson(ANNOUNCE_STATE_FILE) ?? {};
  const stickers = Array.isArray(state?.announced) ? state.announced : [];
  writeJson(ANNOUNCE_STATE_FILE, { announced: stickers, rules_announced: [...announced].slice(-500) });
  return announced;
}

/** Native collective mention, not a hidden list of individual JIDs. */
export function buildOpeningMessage(mentionAll = true) {
  const text = `📣 ${mentionAll ? "@all " : ""}O leilão vai começar!\nPreparem os lances — o primeiro lote chega em instantes. 🃏🔥`;
  return { text, mentionAll };
}

export function openingMentionPermission(metadata, user) {
  if (!Array.isArray(metadata?.participants) || !metadata.participants.length) {
    return { allowed: false, code: "metadata_unavailable", reason: "Não foi possível confirmar os participantes do grupo." };
  }
  const count = Math.max(Number(metadata.size) || 0, metadata.participants.length);
  if (count <= 32) return { allowed: true, reason: null };
  const own = new Set([user?.id, user?.lid].map(normalizeUserJid).filter(Boolean));
  const self = metadata.participants.find(member =>
    [member.id, member.lid, member.phoneNumber].some(jid => own.has(normalizeUserJid(jid))));
  const isAdmin = self?.admin === "admin" || self?.admin === "superadmin" || own.has(normalizeUserJid(metadata.owner));
  return isAdmin
    ? { allowed: true, reason: null }
    : { allowed: false, code: self ? "mention_denied" : "membership_unconfirmed", reason: "O bot precisa ser administrador para usar @all em grupos com mais de 32 participantes." };
}

/** Used by the real opening sequence and tested without a WhatsApp socket. */
export async function sendOpeningMention({ socket, groupJid, warn = console.warn }) {
  let permission;
  try {
    const metadata = await socket.groupMetadata(groupJid);
    permission = openingMentionPermission(metadata, socket.user);
  } catch {
    permission = { allowed: false, reason: "Falha ao consultar o grupo; não foi possível validar a permissão de @all." };
  }
  if (!permission.allowed) warn(`⚠️ Abertura sem @all: ${permission.reason} Enviando aviso simples.`);
  // Forward the entire payload: rebuilding only text/mentions drops mentionAll.
  await socket.sendMessage(groupJid, buildOpeningMessage(permission.allowed));
  return { collective: permission.allowed, reason: permission.reason };
}
