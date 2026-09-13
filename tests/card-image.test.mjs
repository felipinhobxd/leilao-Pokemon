import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_IMAGE_MAX_DIMENSION,
  cardImagePath,
  mapWithConcurrency,
  shouldUseOptimized,
  sniffImageMime,
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
