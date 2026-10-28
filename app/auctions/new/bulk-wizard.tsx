"use client";

import {GuardedLink as Link,useNavigationGuard} from "@/app/navigation-guard";
import {hasPendingDraftImages} from "@/lib/navigation-guard";
import GameAnswerFields from "@/app/game-answer-fields";
import DraftToolbar from "./draft-toolbar";
import SelectionEditor from "./selection-editor";
import {applyDraftBulkEdit,undoDraftBulkEdit,type BulkEditAction,type BulkEditChange} from "@/lib/draft-bulk-edit";
import {mergeImageUrls,removeUploadedFile,queuePollingDelay,pendingCreationKey,readPendingCreation,storePendingCreation} from "@/lib/wizard-state";
import {CreationRejectedError,restoreBatchCreation,submitAuctionCreation} from "@/lib/auction-creation";
import {parsePollGame} from "@/lib/poll-game";
import { defaultCommonEndInput, validateCommonDeadline } from "@/lib/common-deadline";
import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import { buildCustomValuesPlan, buildPollPlan, cardConditions, cardLanguages, DEFAULT_POLL_OPTIONS, GIVEAWAY_DEFAULT_OPTIONS, MAX_POLL_OPTIONS, parseCustomValues } from "@/lib/auction-wizard";
import { brasiliaInputToIso, formatBrasiliaDateTime, formatBrasiliaTime, toBrasiliaInput } from "@/lib/brasilia-time";
import { uploadCardImageBatch, type CardImageStage, type CardImageUploadFailure } from "@/lib/card-image";
import { AUCTION_DRAFT_MAX_BYTES, AUCTION_DRAFT_MAX_CARDS, auctionDraftJson, buildDraftState, buildDraftTitle, restoreDraftState } from "@/lib/auction-draft";
import { createCardPreviewQueue, type CardPreviewQueue, type PreviewProgress } from "@/lib/card-preview";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; is_default: boolean };
type Draft = {
  id: string; file: File | null; preview: string; imageUrl: string; imageStage: CardImageStage; imageMessage: string;
  extraFiles: File[]; extraImages: string[]; extraPreviews: string[];
  name: string; collection: string; cardNumber: string; variant: string; condition: string; language: string;
  pricingMode: "increment" | "custom"; customValues: string; customBuyoutLast: boolean;
  giveaway: boolean; giveawayOptions: string; giveawayKind: "quiz" | "giveaway"; giveawayCorrectIndex: string; giveawayQuestion: string;
  lotNumber: string; startingPrice: string; increment: string; buyout: string; durationMinutes: string; optionCount: string; expanded: boolean;
};
type QueueView = {
  queue: { id: string; status: string; interval_seconds: number; starts_at: string; total_items: number; ends_at: string | null };
  group: { id: string; name: string } | null;
  summary: { total: number; published: number; failed: number; pending: number; nextScheduledAt: string | null };
  items: Array<{
    dispatch: { id: string; status: string; scheduled_at: string; sent_at: string | null; attempts: number; last_error: string | null; queue_position: number; duration_seconds?: number | null; poll_options?: Array<{ label: string; amount: number; isBuyout: boolean }> | null } | null;
    auction: { id: string; lot_number: number; status: string; scheduled_end_at: string | null; final_price: number | null; win_type: string | null; starting_price?: number | null; bid_increment?: number | null; buyout_price?: number | null } | null;
    card: { id: string; name: string; image_url: string | null } | null;
    poll: { game_kind?: string; prize_name?: string; winner_name?: string; id: string; title: string; image_url: string | null; scheduled_at: string; sent_at: string | null; queue_position: number } | null;
  }>;
};

type DraftSummary = { id: string; title: string; updated_at: string };

const variants = ["Normal", "Holo", "Reverse Holo", "Full Art", "Illustration Rare", "Secret Rare", "Promo"];
const money = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const defaultSchedule = () => toBrasiliaInput(new Date(Date.now() + 5 * 60_000));

function draftFor(file: File | null, preview: string, lot: number, expanded: boolean): Draft {
  return {
    id: crypto.randomUUID(), file, preview, imageUrl: "", imageStage: "idle", imageMessage: file ? "Aguardando otimização" : "",
    extraFiles: [], extraImages: [], extraPreviews: [],
    name: "", collection: "", cardNumber: "",
    pricingMode: "increment", customValues: "", customBuyoutLast: true,
    giveaway: false, giveawayOptions: GIVEAWAY_DEFAULT_OPTIONS, giveawayKind: "giveaway", giveawayCorrectIndex: "", giveawayQuestion: "",
    variant: "Normal", condition: cardConditions[0], language: "pt-BR", lotNumber: String(lot), startingPrice: "5", increment: "1",
    buyout: "", durationMinutes: "2", optionCount: String(DEFAULT_POLL_OPTIONS), expanded,
  };
}

