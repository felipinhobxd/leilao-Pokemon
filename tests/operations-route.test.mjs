import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const backendUrl='data:text/javascript,'+encodeURIComponent(`
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export const state={role:'admin',sent:false,locked:false,next:'2026-10-25T08:00:00.000Z',calls:[],failNotices:false};
export async function authorize(request,write){if(!request.headers.has('authorization'))throw new HttpError(401,'Entre');if(write&&state.role==='viewer')throw new HttpError(403,'Sem permissão');return {db:{from(table){let update,filters=[];const q={select(){return this},order(){return this},limit(){return this},eq(k,v){filters.push([k,v]);return this},gt(k,v){filters.push([k,'>',v]);return this},is(k,v){filters.push([k,v]);return this},update(v){update=v;return this},maybeSingle(){return this},then(ok){state.calls.push({table,update,filters});if(table==='whatsapp_bot_workers')return Promise.resolve({data:{status:'connected',heartbeat_at:new Date().toISOString(),version:'0.2.8',last_error:'<html>Cloudflare 521</html>',operational_health:{}}}).then(ok);if(table==='whatsapp_dispatches')return Promise.resolve({data:[]}).then(ok);if(update){const matches=!state.sent&&!state.locked&&filters.some(f=>f[0]==='next_attempt_at'&&f[1]===state.next);if(matches)state.next=update.next_attempt_at;return Promise.resolve({data:matches?[{id:'id'}]:[]}).then(ok);}return Promise.resolve(state.failNotices?{error:{message:'missing'}}:{data:[]}).then(ok)}};return q},storage:{from(){return {async list(){return {data:[{name:'backup-20261025-0400.json.gz',updated_at:'2026-10-25T07:00:00Z'}]}}}}}}};}
export function failure(e){return Response.json({error:e.message},{status:e.status??500});}
`);
const hooks=registerHooks({resolve(s,c,next){if(s==='@/lib/backend')return {url:backendUrl,shortCircuit:true};if(s==='@/lib/operation-health')return {url:new URL('../lib/operation-health.ts',import.meta.url).href,shortCircuit:true};return next(s,c)}});
const {GET,POST}=await import('../app/api/operations/route.ts');const {state}=await import(backendUrl);hooks.deregister();
const id='00000000-0000-0000-0000-000000000099';
function request(body,auth=true){return new Request('http://local/api/operations',{method:body?'POST':'GET',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer test'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
test('diagnostics require auth, return bounded safe data and preserve partial availability',async()=>{
  assert.equal((await GET(request(null,false))).status,401);
  state.failNotices=true;const response=await GET(request());const body=await response.json();
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(body.worker.online,true);
  assert.equal(body.worker.issue.includes('<html>'),false);assert.deepEqual(body.sectionsUnavailable,['Avisos de encerramento']);assert.equal(body.backups.length,1);
});
test('viewer cannot retry and malformed bodies do not reach a write',async()=>{
  state.role='viewer';assert.equal((await POST(request({id,nextAttempt:state.next}))).status,403);
  state.role='admin';state.calls=[];assert.equal((await POST(request({id:'bad',nextAttempt:'bad'}))).status,400);assert.equal(state.calls.length,0);
});
test('retry uses compare-and-set and never unlocks a sender or resends delivered notices',async()=>{
  state.role='admin';state.sent=false;state.locked=false;state.next='2026-10-25T08:00:00.000Z';
  const original={id,nextAttempt:state.next};assert.equal((await POST(request(original))).status,200);assert.equal((await POST(request(original))).status,409);
  state.sent=true;assert.equal((await POST(request({id,nextAttempt:state.next}))).status,409);
  state.sent=false;state.locked=true;assert.equal((await POST(request({id,nextAttempt:state.next}))).status,409);
  const write=state.calls.find(x=>x.update);assert.ok(write.filters.some(x=>x[0]==='sent_at'&&x[1]===null));assert.ok(write.filters.some(x=>x[0]==='locked_at'&&x[1]===null));assert.deepEqual(Object.keys(write.update),['next_attempt_at']);
});
