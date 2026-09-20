"use client";

import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = { id:string; name:string; group_jid:string; is_default:boolean; last_synced_at:string|null };
type Dispatch = { id:string; auction_id:string; group_id:string; scheduled_at:string; status:string; announcement_sent_at?:string|null; poll_sent_at?:string|null; sent_at:string|null; attempts:number; last_error:string|null };
type BotWorker = { workerId:string; status:string; heartbeatAt:string|null; connectedAt:string|null; accountJid:string|null; lastError:string|null; qrText:string|null; qrExpiresAt:string|null; groupsSyncedAt:string|null; version:string|null; sessionActive:boolean };
type BotData = { worker:BotWorker|null; online:boolean; canControl:boolean };

function when(value:string|null|undefined){if(!value)return "—";const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleString("pt-BR"):"—"}
function botStatusLabel(status:string){return ({starting:"Iniciando",waiting_qr:"Aguardando QR",connecting:"Conectando",connected:"Conectado",reconnecting:"Reconectando",disconnected:"Desconectado",error:"Erro"} as Record<string,string>)[status]??status}
function dispatchLabel(status:string){return ({scheduled:"Pendente",sending:"Enviando",sent:"Enviado",failed:"Falhou",cancelled:"Cancelado"} as Record<string,string>)[status]??status}

