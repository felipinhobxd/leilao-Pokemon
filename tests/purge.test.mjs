import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPurgeFinalPhrase, isPurgeStep1, normalizePurgePhrase, parsePurgeRpcError, PURGE_FIX_MIGRATION } from "../lib/purge.ts";

test("purge phrases: exact input passes", () => {
  assert.equal(isPurgeStep1("excluir tudo"), true);
  assert.equal(isPurgeFinalPhrase("quero excluir mesmo"), true);
});

test("purge phrases: case and stray whitespace are tolerated", () => {
  assert.equal(isPurgeStep1("  EXCLUIR   Tudo "), true);
  assert.equal(isPurgeFinalPhrase("Quero Excluir Mesmo"), true);
  assert.equal(isPurgeFinalPhrase("\tquero excluir mesmo\n"), true);
});

test("purge phrases: anything else is rejected", () => {
  assert.equal(isPurgeStep1("excluir"), false);
  assert.equal(isPurgeStep1("excluir tudoo"), false);
  assert.equal(isPurgeStep1(""), false);
  assert.equal(isPurgeFinalPhrase("quero excluir"), false);
  assert.equal(isPurgeFinalPhrase("excluir tudo"), false);
  assert.equal(isPurgeFinalPhrase(undefined), false);
  assert.equal(isPurgeFinalPhrase(null), false);
  assert.equal(isPurgeFinalPhrase(42), false);
});

test("normalizePurgePhrase collapses inner whitespace and lowercases (pt-BR)", () => {
  assert.equal(normalizePurgePhrase("  Quero   EXCLUIR\tmesmo  "), "quero excluir mesmo");
  assert.equal(normalizePurgePhrase(null), "");
});

test("normalized final phrase matches the literal the RPC compares (DB contract)", () => {
  // purge_all_business_data raises purge_not_confirmed unless p_confirm is
  // EXACTLY this string. The route must therefore send the normalized form —
  // the UI already unlocks the button on mixed-case input.
  assert.equal(normalizePurgePhrase("Quero Excluir Mesmo"), "quero excluir mesmo");
  assert.equal(normalizePurgePhrase("  QUERO EXCLUIR MESMO  "), "quero excluir mesmo");
});

test("parsePurgeRpcError: missing RPC (migration never applied) becomes an actionable 503", () => {
  const cases = [
    { code: "PGRST202", message: "Could not find the function public.purge_all_business_data with parameters p_confirm in the schema cache" },
    { message: 'function public.purge_all_business_data(text) does not exist' },
  ];
  for (const error of cases) {
    const parsed = parsePurgeRpcError(error);
    assert.equal(parsed.status, 503);
    assert.match(parsed.message, new RegExp(PURGE_FIX_MIGRATION));
  }
});

test("parsePurgeRpcError: security-invoker ownership failure points at the fix migration", () => {
  const parsed = parsePurgeRpcError({ message: "must be owner of relation auction_events" });
  assert.equal(parsed.status, 503);
  assert.match(parsed.message, new RegExp(PURGE_FIX_MIGRATION));
  const denied = parsePurgeRpcError({ message: "permission denied for table auction_events" });
  assert.equal(denied.status, 503);
});

test("parsePurgeRpcError: phrase rejection is a 400, not a 500", () => {
  const parsed = parsePurgeRpcError({ message: "purge_not_confirmed" });
  assert.equal(parsed.status, 400);
  assert.match(parsed.message, /quero excluir mesmo/);
});

test("parsePurgeRpcError: unknown failures surface the raw database message", () => {
  const parsed = parsePurgeRpcError({ message: "something exploded" });
  assert.equal(parsed.status, 500);
  assert.match(parsed.message, /something exploded/);
  const empty = parsePurgeRpcError(null);
  assert.equal(empty.status, 500);
  assert.equal(typeof empty.message, "string");
  assert.ok(empty.message.length > 0);
});

test("route contract: RPC receives the NORMALIZED phrase (regression: raw mixed-case 500s)", () => {
  const source = readFileSync(new URL("../app/api/admin/purge/route.ts", import.meta.url), "utf8");
  assert.match(source, /normalizePurgePhrase\(body\.confirm\)/);
  assert.match(source, /db\.rpc\("purge_all_business_data",\s*\{\s*p_confirm:\s*confirm\s*\}\)/);
});

test("migration contract: purge function ships as SECURITY DEFINER with the exact phrase gate", () => {
  for (const file of [
    "../supabase/migrations/20260921130000_tiebreak_and_purge_all.sql",
    `../supabase/migrations/${PURGE_FIX_MIGRATION.split("/").pop()}`,
  ]) {
    const sql = readFileSync(new URL(file, import.meta.url), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.purge_all_business_data"));
    assert.ok(fn.includes("security definer"), `${file}: purge must be SECURITY DEFINER (service_role is not the table owner)`);
    assert.ok(fn.includes("<> 'quero excluir mesmo'"), `${file}: phrase gate literal`);
  }
});
