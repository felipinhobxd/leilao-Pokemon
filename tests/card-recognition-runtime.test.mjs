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
  assert.match(source, /SET_INDEX_TTL_MS = 24 \* 60 \* 60_000/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /localStorage/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /recognitionTail/);
  assert.ok(runtime.cardRecognitionRuntime.maxCatalogDetailsPerSearch > 0);
  assert.ok(runtime.cardRecognitionRuntime.maxCatalogDetailsPerSearch <= 4);
  assert.equal(runtime.cardRecognitionRuntime.maxCatalogRequests, 8);
  assert.equal(runtime.cardRecognitionRuntime.cacheVersion, 7);

  for (const forbidden of [
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "api.anthropic.com",
    "vision.googleapis.com",
    "rekognition",
    "cognitiveservices.azure.com",
  ]) assert.equal(source.includes(forbidden), false, `${forbidden} must not be used by card recognition`);
});

test("collector denominator uses the TCGdex set index then direct set+localId lookup", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === "/v2/pt/sets") {
      return { ok: true, status: 200, json: async () => [
        { id: "me02.5", name: "Heróis Excelsos", cardCount: { official: 217, total: 217 } },
        { id: "other", name: "Outro", cardCount: { official: 191, total: 200 } },
      ] };
    }
    if (parsed.pathname === "/v2/pt/sets/me02.5/153") {
      return { ok: true, status: 200, json: async () => ({
        id: "me02.5-153", localId: "153", name: "Rayquaza", hp: 120,
        image: "https://assets.tcgdex.net/pt/me/me02.5/153",
        set: { id: "me02.5", name: "Heróis Excelsos", cardCount: { official: 217, total: 217 } },
      }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const stats = { requests: 0, queries: [] };
    const result = await runtime.resolveCatalog(buildOcrHints("Rayquaza", "153/217", "Fraqueza Recuo Baralho"), "pt-BR", stats);
    assert.equal(result.strategy, "set+localId");
    assert.deepEqual(result.setCandidates, ["me02.5"]);
    assert.equal(result.ranked[0]?.name, "Rayquaza");
    assert.equal(result.ranked[0]?.cardNumber, "153/217");
    assert.equal(stats.requests, 2);
    assert.equal(calls.some(url => url.includes("/cards?")), false);
  } finally { globalThis.fetch = original; }
});

