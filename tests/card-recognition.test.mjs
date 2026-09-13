import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOcrHints,
  detectRecognitionLanguage,
  extractCardNumber,
  extractLikelyName,
  mergeRecognitionFields,
  rankRecognitionCandidates,
  resultFromCandidates,
  safeVariant,
} from "../lib/card-recognition-core.ts";

test("detects English card text", () => {
  const result = detectRecognitionLanguage("Weakness Resistance Retreat During your next turn this attack does 30 damage to your opponent");
  assert.equal(result.language, "en");
  assert.ok(result.confidence >= 70);
});

test("detects Brazilian Portuguese card text", () => {
  const result = detectRecognitionLanguage("Fraqueza Resistência Recuo Durante seu próximo turno este ataque causa 30 de dano. Embaralhe seu baralho.");
  assert.equal(result.language, "pt-BR");
  assert.ok(result.confidence >= 70);
});

test("detects Spanish card text", () => {
  const result = detectRecognitionLanguage("Debilidad Resistencia Retirada Durante tu turno este ataque hace 30 de daño al Pokémon rival. Descarta una Energía.");
  assert.equal(result.language, "es");
  assert.ok(result.confidence >= 70);
});

test("detects Japanese characters without relying on the Pokemon name", () => {
  const result = detectRecognitionLanguage("ピカチュウ でんきショック このポケモンについているエネルギーを1個選び、トラッシュする。");
  assert.equal(result.language, "ja");
  assert.ok(result.confidence >= 80);
});

test("extracts visible collector numbers", () => {
  for (const [text, number, localId, denominator] of [
    ["©1999 Nintendo 35/64", "35/64", "35", 64],
    ["TG05/TG30", "TG05/TG30", "TG05", 30],
    ["SV001/SV122", "SV001/SV122", "SV001", 122],
    ["001 / 165", "001/165", "001", 165],
  ]) {
    const result = extractCardNumber(text);
    assert.equal(result.cardNumber, number);
    assert.equal(result.localId, localId);
    assert.equal(result.denominator, denominator);
    assert.ok(result.localIdVariants.includes(localId));
  }
});

test("extracts a plausible top-line name but rejects rules text", () => {
  assert.equal(extractLikelyName("Exeggutor        HP 90\nSTAGE 1\nEvolves from Exeggcute"), "Exeggutor");
  assert.equal(extractLikelyName("Mr. Mime HP 90"), "Mr. Mime");
  assert.equal(extractLikelyName("Iron Hands HP 120"), "Iron Hands");
  assert.equal(extractLikelyName("Weakness Resistance Retreat\nDuring your next turn"), "");
});

test("bad OCR does not fabricate a high-confidence identification", () => {
  const hints = buildOcrHints("@# 8lI ?!\n###", "xx ? // ??", "blur blur glare");
  const result = resultFromCandidates(hints, [], 100, 0);
  assert.equal(result.level, "low");
  assert.equal(result.name, undefined);
  assert.equal(result.cardNumber, undefined);
  assert.equal(result.language, undefined);
});

test("exact number, name, language and HP rank the correct candidate first", () => {
  const hints = buildOcrHints("Exeggutor HP 90\nBásico", "35/64", "Fraqueza Resistência Recuo");
  const ranked = rankRecognitionCandidates([
    { id: "jungle-35", name: "Exeggutor", collection: "Jungle", cardNumber: "35/64", localId: "35", denominator: 64, language: "pt-BR", hp: 90, image: null },
    { id: "other-35", name: "Doduo", collection: "Outro Set", cardNumber: "35/64", localId: "35", denominator: 64, language: "en", hp: 50, image: null },
  ], hints);
  assert.equal(ranked[0].id, "jungle-35");
  assert.ok(ranked[0].score >= 90);
  const result = resultFromCandidates(hints, ranked, 250, 4);
  assert.equal(result.level, "high");
  assert.equal(result.name, "Exeggutor");
  assert.equal(result.cardNumber, "35/64");
  assert.equal(result.language, "pt-BR");
});

test("ambiguous candidates stay reviewable instead of becoming certain", () => {
  const hints = buildOcrHints("Pikachu", "58/102", "");
  const ranked = rankRecognitionCandidates([
    { id: "a", name: "Pikachu", collection: "Set A", cardNumber: "58/102", localId: "58", denominator: 102, language: "en", hp: 40, image: null },
    { id: "b", name: "Pikachu", collection: "Set B", cardNumber: "58/102", localId: "58", denominator: 102, language: "pt-BR", hp: 40, image: null },
  ], hints);
  const result = resultFromCandidates(hints, ranked, 200, 3);
  assert.notEqual(result.confidence, 100);
  assert.ok(result.candidates.length >= 2);
});

test("manual corrections are never overwritten by later automatic recognition", () => {
  const current = { name: "Nome corrigido", collection: "Coleção manual", cardNumber: "35/64", language: "pt-BR", variant: "Normal" };
  const result = {
    confidence: 95,
    level: "high",
    name: "Automatic Name",
    collection: "Automatic Set",
    cardNumber: "1/100",
    language: "en",
    variant: "Holo",
    candidates: [],
    hints: buildOcrHints("Automatic Name HP 100", "1/100", "Weakness Resistance Retreat"),
    source: "ocr",
    elapsedMs: 100,
    catalogRequests: 2,
  };
  const patch = mergeRecognitionFields(current, { name: true, collection: true, language: true }, result);
  assert.equal(patch.name, undefined);
  assert.equal(patch.collection, undefined);
  assert.equal(patch.language, undefined);
  assert.equal(patch.cardNumber, "1/100");
  assert.equal(patch.variant, "Holo");
});

test("variant is only inferred when catalog metadata is unambiguous", () => {
  assert.equal(safeVariant({ normal: true, holo: false, reverse: false }), "Normal");
  assert.equal(safeVariant({ normal: false, holo: true, reverse: false }), "Holo");
  assert.equal(safeVariant({ normal: true, holo: true, reverse: false }), undefined);
  assert.equal(safeVariant({}), undefined);
});

test("ranking 50-image-equivalent candidate batches is cheap and deterministic", () => {
  const started = performance.now();
  for (let image = 0; image < 50; image++) {
    const hints = buildOcrHints(`Pikachu HP 60`, `${image % 100}/102`, "Weakness Resistance Retreat");
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      id: `${image}-${index}`,
      name: index === 0 ? "Pikachu" : `Pokemon ${index}`,
      collection: "Base Set",
      cardNumber: `${index}/102`,
      localId: String(index),
      denominator: 102,
      language: "en",
      hp: index === 0 ? 60 : 50,
      image: null,
    }));
    const ranked = rankRecognitionCandidates(candidates, hints);
    assert.ok(ranked.length > 0 && ranked.length <= 5);
    assert.equal(ranked[0].id, `${image}-0`);
    assert.ok(ranked.every(candidate => candidate.evidence.strongEvidence && candidate.score >= 45));
    assert.deepEqual(ranked, rankRecognitionCandidates(candidates, hints));
  }
  assert.ok(performance.now() - started < 1500);
});
