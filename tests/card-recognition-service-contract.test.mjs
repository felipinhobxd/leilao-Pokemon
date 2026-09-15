import test from "node:test";
import assert from "node:assert/strict";

// Behavior tests for the local-service contract (P0/P1 post-merge hardening).
// These exercise the REAL mapping/scheduler logic — not regex over source —
// because exactly this layer once flattened `denominator` to null and the
// wizard fired 50 simultaneous recognitions.

import {
  createRecognitionScheduler,
  mapServiceCandidate,
  mapServiceHints,
  mapServiceResult,
  parseDenominatorFromCardNumber,
  queueStatusMessage,
  resolveServiceImageUrl,
} from "../lib/card-recognition-service-contract.ts";

const SERVICE_BASE = "http://127.0.0.1:8765";

test("full collector number 106/189 survives the service mapping end-to-end", () => {
  const candidate = mapServiceCandidate({
    cardId: "swsh3-106",
    language: "pt-BR",
    name: "Purrloin",
    cardNumber: "106/189",
    localId: "106",
    denominator: 189,
    hp: 60,
    ocrNumberMatch: true,
    ocrDenominatorMatch: true,
    ocrFullNumberMatch: true,
  }, SERVICE_BASE);
  assert.equal(candidate.localId, "106");
  assert.equal(candidate.denominator, 189);
  assert.equal(candidate.cardNumber, "106/189");
  assert.equal(candidate.evidence.localIdMatch, true);
  assert.equal(candidate.evidence.denominatorMatch, true);
  assert.equal(candidate.evidence.fullNumberMatch, true);
});

test("denominator falls back to parsing cardNumber when the field is absent (older service)", () => {
  const candidate = mapServiceCandidate({
    cardId: "swsh3-106", language: "pt-BR", name: "Purrloin",
    cardNumber: "106/189", localId: "106",
  }, SERVICE_BASE);
  assert.equal(candidate.localId, "106");
  assert.equal(candidate.denominator, 189);
});

test("denominator is null only when genuinely unknown", () => {
  const candidate = mapServiceCandidate({
    cardId: "x-1", language: "en", name: "X", cardNumber: "5", localId: "5", denominator: null,
  }, SERVICE_BASE);
  assert.equal(candidate.denominator, null);
  assert.equal(parseDenominatorFromCardNumber("35/64"), 64);
  assert.equal(parseDenominatorFromCardNumber("35"), null);
  assert.equal(parseDenominatorFromCardNumber(undefined), null);
});

test("denominator conflict evidence maps distinctly from localId match", () => {
  const candidate = mapServiceCandidate({
    cardId: "swsh3.5-106", language: "pt-BR", name: "Purrloin",
    cardNumber: "106/73", localId: "106", denominator: 73,
    ocrNumberMatch: true, ocrDenominatorMatch: false, ocrFullNumberMatch: false,
  }, SERVICE_BASE);
  assert.equal(candidate.evidence.localIdMatch, true, "N bate");
  assert.equal(candidate.evidence.denominatorMatch, false, "M não bate");
  assert.equal(candidate.evidence.fullNumberMatch, false);
});

test("local /scan image URLs resolve against the service base", () => {
  assert.equal(resolveServiceImageUrl("/scan/pt-BR/swsh3-106", SERVICE_BASE),
    "http://127.0.0.1:8765/scan/pt-BR/swsh3-106");
  assert.equal(resolveServiceImageUrl("https://assets.tcgdex.net/pt/me/me01/091/high.webp", SERVICE_BASE),
    "https://assets.tcgdex.net/pt/me/me01/091/high.webp");
  assert.equal(resolveServiceImageUrl(null, SERVICE_BASE), null);
  const candidate = mapServiceCandidate({
    cardId: "swsh3-106", language: "pt-BR", name: "Purrloin",
    imageUrl: "/scan/pt-BR/swsh3-106",
  }, SERVICE_BASE);
  assert.equal(candidate.image, "http://127.0.0.1:8765/scan/pt-BR/swsh3-106");
});

test("mapped result carries decision status, hints and queue timings", () => {
  const result = mapServiceResult({
    decision: "IDENTIFICADO",
    best: { cardId: "swsh3-106", language: "pt-BR", name: "Purrloin", localId: "106", denominator: 189, cardNumber: "106/189" },
    candidates: [],
    routeA: true,
    routeB: true,
    orientation: "0",
    hints: { name: "Purrloin", localId: "106", denominator: 189, numberConfidence: 0.93 },
    evidence: ["geometric-verification", "collector-number"],
    elapsedMs: 8100,
    queueMs: 14300,
    executionMs: 8100,
  }, SERVICE_BASE);
  assert.equal(result.decisionStatus, "IDENTIFICADA");
  assert.equal(result.level, "high");
  assert.equal(result.name, "Purrloin");
  assert.equal(result.cardNumber, "106/189");
  assert.equal(result.hints.denominator, 189);
  assert.equal(result.hints.localId, "106");
  assert.equal(result.localPipeline.queueMs, 14300);
  assert.equal(result.localPipeline.executionMs, 8100);
});

test("scheduler keeps concurrency bounded and runs everything (20-job stress)", async () => {
  const scheduler = createRecognitionScheduler({ concurrency: 2 });
  let running = 0;
  let peak = 0;
  const done = [];
  const jobs = Array.from({ length: 20 }, (_, i) => scheduler.run(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5 + (i % 3)));
    running -= 1;
    done.push(i);
  }));
  await Promise.all(jobs);
  assert.equal(done.length, 20, "todos os jobs devem completar");
  assert.ok(peak <= 2, `concorrência deve ficar <= 2, pico ${peak}`);
  assert.ok(peak >= 2, "o scheduler deve paralelizar até o limite");
});

test("scheduler preserves job results and rejections", async () => {
  const scheduler = createRecognitionScheduler({ concurrency: 1 });
  const ok = scheduler.run(async () => 42);
  const fail = scheduler.run(async () => { throw new Error("boom"); });
  assert.equal(await ok, 42);
  await assert.rejects(() => fail, /boom/);
});

test("queue status message is human and only appears when waiting", () => {
  assert.equal(queueStatusMessage(0, 1), null);
  assert.match(queueStatusMessage(3, 1) ?? "", /Na fila de reconhecimento/);
  assert.match(queueStatusMessage(3, 1) ?? "", /3 cartas na frente/);
  assert.match(queueStatusMessage(1, 1) ?? "", /1 carta na frente/);
});

test("scheduler with 50 jobs and slow tasks never exceeds the limit", async () => {
  const scheduler = createRecognitionScheduler({ concurrency: 2 });
  let running = 0;
  let peak = 0;
  const jobs = Array.from({ length: 50 }, () => scheduler.run(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 2));
    running -= 1;
  }));
  await Promise.all(jobs);
  assert.ok(peak <= 2, `pico ${peak} > 2`);
});

test("mapServiceHints keeps the full N/M from the OCR route", () => {
  const hints = mapServiceHints({
    hints: { name: "Purrloin", localId: "106", denominator: 189, hp: 60, language: "pt-BR", languageConfidence: 0.9 },
  });
  assert.equal(hints.localId, "106");
  assert.equal(hints.denominator, 189);
  assert.equal(hints.cardNumber, "106/189");
  assert.equal(hints.hp, 60);
});
