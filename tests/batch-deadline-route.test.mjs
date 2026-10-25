import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const backendUrl='data:text/javascript,'+encodeURIComponent(`
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export const state={version:'0.2.7',calls:[]};
export async function authorize(){const chain={select(){return this},order(){return this},limit(){return this},async maybeSingle(){return {data:{version:state.version}}}};return {user:{id:'00000000-0000-0000-0000-000000000091'},db:{from(){return chain},async rpc(name,args){state.calls.push({name,args});return {data:{queue:{id:'q'}}}}}};}
export function failure(e){return Response.json({error:e.message},{status:e.status??500});}
`);
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='@/lib/backend')return {url:backendUrl,shortCircuit:true};
  if(specifier==='@/lib/common-deadline')return {url:new URL('../lib/common-deadline.ts',import.meta.url).href,shortCircuit:true};
  if(specifier==='@/lib/auction-wizard')return {url:new URL('../lib/auction-wizard.ts',import.meta.url).href,shortCircuit:true};
  return next(specifier,context);
}});
const {POST}=await import('../app/api/auctions/batch/route.ts');const {state}=await import(backendUrl);hooks.deregister();
const start=Date.now()+300_000,end=start+7200_000;
function payload(){return {eventId:'batch-test',queue:{group_id:'00000000-0000-0000-0000-000000000092',starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),interval_seconds:30},items:[1,2].map(i=>({card:{name:'Carta '+i,card_number:'1/10',variant:'Normal',condition:'NM — Near Mint',language:'pt-BR'},auction:{lot_number:i,starting_price:5,bid_increment:1,buyout_price:null,duration_seconds:120,option_count:2}}))};}
const request=body=>new Request('http://localhost/api/auctions/batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('common deadline reaches wrapper RPC and derives valid durations for all items',async()=>{
  state.version='0.2.7';state.calls=[];
  assert.equal((await POST(request(payload()))).status,201);
  assert.equal(state.calls[0].name,'create_auction_queue_with_deadline');
  assert.equal(state.calls[0].args.p_payload.queue.ends_at,new Date(end).toISOString());
  assert.deepEqual(state.calls[0].args.p_payload.items.map(i=>i.auction.duration_seconds),[7200,7170]);
});
test('deadline before final publication and old bot are rejected before creating a queue',async()=>{
  state.calls=[];const bad=payload();bad.queue.ends_at=bad.queue.starts_at;
  assert.equal((await POST(request(bad))).status,400);
  state.version='0.2.6';assert.equal((await POST(request(payload()))).status,409);assert.equal(state.calls.length,0);
});
test('legacy duration mode remains available without common-deadline bot requirement',async()=>{
  state.calls=[];state.version='0.2.6';const legacy=payload();delete legacy.queue.ends_at;
  assert.equal((await POST(request(legacy))).status,201);assert.equal(state.calls[0].args.p_payload.items[0].auction.duration_seconds,120);
});
