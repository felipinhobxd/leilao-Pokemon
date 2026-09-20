import test from "node:test";
import assert from "node:assert/strict";
import { isPurgeFinalPhrase, isPurgeStep1, normalizePurgePhrase } from "../lib/purge.ts";

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
