import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const local = fs.readFileSync(new URL("../lib/card-recognition-local.ts", import.meta.url), "utf8");
const toggle = fs.readFileSync(new URL("../app/auctions/new/recognition-toggle.tsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/auctions/new/page.tsx", import.meta.url), "utf8");

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
