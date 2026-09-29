import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  aesEncryptGCM,
  hmacSign,
  proto,
} from "@whiskeysockets/baileys";
import { decryptIncomingPollVote, unwrapMessageContent } from "./poll-votes.mjs";

function encryptPollVote({ pollEncKey, pollMsgId, pollCreatorJid, voterJid, selectedOptions }) {
  const sign = Buffer.concat([
    Buffer.from(pollMsgId),
    Buffer.from(pollCreatorJid),
    Buffer.from(voterJid),
    Buffer.from("Poll Vote"),
    new Uint8Array([1]),
  ]);
  const key0 = hmacSign(pollEncKey, new Uint8Array(32), "sha256");
  const key = hmacSign(sign, key0, "sha256");
  const aad = Buffer.from(`${pollMsgId}\u0000${voterJid}`);
  const iv = randomBytes(12);
  const plaintext = proto.Message.PollVoteMessage.encode({ selectedOptions }).finish();
  return { encIv: iv, encPayload: aesEncryptGCM(plaintext, key, iv, aad) };
}

test("manual self vote decrypts with creator LID and voter PN while fromMe=true", async () => {
  const pollMsgId = "3EB0SELFVOTE123";
  const creatorLid = "80179053510687@lid";
  const voterPn = "554198587027@s.whatsapp.net";
  const pollEncKey = randomBytes(32);
  const selectedHash = randomBytes(32);
  const encrypted = encryptPollVote({
    pollEncKey,
    pollMsgId,
    pollCreatorJid: creatorLid,
    voterJid: voterPn,
    selectedOptions: [selectedHash],
  });

  const sock = {
    user: { id: "554198587027:49@s.whatsapp.net", lid: "80179053510687:49@lid" },
    signalRepository: {
      lidMapping: {
        async getPNForLID(jid) {
          return jid === creatorLid ? voterPn : null;
        },
        async getLIDForPN(jid) {
          return jid === voterPn ? creatorLid : null;
        },
      },
    },
  };

  const message = {
    key: {
      id: "VOTE1",
      remoteJid: "120363429348829532@g.us",
      fromMe: true,
      participant: creatorLid,
      participantAlt: voterPn,
    },
    message: {
      pollUpdateMessage: {
        pollCreationMessageKey: {
          id: pollMsgId,
          remoteJid: "120363429348829532@g.us",
          fromMe: true,
          participant: creatorLid,
        },
        vote: encrypted,
        senderTimestampMs: Date.now(),
      },
    },
  };

  const result = await decryptIncomingPollVote({
    sock,
    message,
    pollMessage: { messageContextInfo: { messageSecret: pollEncKey } },
    pollKey: { id: pollMsgId, remoteJid: message.key.remoteJid, fromMe: true },
  });

  assert.equal(result.decryptContext.pollCreatorJid, creatorLid);
  assert.equal(result.decryptContext.voterJid, voterPn);
  assert.equal(result.pollUpdate.pollUpdateMessageKey.fromMe, true);
  assert.deepEqual(Buffer.from(result.pollUpdate.vote.selectedOptions[0]), selectedHash);
});

// ---------------------------------------------------------------------------
// CORREÇÃO 2026-09-29 (votos não computados): votos de enquete chegam às
// vezes ENCAPSULADOS em ephemeralMessage (grupos com mensagens temporárias —
// padrão em grupos novos) / viewOnceMessage / editedMessage. O check direto
// a message.message.pollUpdateMessage nunca via o voto — ele caía no fluxo
// de "mensagem comum" e era descartado em silêncio. unwrapMessageContent
// espelha normalizeMessageContent do Baileys; decryptIncomingPollVote
// aceita (ou deriva) o conteúdo JÁ desembrulhado.
// ---------------------------------------------------------------------------

