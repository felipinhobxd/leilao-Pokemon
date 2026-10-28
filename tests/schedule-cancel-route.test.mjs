import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const backend = 'data:text/javascript,' + encodeURIComponent(`
export const state={status:'scheduled',race:false,reads:0,filters:[]};
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export async function authorize(){return {db:{from(){let patch,allowed;const q={
 select(){return q},eq(){return q},in(column,values){state.filters.push([column,values]);allowed=values;return q},
 update(value){patch=value;return q},async maybeSingle(){
  if(!patch){state.reads++;return {data:state.status?{status:state.status}:null};}
  if(state.race)state.status='sending';
  if(!allowed.includes(state.status))return {data:null};
  state.status=patch.status;return {data:{id:'dispatch'}};
 }};return q}}};}
export function failure(e){return Response.json({error:e.message},{status:e.status??500});}
`);
const hook=registerHooks({resolve(s,c,next){return s==='@/lib/backend'?{url:backend,shortCircuit:true}:next(s,c)}});
const { DELETE }=await import('../app/api/whatsapp/schedules/route.ts');
const { state }=await import(backend);hook.deregister();
const request=()=>new Request('http://fixture/api/whatsapp/schedules',{method:'DELETE',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({auctionId:'00000000-0000-0000-0000-000000000091'})});

test('cancellation atomically refuses a dispatch claimed immediately before the write',async()=>{
  state.status='scheduled';state.race=true;
  assert.equal((await DELETE(request())).status,409);
  assert.equal(state.status,'sending');
  assert.deepEqual(state.filters.at(-1),['status',['scheduled','failed','cancelled']]);
});
test('cancellation handles pending, failed, already cancelled, missing and sent dispatches',async()=>{
  state.race=false;
  for(const status of ['scheduled','failed','cancelled']){
    state.status=status;state.reads=0;
    assert.equal((await DELETE(request())).status,200);
    assert.equal(state.status,'cancelled');assert.equal(state.reads,0);
  }
  state.status=null;assert.equal((await DELETE(request())).status,404);
  state.status='sent';assert.equal((await DELETE(request())).status,409);assert.equal(state.status,'sent');
});
