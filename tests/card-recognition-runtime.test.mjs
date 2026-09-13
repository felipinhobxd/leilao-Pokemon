import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/card-recognition-browser.ts", import.meta.url), "utf8");

test("card recognition stays local-first and free-service only", () => {
  assert.match(source, /TESSERACT_VERSION = "7\.0\.0"/);
  assert.match(source, /cdn\.jsdelivr\.net\/npm\/tesseract\.js@\$\{TESSERACT_VERSION\}/);
  assert.match(source, /https:\/\/api\.tcgdex\.net\/v2/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /recognitionTail/);
  assert.match(source, /MAX_CATALOG_DETAILS = 12/);

  for (const forbidden of [
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "api.anthropic.com",
    "vision.googleapis.com",
    "rekognition",
    "cognitiveservices.azure.com",
  ]) assert.equal(source.includes(forbidden), false, `${forbidden} must not be used by card recognition`);
});

test("ambiguous language does not early-stop on the form default", () => {
  assert.match(source, /trustedOcrLanguage = hints\.languageConfidence >= 45/);
  assert.match(source, /if \(trustedOcrLanguage && \(ranked\[0\]\?\.score \?\? 0\) >= 84/);
  assert.match(source, /shouldTryJapanese = \(hints\.language == null \|\| hints\.languageConfidence < 45\) && \(bestScore < 72 \|\| !hints\.name\)/);
  assert.doesNotMatch(source, /shouldTryJapanese[^;]+latin\.confidence < 68/s);
});
