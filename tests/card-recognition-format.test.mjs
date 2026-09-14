import test from "node:test";
import assert from "node:assert/strict";
import { formatPrintedCollectorNumber } from "../lib/card-recognition-format.ts";

test("preserves modern printed denominator padding when localId is zero-padded", () => {
  assert.equal(formatPrintedCollectorNumber("066", 88), "066/088");
  assert.equal(formatPrintedCollectorNumber("043", 72), "043/072");
  assert.equal(formatPrintedCollectorNumber("020", 217), "020/217");
  assert.equal(formatPrintedCollectorNumber("021", 142), "021/142");
});

test("does not invent numerator padding for sets that print an unpadded localId", () => {
  assert.equal(formatPrintedCollectorNumber("22", 147), "22/147");
  assert.equal(formatPrintedCollectorNumber("95", 149), "95/149");
  assert.equal(formatPrintedCollectorNumber("110", 196), "110/196");
});
