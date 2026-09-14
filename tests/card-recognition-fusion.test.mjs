import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const fusion = fs.readFileSync(new URL("../lib/card-recognition-browser-v9.ts", import.meta.url), "utf8");
const rescue = fs.readFileSync(new URL("../lib/card-recognition-rescue.ts", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../lib/card-recognition-browser-v7.ts", import.meta.url), "utf8");
const tsconfig = JSON.parse(fs.readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8"));

test("runtime routes card recognition through a regression-safe three-stage fusion", () => {
  assert.equal(tsconfig.compilerOptions.paths["@/lib/card-recognition-browser"][0], "./lib/card-recognition-browser-v9.ts");
  assert.match(fusion, /recognition principal/);
  assert.match(fusion, /reconhecedor anterior/);
  assert.match(fusion, /resgate por foto inteira/);
  assert.match(fusion, /primary\.level === "high"/);
  assert.match(fusion, /legacy\.level === "high"/);
  assert.match(fusion, /sameIdentity/);
  assert.match(legacy, /SESSION_CACHE_PREFIX = "leilao:card-recognition:v7:/);
});

test("rescue path does not depend on the brittle automatic card rectangle", () => {
  assert.match(rescue, /full-frame/);
  assert.match(rescue, /aspect-fit/);
  assert.match(rescue, /center-90/);
  assert.match(rescue, /CARD_ASPECT = 63 \/ 88/);
  assert.match(rescue, /0\.0, 0\.84, 0\.58, 0\.995/);
  assert.match(rescue, /0\.40, 0\.84, 1\.0, 0\.995/);
  assert.match(rescue, /load_system_dawg: whitelist \? "0" : "1"/);
  assert.match(rescue, /load_freq_dawg: whitelist \? "0" : "1"/);
});

test("rescue stays free and local-first while widening catalog recall", () => {
  assert.match(rescue, /tesseract\.js@\$\{TESSERACT_VERSION\}/);
  assert.match(rescue, /https:\/\/api\.tcgdex\.net\/v2/);
  assert.match(rescue, /loadBriefIndex/);
  assert.match(rescue, /stringSimilarity/);
  assert.match(rescue, /recognizeVisually/);
  assert.match(rescue, /image=notlike:\/tcgp\//);
  for (const forbidden of [
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "api.anthropic.com",
    "vision.googleapis.com",
    "rekognition",
    "cognitiveservices.azure.com",
  ]) assert.equal(rescue.includes(forbidden), false, `${forbidden} must not be used`);
});
