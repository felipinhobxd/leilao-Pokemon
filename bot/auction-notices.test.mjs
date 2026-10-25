import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedQueueText,createAuctionNoticeDrain} from './auction-notices.mjs';

test('summary uses the selected Brasilia deadline and @all at beginning',()=>{
  assert.equal(finishedQueueText('2026-10-26T04:00:00Z'),'@all\n\nLEILÃO FINALIZADO!\n\nLANCES VÁLIDOS ATÉ 1H DA MANHÃ!');
  assert.match(finishedQueueText('2026-10-26T02:30:00Z'),/23H30!/);
  assert.match(finishedQueueText('2026-10-26T04:00:00Z',true,Date.parse('2026-10-26T05:00:00Z')),/PRAZO DOS LANCES ENCERRADO/);
});
test('result notices are serialized and 15 seconds apart; summary preserves native mentionAll',async()=>{
  let now=0;const sends=[],acks=[],timers=[];
  const rows=[{id:'summary',kind:'queue_finished',group_jid:'g@g.us',payload:{ends_at:'2026-10-26T04:00:00Z'}},...['a','b'].map(id=>({id,kind:'auction_closed',group_jid:'g@g.us',payload:{card_name:id,lot_number:1}}))];
  const db={async rpc(name,args){if(name==='claim_auction_notice')return {data:rows.shift()??null};acks.push(args);return {error:null};}};
  const socket={user:{id:'bot@s.whatsapp.net'},async groupMetadata(){return {participants:[{id:'bot@s.whatsapp.net',admin:'admin'}]};},async sendMessage(jid,payload,options){sends.push({at:now,payload,options});return {key:{id:'sent'}};}};
  const drain=createAuctionNoticeDrain({db,getSocket:()=>socket,workerId:'w',resolveJid:async()=>null,now:()=>now,schedule:(fn,delay)=>{timers.push(delay);return {unref(){}};},report:()=>{}});
  await drain.tick();assert.equal(sends[0].payload.mentionAll,true);assert.ok(sends[0].payload.text.startsWith('@all'));
  await drain.tick();assert.equal(sends.length,2);
  now=14_999;assert.equal(await drain.tick(),0);assert.equal(sends.length,2);
  now=15_000;await drain.tick();assert.equal(sends.length,3);assert.equal(sends[2].at-sends[1].at,15_000);
  assert.equal(acks.length,3);assert.ok(timers.includes(15_050));assert.ok(sends.every(s=>s.options.messageId));
});
test('failed delivery is not marked sent; retry uses the same message ID',async()=>{
  let fail=true,now=0;const ids=[],acks=[];
  const row={id:'stable',kind:'auction_closed',group_jid:'g@g.us',payload:{card_name:'Carta'}};
  const db={async rpc(name,args){if(name==='claim_auction_notice')return {data:row};acks.push(args.p_success);return {};}};
  const socket={async sendMessage(_,__,options){ids.push(options.messageId);if(fail)throw Error('network');return {key:{id:'ok'}};}};
  const drain=createAuctionNoticeDrain({db,getSocket:()=>socket,workerId:'w',resolveJid:async()=>null,now:()=>now,schedule:()=>({unref(){}}),report:()=>{}});
  assert.equal(await drain.tick(),0);assert.deepEqual(acks,[false]);
  fail=false;now=30_000;assert.equal(await drain.tick(),1);assert.deepEqual(acks,[false,true]);assert.equal(ids[0],ids[1]);
});

test('mention permission failure records a diagnostic and releases the claim even if diagnostic storage fails',async()=>{
  const recorded=[],finished=[];
  const db={async rpc(name,args){if(name==='claim_auction_notice')return {data:{id:'notice',kind:'queue_finished',group_jid:'g@g.us',payload:{}}};finished.push(args.p_success);return {};},from(){return {update(value){recorded.push(value);return this},eq(){return this},async is(){throw Error('storage unavailable')}}}};
  const socket={async groupMetadata(){throw Error('metadata unavailable')},async sendMessage(){assert.fail('must not send without permission')}};
  const drain=createAuctionNoticeDrain({db,getSocket:()=>socket,workerId:'w',resolveJid:async()=>null,report:()=>{}});
  assert.equal(await drain.tick(),0);assert.match(recorded[0].last_error,/@all/);assert.deepEqual(finished,[false]);
});
