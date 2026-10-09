import test from "node:test";
import assert from "node:assert/strict";
import { describeError } from "./error-log.mjs";

const CLOUDFLARE_521 = `<!DOCTYPE html>
<head><title>supabase.co | 521: Web server is down</title><meta charset="UTF-8" /></head>
<body><div id="cf-wrapper">Host Error</div></body></html>`;

test("describeError: página HTML do Cloudflare vira uma linha com o title", () => {
  const line = describeError(new Error(CLOUDFLARE_521));
  assert.equal(line, "HTML supabase.co | 521: Web server is down");
});

test("describeError: HTML sem title remove tags e colapsa espaços", () => {
  const line = describeError(new Error("<html><body><p> Bad   \n Gateway </p></body></html>"));
  assert.equal(line, "Error: Bad Gateway");
});

test("describeError: Error comum mantém classe e mensagem", () => {
  assert.equal(describeError(new Error("boom")), "Error: boom");
});

test("describeError: objeto cru com message (throw do supabase-js)", () => {
  assert.equal(describeError({ message: "Gateway Timeout", code: "522" }), "Gateway Timeout");
});

test("describeError: objeto sem message não vira [object Object]", () => {
  const line = describeError({ code: "PGRST116", details: "x" });
  assert.ok(line.includes("PGRST116"), `deveria serializar: ${line}`);
});

test("describeError: trunca mensagens longas", () => {
  const line = describeError(new Error("x".repeat(5000)), 100);
  assert.ok(line.length <= 101 && line.endsWith("…"), `sem truncar: ${line.length}`);
});

test("describeError: string nula/vazia cai em fallback, nunca em linha vazia", () => {
  assert.ok(describeError(null).length > 0);
  assert.ok(describeError(undefined).length > 0);
  assert.ok(describeError("").length > 0);
});
