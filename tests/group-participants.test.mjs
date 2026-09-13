import assert from "node:assert/strict";
import test from "node:test";
import {
  identityFromGroupMember,
  phoneFromWhatsAppJid,
  syncGroupParticipants,
} from "../bot/group-participants.mjs";

test("LID is never exposed as a fake phone number", () => {
  assert.equal(phoneFromWhatsAppJid("80179053510687@lid"), null);
  assert.equal(phoneFromWhatsAppJid("554199999999@s.whatsapp.net"), "+554199999999");
});

test("group member identity keeps LID and resolves the real phone number", async () => {
  const sock = {
    signalRepository: {
      lidMapping: {
        async getPNForLID(jid) {
          assert.equal(jid, "12345678901234@lid");
          return "5541988887777@s.whatsapp.net";
        },
        async getLIDForPN() { return null; },
      },
    },
  };
  const contactNames = new Map([["12345678901234@lid", "Fulano"]]);
  const identity = await identityFromGroupMember({
    sock,
    member: { id: "12345678901234@lid" },
    contactNames,
  });

  assert.equal(identity.voterJid, "12345678901234@lid");
  assert.equal(identity.phoneE164, "+5541988887777");
  assert.equal(identity.displayName, "Fulano");
  assert.ok(identity.aliases.includes("5541988887777@s.whatsapp.net"));
});

test("group sync skips the bot account and registers other members", async () => {
  const seen = [];
  const sock = {
    user: { id: "5541900000000@s.whatsapp.net" },
    signalRepository: {
      lidMapping: {
        async getPNForLID(jid) {
          if (jid === "11111111111111@lid") return "5541900000000@s.whatsapp.net";
          if (jid === "22222222222222@lid") return "5541999999999@s.whatsapp.net";
          return null;
        },
        async getLIDForPN(jid) {
          if (jid === "5541900000000@s.whatsapp.net") return "11111111111111@lid";
          if (jid === "5541999999999@s.whatsapp.net") return "22222222222222@lid";
          return null;
        },
      },
    },
    async groupMetadata() {
      return {
        subject: "Grupo teste",
        participants: [
          { id: "11111111111111@lid", phoneNumber: "5541900000000@s.whatsapp.net" },
          { id: "22222222222222@lid", phoneNumber: "5541999999999@s.whatsapp.net", notify: "Maria" },
        ],
      };
    },
  };

  const result = await syncGroupParticipants({
    sock,
    groupJid: "120000000000000000@g.us",
    contactNames: new Map(),
    ensureParticipant: async identity => seen.push(identity),
  });

  assert.equal(result.total, 2);
  assert.equal(result.synced, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].displayName, "Maria");
  assert.equal(seen[0].phoneE164, "+5541999999999");
});
