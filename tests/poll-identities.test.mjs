import assert from "node:assert/strict";
import test from "node:test";
import { buildPollCryptoCandidates, normalizeUserJid } from "../bot/poll-identities.mjs";

test("normalizes device suffix without collapsing PN and LID", () => {
  assert.equal(normalizeUserJid("554198587027:49@s.whatsapp.net"), "554198587027@s.whatsapp.net");
  assert.equal(normalizeUserJid("80179053510687:49@lid"), "80179053510687@lid");
});

test("fromMe self vote keeps own LID and PN and tries LID creator + PN voter first", async () => {
  const sock = {
    user: {
      id: "554198587027:49@s.whatsapp.net",
      lid: "80179053510687:49@lid",
    },
    signalRepository: {
      lidMapping: {
        async getPNForLID(lid) {
          if (lid === "80179053510687@lid") return "554198587027@s.whatsapp.net";
          return null;
        },
        async getLIDForPN(pn) {
          if (pn === "554198587027@s.whatsapp.net") return "80179053510687@lid";
          return null;
        },
      },
    },
  };

  const result = await buildPollCryptoCandidates({
    sock,
    creationKey: {
      id: "POLL1",
      remoteJid: "120363429348829532@g.us",
      fromMe: true,
      participant: "80179053510687@lid",
    },
    messageKey: {
      id: "VOTE1",
      remoteJid: "120363429348829532@g.us",
      fromMe: true,
      participant: "80179053510687@lid",
      participantAlt: "554198587027@s.whatsapp.net",
    },
  });

  assert.deepEqual(result.creatorCandidates.slice(0, 2), [
    "80179053510687@lid",
    "554198587027@s.whatsapp.net",
  ]);
  assert.deepEqual(result.voterCandidates.slice(0, 2), [
    "554198587027@s.whatsapp.net",
    "80179053510687@lid",
  ]);
  assert.deepEqual(result.pairs[0], {
    pollCreatorJid: "80179053510687@lid",
    voterJid: "554198587027@s.whatsapp.net",
  });
});

test("LID-only voter is enriched with PN when mapping becomes available", async () => {
  const sock = {
    user: { id: "5541900000000@s.whatsapp.net", lid: "99999999999999@lid" },
    signalRepository: {
      lidMapping: {
        async getPNForLID(lid) {
          return lid === "22222222222222@lid" ? "5541999999999@s.whatsapp.net" : null;
        },
        async getLIDForPN() { return null; },
      },
    },
  };
  const result = await buildPollCryptoCandidates({
    sock,
    creationKey: { fromMe: true, participant: "99999999999999@lid" },
    messageKey: { fromMe: false, remoteJid: "120000000000000000@g.us", participant: "22222222222222@lid" },
  });
  assert.ok(result.voterCandidates.includes("22222222222222@lid"));
  assert.ok(result.voterCandidates.includes("5541999999999@s.whatsapp.net"));
});