test("form language is only search priority; trusted OCR language owns the deterministic lookup", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/sets")) return { ok: true, status: 200, json: async () => [{ id: "base", name: "Base", cardCount: { official: 102, total: 102 } }] };
    if (parsed.pathname.endsWith("/sets/base/58")) return { ok: true, status: 200, json: async () => ({ id: "base-58", localId: "58", name: "Pikachu", set: { id: "base", name: "Base", cardCount: { official: 102, total: 102 } } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const { ranked } = await runtime.resolveCatalog(buildOcrHints("Pikachu", "58/102"), "pt-BR", { requests: 0, queries: [] });
    assert.ok(ranked.every(card => !card.evidence.languageMatch));
    calls.length = 0;
    await runtime.resolveCatalog(buildOcrHints("Pikachu", "58/102", "Fraqueza Recuo Baralho"), "en", { requests: 0, queries: [] });
    assert.ok(calls.every(url => new URL(url).pathname.startsWith("/v2/pt/")));
  } finally { globalThis.fetch = original; }
});

const { createVisualFallback, needsVisualFallback, applyVisualEvidence, recognitionDebugEnabled } = await import('../lib/card-recognition-visual.ts');
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
    assert.equal(result.status, "failed");
    assert.match(result.error, /offline/);
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

test('catalog keeps the shared eight-request ceiling and makes zero calls without OCR clues', async () => {
  const previous = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async url => {
    count++;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/sets')) return { ok: true, status: 200, json: async () => Array.from({length: 12}, (_, i) => ({id: `set-${i}`, name: `Set ${i}`, cardCount: {official: 217, total: 217}})) };
    if (parsed.pathname.includes('/sets/set-')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => parsed.search ? Array.from({length: 10}, (_, i) => ({id: `budget-${count}-${i}`, name: 'Unrelated', localId: '44'})) : {id: `detail-${count}`, name: 'Unrelated', localId: '44', set: {name: 'Other', cardCount: {official: 99}}} };
  };
  try {
    const empty = await runtime.resolveCatalog(buildOcrHints('', ''), 'pt-BR', {requests: 0, queries: []});
    assert.equal(count, 0); assert.equal(empty.pool.length, 0);
    const stats = {requests: 0, queries: []};
    await runtime.resolveCatalog(buildOcrHints('Rayquaza', '153/217', 'Fraqueza Recuo'), 'pt-BR', stats);
    assert.ok(count <= 8); assert.ok(stats.requests <= 8);
    if (stats.requests === 8) assert.equal(stats.exhausted, true);
  } finally { globalThis.fetch = previous; }
});

test('partial shortlist remains private unless visual minimum and margin both pass', async () => {
  const { visualCandidatePool, rankRecognitionCandidates } = await import('../lib/card-recognition-core.ts');
  const hints = buildOcrHints('Rayqu', '');
  const raw = ['Rayquaza', 'Rayquaza EX'].map((name, i) => ({id: `partial-${i}`, name, localId: String(i), denominator: 217, cardNumber: `${i}/217`, collection: 'Set', language: 'en', hp: null, image: `https://assets.tcgdex.net/en/test/${i}`}));
  const pool = visualCandidatePool(raw, hints);
  assert.equal(pool.length, 1);
  const two = visualCandidatePool([raw[0], {...raw[0], id: 'second', cardNumber: '2/217'}], hints);
  assert.equal(two.length, 2); assert.equal(rankRecognitionCandidates(raw, hints).length, 0);
  assert.equal(needsVisualFallback(two), true);
  assert.ok(applyVisualEvidence(two, [0.84, 0.4]).every(c => !c.evidence.visualMatch));
  assert.ok(applyVisualEvidence(two, [0.91, 0.89]).every(c => !c.evidence.visualMatch));
  const promoted = applyVisualEvidence(two, [0.94, 0.7]);
  assert.equal(promoted[0].evidence.visualMatch, true);
  assert.equal(promoted[1].evidence.strongEvidence, false);
});

test('new drafts never use the filename and debug controls stay local', () => {
  const wizard = fs.readFileSync(new URL('../app/auctions/new/bulk-wizard.tsx', import.meta.url), 'utf8');
  const draft = wizard.slice(wizard.indexOf('function draftFor'), wizard.indexOf('function recognitionLabel'));
  assert.match(draft, /name: ""/); assert.doesNotMatch(draft, /file\.name|baseName/);
  const previous = globalThis.window;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    globalThis.window = {location: {hostname: 'example.com', search: '?recognitionDebug=1'}};
    assert.equal(recognitionDebugEnabled(), false);
    globalThis.window.location.hostname = 'localhost';
    assert.equal(recognitionDebugEnabled(), true);
    globalThis.window.location.search = '';
    assert.equal(recognitionDebugEnabled(), false);
  } finally { globalThis.window = previous; if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode; }
});

test('explicit retry bypasses cached failure and attempts fresh image decoding', async () => {
  const previousStorage = globalThis.sessionStorage;
  const previousDecode = globalThis.createImageBitmap;
  let decodes = 0;
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ level: 'low', candidates: [], hints: buildOcrHints('', '') }) };
  globalThis.createImageBitmap = async () => { decodes++; throw new Error('fresh decode reached'); };
  try {
    const file = new File(['retry-fixture'], 'card.png');
    assert.equal((await runtime.recognizePokemonCard(file)).source, 'cache');
    await assert.rejects(runtime.recognizePokemonCard(file, 'pt-BR', undefined, { bypassCache: true }), /fresh decode reached/);
    assert.equal(decodes, 1);
  } finally { globalThis.sessionStorage = previousStorage; globalThis.createImageBitmap = previousDecode; }
});

