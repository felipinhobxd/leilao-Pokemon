import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const backend='data:text/javascript,'+encodeURIComponent(`
export class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
export const state={calls:[],backupError:false,role:'viewer'};
export async function authorize(request,write){
 if(!request.headers.has('authorization'))throw new HttpError(401,'Entre');
 if(write&&state.role==='viewer')throw new HttpError(403,'Sem permissão');
 return {db:{from(table){state.calls.push(table);const q={select(){return this},order(){return this},limit(){return this},maybeSingle(){return this},is(){return this},eq(){return this},then(ok){return Promise.resolve({data:table==='whatsapp_bot_workers'?{status:'connected',heartbeat_at:new Date().toISOString(),version:'0.2.10',operational_health:{protectionVersion:1,cleanup:{status:'blocked',at:'2026-10-26T03:00:00Z',reason:'backup_coverage_incomplete',deleted:0}}}:[],error:null}).then(ok)}};return q;},async rpc(name){state.calls.push(name);return state.backupError?{error:{message:'<html>secret'}}:{data:{state:'confirmed',validSnapshotAt:'2026-10-26T03:00:00Z'}};}}};
}
export function failure(e){return Response.json({error:e.status?e.message:'Indisponível'},{status:e.status??500})}
`);
const hook=registerHooks({resolve(s,c,next){if(s==='@/lib/backend')return {url:backend,shortCircuit:true};if(s==='@/lib/operation-health')return {url:new URL('../lib/operation-health.ts',import.meta.url).href,shortCircuit:true};return next(s,c);}});
const {GET,POST}=await import('../app/api/operations/route.ts');const {state}=await import(backend);hook.deregister();
const req=()=>new Request('http://localhost/api/operations',{headers:{authorization:'Bearer test'}});
test('diagnostic requires auth, replaces Storage listing with one metadata RPC, and keeps cleanup historical',async()=>{
 state.calls=[];
 assert.equal((await GET(new Request('http://localhost/api/operations'))).status,401);assert.deepEqual(state.calls,[]);
 const response=await GET(req()),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(state.calls,['whatsapp_bot_workers','whatsapp_auction_notices','whatsapp_dispatches','get_operation_backup_status']);
 assert.equal(body.backupProtection.state,'confirmed');assert.equal(body.worker.cleanup.status,'blocked');assert.equal(body.worker.protectionVersion,1);
 assert.equal(body.worker.cleanup.at,'2026-10-26T03:00:00Z');
 assert.equal((await POST(req())).status,403);
});
test('backup metadata failure is explicit and leaves other diagnostics available',async()=>{
 state.backupError=true;
 const body=await (await GET(req())).json();
 assert.equal(body.backupProtection,null);assert.equal(body.backupReadFailed,true);assert.ok(body.sectionsUnavailable.includes('Proteção do backup'));
 assert.equal(body.worker.status,'connected');assert.ok(!JSON.stringify(body).includes('secret'));
 state.backupError=false;
});