export default function BulkAuctionWizard() {
  const [db] = useState(createPublicSupabaseClient);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [suggestedLot, setSuggestedLot] = useState(1);
  const [firstLot, setFirstLot] = useState("1");
  const [cards, commitCards] = useState<Draft[]>([]);
  const hasAuctions = cards.some(card=>!card.giveaway);
  const cardsRef = useRef<Draft[]>([]);
  // Keep event/async callbacks in sync even when two selections precede the
  // next render. Updaters run once, outside React's replayable updater queue.
  function setCards(update: SetStateAction<Draft[]>) {
    const next = typeof update === "function" ? update(cardsRef.current) : update;
    cardsRef.current = next;
    commitCards(next);
  }
  const previewQueue = useRef<CardPreviewQueue | null>(null);
  const uploadWork = useRef(false);
  const [previewProgress, setPreviewProgress] = useState<PreviewProgress>({ completed: 0, total: 0, remaining: 0 });
  const preparingPreviews = previewProgress.remaining > 0;
  const [step, setStep] = useState(1);
  const [groupId, setGroupId] = useState("");
  const [endMode, setEndMode] = useState<"common" | "duration">("common");
  const [commonEndInput, setCommonEndInput] = useState(defaultCommonEndInput);
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
  const [editingItem, setEditingItem] = useState<QueueView["items"][number] | null>(null);
  const editItemDialog = useRef<HTMLDialogElement>(null);
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => { if (previousStep.current !== step) { stepTitle.current?.focus(); previousStep.current = step; } }, [step]);
  useEffect(() => { if (editingItem && editItemDialog.current && !editItemDialog.current.open) editItemDialog.current.showModal(); }, [editingItem]);
  const previewUrls = useRef(new Set<string>());
  const creationId = useRef(crypto.randomUUID());
  const submission = useRef<{eventId:string;payload:Record<string,unknown>} | null>(null);
  const [pendingConfirmation,setPendingConfirmation]=useState(false);
  const [draftStatus,setDraftStatus]=useState("Alterações pendentes");
  const [search,setSearch]=useState(""),[typeFilter,setTypeFilter]=useState("all");
  const [selectedCards,setSelectedCards]=useState<Set<string>>(()=>new Set());
  const [lastBulkChange,setLastBulkChange]=useState<BulkEditChange[]>([]);
  const [bulkFeedback,setBulkFeedback]=useState({message:"",error:false});
  const [invalidCard,setInvalidCard]=useState<{id:string;word:string;error:boolean}|null>(null);
  const filteredCards=cards.map((card,index)=>({card,index})).filter(({card})=>`${card.name} ${card.cardNumber}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))&&(typeFilter==="all"||typeFilter==="auction"&&!card.giveaway||card.giveaway&&card.giveawayKind===typeFilter||typeFilter==="pending"&&(!card.name.trim()||card.giveaway&&(card.giveawayCorrectIndex===""||card.giveawayKind==="quiz"&&!card.giveawayQuestion.trim())||!card.giveaway&&Boolean(pricingOf(card).error))));
  const visibleCards=filteredCards;
  function jumpToCard(position:number){const card=cards[position-1];if(!card)return;setSearch("");setTypeFilter("all");setCards(current=>current.map(item=>item.id===card.id?{...item,expanded:true}:item));setInvalidCard({id:card.id,word:"Nome",error:false});}
  useEffect(()=>{if(!invalidCard)return;const frame=requestAnimationFrame(()=>{const article=document.querySelector<HTMLElement>(`[data-card-id="${invalidCard.id}"]`);if(!article)return;article.querySelectorAll("details").forEach(detail=>detail.open=true);const labels=[...article.querySelectorAll("label")];const field=(labels.find(label=>label.textContent?.toLocaleLowerCase("pt-BR").includes(invalidCard.word.toLocaleLowerCase("pt-BR")))??labels[0])?.querySelector<HTMLElement>("input,select,textarea");article.scrollIntoView({block:"center",behavior:"auto"});field?.focus();if(invalidCard.error){field?.setAttribute("aria-invalid","true");field?.setAttribute("aria-describedby","wizard-error");}});return()=>cancelAnimationFrame(frame);},[invalidCard,step]);
  const lastSavedDraftFingerprint = useRef<string | null>(null);
  const autoSaveDisabled = useRef(false);
  const saveDraftRef = useRef<(auto?: boolean) => Promise<void>>(async () => {});

  // Auto-save do rascunho: fingerprint do estado atual vs o último salvo; um
  // intervalo de 45s evita debounce no cada tecla.
  function currentDraftFingerprint() {
    if (!cards.length) return null;
    return auctionDraftJson(buildDraftState({
      step, firstLot, groupId, intervalValue, intervalUnit, publication, scheduledInput, endMode, commonEndInput,
      cards: cardsRef.current.map(card => ({
        ...card,
        imageUrl: card.imageUrl,
        extraImages: card.extraImages.length ? card.extraImages : [],
      })),
    }));
  }
  saveDraftRef.current = saveDraft;
  const latestDraftFingerprint=useRef(currentDraftFingerprint);
  latestDraftFingerprint.current=currentDraftFingerprint;
  const hasUnsavedDraft=()=>!queueId&&Boolean(pendingConfirmation||cardsRef.current.length&&(hasPendingDraftImages(cardsRef.current)||latestDraftFingerprint.current()!==lastSavedDraftFingerprint.current));
  useNavigationGuard({
    isDirty:hasUnsavedDraft,
    isBusy:()=>!queueId&&(busy||draftBusy||preparingPreviews||uploadWork.current),
    message:()=>pendingConfirmation?"Há uma publicação aguardando confirmação. O envio pode já ter ocorrido. Recomendamos continuar nesta página e confirmar o envio anterior antes de sair.":"Há alterações ou fotos que ainda não foram salvas. Se você sair sem salvar, esse trabalho será perdido. Você pode salvar o rascunho e continuar depois.",
    save:pendingConfirmation?undefined:async()=>{await saveDraftRef.current(false);return !hasUnsavedDraft();},
  });


  // Auto-save ESTAVEL: o timer nasce UMA vez por sessao/fila (nao a cada
  // render — o efeito antigo sem deps resetava os 45s a cada tecla, e o save
  // so disparava depois de 45s de silencio total). O ref garante que o
  // intervalo chama sempre o saveDraft mais recente (closure fresca com o
  // estado atual).
  useEffect(() => {
    if (!session || queueId) return;
    const timer = setInterval(() => { if(!document.hidden && !autoSaveDisabled.current && !pendingConfirmation) void saveDraftRef.current(true); }, 45_000);
    return () => clearInterval(timer);
  }, [session?.user.id, queueId, pendingConfirmation]);

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
      const pending=readPendingCreation(sessionStorage,pendingCreationKey("batch",data.session.user.id));
      if(pending){
        submission.current=pending.editable?null:pending;creationId.current=pending.eventId;setPendingConfirmation(!pending.editable);
        const state=restoreBatchCreation(pending.payload);
        setCards(state.cards.map((card,index)=>({...draftFor(null,"",Number(card.lotNumber)||index+1,index===0),...card,
          giveawayKind:card.giveawayKind??"giveaway",giveawayCorrectIndex:card.giveawayCorrectIndex??"",giveawayQuestion:card.giveawayQuestion??""})));
        setFirstLot(state.firstLot);setGroupId(state.groupId);setIntervalValue(state.intervalValue);setIntervalUnit(state.intervalUnit);
        setPublication(state.publication);setScheduledInput(state.scheduledInput);setEndMode(state.endMode??"duration");setCommonEndInput(state.commonEndInput??"");
        return;
      }
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
    previewQueue.current?.dispose();
    previewQueue.current = null;
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!queueId) return;
    let stopped=false,loading=false,timer:ReturnType<typeof setTimeout>|undefined;
    const load=async()=>{clearTimeout(timer);if(stopped||loading||document.hidden)return;loading=true;let status:string|undefined;
      try{const response=await authFetch(`/api/auctions/queue?queueId=${encodeURIComponent(queueId)}`);const body=await response.json();if(!response.ok)throw Error(body.error??"Falha ao atualizar a fila.");status=body.queue?.status;if(!stopped)setQueueView(body as QueueView);}
      catch(reason){if(!stopped)setError(reason instanceof Error?reason.message:"Falha ao atualizar a fila.");}
      finally{loading=false;const delay=queuePollingDelay(status,document.hidden);if(!stopped&&delay)timer=setTimeout(load,delay);}
    };
    const visibility=()=>{clearTimeout(timer);if(!document.hidden)void load();};
    void load();document.addEventListener("visibilitychange",visibility);
    return()=>{stopped=true;clearTimeout(timer);document.removeEventListener("visibilitychange",visibility);};
  }, [queueId]);

  const intervalSeconds = useMemo(() => {
    const value = Number(intervalValue);
    return Number.isFinite(value) ? Math.round(value * (intervalUnit === "minutes" ? 60 : 1)) : 0;
  }, [intervalValue, intervalUnit]);
  const startInstant = publication === "now" ? new Date() : (() => { const iso = brasiliaInputToIso(scheduledInput); return iso ? new Date(iso) : null; })();

  function mutateCard(id: string, patch: Partial<Draft>) {
    if(pendingConfirmation)return;
    setDraftStatus("Alterações pendentes");setInvalidCard(null);
    document.querySelectorAll('[aria-describedby="wizard-error"]').forEach(node=>{node.removeAttribute("aria-invalid");node.removeAttribute("aria-describedby");});
    submission.current = null;
    setCards(current => current.map(card => card.id === id ? { ...card, ...patch } : card));
  }
  function applyAll<K extends keyof Draft>(key: K, value: Draft[K]) {
    submission.current = null;
    setCards(current => current.map(card => ({ ...card, [key]: value })));
  }

  function selectCard(id:string,checked:boolean){setSelectedCards(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});}
  function applySelected(action:BulkEditAction,ids:ReadonlySet<string>=selectedCards){
    if(busy||draftBusy||pendingConfirmation||uploadWork.current)return;
    try{
      const result=applyDraftBulkEdit(cardsRef.current,ids,action,{allowDuration:endMode==="duration"});
      if(result.changes.length){setCards(result.cards);setLastBulkChange(result.changes);submission.current=null;setDraftStatus("Alterações pendentes");setInvalidCard(null);}
      setBulkFeedback({error:false,message:`Última aplicação: ${result.changes.length} ${result.changes.length===1?"carta alterada":"cartas alteradas"}.${result.skipped?` ${result.skipped} ${result.skipped===1?"carta incompatível foi preservada":"cartas incompatíveis foram preservadas"}.`:""}${result.unchanged?` ${result.unchanged} ${result.unchanged===1?"carta já estava igual":"cartas já estavam iguais"}.`:""} A ordem foi mantida.`});
    }catch(error){setBulkFeedback({error:true,message:error instanceof Error?error.message:"Não foi possível aplicar as configurações."});}
  }
  function undoSelected(){
    if(busy||draftBusy||pendingConfirmation||uploadWork.current)return;
    const result=undoDraftBulkEdit(cardsRef.current,lastBulkChange);
    setCards(result.cards);setLastBulkChange([]);
    if(result.restored){submission.current=null;setDraftStatus("Alterações pendentes");}
    setBulkFeedback({error:false,message:`Última aplicação desfeita em ${result.restored} ${result.restored===1?"carta":"cartas"}.${result.conflicts?" Alterações posteriores foram preservadas.":""}`});
  }

  function addFiles(filesLike: FileList | File[]) {
    if (busy || draftBusy || uploadWork.current) { setError("Aguarde o salvamento ou envio antes de adicionar mais fotos."); return; }
    const files = Array.from(filesLike).filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!files.length) { setError("Selecione imagens JPG, PNG ou WebP."); return; }
    if (cardsRef.current.length + files.length > AUCTION_DRAFT_MAX_CARDS) { setError(`A fila aceita até ${AUCTION_DRAFT_MAX_CARDS} cartas. Há ${cardsRef.current.length} adicionadas; selecione no máximo ${AUCTION_DRAFT_MAX_CARDS - cardsRef.current.length} fotos.`); return; }
    const current = cardsRef.current;
    const lot = Number(firstLot) || suggestedLot;
    const added = files.map((file, index) => ({ ...draftFor(file, "", lot + current.length + index, current.length + index === 0), imageMessage: "Preparando prévia…" }));
    setCards([...current, ...added]);
    submission.current = null; setError("");
    previewQueue.current ??= createCardPreviewQueue({
      onProgress: setPreviewProgress,
      onPreview: (id, url) => {
        if (!cardsRef.current.some(card => card.id === id)) return false;
        previewUrls.current.add(url);
        setCards(items => items.map(card => card.id === id ? { ...card, preview: url, imageMessage: "" } : card));
        return true;
      },
      onError: id => setCards(items => items.map(card => card.id === id ? { ...card, imageMessage: "Prévia indisponível; foto original preservada para o envio." } : card)),
    });
    previewQueue.current.enqueue(added.map(card => ({ id: card.id, file: card.file! })));
  }

  function addEmpty() {
    if (busy || draftBusy || uploadWork.current) return;
    if (cardsRef.current.length >= AUCTION_DRAFT_MAX_CARDS) { setError(`A fila aceita até ${AUCTION_DRAFT_MAX_CARDS} cartas.`); return; }
    const lot = (Number(firstLot) || suggestedLot) + cardsRef.current.length;
    setCards(current => [...current, draftFor(null, "", lot, current.length === 0)]); submission.current = null;
  }
  function removeCard(index: number) {
    const targetId = cardsRef.current[index]?.id;
    if(targetId)selectCard(targetId,false);
    if (targetId) previewQueue.current?.cancel(targetId);
    setCards(current => {
      const target = current[index];
      if (target) {
        if (target.preview) { URL.revokeObjectURL(target.preview); previewUrls.current.delete(target.preview); }
        // Object URLs de fotos de detalhe podem estar COMPARTILHADOS entre
        // cartas (Copiar configurações da anterior): só revoga a que não
        // tem outro dono — senão o thumbnail da outra carta morre.
        for (const url of target.extraPreviews) {
          const shared = current.some((other, otherIndex) => otherIndex !== index && other.extraPreviews.includes(url));
          if (!shared) URL.revokeObjectURL(url);
          previewUrls.current.delete(url);
        }
      }
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
    applySelected({field:"copy",sourceId:cards[index-1].id},new Set([cards[index].id]));
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
        try{parsePollGame({kind:card.giveawayKind,options:list,correctIndex:card.giveawayCorrectIndex === "" ? null : Number(card.giveawayCorrectIndex),prizeName:card.name,question:card.giveawayQuestion});}catch(error){return `${label}: ${(error as Error).message}`;}
        continue;
      }
      if (!Number.isSafeInteger(lot) || lot <= 0) return `${label}: lote inválido.`;
      if (lots.has(lot)) return `O lote ${lot} aparece duas vezes na fila.`; lots.add(lot);
      if (endMode === "duration" && (!Number.isFinite(duration) || duration <= 0 || Math.round(duration * 60) > 604800)) return `${label}: duração inválida.`;
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
    if (endMode === "common" && hasAuctions) {
      const end = brasiliaInputToIso(commonEndInput);
      const start = publication === "now" ? new Date().toISOString() : brasiliaInputToIso(scheduledInput);
      if (!end || !start || Date.parse(end)<=Date.now() || !validateCommonDeadline(end,start,cards.length,intervalSeconds)) return "Escolha um encerramento comum depois da última publicação, em até sete dias do início.";
    }
    if (!groupId) return "Selecione o grupo do WhatsApp.";
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86400) return "Intervalo entre publicações inválido.";
    if (publication === "scheduled") {
      const iso = brasiliaInputToIso(scheduledInput);
      if (!iso) return "Data e horário de início inválidos.";
      if (Date.parse(iso) < Date.now() - 30_000) return "O horário de início já passou.";
    }
    return "";
  }
  function reportValidation(message:string,atStep:number){
    setError(message);setStep(atStep);const index=Number(message.match(/Carta (\d+)/i)?.[1]??0)-1;
    if(index>=0&&cards[index]){const id=cards[index].id;setSearch("");setTypeFilter("all");setCards(current=>current.map(card=>card.id===id?{...card,expanded:true}:card));setInvalidCard({id,error:true,word:/Nome/i.test(message)?"Nome":/resposta|correta/i.test(message)?"Única opção correta":/pergunta/i.test(message)?"Pergunta":/incremento/i.test(message)?"Incremento":/lote/i.test(message)?"Lote":/imagem/i.test(message)?"URL":"Inicial"});}
  }
  function go(nextStep: number) {
    if (nextStep >= 2) { const message = validateCards(); if (message) { reportValidation(message,1); return; } }
    if (nextStep >= 3) { const message = validateValues(); if (message) { reportValidation(message,2); return; } }
    if (nextStep >= 4) { const message = validatePublication(); if (message) { reportValidation(message,3); return; } }
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
            const completedFile=pending.find(item=>item.id===id)!.file;
            const completedIndex=card.extraFiles.indexOf(completedFile);
            const extraFiles = removeUploadedFile(card.extraFiles, completedFile);
            const extraPreviews=card.extraPreviews.filter((_,i)=>i!==completedIndex);
            const extraImages = mergeImageUrls(card.extraImages, [result.url]);
            return { ...card, extraFiles, extraImages, extraPreviews, imageStage: "done" as const, imageMessage: card.imageMessage || "Concluída" };
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

  async function saveDraft(auto = false) {
    if (draftBusy || busy || uploadWork.current || pendingConfirmation) return;
    if (auto && autoSaveDisabled.current) return;
    if (!auto) autoSaveDisabled.current=false;
    if (previewQueue.current?.busy) { if (!auto) setError("Aguarde a preparação das fotos antes de salvar."); return; }
    if (auto) {
      // Nada mudou desde o ultimo save (ou sem cartas): o intervalo e inerte.
      const fingerprint = currentDraftFingerprint();
      if (!fingerprint || fingerprint === lastSavedDraftFingerprint.current) return;
    }
    if (!cards.length) { if (!auto) setError("Adicione pelo menos uma carta antes de salvar o rascunho."); return; }
    uploadWork.current = true;
    setDraftBusy(true); setDraftStatus("Salvando…"); if (!auto) { setError(""); setDraftNotice(""); }
    try {
      // As fotos SOBEM no salvar — é isso que torna o rascunho restaurável em
      // qualquer navegador; a sessão atual mantém os Files (uploadImages(true)).
      const { urls, extraUrls, failures } = await uploadImages(true);
      if (failures.length) {
        const firstReason = failures[0].message;
        setDraftStatus("Há fotos pendentes de salvamento");
        if (!auto) {
          const proceed = window.confirm(`${failures.length} imagem(ns) falharam e não ficam salvas no rascunho (elas continuam nesta sessão — salvar de novo reenvia só as que falharam).\n\nSalvar o rascunho sem essas imagens?`);
          if (!proceed) {
            setError(`${failures.length} imagem(ns) falharam (ex.: ${firstReason}). Tente salvar de novo para reenviar somente as que falharam.`);
            return;
          }
        } else {
          // Auto-save nunca interrompe o operador por causa de imagem: tenta de
          // novo no próximo ciclo (as concluídas ficam preservadas).
          return;
        }
      }
      const latest=latestDraftFingerprint.current();
      if(!latest)throw new Error("Adicione uma carta antes de salvar.");
      const state=JSON.parse(latest) as ReturnType<typeof buildDraftState>;
      if (auctionDraftJson(state).length > AUCTION_DRAFT_MAX_BYTES) throw new Error("Rascunho muito grande — reduza o número de cartas.");
      const draftId = activeDraftId ?? crypto.randomUUID();
      const response = await authFetch("/api/auctions/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId, title: buildDraftTitle(new Date(), state.cards.length), state }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o rascunho.");
      setActiveDraftId(draftId);
      lastSavedDraftFingerprint.current = auctionDraftJson(state);
      setDraftStatus("Salvo");
      setDraftNotice(auto ? `Rascunho salvo automaticamente às ${formatBrasiliaTime(new Date(), false)}.` : `Rascunho salvo às ${formatBrasiliaTime(new Date(), false)} — dá para fechar e continuar depois.`);
      await refreshDrafts();
    } catch (reason) {
      if (auto) {
        // Auto-save falhou (ex.: migration ainda não aplicada): desliga pelo
        // resto da sessão — o botão manual continua disponível e honesto.
        autoSaveDisabled.current = true;
        setDraftStatus("Não foi possível salvar. Use Salvar rascunho para tentar novamente.");
        setDraftNotice("O salvamento automático foi pausado após uma falha. Suas alterações continuam nesta página.");
        // Status visible in the panel; no repeated background requests after failure.
      } else {setDraftStatus("Não foi possível salvar");setError(reason instanceof Error ? reason.message : "Falha ao salvar o rascunho.");}
    }
    finally { uploadWork.current = false; setDraftBusy(false); }
  }

  async function openDraft(id: string) {
    if (draftBusy || busy || uploadWork.current || previewQueue.current?.busy) return;
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
      // Lotes/valores/idiomas vêm do payload.
      setCards(state.cards.map((card, index) => ({
        ...draftFor(null, "", Number(card.lotNumber) || index + 1, index === 0),
        imageUrl: card.imageUrl, extraImages: card.extraImages,
        name: card.name, collection: card.collection, cardNumber: card.cardNumber,
        variant: card.variant, condition: card.condition, language: card.language,
        pricingMode: card.pricingMode, customValues: card.customValues, customBuyoutLast: card.customBuyoutLast,
        giveaway: card.giveaway, giveawayOptions: card.giveawayOptions, giveawayKind: card.giveawayKind ?? "giveaway", giveawayCorrectIndex: card.giveawayCorrectIndex ?? "", giveawayQuestion: card.giveawayQuestion ?? "",
        lotNumber: card.lotNumber, startingPrice: card.startingPrice, increment: card.increment, buyout: card.buyout,
        durationMinutes: card.durationMinutes, optionCount: card.optionCount,
        imageStage: card.imageUrl ? ("done" as const) : ("idle" as const),
        imageMessage: "",
      })));
      setFirstLot(state.firstLot);
      setGroupId(groups.some(group => group.id === state.groupId) ? state.groupId : "");
      setIntervalValue(state.intervalValue);
      setEndMode(state.endMode ?? "duration"); setCommonEndInput(state.commonEndInput || defaultCommonEndInput());
      setIntervalUnit(state.intervalUnit);
      setPublication(state.publication);
      setScheduledInput(state.scheduledInput || defaultSchedule());
      setStep(state.step);
      setActiveDraftId(id);
      setSelectedCards(new Set());setLastBulkChange([]);setBulkFeedback({message:"",error:false});
      submission.current = null;
      lastSavedDraftFingerprint.current=auctionDraftJson(state);setDraftStatus("Salvo");
      setDraftNotice("Rascunho aberto. Fotos e configurações restauradas.");
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
    if (busy || draftBusy || uploadWork.current) return;
    if (previewQueue.current?.busy) { setError("Aguarde a preparação das fotos antes de publicar."); return; }
    if(submission.current){setBusy(true);setError("");try{await sendQueueCreation(true);}catch(reason){setError(reason instanceof Error?reason.message:"Confirmação pendente.");}finally{setBusy(false);}return;}
    const message = validateCards() || validateValues() || validatePublication();
    if (message) { setError(message); return; }
    uploadWork.current = true;
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
        queue: { group_id: groupId, starts_at: startsAt, interval_seconds: intervalSeconds, ...(endMode === "common" && hasAuctions ? {ends_at:brasiliaInputToIso(commonEndInput)} : {}) },
        items: cards.map(card => {
          // Brinde: sem leilão — foto + enquete livre no lugar do lote.
          if (card.giveaway) {
            return {
              card: { name: card.name, image_url: imageUrls.get(card.id) || null },
              auction: {},
              giveaway: { options: card.giveawayOptions.split(/\r?\n/).map(line => line.trim()).filter(Boolean), kind: card.giveawayKind, correctIndex: card.giveawayCorrectIndex === "" ? null : Number(card.giveawayCorrectIndex), question: card.giveawayQuestion },
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
      submission.current = {eventId:creationId.current,payload:core};
      await sendQueueCreation(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao iniciar a fila."); }
    finally { uploadWork.current = false; setBusy(false); }
  }

  async function sendQueueCreation(retry:boolean){
    const pending=submission.current;if(!pending)return;
    setPendingConfirmation(true);
    if(session)storePendingCreation(sessionStorage,pendingCreationKey("batch",session.user.id),pending);
    let data;
    try{data=await submitAuctionCreation({authFetch,kind:"batch",operation:pending,retry});}
    catch(error){
      if(error instanceof CreationRejectedError){
        // Keep creationId: even an unusually delayed old request must share
        // the same DB idempotency lock after the operator edits the form.
        submission.current=null;setPendingConfirmation(false);
        if(session)storePendingCreation(sessionStorage,pendingCreationKey("batch",session.user.id),{...pending,editable:true});
      }
      throw error;
    }
      const id = String(data.queue?.id ?? ""); if (!id) throw new Error("Fila criada sem identificador.");
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
      submission.current=null;setPendingConfirmation(false);if(session)storePendingCreation(sessionStorage,pendingCreationKey("batch",session.user.id),null);
  }

  // Edição de lote pendente: valores default do diálogo a partir do item atual.
  function itemEditDefaults(item: NonNullable<QueueView["items"][number]["dispatch"]> extends never ? never : QueueView["items"][number]) {
    const buyout = item.auction?.buyout_price != null ? String(item.auction.buyout_price) : "";
    const durationMinutes = item.dispatch?.duration_seconds ? String(Number(item.dispatch.duration_seconds) / 60) : "2";
    const optionCount = item.dispatch?.poll_options?.length ? String(item.dispatch.poll_options.length) : String(DEFAULT_POLL_OPTIONS);
    return {
      startingPrice: item.auction?.starting_price != null ? String(item.auction.starting_price) : "5",
      bidIncrement: item.auction?.bid_increment != null ? String(item.auction.bid_increment) : "1",
      buyout,
      durationMinutes,
      optionCount,
      imageUrl: item.card?.image_url ?? "",
    };
  }

  async function saveItemEdit(form: HTMLFormElement) {
    if (!queueId || !editingItem?.dispatch || busy) return;
    const fields = new FormData(form);
    const buyout = String(fields.get("buyout_price") ?? "").trim();
    const optionCount = String(fields.get("option_count") ?? "").trim();
    setBusy(true); setError("");
    try {
      const response = await authFetch("/api/auctions/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        queueId, action: "edit_item", dispatchId: editingItem.dispatch.id,
        updates: {
          starting_price: Number(fields.get("starting_price")),
          bid_increment: Number(fields.get("bid_increment")),
          buyout_price: buyout ? Number(buyout) : null,
          duration_minutes: queueView?.queue.ends_at ? Number(editingItem.dispatch.duration_seconds ?? 120)/60 : Number(fields.get("duration_minutes")),
          ...(buyout ? {} : { option_count: Number(optionCount || DEFAULT_POLL_OPTIONS) }),
          image_url: String(fields.get("image_url") ?? "").trim(),
        },
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível editar o lote.");
      setQueueView(body as QueueView);
      setEditingItem(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao editar o lote."); }
    finally { setBusy(false); }
  }

  async function control(action: "pause" | "resume" | "cancel") {    if (!queueId || busy) return;
    if (action === "cancel" && !window.confirm("Cancelar todas as cartas ainda não publicadas desta fila?")) return;
    setBusy(true); setError("");
    try {
      const response = await authFetch("/api/auctions/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queueId, action }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível alterar a fila."); setQueueView(body as QueueView);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao alterar a fila."); }
    finally { setBusy(false); }
  }

  if (!ready) return <main id="main-content" tabIndex={-1} className="shell"><p>Carregando…</p></main>;
  if (!session) return <main id="main-content" tabIndex={-1} className="shell"><section className="panel"><h1>Novos leilões</h1><p className="muted">Entre primeiro no painel.</p><Link href="/">Voltar</Link></section></main>;

  if (queueId) {
    const status = queueView?.queue.status ?? "scheduled";
    const firstWaiting = queueView?.items.findIndex(item => item.dispatch?.status === "scheduled") ?? -1;
    return <main id="main-content" tabIndex={-1} className="shell batch-shell">
      <header className="topbar"><div><p className="eyebrow">FILA DE PUBLICAÇÃO</p><h1>{queueView?.summary.published ?? 0} de {queueView?.summary.total ?? 0} publicados</h1><p className="muted">A fila fica no servidor e continua mesmo com o navegador fechado.</p></div><div className="topbar-actions"><button className="secondary" onClick={() => { setQueueId(null); setQueueView(null); setCards([]); setSelectedCards(new Set());setLastBulkChange([]);setBulkFeedback({message:"",error:false});setStep(1); setSearch(""); setTypeFilter("all"); creationId.current=crypto.randomUUID(); window.history.replaceState(null, "", "/auctions/new"); }}>＋ Novo leilão</button><Link href="/">← Painel</Link></div></header>
      {error && <p className="alert" role="alert">{error}</p>}
      <section className="panel queue-summary"><div><span>Status</span><strong>{status === "paused" ? "⏸ Pausada" : status === "cancelled" ? "⛔ Cancelada" : status === "completed" ? "✅ Concluída" : "🟢 Em execução"}</strong></div><div><span>Próxima publicação</span><strong>{queueView?.summary.nextScheduledAt ? formatBrasiliaTime(queueView.summary.nextScheduledAt) : "—"}</strong></div><div><span>Intervalo</span><strong>{queueView ? `${queueView.queue.interval_seconds}s` : "—"}</strong></div><div><span>Grupo</span><strong>{queueView?.group?.name ?? "—"}</strong></div></section>
      <section className="panel"><div className="panel-title"><div><h2>Fila</h2><p className="muted">Horários em America/Sao_Paulo.</p></div><div className="actions">{["scheduled", "running"].includes(status) && <button disabled={busy} onClick={() => void control("pause")}>Pausar fila</button>}{status === "paused" && <button disabled={busy} onClick={() => void control("resume")}>Continuar fila</button>}{!["completed", "cancelled"].includes(status) && <button className="secondary" disabled={busy} onClick={() => void control("cancel")}>Cancelar fila</button>}</div></div>
        <div className="queue-list">{queueView?.items.map((item, index) => {
  if (item.poll) {
    const pollSent = Boolean(item.poll.sent_at);
    return <article className={`queue-row ${pollSent ? "sent" : "scheduled"}`} key={item.poll.id}><span className="queue-icon">{item.poll.game_kind === "quiz" ? "🧩" : "🎁"}</span><div><strong>{item.poll.title}</strong><p>{item.poll.winner_name ? `Vencedor: ${item.poll.winner_name}` : pollSent ? `${item.poll.game_kind === "quiz" ? "quiz" : "brinde"} publicado` : `agendado`}{item.poll.image_url ? "" : " · sem foto"}</p></div><time>{formatBrasiliaTime(item.poll.scheduled_at)}</time></article>;
  }
  const itemStatus = item.dispatch!.status, icon = itemStatus === "sent" ? "✅" : itemStatus === "sending" ? "🟢" : itemStatus === "failed" ? "❌" : itemStatus === "cancelled" ? "⛔" : "⏳", description = itemStatus === "sent" ? "publicado" : itemStatus === "sending" ? "publicando" : itemStatus === "failed" ? `erro após ${item.dispatch!.attempts} tentativa(s)` : itemStatus === "cancelled" ? "cancelado" : index === firstWaiting ? `em ${formatBrasiliaTime(item.dispatch!.scheduled_at)}` : "aguardando"; return <article className={`queue-row ${itemStatus}`} key={item.dispatch!.id}><span className="queue-icon">{icon}</span><div><strong>Lote {item.auction?.lot_number ?? "—"} — {item.card?.name ?? "Carta"}</strong><p>{description}{item.dispatch!.last_error ? ` · ${item.dispatch!.last_error}` : ""}</p>{itemStatus === "scheduled" && <button className="secondary" style={{ marginTop: 6 }} onClick={() => setEditingItem(item)}>✏️ Editar lote</button>}</div><time>{formatBrasiliaTime(item.dispatch!.scheduled_at)}</time></article>; })}</div>
      </section>
      {editingItem && <dialog ref={editItemDialog} className="panel modal" aria-label="Editar lote" onCancel={event => { if (busy) event.preventDefault(); else setEditingItem(null); }}><h2>Editar lote {editingItem.auction?.lot_number ?? ""} — {editingItem.card?.name ?? "Carta"}</h2><p className="muted">Só lotes ainda não publicados. A enquete é re-gerada com os novos valores; a posição e o horário na fila não mudam.</p>
        <form className="form-grid" onSubmit={event => { event.preventDefault(); void saveItemEdit(event.currentTarget); }}>
          <label>Lance inicial (R$)<input name="starting_price" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={itemEditDefaults(editingItem).startingPrice} required /></label>
          <label>Incremento (R$)<input name="bid_increment" type="number" min="0.01" max="9999999999.99" step="0.01" defaultValue={itemEditDefaults(editingItem).bidIncrement} required /></label>
          <label>ARREMATE (opcional)<input name="buyout_price" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={itemEditDefaults(editingItem).buyout} /></label>
          <label>Duração (min)<input name="duration_minutes" type="number" min="0.1" step="0.1" defaultValue={itemEditDefaults(editingItem).durationMinutes} disabled={Boolean(queueView?.queue.ends_at)} required /></label>
          {!itemEditDefaults(editingItem).buyout && <label>Opções da enquete<input name="option_count" type="number" min="2" max={MAX_POLL_OPTIONS} defaultValue={itemEditDefaults(editingItem).optionCount} /></label>}
          <label className="wide">URL da imagem (HTTPS, opcional)<input name="image_url" type="url" defaultValue={itemEditDefaults(editingItem).imageUrl} /></label>
          <div className="actions"><button disabled={busy}>{busy ? "Salvando…" : "Salvar lote"}</button><button type="button" disabled={busy} onClick={() => setEditingItem(null)}>Cancelar</button></div>
        </form></dialog>}
    </main>;
  }

  return <main id="main-content" tabIndex={-1} className="shell batch-shell">
    <header className="topbar"><div><p className="eyebrow">NOVOS LEILÕES</p><h1>Cadastro em lote</h1><p className="muted">Adicione várias cartas, defina a ordem e deixe o bot publicar sozinho.</p></div><div className="topbar-actions"><Link className="button-link" href="/auctions/brinde">🎁 Brindes e Quiz</Link><button className="secondary" disabled={draftBusy || busy || pendingConfirmation || preparingPreviews || !cards.length} onClick={() => void saveDraft()}>{draftBusy ? "Salvando…" : "💾 Salvar rascunho"}</button><Link href="/">← Cancelar</Link></div></header>
    {pendingConfirmation && <section className="panel pending-confirmation" role="status"><strong>Confirmação de publicação pendente</strong><p>A tentativa anterior pode ter sido salva. Confira a mesma operação antes de iniciar outra fila.</p><button disabled={busy} onClick={()=>void startQueue()}>{busy?"Conferindo…":"Confirmar envio anterior"}</button></section>}
    <fieldset className="wizard-workspace" disabled={busy || pendingConfirmation}>
    <nav className="batch-steps" aria-label="Etapas do cadastro">{["Cartas", "Valores", "Publicação", "Revisar"].map((label, index) => <button key={label} aria-current={step === index + 1 ? "step" : undefined} aria-disabled={index + 1 > step} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => index + 1 < step && setStep(index + 1)}>{index + 1}. {label}</button>)}</nav>
    {error && <p id="wizard-error" className="alert" role="alert">{error}</p>}
    {draftNotice && <p className="notice" role="status">{draftStatus==="Alterações pendentes"?"Há alterações ainda não salvas.":draftNotice}</p>}
    {!!cards.length && <><p className="draft-save-state" role="status">{draftStatus==="Salvo"&&currentDraftFingerprint()!==lastSavedDraftFingerprint.current?"Alterações pendentes":draftStatus}</p><DraftToolbar search={search} filter={typeFilter} count={filteredCards.length} onSearch={setSearch} onFilter={setTypeFilter} onJump={jumpToCard} onCollapse={()=>setCards(current=>current.map(card=>({...card,expanded:false})))}/></>}
    {!!cards.length && step<=2 && <SelectionEditor cards={cards} selected={selectedCards} filteredIds={filteredCards.map(({card})=>card.id)} disabled={busy||draftBusy||pendingConfirmation} allowDuration={endMode==="duration"} canUndo={lastBulkChange.length>0} message={bulkFeedback.message} error={bulkFeedback.error} onSelect={ids=>setSelectedCards(current=>new Set([...current,...ids]))} onClear={()=>setSelectedCards(new Set())} onApply={applySelected} onUndo={undoSelected} />}
    {preparingPreviews && <p className="notice" role="status">Preparando fotos: {previewProgress.completed} de {previewProgress.total}. Você pode continuar preenchendo as cartas.</p>}

    {step === 1 && <><section className="panel drop-panel" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><p className="eyebrow">ETAPA 1</p><h2 ref={stepTitle} tabIndex={-1}>Adicionar cartas</h2><p className="muted">Selecione até 200 fotos e preencha os dados enquanto as prévias são preparadas. As fotos originais são preservadas para a publicação.</p><div className="actions"><label className="button-like">＋ Selecionar imagens<input className="sr-only" type="file" multiple disabled={busy || draftBusy} accept="image/jpeg,image/png,image/webp" onChange={event => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} /></label><button className="secondary" type="button" disabled={busy || draftBusy} onClick={addEmpty}>Adicionar sem imagem</button></div></section>
      {!cards.length && drafts.length > 0 && <section className="panel drafts-panel"><div className="panel-title"><div><h2>Rascunhos salvos</h2><p className="muted">Continue de onde parou — as fotos já estão no servidor. Publicar a fila apaga o rascunho automaticamente.</p></div></div><div className="draft-list">{drafts.map(draft => <article className="draft-row" key={draft.id}><div className="draft-row-info"><strong>{draft.title}</strong><span>Salvo em {formatBrasiliaDateTime(draft.updated_at, false)}</span></div><div className="actions"><button disabled={draftBusy} onClick={() => void openDraft(draft.id)}>Abrir</button><button className="danger-link" disabled={draftBusy} onClick={() => { if (window.confirm("Excluir este rascunho?")) void discardDraft(draft.id); }}>Excluir</button></div></article>)}</div></section>}
      {!!cards.length && <section className="panel"><div className="panel-title"><div><h2>{cards.length} carta(s)</h2><p className="muted">A ordem é a ordem de publicação. Preencha os dados de cada carta; nada é preenchido automaticamente.</p></div></div><div className="bulk-bar"><label>Idioma para todas<select value={bulkLanguage} onChange={e => setBulkLanguage(e.target.value)}>{cardLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button onClick={() => applyAll("language", bulkLanguage)}>Aplicar</button><label>Condição para todas<select value={bulkCondition} onChange={e => setBulkCondition(e.target.value)}>{cardConditions.map(item => <option key={item}>{item}</option>)}</select></label><button onClick={() => applyAll("condition", bulkCondition)}>Aplicar</button></div>
        <div className="draft-list">{visibleCards.map(({card, index}) => <article data-card-id={card.id} key={card.id} className="draft-card" data-selected={selectedCards.has(card.id)||undefined} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragging != null) moveCard(dragging, index); setDragging(null); }}><div className="draft-head"><label className="card-selection"><input type="checkbox" aria-label={`Selecionar carta ${index+1}`} checked={selectedCards.has(card.id)} onChange={event=>selectCard(card.id,event.target.checked)}/><span>Selecionar</span></label><span className="drag-handle" title="Arraste para mudar a ordem" draggable onDragStart={() => setDragging(index)} onDragEnd={() => setDragging(null)}>☰</span><div className="draft-thumb">{card.preview || card.imageUrl ? <img src={card.preview || card.imageUrl} alt="" loading="lazy" decoding="async" /> : <span>🃏</span>}</div><div className="draft-title"><strong>{index + 1}. {card.giveaway ? (card.giveawayKind === "quiz" ? "🧩 " : "🎁 ") : ""}{card.name || "Carta sem nome"}</strong><span>{card.cardNumber || "Sem número"}</span>{card.giveaway && <span className="brinde-inline">{card.giveawayKind === "quiz" ? "🧩 Quiz — primeiro acerto ganha a carta" : "🎁 Brinde — primeiro acerto ganha a carta"}</span>}{card.imageMessage && <span className={card.imageStage === "error" ? "alert" : "muted"}>Imagem: {card.imageMessage}</span>}</div><div className="draft-actions"><button className="secondary" aria-label={`Mover carta ${index + 1} para cima`} onClick={() => moveCard(index, index - 1)} disabled={index === 0}>↑</button><button className="secondary" aria-label={`Mover carta ${index + 1} para baixo`} onClick={() => moveCard(index, index + 1)} disabled={index === cards.length - 1}>↓</button><label className="card-kind-control">Tipo da carta<select aria-label={`Tipo da carta ${index+1}`} value={card.giveaway ? card.giveawayKind : "auction"} onChange={e=>mutateCard(card.id,{giveaway:e.target.value!=="auction",giveawayKind:e.target.value==="quiz"?"quiz":"giveaway",expanded:true})}><option value="auction">🃏 Leilão</option><option value="giveaway">🎁 Brinde</option><option value="quiz">🧩 Quiz</option></select></label><button className="secondary" onClick={() => mutateCard(card.id, { expanded: !card.expanded })}>{card.expanded ? "Fechar" : "Editar"}</button><button className="danger-link" onClick={() => removeCard(index)}>Remover</button></div></div>{card.expanded && <div className="draft-fields"><label>Nome<input value={card.name} onChange={e => mutateCard(card.id, { name: e.target.value })} /></label><label>Número da carta<input placeholder="35/64" value={card.cardNumber} onChange={e => mutateCard(card.id, { cardNumber: e.target.value })} /></label>{card.giveaway && <GameAnswerFields kind={card.giveawayKind} options={card.giveawayOptions} correctIndex={card.giveawayCorrectIndex} question={card.giveawayQuestion} disabled={busy || pendingConfirmation} onOptions={value => mutateCard(card.id, { giveawayOptions: value, giveawayCorrectIndex: "" })} onCorrect={value => mutateCard(card.id, { giveawayCorrectIndex: value })} onQuestion={value => mutateCard(card.id, { giveawayQuestion: value })} />}{!card.giveaway && <div className="draft-fields-extra wide"><span className="extra-label">Fotos de detalhe ({card.extraFiles.length + card.extraImages.length}/4){card.extraImages.length>0&&<span className="extra-thumbs">{card.extraImages.map((url,imageIndex)=><span className="extra-thumb" key={url}><img src={url} alt={`Detalhe ${imageIndex+1}`} loading="lazy"/><button type="button" aria-label={`Remover detalhe salvo ${imageIndex+1}`} onClick={()=>mutateCard(card.id,{extraImages:card.extraImages.filter(image=>image!==url)})}>×</button></span>)}</span>}{card.extraFiles.length ? <span className="extra-thumbs">{card.extraPreviews.map((url, index) => <span className="extra-thumb" key={url}><img src={url} alt="" loading="lazy" decoding="async" /><button type="button" title="Remover" onClick={() => { const url = card.extraPreviews[index]; const shared = cards.some((other) => other.id !== card.id && other.extraPreviews.includes(url)); if (!shared) URL.revokeObjectURL(url); mutateCard(card.id, { extraFiles: card.extraFiles.filter((_, i) => i !== index), extraPreviews: card.extraPreviews.filter((_, i) => i !== index) }); }}>×</button></span>)}</span> : null}</span><label className="button-like">＋ Detalhes{card.extraFiles.length + card.extraImages.length < 4 ? <input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => { const room = 4 - card.extraFiles.length - card.extraImages.length; const files = Array.from(event.target.files ?? []).slice(0, room); if (files.length) { const urls = files.map(file => URL.createObjectURL(file)); for (const url of urls) previewUrls.current.add(url); mutateCard(card.id, { extraFiles: [...card.extraFiles, ...files], extraPreviews: [...card.extraPreviews, ...urls] }); } event.currentTarget.value = ""; }} /> : null}</label></div>}<label>Variante<input aria-label="Variante" list={`variants-${card.id}`} value={card.variant} onChange={e => mutateCard(card.id, { variant: e.target.value })} /><datalist id={`variants-${card.id}`}>{variants.map(item => <option key={item} value={item} />)}</datalist></label><label>Condição<select value={card.condition} onChange={e => mutateCard(card.id, { condition: e.target.value })}>{cardConditions.map(item => <option key={item}>{item}</option>)}</select></label><label>Idioma<select value={card.language} onChange={e => mutateCard(card.id, { language: e.target.value })}>{cardLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{!card.file && <label className="wide">URL HTTPS da imagem<input value={card.imageUrl} onChange={e => mutateCard(card.id, { imageUrl: e.target.value })} /></label>}{index > 0 && <><button className="secondary wide" disabled={busy||draftBusy||pendingConfirmation} onClick={() => copyPrevious(index)}>Copiar configurações da carta anterior</button><small className="wide muted">Copia idioma, condição e variante; entre leilões, também os valores. Fotos, lotes e respostas dos jogos são preservados.</small></>}</div>}</article>)}</div></section>}
      <div className="wizard-footer"><Link href="/">Cancelar</Link><button onClick={() => go(2)}>Continuar para valores →</button></div></>}

    {step === 2 && <><section className="panel"><p className="eyebrow">ETAPA 2</p><h2 ref={stepTitle} tabIndex={-1}>Valores</h2><p className="muted">{hasAuctions ? "Configure os valores dos leilões e revise os jogos. Brindes e quizzes não têm cobrança." : "Revise as respostas dos brindes e quizzes. Estes itens não têm lance ou cobrança."}</p>{hasAuctions && <div className="bulk-bar values"><label>Primeiro lote<input type="number" min="1" value={firstLot} onChange={e => setFirstLot(e.target.value)} /></label><button onClick={sequentialLots}>Numerar lotes</button><label>Lance inicial para todas<input type="number" min="0" step="0.01" value={bulkStart} onChange={e => setBulkStart(e.target.value)} /></label><button onClick={() => applyAll("startingPrice", bulkStart)}>Aplicar</button><label>Incremento para todas<input type="number" min="0.01" step="0.01" value={bulkIncrement} onChange={e => setBulkIncrement(e.target.value)} /></label><button onClick={() => applyAll("increment", bulkIncrement)}>Aplicar</button><label>Valores personalizados p/ todas<input inputMode="decimal" placeholder="Ex.: 1, 2, 5, 10" value={bulkCustomValues} onChange={e => setBulkCustomValues(e.target.value)} /></label><button onClick={() => { setCards(current => current.map(card => ({ ...card, pricingMode: "custom" as const, customValues: bulkCustomValues }))); submission.current = null; }}>Aplicar personalizados</button>{endMode === "duration" && <><label>Duração para todas (min)<input type="number" min="0.1" step="0.1" value={bulkDuration} onChange={e => setBulkDuration(e.target.value)} /></label><button onClick={() => applyAll("durationMinutes", bulkDuration)}>Aplicar</button></>}</div>}
      <div className="value-list">{visibleCards.map(({card, index}) => { const pricing = pricingOf(card); return <article data-card-id={card.id} className="value-row" data-selected={selectedCards.has(card.id)||undefined} key={card.id}><label className="card-selection"><input type="checkbox" aria-label={`Selecionar carta ${index+1}`} checked={selectedCards.has(card.id)} onChange={event=>selectCard(card.id,event.target.checked)}/><span>Selecionar</span></label><div><strong>{index + 1}. {card.name || "Carta"}</strong><span>{card.giveaway ? (card.giveawayKind === "quiz" ? "🧩 Quiz — primeiro acerto ganha a carta" : "🎁 Brinde — primeiro acerto ganha a carta") : pricing.error ? `⚠ ${pricing.error}` : `${pricing.options.length} opções`}</span></div>{card.giveaway ? <details className="game-review wide"><summary>{card.giveawayKind==="quiz"?"Quiz":"Brinde"} · {card.giveawayOptions.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)[Number(card.giveawayCorrectIndex)]||"Selecione a resposta correta"} · revisar opções</summary><GameAnswerFields kind={card.giveawayKind} options={card.giveawayOptions} correctIndex={card.giveawayCorrectIndex} question={card.giveawayQuestion} onOptions={value=>mutateCard(card.id,{giveawayOptions:value,giveawayCorrectIndex:""})} onCorrect={value=>mutateCard(card.id,{giveawayCorrectIndex:value})} onQuestion={value=>mutateCard(card.id,{giveawayQuestion:value})} /></details> : <><label>Lote<input type="number" min="1" value={card.lotNumber} onChange={e => mutateCard(card.id, { lotNumber: e.target.value })} /></label><label>Valores<select value={card.pricingMode} onChange={e => mutateCard(card.id, { pricingMode: e.target.value === "custom" ? "custom" : "increment" })}><option value="increment">Automático</option><option value="custom">Personalizado</option></select></label>{endMode === "duration" && <label>Duração (min)<input type="number" min="0.1" step="0.1" value={card.durationMinutes} onChange={e => mutateCard(card.id, { durationMinutes: e.target.value })} /></label>}{card.pricingMode === "increment" ? <><label>Inicial<input type="number" min="0" step="0.01" value={card.startingPrice} onChange={e => mutateCard(card.id, { startingPrice: e.target.value })} /></label><label>Incremento<input type="number" min="0.01" step="0.01" value={card.increment} onChange={e => mutateCard(card.id, { increment: e.target.value })} /></label><label>ARREMATE<input type="number" min="0" step="0.01" placeholder="Opcional" value={card.buyout} onChange={e => mutateCard(card.id, { buyout: e.target.value })} /></label>{!card.buyout.trim() && <label>Opções<input type="number" min="2" max={MAX_POLL_OPTIONS} value={card.optionCount} onChange={e => mutateCard(card.id, { optionCount: e.target.value })} /></label>}</> : <><label className="wide">Valores da enquete (vírgula)<input inputMode="decimal" placeholder="Ex.: 1, 2, 5, 10" value={card.customValues} onChange={e => mutateCard(card.id, { customValues: e.target.value })} /></label><label className="radio-row"><input type="checkbox" checked={card.customBuyoutLast} onChange={e => mutateCard(card.id, { customBuyoutLast: e.target.checked })} /> Maior valor = ARREMATE</label></>}<div className="poll-mini">{pricing.options.slice(0, 4).map(option => <span key={option.label}>{option.label}</span>)}{pricing.options.length > 4 && <span>+{pricing.options.length - 4}</span>}</div></>}</article>; })}</div></section><div className="wizard-footer"><button className="secondary" onClick={() => setStep(1)}>← Cartas</button><button onClick={() => go(3)}>Continuar para publicação →</button></div></>}

    {step === 3 && <><section className="panel publication-panel"><p className="eyebrow">ETAPA 3</p><h2 ref={stepTitle} tabIndex={-1}>Publicação</h2>{hasAuctions && <div className="form-grid"><label>Encerramento<select value={endMode} onChange={e=>{setEndMode(e.target.value as "common" | "duration"); submission.current=null;}}><option value="common">Mesmo horário para todas as cartas</option><option value="duration">Duração individual por carta</option></select></label>{endMode === "common" && <label>Fim dos lances — data e horário de Brasília<input type="datetime-local" value={commonEndInput} onChange={e=>{setCommonEndInput(e.target.value);submission.current=null;}} required /><small>Leilões encerram neste horário, com resultados a cada 15 segundos. Brindes e quizzes terminam no primeiro acerto.</small></label>}</div>}<div className="publication-grid"><label>Grupo do WhatsApp<select value={groupId} onChange={e => { setGroupId(e.target.value); submission.current = null; }}><option value="">Selecione…</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div><span id="interval-label">Publicar nova enquete a cada</span><div className="inline-fields"><input aria-label="Intervalo entre publicações" type="number" min="1" value={intervalValue} onChange={e => { setIntervalValue(e.target.value); submission.current = null; }} /><select aria-label="Unidade do intervalo" value={intervalUnit} onChange={e => { setIntervalUnit(e.target.value as "seconds" | "minutes"); submission.current = null; }}><option value="seconds">segundos</option><option value="minutes">minutos</option></select></div></div><fieldset><legend>Começar</legend><label className="radio-row"><input type="radio" checked={publication === "now"} onChange={() => setPublication("now")} /> ▶ Agora</label><label className="radio-row"><input type="radio" checked={publication === "scheduled"} onChange={() => setPublication("scheduled")} /> 🕒 Agendar</label></fieldset>{publication === "scheduled" && <label>Data e horário de Brasília<input type="datetime-local" value={scheduledInput} onChange={e => setScheduledInput(e.target.value)} /><small>America/Sao_Paulo</small></label>}</div><details className="more-options"><summary>Mais opções</summary><p className="muted">O horário comum encerra os lances de todas as cartas ao mesmo tempo. No modo de duração individual, cada carta usa seus minutos configurados.</p></details></section><div className="wizard-footer"><button className="secondary" onClick={() => setStep(2)}>← Valores</button><button onClick={() => go(4)}>Revisar fila →</button></div></>}

    {step === 4 && <><section className="panel review-panel"><p className="eyebrow">ETAPA 4</p><h2 ref={stepTitle} tabIndex={-1}>Revisar e iniciar</h2><div className="review-summary"><div><span>Itens na fila</span><strong>{cards.length}</strong><small>{cards.filter(card=>!card.giveaway).length} leilões · {cards.filter(card=>card.giveaway&&card.giveawayKind==="giveaway").length} brindes · {cards.filter(card=>card.giveaway&&card.giveawayKind==="quiz").length} quizzes</small></div><div><span>Lotes</span><strong>{cards.filter(card=>!card.giveaway)[0]?.lotNumber ?? "—"} → {cards.filter(card=>!card.giveaway).at(-1)?.lotNumber ?? "—"}</strong></div><div><span>Primeira publicação</span><strong>{publication === "now" ? "Agora" : startInstant ? formatBrasiliaDateTime(startInstant, false) : "—"}</strong></div><div><span>Última publicação prevista</span><strong>{startInstant?formatBrasiliaDateTime(new Date(startInstant.getTime()+Math.max(0,cards.length-1)*intervalSeconds*1000),false):"—"}</strong><small>Intervalo de {intervalSeconds}s</small></div><div><span>Grupo</span><strong>{groups.find(group => group.id === groupId)?.name ?? "—"}</strong></div></div><div className="review-list">{visibleCards.map(({card, index}) => { const start = startInstant ? new Date(startInstant.getTime() + index * intervalSeconds * 1000) : null, end = endMode === "common" ? (()=>{const iso=brasiliaInputToIso(commonEndInput);return iso?new Date(iso):null;})() : start ? new Date(start.getTime() + Math.round(Number(card.durationMinutes) * 60_000)) : null; return <article key={card.id}><div className="draft-thumb">{card.preview || card.imageUrl ? <img src={card.preview || card.imageUrl} alt="" loading="lazy" decoding="async" /> : <span>🃏</span>}</div><div><strong>{card.giveaway ? (card.giveawayKind === "quiz" ? "Quiz" : "Brinde") : `Lote ${card.lotNumber}`} — {card.name}</strong><p>{card.giveaway ? `${card.giveawayKind === "quiz" ? "🧩 Quiz" : "🎁 Brinde"} · resposta vencedora: ${card.giveawayOptions.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)[Number(card.giveawayCorrectIndex)] ?? "não selecionada"}` : card.pricingMode === "custom" ? (() => { const pricing = pricingOf(card); return `Valores personalizados (${pricing.options.length}) · ${pricing.buyoutPrice != null ? `ARREMATE ${money(pricing.buyoutPrice)}` : "Sem ARREMATE"}`; })() : `${money(Number(card.startingPrice))} + ${money(Number(card.increment))} · ${card.buyout ? `ARREMATE ${money(Number(card.buyout))}` : "Sem ARREMATE"}`}</p>{card.giveaway&&<details className="game-review"><summary>Prévia da enquete no WhatsApp</summary><p>{card.giveawayKind==="quiz"?card.giveawayQuestion:`Brinde: ${card.name}`}</p><ul>{card.giveawayOptions.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((option,i)=><li key={i}>{option}{String(i)===card.giveawayCorrectIndex?" · correta (somente no painel)":""}</li>)}</ul></details>}<p>Publica: {start ? formatBrasiliaTime(start) : "Agora"}{card.giveaway ? " · até o primeiro acerto" : " · Encerra:"} {!card.giveaway && (end ? (endMode === "common" ? formatBrasiliaDateTime(end, false) : formatBrasiliaTime(end)) : "—")}</p>{card.imageMessage && <p className="muted">Imagem: {card.imageMessage}</p>}</div></article>; })}</div>{uploadProgress && <p className="notice" role="status">{uploadProgress}</p>}</section><div className="wizard-footer"><button className="secondary" disabled={busy} onClick={() => setStep(3)}>← Publicação</button><button disabled={busy || draftBusy || preparingPreviews} onClick={() => void startQueue()}>{busy ? "Preparando fila…" : publication === "now" ? "▶ Iniciar fila agora" : "🕒 Agendar fila"}</button></div></>}
    </fieldset>
  </main>;
}
