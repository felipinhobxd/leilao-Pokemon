"use client";

import Link from "next/link";
import RecognitionDebug from "./recognition-debug";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { buildCustomValuesPlan, buildPollPlan, cardConditions, cardLanguages, DEFAULT_POLL_OPTIONS, GIVEAWAY_DEFAULT_OPTIONS, MAX_POLL_OPTIONS, parseCustomValues } from "@/lib/auction-wizard";
import { brasiliaInputToIso, formatBrasiliaDateTime, formatBrasiliaTime, toBrasiliaInput } from "@/lib/brasilia-time";
import { uploadCardImageBatch, type CardImageStage, type CardImageUploadFailure } from "@/lib/card-image";
import { AUCTION_DRAFT_MAX_BYTES, auctionDraftJson, buildDraftState, buildDraftTitle, restoreDraftState, type AuctionDraftCandidate } from "@/lib/auction-draft";
import { mergeRecognitionFields, type ManualFieldMap, type RecognitionCandidate, type RecognitionResult, type RecognizableField } from "@/lib/card-recognition-core";
import { confirmRecognitionMemory, recognizePokemonCard, shutdownCardRecognition, imageRecognitionEnabled, imageRecognitionPreferenceEvent } from "@/lib/card-recognition-local";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; is_default: boolean };
type RecognitionStage = "idle" | "queued" | "analyzing" | "identified" | "review" | "not-found" | "error" | "unavailable";
type Draft = {
  id: string; file: File | null; preview: string; imageUrl: string; imageStage: CardImageStage; imageMessage: string;
  extraFiles: File[]; extraImages: string[]; extraPreviews: string[];
  name: string; collection: string; cardNumber: string; variant: string; condition: string; language: string;
  pricingMode: "increment" | "custom"; customValues: string; customBuyoutLast: boolean;
  giveaway: boolean; giveawayOptions: string;
  lotNumber: string; startingPrice: string; increment: string; buyout: string; durationMinutes: string; optionCount: string; expanded: boolean;
  recognitionResult?: RecognitionResult;
  recognitionStage: RecognitionStage; recognitionConfidence: number | null; recognitionMessage: string; recognitionCandidates: RecognitionCandidate[]; manualFields: ManualFieldMap;
};
type QueueView = {
  queue: { id: string; status: string; interval_seconds: number; starts_at: string; total_items: number };
  group: { id: string; name: string } | null;
  summary: { total: number; published: number; failed: number; pending: number; nextScheduledAt: string | null };
  items: Array<{
    dispatch: { id: string; status: string; scheduled_at: string; sent_at: string | null; attempts: number; last_error: string | null; queue_position: number } | null;
    auction: { id: string; lot_number: number; status: string; scheduled_end_at: string | null; final_price: number | null; win_type: string | null } | null;
    card: { id: string; name: string; image_url: string | null } | null;
    poll: { id: string; title: string; image_url: string | null; scheduled_at: string; sent_at: string | null; queue_position: number } | null;
  }>;
};

type DraftSummary = { id: string; title: string; updated_at: string };

const variants = ["Normal", "Holo", "Reverse Holo", "Full Art", "Illustration Rare", "Secret Rare", "Promo"];
// Idioma aceito pelo dropdown do wizard (cardLanguages é a fonte da API):
// qualquer outro valor (ex.: "es" do catálogo de texto) vira "Outro".
const wizardLanguage = (value: string | undefined) =>
  cardLanguages.some(item => item.value === value) ? (value as Draft["language"]) : "other";
const recognizableFields = new Set<RecognizableField>(["name", "collection", "cardNumber", "language", "variant"]);
const money = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const defaultSchedule = () => toBrasiliaInput(new Date(Date.now() + 5 * 60_000));

// Wizard previews are DOWNSCALED to this size before entering the DOM. Phone
// photos are 12 MP+; rendering 20-50 of them at full size forces the main
// thread to decode hundreds of millions of pixels (the reported "UI freezes
// during/after recognition"). A ~560 px JPEG is visually identical in the
// thumbnail/large-preview slots and decodes ~50x cheaper. Uploads still use
// the ORIGINAL card.file.
const PREVIEW_MAX_SIDE = 560;

async function makePreviewUrl(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
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
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
    canvas.width = canvas.height = 0;
    return blob ? URL.createObjectURL(blob) : URL.createObjectURL(file);
  } catch {
    return URL.createObjectURL(file);
  }
}

function draftFor(file: File | null, preview: string, lot: number, expanded: boolean): Draft {
  return {
    id: crypto.randomUUID(), file, preview, imageUrl: "", imageStage: "idle", imageMessage: file ? "Aguardando otimização" : "",
    extraFiles: [], extraImages: [], extraPreviews: [],
    name: "", collection: "", cardNumber: "",
    pricingMode: "increment", customValues: "", customBuyoutLast: true,
    giveaway: false, giveawayOptions: GIVEAWAY_DEFAULT_OPTIONS,
    variant: "Normal", condition: cardConditions[0], language: "pt-BR", lotNumber: String(lot), startingPrice: "5", increment: "1",
    buyout: "", durationMinutes: "2", optionCount: String(DEFAULT_POLL_OPTIONS), expanded,
    recognitionStage: file ? "idle" : "unavailable", recognitionConfidence: null, recognitionMessage: file ? "Aguardando reconhecimento local" : "Adicione uma imagem para reconhecer", recognitionCandidates: [], manualFields: {},
  };
}

function recognitionLabel(card: Draft) {
  const localPipeline = (card.recognitionResult as { localPipeline?: { languageStatus?: string } } | undefined)?.localPipeline;
  const uncertainLanguage = localPipeline?.languageStatus === "uncertain";
  // Impressão pt-BR anterior a 2011 (Devir): o catálogo só tem a gêmea EN —
  // identidade correta, entrada em inglês por construção do catálogo.
  const devirPtPre2011 = localPipeline?.languageStatus === "pt-br-pre-2011";
  if (card.recognitionStage === "not-found" && (card.recognitionResult as { decisionStatus?: string } | undefined)?.decisionStatus === "REVISAR") return "🔎 Evidências insuficientes ou conflitantes · revisar";
  if (card.recognitionStage === "identified") return card.recognitionMessage === "Candidato escolhido manualmente" ? "✅ Carta escolhida manualmente"
    : devirPtPre2011 ? "✅ Carta identificada · impressão pt-BR pré-2011 (catálogo tem a versão EN)"
    : uncertainLanguage ? `✅ Carta identificada · ${card.language} (idioma incerto — revise)` : "✅ Carta identificada";
  if (card.recognitionStage === "review") return devirPtPre2011 ? "🟡 Carta provável · impressão pt-BR pré-2011 (catálogo tem a versão EN)"
    : uncertainLanguage ? `🟡 Carta provável · ${card.language} (idioma incerto — revise)` : "🟡 Carta provável · verifique os dados";
  if (card.recognitionStage === "not-found") return "🔴 Não consegui identificar com segurança";
  if (card.recognitionStage === "error") return "⚠ Reconhecimento indisponível";
  if (card.recognitionStage === "queued") return "🔍 Na fila de reconhecimento…";
  if (card.recognitionStage === "analyzing") return `🔍 ${card.recognitionMessage || "Analisando localmente…"}`;
  return card.recognitionMessage;
}

// Rascunho restaurado não tem o File local: os candidatos vêm pelo payload —
// normalizados de volta para a forma completa de RecognitionCandidate
// (hp/image são metadados de exibição que os botões de candidato não usam).
function draftCandidates(list: AuctionDraftCandidate[]): RecognitionCandidate[] {
  return list.map(candidate => ({
    id: candidate.id, name: candidate.name, collection: candidate.collection, cardNumber: candidate.cardNumber,
    localId: candidate.localId, denominator: candidate.denominator,
    language: candidate.language as RecognitionCandidate["language"],
    hp: null, image: null, variant: candidate.variant ?? undefined, score: candidate.score,
  }));
}

