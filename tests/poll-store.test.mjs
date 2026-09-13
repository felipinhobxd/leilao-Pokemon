import assert from "node:assert/strict";
import test from "node:test";
import { revivePollMessage, serializePollMessage } from "../bot/poll-store.mjs";

test("poll message secret survives JSONB storage as the exact same 32 bytes", () => {
  const secret = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
  const message = {
    messageContextInfo: { messageSecret: secret },
    pollCreationMessageV3: { name: "Lances", options: [{ optionName: "R$ 5" }] },
  };

  const serialized = serializePollMessage(message);
  assert.equal(serialized.messageContextInfo.messageSecret.type, "Buffer");
  const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
  const restored = revivePollMessage(jsonRoundTrip);
  assert.ok(Buffer.isBuffer(restored.messageContextInfo.messageSecret));
  assert.deepEqual(restored.messageContextInfo.messageSecret, secret);
});

test("legacy base64 poll secret is restored to bytes", () => {
  const secret = Buffer.alloc(32, 7);
  const restored = revivePollMessage({
    messageContextInfo: { messageSecret: secret.toString("base64") },
    pollCreationMessageV3: { name: "Lances" },
  });
  assert.ok(Buffer.isBuffer(restored.messageContextInfo.messageSecret));
  assert.deepEqual(restored.messageContextInfo.messageSecret, secret);
});
