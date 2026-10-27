import { dispatchMessageId } from './dispatch-id.mjs';
import { openingMentionPermission } from './announce-sticker.mjs';
import { mentionMessage } from './participant-contact.mjs';
import { createErrorReporter } from './supabase-resilience.mjs';
import { describeError } from './error-log.mjs';
import { prizeWinnerText } from './poll-game.mjs';

export function finishedQueueText(endsAt, collective=true, now=null) {
  const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'numeric',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(endsAt));
  const hour=Number(parts.find(p=>p.type==='hour')?.value), minute=parts.find(p=>p.type==='minute')?.value;
  const deadline=`${hour}H${minute==='00'?'':minute}${hour<6?' DA MANHÃ':''}`;
  const line=now!=null && new Date(endsAt).getTime()<=now ? `PRAZO DOS LANCES ENCERRADO ÀS ${deadline}!` : `LANCES VÁLIDOS ATÉ ${deadline}!`;
  return `${collective?'@all\n\n':''}LEILÃO FINALIZADO!\n\n${line}`;
}

export function createAuctionNoticeDrain({db,getSocket,workerId,resolveJid,now=Date.now,schedule=setTimeout,report=createErrorReporter()}) {
  let busy=false,nextRead=0,idle=0,timer;
  async function alertAdmins(notice,kind,reason) {
    const {error}=await db.from('admin_notifications').upsert({
      participant_id:null,kind,external_event_id:`${kind}:${notice.id}`,
      payload:{notice_id:notice.id,notice_kind:notice.kind,queue_id:notice.queue_id??null,
        group_jid:notice.group_jid,ends_at:notice.payload?.ends_at??null,
        attempts:notice.attempts??1,reason},
    },{onConflict:'external_event_id',ignoreDuplicates:true});
    if(error)throw error;
  }
  async function savePayload(notice,extra) {
    const payload={...notice.payload,...extra};
    const {data,error}=await db.from('whatsapp_auction_notices').update({payload})
      .eq('id',notice.id).eq('locked_by',workerId).is('sent_at',null).select('id').maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('notice_claim_lost');
    notice.payload=payload;
  }
  const drain={
    wake(){nextRead=0;idle=0;},
    dispose(){if(timer)clearTimeout(timer);},
    async tick(){
      const socket=getSocket();
      if(!socket||busy||now()<nextRead)return 0;
      busy=true;
      let notice;
      try {
        const claimed=await db.rpc('claim_auction_notice',{p_worker_id:workerId});
        if(claimed.error)throw claimed.error;
        notice=claimed.data;
        if(!notice){idle=Math.min(4,idle+1);nextRead=now()+15_000*idle;return 0;}
        idle=0;
        let payload;
        if(notice.kind==='queue_finished'){
          // Preserve the chosen mode across lost send/finish responses. Never
          // switch a replay with the same message ID back to collective mode.
          if(!notice.payload.mention_denied){
            let permission;
            try{permission=openingMentionPermission(await socket.groupMetadata(notice.group_jid),socket.user);}
            catch{throw new Error('Não foi possível validar a permissão de @all. O aviso será tentado novamente.');}
            if(!permission.allowed){
              if(permission.code!=='mention_denied')throw new Error('Não foi possível confirmar a participação/permissão do bot no grupo. O aviso será tentado novamente.');
              // Persist the administrative alert and decision before sending.
              // Duplicate alerts leave sent_at/sent_to intact on retry.
              await alertAdmins(notice,'NOTICE_MENTION_DENIED',permission.reason);
              await savePayload(notice,{mention_denied:true,mention_denied_at:new Date(now()).toISOString()});
            }
          }
          const collective=!notice.payload.mention_denied;
          payload={text:finishedQueueText(notice.payload.ends_at,collective,now()),mentionAll:collective};
        }else if(notice.kind==='quick_poll_winner'){
          const row=notice.payload;
          const jid=await resolveJid(row.winner_participant_id);
          const winner=mentionMessage(row.winner_name??'Participante',row.winner_participant_id,jid,who=>who);
          payload={text:prizeWinnerText(row.winner_name??'Participante',row.prize_name??'a carta')+(jid?`\n\n${winner.text}`:''),mentions:winner.mentions};
        }else{
          const row=notice.payload;
          if(row.winner_participant_id){
            const jid=await resolveJid(row.winner_participant_id);
            const winner=mentionMessage(row.winner_name??'Participante',row.winner_participant_id,jid,who=>who);
            const price=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(row.final_price));
            payload={text:`🏁 *Leilão encerrado!*\n\n🃏 Lote ${row.lot_number??'—'} — ${row.card_name??'Carta'}\n👤 Vencedor: ${winner.text}\n💰 ${price}${row.tie&&row.win_type==='highest_bid'?'\n⚖️ Empate no valor: venceu quem deu o lance primeiro.':''}`,mentions:winner.mentions};
          }else payload={text:`🏁 Leilão de *${row.card_name??'carta'}* (lote ${row.lot_number??'—'}) encerrado sem lances válidos.`};
        }
        const sent=await socket.sendMessage(notice.group_jid,payload,{messageId:dispatchMessageId(notice.id,'auction-notice')});
        if(!sent?.key?.id)throw new Error('auction_notice_send_failed');
        const finished=await db.rpc('finish_auction_notice',{p_id:notice.id,p_worker_id:workerId,p_success:true});
        if(finished.error)throw finished.error;
        nextRead=notice.kind==='auction_closed'?now()+15_000:0;
        if(timer)clearTimeout(timer);
        timer=schedule(()=>{void drain.tick();},notice.kind==='auction_closed'?15_050:50);
        timer?.unref?.();
        return 1;
      }catch(error){
        nextRead=now()+30_000;
        if(notice){
          if(Number(notice.attempts)>=10&&!notice.payload?.delivery_alerted){
            try{
              await alertAdmins(notice,'NOTICE_DELIVERY_DELAYED','O aviso continua pendente após pelo menos dez tentativas. Confira a conexão e a permissão de envio no grupo.');
              await savePayload(notice,{delivery_alerted:true});
            }catch(alertError){report('Falha ao registrar alerta de aviso pendente',alertError);}
          }
          try {
            // Error recording is secondary; always release the claim even if it fails.
            if(db.from) await db.from('whatsapp_auction_notices').update({last_error:describeError(error).slice(0,400)}).eq('id',notice.id).eq('locked_by',workerId).is('sent_at',null);
          } catch {}
          try{await db.rpc('finish_auction_notice',{p_id:notice.id,p_worker_id:workerId,p_success:false});}catch{}
        }
        report('Falha ao entregar aviso de leilão',error);
        return 0;
      }finally{busy=false;}
    },
  };
  return drain;
}
