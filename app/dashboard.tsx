"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { createPublicSupabaseClient } from "@/lib/supabase";
import type { Command } from "@/lib/commands";
import type { Row, Snapshot } from "@/lib/backend";
import { money } from "@/lib/domain";

type Editor = { kind: "CARD" | "PARTICIPANT" | "AUCTION"; row?: Row };
type Operations = { bot: { workerId:string; status:string; heartbeatAt:string|null; online:boolean; connected:boolean; version:string|null } | null; group: { id:string; name:string } | null };
const labelStatus: Record<string, string> = { active: "Ativo", suspended: "Suspenso", banned: "Bloqueado", available: "Disponível", archived: "Arquivada", in_auction: "Em leilão", draft: "Rascunho", open: "Aberto", sold: "Vendido", closed: "Sem vencedor", cancelled: "Cancelado" };
const str = (row: Row | undefined, key: string) => String(row?.[key] ?? "");
const price = (value: unknown) => money(value == null ? null : Number(value));
const heartbeatFresh = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.now() - Date.parse(value) <= 35_000;

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
  const revision = useRef(0);
  const accessToken = useRef<string | null>(null);
  const lastRefreshAt = useRef(0);
  const mutationLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editor && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [editor]);
  useEffect(() => {
    const { data: subscription } = db.auth.onAuthStateChange((_event, next) => {
      accessToken.current = next?.access_token ?? null;
      lastRefreshAt.current = 0;
      setSession(next); setReady(true);
      if (!next) { revision.current++; setData(null); setOperations({bot:null,group:null}); setRetry(null); setEditor(null); }
    });
    return () => subscription.subscription.unsubscribe();
  }, [db]);
  const request = useCallback(async (url: string, init?: RequestInit) => {
    let token = accessToken.current;
    if (!token) {
      const { data: auth } = await db.auth.getSession();
      token = auth.session?.access_token ?? null;
      accessToken.current = token;
    }
    if (!token) throw new Error("Entre novamente para continuar.");
    return fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  }, [db]);
  const refresh = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRefreshAt.current < 3_000) return;
    lastRefreshAt.current = now;
    const version = ++revision.current;
    try {
      const response = await request("/api/dashboard"); const body = await response.json();
      if (version !== revision.current || !accessToken.current) return;
      if (!response.ok) { if ([401, 403].includes(response.status)) setData(null); throw new Error(body.error); }
      setData(body.data); setRole(body.role); setOperations(body.operations ?? {bot:null,group:null}); setError("");
    } catch (e) { if (version === revision.current) setError(e instanceof Error ? e.message : "Falha ao atualizar."); }
  }, [request]);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250); };
    void refresh(true);
    const channel = db.channel("admin-auctions")
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_events" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_bot_workers" }, payload => {
        const row = payload.new as Record<string, unknown>;
        if (!row.worker_id) return;
        const heartbeatAt = typeof row.heartbeat_at === "string" ? row.heartbeat_at : null;
        const status = String(row.status ?? "disconnected");
        const online = heartbeatFresh(heartbeatAt);
        setOperations(previous => ({
          ...previous,
          bot: {
            workerId: String(row.worker_id),
            status,
            heartbeatAt,
            online,
            connected: online && status === "connected",
            version: typeof row.version === "string" ? row.version : null,
          },
        }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_groups" }, payload => {
        const row = payload.new as Record<string, unknown>;
        if (!row.id) return;
        const isDefault = row.is_default === true && row.active !== false;
        setOperations(previous => {
          if (isDefault) return { ...previous, group: { id: String(row.id), name: String(row.name ?? "Grupo") } };
          if (previous.group?.id === String(row.id)) return { ...previous, group: null };
          return previous;
        });
      })
      .subscribe(status => {
        setRealtime(status === "SUBSCRIBED" ? "Ao vivo" : "Reconectando…");
        if (status === "SUBSCRIBED") reload();
      });
    window.addEventListener("focus", reload);
    const freshness = setInterval(() => {
      setOperations(previous => {
        if (!previous.bot) return previous;
        const online = heartbeatFresh(previous.bot.heartbeatAt);
        const connected = online && previous.bot.status === "connected";
        if (online === previous.bot.online && connected === previous.bot.connected) return previous;
        return { ...previous, bot: { ...previous.bot, online, connected } };
      });
    }, 5_000);
    const fallback = setInterval(reload, 60_000);
    return () => { clearTimeout(timer); clearInterval(freshness); clearInterval(fallback); window.removeEventListener("focus", reload); void db.removeChannel(channel); };
  }, [db, session, refresh]);
  async function execute(command: Command) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await request("/api/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error(body.error);
        setRetry(null); setError(body.error); await refresh(true); return;
      }
      setRetry(null); setEditor(null); setNotice("Operação confirmada pelo banco."); await refresh(true);
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
  const writable = role !== "viewer" && !busy && !retry;
  const auctions = data ? [...data.auctions].sort((a,b) => str(b,"created_at").localeCompare(str(a,"created_at"))) : [];
  const auction = auctions.find(a => a.id === selected) ?? auctions.find(a => a.status === "open") ?? auctions[0];
  const card = data?.cards.find(c => c.id === auction?.card_id);
  const participant = (id: unknown) => data?.participants.find(p => p.id === id);
  const bids = (data?.bids.filter(b => b.auction_id === auction?.id && b.status === "active" && participant(b.participant_id)?.status === "active" && (!participant(b.participant_id)?.suspension_until || Date.parse(str(participant(b.participant_id),"suspension_until")) <= Date.now())) ?? []).sort((a,b) => Number(b.amount)-Number(a.amount) || str(a,"processed_at").localeCompare(str(b,"processed_at")) || Number(a.confirmation_order)-Number(b.confirmation_order));
  const winner = auction?.winner_participant_id ? participant(auction.winner_participant_id) : participant(bids[0]?.participant_id);
  const amount = auction?.status === "sold" ? auction.final_price : bids[0]?.amount;
  const participantCount = new Set(bids.map(b=>String(b.participant_id))).size;
  const nextLot = Math.max(0,...auctions.map(a=>Number(a.lot_number)||0))+1;
  const botLabel = operations.bot?.connected ? "🟢 Conectado" : operations.bot?.online ? "🟡 Reconectando" : "🔴 Offline";
  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    const form = new FormData(event.currentTarget); const fields: Record<string, unknown> = Object.fromEntries(form);
    for (const key of ["starting_price", "buyout_price"]) if (key in fields) fields[key] = fields[key] === "" ? null : Number(fields[key]);
    if ("scheduled_end_at" in fields) fields.scheduled_end_at = fields.scheduled_end_at ? new Date(String(fields.scheduled_end_at)).toISOString() : null;
    command(`${editor.kind}_${editor.row ? "UPDATE" : "CREATE"}`, { ...(editor.kind === "AUCTION" ? { auctionId: editor.row ? str(editor.row,"id") : undefined } : { id: editor.row ? str(editor.row,"id") : undefined }), data: fields });
  }
  function input(name: string, label: string, type = "text", required = false) {
    let value = str(editor?.row,name);
    if (type === "datetime-local" && value) { const d = new Date(value); value = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
    return <label key={name}>{label}<input name={name} type={type} required={required} defaultValue={value} maxLength={name === "notes" ? 2000 : 200} {...(type === "number" ? { min: 0, max: 9999999999.99, step: "0.01" } : {})} /></label>;
  }
  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">CENTRAL DE LEILÕES</p><h1>Leilão Pokémon</h1><p className="muted">Cartas, participantes e disputas em um só lugar.</p></div>{session && <div className="actions"><span className="status-pill">{realtime}</span><button disabled={busy} onClick={exportExcel}>Exportar Excel</button><button disabled={busy} onClick={() => void db.auth.signOut()}>Sair</button></div>}</header>
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {retry && <button disabled={busy} onClick={() => void execute(retry)}>Reenviar a mesma operação</button>}
    {!ready ? <p>Carregando sessão…</p> : !session ? <form className="panel login form-grid" onSubmit={login}><h2>Acesso administrativo</h2><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy}>Entrar</button></form> : !data ? <section className="panel"><p>Carregando dados do banco…</p><button onClick={() => void refresh(true)}>Tentar novamente</button></section> : <>
      <section className="panel" style={{marginBottom:14}}><div className="panel-title"><div><p className="eyebrow">OPERAÇÃO AO VIVO</p><h2>{botLabel}</h2></div><span className="status-pill">Próximo lote #{nextLot}</span></div><div className="stats-grid"><div className="stat-card"><span>Bot</span><strong>{botLabel}</strong></div><div className="stat-card"><span>Grupo</span><strong>{operations.group?.name??"Não selecionado"}</strong></div><div className="stat-card"><span>Leilão atual</span><strong>{auction?`#${Number(auction.lot_number)||"—"} ${str(card,"name")}`:"Nenhum"}</strong></div><div className="stat-card"><span>Maior lance</span><strong>{price(amount)}</strong></div><div className="stat-card"><span>Participantes</span><strong>{participantCount}</strong></div><div className="stat-card"><span>Próximo lote</span><strong>#{nextLot}</strong></div></div><div className="actions" style={{marginTop:14}}><Link className="button-link" href="/auctions/new">＋ Novo leilão</Link><a className="button-link" href="#current-auction">Ver leilão atual</a><Link className="button-link" href="/whatsapp">Central WhatsApp</Link></div></section>
      <section className="stats-grid">{[["Cartas",data.cards.filter(c=>c.status!=="archived").length],["Participantes",data.participants.filter(p=>p.status==="active").length],["Leilões abertos",auctions.filter(a=>a.status==="open").length],["Compras confirmadas",data.purchases.filter(p=>p.status==="confirmed").length]].map(([label,value])=><div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
      <section className="main-grid"><article className="panel" id="current-auction"><div className="panel-title"><h2>Disputa</h2><select aria-label="Selecionar leilão" value={str(auction,"id")} onChange={e=>setSelected(e.target.value)}>{auctions.map(a=><option key={str(a,"id")} value={str(a,"id")}>#{Number(a.lot_number)||"—"} {str(data.cards.find(c=>c.id===a.card_id),"name")} · {labelStatus[str(a,"status")] ?? str(a,"status")}</option>)}</select></div>
        {!auction ? <p className="muted">Crie seu primeiro leilão em “Novo leilão”.</p> : <><h2>#{Number(auction.lot_number)||"—"} {str(card,"name")}</h2><p className="muted">{str(card,"collection")} · {str(card,"card_number")}</p><div className="card-content">{str(card,"image_url").startsWith("https://") && <div className="card-image-wrap"><img className="card-image" src={str(card,"image_url")} alt={str(card,"name")} referrerPolicy="no-referrer" /></div>}<div className="bid-box"><span>{auction.status==="sold" ? "Vencedor" : "Líder elegível"}</span><strong>{str(winner,"display_name") || "Sem lances"}</strong><b>{price(amount)}</b><span>Inicial: {price(auction.starting_price)} · ARREMATE: {price(auction.buyout_price)}</span><p className="muted">Prazo: {auction.scheduled_end_at ? new Date(str(auction,"scheduled_end_at")).toLocaleString("pt-BR") : "Encerramento manual"}</p></div></div>
          {auction.status==="draft" && <div className="actions"><button disabled={!writable} onClick={()=>command("AUCTION_OPEN",{auctionId:str(auction,"id")})}>Abrir leilão</button><button disabled={!writable} onClick={()=>setEditor({kind:"AUCTION",row:auction})}>Editar</button><button disabled={!writable} onClick={()=>{if(confirm("Cancelar este rascunho?"))command("AUCTION_DELETE",{auctionId:str(auction,"id")});}}>Remover</button></div>}
          {auction.status==="open" && <form className="form-grid" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const type=String(f.get("type")) as Command["type"];if(type==="BUYOUT_CONFIRMED"&&!confirm("Confirmar ARREMATE e encerrar a disputa imediatamente?"))return;command(type,{auctionId:str(auction,"id"),participantId:String(f.get("participant")),...(["BID_PLACED","BID_CHANGED"].includes(type)?{amount:Number(f.get("amount"))}:{})});}}><label>Participante<select name="participant" required>{data.participants.filter(p=>p.status==="active").map(p=><option key={str(p,"id")} value={str(p,"id")}>{str(p,"display_name")}</option>)}</select></label><label>Ação<select name="type"><option value="BID_PLACED">Registrar lance</option><option value="BID_CHANGED">Trocar lance</option><option value="BID_WITHDRAWN">Retirar lance</option><option value="BUYOUT_REQUESTED">Solicitar ARREMATE</option><option value="BUYOUT_CONFIRMED">Confirmar ARREMATE</option></select></label><label>Valor do lance<input name="amount" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={Number(auction.starting_price)} /></label><div className="actions"><button disabled={!writable}>Confirmar ação</button><button type="button" disabled={!writable} onClick={()=>{if(confirm("Finalizar agora e gerar a compra do maior lance elegível?"))command("AUCTION_FINALIZE",{auctionId:str(auction,"id")});}}>Finalizar leilão</button></div></form>}
        </>}
      </article><aside className="panel timeline"><h2>Atividade recente</h2><div className="events">{[...data.auction_events].sort((a,b)=>str(b,"created_at").localeCompare(str(a,"created_at"))).slice(0,15).map(e=><div className="event" key={str(e,"id")}><time>{new Date(str(e,"created_at")).toLocaleTimeString("pt-BR")}</time><div><strong>{str(e,"event_type")}</strong><p>{str(participant(e.participant_id),"display_name") || "Administração"}</p></div></div>)}</div></aside></section>
      <section className="panel"><div className="panel-title"><h2>Cartas</h2><button disabled={!writable} onClick={()=>setEditor({kind:"CARD"})}>Nova carta</button></div><div className="table-wrap"><table><thead><tr><th>Carta</th><th>Coleção</th><th>Inicial / ARREMATE</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.cards.filter(c=>c.status!=="archived").map(c=><tr key={str(c,"id")}><td>{str(c,"name")}</td><td>{str(c,"collection")} {str(c,"card_number")}</td><td>{price(c.starting_price)} / {price(c.buyout_price)}</td><td>{labelStatus[str(c,"status")]}</td><td><div className="actions"><button disabled={!writable||c.status!=="available"} onClick={()=>setEditor({kind:"CARD",row:c})}>Editar</button><button disabled={!writable||c.status!=="available"} onClick={()=>command("AUCTION_CREATE",{data:{card_id:c.id,scheduled_end_at:null}})}>Criar leilão</button><button disabled={!writable||c.status!=="available"} onClick={()=>{if(confirm("Arquivar esta carta?"))command("CARD_DELETE",{id:str(c,"id")});}}>Arquivar</button></div></td></tr>)}</tbody></table></div>{!data.cards.length&&<p className="muted">Nenhuma carta cadastrada.</p>}</section>
      <section className="panel"><div className="panel-title"><h2>Participantes</h2><button disabled={!writable} onClick={()=>setEditor({kind:"PARTICIPANT"})}>Novo participante</button></div><div className="table-wrap"><table><thead><tr><th>Nome</th><th>WhatsApp</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.participants.map(p=><tr key={str(p,"id")}><td>{str(p,"display_name")}</td><td>{str(p,"whatsapp_id")}</td><td>{labelStatus[str(p,"status")]}</td><td><div className="actions"><button disabled={!writable} onClick={()=>setEditor({kind:"PARTICIPANT",row:p})}>Editar</button><button disabled={!writable||p.status==="banned"} onClick={()=>{if(confirm("Bloquear participante, preservando o histórico?"))command("PARTICIPANT_DELETE",{id:str(p,"id")});}}>Remover</button></div></td></tr>)}</tbody></table></div></section>
      <section className="panel"><h2>Compras</h2><div className="table-wrap"><table><thead><tr><th>Carta</th><th>Vencedor</th><th>Valor</th><th>Status</th></tr></thead><tbody>{data.purchases.map(p=><tr key={str(p,"id")}><td>{str(data.cards.find(c=>c.id===p.card_id),"name")}</td><td>{str(participant(p.participant_id),"display_name")}</td><td>{price(p.amount)}</td><td>{str(p,"status")}</td></tr>)}</tbody></table></div></section>
    </>}
    {editor && <dialog ref={dialog} className="panel modal" aria-label="Cadastro" onCancel={e => { if (busy) e.preventDefault(); else setEditor(null); }}><h2>{editor.row?"Editar":"Novo cadastro"}</h2><form className="form-grid" onSubmit={saveEditor}>
      {editor.kind==="CARD"&&<>{input("name","Nome","text",true)}{input("collection","Coleção")}{input("card_number","Número")}{input("image_url","URL da imagem (HTTPS)","url")}{input("starting_price","Preço inicial","number",true)}{input("buyout_price","ARREMATE (opcional)","number")}{input("notes","Observações")}</>}
      {editor.kind==="PARTICIPANT"&&<>{input("display_name","Nome","text",true)}{input("whatsapp_id","Identificador WhatsApp","text",true)}{input("phone_e164","Telefone internacional")}{input("notes","Observações")}<label>Status<select name="status" defaultValue={str(editor.row,"status")||"active"}><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="banned">Bloqueado</option></select></label></>}
      {editor.kind==="AUCTION"&&<>{input("starting_price","Preço inicial","number",true)}{input("buyout_price","ARREMATE (opcional)","number")}{input("scheduled_end_at","Prazo (horário local)","datetime-local")}</>}
      <div className="actions"><button disabled={!writable}>Salvar</button><button type="button" disabled={busy} onClick={()=>setEditor(null)}>Cancelar</button></div></form></dialog>}
  </main>;
}
