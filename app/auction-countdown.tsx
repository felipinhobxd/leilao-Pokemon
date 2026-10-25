"use client";
import {useEffect,useState} from "react";
export default function AuctionCountdown({end}:{end:unknown}) {
 const [now,setNow]=useState(0);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);return()=>clearInterval(timer);},[end]);
 if(!end)return <>Sem prazo</>;
 if(!now)return <>Calculando…</>;
 const seconds=Math.max(0,Math.floor((Date.parse(String(end))-now)/1000));
 if(!seconds)return <>Encerrando…</>;
 return <>{seconds>=3600?`${Math.floor(seconds/3600)}h `:""}{Math.floor(seconds%3600/60)}m {seconds%60}s</>;
}
