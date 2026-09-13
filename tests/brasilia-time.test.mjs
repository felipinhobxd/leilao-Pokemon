import assert from "node:assert/strict";
import test from "node:test";
import {
  brasiliaInputToIso,
  excelBrasiliaDate,
  formatBrasiliaDateTime,
  toBrasiliaInput,
} from "../lib/brasilia-time.ts";

test("Brasilia wall clock converts to and from UTC explicitly", () => {
  assert.equal(brasiliaInputToIso("2026-09-13T20:35:42"), "2026-09-13T23:35:42.000Z");
  assert.equal(toBrasiliaInput("2026-09-13T23:35:42.000Z", true), "2026-09-13T20:35:42");
  assert.match(formatBrasiliaDateTime("2026-09-13T23:35:42.000Z"), /13\/09\/2026 20:35:42/);
});

test("Excel date stores the Brasilia wall clock independent of server timezone", () => {
  const date = excelBrasiliaDate("2026-09-13T23:35:42.000Z");
  assert.ok(date instanceof Date);
  assert.equal(date.toISOString(), "2026-09-13T20:35:42.000Z");
});