export default function WhatsAppPage(){
  const [db]=useState(createPublicSupabaseClient); const [ready,setReady]=useState(false); const [session,setSession]=useState<Session|null>(null); const [bot,setBot]=useState<BotData>({worker:null,online:false,canControl:false}); const [groups,setGroups]=useState<Group[]>([]); const [defaultGroupId,setDefaultGroupId]=useState(""); const [dispatches,setDispatches]=useState<Dispatch[]>([]); const [advanced,setAdvanced]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  async function authFetch(url:string,init?:RequestInit){const {data}=await db.auth.getSession();if(!data.session)throw new Error("Entre primeiro no painel.");return fetch(url,{...init,cache:"no-store",headers:{...init?.headers,Authorization:`Bearer ${data.session.access_token}`}})}
  const [now,setNow]=useState(Date.now);
  const loading = useRef(false);
  const identity = useRef<string | null>(null);
  async function load(statusOnly = false){
    if(loading.current)return;
    loading.current=true;
    const userId=identity.current;
    try {
      const r=await authFetch(statusOnly?"/api/whatsapp/bot":"/api/whatsapp/bootstrap");
      const body=await r.json();
      if(identity.current!==userId)return;
      if(!r.ok){
        if([401,403].includes(r.status)){setBot({worker:null,online:false,canControl:false});setGroups([]);setDispatches([]);}
        throw new Error(body.error??"Falha ao carregar WhatsApp.");
      }
      setBot(statusOnly?body:body.botStatus);
      if(!statusOnly){setGroups(body.groups??[]);setDefaultGroupId(body.groups?.find((g:Group)=>g.is_default)?.id??"");setDispatches(body.dispatches??[]);}
      setReady(true);
    } finally { loading.current=false; }
  }
  useEffect(()=>{
    const {data:listener}=db.auth.onAuthStateChange((_e,next)=>{
      if(identity.current!==(next?.user.id??null)){setBot({worker:null,online:false,canControl:false});setGroups([]);setDispatches([]);setDefaultGroupId("");}
      identity.current=next?.user.id??null;setSession(next);
      if(!next){setReady(true);setBot({worker:null,online:false,canControl:false});setGroups([]);setDispatches([]);}
    });
    return()=>{identity.current=null;listener.subscription.unsubscribe()};
  },[db]);
  useEffect(()=>{
    if(!session)return;
    const reload=()=>{if(!document.hidden)void load().catch(e=>{setError(e.message);setReady(true)});};
    reload();
    // Frequent status updates keep QR/offline detection responsive. Groups and
    // dispatches have their own slower reconciliation instead of 3 polls/5s.
    let tick=0;
    const timer=setInterval(()=>{setNow(Date.now());if(!document.hidden)void load(++tick%6!==0).catch(()=>undefined)},5000);
    window.addEventListener("focus",reload);
    return()=>{clearInterval(timer);window.removeEventListener("focus",reload)};
  },[session?.user.id]);
  async function command(action:"reconnect"|"disconnect"|"sync_groups"){const worker=bot.worker;if(!worker)return;setBusy(true);setError("");setNotice("");try{const r=await authFetch("/api/whatsapp/bot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,workerId:worker.workerId})});const b=await r.json();if(!r.ok)throw new Error(b.error??"Falha no comando.");setNotice(action==="sync_groups"?"Atualização de grupos solicitada.":"Comando enviado ao bot.");setTimeout(()=>void load().catch(()=>undefined),1500)}catch(e){setError(e instanceof Error?e.message:"Falha no comando.")}finally{setBusy(false)}}
  async function setDefault(groupId:string){setBusy(true);setError("");try{const r=await authFetch("/api/whatsapp/groups",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({groupId})});const b=await r.json();if(!r.ok)throw new Error(b.error??"Não foi possível alterar o grupo.");setDefaultGroupId(groupId);setNotice("Grupo padrão atualizado.");await load()}catch(e){setError(e instanceof Error?e.message:"Falha ao alterar o grupo.")}finally{setBusy(false)}}
  if(!ready)return <main className="shell"><p>Carregando…</p></main>;
  if(!session)return <main className="shell"><section className="panel"><h1>Central WhatsApp</h1><p className="muted">Entre primeiro no painel administrativo.</p><Link href="/">Voltar</Link></section></main>;
  const worker=bot.worker && bot.worker.qrExpiresAt && Date.parse(bot.worker.qrExpiresAt)<=now?{...bot.worker,qrText:null}:bot.worker; const online=bot.online&&Boolean(worker?.heartbeatAt&&now-Date.parse(worker.heartbeatAt)<=35000); const connected=Boolean(online&&worker?.status==="connected");
  // Em waiting_qr, o worker está online e já publicou o QR no Supabase.
  // A Central precisa permanecer visível para o usuário conseguir escanear o QR
  // pelo próprio site, sem abrir um terminal no PC.
  if(!connected && worker?.status !== "waiting_qr")return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">CENTRAL DO BOT</p><h1>WhatsApp</h1><p className="muted">O PC/worker precisa estar online para controlar o WhatsApp.</p></div><div className="actions"><Link className="button-link" href="/auctions/new">＋ Novo leilão</Link><Link className="button-link" href="/">← Painel</Link></div></header>
    {error&&<p className="alert" role="alert">{error}</p>}
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">AGUARDANDO CONEXÃO</p><h2>Nenhum WhatsApp conectado</h2></div></div><p className="muted">Inicie o worker no PC. Assim que ele ficar online, esta página atualizará automaticamente.</p></section>
  </main>;
  const dot=connected?"🟢":online?"🟡":"🔴"; const selected=groups.find(g=>g.id===defaultGroupId);
  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">CENTRAL DO BOT</p><h1>WhatsApp</h1><p className="muted">Status, conexão, grupo padrão e fila de publicações. Os leilões são criados pelo botão “Novo leilão”.</p></div><div className="actions"><Link className="button-link" href="/auctions/new">＋ Novo leilão</Link><Link className="button-link" href="/">← Painel</Link></div></header>
    {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">WHATSAPP BOT</p><h2>{dot} {worker?botStatusLabel(worker.status):"Worker não instalado"}</h2>{!online&&<p className="muted">O worker está offline. O painel não consegue iniciar um PC desligado.</p>}</div><span className="status-pill">{worker?.version?`v${worker.version}`:"sem versão"}</span></div>
      <div className="stats-grid"><div className="stat-card"><span>Conta</span><strong>{worker?.accountJid??"—"}</strong></div><div className="stat-card"><span>Sessão</span><strong>{worker?.sessionActive?"Ativa":"Não autenticada"}</strong></div><div className="stat-card"><span>Última atividade</span><strong>{when(worker?.heartbeatAt)}</strong></div><div className="stat-card"><span>Grupos sincronizados</span><strong>{when(worker?.groupsSyncedAt)}</strong></div></div>
      {worker?.lastError&&<p className="alert">{worker.lastError}</p>}
      {bot.canControl&&worker&&<div className="actions"><button disabled={busy||!online} onClick={()=>void command("reconnect")}>Reconectar</button><button disabled={busy||!online} onClick={()=>void command("disconnect")}>Desconectar</button><button disabled={busy||!connected} onClick={()=>void command("sync_groups")}>Atualizar grupos</button></div>}
      {worker?.qrText&&bot.canControl&&<div style={{marginTop:18}}><h2>QR CODE</h2><p className="muted">Escaneie este QR pelo WhatsApp no celular: <strong>Configurações → Aparelhos conectados → Conectar um aparelho</strong>. Expira em {when(worker.qrExpiresAt)}.</p><div style={{overflowX:"auto",marginTop:12,borderRadius:14,background:"#000",padding:18,width:"fit-content",maxWidth:"100%"}}><pre style={{margin:0,color:"#fff",fontFamily:"Consolas, monospace",fontSize:11,lineHeight:.9,whiteSpace:"pre"}}>{worker.qrText}</pre></div></div>}
    </section>
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">PUBLICAÇÃO</p><h2>Grupo padrão</h2><p className="muted">Novos leilões usam este grupo por padrão. Você também pode escolher outro durante a criação.</p></div><button disabled={busy||!connected} onClick={()=>void command("sync_groups")}>Atualizar grupos</button></div>
      <label>Grupo<select value={defaultGroupId} onChange={e=>void setDefault(e.target.value)} disabled={busy||!groups.length}><option value="">Selecione…</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <button type="button" style={{marginTop:12}} onClick={()=>setAdvanced(v=>!v)}>{advanced?"Ocultar detalhes avançados":"Detalhes avançados"}</button>
      {advanced&&selected&&<div className="stat-card" style={{marginTop:12}}><span>JID do grupo</span><strong style={{fontSize:"1rem"}}>{selected.group_jid}</strong><small>Última sincronização: {when(selected.last_synced_at)}</small></div>}
    </section>
    <section className="panel"><div className="panel-title"><div><p className="eyebrow">FILA</p><h2>Publicações recentes</h2></div><button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Atualizar</button></div>
      {!dispatches.length?<p className="muted">Nenhuma publicação ainda.</p>:<div className="table-wrap"><table><thead><tr><th>Horário</th><th>Status</th><th>Imagem/anúncio</th><th>Enquete</th><th>Tentativas</th></tr></thead><tbody>{dispatches.slice(0,25).map(d=><tr key={d.id}><td>{when(d.scheduled_at)}</td><td>{dispatchLabel(d.status)}</td><td>{d.announcement_sent_at?"✅ Enviado":d.status==="sending"?"⏳ Enviando":"—"}</td><td>{d.poll_sent_at?"✅ Enviada":d.status==="sending"?"⏳ Enviando":"—"}</td><td>{d.attempts}{d.last_error?<small className="muted"> · {d.last_error}</small>:null}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
