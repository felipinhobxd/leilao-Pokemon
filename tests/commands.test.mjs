import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/commands.ts';
const base = { type:'BID_PLACED', eventId:'one', auctionId:'10000000-0000-0000-0000-000000000001', participantId:'20000000-0000-0000-0000-000000000001', amount:15.25 };
test('valid typed bridge event',()=>assert.deepEqual(parseCommand(base),base));
test('rejects invalid money and missing identity',()=>{
  for(const amount of [-1,NaN,Infinity,0.001,'10',null]) assert.throws(()=>parseCommand({...base,amount}));
  for(const patch of [{eventId:''},{participantId:undefined},{auctionId:'x'},{type:'UNKNOWN'},{adminUserId:'spoof'}]) assert.throws(()=>parseCommand({...base,...patch}));
});
test('rejects unsafe image URL and incomplete CRUD',()=>{
  assert.throws(()=>parseCommand({type:'CARD_CREATE',eventId:'c',data:{name:'Pikachu',starting_price:1,buyout_price:2,image_url:'javascript:alert(1)'}}));
  assert.throws(()=>parseCommand({type:'PARTICIPANT_UPDATE',eventId:'p',data:{}}));
});
