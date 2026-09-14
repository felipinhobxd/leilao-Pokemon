import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { summarizeRecognitionBenchmark, evaluateRecognitionSample } from "../lib/card-recognition-benchmark.ts";

const v10 = fs.readFileSync(new URL("../lib/card-recognition-browser-v10.ts", import.meta.url), "utf8");
const milo = fs.readFileSync(new URL("../lib/card-recognition-milo.ts", import.meta.url), "utf8");
const normalize = fs.readFileSync(new URL("../lib/card-recognition-normalize.ts", import.meta.url), "utf8");
const wizard = fs.readFileSync(new URL("../app/auctions/new/bulk-wizard.tsx", import.meta.url), "utf8");
const debugUi = fs.readFileSync(new URL("../app/auctions/new/recognition-debug.tsx", import.meta.url), "utf8");
const tsconfig = JSON.parse(fs.readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8"));
const gitignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");

function result(candidates, overrides = {}) {
  return {
    confidence: 0,
    level: "low",
    candidates,
    hints: { name: "", cardNumber: "", localId: "", denominator: null, hp: null, language: null, languageConfidence: 0, text: "" },
    source: "ocr",
    elapsedMs: 100,
    catalogRequests: 2,
    ...overrides,
  };
}

test("v10 is the active recognizer but main/business flow remains imported through the stable alias", () => {
  assert.equal(tsconfig.compilerOptions.paths["@/lib/card-recognition-browser"][0], "./lib/card-recognition-browser-v10.ts");
  assert.match(v10, /import \* as v9 from "\.\/card-recognition-browser-v9"/);
  assert.match(wizard, /from "@\/lib\/card-recognition-browser"/);
  assert.match(wizard, /mergeRecognitionFields/);
});

test("default UI language is not evidence and v10 does not forward it to inference", () => {
  assert.match(wizard, /language: "pt-BR"/);
  assert.match(v10, /selectedLanguage is intentionally not forwarded/);
  assert.match(v10, /v9\.recognizePokemonCard\(normalization\.file, undefined/);
  assert.match(v10, /v9\.recognizePokemonCard\(file, undefined/);
  assert.doesNotMatch(v10, /v9\.recognizePokemonCard\([^\n]+selectedLanguage/);
});

test("Milo runs before any exact OCR/catalog return and searches independently from OCR", () => {
  const visualCall = v10.indexOf("const global = await searchMiloVisual(normalization.blob");
  const exactDecision = v10.indexOf("if (exactCatalogDecision(base))", visualCall);
  assert.ok(visualCall > 0 && exactDecision > visualCall, "Milo must run before accepting an exact OCR/catalog decision");
  assert.match(v10, /Milo now runs for every non-cached recognition/);
  assert.match(v10, /always-on-ocr-independent-milo-exact-print-retrieval/);
  assert.match(milo, /discoveryDependsOnOcr: false/);
  assert.match(milo, /function topMatches\(index: LoadedIndex, query: Float32Array\)/);
  assert.match(milo, /const matches = topMatches\(index, encoded\.embedding\)/);
  assert.match(milo, /const matches = topMatches\(index, encoded\.embedding\);\s*let candidates = shortlist\(index, matches, language\);\s*const detailIndexes = chooseDetailIndexes\(candidates, hints\)/s);
  assert.doesNotMatch(milo.slice(milo.indexOf("function topMatches"), milo.indexOf("function emptyEvidence")), /name|ocr|hint/i);
});

test("v10 invalidates old result cache after making Milo mandatory", () => {
  assert.match(v10, /CACHE_PREFIX = "leilao:card-recognition:v10-milo-always-v1:"/);
  assert.match(v10, /cache: "v10-milo-always-v1"/);
});

test("debug UI tests and reports the actual v10 Milo retriever instead of only legacy DINO", () => {
  assert.match(debugUi, /Testar IA v10\/Milo/);
  assert.match(debugUi, /searchMiloVisual\(normalized\.blob/);
  assert.match(debugUi, /impressõesNoIndice/);
  assert.match(debugUi, /Runtime: reconhecimento v\{cardRecognitionRuntime\.version\}/);
  assert.match(debugUi, /dinoLegacy/);
  assert.doesNotMatch(debugUi, /recognizeVisually/);
});

test("Milo normalizes real-photo lighting before embedding without using card metadata", () => {
  assert.match(milo, /QUERY_AUTOCONTRAST_CUTOFF = 0\.005/);
  assert.match(milo, /autocontrastRgbInPlace\(pixels\)/);
  assert.match(milo, /queryPhotometricNormalization: "autocontrast-0\.5%-per-channel"/);
  const start = milo.indexOf("function autocontrastRgbInPlace");
  const end = milo.indexOf("async function imageTensor", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(milo.slice(start, end), /name|localId|ocr|hint|cardNumber/i);
});

test("normalization estimates four edges/corners and applies a real projective homography", () => {
  assert.match(normalize, /bestVertical/);
  assert.match(normalize, /bestHorizontal/);
  assert.match(normalize, /intersect\(left, top/);
  assert.match(normalize, /homographyDestinationToSource/);
  assert.match(normalize, /solve8/);
  assert.match(normalize, /warpQuad/);
  assert.match(normalize, /aspect-fallback/);
  assert.match(normalize, /\[0, 90, 180, 270\] as const/);
});

test("IDENTIFICADA requires independent evidence instead of raw visual similarity", () => {
  assert.match(v10, /requiresIndependentEvidenceForIdentified: true/);
  assert.match(v10, /if \(exactNumber \|\| \(catalogAgreement && nameAgreement\)\)/);
  assert.match(v10, /result\.level = "medium"/);
  assert.match(v10, /confidenceKind/);
  assert.match(v10, /evidence-score-not-calibrated-probability/);
});

test("private real-photo fixtures and local result files cannot be committed accidentally", () => {
  assert.match(gitignore, /benchmarks\/card-recognition\/private\//);
  assert.match(gitignore, /benchmarks\/card-recognition\/results\.local\.json/);
});

test("benchmark computes exact-ID Top-1/3/5 independently from displayed fields", () => {
  const candidates = [
    { id: "wrong-1", name: "Rayquaza", collection: "Wrong", cardNumber: "1/100", language: "en", score: 90 },
    { id: "me02.5-153", name: "Rayquaza", collection: "Heróis Excelsos", cardNumber: "153/217", language: "pt-BR", score: 80 },
  ];
  const sample = {
    groundTruth: { fixtureId: "ray", cardId: "me02.5-153", name: "Rayquaza", set: "Heróis Excelsos", cardNumber: "153/217", language: "pt-BR" },
    result: result(candidates),
  };
  const evaluated = evaluateRecognitionSample(sample);
  assert.equal(evaluated.top1, false);
  assert.equal(evaluated.top3, true);
  assert.equal(evaluated.top5, true);
  assert.equal(evaluated.exactRank, 2);
});

test("benchmark reports P50/P95, accuracy and catalog request means", () => {
  const truth = { fixtureId: "one", cardId: "id-1", name: "One", set: "Set", cardNumber: "001/100", language: "en" };
  const good = { id: "id-1", name: "One", collection: "Set", cardNumber: "001/100", language: "en", score: 99 };
  const bad = { id: "id-x", name: "Other", collection: "Other", cardNumber: "2/10", language: "es", score: 80 };
  const samples = [
    { groundTruth: truth, result: result([good], { name: "One", collection: "Set", cardNumber: "001/100", language: "en", elapsedMs: 100, catalogRequests: 1 }), ramMb: 100 },
    { groundTruth: { ...truth, fixtureId: "two" }, result: result([bad, good], { elapsedMs: 200, catalogRequests: 3 }), ramMb: 120 },
    { groundTruth: { ...truth, fixtureId: "three" }, result: result([bad], { elapsedMs: 900, catalogRequests: 2 }), ramMb: 110 },
  ];
  const summary = summarizeRecognitionBenchmark(samples);
  assert.equal(summary.samples, 3);
  assert.equal(summary.top1ExactCardAccuracy, 1 / 3);
  assert.equal(summary.top3ExactCardAccuracy, 2 / 3);
  assert.equal(summary.p50LatencyMs, 200);
  assert.equal(summary.p95LatencyMs, 900);
  assert.equal(summary.meanCatalogRequests, 2);
  assert.equal(summary.meanRamMb, 110);
});