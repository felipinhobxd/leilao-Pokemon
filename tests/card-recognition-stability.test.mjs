import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Stability round (2026-09): the browser fallback must never freeze the page
// (PP-OCR runs in a dedicated Worker), "Failed to fetch" must surface a
// DIAGNOSIS instead of the raw symptom, and the start supervisor must give a
// natively-crashed recognition service a bounded recovery chance.

const read = (url) => fs.readFileSync(new URL(url, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ppocr = read("../lib/card-recognition-ppocr.ts");
const ppocrWorker = read("../lib/card-recognition-ppocr.worker.ts");
const local = read("../lib/card-recognition-local.ts");
const startAll = read("../scripts/start-all.mjs");
const server = read("../recognition/recognition_server.py");
const embed = read("../recognition/recognizer/embed.py");
const ortSession = read("../recognition/recognizer/ort_session.py");
const journal = read("../recognition/recognizer/journal.py");
const pipeline = read("../recognition/recognizer/pipeline.py");
const downloadScans = read("../recognition/scripts/download_scans.py");
const buildCatalog = read("../recognition/scripts/build_catalog.py");
const stress = read("../recognition/scripts/stress_service.py");

test("browser OCR runs in a dedicated worker with an inline fallback", () => {
  // The worker hosts the WHOLE pipeline: SDK load, crops, enhancement and the
  // four inference passes (this is what used to freeze the page).
  assert.match(ppocrWorker, /createOCR\(\{/);
  assert.match(ppocrWorker, /execution: "main"/); // "main" INSIDE the worker == worker thread
  assert.match(ppocrWorker, /buildTargetedInputs/);
  assert.match(ppocrWorker, /enhanceGray/);
  assert.match(ppocrWorker, /carta inteira/);
  // The main-thread module keeps the full inline path as fallback (no Worker
  // support / worker error / timeout), exactly like the Cornelius worker.
  assert.match(ppocr, /new Worker\(new URL\(".\/card-recognition-ppocr\.worker\.ts", import\.meta\.url\)/);
  assert.match(ppocr, /workerBroken = true/);
  assert.match(ppocr, /runPpOcrInline/);
  assert.match(ppocr, /shutdownPpocrWorker\(\)/);
  // Honest runtime metadata: execution is no longer claimed as main-thread.
  assert.match(ppocr, /execution: "dedicated-worker \(inline fallback\)"/);
  assert.doesNotMatch(ppocr, /execution: "main-thread"/);
});

test("failed local service calls are diagnosed, not just reported", () => {
  // "Failed to fetch" is a symptom: the diagnosis distinguishes process-down
  // (TypeError from fetch), timeout (AbortError/TimeoutError) and HTTP status.
  assert.match(local, /function diagnoseServiceFailure/);
  assert.match(local, /serviço local fora do ar/);
  assert.match(local, /tempo esgotado/);
  assert.match(local, /erro HTTP \$\{httpMatch\[1\]\}/);
  assert.match(local, /diagnoseServiceFailure\(reason\)/);
});

test("start supervisor restarts a crashed recognition service within bounds", () => {
  // Bounded: max restarts in a window, never a restart loop.
  assert.match(startAll, /RESTART_MAX = 2/);
  assert.match(startAll, /RESTART_WINDOW_MS = 10 \* 60_000/);
  assert.match(startAll, /esgotou os reinícios/);
  assert.match(startAll, /if \(!stopping\) launch\(command, index\)/);
});

test("python service exposes numerical-stability telemetry and crash recovery", () => {
  // /health stability block: invalid embeddings, provider demotions, crash flag.
  assert.match(server, /"stability"/);
  assert.match(server, /invalidEmbeddings/);
  assert.match(server, /previousRunCrashed/);
  // Crash journal is written per request (concurrency-safe) and swept by glob
  // at startup: any leftover file belongs to a process that died mid-request.
  assert.match(server, /journal_write\(journal_path, request_id/);
  assert.match(server, /glob\.glob\(JOURNAL_PATH \+ "\*"\)/);
  // Crash journal demotes the providers that were executing at death time.
  assert.match(journal, /journal_check_previous_crash/);
  assert.match(journal, /demote_provider/);
  // Provider demotion: marker file + TTL + escape hatches.
  assert.match(ortSession, /def demote_provider/);
  assert.match(ortSession, /RECOGNITION_DEMOTION_TTL_HOURS/);
  assert.match(ortSession, /RECOGNITION_PROVIDER_DEMOTION/);
  // Validation raises a typed error instead of propagating NaN/inf.
  assert.match(embed, /class InvalidEmbeddingError/);
  assert.match(embed, /EMBEDDING_NORM_EPS/);
  assert.match(embed, /np\.isfinite\(embedding\)\.all\(\)/);
  // Pipeline fail-safe: one bad image disables the visual route of THAT
  // request; the OCR route still runs and the process survives.
  assert.match(pipeline, /except InvalidEmbeddingError/);
  assert.match(pipeline, /visual_error/);
});

test("catalog keeps scan-less cards and the scan sync has a state machine", () => {
  // Cards without published scans stay as OCR candidates (not dropped).
  assert.match(buildCatalog, /scan not_available/);
  assert.match(downloadScans, /not_available/);
  assert.match(downloadScans, /validated/);
  assert.match(downloadScans, /_sha256_of/);
  // Long-run stress harness exists for 20/50/100 consecutive requests.
  assert.match(stress, /consecutive recognitions/);
  assert.match(stress, /percentile/);
});
