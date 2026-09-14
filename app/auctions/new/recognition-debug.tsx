"use client";

import { useEffect, useState } from "react";
import type { RecognitionResult } from "@/lib/card-recognition-core";
import { cardRecognitionRuntime } from "@/lib/card-recognition-browser";
import { normalizeCardPhoto } from "@/lib/card-recognition-normalize";
import { searchMiloVisual, miloRuntime } from "@/lib/card-recognition-milo";

type V10DebugResult = RecognitionResult & {
  decisionStatus?: "IDENTIFICADA" | "PROVÁVEL" | "INCERTA";
  confidenceKind?: string;
  normalization?: { method?: string; confidence?: number; rotation?: number };
  globalVisual?: {
    status?: string;
    indexCandidates?: number;
    elapsedMs?: number;
    catalogRequests?: number;
    backend?: string;
    error?: string;
  };
  independentEvidence?: string[];
};

export default function RecognitionDebug({ file, result, busy }: { file: File; result?: RecognitionResult; busy: boolean }) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const v10 = result as V10DebugResult | undefined;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function testMilo() {
    setTesting(true);
    setMessage("🧠 Normalizando a foto para testar a IA v10/Milo…");
    try {
      const normalized = await normalizeCardPhoto(file, setMessage);
      const outcome = await searchMiloVisual(normalized.blob, result?.hints.language ?? undefined, result?.hints, setMessage);
      setMessage(JSON.stringify({
        teste: outcome.status === "compared" ? "PASS" : "FAIL",
        reconhecimentoAtivo: `v${cardRecognitionRuntime.version}`,
        modelo: miloRuntime.model,
        backend: outcome.backend,
        impressõesNoIndice: outcome.indexCandidates,
        normalizacao: { metodo: normalized.method, confianca: normalized.confidence, rotacao: normalized.rotation },
        tempoMs: outcome.elapsedMs,
        requestsTCGdex: outcome.catalogRequests,
        erro: outcome.error,
        top5: outcome.candidates.slice(0, 5).map(candidate => ({
          rank: (candidate as typeof candidate & { retrievalRank?: number }).retrievalRank,
          nome: candidate.name,
          numero: candidate.cardNumber,
          colecao: candidate.collection,
          id: candidate.id,
          similaridadeVisual: candidate.visualSimilarity,
        })),
        observacao: "Este é o mesmo retriever Milo usado pela identificação v10. A descoberta Top-K é visual e independente do nome OCR.",
      }, null, 2));
    } catch (error) {
      setMessage(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTesting(false);
    }
  }

  const global = v10?.globalVisual;
  const status = !result
    ? "IA v10/Milo: aguardando reconhecimento"
    : global?.status === "compared"
      ? `IA v10/Milo: executada (${global.backend ?? "backend não informado"}) · ${global.indexCandidates?.toLocaleString("pt-BR") ?? "?"} impressões pesquisadas`
      : global?.status === "failed"
        ? `IA v10/Milo: falhou — ${global.error ?? "veja os detalhes"}`
        : "IA v10/Milo: sem diagnóstico neste resultado (resultado antigo/cache anterior ou fluxo ainda não atualizado)";

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
    <button type="button" className="secondary" disabled={testing || busy} onClick={() => void testMilo()}>{testing ? "Testando IA v10/Milo…" : "Testar IA v10/Milo"}</button>
    <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{message}</pre>
    <details><summary>Detalhes do reconhecimento v10</summary>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify({
        runtime: cardRecognitionRuntime,
        decisao: v10?.decisionStatus,
        evidenciasIndependentes: v10?.independentEvidence,
        normalizacao: v10?.normalization,
        Milo: v10?.globalVisual,
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
          cache: result?.source === "cache",
        },
        dinoLegacy: {
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