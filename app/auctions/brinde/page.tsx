"use client";
import Link from 'next/link';
import type {Session} from '@supabase/supabase-js';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {createPublicSupabaseClient} from '@/lib/supabase';
import {brasiliaInputToIso,formatBrasiliaDateTime} from '@/lib/brasilia-time';
import {parsePollGame} from '@/lib/poll-game';
import {GIVEAWAY_DEFAULT_OPTIONS} from '@/lib/auction-wizard';
import GameAnswerFields from '@/app/game-answer-fields';

type Group={id:string;name:string};
type Poll={id:string;title:string;prize_name:string|null;game_kind:string;scheduled_at:string;sent_at:string|null;winner_name:string|null};
export default function BrindePage(){
 const [db]=useState(createPublicSupabaseClient);
 const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
 const [groups,setGroups]=useState<Group[]>([]),[groupId,setGroupId]=useState('');
 const [kind,setKind]=useState<'quiz'|'giveaway'>('giveaway'),[prize,setPrize]=useState(''),[question,setQuestion]=useState(''),[options,setOptions]=useState(GIVEAWAY_DEFAULT_OPTIONS),[correct,setCorrect]=useState(''),[imageUrl,setImageUrl]=useState(''),[when,setWhen]=useState('');
 const [polls,setPolls]=useState<Poll[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<{fingerprint:string;payload:Record<string,unknown>}|null>(null);
 const lock=useRef(false),identity=useRef<string|null>(null);
 async function request(url:string,init?:RequestInit){const {data}=await db.auth.getSession();if(!data.session)throw new Error('Entre no painel para continuar.');return fetch(url,{...init,cache:'no-store',headers:{...init?.headers,Authorization:`Bearer ${data.session.access_token}`}});}
 async function loadPolls(){const user=identity.current;const response=await request('/api/quick-polls');const body=await response.json();if(identity.current!==user)return;if(!response.ok)throw new Error(body.error??'Não foi possível consultar as enquetes.');setPolls(body.data??[]);}
 useEffect(()=>{const {data}=db.auth.onAuthStateChange((_event,next)=>{if(identity.current!==(next?.user.id??null)){setGroups([]);setPolls([]);pending.current=null;}identity.current=next?.user.id??null;setSession(next);if(!next)setReady(true);});return()=>{identity.current=null;data.subscription.unsubscribe();};},[db]);
 useEffect(()=>{if(!session)return;let active=true;void(async()=>{try{const response=await request('/api/whatsapp/groups');const body=await response.json();if(!active)return;if(!response.ok)throw new Error(body.error);setGroups(body.groups??[]);setGroupId(body.defaultGroupId??body.groups?.[0]?.id??'');await loadPolls();}catch(issue){if(active)setError(issue instanceof Error?issue.message:'Falha ao carregar.');}finally{if(active)setReady(true);}})();return()=>{active=false;};},[session?.user.id]);
 async function schedule(event:FormEvent){
  event.preventDefault();if(lock.current)return;setError('');setNotice('');
  const form={kind,prizeName:prize.trim(),title:kind==='quiz'?question.trim():`🎁 Brinde: ${prize.trim()}`.slice(0,200),options:options.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),correctIndex:correct===''?null:Number(correct),groupId,imageUrl:imageUrl.trim(),when};
  try{
   parsePollGame({...form,question:form.title});
   if(!groupId)throw new Error('Escolha o grupo do WhatsApp.');
   const scheduledAt=when?brasiliaInputToIso(when):new Date().toISOString();if(!scheduledAt)throw new Error('Confira o horário de Brasília.');
   const fingerprint=JSON.stringify(form);
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,payload:{...form,eventId:crypto.randomUUID(),scheduledAt}};
   lock.current=true;setBusy(true);
   const response=await request('/api/quick-polls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current.payload)});
   const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.error??'A publicação não foi confirmada. Tente novamente para consultar a mesma operação.');
   setNotice(`${kind==='quiz'?'Quiz':'Brinde'} agendado. O bot publicará a enquete e anunciará quem acertar primeiro.`);pending.current=null;setPrize('');setQuestion('');setCorrect('');setWhen('');setImageUrl('');await loadPolls();
  }catch(issue){setError(issue instanceof Error?issue.message:'Falha ao agendar.');}finally{lock.current=false;setBusy(false);}
 }
 if(!ready)return <main id="main-content" tabIndex={-1} className="shell"><p role="status">Carregando…</p></main>;
 if(!session)return <main id="main-content" tabIndex={-1} className="shell"><section className="panel"><h1>Brindes e Quiz</h1><p className="muted">Entre primeiro no painel administrativo.</p><Link href="/">Voltar ao painel</Link></section></main>;
 return <main id="main-content" tabIndex={-1} className="shell">
  <header className="topbar"><div><p className="eyebrow">PRÊMIOS E DESAFIOS</p><h1>Brindes e Quiz</h1><p className="muted">Escolha a resposta correta. O primeiro acerto confirmado ganha a carta, como no arremate.</p></div><Link className="button-link secondary" href="/auctions/new">Adicionar durante um leilão</Link></header>
  {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <section className="panel"><h2>Preparar enquete com prêmio</h2><form onSubmit={schedule} className="giveaway-form" aria-busy={busy}>
   <label>Tipo<select value={kind} disabled={busy} onChange={event=>setKind(event.target.value as typeof kind)}><option value="giveaway">🎁 Brinde</option><option value="quiz">🧩 Quiz</option></select></label>
   <label>Carta ou prêmio<input value={prize} maxLength={200} onChange={event=>setPrize(event.target.value)} placeholder="Ex.: Pikachu ex" required disabled={busy}/></label>
   <GameAnswerFields kind={kind} question={question} options={options} correctIndex={correct} disabled={busy} onQuestion={setQuestion} onCorrect={setCorrect} onOptions={value=>{setOptions(value);setCorrect('');}}/>
   <label>Imagem da carta (URL HTTPS, opcional)<input type="url" value={imageUrl} onChange={event=>setImageUrl(event.target.value)} disabled={busy}/></label>
   <label>Grupo do WhatsApp<select value={groupId} onChange={event=>setGroupId(event.target.value)} required disabled={busy||!groups.length}><option value="">Selecione…</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
   <label>Publicar em (Brasília, opcional)<input type="datetime-local" value={when} onChange={event=>setWhen(event.target.value)} disabled={busy}/><small>Sem data, publica quando o bot conectado processar a fila.</small></label>
   <button disabled={busy}>{busy?'Confirmando…':kind==='quiz'?'Agendar quiz':'Agendar brinde'}</button>
  </form></section>
  <section className="panel"><div className="panel-title"><div><h2>Enquetes recentes</h2><p className="muted">O resultado fica registrado mesmo após reiniciar o bot.</p></div><button className="secondary" disabled={busy} onClick={()=>void loadPolls().catch(issue=>setError(issue.message))}>Atualizar lista</button></div>
   {!polls.length?<p className="empty-state">Nenhuma enquete cadastrada.</p>:<ul className="health-list">{polls.map(poll=><li key={poll.id}><div><strong>{poll.game_kind==='quiz'?'🧩 Quiz':poll.game_kind==='legacy'?'Enquete antiga':'🎁 Brinde'} · {poll.prize_name||poll.title}</strong><p>{poll.title}</p><p>{poll.winner_name?`🏆 ${poll.winner_name} ganhou a carta!`:poll.sent_at?poll.game_kind==='legacy'?'Publicada · sem apuração automática':'Publicada · aguardando resposta correta':`Agendada: ${formatBrasiliaDateTime(poll.scheduled_at,false)}`}</p></div></li>)}</ul>}
  </section>
 </main>;
}
