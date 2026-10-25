export const DASHBOARD_STALE_AFTER_MS = 90_000;

export function dashboardFreshness({online,failed,lastUpdatedAt,streamConnected,now=Date.now()}:{online:boolean;failed:boolean;lastUpdatedAt:number|null;streamConnected:boolean;now?:number}) {
  if(!online)return {kind:"offline",label:"Painel sem conexão",warning:true};
  if(failed)return {kind:"failed",label:"Falha ao atualizar o painel",warning:true};
  if(lastUpdatedAt===null)return {kind:"loading",label:"Aguardando dados do painel",warning:false};
  if(now-lastUpdatedAt>=DASHBOARD_STALE_AFTER_MS)return {kind:"stale",label:"Dados do painel desatualizados",warning:true};
  if(!streamConnected)return {kind:"disconnected",label:"Conexão em tempo real interrompida",warning:true};
  return {kind:"current",label:"Painel atualizado",warning:false};
}

export function updateAge(lastUpdatedAt:number,now=Date.now()) {
  const seconds=Math.max(0,Math.floor((now-lastUpdatedAt)/1000));
  if(seconds<10)return "agora";
  if(seconds<60)return `há ${seconds} segundos`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return `há ${minutes} minuto${minutes===1?"":"s"}`;
  const hours=Math.floor(minutes/60);
  return `há ${hours} hora${hours===1?"":"s"}`;
}
