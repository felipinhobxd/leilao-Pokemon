import { decryptPollVote } from "@whiskeysockets/baileys";
import { buildPollCryptoCandidates } from "./poll-identities.mjs";

// O WhatsApp empacota atualizações de enquete (votos) em containers —
// ephemeralMessage (padrão em grupos com mensagens temporárias, ex.: grupos
// novos), viewOnceMessage, editedMessage etc. O Baileys normaliza o conteúdo
// INTERNAMENTE (cleanMessage/isRealMessage usam normalizeMessageContent),
// mas o evento messages.upsert entrega a mensagem CRUA: qualquer check
// direto a message.message.pollUpdateMessage PERDIA o voto em silêncio —
// ele caía no fluxo de "mensagem comum" e era descartado (2026-09-29:
// votos tab-dois-segundos no banco sem NENHUM processamento no terminal).
// Espelha normalizeMessageContent do Baileys (mesmos wrappers, máx. 5 níveis).
export function unwrapMessageContent(content) {
  for (let depth = 0; content && depth < 5; depth++) {
    const wrapper = content.ephemeralMessage
      || content.viewOnceMessage
      || content.documentWithCaptionMessage
      || content.viewOnceMessageV2
      || content.viewOnceMessageV2Extension
      || content.editedMessage
      || content.associatedChildMessage
      || content.groupStatusMessage
      || content.groupStatusMessageV2;
    if (!wrapper?.message) break;
    content = wrapper.message;
  }
  return content;
}

function numericTimestamp(value) {
  const number = Number(value?.toString?.() ?? value ?? Date.now());
  return Number.isFinite(number) ? number : Date.now();
}

export async function decryptIncomingPollVote({ sock, message, content, pollMessage, pollKey }) {
  const pollUpdate = (content ?? unwrapMessageContent(message?.message))?.pollUpdateMessage;
  const creationKey = pollUpdate?.pollCreationMessageKey;
  if (!pollUpdate?.vote || !creationKey?.id) return null;

  const pollEncKey = pollMessage?.messageContextInfo?.messageSecret;
  if (!pollEncKey) {
    const error = new Error("poll_message_secret_missing");
    error.diagnostic = { pollMessageId: creationKey.id, fromMe: Boolean(message?.key?.fromMe) };
    throw error;
  }

  const candidates = await buildPollCryptoCandidates({
    sock,
    messageKey: message?.key ?? {},
    creationKey,
    pollKey: pollKey ?? {},
  });

  let lastError;
  for (const pair of candidates.pairs) {
    try {
      const vote = decryptPollVote(pollUpdate.vote, {
        pollEncKey,
        pollCreatorJid: pair.pollCreatorJid,
        pollMsgId: creationKey.id,
        voterJid: pair.voterJid,
      });
      return {
        pollMessageId: creationKey.id,
        pollUpdate: {
          pollUpdateMessageKey: message.key,
          vote,
          senderTimestampMs: numericTimestamp(pollUpdate.senderTimestampMs),
        },
        decryptContext: pair,
        creatorCandidates: candidates.creatorCandidates,
        voterCandidates: candidates.voterCandidates,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error("poll_vote_decrypt_failed", { cause: lastError });
  error.diagnostic = {
    pollMessageId: creationKey.id,
    fromMe: Boolean(message?.key?.fromMe),
    creatorCandidates: candidates.creatorCandidates,
    voterCandidates: candidates.voterCandidates,
  };
  throw error;
}
