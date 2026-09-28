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
  const botResource = resources.find(item => item.from === "bot" && item.to === "app/bot");
  assert.ok(botResource);
  assert.ok(botResource.filter.some(item => item === "!**/.env"));
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
  assert.match(workflow, /card-recognition\/ppocrv6-loader\.mjs/);
  assert.match(workflow, /web-sdk-pp-ocrv6@0\\.2\\.0/);
  assert.match(workflow, /Leilão Pokémon/);
  assert.match(workflow, /softprops\/action-gh-release/);
  assert.match(workflow, /desktop-v\$\{\{ github\.run_number \}\}/);
});


test("desktop delivery window is 24h and bot cleanup has a 30-day safety floor", () => {
  const dashboard = read("../app/api/dashboard/route.ts");
  const ui = read("../app/dashboard.tsx");
  const bot = read("../bot/service.mjs");
  assert.match(dashboard, /DISPATCH_WINDOW_DAYS = 1/);
  assert.match(ui, /Envios \(24h\)/);
  assert.match(bot, /BOT_CLEANUP_DAYS \?\? 30/);
  assert.match(bot, /Math\.max\(30, Math\.floor\(requestedDays\)\)/);
  assert.match(bot, /ensureCloudBackupForCleanup/);
  assert.match(bot, /backup_cloud_copy_missing/);
});


test("desktop stores Supabase secret through Electron secure storage instead of packaging it", () => {
  const main = read("../electron/main.cjs");
  const preload = read("../electron/preload.js");
  const pkg = JSON.parse(read("../package.json"));
  const workflow = read("../.github/workflows/desktop.yml");
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /desktop-secure-config\.json/);
  assert.match(preload, /desktop-config:save/);
  const botResource = (pkg.build?.extraResources ?? []).find(item => item.from === "bot" && item.to === "app/bot");
  assert.ok(botResource);
  assert.ok(botResource.filter.some(item => item === "!**/.env"));
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY/);
});

test("dashboard initial render is deterministic and syncs persisted auth", () => {
  const source = read("../app/dashboard.tsx");
  assert.match(source, /const \[clock, setClock\] = useState\(0\)/);
  assert.match(source, /db\.auth\.getSession\(\)/);
  assert.match(source, /setReady\(true\)/);
});
