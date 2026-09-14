import type { RecognitionCandidate, RecognitionLanguage } from "./card-recognition-core";

const TCGDEX_BASE = "https://api.tcgdex.net/v2";
const MAX_VISUAL_CANDIDATES = 100;
const VISUAL_CATALOG_TIMEOUT_MS = 8_000;

// Fixed diagnostic fixture documented by TCGdex; never enters recognition/ranking.
// https://tcgdex.dev/rest/filtering-sorting-pagination
export function visualDiagnosticReference(pool: RecognitionCandidate[] = []): RecognitionCandidate {
  const existing = pool.find(candidate => candidate.image?.startsWith("https://assets.tcgdex.net/"));
  return existing ?? {
    id: "diagnostic-basep-1", name: "Referência de teste", image: "https://assets.tcgdex.net/en/base/basep/1",
    collection: "", cardNumber: "", localId: "", denominator: null, language: "en", hp: null, score: 0,
  };
}

export type VisualReply = {
  similarities: number[];
  backend: string;
  winnerIndex?: number;
  initMs?: number;
  embeddingDimension?: number;
  embeddingOutput?: string;
};
export type VisualOutcome = {
  candidates: RecognitionCandidate[];
  used: boolean;
  status: "not-needed" | "no-candidates" | "insufficient-clues" | "compared" | "failed";
  reason?: string;
  error?: string;
  backend?: string;
  similarities?: number[];
  initMs?: number;
  embeddingDimension?: number;
  embeddingOutput?: string;
};
export type VisualTestBackend = "auto" | "webgpu/q4" | "wasm/q4" | "wasm/int8";

export function recognitionDebugEnabled() {
  return typeof window !== "undefined" &&
    (process.env.NODE_ENV === "development" || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) &&
    new URLSearchParams(window.location.search).get("recognitionDebug") === "1";
}

function candidateHasVisualClue(candidate: RecognitionCandidate) {
  return Boolean(candidate.image && candidate.evidence && (
    candidate.evidence.localIdMatch ||
    candidate.evidence.nameSimilarity >= 0.55 ||
    (candidate.evidence.denominatorMatch && candidate.evidence.localIdSimilarity >= 0.66)
  ));
}

export function needsVisualFallback(candidates: RecognitionCandidate[]) {
  const plausible = candidates.filter(candidateHasVisualClue);
  if (!plausible.length || plausible.length > MAX_VISUAL_CANDIDATES) return false;
  const [best, second] = plausible;
  if (best.evidence?.fullNumberMatch && best.evidence.nameSimilarity >= 0.9 && (!second || best.score - second.score >= 8)) return false;
  // A single name/local-id candidate is still useful: the visual layer expands it to every
  // physical printing with the same Pokémon name before comparing artwork.
  return true;
}

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9♀♂]+/g, " ").trim();
}

function tcgLanguage(language: RecognitionLanguage) {
  return language === "pt-BR" ? "pt" : language;
}

function lightweightEvidence(nameSimilarity: number) {
  return {
    fullNumberMatch: false,
    localIdMatch: false,
    denominatorMatch: false,
    localIdSimilarity: 0,
    nameSimilarity,
    languageMatch: false,
    hpMatch: false,
    strongEvidence: false,
  };
}

type TcgBrief = { id: string; localId?: string | number; name?: string; image?: string | null };
type TcgDetail = {
  id: string;
  localId: string | number;
  name: string;
  image?: string | null;
  hp?: number | null;
  variants?: Record<string, unknown>;
  set?: { name?: string; cardCount?: { official?: number; total?: number } };
};

