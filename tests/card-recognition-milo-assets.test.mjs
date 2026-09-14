import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const milo = fs.readFileSync(new URL("../lib/card-recognition-milo.ts", import.meta.url), "utf8");

test("Milo runtime versions all static asset URLs together", () => {
  assert.match(milo, /MILO_ASSET_VERSION/);
  assert.match(milo, /withAssetVersion/);
  assert.match(milo, /index\.stats\.json/);
  assert.match(milo, /cardsIndexed/);
  assert.match(milo, /vectors\.length !== entries\.length \* DIMENSIONS/);
  assert.match(milo, /caches\.delete\(CACHE_NAME\)/);
});
