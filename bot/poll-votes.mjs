import { decryptPollVote } from "@whiskeysockets/baileys";
import { buildPollCryptoCandidates } from "./poll-identities.mjs";

function numericTimestamp(value) {
  const number = Number(value?.toString?.() ?? value ?? Date.now());
  return Number.isFinite(number) ? number : Date.now();
}

export async function decryptIncomingPollVote({ sock, message, pollMessage, pollKey }) {
  const pollUpdate = message?.message?.pollUpdateMessage;
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
