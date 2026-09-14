"use client";
import { useEffect, useState } from "react";
import type { RecognitionResult } from "@/lib/card-recognition-core";
import { recognizeVisually, visualDiagnosticReference, type VisualTestBackend } from "@/lib/card-recognition-visual";

export default function RecognitionDebug({ file, result, busy }: { file: File; result?: RecognitionResult; busy: boolean }) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [backend, setBackend] = useState<VisualTestBackend>("auto");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function testLocalAI() {
    setTesting(true);
    setMessage("Preparando teste local…");
    try {
      const reference = visualDiagnosticReference(result?.visualCandidatePool);
      const outcome = await recognizeVisually(file, [reference], setMessage, backend);
      setMessage(JSON.stringify({ teste: outcome.used ? "PASS" : "FAIL", backend: outcome.backend,
        erro: outcome.error, modelo: "DINOv2-base q4 no WebGPU; DINOv2-small q4/int8 no fallback WASM",
        inicializacaoMs: outcome.initMs, dimensaoEmbedding: outcome.embeddingDimension, saidaModelo: outcome.embeddingOutput,
        similaridades: outcome.similarities, referencia: reference.image, consultasSomenteDoTeste: 0,
        observacao: "Teste técnico de embeddings; a identificação real combina OCR, TCGdex e comparação da impressão." }, null, 2));
    } catch (error) { setMessage(`FAIL: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setTesting(false); }
  }

  const status = !result ? "IA local: aguardando reconhecimento" : result.visualUsed
    ? `IA local: comparação executada (${result.visualBackend ?? "backend não informado"})`
    : result.visualStatus === "failed" ? "IA local: falhou — veja os detalhes abaixo"
    : `IA local: não executada — ${result.visualReason ?? "sem candidatos suficientes"}`;

  const candidate = result?.candidates?.[0];
  const fieldRows = [
    ["1. Nome", result?.hints.name || candidate?.name || "Ainda não lido"],
    ["2. Número", result?.hints.cardNumber || candidate?.cardNumber || "Ainda não lido"],
    ["3. Coleção / edição", candidate?.collection || "Aguardando número + TCGdex"],
    ["4. Idioma", result?.hints.language ? `${result.hints.language} (${result.hints.languageConfidence}%)` : "Ainda não confirmado"],
  ];

  return <section className="wide recognition-inspector">
    {preview && <div className="recognition-large-preview"><img src={preview} alt="Prévia ampliada da carta para conferência" /><small>A análise usa o arquivo original em alta resolução; esta prévia ampliada é para você conferir o que foi enviado.</small></div>}
    <div className="recognition-breakdown" aria-label="Etapas do reconhecimento">
      {fieldRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <p role="status">{status}</p>
    <button type="button" className="secondary" disabled={testing || busy} onClick={() => void testLocalAI()}>{testing ? "Testando IA local…" : "Testar IA local"}</button>
    <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{message}</pre>
    <details><summary>Detalhes do reconhecimento e opções do teste</summary>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify({
      OCR: { nome: result?.hints.name ?? "", numero: result?.hints.cardNumber ?? "", localId: result?.hints.localId ?? "", denominador: result?.hints.denominator ?? null, idioma: result?.hints.language ?? null, confiancaIdioma: result?.hints.languageConfidence ?? 0 },
      catalogo: { estrategia: result?.catalogStrategy, setsCandidatos: result?.catalogSetCandidates, origemIndiceSets: result?.catalogSetIndexSource,
        requests: result?.catalogRequests, consultas: result?.catalogQueries, antesDoFiltro: result?.catalogCandidatesBefore, depoisDoFiltro: result?.catalogCandidatesAfter,
        limiteAtingido: result?.catalogBudgetExhausted, cache: result?.source === "cache" },
      visual: { acionada: result?.visualUsed ?? false, estado: result?.visualStatus ?? "aguardando", motivo: result?.visualReason,
        backend: result?.visualBackend, erro: result?.visualError, candidatos: result?.visualCandidateCount, similaridades: result?.visualSimilarities, inicializacaoMs: result?.visualInitMs },
    }, null, 2)}</pre>
    <label>Backend do teste<select value={backend} onChange={e => setBackend(e.target.value as VisualTestBackend)} disabled={testing}>
      <option value="auto">Automático (recomendado)</option><option value="webgpu/q4">WebGPU/q4</option><option value="wasm/q4">WASM/q4</option><option value="wasm/int8">WASM/int8</option>
    </select></label>
  </details></section>;
}
