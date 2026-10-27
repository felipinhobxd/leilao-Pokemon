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

test('quiz prize announcement includes the winner name, prize and actual mention before marking delivery',async()=>{
 const sends=[],acks=[];const row={id:'prize',kind:'quick_poll_winner',group_jid:'g@g.us',payload:{winner_participant_id:'person',winner_name:'Maria',prize_name:'Pikachu ex'}};
 const db={async rpc(name,args){if(name==='claim_auction_notice')return {data:row};acks.push(args);return {};}};
 const drain=createAuctionNoticeDrain({db,getSocket:()=>({async sendMessage(_,payload){sends.push(payload);return {key:{id:'sent'}}}}),workerId:'w',resolveJid:async()=>'5511999999999@s.whatsapp.net',schedule:()=>({unref(){}}),report:()=>{}});
 assert.equal(await drain.tick(),1);assert.match(sends[0].text,/Parabéns, Maria, você acertou e ganhou Pikachu ex!/);assert.deepEqual(sends[0].mentions,['5511999999999@s.whatsapp.net']);assert.equal(acks[0].p_success,true);
});

function operationalFixture({attempts=0,kind='queue_finished'}={}) {
  let clock=0;
  const state={row:{id:'operational',kind,group_jid:'g@g.us',attempts,payload:{ends_at:'2026-10-26T04:00:00Z'}},
    alerts:new Map(),upserts:0,sends:[],acks:[],metadataCalls:0,
    failAlert:false,failPayload:false,claimLost:false,failSend:false,failFinish:false,
    metadata:{size:40,participants:[{id:'bot@s.whatsapp.net'}]}};
  const db={
    async rpc(name,args){
      if(name==='claim_auction_notice'){
        if(state.row.sent_at)return {data:null};
        state.row.attempts++;state.row.locked_by='w';return {data:structuredClone(state.row)};
      }
      state.acks.push(args.p_success);
      if(state.failFinish)return {error:{message:'finish response lost'}};
      state.row.locked_by=null;
      if(args.p_success)state.row.sent_at='sent';
      return {};
    },
    from(table){return {
      async upsert(row,options){
        assert.equal(table,'admin_notifications');assert.equal(options.ignoreDuplicates,true);
        state.upserts++;if(state.failAlert)return {error:{message:'alert unavailable'}};
        if(!state.alerts.has(row.external_event_id))state.alerts.set(row.external_event_id,structuredClone(row));
        return {};
      },
      update(values){
        assert.equal(table,'whatsapp_auction_notices');
        const execute=()=>{
          if(values.payload&&state.failPayload)return {error:{message:'payload unavailable'}};
          if(state.claimLost)return {data:null};
          Object.assign(state.row,structuredClone(values));return {data:{id:state.row.id}};
        };
        const query={eq(){return query;},is(){return query;},select(){return query;},async maybeSingle(){return execute();},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};
        return query;
      },
    };},
  };
  const socket={user:{id:'bot@s.whatsapp.net'},async groupMetadata(){state.metadataCalls++;return state.metadata;},
    async sendMessage(_,payload,options){state.sends.push({payload,options});if(state.failSend)throw Error('response lost');return {key:{id:'sent'}};}};
  const create=()=>createAuctionNoticeDrain({db,getSocket:()=>socket,workerId:'w',resolveJid:async()=>null,now:()=>clock,schedule:()=>({unref(){}}),report:()=>{}});
  return {state,create,advance(){clock+=30_000;}};
}

test('confirmed non-admin membership sends deadline without collective mention and queues one admin alert',async()=>{
  const f=operationalFixture();assert.equal(await f.create().tick(),1);
  const {state}=f;
  assert.equal(state.sends[0].payload.mentionAll,false);assert.doesNotMatch(state.sends[0].payload.text,/@all/);
  assert.match(state.sends[0].payload.text,/LANCES VÁLIDOS ATÉ 1H/);
  assert.equal(state.alerts.size,1);assert.equal(state.row.payload.mention_denied,true);
  assert.equal([...state.alerts.values()][0].kind,'NOTICE_MENTION_DENIED');assert.deepEqual(state.acks,[true]);
});

