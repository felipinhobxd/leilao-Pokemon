import test from 'node:test';
import assert from 'node:assert/strict';
import { logCurrentLeader } from './leader-log.mjs';

test('terminal leader uses one joined query, preserving eligibility, ordering and 20-candidate limit', async () => {
  const calls=[], logs=[];
  const person=(name,patch={})=>({display_name:name,status:'active',...patch});
  const bids=[
    {amount:100,participant:person('Blocked',{status:'blocked'})},
    {amount:90,participant:person('Suspended',{suspension_until:'2026-10-29T00:00:00Z'})},
    {amount:80,participant:null},
    {amount:70,participant:person('Winner',{phone_e164:'+550000',suspension_until:'2026-10-27T00:00:00Z'})},
    {amount:60,participant:person('Later')},
  ];
  const q={select(value){calls.push(['select',value]);return q;},eq(...args){calls.push(['eq',...args]);return q;},
    order(...args){calls.push(['order',...args]);return q;},async limit(value){calls.push(['limit',value]);return {data:bids};}};
  await logCurrentLeader({from(table){calls.push(['from',table]);return q;}},'auction',{now:()=>Date.parse('2026-10-28T00:00:00Z'),log:text=>logs.push(text)});
  assert.equal(calls.filter(c=>c[0]==='from').length,1);
  assert.match(calls.find(c=>c[0]==='select')[1],/participant:participants/);
  assert.deepEqual(calls.filter(c=>c[0]==='order'),[
    ['order','amount',{ascending:false}],['order','whatsapp_event_at',{ascending:true,nullsFirst:true}],
    ['order','processed_at',{ascending:true}],['order','confirmation_order',{ascending:true}],
  ]);
  assert.deepEqual(calls.at(-1),['limit',20]);assert.equal(logs.length,1);assert.match(logs[0],/Winner.*70,00/);
});

test('missing candidates and read errors do not print an invented leader', async () => {
  for(const response of [{data:[]},{error:new Error('offline')},{data:[{participant:null}]}]) {
    const q={select(){return q},eq(){return q},order(){return q},async limit(){return response}};
    await logCurrentLeader({from:()=>q},'auction',{log:()=>assert.fail('no eligible leader')});
  }
});