function buildVoteMessage({ pollMsgId, remoteJid, voterPn, encrypted, wrap }) {
  const pollUpdateMessage = {
    pollCreationMessageKey: {
      id: pollMsgId,
      remoteJid,
      fromMe: true,
      participant: "80179053510687@lid",
    },
    vote: encrypted,
    senderTimestampMs: Date.now(),
  };
  const message = {
    key: {
      id: "WRAPPEDVOTE1",
      remoteJid,
      fromMe: true,
      participant: "80179053510687@lid",
      participantAlt: voterPn,
    },
    pushName: "Felipe V",
    message: wrap
      ? { ephemeralMessage: { message: { pollUpdateMessage } } }
      : { pollUpdateMessage },
  };
  return { message, content: { pollUpdateMessage } };
}

test("voto encapsulado em ephemeralMessage é reconhecido e decriptado (fix 2026-09-29)", async () => {
  const pollMsgId = "3EB0WRAPPEDVOTE";
  const creatorLid = "80179053510687@lid";
  const voterPn = "554198587027@s.whatsapp.net";
  const pollEncKey = randomBytes(32);
  const selectedHash = randomBytes(32);
  const encrypted = encryptPollVote({
    pollEncKey,
    pollMsgId,
    pollCreatorJid: creatorLid,
    voterJid: voterPn,
    selectedOptions: [selectedHash],
  });
  const sock = {
    user: { id: "554198587027:49@s.whatsapp.net", lid: "80179053510687:49@lid" },
    signalRepository: {
      lidMapping: {
        async getPNForLID(jid) { return jid === creatorLid ? voterPn : null; },
        async getLIDForPN(jid) { return jid === voterPn ? creatorLid : null; },
      },
    },
  };
  const { message, content } = buildVoteMessage({ pollMsgId, remoteJid: "120363429348829532@g.us", voterPn, encrypted, wrap: true });

  // 1) O RECONHECIMENTO que antes falhava: check direto NÃO vê o voto...
  assert.equal(message?.message?.pollUpdateMessage, undefined);
  // ...o unwrap VÊ — este é o formato que handleIncomingMessages usa agora.
  assert.ok(unwrapMessageContent(message.message)?.pollUpdateMessage?.pollCreationMessageKey?.id);

  // 2) Decriptação com o conteúdo desembrulhado (caminho do handler corrigido).
  const viaContent = await decryptIncomingPollVote({
    sock, message, content,
    pollMessage: { messageContextInfo: { messageSecret: pollEncKey } },
    pollKey: { id: pollMsgId, remoteJid: message.key.remoteJid, fromMe: true },
  });
  assert.deepEqual(Buffer.from(viaContent.pollUpdate.vote.selectedOptions[0]), selectedHash);

  // 3) Decriptação SEM content — o unwrap interno cobre a fila de votos
  //    pendentes (drainPendingPollVotes), que só passa a mensagem crua.
  const viaFallback = await decryptIncomingPollVote({
    sock, message,
    pollMessage: { messageContextInfo: { messageSecret: pollEncKey } },
    pollKey: { id: pollMsgId, remoteJid: message.key.remoteJid, fromMe: true },
  });
  assert.deepEqual(Buffer.from(viaFallback.pollUpdate.vote.selectedOptions[0]), selectedHash);
});

test("unwrapMessageContent: containers aninhados, conteúdo cru e ciclos", () => {
  const leaf = { conversation: "oi" };
  // Duplo encapsulamento (viewOnce → ephemeral), como o Baileys normaliza.
  const nested = { viewOnceMessage: { message: { ephemeralMessage: { message: leaf } } } };
  assert.equal(unwrapMessageContent(nested), leaf);
  // Sem wrapper: devolve o próprio conteúdo.
  assert.equal(unwrapMessageContent(leaf), leaf);
  // null/undefined seguros.
  assert.equal(unwrapMessageContent(null), null);
  assert.equal(unwrapMessageContent(undefined), undefined);
  // Ciclo (wrapper apontando para si): termina pelos 5 níveis, sem loop infinito.
  const cyclic = {};
  cyclic.ephemeralMessage = { message: cyclic };
  assert.ok(unwrapMessageContent(cyclic) !== undefined);
});
