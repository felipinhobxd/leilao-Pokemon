"use client";

import { useEffect, useState } from "react";
import type { RecognitionResult } from "@/lib/card-recognition-core";
import { cardRecognitionRuntime } from "@/lib/card-recognition-browser";
import { normalizeCardPhoto } from "@/lib/card-recognition-normalize";
import { recognizeVisually } from "@/lib/card-recognition-visual";

type V11DebugResult = RecognitionResult & {
  decisionStatus?: "IDENTIFICADA" | "PROVÁVEL" | "REVISAR" | "SEM RESULTADO";
  confidenceKind?: string;
  normalization?: { method?: string; confidence?: number; rotation?: number };
  recognitionMemory?: {
    status?: string;
    fingerprint?: string;
    matches?: number;
    confident?: boolean;
    veryStrong?: boolean;
    elapsedMs?: number;
    error?: string;
  };
  exactVisual?: {
    status?: string;
    used?: boolean;
    backend?: string;
    candidateCount?: number;
    error?: string;
    reason?: string;
  };
  independentEvidence?: string[];
};

export default function RecognitionDebug({ file, result, busy }: { file: File; result?: RecognitionResult; busy: boolean }) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const v11 = result as V11DebugResult | undefined;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function testExactVisual() {
    setTesting(true);
    setMessage("🖼 Normalizando a foto para comparar com as imagens oficiais…");
    try {
      const normalized = await normalizeCardPhoto(file, setMessage);
      const candidates = result?.candidates?.filter(candidate => Boolean(candidate.image)).slice(0, 12) ?? [];
      if (!candidates.length) throw new Error("O reconhecimento ainda não gerou candidatos com imagem oficial.");
      const outcome = await recognizeVisually(normalized.blob, candidates, setMessage, "auto");
      setMessage(JSON.stringify({
        teste: outcome.status === "compared" ? "PASS" : "FAIL",
        reconhecimentoAtivo: `v${cardRecognitionRuntime.version}`,
        backend: outcome.backend,
        candidatosComparados: outcome.candidates.length,
        normalizacao: { metodo: normalized.method, confianca: normalized.confidence, rotacao: normalized.rotation },
        erro: outcome.error,
        motivo: outcome.reason,
        top5: outcome.candidates.slice(0, 5).map(candidate => ({
          nome: candidate.name,
          numero: candidate.cardNumber,
          colecao: candidate.collection,
          id: candidate.id,
          similaridadeVisual: candidate.visualSimilarity,
          vencedorVisual: Boolean(candidate.evidence?.visualMatch),
        })),
        observacao: "Compara candidatos plausíveis diretamente com scans oficiais do TCGdex. Usa estrutura/arte/rodapé e DINOv2 local apenas para desempate.",
      }, null, 2));
    } catch (error) {
      setMessage(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTesting(false);
    }
  }

  const visual = v11?.exactVisual;
  const status = !result
    ? "Comparação visual: aguardando reconhecimento"
    : visual?.status === "compared"
      ? `Comparação visual: executada (${visual.backend ?? "backend não informado"}) · ${visual.candidateCount ?? 0} candidato(s)`
      : visual?.status === "failed"
        ? `Comparação visual: falhou — ${visual.error ?? "veja os detalhes"}`
        : `Comparação visual: ${visual?.reason ?? "não foi necessária ou ainda não foi executada"}`;

  const candidate = result?.candidates?.[0];
  const fieldRows = [
    ["1. Nome", result?.hints.name || candidate?.name || "Ainda não lido"],
    ["2. Número", result?.hints.cardNumber || candidate?.cardNumber || "Ainda não lido"],
    ["3. Coleção / edição", candidate?.collection || "Aguardando confirmação"],
    ["4. Idioma", result?.hints.language ? `${result.hints.language} (${result.hints.languageConfidence}%)` : "Ainda não confirmado"],
  ];

  return <section className="wide recognition-inspector">
    {preview && <div className="recognition-large-preview"><img src={preview} alt="Prévia ampliada da carta para conferência" /><small>A análise usa o arquivo original em alta resolução; esta prévia ampliada é para você conferir o que foi enviado.</small></div>}
    <div className="recognition-breakdown" aria-label="Etapas do reconhecimento">
      {fieldRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <p role="status"><strong>Runtime: reconhecimento v{cardRecognitionRuntime.version}</strong><br />{status}</p>
    <button type="button" className="secondary" disabled={testing || busy} onClick={() => void testExactVisual()}>{testing ? "Comparando scans oficiais…" : "Testar comparação visual exata"}</button>
    <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{message}</pre>
    <details><summary>Detalhes do reconhecimento</summary>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify({
        runtime: cardRecognitionRuntime,
        decisao: v11?.decisionStatus,
        evidenciasIndependentes: v11?.independentEvidence,
        normalizacao: v11?.normalization,
        memoriaConfirmada: v11?.recognitionMemory,
        comparacaoVisualExata: v11?.exactVisual,
        OCR: {
          nome: result?.hints.name ?? "",
          numero: result?.hints.cardNumber ?? "",
          localId: result?.hints.localId ?? "",
          denominador: result?.hints.denominator ?? null,
          idioma: result?.hints.language ?? null,
          confiancaIdioma: result?.hints.languageConfidence ?? 0,
        },
        catalogo: {
          estrategia: result?.catalogStrategy,
          setsCandidatos: result?.catalogSetCandidates,
          origemIndiceSets: result?.catalogSetIndexSource,
          requests: result?.catalogRequests,
          consultas: result?.catalogQueries,
          antesDoFiltro: result?.catalogCandidatesBefore,
          depoisDoFiltro: result?.catalogCandidatesAfter,
          limiteAtingido: result?.catalogBudgetExhausted,
        },
        visual: {
          acionada: result?.visualUsed ?? false,
          estado: result?.visualStatus,
          motivo: result?.visualReason,
          backend: result?.visualBackend,
          erro: result?.visualError,
        },
      }, null, 2)}</pre>
    </details>
  </section>;
}