export default function BulkAuctionWizard() {
  const [db] = useState(createPublicSupabaseClient);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [suggestedLot, setSuggestedLot] = useState(1);
  const [firstLot, setFirstLot] = useState("1");
  const [cards, setCards] = useState<Draft[]>([]);
  const [step, setStep] = useState(1);
  const [groupId, setGroupId] = useState("");
  const [intervalValue, setIntervalValue] = useState("30");
  const [intervalUnit, setIntervalUnit] = useState<"seconds" | "minutes">("seconds");
  const [publication, setPublication] = useState<"now" | "scheduled">("now");
  const [scheduledInput, setScheduledInput] = useState(defaultSchedule);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [queueView, setQueueView] = useState<QueueView | null>(null);
  const [bulkLanguage, setBulkLanguage] = useState("pt-BR");
  const [bulkCondition, setBulkCondition] = useState<string>(cardConditions[0]);
  const [bulkStart, setBulkStart] = useState("5");
  const [bulkIncrement, setBulkIncrement] = useState("1");
  const [bulkDuration, setBulkDuration] = useState("2");
  const [bulkCustomValues, setBulkCustomValues] = useState("");
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const previewUrls = useRef(new Set<string>());
  const recognitionInFlight = useRef(new Set<string>());
  const submission = useRef<{ fingerprint: string; eventId: string } | null>(null);

  async function authFetch(url: string, init?: RequestInit) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("Entre novamente no painel.");
    return fetch(url, { ...init, cache: "no-store", headers: { ...init?.headers, Authorization: `Bearer ${data.session.access_token}` } });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await db.auth.getSession();
      if (cancelled) return;
      setSession(data.session); setReady(true);
      if (!data.session) return;
      const response = await authFetch("/api/auctions/new");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível preparar os leilões.");
      const lot = Number(body.suggestedLotNumber ?? 1);
      setSuggestedLot(lot); setFirstLot(String(lot)); setGroups(body.groups ?? []);
      setGroupId(body.defaultGroupId ?? body.groups?.[0]?.id ?? "");
      // Rascunhos carregam ANTES do possível redirecionamento para a fila —
      // o painel "Rascunhos salvos" precisa existir mesmo com fila ativa (o
      // botão "Novo leilão" da tela da fila volta para este wizard).
      try {
        const draftsResponse = await authFetch("/api/auctions/drafts");
        if (draftsResponse.ok) {
          const draftsBody = await draftsResponse.json();
          if (Array.isArray(draftsBody.drafts)) setDrafts(draftsBody.drafts);
        }
      } catch { /* rascunhos são complemento: nunca bloqueiam o boot */ }
      const explicit = new URLSearchParams(window.location.search).get("queue");
      if (explicit) { setQueueId(explicit); return; }
      const latestResponse = await authFetch("/api/auctions/queue?latest=1");
      if (!latestResponse.ok) return;
      const latest = await latestResponse.json();
      if (latest?.queue?.id) {
        setQueueId(String(latest.queue.id));
        window.history.replaceState(null, "", `/auctions/new?queue=${encodeURIComponent(String(latest.queue.id))}`);
      }
    })().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Falha ao carregar."); });
    return () => { cancelled = true; };
  }, [db]);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
    void shutdownCardRecognition();
  }, []);

  useEffect(() => {
    if (!queueId) return;
    let stopped = false;
    const load = async () => {
      try {
        const response = await authFetch(`/api/auctions/queue?queueId=${encodeURIComponent(queueId)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Falha ao atualizar a fila.");
        if (!stopped) setQueueView(body as QueueView);
      } catch (reason) { if (!stopped) setError(reason instanceof Error ? reason.message : "Falha ao atualizar a fila."); }
    };
    void load(); const timer = setInterval(() => void load(), 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [queueId]);

  const intervalSeconds = useMemo(() => {
    const value = Number(intervalValue);
    return Number.isFinite(value) ? Math.round(value * (intervalUnit === "minutes" ? 60 : 1)) : 0;
  }, [intervalValue, intervalUnit]);
  const startInstant = useMemo(() => publication === "now" ? new Date() : (() => { const iso = brasiliaInputToIso(scheduledInput); return iso ? new Date(iso) : null; })(), [publication, scheduledInput]);

  function mutateCard(id: string, patch: Partial<Draft>, markManual = true) {
    submission.current = null;
    setCards(current => current.map(card => {
      if (card.id !== id) return card;
      const manualFields = { ...card.manualFields };
      if (markManual) for (const key of Object.keys(patch)) if (recognizableFields.has(key as RecognizableField)) manualFields[key as RecognizableField] = true;
      return { ...card, ...patch, manualFields };
    }));
  }
  function applyAll<K extends keyof Draft>(key: K, value: Draft[K]) {
    submission.current = null;
    setCards(current => current.map(card => ({
      ...card,
      [key]: value,
      manualFields: recognizableFields.has(key as RecognizableField) ? { ...card.manualFields, [key]: true } : card.manualFields,
    })));
  }

  async function identifyCard(id: string, file: File, force = false, retry = false) {
    if (recognitionInFlight.current.has(id)) return;
    // Recognition disabled: ZERO recognition work — no identifyCard, no health
    // probe, no local service call, no browser fallback, no not-found state.
    // The image is simply kept as uploaded.
    if (!imageRecognitionEnabled()) return;
    recognitionInFlight.current.add(id);
    setCards(current => current.map(card => card.id === id ? { ...card, recognitionStage: "queued", recognitionMessage: "Na fila de reconhecimento…" } : card));
    const preferredLanguage = cards.find(card => card.id === id)?.language;
    // Progress messages can fire several times per second per card; each one
    // re-renders the ENTIRE wizard (every card, every input). Throttling the
    // UI updates to ~6/s keeps React's render queue from saturating the main
    // thread while recognition itself is unaffected (it runs off-thread).
    let lastPaint = 0;
    const paint = (message: string) => {
      const now = Date.now();
      if (now - lastPaint < 160) return;
      lastPaint = now;
      setCards(current => current.map(card => card.id === id ? { ...card, recognitionStage: "analyzing", recognitionMessage: message } : card));
    };
    try {
      const result = await recognizePokemonCard(file, preferredLanguage, paint, { bypassCache: retry });
      // Disabled while this request was running: drop the result silently
      // instead of marking a not-found the user never asked for.
      if (!imageRecognitionEnabled()) {
        setCards(current => current.map(card => card.id === id ? { ...card, recognitionStage: "idle", recognitionMessage: "Reconhecimento de imagens está desligado" } : card));
        return;
      }
      setCards(current => current.map(card => {
        if (card.id !== id) return card;
        const recognized = mergeRecognitionFields(card as unknown as Record<string, unknown>, card.manualFields, result, force) as Partial<Draft>;
        // Preenchimento automático respeita os idiomas do dropdown (es → Outro).
        if (recognized.language) recognized.language = wizardLanguage(recognized.language);
        const recognitionStage: RecognitionStage = result.level === "high" ? "identified" : result.level === "medium" ? "review" : "not-found";
        return {
          ...card,
          ...recognized,
          recognitionStage,
          recognitionConfidence: result.confidence,
          recognitionMessage: result.source === "cache" ? "Resultado reutilizado do cache local" : `${result.elapsedMs} ms · ${result.catalogRequests} consulta(s) ao catálogo`,
          recognitionCandidates: result.candidates,
          recognitionResult: result,
          expanded: card.expanded || result.level !== "high",
        };
      }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Falha no reconhecimento local.";
      setCards(current => current.map(card => card.id === id ? { ...card, recognitionStage: "error", recognitionMessage: `${message} Preencha manualmente normalmente.` } : card));
    } finally {
      recognitionInFlight.current.delete(id);
    }
  }

  function useCandidate(id: string, candidate: RecognitionCandidate) {
    submission.current = null;
    setCards(current => current.map(card => card.id !== id ? card : {
      ...card,
      name: candidate.name,
      collection: candidate.collection,
      cardNumber: candidate.cardNumber,
      // Espanhol saiu dos idiomas de operação: candidato es (catálogo de
      // texto/browser ainda o devolve) vira "Outro" — sem isso o select fica
      // em branco e a API rejeita o lote na publicação.
      language: wizardLanguage(candidate.language),
      variant: candidate.variant ?? card.variant,
      manualFields: { ...card.manualFields, name: true, collection: true, cardNumber: true, language: true, ...(candidate.variant ? { variant: true } : {}) },
      recognitionStage: "identified",
      recognitionConfidence: Math.max(card.recognitionConfidence ?? 0, candidate.score),
      recognitionMessage: "Candidato escolhido manualmente",
    }));
    // Explicit user confirmation = ground truth for the local recognition memory.
    // Fire-and-forget: never blocks the flow, never fails the wizard.
    const file = cards.find(card => card.id === id)?.file;
    if (file && candidate.id && candidate.language && candidate.name) {
      void confirmRecognitionMemory(file, {
        cardId: candidate.id,
        language: candidate.language,
        name: candidate.name,
        setName: candidate.collection,
        localId: candidate.localId,
        denominator: candidate.denominator,
      }).catch(() => undefined);
    }
  }

  useEffect(() => {
    if (!imageRecognitionEnabled()) return;
    for (const card of cards) {
      if (card.file && card.recognitionStage === "idle" && !recognitionInFlight.current.has(card.id)) void identifyCard(card.id, card.file);
    }
  }, [cards]);

  // Toggle transitions: OFF stops queuing new recognitions and returns
  // still-queued cards to idle (in-flight requests finish and are dropped by
  // the guard in identifyCard); ON resumes recognition for pending images.
  useEffect(() => {
    const sync = () => {
      if (imageRecognitionEnabled()) {
        for (const card of cards) {
          if (card.file && card.recognitionStage === "idle" && !recognitionInFlight.current.has(card.id)) void identifyCard(card.id, card.file);
        }
      } else {
        setCards(current => current.map(card => card.recognitionStage === "queued"
          ? { ...card, recognitionStage: "idle", recognitionMessage: "Reconhecimento de imagens está desligado" }
          : card));
      }
    };
    window.addEventListener(imageRecognitionPreferenceEvent, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(imageRecognitionPreferenceEvent, sync);
      window.removeEventListener("storage", sync);
    };
  }, [cards]);

  async function addFiles(filesLike: FileList | File[]) {
    const files = Array.from(filesLike).filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!files.length) { setError("Selecione imagens JPG, PNG ou WebP."); return; }
    setCards(current => {
      const lot = Number(firstLot) || suggestedLot;
      const added = files.map((file, index) => {
        const preview = URL.createObjectURL(file); previewUrls.current.add(preview);
        return draftFor(file, preview, lot + current.length + index, current.length + index === 0);
      });
      return [...current, ...added];
    });
    submission.current = null; setError("");
    // Replace the full-size object URLs with downscaled previews (async, off
    // the critical path): the wizard renders dozens of photos at once and
    // 12 MP decodes were freezing the whole page during/after recognition.
    const downscaled = await Promise.all(files.map(async file => ({ file, preview: await makePreviewUrl(file) })));
    setCards(current => current.map(card => {
      const match = downscaled.find(entry => entry.file === card.file);
      if (!match || match.preview === card.preview) return card;
      if (previewUrls.current.has(card.preview)) {
        URL.revokeObjectURL(card.preview);
        previewUrls.current.delete(card.preview);
      }
      previewUrls.current.add(match.preview);
      return { ...card, preview: match.preview };
    }));
  }

  function addEmpty() { const lot = (Number(firstLot) || suggestedLot) + cards.length; setCards(current => [...current, draftFor(null, "", lot, current.length === 0)]); submission.current = null; }
  function removeCard(index: number) {
    setCards(current => {
      const target = current[index];
      if (target?.preview) { URL.revokeObjectURL(target.preview); previewUrls.current.delete(target.preview); }
      return current.filter((_, cardIndex) => cardIndex !== index);
    }); submission.current = null;
  }
  function moveCard(from: number, to: number) {
    if (to < 0 || to >= cards.length || from === to) return;
    setCards(current => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); submission.current = null;
  }
  function sequentialLots() {
    const first = Number(firstLot);
    if (!Number.isSafeInteger(first) || first <= 0) { setError("Informe um primeiro lote válido."); return; }
    // Brindes não consomem número de lote: só as cartas de leilão são numeradas.
    setCards(current => { let lot = first; return current.map(card => { if (card.giveaway) return card; const value = String(lot); lot += 1; return { ...card, lotNumber: value }; }); }); submission.current = null; setError("");
  }
  function copyPrevious(index: number) {
    if (index < 1) return;
    const previous = cards[index - 1];
    mutateCard(cards[index].id, { collection: previous.collection, variant: previous.variant, condition: previous.condition, language: previous.language, extraFiles: previous.extraFiles, extraImages: previous.extraImages, extraPreviews: previous.extraPreviews, pricingMode: previous.pricingMode, customValues: previous.customValues, customBuyoutLast: previous.customBuyoutLast, giveaway: previous.giveaway, giveawayOptions: previous.giveawayOptions, startingPrice: previous.startingPrice, increment: previous.increment, buyout: previous.buyout, durationMinutes: previous.durationMinutes, optionCount: previous.optionCount });
  }
  function pollPlan(card: Draft) { return buildPollPlan(Number(card.startingPrice), Number(card.increment), card.buyout.trim() ? Number(card.buyout) : null, Number(card.optionCount || DEFAULT_POLL_OPTIONS)); }
  // Plano de preços unificado: "increment" usa lance inicial + incremento;
  // "custom" usa os valores exatos digitados pelo operador (primeiro valor =
  // lance inicial, maior valor pode ser ARREMATE — igual ao wizard de carta
  // única). Devolve as opções prontas + os campos efetivos do leilão.
  function pricingOf(card: Draft) {
    if (card.pricingMode === "custom") {
      const values = parseCustomValues(card.customValues);
      const plan = buildCustomValuesPlan(values ?? [], card.customBuyoutLast);
      return { mode: "custom" as const, options: plan.options, overflow: false, error: plan.error, values, startingPrice: plan.startingPrice, bidIncrement: plan.bidIncrement, buyoutPrice: plan.buyoutPrice };
    }
    const plan = pollPlan(card);
    return { mode: "increment" as const, options: plan.options, overflow: plan.overflow, error: plan.overflow ? `a enquete teria ${plan.optionCount} opções; aumente o incremento.` : "", values: null, startingPrice: Number(card.startingPrice), bidIncrement: Number(card.increment), buyoutPrice: card.buyout.trim() ? Number(card.buyout) : null };
  }

  function validateCards() {
    if (!cards.length) return "Adicione pelo menos uma carta.";
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      if (!card.name.trim()) return `Carta ${index + 1} está sem Nome.`;
      if (!card.condition) return `Carta ${index + 1} está sem Condição.`;
      if (!card.language) return `Carta ${index + 1} está sem Idioma.`;
      if (card.imageUrl && !/^https:\/\//i.test(card.imageUrl)) return `Carta ${index + 1}: URL da imagem precisa ser HTTPS.`;
    }
    return "";
  }
  function validateValues() {
    const lots = new Set<number>();
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index], label = `Carta ${index + 1}`, lot = Number(card.lotNumber), duration = Number(card.durationMinutes), pricing = pricingOf(card);
      // Brinde: sem leilão — a validação é só da enquete livre (2 a 12
      // opções de texto); lote/duração/valores não se aplicam.
      if (card.giveaway) {
        const list = card.giveawayOptions.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (list.length < 2 || list.length > 12) return `${label}: a enquete de brinde precisa de 2 a 12 opções (uma por linha).`;
        if (list.some(line => line.length > 100)) return `${label}: cada opção do brinde precisa ter até 100 caracteres.`;
        continue;
      }
      if (!Number.isSafeInteger(lot) || lot <= 0) return `${label}: lote inválido.`;
      if (lots.has(lot)) return `O lote ${lot} aparece duas vezes na fila.`; lots.add(lot);
      if (!Number.isFinite(duration) || duration <= 0 || Math.round(duration * 60) > 604800) return `${label}: duração inválida.`;
      if (pricing.mode === "custom") {
        if (!pricing.values || pricing.error) return `${label}: ${pricing.error ?? "informe os valores da enquete separados por vírgula (ex.: 1, 2, 5, 10)."}`;
        if (!pricing.options.length || pricing.options.length > MAX_POLL_OPTIONS) return `${label}: enquete inválida.`;
      } else {
        const start = pricing.startingPrice, increment = pricing.bidIncrement ?? NaN, buyout = pricing.buyoutPrice;
        if (!Number.isFinite(start) || start < 0) return `${label} está sem Lance inicial válido.`;
        if (!Number.isFinite(increment) || increment <= 0) return `${label}: Incremento deve ser maior que R$ 0.`;
        if (buyout != null && (!Number.isFinite(buyout) || buyout <= start)) return `${label}: ARREMATE deve ser maior que o Lance inicial.`;
        if (pricing.overflow) return `${label}: ${pricing.error}`;
        if (!pricing.options.length || pricing.options.length > MAX_POLL_OPTIONS) return `${label}: enquete inválida.`;
      }
    }
    return "";
  }
  function validatePublication() {
    if (!groupId) return "Selecione o grupo do WhatsApp.";
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86400) return "Intervalo entre publicações inválido.";
    if (publication === "scheduled") {
      const iso = brasiliaInputToIso(scheduledInput);
      if (!iso) return "Data e horário de início inválidos.";
      if (Date.parse(iso) < Date.now() - 30_000) return "O horário de início já passou.";
    }
    return "";
  }
  function go(nextStep: number) {
    if (nextStep >= 2) { const message = validateCards(); if (message) { setError(message); setStep(1); return; } }
    if (nextStep >= 3) { const message = validateValues(); if (message) { setError(message); setStep(2); return; } }
    if (nextStep >= 4) { const message = validatePublication(); if (message) { setError(message); setStep(3); return; } }
    setError(""); setStep(nextStep);
  }

  // keepFiles=false (publicação): o File é descartado ao subir — a URL assume.
  // keepFiles=true (salvar rascunho): o File continua em memória, então a
  // sessão atual mantém reconhecimento/re-upload; o rascunho no servidor
  // guarda a URL.
  async function uploadImages(keepFiles = false) {
    const urls = new Map<string, string>();
    // P-08: a foto principal E as de detalhe (até 4) sobem no mesmo lote
    // incremental; extras usam id composto `${cardId}#e${n}`. As URLs voltam
    // pelo RETORNO (Map) — o payload NÃO pode ler card.extraImages aqui:
    // o setCards do upload ainda não chegou ao closure de startQueue.
    const extraUrls = new Map<string, string[]>();
    const pending: Array<{ id: string; file: File }> = [];
    for (const card of cards) {
      // Foto principal já no Storage (ex.: salva num rascunho antes): reusar
      // a URL evita re-hash/re-upload — o dedup devolveria a mesma de todo jeito.
      if (card.file && !card.imageUrl) pending.push({ id: card.id, file: card.file });
      card.extraFiles.forEach((file, index) => pending.push({ id: `${card.id}#e${index}`, file }));
    }
    for (const card of cards) if (!card.file || card.imageUrl) urls.set(card.id, card.imageUrl.trim());
    if (!pending.length) return { urls, extraUrls, failures: [] as CardImageUploadFailure[] };

    const completed = new Set<string>();
    const { uploaded, failures } = await uploadCardImageBatch({
      client: db,
      authFetch,
      items: pending,
      onStatus: (id, imageStage, imageMessage = "") => {
        const cardId = id.split("#")[0];
        setCards(current => current.map(card => card.id === cardId ? { ...card, imageStage, imageMessage } : card));
      },
      // Preservação INCREMENTAL: cada imagem concluída vira URL NA HORA.
      // Se outra falhar em seguida, o trabalho já feito nunca é perdido — a
      // próxima tentativa reenvia apenas as que falharam (dedup no Storage
      // devolve as concluídas sem custo).
      onUploaded: (id, result) => {
        completed.add(id);
        setUploadProgress(`${completed.size} de ${pending.length} imagem(ns) concluídas`);
        const cardId = id.includes("#") ? id.split("#")[0] : id;
        if (id.includes("#")) {
          extraUrls.set(cardId, [...(extraUrls.get(cardId) ?? []), result.url]);
        } else {
          urls.set(cardId, result.url);
        }
        setCards(current => current.map(card => {
          if (id.includes("#")) {
            if (card.id !== cardId) return card;
            const index = Number(id.split("#e")[1]);
            const extraFiles = card.extraFiles.filter((_, i) => i !== index);
            const extraImages = [...card.extraImages, result.url];
            return { ...card, extraFiles, extraImages, imageStage: "done" as const, imageMessage: card.imageMessage || "Concluída" };
          }
          if (card.id !== id) return card;
          return { ...card, file: keepFiles ? card.file : null, imageUrl: result.url, imageStage: "done" as const, imageMessage: card.imageMessage || "Concluída" };
        }));
      },
    });
    for (const [id, result] of uploaded) {
      if (id.includes("#")) {
        const cardId = id.split("#")[0];
        extraUrls.set(cardId, [...(extraUrls.get(cardId) ?? []), result.url]);
      } else {
        urls.set(id, result.url);
      }
    }
    return { urls, extraUrls, failures };
  }

  async function refreshDrafts() {
    try {
      const response = await authFetch("/api/auctions/drafts");
      if (!response.ok) return;
      const body = await response.json();
      if (Array.isArray(body.drafts)) setDrafts(body.drafts);
    } catch { /* lista desatualizada não é erro para o operador */ }
  }

  async function saveDraft() {
    if (draftBusy || busy) return;
    if (!cards.length) { setError("Adicione pelo menos uma carta antes de salvar o rascunho."); return; }
    setDraftBusy(true); setError(""); setDraftNotice("");
    try {
      // As fotos SOBEM no salvar — é isso que torna o rascunho restaurável em
      // qualquer navegador; a sessão atual mantém os Files (uploadImages(true)).
      const { urls, extraUrls, failures } = await uploadImages(true);
      if (failures.length) {
        const firstReason = failures[0].message;
        const proceed = window.confirm(`${failures.length} imagem(ns) falharam e não ficam salvas no rascunho (elas continuam nesta sessão — salvar de novo reenvia só as que falharam).\n\nSalvar o rascunho sem essas imagens?`);
        if (!proceed) {
          setError(`${failures.length} imagem(ns) falharam (ex.: ${firstReason}). Tente salvar de novo para reenviar somente as que falharam.`);
          return;
        }
      }
      const state = buildDraftState({
        step, firstLot, groupId, intervalValue, intervalUnit, publication, scheduledInput,
        cards: cards.map(card => ({
          ...card,
          imageUrl: urls.get(card.id) ?? card.imageUrl,
          extraImages: card.extraImages.length ? card.extraImages : (extraUrls.get(card.id) ?? []),
        })),
      });
      if (auctionDraftJson(state).length > AUCTION_DRAFT_MAX_BYTES) throw new Error("Rascunho muito grande — reduza o número de cartas.");
      const draftId = activeDraftId ?? crypto.randomUUID();
      const response = await authFetch("/api/auctions/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId, title: buildDraftTitle(new Date(), state.cards.length), state }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o rascunho.");
      setActiveDraftId(draftId);
      setDraftNotice(`Rascunho salvo às ${formatBrasiliaTime(new Date(), false)} — dá para fechar e continuar depois.`);
      await refreshDrafts();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao salvar o rascunho."); }
    finally { setDraftBusy(false); }
  }

  async function openDraft(id: string) {
    if (draftBusy || busy) return;
    if (cards.length && !window.confirm("Abrir o rascunho substitui as cartas que você está editando agora (alterações não salvas serão perdidas). Continuar?")) return;
    setDraftBusy(true); setError("");
    try {
      const response = await authFetch(`/api/auctions/drafts?draftId=${encodeURIComponent(id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível abrir o rascunho.");
      const state = restoreDraftState((body.draft as { payload?: unknown } | null)?.payload);
      for (const card of cards) {
        if (card.preview && previewUrls.current.has(card.preview)) { URL.revokeObjectURL(card.preview); previewUrls.current.delete(card.preview); }
        for (const url of card.extraPreviews) URL.revokeObjectURL(url);
      }
      // Restaurado: file=null + preview="" — o thumbnail usa a URL do Storage.
      // Lotes/valores/idiomas vêm do payload; recognition só nos estágios
      // terminais (identified/review/not-found) com os candidatos preservados.
      setCards(state.cards.map((card, index) => ({
        ...draftFor(null, "", Number(card.lotNumber) || index + 1, index === 0),
        imageUrl: card.imageUrl, extraImages: card.extraImages,
        name: card.name, collection: card.collection, cardNumber: card.cardNumber,
        variant: card.variant, condition: card.condition, language: card.language,
        pricingMode: card.pricingMode, customValues: card.customValues, customBuyoutLast: card.customBuyoutLast,
        giveaway: card.giveaway, giveawayOptions: card.giveawayOptions,
        lotNumber: card.lotNumber, startingPrice: card.startingPrice, increment: card.increment, buyout: card.buyout,
        durationMinutes: card.durationMinutes, optionCount: card.optionCount,
        recognitionStage: card.recognitionStage, recognitionMessage: card.recognitionMessage,
        recognitionCandidates: draftCandidates(card.recognitionCandidates),
        manualFields: card.manualFields,
        imageStage: card.imageUrl ? ("done" as const) : ("idle" as const),
        imageMessage: "",
      })));
      setFirstLot(state.firstLot);
      setGroupId(groups.some(group => group.id === state.groupId) ? state.groupId : "");
      setIntervalValue(state.intervalValue);
      setIntervalUnit(state.intervalUnit);
      setPublication(state.publication);
      setScheduledInput(state.scheduledInput || defaultSchedule());
      setStep(state.step);
      setActiveDraftId(id);
      submission.current = null;
      setDraftNotice("Rascunho aberto — salve de novo antes de fechar para não perder edições.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao abrir o rascunho."); }
    finally { setDraftBusy(false); }
  }

  async function discardDraft(id: string) {
    if (draftBusy) return;
    setDraftBusy(true); setError("");
    try {
      const response = await authFetch(`/api/auctions/drafts?draftId=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível excluir o rascunho.");
      setDrafts(current => current.filter(draft => draft.id !== id));
      if (activeDraftId === id) setActiveDraftId(null);
      setDraftNotice("Rascunho excluído.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao excluir o rascunho."); }
    finally { setDraftBusy(false); }
  }

  async function startQueue() {
    const message = validateCards() || validateValues() || validatePublication();
    if (message) { setError(message); return; }
    setBusy(true); setError("");
    try {
      const { urls: imageUrls, extraUrls, failures } = await uploadImages();
      if (failures.length) {
        // Uma imagem problemática não pode mais travar o leilão inteiro.
        // O usuário escolhe: enviar os lotes sem essas imagens (o bot publica
        // o anúncio como texto) ou ficar na página e corrigir/reenviar.
        const firstReason = failures[0].message;
        const proceed = window.confirm(
          `${failures.length} imagem(ns) falharam (ex.: ${firstReason}).\n\n` +
          "As concluídas foram preservadas — tentar de novo reenvia apenas as que falharam.\n\n" +
          "Enviar agora os lotes SEM essas imagens? (no WhatsApp o anúncio sai como texto)"
        );
        if (!proceed) {
          setError(`${failures.length} imagem(ns) falharam (ex.: ${firstReason}). As concluídas foram preservadas: tente novamente para reenviar somente as que falharam, ou remova/substitua a imagem problemática antes de continuar.`);
          return;
        }
        const failedIds = new Set(failures.map(failure => failure.id));
        setCards(current => current.map(card => failedIds.has(card.id) ? { ...card, imageMessage: "Enviada sem imagem (upload falhou)" } : card));
      }
      const startsAt = publication === "now" ? new Date().toISOString() : brasiliaInputToIso(scheduledInput);
      if (!startsAt) throw new Error("Horário de início inválido.");
      const core = {
        queue: { group_id: groupId, starts_at: startsAt, interval_seconds: intervalSeconds },
        items: cards.map(card => {
          // Brinde: sem leilão — foto + enquete livre no lugar do lote.
          if (card.giveaway) {
            return {
              card: { name: card.name, image_url: imageUrls.get(card.id) || null },
              auction: {},
              giveaway: { options: card.giveawayOptions.split(/\r?\n/).map(line => line.trim()).filter(Boolean) },
            };
          }
          const pricing = pricingOf(card);
          return {
            card: { name: card.name, collection: card.collection, card_number: card.cardNumber, variant: card.variant, condition: card.condition, language: card.language, image_url: imageUrls.get(card.id) || null, extra_images: [...card.extraImages, ...(extraUrls.get(card.id) ?? [])].filter((url, index, all) => all.indexOf(url) === index).slice(0, 4) },
            auction: pricing.mode === "custom"
              ? { lot_number: Number(card.lotNumber), starting_price: pricing.startingPrice, bid_increment: pricing.bidIncrement ?? 0.01, buyout_price: pricing.buyoutPrice, duration_seconds: Math.round(Number(card.durationMinutes) * 60), option_count: pricing.options.length, pricing_mode: "custom", custom_values: pricing.values, custom_buyout_last: card.customBuyoutLast }
              : { lot_number: Number(card.lotNumber), starting_price: Number(card.startingPrice), bid_increment: Number(card.increment), buyout_price: card.buyout.trim() ? Number(card.buyout) : null, duration_seconds: Math.round(Number(card.durationMinutes) * 60), option_count: Number(card.optionCount || DEFAULT_POLL_OPTIONS), pricing_mode: "increment" },
          };
        }),
      };
      const payloadFingerprint = JSON.stringify(core);
      if (!submission.current || submission.current.fingerprint !== payloadFingerprint) submission.current = { fingerprint: payloadFingerprint, eventId: crypto.randomUUID() };
      const response = await authFetch("/api/auctions/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: submission.current.eventId, ...core }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível criar a fila.");
      const id = String(body.data?.queue?.id ?? ""); if (!id) throw new Error("Fila criada sem identificador.");
      setQueueId(id); setUploadProgress(""); window.history.replaceState(null, "", `/auctions/new?queue=${encodeURIComponent(id)}`);
      // Publicou = o rascunho virou leilão de verdade: apaga sozinho
      // (decisão do operador). Fire-and-forget — falha só deixa um rascunho
      // para trás que a própria lista permite excluir.
      if (activeDraftId) {
        const publishedDraftId = activeDraftId;
        setActiveDraftId(null);
        void authFetch(`/api/auctions/drafts?draftId=${encodeURIComponent(publishedDraftId)}`, { method: "DELETE" })
          .then(() => setDrafts(current => current.filter(draft => draft.id !== publishedDraftId)))
          .catch(() => undefined);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao iniciar a fila."); }
    finally { setBusy(false); }
  }

  async function control(action: "pause" | "resume" | "cancel") {
    if (!queueId || busy) return;
    if (action === "cancel" && !window.confirm("Cancelar todas as cartas ainda não publicadas desta fila?")) return;
    setBusy(true); setError("");
    try {
      const response = await authFetch("/api/auctions/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queueId, action }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível alterar a fila."); setQueueView(body as QueueView);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao alterar a fila."); }
    finally { setBusy(false); }
  }

  if (!ready) return <main className="shell"><p>Carregando…</p></main>;
  if (!session) return <main className="shell"><section className="panel"><h1>Novos leilões</h1><p className="muted">Entre primeiro no painel.</p><Link href="/">Voltar</Link></section></main>;

  if (queueId) {
    const status = queueView?.queue.status ?? "scheduled";
    const firstWaiting = queueView?.items.findIndex(item => item.dispatch?.status === "scheduled") ?? -1;
    return <main className="shell batch-shell">
      <header className="topbar"><div><p className="eyebrow">FILA DE PUBLICAÇÃO</p><h1>{queueView?.summary.published ?? 0} de {queueView?.summary.total ?? 0} publicados</h1><p className="muted">A fila fica no servidor e continua mesmo com o navegador fechado.</p></div><div className="topbar-actions"><button className="secondary" onClick={() => { setQueueId(null); setQueueView(null); window.history.replaceState(null, "", "/auctions/new"); }}>＋ Novo leilão</button><Link href="/">← Painel</Link></div></header>
      {error && <p className="alert" role="alert">{error}</p>}
      <section className="panel queue-summary"><div><span>Status</span><strong>{status === "paused" ? "⏸ Pausada" : status === "cancelled" ? "⛔ Cancelada" : status === "completed" ? "✅ Concluída" : "🟢 Em execução"}</strong></div><div><span>Próxima publicação</span><strong>{queueView?.summary.nextScheduledAt ? formatBrasiliaTime(queueView.summary.nextScheduledAt) : "—"}</strong></div><div><span>Intervalo</span><strong>{queueView ? `${queueView.queue.interval_seconds}s` : "—"}</strong></div><div><span>Grupo</span><strong>{queueView?.group?.name ?? "—"}</strong></div></section>
      <section className="panel"><div className="panel-title"><div><h2>Fila</h2><p className="muted">Horários em America/Sao_Paulo.</p></div><div className="actions">{["scheduled", "running"].includes(status) && <button disabled={busy} onClick={() => void control("pause")}>Pausar fila</button>}{status === "paused" && <button disabled={busy} onClick={() => void control("resume")}>Continuar fila</button>}{!["completed", "cancelled"].includes(status) && <button className="secondary" disabled={busy} onClick={() => void control("cancel")}>Cancelar fila</button>}</div></div>
        <div className="queue-list">{queueView?.items.map((item, index) => {
  if (item.poll) {
    const pollSent = Boolean(item.poll.sent_at);
    return <article className={`queue-row ${pollSent ? "sent" : "scheduled"}`} key={item.poll.id}><span className="queue-icon">🎁</span><div><strong>{item.poll.title}</strong><p>{pollSent ? "brinde publicado" : `agendado`}{item.poll.image_url ? "" : " · sem foto"}</p></div><time>{formatBrasiliaTime(item.poll.scheduled_at)}</time></article>;
  }
  const itemStatus = item.dispatch!.status, icon = itemStatus === "sent" ? "✅" : itemStatus === "sending" ? "🟢" : itemStatus === "failed" ? "❌" : itemStatus === "cancelled" ? "⛔" : "⏳", description = itemStatus === "sent" ? "publicado" : itemStatus === "sending" ? "publicando" : itemStatus === "failed" ? `erro após ${item.dispatch!.attempts} tentativa(s)` : itemStatus === "cancelled" ? "cancelado" : index === firstWaiting ? `em ${formatBrasiliaTime(item.dispatch!.scheduled_at)}` : "aguardando"; return <article className={`queue-row ${itemStatus}`} key={item.dispatch!.id}><span className="queue-icon">{icon}</span><div><strong>Lote {item.auction?.lot_number ?? "—"} — {item.card?.name ?? "Carta"}</strong><p>{description}{item.dispatch!.last_error ? ` · ${item.dispatch!.last_error}` : ""}</p></div><time>{formatBrasiliaTime(item.dispatch!.scheduled_at)}</time></article>; })}</div>
      </section>
    </main>;
  }

  return <main className="shell batch-shell">
    <header className="topbar"><div><p className="eyebrow">NOVOS LEILÕES</p><h1>Cadastro em lote</h1><p className="muted">Adicione várias cartas, defina a ordem e deixe o bot publicar sozinho.</p></div><div className="topbar-actions"><Link className="button-link" href="/auctions/brinde">🎁 Brinde</Link><button className="secondary" disabled={draftBusy || busy || !cards.length} onClick={() => void saveDraft()}>{draftBusy ? "Salvando…" : "💾 Salvar rascunho"}</button><Link href="/">← Cancelar</Link></div></header>
    <nav className="batch-steps">{["Cartas", "Valores", "Publicação", "Revisar"].map((label, index) => <button key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => index + 1 < step && setStep(index + 1)}>{index + 1}. {label}</button>)}</nav>
    {error && <p className="alert" role="alert">{error}</p>}
    {draftNotice && <p className="notice">{draftNotice}</p>}

    {step === 1 && <><section className="panel drop-panel" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><p className="eyebrow">ETAPA 1</p><h2>Adicionar cartas</h2><p className="muted">Arraste 1, 20, 50 ou mais imagens. O reconhecimento roda localmente antes do upload; você pode editar enquanto a fila continua.</p><div className="actions"><label className="button-like">＋ Selecionar imagens<input hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} /></label><button className="secondary" type="button" onClick={addEmpty}>Adicionar sem imagem</button></div></section>
      {!cards.length && drafts.length > 0 && <section className="panel drafts-panel"><div className="panel-title"><div><h2>Rascunhos salvos</h2><p className="muted">Continue de onde parou — as fotos já estão no servidor. Publicar a fila apaga o rascunho automaticamente.</p></div></div><div className="draft-list">{drafts.map(draft => <article className="draft-row" key={draft.id}><div className="draft-row-info"><strong>{draft.title}</strong><span>Salvo em {formatBrasiliaDateTime(draft.updated_at, false)}</span></div><div className="actions"><button disabled={draftBusy} onClick={() => void openDraft(draft.id)}>Abrir</button><button className="danger-link" disabled={draftBusy} onClick={() => { if (window.confirm("Excluir este rascunho?")) void discardDraft(draft.id); }}>Excluir</button></div></article>)}</div></section>}
      {!!cards.length && <section className="panel"><div className="panel-title"><div><h2>{cards.length} carta(s)</h2><p className="muted">A ordem é a ordem de publicação. OCR e catálogo são auxiliares: suas correções manuais nunca são sobrescritas automaticamente.</p></div></div><div className="bulk-bar"><label>Idioma para todas<select value={bulkLanguage} onChange={e => setBulkLanguage(e.target.value)}>{cardLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button onClick={() => applyAll("language", bulkLanguage)}>Aplicar</button><label>Condição para todas<select value={bulkCondition} onChange={e => setBulkCondition(e.target.value)}>{cardConditions.map(item => <option key={item}>{item}</option>)}</select></label><button onClick={() => applyAll("condition", bulkCondition)}>Aplicar</button></div>
        <div className="draft-list">{cards.map((card, index) => <article key={card.id} className="draft-card" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragging != null) moveCard(dragging, index); setDragging(null); }}><div className="draft-head"><span className="drag-handle" title="Arraste para mudar a ordem" draggable onDragStart={() => setDragging(index)} onDragEnd={() => setDragging(null)}>☰</span><div className="draft-thumb">{card.preview || card.imageUrl ? <img src={card.preview || card.imageUrl} alt="" loading="lazy" decoding="async" /> : <span>🃏</span>}</div><div className="draft-title"><strong>{index + 1}. {card.giveaway ? "🎁 " : ""}{card.name || "Carta sem nome"}</strong><span>{card.cardNumber || "Sem número"}</span>{card.giveaway && <span className="brinde-inline">🎁 Brinde — vira enquete, não leilão</span>}{card.recognitionMessage && <span className={`recognition-inline ${card.recognitionStage}`}>{recognitionLabel(card)}</span>}{card.imageMessage && card.imageStage !== "idle" && <span className={card.imageStage === "error" ? "alert" : "muted"}>Imagem: {card.imageMessage}</span>}</div><div className="draft-actions"><button className="secondary" onClick={() => moveCard(index, index - 1)} disabled={index === 0}>↑</button><button className="secondary" onClick={() => moveCard(index, index + 1)} disabled={index === cards.length - 1}>↓</button><button className="secondary" onClick={() => mutateCard(card.id, { giveaway: !card.giveaway }, false)}>{card.giveaway ? "✓ Brinde" : "🎁 Brinde"}</button><button className="secondary" onClick={() => mutateCard(card.id, { expanded: !card.expanded }, false)}>{card.expanded ? "Fechar" : "Editar"}</button><button className="danger-link" onClick={() => removeCard(index)}>Remover</button></div></div>{card.expanded && <div className="draft-fields">{(card.file || (card.recognitionCandidates.length > 1 && card.recognitionStage !== "identified")) && <div className={`recognition-box wide ${card.recognitionStage}`}><div><strong>{recognitionLabel(card)}</strong><small>{card.recognitionMessage}</small>{card.file && (((card.recognitionResult as { normalization?: { confidence?: number } } | undefined)?.normalization?.confidence ?? 1) < 0.5 && card.recognitionStage !== "identified") && <small className="retake-hint">📸 Foto escura/torta (enquadramento fraco) — se puder, tire outra e substitua o arquivo; o reconhecimento melhora muito</small>}</div>{card.file && <button className="secondary" type="button" disabled={card.recognitionStage === "queued" || card.recognitionStage === "analyzing"} onClick={() => void identifyCard(card.id, card.file!, false, true)}>✨ {card.recognitionStage === "idle" ? "Identificar carta" : "Reconhecer novamente"}</button>}{card.recognitionCandidates.length > 1 && card.recognitionStage !== "identified" && <div className="recognition-candidates"><span>Possíveis resultados:</span>{card.recognitionCandidates.slice(0, 3).map(candidate => <button type="button" className="secondary" key={`${candidate.language}-${candidate.id}`} onClick={() => useCandidate(card.id, candidate)}><strong>{candidate.name}</strong><small>{candidate.collection} · {candidate.cardNumber} · {candidate.language} · {candidate.score}%</small></button>)}</div>}</div>}{card.file && <RecognitionDebug file={card.file} result={card.recognitionResult} busy={card.recognitionStage === "queued" || card.recognitionStage === "analyzing"} />}<label>Nome<input value={card.name} onChange={e => mutateCard(card.id, { name: e.target.value })} /></label><label>Número da carta<input placeholder="35/64" value={card.cardNumber} onChange={e => mutateCard(card.id, { cardNumber: e.target.value })} /></label>{card.giveaway && <label className="wide giveaway-options">🎁 Opções da enquete de brinde (uma por linha, 2 a 12)<textarea rows={3} value={card.giveawayOptions} onChange={e => mutateCard(card.id, { giveawayOptions: e.target.value })} placeholder={"Quero! 🙋\nTô dentro 🔥\nBora! 🎉"} /><small>"Quem clicar primeiro leva" — o bot publica a foto desta carta + a enquete no lugar do leilão.</small></label>}{!card.giveaway && <div className="draft-fields-extra wide"><span className="extra-label">Fotos de detalhe ({card.extraFiles.length + card.extraImages.length}/4){card.extraFiles.length ? <span className="extra-thumbs">{card.extraPreviews.map((url, index) => <span className="extra-thumb" key={url}><img src={url} alt="" loading="lazy" decoding="async" /><button type="button" title="Remover" onClick={() => mutateCard(card.id, { extraFiles: card.extraFiles.filter((_, i) => i !== index), extraPreviews: card.extraPreviews.filter((_, i) => i !== index) })}>×</button></span>)}</span> : null}</span><label className="button-like">＋ Detalhes{card.extraFiles.length + card.extraImages.length < 4 ? <input hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => { const room = 4 - card.extraFiles.length - card.extraImages.length; const files = Array.from(event.target.files ?? []).slice(0, room); if (files.length) mutateCard(card.id, { extraFiles: [...card.extraFiles, ...files], extraPreviews: [...card.extraPreviews, ...files.map(file => URL.createObjectURL(file))] }); event.currentTarget.value = ""; }} /> : null}</label></div>}<label>Variante<input list={`variants-${card.id}`} value={card.variant} onChange={e => mutateCard(card.id, { variant: e.target.value })} /><datalist id={`variants-${card.id}`}>{variants.map(item => <option key={item} value={item} />)}</datalist></label><label>Condição<select value={card.condition} onChange={e => mutateCard(card.id, { condition: e.target.value })}>{cardConditions.map(item => <option key={item}>{item}</option>)}</select></label><label>Idioma<select value={card.language} onChange={e => mutateCard(card.id, { language: e.target.value })}>{cardLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{!card.file && <label className="wide">URL HTTPS da imagem<input value={card.imageUrl} onChange={e => mutateCard(card.id, { imageUrl: e.target.value })} /></label>}{index > 0 && <button className="secondary wide" onClick={() => copyPrevious(index)}>Copiar configurações da carta anterior</button>}</div>}</article>)}</div></section>}
      <div className="wizard-footer"><Link href="/">Cancelar</Link><button onClick={() => go(2)}>Continuar para valores →</button></div></>}

    {step === 2 && <><section className="panel"><p className="eyebrow">ETAPA 2</p><h2>Valores</h2><p className="muted">Gere a enquete por incremento ou escolha Personalizado e digite os valores exatos (ex.: 1, 2, 5, 10 — o maior pode ser ARREMATE).</p><div className="bulk-bar values"><label>Primeiro lote<input type="number" min="1" value={firstLot} onChange={e => setFirstLot(e.target.value)} /></label><button onClick={sequentialLots}>Numerar lotes</button><label>Lance inicial para todas<input type="number" min="0" step="0.01" value={bulkStart} onChange={e => setBulkStart(e.target.value)} /></label><button onClick={() => applyAll("startingPrice", bulkStart)}>Aplicar</button><label>Incremento para todas<input type="number" min="0.01" step="0.01" value={bulkIncrement} onChange={e => setBulkIncrement(e.target.value)} /></label><button onClick={() => applyAll("increment", bulkIncrement)}>Aplicar</button><label>Valores personalizados p/ todas<input inputMode="decimal" placeholder="Ex.: 1, 2, 5, 10" value={bulkCustomValues} onChange={e => setBulkCustomValues(e.target.value)} /></label><button onClick={() => { setCards(current => current.map(card => ({ ...card, pricingMode: "custom" as const, customValues: bulkCustomValues }))); submission.current = null; }}>Aplicar personalizados</button><label>Duração para todas (min)<input type="number" min="0.1" step="0.1" value={bulkDuration} onChange={e => setBulkDuration(e.target.value)} /></label><button onClick={() => applyAll("durationMinutes", bulkDuration)}>Aplicar</button></div>
      <div className="value-list">{cards.map((card, index) => { const pricing = pricingOf(card); return <article className="value-row" key={card.id}><div><strong>{index + 1}. {card.name || "Carta"}</strong><span>{card.giveaway ? "🎁 Brinde — enquete no lugar do leilão" : pricing.error ? `⚠ ${pricing.error}` : `${pricing.options.length} opções`}</span></div>{card.giveaway ? <label className="wide">🎁 Opções do brinde (uma por linha, 2 a 12)<textarea rows={2} value={card.giveawayOptions} onChange={e => mutateCard(card.id, { giveawayOptions: e.target.value })} /></label> : <><label>Lote<input type="number" min="1" value={card.lotNumber} onChange={e => mutateCard(card.id, { lotNumber: e.target.value })} /></label><label>Valores<select value={card.pricingMode} onChange={e => mutateCard(card.id, { pricingMode: e.target.value === "custom" ? "custom" : "increment" })}><option value="increment">Automático</option><option value="custom">Personalizado</option></select></label><label>Duração (min)<input type="number" min="0.1" step="0.1" value={card.durationMinutes} onChange={e => mutateCard(card.id, { durationMinutes: e.target.value })} /></label>{card.pricingMode === "increment" ? <><label>Inicial<input type="number" min="0" step="0.01" value={card.startingPrice} onChange={e => mutateCard(card.id, { startingPrice: e.target.value })} /></label><label>Incremento<input type="number" min="0.01" step="0.01" value={card.increment} onChange={e => mutateCard(card.id, { increment: e.target.value })} /></label><label>ARREMATE<input type="number" min="0" step="0.01" placeholder="Opcional" value={card.buyout} onChange={e => mutateCard(card.id, { buyout: e.target.value })} /></label>{!card.buyout.trim() && <label>Opções<input type="number" min="2" max={MAX_POLL_OPTIONS} value={card.optionCount} onChange={e => mutateCard(card.id, { optionCount: e.target.value })} /></label>}</> : <><label className="wide">Valores da enquete (vírgula)<input inputMode="decimal" placeholder="Ex.: 1, 2, 5, 10" value={card.customValues} onChange={e => mutateCard(card.id, { customValues: e.target.value })} /></label><label className="radio-row"><input type="checkbox" checked={card.customBuyoutLast} onChange={e => mutateCard(card.id, { customBuyoutLast: e.target.checked })} /> Maior valor = ARREMATE</label></>}<div className="poll-mini">{pricing.options.slice(0, 4).map(option => <span key={option.label}>{option.label}</span>)}{pricing.options.length > 4 && <span>+{pricing.options.length - 4}</span>}</div></>}</article>; })}</div></section><div className="wizard-footer"><button className="secondary" onClick={() => setStep(1)}>← Cartas</button><button onClick={() => go(3)}>Continuar para publicação →</button></div></>}

    {step === 3 && <><section className="panel publication-panel"><p className="eyebrow">ETAPA 3</p><h2>Publicação</h2><div className="publication-grid"><label>Grupo do WhatsApp<select value={groupId} onChange={e => { setGroupId(e.target.value); submission.current = null; }}><option value="">Selecione…</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Publicar nova enquete a cada<div className="inline-fields"><input type="number" min="1" value={intervalValue} onChange={e => { setIntervalValue(e.target.value); submission.current = null; }} /><select value={intervalUnit} onChange={e => { setIntervalUnit(e.target.value as "seconds" | "minutes"); submission.current = null; }}><option value="seconds">segundos</option><option value="minutes">minutos</option></select></div></label><fieldset><legend>Começar</legend><label className="radio-row"><input type="radio" checked={publication === "now"} onChange={() => setPublication("now")} /> ▶ Agora</label><label className="radio-row"><input type="radio" checked={publication === "scheduled"} onChange={() => setPublication("scheduled")} /> 🕒 Agendar</label></fieldset>{publication === "scheduled" && <label>Data e horário de Brasília<input type="datetime-local" value={scheduledInput} onChange={e => setScheduledInput(e.target.value)} /><small>America/Sao_Paulo</small></label>}</div><details className="more-options"><summary>Mais opções</summary><p className="muted">A duração de cada leilão é independente do intervalo entre publicações.</p></details></section><div className="wizard-footer"><button className="secondary" onClick={() => setStep(2)}>← Valores</button><button onClick={() => go(4)}>Revisar fila →</button></div></>}

    {step === 4 && <><section className="panel review-panel"><p className="eyebrow">ETAPA 4</p><h2>Revisar e iniciar</h2><div className="review-summary"><div><span>Cartas</span><strong>{cards.length}</strong></div><div><span>Lotes</span><strong>{cards[0]?.lotNumber ?? "—"} → {cards[cards.length - 1]?.lotNumber ?? "—"}</strong></div><div><span>Primeira publicação</span><strong>{publication === "now" ? "Agora" : startInstant ? formatBrasiliaDateTime(startInstant, false) : "—"}</strong></div><div><span>Intervalo</span><strong>{intervalSeconds}s</strong></div><div><span>Grupo</span><strong>{groups.find(group => group.id === groupId)?.name ?? "—"}</strong></div></div><div className="review-list">{cards.map((card, index) => { const start = startInstant ? new Date(startInstant.getTime() + index * intervalSeconds * 1000) : null, end = start ? new Date(start.getTime() + Math.round(Number(card.durationMinutes) * 60_000)) : null; return <article key={card.id}><div className="draft-thumb">{card.preview || card.imageUrl ? <img src={card.preview || card.imageUrl} alt="" loading="lazy" decoding="async" /> : <span>🃏</span>}</div><div><strong>Lote {card.lotNumber} — {card.name}</strong><p>{card.giveaway ? "🎁 Brinde — vira enquete de brinde (não é leilão)" : card.pricingMode === "custom" ? (() => { const pricing = pricingOf(card); return `Valores personalizados (${pricing.options.length}) · ${pricing.buyoutPrice != null ? `ARREMATE ${money(pricing.buyoutPrice)}` : "Sem ARREMATE"}`; })() : `${money(Number(card.startingPrice))} + ${money(Number(card.increment))} · ${card.buyout ? `ARREMATE ${money(Number(card.buyout))}` : "Sem ARREMATE"}`}</p><p>Publica: {start ? formatBrasiliaTime(start) : "Agora"} · Encerra: {end ? formatBrasiliaTime(end) : "—"}</p>{card.imageMessage && <p className="muted">Imagem: {card.imageMessage}</p>}</div></article>; })}</div>{uploadProgress && <p className="notice">{uploadProgress}</p>}</section><div className="wizard-footer"><button className="secondary" disabled={busy} onClick={() => setStep(3)}>← Publicação</button><button disabled={busy} onClick={() => void startQueue()}>{busy ? "Preparando fila…" : publication === "now" ? "▶ Iniciar fila agora" : "🕒 Agendar fila"}</button></div></>}
  </main>;
}
