import { candidateEvidence, catalogHints, type OcrHints, type RecognitionCandidate, type RecognitionResult } from "./card-recognition-core.ts";

export type Decision = "IDENTIFICADA" | "PROVÁVEL" | "REVISAR" | "SEM RESULTADO";

export function rankEvidence(candidates: RecognitionCandidate[], hints: OcrHints, memory: RecognitionCandidate[] = []) {
  const safe = catalogHints(hints);
  return candidates.map(candidate => {
    // Recompute OCR evidence: catalog expansion and memory must never manufacture name matches.
    const e = candidateEvidence(candidate, safe);
    const nameStrength = hints.nameConfidence ?? (hints.name ? 0.7 : 0);
    const nameConflict = nameStrength >= 0.8 && e.nameSimilarity < 0.55;
    const visual = candidate.visualSimilarity;
    const visualConflict = typeof visual === "number" && visual >= 0 && visual < 0.52;
    const confirmed = memory.some(m => m.language === candidate.language && m.name === candidate.name &&
      m.cardNumber === candidate.cardNumber && (m.id === candidate.id || m.collection === candidate.collection));
    const weights = {
      name: e.nameSimilarity >= 0.9 ? 60 * nameStrength : e.nameSimilarity >= 0.72 ? 25 * nameStrength : 0,
      number: e.fullNumberMatch ? 45 : 0,
      hp: e.hpMatch ? 5 * (hints.hpConfidence ?? 0.5) : 0,
      language: e.languageMatch ? 5 * hints.languageConfidence / 100 : 0,
      visual: candidate.evidence?.visualMatch ? 50 : typeof visual === "number" && visual >= 0 ? Math.max(0, visual - 0.5) * 20 : 0,
      memory: confirmed ? 6 : 0,
      contradictions: (nameConflict ? -120 : 0) + (visualConflict ? -65 : 0),
    };
    return { ...candidate, evidence: { ...e, visualMatch: Boolean(candidate.evidence?.visualMatch) },
      score: Object.values(weights).reduce((a, b) => a + b, 0), weights, nameConflict, visualConflict };
  }).sort((a, b) => b.score - a.score);
}

export function decideRecognition(base: RecognitionResult, candidates: RecognitionCandidate[], visualStatus: string, memory: RecognitionCandidate[] = []) {
  const ranked = rankEvidence(candidates, base.hints, memory);
  const [best, second] = ranked;
  const nameStrong = Boolean(best && (base.hints.nameConfidence ?? 0.7) >= 0.8 && best.evidence.nameSimilarity >= 0.9);
  const visualStrong = Boolean(best && visualStatus === "compared" && best.evidence.visualMatch && (best.visualSimilarity ?? 0) >= 0.78);
  const numberStrong = Boolean(best?.evidence.fullNumberMatch);
  const conflict = Boolean(best && (best.nameConflict || best.visualConflict));
  const separated = Boolean(best && (!second || best.score - second.score >= 8));
  const status: Decision = !best || best.score <= 0 ? "SEM RESULTADO"
    : conflict ? "REVISAR"
    : nameStrong && visualStrong && separated ? "IDENTIFICADA"
    : nameStrong && (numberStrong || visualStrong) && separated ? "PROVÁVEL"
    : "REVISAR";
  const result: RecognitionResult = {
    ...base, candidates: ranked, confidence: 0, level: "low",
    name: undefined, collection: undefined, cardNumber: undefined, language: undefined, variant: undefined,
  };
  // Legacy numeric field is only an internal evidence band; never render it as a percentage.
  if (best && (status === "IDENTIFICADA" || status === "PROVÁVEL")) {
    Object.assign(result, { name: best.name, collection: best.collection, cardNumber: best.cardNumber,
      language: base.hints.languageConfidence >= 80 ? base.hints.language ?? undefined : undefined,
      variant: best.variant, level: status === "IDENTIFICADA" ? "high" : "medium",
      confidence: status === "IDENTIFICADA" ? 90 : 70 });
  }
  return { result, status, ranking: ranked.map(c => ({ id: c.id, language: c.language, score: c.score, weights: c.weights })),
    evidence: [nameStrong && "ocr-name", numberStrong && "collector-number", visualStrong && "official-scan-visual-match"].filter((v): v is string => Boolean(v)) };
}
