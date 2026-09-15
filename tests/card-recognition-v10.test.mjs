import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { summarizeRecognitionBenchmark, evaluateRecognitionSample } from "../lib/card-recognition-benchmark.ts";

const v10 = fs.readFileSync(new URL("../lib/card-recognition-browser-v10.ts", import.meta.url), "utf8");
const memory = fs.readFileSync(new URL("../lib/card-recognition-memory.ts", import.meta.url), "utf8");
const visual = fs.readFileSync(new URL("../lib/card-recognition-visual.ts", import.meta.url), "utf8");
const visualWorker = fs.readFileSync(new URL("../lib/card-recognition-visual.worker.ts", import.meta.url), "utf8");
const normalize = fs.readFileSync(new URL("../lib/card-recognition-normalize.ts", import.meta.url), "utf8");
const cornelius = fs.readFileSync(new URL("../lib/card-recognition-cornelius.ts", import.meta.url), "utf8");
const ppocr = fs.readFileSync(new URL("../lib/card-recognition-ppocr.ts", import.meta.url), "utf8");
const wizard = fs.readFileSync(new URL("../app/auctions/new/bulk-wizard.tsx", import.meta.url), "utf8");
const debugUi = fs.readFileSync(new URL("../app/auctions/new/recognition-debug.tsx", import.meta.url), "utf8");
const memoryRoute = fs.readFileSync(new URL("../app/api/card-recognition/memory/route.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260914163500_card_recognition_memory.sql", import.meta.url), "utf8");
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

test("v11 is the active recognizer but business flow remains imported through the stable alias", () => {
  assert.equal(tsconfig.compilerOptions.paths["@/lib/card-recognition-browser"][0], "./lib/card-recognition-browser-v10.ts");
  assert.match(v10, /version: 11/);
  assert.match(v10, /import \* as v9 from "\.\/card-recognition-browser-v9"/);
  // The wizard now prefers the local service pipeline (strong, two-route) and
  // falls back to v11 in the browser; both keep the same public contract.
  assert.match(wizard, /from "@\/lib\/card-recognition-local"/);
  assert.match(wizard, /mergeRecognitionFields/);
});

test("default UI language is not evidence and v11 does not forward it to inference", () => {
  assert.match(wizard, /language: "pt-BR"/);
  assert.match(v10, /_selectedLanguage\?: string/);
  assert.doesNotMatch(v10, /v9\.recognizePokemonCard\(/);

  assert.doesNotMatch(v10, /v9\.recognizePokemonCard\([^\n]+selectedLanguage/);
  assert.match(v10, /uiLanguageIsNotRecognitionEvidence: true/);
});

test("Milo is removed and exact-print confirmation uses official scans plus DINOv2 tie-breaking", () => {
  assert.doesNotMatch(v10, /Milo|milo|searchMiloVisual|card-recognition-milo/);
  assert.match(v10, /recognizeVisually\(normalization\.blob, base\.candidates, onProgress\)/);
  assert.match(v10, /official-scan-structural-exact-print-comparison/);
  assert.match(v10, /dinov2-base-local-tiebreaker-on-webgpu/);
  assert.match(visualWorker, /onnx-community\/dinov2-base-ONNX/);
  assert.match(visualWorker, /structuralSimilarity/);
  assert.match(visualWorker, /artwork \* 0\.39/);
  assert.match(visual, /expandSameNamePrintings/);
});

test("v11 always reruns PP-OCRv6 instead of reusing a final recognition result", () => {
  assert.match(v10, /recognitionResultCacheReuse: false/);
  assert.match(v10, /model-assets-only-no-final-result-cache/);
  assert.doesNotMatch(v10, /Resultado reutilizado do cache neural/);
  assert.match(v10, /PP-OCRv6 Medium/);
});

test("PP-OCRv6 Medium performs full-card and targeted name/number passes", () => {
  assert.match(v10, /runPpOcr\(file, onProgress\)/);
  assert.match(ppocr, /model: \{ det: "medium", rec: "medium" \}/);
  assert.match(ppocr, /backend: "wasm"/);
  assert.match(ppocr, /"top-name"/);
  assert.match(ppocr, /"bottom-number"/);
  assert.match(ppocr, /full-card\+top-name\+bottom-number/);
  assert.match(ppocr, /inference: "local-browser"/);
});

test("uncertain Latin OCR searches pt-BR first without treating UI selection as evidence", () => {
  assert.match(v10, /const catalogLanguage = pp\.hints\.language \?\? "pt-BR"/);
  assert.match(v10, /pt-br-first-catalog-validation-when-language-uncertain/);
  assert.match(ppocr, /language: "ja"/);
  assert.match(ppocr, /language: "en"/);
  assert.match(ppocr, /language: "pt-BR"/);
});

test("confirmed memory stores tiny fingerprints and never duplicates card images", () => {
  assert.match(memory, /const DESCRIPTOR_BYTES = 36/);
  assert.match(memory, /action: "bootstrap"/);
  assert.match(memory, /fingerprintRecognitionExample/);
  assert.match(memory, /reuse-existing-card-images-object/);
  assert.match(memory, /confirmed-example-memory-no-gradient-training/);
  assert.match(memoryRoute, /from\("cards"\)/);
  assert.match(memoryRoute, /imageShaFromUrl/);
  assert.match(memoryRoute, /BOOTSTRAP_LIMIT = 24/);
  assert.match(migration, /card_recognition_examples/);
  assert.match(migration, /revoke all on table public\.card_recognition_examples from anon, authenticated/);
});

test("unconfirmed predictions cannot self-train the memory", () => {
  assert.match(v10, /selfTrainingFromUnconfirmedPredictions: false/);
  assert.match(v10, /Memory never replaces OCR/);
  assert.match(v10, /decideRecognition\(base, visual\.candidates/);
  assert.doesNotMatch(v10, /rememberConfirmedCard/);
});

test("Cornelius and PP-OCRv6 are local-first stages with safe fallbacks", () => {
  assert.match(v10, /normalizeCardWithCornelius\(file, onProgress\)/);
  assert.match(v10, /return normalizeCardPhoto\(file, onProgress\)/);
  assert.match(cornelius, /executionProviders: \["wasm"\]/);
  assert.match(cornelius, /inference: "local-browser"/);
  assert.match(ppocr, /backend: "wasm"/);
  assert.match(ppocr, /inference: "local-browser"/);
});

test("debug UI reports exact visual comparison and confirmed memory, not Milo", () => {
  assert.match(debugUi, /Testar comparação visual exata/);
  assert.match(debugUi, /recognizeVisually\(normalized\.blob/);
  assert.match(debugUi, /memoriaConfirmada/);
  assert.match(debugUi, /Runtime: reconhecimento v\{cardRecognitionRuntime\.version\}/);
  assert.doesNotMatch(debugUi, /Milo|searchMiloVisual|miloRuntime/);
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
  assert.match(cornelius, /inverseHomography/);
  assert.match(cornelius, /warp\(source: HTMLCanvasElement, quad: CardQuad\)/);
});

test("IDENTIFICADA requires independent evidence rather than raw memory or visual similarity", () => {
  assert.match(v10, /requiresIndependentEvidenceForIdentified: true/);
  assert.match(v10, /final\.decisionStatus = decision\.status/);


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
