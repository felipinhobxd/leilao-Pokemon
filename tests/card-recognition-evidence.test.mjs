import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildOcrHints, catalogHints, rankRecognitionCandidates } from "../lib/card-recognition-core.ts";
import { rankEvidence, decideRecognition } from "../lib/card-recognition-decision.ts";
import { officialScanUrl, serveOfficialScan } from "../lib/card-recognition-scan.ts";

const hints = { ...buildOcrHints("Dragonair", "7/149"), nameConfidence: .98, numberConfidence: .1 };
const card = (name, localId, extra = {}) => ({ id: name + "-" + localId, name, collection: "Set", localId,
  cardNumber: localId + "/149", denominator: 149, hp: 80, language: "pt-BR",
  image: "https://assets.tcgdex.net/pt/sm/sm1/" + localId, score: 0, ...extra });
const dragon = card("Dragonair", "95");
const wrong = ["Parasect", "Surskit", "Gloom"].map(name => card(name, "7"));
const base = h => ({ hints: h, candidates: [], level: "high", confidence: 89, name: "Parasect",
  source: "ocr", elapsedMs: 0, catalogRequests: 0 });

test("strong Dragonair name beats weak wrong number in catalog AND final fusion", () => {
  assert.equal(rankRecognitionCandidates([...wrong, dragon], hints)[0].name, "Dragonair");
  assert.equal(rankEvidence([...wrong, dragon], hints)[0].name, "Dragonair");
  const final = decideRecognition(base(hints), [...wrong, dragon], "failed");
  assert.notEqual(final.status, "IDENTIFICADA");
  assert.equal(final.result.name, undefined);
});
test("single digit cannot restrict catalog, even if its OCR score is high", () => {
  const safe = catalogHints({ ...hints, localId: "7", cardNumber: "7", denominator: null, numberConfidence: .99 });
  assert.equal(safe.localId, "");
  assert.equal(safe.name, "Dragonair");
});
test("failed visual plus ambiguous OCR cannot retain legacy 89 percent identification", () => {
  const final = decideRecognition(base({ ...hints, name: "", nameConfidence: 0 }), wrong, "failed");
  assert.notEqual(final.status, "IDENTIFICADA");
  assert.equal(final.result.level, "low");
  assert.equal(final.result.confidence, 0);
  assert.equal(final.result.name, undefined);
});
test("strong name, complete number and official visual agree", () => {
  const h = { ...hints, localId: "95", localIdVariants: ["95"], cardNumber: "95/149", numberConfidence: .98 };
  const d = { ...dragon, visualSimilarity: .94, evidence: { visualMatch: true } };
  const final = decideRecognition(base(h), [d, ...wrong], "compared");
  assert.equal(final.status, "IDENTIFICADA");
  assert.equal(final.result.name, "Dragonair");
  assert.ok(final.evidence.includes("collector-number"));
});
test("strong name wins over weak number even when wrong candidate claims visual match", () => {
  const impostor = { ...wrong[0], visualSimilarity: .9, evidence: { visualMatch: true } };
  assert.equal(rankEvidence([impostor, dragon], hints)[0].name, "Dragonair");
});
test("confirmed memory improves matching rank by a bounded amount", () => {
  const without = rankEvidence([dragon], hints)[0].score;
  const withMemory = rankEvidence([dragon], hints, [dragon])[0].score;
  assert.equal(withMemory - without, 6);
});
test("contradicting memory never defeats strong official evidence or creates a candidate", () => {
  const d = { ...dragon, visualSimilarity: .95, evidence: { visualMatch: true } };
  assert.equal(rankEvidence([...wrong, d], hints, wrong)[0].name, "Dragonair");
  assert.equal(rankEvidence([d], hints, wrong).length, 1);
});
test("manual UI language is absent from the inference dependency graph", () => {
  const source = fs.readFileSync(new URL("../lib/card-recognition-browser-v10.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function perform("), source.indexOf("export function recognizePokemonCard"));
  assert.equal((body.match(/_selectedLanguage/g) || []).length, 1);
  const a = decideRecognition(base(hints), [dragon], "failed");
  const b = decideRecognition({ ...base(hints), selectedLanguage: "ja" }, [dragon], "failed");
  assert.deepEqual(a.ranking, b.ranking);
  assert.equal(a.status, b.status);
  assert.equal(a.result.language, b.result.language);
});
test("absent visual winner and partial scan failure cannot identify, even with perfect OCR", () => {
  const h = { ...hints, localId: "95", localIdVariants: ["95"], numberConfidence: .99 };
  const d = { ...dragon, visualSimilarity: .99, evidence: { visualMatch: true } };
  assert.equal(decideRecognition(base(h), [d], "failed").status, "PROVÁVEL");
  assert.equal(decideRecognition(base(h), [dragon], "compared").status, "PROVÁVEL");
});
test("scan endpoint accepts only official bounded paths", () => {
  assert.equal(officialScanUrl(dragon.image), dragon.image + "/low.webp");
  for (const bad of ["http://assets.tcgdex.net/en/base/basep/1", "https://evil.test/en/base/basep/1",
    "https://assets.tcgdex.net@evil.test/en/base/basep/1", dragon.image + "?redirect=x",
    "https://assets.tcgdex.net/en/tcgp/A1/1"]) assert.throws(() => officialScanUrl(bad));
});
test("same-origin scan forwards bytes and reports exact failing upstream request", async () => {
  const previous = globalThis.fetch;
  const request = () => new Request("https://app.test/api/card-recognition/scan?base=" + encodeURIComponent(dragon.image));
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, dragon.image + "/low.webp");
      assert.equal(options.redirect, "error");
      return new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "image/webp" } });
    };
    const ok = await serveOfficialScan(request());
    assert.equal(ok.status, 200);
    assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1,2,3]);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    const missing = await serveOfficialScan(request());
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).url, dragon.image + "/low.webp");
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    const failure = await serveOfficialScan(request());
    assert.equal(failure.status, 502);
    assert.equal((await failure.json()).stage, "scan-fetch");
  } finally { globalThis.fetch = previous; }
});

test("a weak structural score cannot be promoted by a worker winner flag", () => {
  const d = { ...dragon, visualSimilarity: .63, evidence: { visualMatch: true } };
  assert.notEqual(decideRecognition(base(hints), [d], "compared").status, "IDENTIFICADA");
});
