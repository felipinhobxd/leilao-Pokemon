import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Source assertions must be line-ending agnostic: a Windows checkout with
// core.autocrlf=true stores CRLF on disk, and a `\n`-anchored regex fails
// there while passing on Linux CI (the exact "117 pass / 1 fail only on the
// user's machine" asymmetry reported on 2026-09-16). Normalizing at read
// time keeps every assertion below just as strict on both platforms.
const readSource = (url) => fs.readFileSync(new URL(url, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const local = readSource("../lib/card-recognition-local.ts");
const toggle = readSource("../app/auctions/new/recognition-toggle.tsx");
const page = readSource("../app/auctions/new/page.tsx");

test("image recognition can be disabled before uploads", () => {
  assert.match(toggle, /Reconhecimento de imagens:/);
  assert.match(toggle, /As imagens serão adicionadas sem usar a IA/);
  assert.match(local, /if \(!imageRecognitionEnabled\(\)\)/);
  assert.match(local, /Reconhecimento de imagens desativado/);
  assert.ok(local.indexOf("if (!imageRecognitionEnabled())") < local.indexOf("const status = await probeLocalService()"));
});

test("preference persists locally and page shows toggle before wizard", () => {
  assert.match(local, /localStorage\.setItem\(IMAGE_RECOGNITION_STORAGE_KEY/);
  assert.match(toggle, /document\.body\.dataset\.imageRecognition/);
  assert.ok(page.indexOf("<RecognitionToggle />") < page.indexOf("<BulkAuctionWizard />"));
});

test("disabled recognition performs zero work and never marks not-found", () => {
  const wizard = readSource("../app/auctions/new/bulk-wizard.tsx");
  // The idle-scan effect must check the preference BEFORE calling identifyCard.
  assert.match(wizard, /if \(!imageRecognitionEnabled\(\)\) return;\n    for \(const card of cards\)/);
  // identifyCard itself bails out before ANY work: the guard must precede the
  // in-flight registration (the first state change of the function).
  const identify = wizard.slice(wizard.indexOf("async function identifyCard"), wizard.indexOf("async function identifyCard") + 900);
  assert.ok(identify.indexOf("if (!imageRecognitionEnabled()) return;") < identify.indexOf("recognitionInFlight.current.add(id)"),
    "o guard precisa vir antes de qualquer registro de trabalho");
  assert.ok(identify.indexOf("if (!imageRecognitionEnabled()) return;") < identify.indexOf('recognitionStage: "queued"'),
    "o guard precisa vir antes de qualquer mudança de estado");
  // recognizePokemonCard (the shared entry point) also refuses BEFORE probing
  // the service: OFF means zero network requests, not even /health.
  assert.ok(local.indexOf("if (!imageRecognitionEnabled())") < local.indexOf("const status = await probeLocalService()"));
  // A result that lands after the user switched OFF is dropped (back to idle),
  // never turned into not-found / expanded.
  assert.match(wizard, /Disabled while this request was running/);
  // Toggle transitions are observed: OFF returns queued cards to idle; ON
  // resumes recognition of pending images.
  assert.match(wizard, /imageRecognitionPreferenceEvent, sync/);
  assert.match(wizard, /window\.addEventListener\("storage", sync\)/);
});

test("strict service readiness: only ready === true is usable", () => {
  const contract = fs.readFileSync(new URL("../lib/card-recognition-service-contract.ts", import.meta.url), "utf8");
  // The ServiceHealth type keeps ready optional so older services still parse,
  // but the client must reject anything that is not exactly true.
  assert.match(local, /health\.ready !== true/);
  assert.doesNotMatch(local, /health\.ready === false/);
  assert.match(contract, /ready\?: boolean/);
});
