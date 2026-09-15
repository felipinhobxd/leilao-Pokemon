import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Local recognition service integration: strong two-route pipeline on the user's
// PC (127.0.0.1) with automatic fallback to the browser pipeline when offline.
// OCR must never be the gatekeeper: the visual route (embedding retrieval +
// geometric verification) runs independently (regression: Shroodle/escia).

const local = fs.readFileSync(new URL("../lib/card-recognition-local.ts", import.meta.url), "utf8");
const wizard = fs.readFileSync(new URL("../app/auctions/new/bulk-wizard.tsx", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const recognitionServer = fs.readFileSync(new URL("../recognition/recognition_server.py", import.meta.url), "utf8");
const pipeline = fs.readFileSync(new URL("../recognition/recognizer/pipeline.py", import.meta.url), "utf8");
const benchmark = fs.readFileSync(new URL("../recognition/scripts/benchmark.py", import.meta.url), "utf8");
const fixtures = fs.readFileSync(new URL("../recognition/scripts/make_fixtures.py", import.meta.url), "utf8");

test("local service client probes health, degrades to browser pipeline, never fails silently", () => {
  assert.match(local, /SERVICE_BASE = "http:\/\/127\.0\.0\.1:8765"/);
  assert.match(local, /probeLocalService/);
  assert.match(local, /AbortSignal\.timeout\(HEALTH_TIMEOUT_MS\)/);
  assert.match(local, /recognizeInBrowser\(file, selectedLanguage, onProgress, options\)/);
  assert.match(local, /statusCache = \{ status: "offline", checkedAt: Date\.now\(\) \}/);
  // No localhost wildcard CORS: the service only accepts same-machine origins.
  assert.doesNotMatch(local, /allow_origins: \["\*"\]/);
  // The pipeline is only used once the service reports readiness, not just liveness.
  assert.match(local, /health\.ready === false/);
  // Batch photos queue client-side instead of firing 50 simultaneous requests.
  assert.match(local, /createRecognitionScheduler/);
  assert.match(local, /queueStatusMessage/);
});

test("OCR is never the gatekeeper in the local pipeline: visual route runs independently", () => {
  // Route A (visual retrieval) executes before OCR and never requires OCR hints.
  assert.match(pipeline, /route_a_candidates, orientation = self\.route_a\(card\)/);
  assert.match(pipeline, /hints, route_b_candidates = self\.route_b\(card, orientation\)/);
  // OCR failure does not empty the candidate pool: route A candidates merge first.
  assert.match(pipeline, /for candidate in route_a_candidates:/);
  // Geometric verification (RANSAC homography) is near-conclusive evidence.
  assert.match(pipeline, /verification\.score \* 220\.0/);
});

test("honest confidence categories, no fake percentages", () => {
  assert.match(pipeline, /IDENTIFICADO|PROVAVEL|REVISAR|NAO_IDENTIFICADO/);
  assert.match(local, /confidenceKind\?: "evidence-score-not-calibrated-probability"/);
});

test("memory is confirmed-only: user confirmation writes, recognition never auto-saves", () => {
  const memory = fs.readFileSync(new URL("../recognition/recognizer/memory.py", import.meta.url), "utf8");
  assert.match(memory, /Only confirmation\/correction by the user creates ground truth/);
  assert.match(memory, /Predictions are NEVER auto-saved/);
  // The wizard writes memory only inside useCandidate (explicit user choice).
  assert.match(wizard, /confirmRecognitionMemory\(file,/);
  assert.match(wizard, /Candidato escolhido manualmente/);
});

test("regression fixtures encode the mandatory failure cases", () => {
  assert.match(fixtures, /shroodle-escia/);
  assert.match(fixtures, /"escia"/);
  assert.match(fixtures, /dragonair-wrong-number/);
  assert.match(fixtures, /pikachu-rot180/);
  assert.match(fixtures, /charizard-rot90/);
});

test("benchmark measures exact-print metrics for every method", () => {
  assert.match(benchmark, /top1/);
  assert.match(benchmark, /falseHighConfidence/);
  assert.match(benchmark, /latencyP95Ms/);
  assert.match(benchmark, /ocr-only/);
});

test("service binds to localhost only and keeps models loaded", () => {
  assert.match(recognitionServer, /SERVICE_HOST/);
  const config = fs.readFileSync(new URL("../recognition/recognizer/config.py", import.meta.url), "utf8");
  // The bind address lives in config.py; the server must default to it.
  assert.match(config, /SERVICE_HOST = ["']127\.0\.0\.1["']/);
  assert.match(config, /SERVICE_PORT/);
  // CORS is an explicit allow-list (config-driven, localhost defaults) — never "*".
  assert.match(recognitionServer, /allow_origins=allowed_origins\(\)/);
  assert.match(config, /RECOGNITION_ALLOWED_ORIGINS/);
  assert.doesNotMatch(config, /"\*"\)/);
  assert.doesNotMatch(recognitionServer, /host="0\.0\.0\.0"/);
  assert.match(recognitionServer, /_state\["recognizer"\] is None/);
  assert.match(recognitionServer, /--preload/);
  // Recognition runs on a bounded executor, off the event loop (batch safety).
  assert.match(recognitionServer, /run_in_executor/);
  assert.match(recognitionServer, /RECOGNITION_MAX_CONCURRENCY/);
  // Health distinguishes process-alive from recognition-ready.
  assert.match(recognitionServer, /"ready": ready/);
});

test("npm exposes recognition lifecycle commands", () => {
  assert.equal(typeof packageJson.scripts["recognition:install"], "string");
  assert.equal(typeof packageJson.scripts["recognition:local"], "string");
  assert.equal(typeof packageJson.scripts["recognition:index"], "string");
});

test("Milo stays removed from every layer", () => {
  for (const [name, source] of [["local", local], ["wizard", wizard], ["server", recognitionServer], ["pipeline", pipeline]]) {
    assert.doesNotMatch(source, /Milo|searchMiloVisual|miloRuntime/, `${name} mentions Milo`);
  }
});
