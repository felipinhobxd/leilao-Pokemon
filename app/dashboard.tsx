"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { createPublicSupabaseClient } from "@/lib/supabase";
import type { Command } from "@/lib/commands";
import type { Row, Snapshot } from "@/lib/backend";
import { money } from "@/lib/domain";
import { brasiliaInputToIso, formatBrasiliaTime, toBrasiliaInput } from "@/lib/brasilia-time";
import { isPurgeFinalPhrase, isPurgeStep1 } from "@/lib/purge";

type Editor = { kind: "CARD" | "PARTICIPANT" | "AUCTION"; row?: Row };
type DispatchStats = { successRate: number | null; sent: number; failed: number; pending: number; windowDays: number } | null;
type Operations = { bot: { workerId:string; status:string; online:boolean; connected:boolean; version:string|null } | null; group: { id:string; name:string } | null; dispatches?: DispatchStats };
const labelStatus: Record<string, string> = { active: "Ativo", suspended: "Suspenso", banned: "Bloqueado", available: "Disponível", archived: "Arquivada", in_auction: "Em leilão", draft: "Rascunho", open: "Aberto", sold: "Vendido", closed: "Sem vencedor", cancelled: "Cancelado" };
const str = (row: Row | undefined, key: string) => String(row?.[key] ?? "");
const price = (value: unknown) => money(value == null ? null : Number(value));
const saleType = (value: unknown) => value === "buyout" ? "Arremate" : value === "highest_bid" ? "Maior lance" : "—";
function remainingLabel(value: unknown, now: number) {
  if (!value) return "Sem prazo";
  const remaining = Date.parse(String(value)) - now;
  if (remaining <= 0) return "Encerrando…";
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

export default function Dashboard() {
  const [db] = useState(createPublicSupabaseClient);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [operations, setOperations] = useState<Operations>({ bot:null, group:null });
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [realtime, setRealtime] = useState("Conectando…");
  const [selected, setSelected] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [retry, setRetry] = useState<Command | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeStep1, setPurgeStep1] = useState("");
  const [purgeStep2, setPurgeStep2] = useState("");
  const revision = useRef(0);
  const fullLoadedAt = useRef(0);
  const refreshPending = useRef<Promise<void> | null>(null);
  const identity = useRef<string | null>(null);
  const accessToken = useRef<string | null>(null);
  const mutationLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const purgeDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editor && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [editor]);
  useEffect(() => { if (purgeOpen && purgeDialog.current && !purgeDialog.current.open) purgeDialog.current.showModal(); }, [purgeOpen]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const { data: subscription } = db.auth.onAuthStateChange((_event, next) => {
      accessToken.current = next?.access_token ?? null;
      setSession(next); setReady(true);
      if (identity.current !== (next?.user.id ?? null) || !next) { revision.current++; fullLoadedAt.current=0; setData(null); setOperations({bot:null,group:null}); setRetry(null); setEditor(null); }
      identity.current = next?.user.id ?? null;
    });
    return () => subscription.subscription.unsubscribe();
  }, [db]);
  const request = useCallback(async (url: string, init?: RequestInit) => {
    const { data: auth } = await db.auth.getSession();
    if (!auth.session) throw new Error("Entre novamente para continuar.");
    return fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${auth.session.access_token}` }, cache: "no-store" });
  }, [db]);
  const refresh = useCallback(async (force = true, operationsOnly = false) => {
    if (refreshPending.current) {
      const pendingIdentity = identity.current;
      await refreshPending.current;
      if (identity.current !== pendingIdentity) return;
      if (!force) return;
    }
    if (!force && !operationsOnly && Date.now()-fullLoadedAt.current < 2000) return;
    const version = ++revision.current;
    const work = (async () => {
      try {
        const response = await request(operationsOnly ? "/api/dashboard?scope=operations" : "/api/dashboard");
        const body = await response.json();
        if (version !== revision.current || !accessToken.current) return;
        if (!response.ok) { if ([401, 403].includes(response.status)) { setData(null); fullLoadedAt.current=0; } throw new Error(body.error); }
        if (body.data) { setData(body.data); fullLoadedAt.current=Date.now(); }
        setRole(body.role); setOperations(body.operations ?? {bot:null,group:null});
      } catch (e) { if (version === revision.current) setError(e instanceof Error ? e.message : "Falha ao atualizar."); }
    })();
    refreshPending.current=work;
    try { await work; } finally { if(refreshPending.current===work)refreshPending.current=null; }
  }, [request]);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250); };
    void refresh(false);
    const channel = db.channel("admin-auctions").on("postgres_changes", { event: "*", schema: "public", table: "auction_events" }, reload).subscribe(status => {
      setRealtime(status === "SUBSCRIBED" ? "Ao vivo" : "Reconectando…");
      if (status === "SUBSCRIBED") void refresh(false);
    });
    const focusReload = () => { if(!document.hidden)void refresh(false); };
    window.addEventListener("focus", focusReload);
    const fallback = setInterval(() => { if(!document.hidden)void refresh(false, Date.now()-fullLoadedAt.current < 60000); }, 15000);
    return () => { clearTimeout(timer); clearInterval(fallback); window.removeEventListener("focus", focusReload); void db.removeChannel(channel); };
  }, [db, session?.user.id, refresh]);
  async function execute(command: Command) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await request("/api/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error(body.error);
        setRetry(null); setError(body.error); await refresh(); return;
      }
      setRetry(null); setEditor(null); setNotice("Operação confirmada pelo banco."); await refresh();
    } catch (e) { setRetry(command); setError(`${e instanceof Error ? e.message : "Falha de rede."} Reenvie a mesma operação para confirmar o resultado com segurança.`); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  function command(type: Command["type"], rest: Partial<Command> = {}) { void execute({ ...rest, type, eventId: crypto.randomUUID() }); }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const { error } = await db.auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
      if (error) setError("Não foi possível entrar. Confira e-mail e senha.");
    } catch { setError("Falha de conexão ao entrar."); } finally { setBusy(false); }
  }
  async function exportExcel() {
    setBusy(true); setError("");
    try {
      const response = await request("/api/export"); if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement("a"); a.href = url; a.download = "leilao-pokemon.xlsx"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha na exportação."); } finally { setBusy(false); }
  }
  // P-09 — Baixa de pagamento: marca a compra como paga, tira a entrega de
  // waiting_payment (bot para de mandar lembretes DM) e audita. RPC
  // idempotente por estado — clicar duas vezes não duplica nada.
  async function markPurchasePaid(purchaseId: string) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await request("/api/purchases/paid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice(body.data?.already_paid ? "Pagamento já estava marcado." : "✔ Pagamento marcado como recebido — os lembretes do bot param.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao marcar pagamento."); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  // Backup completo em JSON (mesma fonte da cópia diária automática do bot):
  // o download exige Authorization, então é fetch+blob e não um <a> direto.
  async function downloadBackup() {
    setBusy(true); setError("");
    try {
      const response = await request("/api/admin/backup"); if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      const now = new Date(); const pad = (v: number) => String(v).padStart(2, "0");
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `leilao-backup-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Backup completo baixado em JSON.");
    } catch (e) { setError(e instanceof Error ? e.message : "Falha no backup."); } finally { setBusy(false); }
  }
  async function purgeEverything() {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await request("/api/admin/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: purgeStep2 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPurgeOpen(false);
      const deleted = body.result?.deleted ?? {};
      setNotice(`Base zerada: ${deleted.auctions ?? 0} leilão(ões), ${deleted.cards ?? 0} carta(s), ${deleted.participants ?? 0} participante(s) removidos. A sessão do WhatsApp também foi marcada para logout no PC do bot e a numeração de lotes volta ao #1.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao excluir tudo."); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  const writable = role !== "viewer" && !busy && !retry;
  const auctions = data ? [...data.auctions].sort((a,b) => str(b,"created_at").localeCompare(str(a,"created_at"))) : [];
  const auction = auctions.find(a => a.id === selected) ?? auctions.find(a => a.status === "open") ?? auctions[0];
  const card = data?.cards.find(c => c.id === auction?.card_id);
  const participant = (id: unknown) => data?.participants.find(p => p.id === id);
  const bids = (data?.bids.filter(b => b.auction_id === auction?.id && b.status === "active" && participant(b.participant_id)?.status === "active" && (!participant(b.participant_id)?.suspension_until || Date.parse(str(participant(b.participant_id),"suspension_until")) <= Date.now())) ?? []).sort((a,b) => Number(b.amount)-Number(a.amount) || (str(a,"whatsapp_event_at")||str(a,"processed_at")).localeCompare(str(b,"whatsapp_event_at")||str(b,"processed_at")) || str(a,"processed_at").localeCompare(str(b,"processed_at")) || Number(a.confirmation_order)-Number(b.confirmation_order));
  const winner = auction?.winner_participant_id ? participant(auction.winner_participant_id) : participant(bids[0]?.participant_id);
  const amount = auction?.status === "sold" ? auction.final_price : bids[0]?.amount;
  const participantCount = new Set(bids.map(b=>String(b.participant_id))).size;
  const nextLot = Math.max(0,...auctions.map(a=>Number(a.lot_number)||0))+1;
  const botLabel = operations.bot?.connected ? "🟢 Conectado" : operations.bot?.online ? "🟡 Reconectando" : "🔴 Offline";
  const dispatches = operations.dispatches;
  const dispatchLabel = dispatches?.successRate == null ? "—" : `${Math.round(dispatches.successRate * 100)}% · ${dispatches.sent}/${dispatches.sent + dispatches.failed}`;
  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    const form = new FormData(event.currentTarget); const fields: Record<string, unknown> = Object.fromEntries(form);
    for (const key of ["starting_price", "buyout_price"]) if (key in fields) fields[key] = fields[key] === "" ? null : Number(fields[key]);
    if ("scheduled_end_at" in fields) {
      if (fields.scheduled_end_at) {
        const iso = brasiliaInputToIso(String(fields.scheduled_end_at));
        if (!iso) { setError("Prazo inválido no horário de Brasília."); return; }
        fields.scheduled_end_at = iso;
      } else fields.scheduled_end_at = null;
    }
    command(`${editor.kind}_${editor.row ? "UPDATE" : "CREATE"}`, { ...(editor.kind === "AUCTION" ? { auctionId: editor.row ? str(editor.row,"id") : undefined } : { id: editor.row ? str(editor.row,"id") : undefined }), data: fields });
  }
  function input(name: string, label: string, type = "text", required = false) {
    let value = str(editor?.row,name);
    if (type === "datetime-local" && value) value = toBrasiliaInput(value);
    return <label key={name}>{label}<input name={name} type={type} required={required} defaultValue={value} maxLength={name === "notes" ? 2000 : 200} {...(type === "number" ? { min: 0, max: 9999999999.99, step: "0.01" } : {})} /></label>;
  }
  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">CENTRAL DE LEILÕES</p><h1>Leilão Pokémon</h1><p className="muted">Cartas, participantes e disputas em um só lugar.</p></div>{session && <div className="actions"><span className="status-pill">{realtime}</span><button disabled={busy} onClick={downloadBackup}>Baixar backup</button><button disabled={busy} onClick={exportExcel}>Exportar Excel</button><button disabled={busy} onClick={() => void db.auth.signOut()}>Sair</button></div>}</header>
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {retry && <button disabled={busy} onClick={() => void execute(retry)}>Reenviar a mesma operação</button>}
    {!ready ? <p>Carregando sessão…</p> : !session ? <form className="panel login form-grid" onSubmit={login}><h2>Acesso administrativo</h2><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy}>Entrar</button></form> : !data ? <section className="panel"><p>Carregando dados do banco…</p><button onClick={() => void refresh()}>Tentar novamente</button></section> : <>
      <section className="panel" style={{marginBottom:14}}><div className="panel-title"><div><p className="eyebrow">OPERAÇÃO AO VIVO</p><h2>{botLabel}</h2></div><span className="status-pill">Próximo lote #{nextLot}</span></div><div className="stats-grid"><div className="stat-card"><span>Bot</span><strong>{botLabel}</strong></div><div className="stat-card"><span>Grupo</span><strong>{operations.group?.name??"Não selecionado"}</strong></div><div className="stat-card"><span>Leilão atual</span><strong>{auction?`#${Number(auction.lot_number)||"—"} ${str(card,"name")}`:"Nenhum"}</strong></div><div className="stat-card"><span>Maior lance</span><strong>{price(amount)}</strong></div><div className="stat-card"><span>Participantes</span><strong>{participantCount}</strong></div><div className="stat-card"><span>Envios ({dispatches?.windowDays ?? 7}d)</span><strong title={dispatchLabel === "—" ? "Sem disparos terminais na janela" : `${dispatches?.sent ?? 0} enviados · ${dispatches?.failed ?? 0} falhos · ${dispatches?.pending ?? 0} pendentes`}>{dispatchLabel}</strong></div><div className="stat-card"><span>Tempo restante</span><strong>{auction?.status === "open" ? remainingLabel(auction.scheduled_end_at, clock) : labelStatus[str(auction,"status")] ?? "—"}</strong></div></div><div className="actions" style={{marginTop:14}}><Link className="button-link" href="/auctions/new">＋ Novo leilão</Link><a className="button-link" href="#current-auction">Ver leilão atual</a><Link className="button-link" href="/whatsapp">Central WhatsApp</Link></div></section>
      <section className="stats-grid">{[["Cartas",data.cards.filter(c=>c.status!=="archived").length],["Participantes",data.participants.filter(p=>p.status==="active").length],["Leilões abertos",auctions.filter(a=>a.status==="open").length],["Compras confirmadas",data.purchases.filter(p=>p.status==="confirmed").length]].map(([label,value])=><div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
      <section className="main-grid"><article className="panel" id="current-auction"><div className="panel-title"><h2>Disputa</h2><select aria-label="Selecionar leilão" value={str(auction,"id")} onChange={e=>setSelected(e.target.value)}>{auctions.map(a=><option key={str(a,"id")} value={str(a,"id")}>#{Number(a.lot_number)||"—"} {str(data.cards.find(c=>c.id===a.card_id),"name")} · {labelStatus[str(a,"status")] ?? str(a,"status")}</option>)}</select></div>
        {!auction ? <p className="muted">Crie seu primeiro leilão em “Novo leilão”.</p> : <><h2>#{Number(auction.lot_number)||"—"} {str(card,"name")}</h2><p className="muted">{str(card,"collection")} · {str(card,"card_number")}</p><div className="card-content">{str(card,"image_url").startsWith("https://") && <div className="card-image-wrap"><img className="card-image" src={str(card,"image_url")} alt={str(card,"name")} referrerPolicy="no-referrer" /></div>}<div className="bid-box"><span>{auction.status==="sold" ? "Vencedor" : "Líder elegível"}</span><strong>{str(winner,"display_name") || "Sem lances"}</strong><b>{price(amount)}</b><span>Inicial: {price(auction.starting_price)} · ARREMATE: {price(auction.buyout_price)}</span><p className="muted">{auction.status === "open" ? `Tempo restante: ${remainingLabel(auction.scheduled_end_at, clock)}` : `Status: ${labelStatus[str(auction,"status")] ?? str(auction,"status")} · Tipo: ${saleType(auction.win_type)}`}</p></div></div>
          {bids.length > 0 && <div className="table-wrap" style={{marginTop:14}}><table><thead><tr><th>Participante</th><th>Telefone / WhatsApp</th><th>Lance atual</th><th>Posição</th></tr></thead><tbody>{bids.map((bid,index)=>{const person=participant(bid.participant_id);return <tr key={str(bid,"id")}><td>{str(person,"display_name")}</td><td>{str(person,"phone_e164") || str(person,"whatsapp_id")}</td><td>{price(bid.amount)}</td><td>{index===0?"🏆 Ganhando":`${index+1}º`}</td></tr>;})}</tbody></table></div>}
          {auction.status==="draft" && <div className="actions"><button disabled={!writable} onClick={()=>command("AUCTION_OPEN",{auctionId:str(auction,"id")})}>Abrir leilão</button><button disabled={!writable} onClick={()=>setEditor({kind:"AUCTION",row:auction})}>Editar</button><button disabled={!writable} onClick={()=>{if(confirm("Cancelar este rascunho?"))command("AUCTION_DELETE",{auctionId:str(auction,"id")});}}>Remover</button></div>}
          {auction.status==="open" && <form className="form-grid" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const type=String(f.get("type")) as Command["type"];if(type==="BUYOUT_CONFIRMED"&&!confirm("Confirmar ARREMATE e encerrar a disputa imediatamente?"))return;command(type,{auctionId:str(auction,"id"),participantId:String(f.get("participant")),...(["BID_PLACED","BID_CHANGED"].includes(type)?{amount:Number(f.get("amount"))}:{})});}}><label>Participante<select name="participant" required>{data.participants.filter(p=>p.status==="active").map(p=><option key={str(p,"id")} value={str(p,"id")}>{str(p,"display_name")}</option>)}</select></label><label>Ação<select name="type"><option value="BID_PLACED">Registrar lance</option><option value="BID_CHANGED">Trocar lance</option><option value="BID_WITHDRAWN">Retirar lance</option><option value="BUYOUT_REQUESTED">Solicitar ARREMATE</option><option value="BUYOUT_CONFIRMED">Confirmar ARREMATE</option></select></label><label>Valor do lance<input name="amount" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={Number(auction.starting_price)} /></label><div className="actions"><button disabled={!writable}>Confirmar ação</button><button type="button" disabled={!writable} onClick={()=>{if(confirm("Finalizar agora e gerar a compra do maior lance elegível?"))command("AUCTION_FINALIZE",{auctionId:str(auction,"id")});}}>Finalizar leilão</button></div></form>}
        </>}
      </article><aside className="panel timeline"><h2>Atividade recente</h2><div className="events">{[...data.auction_events].sort((a,b)=>str(b,"created_at").localeCompare(str(a,"created_at"))).slice(0,15).map(e=><div className="event" key={str(e,"id")}><time>{formatBrasiliaTime(str(e,"created_at"))}</time><div><strong>{str(e,"event_type")}</strong><p>{str(participant(e.participant_id),"display_name") || "Administração"}</p></div></div>)}</div></aside></section>
      <section className="panel"><div className="panel-title"><div><h2>Avisos de alteração de valores</h2><p className="muted">Cada redução de lance conta 1 aviso global por usuário. A pessoa NÃO recebe aviso direto; ao atingir 3, os administradores são notificados por DM. O bot registra cada troca no terminal em tempo real.</p></div></div><div className="table-wrap"><table><thead><tr><th>Participante</th><th>Lote / Enquete</th><th>Carta</th><th>Alteração</th><th>Horário</th><th>Aviso nº</th></tr></thead><tbody>{(data.participant_warnings ?? []).map(w=>{const person=participant(w.participant_id);const created=str(w,"created_at");const prior=(data.participant_warnings ?? []).filter(x=>String(x.participant_id)===String(w.participant_id)&&String(str(x,"created_at"))<created);const baseline=prior.filter(x=>x.cycle_closed).map(x=>String(str(x,"created_at"))).sort().pop();const inCycle=prior.filter(x=>String(str(x,"created_at"))>(baseline??"")&&String(str(x,"created_at"))<=created).length+1;return <tr key={str(w,"id")}><td>{str(person,"display_name")}</td><td>#{Number(w.lot_number)||"—"}</td><td>{str(w,"card_name")}</td><td>{price(w.previous_amount)} → {price(w.new_amount)}</td><td>{formatBrasiliaTime(str(w,"occurred_at"))}</td><td>{w.cycle_closed?`${inCycle} de 3 · admins notificados · contador reiniciado`:`${inCycle} de 3`}</td></tr>;})}</tbody></table></div>{!data.participant_warnings?.length&&<p className="muted">Nenhuma redução de lance registrada até agora.</p>}</section>
      <section className="panel"><div className="panel-title"><h2>Cartas</h2><button disabled={!writable} onClick={()=>setEditor({kind:"CARD"})}>Nova carta</button></div><div className="table-wrap"><table><thead><tr><th>Carta</th><th>Coleção</th><th>Inicial / ARREMATE</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.cards.filter(c=>c.status!=="archived").map(c=><tr key={str(c,"id")}><td>{str(c,"name")}</td><td>{str(c,"collection")} {str(c,"card_number")}</td><td>{price(c.starting_price)} / {price(c.buyout_price)}</td><td>{labelStatus[str(c,"status")]}</td><td><div className="actions"><button disabled={!writable||c.status!=="available"} onClick={()=>setEditor({kind:"CARD",row:c})}>Editar</button><button disabled={!writable||c.status!=="available"} onClick={()=>command("AUCTION_CREATE",{data:{card_id:c.id,scheduled_end_at:null}})}>Criar leilão</button><button disabled={!writable||c.status!=="available"} onClick={()=>{if(confirm("Arquivar esta carta?"))command("CARD_DELETE",{id:str(c,"id")});}}>Arquivar</button></div></td></tr>)}</tbody></table></div>{!data.cards.length&&<p className="muted">Nenhuma carta cadastrada.</p>}</section>
      <section className="panel"><div className="panel-title"><div><h2>Participantes</h2><p className="muted">Cadastro automático pelo grupo e pelos votos do WhatsApp.</p></div></div><div className="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone / WhatsApp</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.participants.map(p=><tr key={str(p,"id")}><td>{str(p,"display_name")}</td><td>{str(p,"phone_e164") || str(p,"whatsapp_id")}</td><td>{labelStatus[str(p,"status")]}</td><td><div className="actions"><button disabled={!writable} onClick={()=>setEditor({kind:"PARTICIPANT",row:p})}>Editar</button><button disabled={!writable||p.status==="banned"} onClick={()=>{if(confirm("Bloquear participante, preservando o histórico?"))command("PARTICIPANT_DELETE",{id:str(p,"id")});}}>Remover</button></div></td></tr>)}</tbody></table></div></section>
      <section className="panel"><h2>Compras</h2><div className="table-wrap"><table><thead><tr><th>Carta</th><th>Vencedor</th><th>Telefone / WhatsApp</th><th>Valor</th><th>Tipo</th><th>Status</th><th>Pagamento</th></tr></thead><tbody>{data.purchases.map(p=>{const person=participant(p.participant_id);const soldAuction=data.auctions.find(a=>a.id===p.auction_id);const payment=data.payments.find(pay=>pay.purchase_id===p.id&&String(pay.status)==="paid");const reminded=data.payment_reminders?.find(rem=>String(rem.purchase_id)===p.id);return <tr key={str(p,"id")}><td>{str(data.cards.find(c=>c.id===p.card_id),"name")}</td><td>{str(person,"display_name")}</td><td>{str(person,"phone_e164") || str(person,"whatsapp_id")}</td><td>{price(p.amount)}</td><td>{saleType(soldAuction?.win_type)}</td><td>{str(p,"status")}</td><td>{payment?<span title={str(payment,"paid_at")}>✔ Pago</span>:str(p,"status")==="confirmed"?<span className="pay-cell">⏳ Pendente{reminded?.reminded_count?` · ${reminded.reminded_count} lembrete(s)`:""} <button className="secondary" disabled={busy} onClick={()=>void markPurchasePaid(str(p,"id"))}>✓ Recebido</button></span>:"—"}</td></tr>;})}</tbody></table></div></section>
      {role === "admin" && <section className="panel danger-zone" id="danger-zone"><div className="panel-title"><div><p className="eyebrow">ZONA DE RISCO</p><h2>Recomeçar do zero</h2><p className="muted">O botão “Excluir TUDO” apaga os dados de operação (leilões, lances, vencedores, compras, cartas, participantes, disparos e histórico do Excel) e manda o bot local apagar a sessão do WhatsApp. Sua conta administrativa, a configuração dos grupos e a memória de reconhecimento ficam preservadas, e a numeração de lotes volta ao #1.</p></div><div className="actions"><button className="danger-btn" disabled={!writable} onClick={() => { setPurgeStep1(""); setPurgeStep2(""); setPurgeOpen(true); }}>🗑️ Excluir TUDO</button></div></div></section>}
    </>}
    {editor && <dialog ref={dialog} className="panel modal" aria-label="Cadastro" onCancel={e => { if (busy) e.preventDefault(); else setEditor(null); }}><h2>{editor.row?"Editar":"Novo cadastro"}</h2><form className="form-grid" onSubmit={saveEditor}>
      {editor.kind==="CARD"&&<>{input("name","Nome","text",true)}{input("collection","Coleção")}{input("card_number","Número")}{input("image_url","URL da imagem (HTTPS)","url")}{input("starting_price","Preço inicial","number",true)}{input("buyout_price","ARREMATE (opcional)","number")}{input("notes","Observações")}</>}
      {editor.kind==="PARTICIPANT"&&editor.row&&<>{input("display_name","Nome","text",true)}{input("whatsapp_id","Identificador WhatsApp","text",true)}{input("phone_e164","Telefone internacional")}{input("notes","Observações")}<label>Status<select name="status" defaultValue={str(editor.row,"status")||"active"}><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="banned">Bloqueado</option></select></label></>}
      {editor.kind==="AUCTION"&&<>{input("starting_price","Preço inicial","number",true)}{input("buyout_price","ARREMATE (opcional)","number")}{input("scheduled_end_at","Prazo (horário de Brasília)","datetime-local")}</>}
      <div className="actions"><button disabled={!writable}>Salvar</button><button type="button" disabled={busy} onClick={()=>setEditor(null)}>Cancelar</button></div></form></dialog>}
    {purgeOpen && <dialog ref={purgeDialog} className="panel modal" aria-label="Excluir tudo" onCancel={event => { if (busy) event.preventDefault(); else setPurgeOpen(false); }}><h2>Excluir TUDO</h2><p className="muted">Apaga definitivamente os dados de operação e solicita o logout completo da sessão do WhatsApp no PC do bot. Não há como desfazer. A conta administrativa, os grupos e a memória de reconhecimento são mantidos.</p>
      <form className="form-grid" onSubmit={event => { event.preventDefault(); void purgeEverything(); }}>
        <label>1ª confirmação — digite <strong>excluir tudo</strong><input value={purgeStep1} onChange={event => setPurgeStep1(event.target.value)} placeholder="excluir tudo" autoComplete="off" spellCheck={false} /></label>
        {isPurgeStep1(purgeStep1) && <label>2ª confirmação — digite <strong>quero excluir mesmo</strong><input value={purgeStep2} onChange={event => setPurgeStep2(event.target.value)} placeholder="quero excluir mesmo" autoComplete="off" spellCheck={false} /></label>}
        <div className="actions"><button className="danger-btn" type="submit" disabled={!isPurgeStep1(purgeStep1) || !isPurgeFinalPhrase(purgeStep2) || busy}>{busy ? "Excluindo…" : "Apagar tudo definitivamente"}</button><button type="button" disabled={busy} onClick={() => setPurgeOpen(false)}>Cancelar</button></div>
      </form></dialog>}
  </main>;
}
