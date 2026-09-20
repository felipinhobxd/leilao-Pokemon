import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_IMAGE_MAX_DIMENSION,
  CARD_IMAGE_MAX_STORED_BYTES,
  cardImagePath,
  ladderStepsFor,
  mapWithConcurrency,
  shouldUseOptimized,
  sniffImageMime,
  uploadCardImageBatch,
  WEBP_OPTIMIZATION_LADDER,
} from "../lib/card-image.ts";

test("detects supported image MIME from real magic bytes", () => {
  assert.equal(sniffImageMime(Uint8Array.from([0xff,0xd8,0xff,0xe0])), "image/jpeg");
  assert.equal(sniffImageMime(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), "image/png");
  assert.equal(sniffImageMime(Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50])), "image/webp");
  assert.equal(sniffImageMime(new TextEncoder().encode("not-an-image")), null);
});

test("content-addressed paths are stable and extension-aware", () => {
  const hash = "a".repeat(64);
  assert.equal(cardImagePath(hash, "image/webp"), `cards/${hash}.webp`);
  assert.equal(cardImagePath(hash, "image/jpeg"), `cards/${hash}.jpg`);
  assert.throws(() => cardImagePath("bad", "image/png"), /Hash/);
});

test("optimization never chooses a barely smaller lossy copy unless resizing is required", () => {
  assert.equal(shouldUseOptimized(500_000, 490_000, 1200), false);
  assert.equal(shouldUseOptimized(500_000, 400_000, 1200), true);
  assert.equal(shouldUseOptimized(2_000_000, 1_900_000, CARD_IMAGE_MAX_DIMENSION + 1), true);
  assert.equal(shouldUseOptimized(2_000_000, 2_100_000, CARD_IMAGE_MAX_DIMENSION + 1), false);
});

test("batch processing stays responsive with concurrency capped at three", async () => {
  let active = 0;
  let peak = 0;
  const input = Array.from({ length: 30 }, (_, index) => index);
  const output = await mapWithConcurrency(input, 3, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(output, input.map(value => value * 2));
});

test("small images skip the recompression ladder entirely (byte-identical behavior)", () => {
  assert.equal(ladderStepsFor(300 * 1024, 800).length, 0);
  assert.equal(ladderStepsFor(700 * 1024, CARD_IMAGE_MAX_DIMENSION).length, 0);
});

test("ladder covers the regular path and ends with emergency steps that always fit the 2 MB budget", () => {
  const steps = ladderStepsFor(3 * 1024 * 1024, 4000);
  assert.ok(steps.length >= 9, "regular steps preserved");
  assert.deepEqual(
    steps.slice(0, 9).map(step => `${step.maxDimension}@${step.quality}`),
    ["1600@0.85", "1600@0.82", "1600@0.79", "1400@0.85", "1400@0.82", "1400@0.79", "1200@0.85", "1200@0.82", "1200@0.79"],
  );
  const emergency = steps.slice(9);
  assert.ok(emergency.length >= 3, "emergency steps exist");
  assert.ok(emergency.every(step => step.maxDimension <= 1000), "emergency steps downscale");
  assert.ok(Math.max(...WEBP_OPTIMIZATION_LADDER.map(step => step.maxDimension)) === 1600);
  assert.ok(Math.min(...WEBP_OPTIMIZATION_LADDER.map(step => step.maxDimension)) <= 800, "an 800 px step always fits the storage budget");
  assert.ok(CARD_IMAGE_MAX_STORED_BYTES === 2 * 1024 * 1024);
});

function fakeResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function jpegFile(bytes, name) {
  const header = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const content = new Uint8Array(Math.max(bytes, 32));
  content.set(header);
  for (let index = header.length; index < content.length; index++) content[index] = (index * 31 + bytes) & 0xff;
  return new File([content], name, { type: "image/jpeg" });
}

test("partial upload success is returned, never thrown — completed images survive failures", async () => {
  // The reported bug: "1 imagem(ns) falharam. As concluídas foram preservadas"
  // was a LIE — the throw discarded the completed-upload bookkeeping, so every
  // retry re-uploaded everything and the same image failed again forever.
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 600, height: 400, close() {} });

  try {
    const fileA = jpegFile(64, "a.jpg");
    const fileB = jpegFile(128, "b.jpg");
    const shaA = await sha256Of(fileA);
    const shaB = await sha256Of(fileB);
    const authorizeCalls = [];
    const authFetch = async (url, init) => {
      assert.equal(url, "/api/cards/image/authorize");
      const body = JSON.parse(init.body);
      const images = body.images.map(descriptor => {
        authorizeCalls.push(descriptor.sha256);
        if (descriptor.sha256 === shaB) {
          return { sha256: descriptor.sha256, path: "cards/b.webp", url: "https://example.invalid/b", exists: false, token: "tok-b" };
        }
        return { sha256: descriptor.sha256, path: "cards/a.webp", url: "https://example.invalid/a", exists: true };
      });
      return fakeResponse({ images });
    };
    const client = {
      storage: {
        from() {
          return {
            uploadToSignedUrl: async () => ({ error: { message: "storage exploded" } }),
          };
        },
      },
    };
    const uploadedEvents = [];
    const statusEvents = [];
    const result = await uploadCardImageBatch({
      client,
      authFetch,
      items: [
        { id: "card-a", file: fileA },
        { id: "card-b", file: fileB },
      ],
      onStatus: (id, stage, message) => statusEvents.push(`${id}:${stage}:${message ?? ""}`),
      onUploaded: (id, uploaded) => uploadedEvents.push([id, uploaded.url]),
    });

    assert.equal(uploadedEvents.length, 1, "only the successful image fires onUploaded");
    assert.equal(uploadedEvents[0][0], "card-a");
    assert.equal(uploadedEvents[0][1], "https://example.invalid/a");
    assert.equal(result.uploaded.size, 1);
    assert.equal(result.uploaded.get("card-a").deduplicated, true);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].id, "card-b");
    assert.match(result.failures[0].message, /storage exploded/);
    assert.ok(authorizeCalls.length >= 3, "failed upload re-authorizes once before giving up");
    assert.ok(statusEvents.some(entry => entry === "card-b:error:storage exploded"));
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test("duplicate content that fails to upload reports every affected item", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 600, height: 400, close() {} });
  try {
    const fileA = jpegFile(96, "a.jpg");
    const fileB = jpegFile(96, "b.jpg"); // same size, same deterministic content => same sha
    assert.equal(await sha256Of(fileA), await sha256Of(fileB));
    const authFetch = async () => fakeResponse({
      images: [{
        sha256: await sha256Of(fileA),
        path: "cards/x.webp",
        url: "https://example.invalid/x",
        exists: false,
        token: "tok-x",
      }],
    });
    const client = {
      storage: {
        from() {
          return { uploadToSignedUrl: async () => ({ error: { message: "duplicate boom" } }) };
        },
      },
    };
    const result = await uploadCardImageBatch({
      client,
      authFetch,
      items: [
        { id: "card-a", file: fileA },
        { id: "card-b", file: fileB },
      ],
    });
    assert.equal(result.uploaded.size, 0);
    assert.deepEqual(result.failures.map(failure => failure.id).sort(), ["card-a", "card-b"]);
    assert.match(result.failures[0].message, /duplicate boom/);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

async function sha256Of(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
