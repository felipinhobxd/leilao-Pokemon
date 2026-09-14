import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const stats = JSON.parse(fs.readFileSync(new URL("../public/card-recognition/milo/index.stats.json", import.meta.url), "utf8"));
const metaRows = fs.readFileSync(new URL("../public/card-recognition/milo/index.meta.tsv", import.meta.url), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const index = fs.readFileSync(new URL("../public/card-recognition/milo/index-int8.bin", import.meta.url));
const model = fs.readFileSync(new URL("../public/card-recognition/milo/model.onnx", import.meta.url));
const runtime = fs.readFileSync(new URL("../lib/card-recognition-milo.ts", import.meta.url), "utf8");

test("published Milo assets are one compatible generation", () => {
  assert.equal(stats.cardsIndexed, 19_501);
  assert.equal(stats.embeddingDimension, 128);
  assert.equal(stats.int8Scale, 127);
  assert.equal(metaRows.length, stats.cardsIndexed);
  assert.equal(index.byteLength, stats.cardsIndexed * stats.embeddingDimension);
  assert.equal(index.byteLength, stats.int8IndexBytes);
  assert.equal(model.byteLength, stats.modelBytes);
});

test("Milo browser loader versions, validates and self-heals its asset bundle", () => {
  assert.match(runtime, /ASSET_VERSION = "milo-v1-19501x128-20260914"/);
  assert.match(runtime, /STATS_PATH/);
  assert.match(runtime, /cache: "no-store"/);
  assert.match(runtime, /LEGACY_CACHE_NAMES/);
  assert.match(runtime, /clearMiloAssetCaches/);
  assert.match(runtime, /loadIndexAttempt\(true, `\$\{Date\.now\(\)\}`\)/);
  assert.match(runtime, /entries\.length !== manifest\.cards/);
  assert.match(runtime, /vectors\.byteLength !== manifest\.bytes/);
  assert.doesNotMatch(runtime, /fetch\(url, \{ cache: "force-cache"/);
});