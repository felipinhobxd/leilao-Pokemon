"use client";
import {useEffect,useState} from "react";
import {dashboardFreshness,updateAge} from "../lib/dashboard-freshness";
import {formatBrasiliaTime} from "../lib/brasilia-time";

type Props={online:boolean;failure:string;lastUpdatedAt:number|null;streamConnected:boolean;refreshing:boolean;onRetry:()=>void};
export default function DashboardFreshness({online,failure,lastUpdatedAt,streamConnected,refreshing,onRetry}:Props){
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const update=()=>{if(!document.hidden)setNow(Date.now());};
    const timer=setInterval(update,10_000);
    document.addEventListener("visibilitychange",update);
    return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",update);};
  },[]);
  const state=dashboardFreshness({online,failed:!!failure,lastUpdatedAt,streamConnected,now:Math.max(now,lastUpdatedAt??0)});
  return <section className={`panel dashboard-freshness${state.warning?" freshness-warning":""}`} aria-label="Atualização do painel">
    <div><strong role="status">{state.label}</strong>
      <p className="muted" aria-live="off">{lastUpdatedAt===null?"Nenhuma leitura completa confirmada nesta sessão.":<>Última leitura completa: <time dateTime={new Date(lastUpdatedAt).toISOString()} title={formatBrasiliaTime(new Date(lastUpdatedAt).toISOString())}>{updateAge(lastUpdatedAt,Math.max(now,lastUpdatedAt))}</time>.</>}</p>
      {state.warning&&<p>{!online?"Verifique sua internet. Os dados exibidos podem estar desatualizados.":failure||(!streamConnected&&state.kind!=="stale"?"As consultas periódicas continuam. Use o botão para conferir os dados agora.":"Os dados exibidos podem estar desatualizados. Atualize antes de tomar decisões.")}</p>}
      <p className="muted">Esta conexão é do painel; o status do bot aparece na área de operação.</p>
    </div>
    <button className="secondary" disabled={!online||refreshing} onClick={onRetry}>{refreshing?"Atualizando painel…":state.warning?"Tentar novamente":"Atualizar painel"}</button>
  </section>;
}
