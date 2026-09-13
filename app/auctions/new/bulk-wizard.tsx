"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { buildPollPlan, cardConditions, cardLanguages, DEFAULT_POLL_OPTIONS, MAX_POLL_OPTIONS } from "@/lib/auction-wizard";
import { brasiliaInputToIso, formatBrasiliaDateTime, formatBrasiliaTime, toBrasiliaInput } from "@/lib/brasilia-time";
import { uploadCardImageBatch, type CardImageStage } from "@/lib/card-image";
import { mergeRecognitionFields, type ManualFieldMap, type RecognitionCandidate, type RecognizableField } from "@/lib/card-recognition-core";
import { recognizePokemonCard, shutdownCardRecognition } from "@/lib/card-recognition-browser";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; is_default: boolean };
type RecognitionStage = "idle" | "queued" | "analyzing" | "identified" | "review" | "not-found" | "error" | "unavailable";
type Draft = {
  id: string; file: File | null; preview: string; imageUrl: string; imageStage: CardImageStage; imageMessage: string;
  name: string; collection: string; cardNumber: string; variant: string; condition: string; language: string;
  lotNumber: string; startingPrice: string; increment: string; buyout: string; durationMinutes: string; optionCount: string; expanded: boolean;
  recognitionStage: RecognitionStage; recognitionConfidence: number | null; recognitionMessage: string; recognitionCandidates: RecognitionCandidate[]; manualFields: ManualFieldMap;
};
type QueueView = {
  queue: { id: string; status: string; interval_seconds: number; starts_at: string; total_items: number };
  group: { id: string; name: string } | null;
  summary: { total: number; published: number; failed: number; pending: number; nextScheduledAt: string | null };
  items: Array<{
    dispatch: { id: string; status: string; scheduled_at: string; sent_at: string | null; attempts: number; last_error: string | null; queue_position: number };
    auction: { id: string; lot_number: number; status: string; scheduled_end_at: string | null; final_price: number | null; win_type: string | null } | null;
    card: { id: string; name: string; image_url: string | null } | null;
  }>;
};

const variants = ["Normal", "Holo", "Reverse Holo", "Full Art", "Illustration Rare", "Secret Rare", "Promo"];
const recognizableFields = new Set<RecognizableField>(["name", "collection", "cardNumber", "language", "variant"]);
const money = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
const defaultSchedule = () => toBrasiliaInput(new Date(Date.now() + 5 * 60_000));

function draftFor(file: File | null, preview: string, lot: number, expanded: boolean): Draft {
  return {
    id: crypto.randomUUID(), file, preview, imageUrl: "", imageStage: "idle", imageMessage: file ? "Aguardando otimização" : "",
    name: file ? baseName(file.name) : "", collection: "", cardNumber: "",
    variant: "Normal", condition: cardConditions[0], language: "pt-BR", lotNumber: String(lot), startingPrice: "5", increment: "1",
    buyout: "", durationMinutes: "2", optionCount: String(DEFAULT_POLL_OPTIONS), expanded,
    recognitionStage: file ? "idle" : "unavailable", recognitionConfidence: null, recognitionMessage: file ? "Aguardando reconhecimento local" : "Adicione uma imagem para reconhecer", recognitionCandidates: [], manualFields: {},
  };
}

