import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {syncPublicationProjection} from './publication-projection.mjs';

function fixture(responses) {
  const writes=[], reports=[];
  return {writes,reports,db:{from(table){
    assert.equal(table,'auctions');
    return {update(values){return {eq(key,id){
      writes.push({values,key,id});
      return {select(){return {async maybeSingle(){
        const response=responses.shift();
        if(response instanceof Error) throw response;
        return response;
      }}}};
    }}}};
  }},reportError:(...args)=>reports.push(args)};
}
const values={poll_id:'poll',message_id:'image',whatsapp_group_id:'group',updated_at:'2026-10-27T03:00:00Z'};

test('publication projection retries a lost response with identical IDs, once',async()=>{
  const f=fixture([new Error('response lost'),{data:{id:'auction'}}]);
  assert.equal(await syncPublicationProjection({...f,auctionId:'auction',values}),true);
  assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.reports.length,0);
});

test('publication projection reports persistent error or absent auction without throwing',async()=>{
  for(const response of [{error:{message:'offline'}},{data:null}]) {
    const f=fixture([response,response]);
    assert.equal(await syncPublicationProjection({...f,auctionId:'auction',values}),false);
    assert.equal(f.writes.length,2);assert.equal(f.reports.length,1);
  }
});

test('publisher continues marking the delivered dispatch sent when projection fails',async()=>{
  const source=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('  await syncPublicationProjection(');
  const end=source.indexOf('  const remotePollId =',begin);
  const f=fixture([{error:{message:'offline'}},{error:{message:'offline'}}]);
  let markedSent=0;
  const context=vm.createContext({syncPublicationProjection,reportServiceError:f.reportError,
    db:{from(table){
      if(table==='auctions')return f.db.from(table);
      assert.equal(table,'whatsapp_dispatches');
      return {update(row){assert.equal(row.status,'sent');markedSent++;return {eq(){return {select(){return {single:async()=>({data:{id:'dispatch',...row}})}}}}}}};
    }},auction:{id:'auction'},group:{group_jid:'group'},dispatch:{id:'dispatch',poll_message_id:'poll',announcement_message_id:'image'}});
  await vm.runInContext(`(async()=>{${source.slice(begin,end)}})()`,context);
  assert.equal(markedSent,1);assert.equal(f.writes.length,2);assert.equal(f.reports.length,1);
  assert.equal(context.dispatch.status,'sent');
});