async function visualFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
    signal: AbortSignal.timeout(VISUAL_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TCGdex visual lookup HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function sameCandidate(a: RecognitionCandidate, b: RecognitionCandidate) {
  return a.id === b.id && a.language === b.language;
}

async function expandSameNamePrintings(candidates: RecognitionCandidate[]) {
  if (typeof window === "undefined") return candidates;
  const anchor = candidates
    .filter(candidate => candidate.image && normalizedName(candidate.name).length >= 3)
    .sort((a, b) => (b.evidence?.nameSimilarity ?? 0) - (a.evidence?.nameSimilarity ?? 0))[0];
  if (!anchor) return candidates;

  const target = normalizedName(anchor.name);
  const languages = [...new Set(candidates.map(candidate => candidate.language))].slice(0, 2);
  const expanded = [...candidates];

  for (const language of languages) {
    if (expanded.length >= MAX_VISUAL_CANDIDATES) break;
    const code = tcgLanguage(language);
    try {
      const params = new URLSearchParams({
        name: anchor.name,
        image: "notlike:/tcgp/",
        "pagination:page": "1",
        "pagination:itemsPerPage": "100",
      });
      const briefs = await visualFetch<TcgBrief[]>(`${TCGDEX_BASE}/${code}/cards?${params.toString()}`);
      for (const brief of briefs) {
        if (expanded.length >= MAX_VISUAL_CANDIDATES) break;
        if (!brief.id || !brief.name || !brief.image || brief.image.includes("/tcgp/") || normalizedName(brief.name) !== target) continue;
        const localId = String(brief.localId ?? "");
        const candidate: RecognitionCandidate = {
          id: brief.id,
          name: brief.name,
          collection: "",
          cardNumber: localId,
          localId,
          denominator: null,
          language,
          hp: null,
          image: brief.image,
          score: Math.max(45, anchor.score - 5),
          evidence: lightweightEvidence(1),
        };
        if (!expanded.some(existing => sameCandidate(existing, candidate))) expanded.push(candidate);
      }
    } catch {
      // Expansion is optional; original catalog shortlist remains usable offline.
    }
  }
  return expanded;
}

function safeVariant(variants: Record<string, unknown> | undefined) {
  if (!variants) return undefined;
  const values = [["normal", "Normal"], ["holo", "Holo"], ["reverse", "Reverse Holo"]] as const;
  const available = values.filter(([key]) => variants[key] === true).map(([, label]) => label);
  return available.length === 1 ? available[0] : undefined;
}

async function hydrateVisualWinner(candidate: RecognitionCandidate) {
  if (candidate.collection && candidate.denominator) return candidate;
  const code = tcgLanguage(candidate.language);
  try {
    const card = await visualFetch<TcgDetail>(`${TCGDEX_BASE}/${code}/cards/${encodeURIComponent(candidate.id)}`);
    const denominator = Number(card.set?.cardCount?.official ?? card.set?.cardCount?.total ?? 0) || null;
    const localId = String(card.localId ?? candidate.localId);
    return {
      ...candidate,
      name: card.name || candidate.name,
      collection: card.set?.name || candidate.collection,
      cardNumber: denominator ? `${localId}/${denominator}` : localId,
      localId,
      denominator,
      hp: card.hp == null ? candidate.hp : Number(card.hp),
      image: card.image ?? candidate.image,
      variant: safeVariant(card.variants) ?? candidate.variant,
    };
  } catch {
    return null;
  }
}

// Worker decides whether the visual evidence is decisive. The UI layer never treats raw
// cosine/perceptual similarity as a calibrated probability.
export function applyVisualEvidence(candidates: RecognitionCandidate[], similarities: number[], winnerIndex?: number) {
  if (similarities.length !== candidates.length || similarities.some(n => !Number.isFinite(n))) return candidates;
  const visual = candidates.map((candidate, index) => ({ ...candidate, visualSimilarity: similarities[index] }));
  if (Number.isInteger(winnerIndex) && winnerIndex! >= 0 && winnerIndex! < visual.length) {
    visual[winnerIndex!] = {
      ...visual[winnerIndex!],
      evidence: { ...visual[winnerIndex!].evidence!, visualMatch: true, strongEvidence: true },
    };
    return [...visual].sort((a, b) => Number(Boolean(b.evidence?.visualMatch)) - Number(Boolean(a.evidence?.visualMatch)) || b.visualSimilarity! - a.visualSimilarity!);
  }

  // Compatibility fallback for mocked/older workers.
  const ordered = [...visual].sort((a, b) => b.visualSimilarity! - a.visualSimilarity!);
  if (ordered.length >= 2 && ordered[0].visualSimilarity! >= 0.85 && ordered[0].visualSimilarity! - ordered[1].visualSimilarity! >= 0.08) {
    ordered[0] = { ...ordered[0], evidence: { ...ordered[0].evidence!, visualMatch: true, strongEvidence: true } };
  }
  return ordered;
}

// Factory keeps the worker lazy and allows behavior tests without downloading model weights.
export function createVisualFallback(createWorker: () => Worker, idleMs = 120_000, timeoutMs = 90_000) {
  let worker: Worker | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let rejectActive: ((error: Error) => void) | undefined;
  let disabledUntil = 0;
  let lastError = "";
  const dispose = () => {
    clearTimeout(idle);
    worker?.terminate();
    worker = null;
    rejectActive?.(new Error("Visual recognition stopped"));
    rejectActive = undefined;
  };
  const recognize = (photo: Blob, candidates: RecognitionCandidate[], onProgress?: (message: string) => void, testBackend?: VisualTestBackend) => {
    const run = async (): Promise<VisualOutcome> => {
      const forced = testBackend !== undefined && typeof window !== "undefined";
      if (!forced && !needsVisualFallback(candidates)) return {
        candidates,
        used: false,
        status: candidates.length ? "not-needed" : "no-candidates",
        reason: candidates.length ? "OCR/banco já inequívocos ou shortlist sem imagem" : "Nenhum candidato visual plausível",
      };
      if (!forced && Date.now() < disabledUntil) return { candidates, used: false, status: "failed", error: lastError, reason: "Nova tentativa suspensa temporariamente após falha" };
      clearTimeout(idle);
      try {
        const expanded = forced ? candidates : await expandSameNamePrintings(candidates);
        if (!forced && expanded.length < 2) return { candidates: expanded, used: false, status: "no-candidates", reason: "Menos de duas impressões oficiais comparáveis" };
        onProgress?.(forced ? "🧠 Testando IA local…" : `🖼 Comparando ${expanded.length} impressões oficiais…`);
        worker ??= createWorker();
        const reply = await new Promise<VisualReply>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Visual recognition timed out")), timeoutMs);
          const finish = (error?: Error, result?: VisualReply) => {
            clearTimeout(timer);
            rejectActive = undefined;
            if (error) reject(error); else resolve(result!);
          };
          rejectActive = error => finish(error);
          worker!.onmessage = event => {
            if (event.data.progress) { onProgress?.(event.data.progress); return; }
            event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data);
          };
          worker!.onerror = event => finish(new Error(event.message || "Não foi possível iniciar o worker visual"));
          worker!.postMessage({ photo, images: expanded.map(c => c.image), diagnostic: forced, testBackend: forced ? testBackend : undefined });
        });
        if (reply.similarities.length !== expanded.length || reply.similarities.some(n => !Number.isFinite(n))) throw new Error("Comparação visual inválida");
        let compared = forced ? expanded : applyVisualEvidence(expanded, reply.similarities, reply.winnerIndex);
        if (!forced) {
          const index = compared.findIndex(candidate => candidate.evidence?.visualMatch);
          if (index >= 0 && !compared[index].collection) {
            const hydrated = await hydrateVisualWinner(compared[index]);
            if (hydrated) compared[index] = hydrated;
            else compared[index] = { ...compared[index], evidence: { ...compared[index].evidence!, visualMatch: false, strongEvidence: false } };
          }
        }
        return {
          candidates: compared,
          used: true,
          status: "compared",
          backend: reply.backend,
          similarities: reply.similarities,
          initMs: reply.initMs,
          embeddingDimension: reply.embeddingDimension,
          embeddingOutput: reply.embeddingOutput,
          reason: reply.winnerIndex == null
            ? `Comparação concluída entre ${expanded.length} impressões; sem vencedor visual seguro`
            : `Impressão exata confirmada entre ${expanded.length} candidatas`,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        dispose();
        disabledUntil = Date.now() + idleMs;
        return { candidates, used: false, status: "failed", error: lastError, reason: "Comparação visual/worker indisponível" };
      } finally {
        if (worker) idle = setTimeout(dispose, idleMs);
      }
    };
    const queued = tail.then(run, run);
    tail = queued.then(() => undefined, () => undefined);
    return queued;
  };
  return { recognize, dispose };
}

const visual = createVisualFallback(() => new Worker(new URL("./card-recognition-visual.worker.ts", import.meta.url), { type: "module" }));
export const recognizeVisually = visual.recognize;
export const shutdownVisualRecognition = visual.dispose;
