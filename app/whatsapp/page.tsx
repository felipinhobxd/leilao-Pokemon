"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = { id:string; name:string; group_jid:string; is_default:boolean; last_synced_at:string|null };
type Dispatch = { id:string; auction_id:string; group_id:string; scheduled_at:string; status:string; announcement_sent_at?:string|null; poll_sent_at?:string|null; sent_at:string|null; attempts:number; last_error:string|null };
type BotWorker = { workerId:string; status:string; heartbeatAt:string|null; connectedAt:string|null; accountJid:string|null; lastError:string|null; qrText:string|null; qrExpiresAt:string|null; groupsSyncedAt:string|null; version:string|null; sessionActive:boolean };
type BotData = { worker:BotWorker|null; online:boolean; canControl:boolean };
type Bootstrap = { botStatus:BotData; groups:Group[]; defaultGroupId:string|null; dispatches:Dispatch[] };

function when(value:string|null|undefined){if(!value)return "—";const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleString("pt-BR"):"—"}
function botStatusLabel(status:string){return ({starting:"Iniciando",waiting_qr:"Aguardando QR",connecting:"Conectando",connected:"Conectado",reconnecting:"Reconectando",disconnected:"Desconectado",error:"Erro"} as Record<string,string>)[status]??status}
function dispatchLabel(status:string){return ({scheduled:"Pendente",sending:"Enviando",sent:"Enviado",failed:"Falhou",cancelled:"Cancelado"} as Record<string,string>)[status]??status}