test('explicit visual test works outside localhost without auto-loading the model', async () => {
  const previous = globalThis.window;
  let created = 0;
  globalThis.window = { location: { hostname: 'example.com', search: '' } };
  const visual = createVisualFallback(() => {
    created++;
    return { postMessage() { this.onmessage({ data: { similarities: [0.8], backend: 'wasm/q4' } }); }, terminate() {} };
  });
  try {
    assert.equal(created, 0);
    const result = await visual.recognize(new Blob(), [candidates[0]], undefined, 'auto');
    assert.equal(result.used, true);
    assert.equal(created, 1);
    assert.equal(result.candidates[0].evidence.visualMatch, undefined);
  } finally { visual.dispose(); globalThis.window = previous; }
});

test('visual diagnostic has an official reference even when catalog entries have no image', async () => {
  const { visualDiagnosticReference } = await import('../lib/card-recognition-visual.ts');
  const imageLess = { id: 'exu-!', name: 'Unown', localId: '!' };
  const reference = visualDiagnosticReference([imageLess]);
  assert.ok(reference.image.startsWith('https://assets.tcgdex.net/'));
  assert.equal(reference.evidence, undefined);
  assert.equal(reference.score, 0);
  assert.equal(visualDiagnosticReference([]).image, reference.image);
  const existing = { ...candidates[0] };
  assert.equal(visualDiagnosticReference([imageLess, existing]), existing);
  assert.deepEqual(imageLess, { id: 'exu-!', name: 'Unown', localId: '!' });
});

test('physical Portuguese lookup uses pt and rejects Pocket artwork in both paths', async () => {
  const previous = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === '/v2/pt/sets') return {ok: true, status: 200, json: async () => [{id: 'fake', name: 'Fake', cardCount: {official: 999, total: 999}}]};
    if (parsed.pathname.startsWith('/v2/pt/sets/fake/')) return {ok: true, status: 200, json: async () => ({id: 'P-A-063', name: 'Bulbasaur', localId: '063', image: 'https://assets.tcgdex.net/pt-br/tcgp/P-A/063', set: {id: 'fake', name: 'Fake', cardCount: {official: 999}}})};
    if (parsed.pathname === '/v2/pt/cards') return {ok: true, status: 200, json: async () => [{id: 'P-A-063', name: 'Bulbasaur', localId: '063', image: 'https://assets.tcgdex.net/pt-br/tcgp/P-A/063'}]};
    return {ok: false, status: 404, json: async () => ({})};
  };
  try {
    const result = await runtime.resolveCatalog(buildOcrHints('Bulbasaur', '063/999', 'Fraqueza Recuo'), 'pt-BR', {requests: 0, queries: []});
    assert.ok(urls.length > 0 && urls.every(url => new URL(url).pathname.startsWith('/v2/pt/')));
    assert.ok(urls.filter(url => new URL(url).pathname === '/v2/pt/cards').every(url => new URL(url).searchParams.get('image') === 'notlike:/tcgp/'));
    assert.equal(result.pool.length, 0);
  } finally { globalThis.fetch = previous; }
});

test('DINOv2 CLS output works without pooler_output and excludes patch tokens', async () => {
  const {extractDinoEmbedding, cosineSimilarity} = await import('../lib/card-recognition-embedding.ts');
  const cls = extractDinoEmbedding({last_hidden_state: {dims: [1, 3, 2], data: new Float32Array([3, 4, 900, 900, -900, -900])}});
  assert.deepEqual(cls.values, [0.6, 0.8]);
  assert.equal(cls.output, 'last_hidden_state/CLS');
  const pooled = extractDinoEmbedding({pooler_output: {dims: [1, 2], data: new Float32Array([3, 4])}});
  assert.ok(Math.abs(cosineSimilarity(cls.values, pooled.values) - 1) < 1e-6);
  assert.throws(() => extractDinoEmbedding({last_hidden_state: {dims: [2, 3, 2], data: []}}), /incompatible/);
  assert.throws(() => extractDinoEmbedding({last_hidden_state: {dims: [1, 3, 2], data: [1]}}), /length/);
  assert.throws(() => extractDinoEmbedding({pooler_output: {dims: [1, 2], data: [0, 0]}}), /invalid/);
});
