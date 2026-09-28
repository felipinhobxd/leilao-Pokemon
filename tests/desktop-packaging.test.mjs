import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("desktop main uses the packaged standalone server instead of first-run next build", () => {
  const source = read("../electron/main.cjs");
  assert.match(source, /path\.join\(BUNDLED_ROOT, "\.next", "standalone", "server\.js"\)/);
  assert.match(source, /LEILAO_DESKTOP_STANDALONE/);
  assert.doesNotMatch(source, /buildProcess|runBuild|function needsBuild/);
  assert.doesNotMatch(source, /BUILD_ID/);
  assert.match(source, /show:\s*true/);
  assert.match(source, /did-fail-load/);
});

test("start-all has a dedicated standalone runtime path", () => {
  const source = read("../scripts/start-all.mjs");
  assert.match(source, /LEILAO_DESKTOP_STANDALONE/);
  assert.match(source, /\.next[\\/]standalone/);
  assert.match(source, /server\.js/);
  assert.match(source, /HOSTNAME/);
  assert.match(source, /PORT/);
  assert.match(source, /env:\s*command\.env/);
});

test("desktop build script prepares the files Next standalone does not copy", () => {
  const source = read("../scripts/build-desktop.mjs");
  assert.match(source, /DESKTOP_BUILD:\s*"1"/);
  assert.match(source, /path\.join\(root, "\.next", "static"\)/);
  assert.match(source, /path\.join\(standalone, "\.next", "static"\)/);
  assert.match(source, /public/);
});

test("desktop package configuration contains the standalone runtime and per-user NSIS", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.main, "electron/main.cjs");
  const resources = pkg.build?.extraResources ?? [];
  assert.ok(resources.some(item => item.from === ".next/standalone" && item.to === "app/.next/standalone"));
  assert.ok(resources.some(item => item.from === "bot" && item.to === "app/bot"));
  assert.ok(resources.some(item => item.from === "desktop-runtime/node.exe" && item.to === "node/node.exe"));
  assert.equal(pkg.build?.nsis?.oneClick, true);
  assert.equal(pkg.build?.nsis?.perMachine, false);
});

test("desktop workflow builds standalone and smoke-tests the real executable before release", () => {
  const workflow = read("../.github/workflows/desktop.yml");
  assert.match(workflow, /node scripts\/build-desktop\.mjs/);
  assert.match(workflow, /electron-builder --win/);
  assert.match(workflow, /dist-electron[\\/]win-unpacked/);
  assert.match(workflow, /api\/health/);
  assert.match(workflow, /Leilão Pokémon/);
  assert.match(workflow, /softprops\/action-gh-release/);
  assert.match(workflow, /desktop-v\$\{\{ github\.run_number \}\}/);
});