export default function WhatsAppPage(){
  const [db]=useState(createPublicSupabaseClient);
  const [ready,setReady]=useState(false);
  const [session,setSession]=useState<any>(null);
  const [bot,setBot]=useState<BotData>({worker:null,online:false,canControl:false});
  const [groups,setGroups]=useState<Group[]>([]);
  const [defaultGroupId,setDefaultGroupId]=useState("");
  const [dispatches,setDispatches]=useState<Dispatch[]>([]);
  const [advanced,setAdvanced]=useState(false);
  const [busy,setBusy]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const sessionRef=useRef<any>(null);
  const loadingRef=useRef(false);

  const tokenFetch=useCallback(async(url:string,init?:RequestInit)=>{
    let current=sessionRef.current;
    if(!current){const {data}=await db.auth.getSession();current=data.session;sessionRef.current=current;setSession(current)}
    if(!current)throw new Error("Entre primeiro no painel.");
    return fetch(url,{...init,cache:"no-store",headers:{...init?.headers,Authorization:`Bearer ${current.access_token}`}});
  },[db]);

  const load=useCallback(async(currentSession?:any)=>{
    if(loadingRef.current)return;
    loadingRef.current=true;setRefreshing(true);
    try{
      let current=currentSession??sessionRef.current;
      if(!current){const {data}=await db.auth.getSession();current=data.session;sessionRef.current=current;setSession(current)}
      setReady(true);
      if(!current)return;
      const response=await fetch("/api/whatsapp/bootstrap",{cache:"no-store",headers:{Authorization:`Bearer ${current.access_token}`}});
      const body=await response.json() as Bootstrap&{error?:string};
      if(!response.ok)throw new Error(body.error??"Falha ao carregar Central WhatsApp.");
      setBot(body.botStatus);
      setGroups(body.groups??[]);
      setDefaultGroupId(body.defaultGroupId??"");
      setDispatches(body.dispatches??[]);
    }finally{loadingRef.current=false;setRefreshing(false)}
  },[db]);

  useEffect(()=>{
    let alive=true;
    void db.auth.getSession().then(({data})=>{
      if(!alive)return;
      sessionRef.current=data.session;setSession(data.session);setReady(true);
      if(data.session)void load(data.session).catch(e=>setError(e instanceof Error?e.message:"Falha ao carregar."));
    });
    const {data:listener}=db.auth.onAuthStateChange((_e,next)=>{
      sessionRef.current=next;setSession(next);setReady(true);
      if(next)void load(next).catch(e=>setError(e instanceof Error?e.message:"Falha ao carregar."));
    });
    return()=>{alive=false;listener.subscription.unsubscribe()};
  },[db,load]);

  useEffect(()=>{
    if(!session)return;
    let debounce:ReturnType<typeof setTimeout>|undefined;
    const reload=()=>{if(debounce)clearTimeout(debounce);debounce=setTimeout(()=>void load().catch(()=>undefined),250)};
    const interval=setInterval(reload,15_000);
    const channel=db.channel("whatsapp-central")
      .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_dispatches"},reload)
      .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_groups"},reload)
      .subscribe();
    window.addEventListener("focus",reload);
    return()=>{if(debounce)clearTimeout(debounce);clearInterval(interval);window.removeEventListener("focus",reload);void db.removeChannel(channel)};
  },[db,session,load]);

  async function command(action:"reconnect"|"disconnect"|"sync_groups"){
    const worker=bot.worker;if(!worker)return;setBusy(true);setError("");setNotice("");
    try{const r=await tokenFetch("/api/whatsapp/bot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,workerId:worker.workerId})});const b=await r.json();if(!r.ok)throw new Error(b.error??"Falha no comando.");setNotice(action==="sync_groups"?"Atualização de grupos solicitada.":"Comando enviado ao bot.");setTimeout(()=>void load().catch(()=>undefined),1500)}catch(e){setError(e instanceof Error?e.message:"Falha no comando.")}finally{setBusy(false)}
  }
  async function setDefault(groupId:string){setBusy(true);setError("");try{const r=await tokenFetch("/api/whatsapp/groups",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({groupId})});const b=await r.json();if(!r.ok)throw new Error(b.error??"Não foi possível alterar o grupo.");setDefaultGroupId(groupId);setNotice("Grupo padrão atualizado.");await load()}catch(e){setError(e instanceof Error?e.message:"Falha ao alterar o grupo.")}finally{setBusy(false)}}

  if(!ready)return <main className="shell"><p>Carregando…</p></main>;
  if(!session)return <main className="shell"><section className="panel"><h1>Central WhatsApp</h1><p className="muted">Entre primeiro no painel administrativo.</p><Link href="/">Voltar</Link></section></main>;
  const worker=bot.worker; const connected=Boolean(bot.online&&worker?.status==="connected"); const dot=connected?"🟢":bot.online?"🟡":"🔴"; const selected=groups.find(g=>g.id===defaultGroupId);
  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">CENTRAL DO BOT</p><h1>WhatsApp</h1><p className="muted">Status, conexão, grupo padrão e fila de publicações. Os leilões são criados pelo botão “Novo leilão”.</p></div><div className="actions"><Link className="button-link" href="/auctions/new">＋ Novo leilão</Link><Link className="button-link" href="/">← Painel</Link></div></header>
    {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">WHATSAPP BOT</p><h2>{dot} {worker?botStatusLabel(worker.status):"Worker não instalado"}</h2>{!bot.online&&<p className="muted">O worker está offline. O painel não consegue iniciar um PC desligado.</p>}</div><span className="status-pill">{worker?.version?`v${worker.version}`:"sem versão"}</span></div>
      <div className="stats-grid"><div className="stat-card"><span>Conta</span><strong>{worker?.accountJid??"—"}</strong></div><div className="stat-card"><span>Sessão</span><strong>{worker?.sessionActive?"Ativa":"Não autenticada"}</strong></div><div className="stat-card"><span>Última atividade</span><strong>{when(worker?.heartbeatAt)}</strong></div><div className="stat-card"><span>Grupos sincronizados</span><strong>{when(worker?.groupsSyncedAt)}</strong></div></div>
      {worker?.lastError&&<p className="alert">{worker.lastError}</p>}
      {bot.canControl&&worker&&<div className="actions"><button disabled={busy||!bot.online} onClick={()=>void command("reconnect")}>Reconectar</button><button disabled={busy||!bot.online} onClick={()=>void command("disconnect")}>Desconectar</button><button disabled={busy||!connected} onClick={()=>void command("sync_groups")}>Atualizar grupos</button></div>}
      {worker?.qrText&&bot.canControl&&<div style={{marginTop:18}}><h2>QR CODE</h2><p className="muted">Expira em {when(worker.qrExpiresAt)}.</p><div style={{overflowX:"auto",marginTop:12,borderRadius:14,background:"#000",padding:18,width:"fit-content",maxWidth:"100%"}}><pre style={{margin:0,color:"#fff",fontFamily:"Consolas, monospace",fontSize:11,lineHeight:.9,whiteSpace:"pre"}}>{worker.qrText}</pre></div></div>}
    </section>
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">PUBLICAÇÃO</p><h2>Grupo padrão</h2><p className="muted">Novos leilões usam este grupo por padrão. Você também pode escolher outro durante a criação.</p></div><button disabled={busy||!connected} onClick={()=>void command("sync_groups")}>Atualizar grupos</button></div>
      <label>Grupo<select value={defaultGroupId} onChange={e=>void setDefault(e.target.value)} disabled={busy||!groups.length}><option value="">Selecione…</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <button type="button" style={{marginTop:12}} onClick={()=>setAdvanced(v=>!v)}>{advanced?"Ocultar detalhes avançados":"Detalhes avançados"}</button>
      {advanced&&selected&&<div className="stat-card" style={{marginTop:12}}><span>JID do grupo</span><strong style={{fontSize:"1rem"}}>{selected.group_jid}</strong><small>Última sincronização: {when(selected.last_synced_at)}</small></div>}
    </section>
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">FILA</p><h2>Publicações recentes</h2></div><button disabled={busy||refreshing} onClick={()=>void load().catch(e=>setError(e instanceof Error?e.message:"Falha ao atualizar."))}>{refreshing?"Atualizando…":"Atualizar"}</button></div>
      {!dispatches.length?<p className="muted">Nenhuma publicação ainda.</p>:<div className="table-wrap"><table><thead><tr><th>Horário</th><th>Status</th><th>Imagem/anúncio</th><th>Enquete</th><th>Tentativas</th></tr></thead><tbody>{dispatches.map(d=><tr key={d.id}><td>{when(d.scheduled_at)}</td><td>{dispatchLabel(d.status)}</td><td>{d.announcement_sent_at?"✅ Enviado":d.status==="sending"?"⏳ Enviando":"—"}</td><td>{d.poll_sent_at?"✅ Enviada":d.status==="sending"?"⏳ Enviando":"—"}</td><td>{d.attempts}{d.last_error?<small className="muted"> · {d.last_error}</small>:null}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