function recognitionLabel(card: Draft) {
  if (card.recognitionStage === "identified") return `✅ Carta identificada ${card.recognitionConfidence ?? 0}%`;
  if (card.recognitionStage === "review") return `🟡 Verifique os dados · ${card.recognitionConfidence ?? 0}%`;
  if (card.recognitionStage === "not-found") return "🔴 Não consegui identificar com segurança";
  if (card.recognitionStage === "error") return "⚠ Reconhecimento indisponível";
  if (card.recognitionStage === "queued") return "🔍 Na fila de reconhecimento…";
  if (card.recognitionStage === "analyzing") return `🔍 ${card.recognitionMessage || "Analisando localmente…"}`;
  return card.recognitionMessage;
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
  const [bulkCollection, setBulkCollection] = useState("");
  const [bulkLanguage, setBulkLanguage] = useState("pt-BR");
  const [bulkCondition, setBulkCondition] = useState<string>(cardConditions[0]);
  const [bulkStart, setBulkStart] = useState("5");
  const [bulkIncrement, setBulkIncrement] = useState("1");
  const [bulkDuration, setBulkDuration] = useState("2");
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

  async function identifyCard(id: string, file: File, force = false) {
    if (recognitionInFlight.current.has(id)) return;
    recognitionInFlight.current.add(id);
    setCards(current => current.map(card => card.id === id ? { ...card, recognitionStage: "queued", recognitionMessage: "Na fila de reconhecimento…" } : card));
    const preferredLanguage = cards.find(card => card.id === id)?.language;
    try {
      const result = await recognizePokemonCard(file, preferredLanguage, message => {
        setCards(current => current.map(card => card.id === id ? { ...card, recognitionStage: "analyzing", recognitionMessage: message } : card));
      });
      setCards(current => current.map(card => {
        if (card.id !== id) return card;
        const recognized = mergeRecognitionFields(card as unknown as Record<string, unknown>, card.manualFields, result, force) as Partial<Draft>;
        const recognitionStage: RecognitionStage = result.level === "high" ? "identified" : result.level === "medium" ? "review" : "not-found";
        return {
          ...card,
          ...recognized,
          recognitionStage,
          recognitionConfidence: result.confidence,
          recognitionMessage: result.source === "cache" ? "Resultado reutilizado do cache local" : `${result.elapsedMs} ms · ${result.catalogRequests} consulta(s) ao catálogo`,
          recognitionCandidates: result.candidates,
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
      language: candidate.language,
      variant: candidate.variant ?? card.variant,
      manualFields: { ...card.manualFields, name: true, collection: true, cardNumber: true, language: true, ...(candidate.variant ? { variant: true } : {}) },
      recognitionStage: "identified",
      recognitionConfidence: Math.max(card.recognitionConfidence ?? 0, candidate.score),
      recognitionMessage: "Candidato escolhido manualmente",
    }));
  }

  useEffect(() => {
    for (const card of cards) {
      if (card.file && card.recognitionStage === "idle" && !recognitionInFlight.current.has(card.id)) void identifyCard(card.id, card.file);
    }
  }, [cards]);

  function addFiles(filesLike: FileList | File[]) {
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
    setCards(current => current.map((card, index) => ({ ...card, lotNumber: String(first + index) }))); submission.current = null; setError("");
  }
  function copyPrevious(index: number) {
    if (index < 1) return;
    const previous = cards[index - 1];
    mutateCard(cards[index].id, { collection: previous.collection, variant: previous.variant, condition: previous.condition, language: previous.language, startingPrice: previous.startingPrice, increment: previous.increment, buyout: previous.buyout, durationMinutes: previous.durationMinutes, optionCount: previous.optionCount });
  }
  function pollPlan(card: Draft) { return buildPollPlan(Number(card.startingPrice), Number(card.increment), card.buyout.trim() ? Number(card.buyout) : null, Number(card.optionCount || DEFAULT_POLL_OPTIONS)); }

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
      const card = cards[index], label = `Carta ${index + 1}`, lot = Number(card.lotNumber), start = Number(card.startingPrice), increment = Number(card.increment), buyout = card.buyout.trim() ? Number(card.buyout) : null, duration = Number(card.durationMinutes), plan = pollPlan(card);
      if (!Number.isSafeInteger(lot) || lot <= 0) return `${label}: lote inválido.`;
      if (lots.has(lot)) return `O lote ${lot} aparece duas vezes na fila.`; lots.add(lot);
      if (!Number.isFinite(start) || start < 0) return `${label} está sem Lance inicial válido.`;
      if (!Number.isFinite(increment) || increment <= 0) return `${label}: Incremento deve ser maior que R$ 0.`;
      if (buyout != null && (!Number.isFinite(buyout) || buyout <= start)) return `${label}: ARREMATE deve ser maior que o Lance inicial.`;
      if (!Number.isFinite(duration) || duration <= 0 || Math.round(duration * 60) > 604800) return `${label}: duração inválida.`;
      if (plan.overflow) return `${label}: a enquete teria ${plan.optionCount} opções; aumente o incremento.`;
      if (!plan.options.length || plan.options.length > MAX_POLL_OPTIONS) return `${label}: enquete inválida.`;
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

  async function uploadImages() {
    const urls = new Map<string, string>();
    const pending = cards.filter(card => card.file).map(card => ({ id: card.id, file: card.file! }));
    for (const card of cards) if (!card.file) urls.set(card.id, card.imageUrl.trim());
    if (!pending.length) return urls;

    const completed = new Set<string>();
    const uploaded = await uploadCardImageBatch({
      client: db,
      authFetch,
      items: pending,
      onStatus: (id, imageStage, imageMessage = "") => {
        if (imageStage === "done") completed.add(id);
        setUploadProgress(`${completed.size} de ${pending.length} imagem(ns) concluídas`);
        setCards(current => current.map(card => card.id === id ? { ...card, imageStage, imageMessage } : card));
      },
    });
    for (const [id, result] of uploaded) urls.set(id, result.url);
    setCards(current => current.map(card => {
      const result = uploaded.get(card.id);
      return result ? { ...card, file: null, imageUrl: result.url, imageStage: "done", imageMessage: card.imageMessage || "Concluída" } : card;
    }));
    return urls;
  }

  async function startQueue() {
    const message = validateCards() || validateValues() || validatePublication();
    if (message) { setError(message); return; }
    setBusy(true); setError("");
    try {
      const imageUrls = await uploadImages();
      const startsAt = publication === "now" ? new Date().toISOString() : brasiliaInputToIso(scheduledInput);
      if (!startsAt) throw new Error("Horário de início inválido.");
      const core = {
        queue: { group_id: groupId, starts_at: startsAt, interval_seconds: intervalSeconds },
        items: cards.map(card => ({
          card: { name: card.name, collection: card.collection, card_number: card.cardNumber, variant: card.variant, condition: card.condition, language: card.language, image_url: imageUrls.get(card.id) || null },
          auction: { lot_number: Number(card.lotNumber), starting_price: Number(card.startingPrice), bid_increment: Number(card.increment), buyout_price: card.buyout.trim() ? Number(card.buyout) : null, duration_seconds: Math.round(Number(card.durationMinutes) * 60), option_count: Number(card.optionCount || DEFAULT_POLL_OPTIONS) },
        })),
      };
      const payloadFingerprint = JSON.stringify(core);
      if (!submission.current || submission.current.fingerprint !== payloadFingerprint) submission.current = { fingerprint: payloadFingerprint, eventId: crypto.randomUUID() };
      const response = await authFetch("/api/auctions/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: submission.current.eventId, ...core }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível criar a fila.");
      const id = String(body.data?.queue?.id ?? ""); if (!id) throw new Error("Fila criada sem identificador.");
      setQueueId(id); setUploadProgress(""); window.history.replaceState(null, "", `/auctions/new?queue=${encodeURIComponent(id)}`);
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
    const firstWaiting = queueView?.items.findIndex(item => item.dispatch.status === "scheduled") ?? -1;
    return <main className="shell batch-shell">
      <header className="topbar"><div><p className="eyebrow">FILA DE PUBLICAÇÃO</p><h1>{queueView?.summary.published ?? 0} de {queueView?.summary.total ?? 0} publicados</h1><p className="muted">A fila fica no servidor e continua mesmo com o navegador fechado.</p></div><Link href="/">← Painel</Link></header>
      {error && <p className="alert" role="alert">{error}</p>}
      <section className="panel queue-summary"><div><span>Status</span><strong>{status === "paused" ? "⏸ Pausada" : status === "cancelled" ? "⛔ Cancelada" : status === "completed" ? "✅ Concluída" : "🟢 Em execução"}</strong></div><div><span>Próxima publicação</span><strong>{queueView?.summary.nextScheduledAt ? formatBrasiliaTime(queueView.summary.nextScheduledAt) : "—"}</strong></div><div><span>Intervalo</span><strong>{queueView ? `${queueView.queue.interval_seconds}s` : "—"}</strong></div><div><span>Grupo</span><strong>{queueView?.group?.name ?? "—"}</strong></div></section>
      <section className="panel"><div className="panel-title"><div><h2>Fila</h2><p className="muted">Horários em America/Sao_Paulo.</p></div><div className="actions">{["scheduled", "running"].includes(status) && <button disabled={busy} onClick={() => void control("pause")}>Pausar fila</button>}{status === "paused" && <button disabled={busy} onClick={() => void control("resume")}>Continuar fila</button>}{!["completed", "cancelled"].includes(status) && <button className="secondary" disabled={busy} onClick={() => void control("cancel")}>Cancelar fila</button>}</div></div>
        <div className="queue-list">{queueView?.items.map((item, index) => { const itemStatus = item.dispatch.status, icon = itemStatus === "sent" ? "✅" : itemStatus === "sending" ? "🟢" : itemStatus === "failed" ? "❌" : itemStatus === "cancelled" ? "⛔" : "⏳", description = itemStatus === "sent" ? "publicado" : itemStatus === "sending" ? "publicando" : itemStatus === "failed" ? `erro após ${item.dispatch.attempts} tentativa(s)` : itemStatus === "cancelled" ? "cancelado" : index === firstWaiting ? `em ${formatBrasiliaTime(item.dispatch.scheduled_at)}` : "aguardando"; return <article className={`queue-row ${itemStatus}`} key={item.dispatch.id}><span className="queue-icon">{icon}</span><div><strong>Lote {item.auction?.lot_number ?? "—"} — {item.card?.name ?? "Carta"}</strong><p>{description}{item.dispatch.last_error ? ` · ${item.dispatch.last_error}` : ""}</p></div><time>{formatBrasiliaTime(item.dispatch.scheduled_at)}</time></article>; })}</div>
      </section>
    </main>;
  }

  return <main className="shell batch-shell">
    <header className="topbar"><div><p className="eyebrow">NOVOS LEILÕES</p><h1>Cadastro em lote</h1><p className="muted">Adicione várias cartas, defina a ordem e deixe o bot publicar sozinho.</p></div><Link href="/">← Cancelar</Link></header>
    <nav className="batch-steps">{["Cartas", "Valores", "Publicação", "Revisar"].map((label, index) => <button key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => index + 1 < step && setStep(index + 1)}>{index + 1}. {label}</button>)}</nav>
    {error && <p className="alert" role="alert">{error}</p>}

    {step === 1 && <><section className="panel drop-panel" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}><p className="eyebrow">ETAPA 1</p><h2>Adicionar cartas</h2><p className="muted">Arraste 1, 20, 50 ou mais imagens. O reconhecimento roda localmente antes do upload; você pode editar enquanto a fila continua.</p><div className="actions"><label className="button-like">＋ Selecionar imagens<input hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ""; }} /></label><button className="secondary" type="button" onClick={addEmpty}>Adicionar sem imagem</button></div></section>
      {!!cards.length && <section className="panel"><div className="panel-title"><div><h2>{cards.length} carta(s)</h2><p className="muted">A ordem é a ordem de publicação. OCR e catálogo são auxiliares: suas correções manuais nunca são sobrescritas automaticamente.</p></div></div><div className="bulk-bar"><label>Coleção para todas<input value={bulkCollection} onChange={e => setBulkCollection(e.target.value)} /></label><button onClick={() => applyAll("collection", bulkCollection)}>Aplicar</button><label>Idioma para todas<select value={bulkLanguage} onChange={e => setBulkLanguage(e.target.value)}>{cardLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button onClick={() => applyAll("language", bulkLanguage)}>Aplicar</button><label>Condição para todas<select value={bulkCondition} onChange={e => setBulkCondition(e.target.value)}>{cardConditions.map(item => <option key={item}>{item}</option>)}</select></label><button onClick={() => applyAll("condition", bulkCondition)}>Aplicar</button></div>
        <div className="draft-list">{cards.map((card, index) => <article key={card.id} className="draft-card" draggable onDragStart={() => setDragging(index)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragging != null) moveCard(dragging, index); setDragging(null); }}><div className="draft-head"><span className="drag-handle">☰</span><div className="draft-thumb">{card.preview || card.imageUrl ? <img src={card.preview || card.imageUrl} alt="" /> : <span>🃏</span>}</div><div className="draft-title"><strong>{index + 1}. {card.name || "Carta sem nome"}</strong><span>{card.collection || "Sem coleção"} · {card.cardNumber || "Sem número"}</span>{card.recognitionMessage && <span className={`recognition-inline ${card.recognitionStage}`}>{recognitionLabel(card)}</span>}{card.imageMessage && card.imageStage !== "idle" && <span className={card.imageStage === "error" ? "alert" : "muted"}>Imagem: {card.imageMessage}</span>}</div><div className="draft-actions"><button className="secondary" onClick={() => moveCard(index, index - 1)} disabled={index === 0}>↑</button><button className="secondary" onClick={() => moveCard(index, index + 1)} disabled={index === cards.length - 1}>↓</button><button className="secondary" onClick={() => mutateCard(card.id, { expanded: !card.expanded }, false)}>{card.expanded ? "Fechar" : "Editar"}</button><button className="danger-link" onClick={() => removeCard(index)}>Remover</button></div></div>{card.expanded && <div className="draft-fields">{card.file && <div className={`recognition-box wide ${card.recognitionStage}`}><div><strong>{recognitionLabel(card)}</strong><small>{card.recognitionMessage}</small></div><button className="secondary" type="button" disabled={card.recognitionStage === "queued" || card.recognitionStage === "analyzing"} onClick={() => void identifyCard(card.id, card.file!, false)}>✨ {card.recognitionStage === "idle" ? "Identificar carta" : "Reconhecer novamente"}</button>{card.recognitionCandidates.length > 1 && card.recognitionStage !== "identified" && <div className="recognition-candidates"><span>Possíveis resultados:</span>{card.recognitionCandidates.slice(0, 3).map(candidate => <button type="button" className="secondary" key={`${candidate.language}-${candidate.id}`} onClick={() => useCandidate(card.id, candidate)}><strong>{candidate.name}</strong><small>{candidate.collection} · {candidate.cardNumber} · {candidate.language} · {candidate.score}%</small></button>)}</div>}</div>}<label>Nome<input value={card.name} onChange={e => mutateCard(card.id, { name: e.target.value })} /></label><label>Coleção / Edição<input value={card.collection} onChange={e => mutateCard(card.id, { collection: e.target.value })} /></label><label>Número da carta<input placeholder="35/64" value={card.cardNumber} onChange={e => mutateCard(card.id, { cardNumber: e.target.value })} /></label><label>Variante<input list={`variants-${card.id}`} value={card.variant} onChange={e => mutateCard(card.id, { variant: e.target.value })} /><datalist id={`variants-${card.id}`}>{variants.map(item => <option key={item} value={item} />)}</datalist></label><label>Condição<select value={card.condition} onChange={e => mutateCard(card.id, { condition: e.target.value })}>{cardConditions.map(item => <option key={item}>{item}</option>)}</select></label><label>Idioma<select value={card.language} onChange={e => mutateCard(card.id, { language: e.target.value })}>{cardLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{!card.file && <label className="wide">URL HTTPS da imagem<input value={card.imageUrl} onChange={e => mutateCard(card.id, { imageUrl: e.target.value })} /></label>}{index > 0 && <button className="secondary wide" onClick={() => copyPrevious(index)}>Copiar configurações da carta anterior</button>}</div>}</article>)}</div></section>}
      <div className="wizard-footer"><Link href="/">Cancelar</Link><button onClick={() => go(2)}>Continuar para valores →</button></div></>}

    {step === 2 && <><section className="panel"><p className="eyebrow">ETAPA 2</p><h2>Valores</h2><p className="muted">Cada enquete é gerada automaticamente pelo lance inicial, incremento e ARREMATE.</p><div className="bulk-bar values"><label>Primeiro lote<input type="number" min="1" value={firstLot} onChange={e => setFirstLot(e.target.value)} /></label><button onClick={sequentialLots}>Numerar lotes</button><label>Lance inicial para todas<input type="number" min="0" step="0.01" value={bulkStart} onChange={e => setBulkStart(e.target.value)} /></label><button onClick={() => applyAll("startingPrice", bulkStart)}>Aplicar</button><label>Incremento para todas<input type="number" min="0.01" step="0.01" value={bulkIncrement} onChange={e => setBulkIncrement(e.target.value)} /></label><button onClick={() => applyAll("increment", bulkIncrement)}>Aplicar</button><label>Duração para todas (min)<input type="number" min="0.1" step="0.1" value={bulkDuration} onChange={e => setBulkDuration(e.target.value)} /></label><button onClick={() => applyAll("durationMinutes", bulkDuration)}>Aplicar</button></div>
      <div className="value-list">{cards.map((card, index) => { const plan = pollPlan(card); return <article className="value-row" key={card.id}><div><strong>{index + 1}. {card.name || "Carta"}</strong><span>{plan.overflow ? `⚠ ${plan.optionCount} opções` : `${plan.options.length} opções`}</span></div><label>Lote<input type="number" min="1" value={card.lotNumber} onChange={e => mutateCard(card.id, { lotNumber: e.target.value })} /></label><label>Inicial<input type="number" min="0" step="0.01" value={card.startingPrice} onChange={e => mutateCard(card.id, { startingPrice: e.target.value })} /></label><label>Incremento<input type="number" min="0.01" step="0.01" value={card.increment} onChange={e => mutateCard(card.id, { increment: e.target.value })} /></label><label>ARREMATE<input type="number" min="0" step="0.01" placeholder="Opcional" value={card.buyout} onChange={e => mutateCard(card.id, { buyout: e.target.value })} /></label><label>Duração (min)<input type="number" min="0.1" step="0.1" value={card.durationMinutes} onChange={e => mutateCard(card.id, { durationMinutes: e.target.value })} /></label>{!card.buyout.trim() && <label>Opções<input type="number" min="2" max={MAX_POLL_OPTIONS} value={card.optionCount} onChange={e => mutateCard(card.id, { optionCount: e.target.value })} /></label>}<div className="poll-mini">{plan.options.slice(0, 4).map(option => <span key={option.label}>{option.label}</span>)}{plan.options.length > 4 && <span>+{plan.options.length - 4}</span>}</div></article>; })}</div></section><div className="wizard-footer"><button className="secondary" onClick={() => setStep(1)}>← Cartas</button><button onClick={() => go(3)}>Continuar para publicação →</button></div></>}

    {step === 3 && <><section className="panel publication-panel"><p className="eyebrow">ETAPA 3</p><h2>Publicação</h2><div className="publication-grid"><label>Grupo do WhatsApp<select value={groupId} onChange={e => { setGroupId(e.target.value); submission.current = null; }}><option value="">Selecione…</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Publicar nova enquete a cada<div className="inline-fields"><input type="number" min="1" value={intervalValue} onChange={e => { setIntervalValue(e.target.value); submission.current = null; }} /><select value={intervalUnit} onChange={e => { setIntervalUnit(e.target.value as "seconds" | "minutes"); submission.current = null; }}><option value="seconds">segundos</option><option value="minutes">minutos</option></select></div></label><fieldset><legend>Começar</legend><label className="radio-row"><input type="radio" checked={publication === "now"} onChange={() => setPublication("now")} /> ▶ Agora</label><label className="radio-row"><input type="radio" checked={publication === "scheduled"} onChange={() => setPublication("scheduled")} /> 🕒 Agendar</label></fieldset>{publication === "scheduled" && <label>Data e horário de Brasília<input type="datetime-local" value={scheduledInput} onChange={e => setScheduledInput(e.target.value)} /><small>America/Sao_Paulo</small></label>}</div><details className="more-options"><summary>Mais opções</summary><p className="muted">A duração de cada leilão é independente do intervalo entre publicações.</p></details></section><div className="wizard-footer"><button className="secondary" onClick={() => setStep(2)}>← Valores</button><button onClick={() => go(4)}>Revisar fila →</button></div></>}

    {step === 4 && <><section className="panel review-panel"><p className="eyebrow">ETAPA 4</p><h2>Revisar e iniciar</h2><div className="review-summary"><div><span>Cartas</span><strong>{cards.length}</strong></div><div><span>Lotes</span><strong>{cards[0]?.lotNumber ?? "—"} → {cards[cards.length - 1]?.lotNumber ?? "—"}</strong></div><div><span>Primeira publicação</span><strong>{publication === "now" ? "Agora" : startInstant ? formatBrasiliaDateTime(startInstant, false) : "—"}</strong></div><div><span>Intervalo</span><strong>{intervalSeconds}s</strong></div><div><span>Grupo</span><strong>{groups.find(group => group.id === groupId)?.name ?? "—"}</strong></div></div><div className="review-list">{cards.map((card, index) => { const start = startInstant ? new Date(startInstant.getTime() + index * intervalSeconds * 1000) : null, end = start ? new Date(start.getTime() + Math.round(Number(card.durationMinutes) * 60_000)) : null; return <article key={card.id}><div className="draft-thumb">{card.preview || card.imageUrl ? <img src={card.preview || card.imageUrl} alt="" /> : <span>🃏</span>}</div><div><strong>Lote {card.lotNumber} — {card.name}</strong><p>{money(Number(card.startingPrice))} + {money(Number(card.increment))} · {card.buyout ? `ARREMATE ${money(Number(card.buyout))}` : "Sem ARREMATE"}</p><p>Publica: {start ? formatBrasiliaTime(start) : "Agora"} · Encerra: {end ? formatBrasiliaTime(end) : "—"}</p>{card.imageMessage && <p className="muted">Imagem: {card.imageMessage}</p>}</div></article>; })}</div>{uploadProgress && <p className="notice">{uploadProgress}</p>}</section><div className="wizard-footer"><button className="secondary" disabled={busy} onClick={() => setStep(3)}>← Publicação</button><button disabled={busy} onClick={() => void startQueue()}>{busy ? "Preparando fila…" : publication === "now" ? "▶ Iniciar fila agora" : "🕒 Agendar fila"}</button></div></>}
  </main>;
}
