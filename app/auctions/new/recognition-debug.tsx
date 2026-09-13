"use client";
import { useState } from "react";
import type { RecognitionCandidate, RecognitionResult } from "@/lib/card-recognition-core";
import { recognizeVisually, type VisualTestBackend } from "@/lib/card-recognition-visual";

export default function RecognitionDebug({ file, result, busy }: { file: File; result?: RecognitionResult; busy: boolean }) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [backend, setBackend] = useState<VisualTestBackend>("auto");
  async function testLocalAI() {
    setTesting(true);
    setMessage("Preparando teste local…");
    try {
      let reference = result?.visualCandidatePool?.find(c => c.image);
      let testRequests = 0;
      if (!reference) {
        // Diagnostic reference only. Never saved to the draft or used as detected data.
        const response = await fetch("https://api.tcgdex.net/v2/en/cards?pagination:page=1&pagination:itemsPerPage=1", { credentials: "omit", signal: AbortSignal.timeout(8000) });
        testRequests++;
        if (!response.ok) throw new Error(`Referência oficial: HTTP ${response.status}`);
        const cards = await response.json();
        if (!cards[0]?.image) throw new Error("Catálogo não forneceu imagem oficial para o teste");
        reference = { id: cards[0].id, name: cards[0].name, image: cards[0].image } as RecognitionCandidate;
      }
      const outcome = await recognizeVisually(file, [reference], setMessage, backend);
      setMessage(JSON.stringify({ teste: outcome.used ? "PASS" : "FAIL", backend: outcome.backend,
        erro: outcome.error, modelo: "onnx-community/dinov2-small-ONNX", inicializacaoMs: outcome.initMs,
        similaridades: outcome.similarities, referencia: reference.image, consultasSomenteDoTeste: testRequests,
        observacao: "Testa embeddings e cosseno; não identifica nem altera a carta." }, null, 2));
    } catch (error) { setMessage(`FAIL: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setTesting(false); }
  }
  const status = !result ? "IA local: aguardando reconhecimento" : result.visualUsed
    ? `IA local: comparação executada (${result.visualBackend ?? "backend não informado"})`
    : result.visualStatus === "failed" ? "IA local: falhou — veja os detalhes abaixo"
    : `IA local: não executada — ${result.visualReason ?? "sem candidatos suficientes"}`;
  return <section className="wide">
    <p role="status">{status}</p>
    <button type="button" className="secondary" disabled={testing || busy} onClick={() => void testLocalAI()}>{testing ? "Testando IA local…" : "Testar IA local"}</button>
    <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{message}</pre>
    <details><summary>Detalhes do reconhecimento e opções do teste</summary>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify({
      OCR: { nome: result?.hints.name ?? "", numero: result?.hints.cardNumber ?? "", idioma: result?.hints.language ?? null },
      catalogo: { requests: result?.catalogRequests, antesDoFiltro: result?.catalogCandidatesBefore, depoisDoFiltro: result?.catalogCandidatesAfter, limiteAtingido: result?.catalogBudgetExhausted, cache: result?.source === "cache" },
      visual: { acionada: result?.visualUsed ?? false, estado: result?.visualStatus ?? "aguardando", motivo: result?.visualReason,
        backend: result?.visualBackend, erro: result?.visualError, candidatos: result?.visualCandidateCount, similaridades: result?.visualSimilarities, inicializacaoMs: result?.visualInitMs },
    }, null, 2)}</pre>
    <label>Backend do teste<select value={backend} onChange={e => setBackend(e.target.value as VisualTestBackend)} disabled={testing}>
      <option value="auto">Automático</option><option value="webgpu/q4">WebGPU/q4</option><option value="wasm/q4">WASM/q4</option><option value="wasm/int8">WASM/int8</option>
    </select></label>
  </details></section>;
}
