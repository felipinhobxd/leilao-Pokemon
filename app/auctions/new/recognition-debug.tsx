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
  evidenceRanking?: unknown;
};

// The inspector preview is capped at this size: it exists for a human to
// CONFIRM what was sent, and a ~1000 px JPEG is plenty for that. Rendering
// the original 12 MP photo here (per expanded card!) was one of the causes
// of the reported full-page freeze — 20-50 of those decode hundreds of
// millions of pixels during paint.
const INSPECTOR_MAX_SIDE = 1000;

async function makeInspectorPreview(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, INSPECTOR_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) { bitmap.close(); return URL.createObjectURL(file); }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return URL.createObjectURL(file); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    canvas.width = canvas.height = 0;
    return blob ? URL.createObjectURL(blob) : URL.createObjectURL(file);
  } catch {
    return URL.createObjectURL(file);
  }
}

/** JSON details computed ONLY when the user opens the <details> block.
 * Stringifying the full recognition payload (10 candidates with verification
 * dictionaries) on EVERY wizard render × every expanded card kept the main
 * thread busy for hundreds of ms per render — the page could not be clicked. */
function LazyDetails({ payload }: { payload: () => unknown }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <details onToggle={event => {
      if ((event.target as HTMLDetailsElement).open && text === null) setText(JSON.stringify(payload(), null, 2));
    }}>
      <summary>Detalhes do reconhecimento</summary>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{text ?? ""}</pre>
    </details>
  );
}

export default function RecognitionDebug({ file, result, busy }: { file: File; result?: RecognitionResult; busy: boolean }) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const v11 = result as V11DebugResult | undefined;

  useEffect(() => {
    let cancelled = false;
    let url = "";
    void makeInspectorPreview(file).then(created => {
      if (cancelled) { URL.revokeObjectURL(created); return; }
      url = created;
      setPreview(created);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  async function testExactVisual() {
    setTesting(true);
    setMessage("🖼 Normalizando a foto para comparar com as imagens oficiais…");
    try {
      const normalized = await normalizeCardPhoto(file, setMessage);
      const candidates = result?.candidates?.filter(candidate => Boolean(candidate.image)).slice(0, 12) ?? [];
      if (!candidates.length) throw new Error("O reconhecimento ainda não gerou candidatos com imagem oficial.");
      const outcome = await recognizeVisually(normalized.blob, candidates, setMessage, "structural");
      setMessage(JSON.stringify({
        teste: outcome.status === "compared" ? "PASS" : "FAIL",
        rankingEvidencias: v11?.evidenceRanking,
        confiancaPorCampo: { nome: result?.hints.nameConfidence, numero: result?.hints.numberConfidence, hp: result?.hints.hpConfidence },
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
    {preview && <div className="recognition-large-preview"><img src={preview} alt="Prévia ampliada da carta para conferência" loading="lazy" decoding="async" /><small>A análise usa o arquivo original em alta resolução; esta prévia ampliada é para você conferir o que foi enviado.</small></div>}
    <div className="recognition-breakdown" aria-label="Etapas do reconhecimento">
      {fieldRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <p role="status"><strong>Runtime: reconhecimento v{cardRecognitionRuntime.version}</strong><br />{status}</p>
    <button type="button" className="secondary" disabled={testing || busy} onClick={() => void testExactVisual()}>{testing ? "Comparando scans oficiais…" : "Testar comparação visual exata"}</button>
    <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{message}</pre>
    <LazyDetails payload={() => ({
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
    })} />
  </section>;
}
