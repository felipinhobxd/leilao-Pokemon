import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  aesEncryptGCM,
  hmacSign,
  proto,
} from "@whiskeysockets/baileys";
import { decryptIncomingPollVote } from "./poll-votes.mjs";

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
