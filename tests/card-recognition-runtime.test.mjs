import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { buildOcrHints } from "../lib/card-recognition-core.ts";

const source = fs.readFileSync(new URL("../lib/card-recognition-browser.ts", import.meta.url), "utf8");

// Import the real browser module without creating DOM, OCR workers or GPU objects.
const executable = stripTypeScriptTypes(source).replace('"@/lib/card-recognition-visual"', JSON.stringify(new URL("../lib/card-recognition-visual.ts", import.meta.url).href)).replace('"@/lib/card-recognition-core"', JSON.stringify(new URL("../lib/card-recognition-core.ts", import.meta.url).href));
const runtime = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);

test("card recognition stays local-first and free-service only", () => {
  assert.match(source, /TESSERACT_VERSION = "7\.0\.0"/);
  assert.match(source, /cdn\.jsdelivr\.net\/npm\/tesseract\.js@\$\{TESSERACT_VERSION\}/);
  assert.match(source, /https:\/\/api\.tcgdex\.net\/v2/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /recognitionTail/);
  assert.ok(runtime.cardRecognitionRuntime.maxCatalogDetailsPerSearch > 0);
  assert.ok(runtime.cardRecognitionRuntime.maxCatalogDetailsPerSearch <= 4);

  for (const forbidden of [
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "api.anthropic.com",
    "vision.googleapis.com",
    "rekognition",
    "cognitiveservices.azure.com",
  ]) assert.equal(source.includes(forbidden), false, `${forbidden} must not be used by card recognition`);
});

test("ambiguous language searches beyond the form default; trusted OCR stops early", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);

    return { ok: true, json: async () => url.includes("?") ? [{ id: "base-58", localId: "58", name: "Pikachu" }] :
      { id: "base-58", localId: "58", name: "Pikachu", set: { name: "Base", cardCount: { official: 102 } } } };
  };
  try {
    const stats = { requests: 0, queries: [] };
    const ranked = await runtime.resolveCatalog(buildOcrHints("Pikachu", "58/102"), "pt-BR", stats);
    assert.ok(ranked.some(card => card.language === "en"));
    assert.ok(calls.some(url => url.includes("/en/")));
    calls.length = 0;
    await runtime.resolveCatalog(buildOcrHints("Pikachu", "58/102", "Fraqueza Recuo Baralho"), "en", { requests: 0, queries: [] });
    assert.ok(calls.every(url => url.includes("/pt-br/")));
  } finally { globalThis.fetch = original; }
});

const { createVisualFallback, needsVisualFallback } = await import('../lib/card-recognition-visual.ts');
const evidence = { strongEvidence: true, fullNumberMatch: false, nameSimilarity: 0.9 };
const candidates = [0, 1].map(i => ({ id: String(i), image: `https://assets.tcgdex.net/en/base/base1/${i}`, score: 70, evidence }));

test('visual worker is lazy, serial, optional and released after idle', async () => {
  let created = 0, active = 0, maximum = 0, terminated = 0;
  const visual = createVisualFallback(() => {
    created++;
    return {
      postMessage() {
        maximum = Math.max(maximum, ++active);
        setTimeout(() => { active--; this.onmessage({ data: { similarities: [0.8, 0.7], backend: 'fake' } }); }, 2);
      },
      terminate() { terminated++; },
    };
  }, 10, 100);
  assert.equal(created, 0);
  const easy = candidates.map((c, i) => ({ ...c, score: i ? 60 : 99, evidence: { ...evidence, fullNumberMatch: true, nameSimilarity: 1 } }));
  assert.equal(needsVisualFallback(easy), false);
  assert.equal((await visual.recognize(new Blob(), easy)).used, false);
  assert.equal(created, 0);
  const results = await Promise.all(Array.from({ length: 20 }, () => visual.recognize(new Blob(), candidates)));
  assert.ok(results.every(result => result.used));
  assert.equal(maximum, 1);
  assert.equal(created, 1);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(terminated, 1);
});

test('model failure preserves OCR candidates and manual flow without repeated batch retries', async () => {
  let created = 0;
  const visual = createVisualFallback(() => { created++; throw new Error('offline'); });
  for (let i = 0; i < 3; i++) {
    const result = await visual.recognize(new Blob(), candidates);
    assert.equal(result.used, false);
    assert.deepEqual(result.candidates, candidates);
  }
  assert.equal(created, 1);
  visual.dispose();
});

test('same photo uses the session/memory cache without DOM, OCR, network or model', async () => {
  const previous = globalThis.sessionStorage;
  let reads = 0;
  globalThis.sessionStorage = { getItem() { reads++; return JSON.stringify({ confidence: 0, level: 'low', candidates: [], hints: buildOcrHints('', ''), source: 'ocr', elapsedMs: 1, catalogRequests: 2 }); } };
  try {
    const file = new File(['cache-test'], 'card.png');
    const results = await Promise.all([runtime.recognizePokemonCard(file), runtime.recognizePokemonCard(file)]);
    assert.equal(reads, 1);
    assert.ok(results.every(result => result.source === 'cache' && result.catalogRequests === 0));
  } finally { globalThis.sessionStorage = previous; }
});