test('incomplete metadata or unconfirmed membership retains notice without guessing fallback',async()=>{
  for(const metadata of [{},{size:40,participants:[{id:'another@s.whatsapp.net'}]}]) {
    const f=operationalFixture();f.state.metadata=metadata;
    assert.equal(await f.create().tick(),0);assert.equal(f.state.sends.length,0);assert.equal(f.state.alerts.size,0);
    assert.deepEqual(f.state.acks,[false]);assert.equal(f.state.row.sent_at,undefined);
  }
});

test('lost send/finish response and process restart preserve fallback, message ID and delivered alert',async()=>{
  for(const failure of ['failSend','failFinish']) {
    const f=operationalFixture();f.state[failure]=true;
    assert.equal(await f.create().tick(),0);
    const alert=[...f.state.alerts.values()][0];alert.sent_at='already delivered';alert.payload.sent_to=['admin'];
    f.state[failure]=false;f.state.metadata={size:40,participants:[{id:'bot@s.whatsapp.net',admin:'admin'}]};
    f.advance();assert.equal(await f.create().tick(),1);
    assert.equal(f.state.metadataCalls,1);assert.equal(f.state.upserts,1);assert.equal(f.state.alerts.size,1);
    assert.equal(alert.sent_at,'already delivered');assert.deepEqual(alert.payload.sent_to,['admin']);
    assert.equal(f.state.sends.length,2);
    assert.deepEqual(f.state.sends[0],f.state.sends[1]);
  }
});

test('alert or fallback persistence failure cannot acknowledge or send; retry never resets delivered admin state',async()=>{
  for(const failure of ['failAlert','failPayload','claimLost']) {
    const f=operationalFixture();f.state[failure]=true;
    assert.equal(await f.create().tick(),0);assert.equal(f.state.sends.length,0);assert.deepEqual(f.state.acks,[false]);
    const alert=[...f.state.alerts.values()][0];if(alert){alert.sent_at='already delivered';alert.payload.sent_to=['admin'];}
    f.state[failure]=false;f.advance();assert.equal(await f.create().tick(),1);
    assert.equal(f.state.alerts.size,1);
    if(alert){assert.equal(alert.sent_at,'already delivered');assert.deepEqual(alert.payload.sent_to,['admin']);}
  }
});

test('ten failed deliveries escalate once durably without dropping notice or polling admins again after restart',async()=>{
  const f=operationalFixture({attempts:9,kind:'auction_closed'});f.state.failSend=true;
  assert.equal(await f.create().tick(),0);assert.equal(f.state.alerts.size,1);
  assert.equal([...f.state.alerts.values()][0].kind,'NOTICE_DELIVERY_DELAYED');assert.equal(f.state.row.payload.delivery_alerted,true);
  f.advance();assert.equal(await f.create().tick(),0);assert.equal(f.state.upserts,1);
  assert.equal(f.state.row.sent_at,undefined);assert.deepEqual(f.state.acks,[false,false]);
  assert.equal(f.state.sends[0].options.messageId,f.state.sends[1].options.messageId);
  f.state.failSend=false;f.advance();assert.equal(await f.create().tick(),1);
});

test('admin escalation storage outage still releases failed delivery claim and remains retryable',async()=>{
  const f=operationalFixture({attempts:9,kind:'auction_closed'});f.state.failSend=true;f.state.failAlert=true;
  assert.equal(await f.create().tick(),0);assert.deepEqual(f.state.acks,[false]);assert.equal(f.state.row.payload.delivery_alerted,undefined);
  f.state.failAlert=false;f.advance();assert.equal(await f.create().tick(),0);
  assert.equal(f.state.alerts.size,1);assert.equal(f.state.row.payload.delivery_alerted,true);
});

test('normal admin delivery and idle cycle add no alert or payload writes',async()=>{
  const f=operationalFixture();f.state.metadata={size:40,participants:[{id:'bot@s.whatsapp.net',admin:'admin'}]};
  const drain=f.create();assert.equal(await drain.tick(),1);assert.equal(await drain.tick(),0);
  assert.equal(f.state.sends[0].payload.mentionAll,true);assert.equal(f.state.upserts,0);
  assert.equal(f.state.row.payload.mention_denied,undefined);assert.equal(f.state.row.payload.delivery_alerted,undefined);
});
