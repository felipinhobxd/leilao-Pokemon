import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Isolate the real route handler from credentials/network; the SQL suite
// separately exercises its real database RPC against disposable Postgres.
const backendUrl = 'data:text/javascript,' + encodeURIComponent(`
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const state={role:'admin',calls:[],error:null};
export async function authorize(request){
 if(request.headers.get('authorization')!=='Bearer test') throw new HttpError(401,'Login necessário');
 return {user:{id:'00000000-0000-0000-0000-000000000081'},profile:{role:state.role},db:{rpc:async(name,args)=>{state.calls.push({name,args});return {data:state.error?null:{deleted_auctions:503},error:state.error};}}};
}
export function failure(e){return Response.json({error:e.message},{status:e instanceof HttpError?e.status:500});}
`);
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/backend') return { url: backendUrl, shortCircuit: true };
  if (specifier === '@/lib/purge') return { url: new URL('../lib/purge.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { POST } = await import('../app/api/auctions/delete-completed/route.ts');
const { state } = await import(backendUrl);
hooks.deregister();
const payload = { confirm1:'excluir leilões encerrados', confirm2:'quero excluir os encerrados', eventId:'00000000-0000-0000-0000-000000000086' };
function request(body, headers = {}) {
  return new Request('http://localhost/api/auctions/delete-completed', { method:'POST', headers:{authorization:'Bearer test','content-type':'application/json',...headers}, body:typeof body==='string'?body:JSON.stringify(body) });
}
function reset(role='admin') { state.role=role; state.calls=[]; state.error=null; }

test('completed deletion: auth, role and both phrases block RPC calls', async () => {
  for (const role of ['operator','viewer']) {
    reset(role);
    assert.equal((await POST(request(payload))).status,403);
    assert.equal(state.calls.length,0);
  }
  reset();
  assert.equal((await POST(request(payload,{authorization:''}))).status,401);
  for (const bad of [{...payload,confirm1:''},{...payload,confirm2:''},{...payload,confirm2:'quero excluir mesmo'},null,'{broken', {...payload,eventId:'invalid'}]) {
    assert.equal((await POST(request(bad))).status,400);
  }
  assert.equal((await POST(request(payload,{'content-type':'text/plain'}))).status,415);
  assert.equal(state.calls.length,0);
});

test('completed deletion: normalized confirmations and stable operation ID reach RPC once', async () => {
  reset();
  const response=await POST(request({...payload,confirm1:' EXCLUIR  LEILÕES ENCERRADOS ',confirm2:'QUERO EXCLUIR OS ENCERRADOS'}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{data:{deleted_auctions:503}});
  assert.deepEqual(state.calls,[{name:'delete_completed_auctions',args:{p_event_id:payload.eventId,p_confirm1:payload.confirm1,p_confirm2:payload.confirm2,p_admin_user_id:'00000000-0000-0000-0000-000000000081'}}]);
});

test('completed deletion: database rejections never return success', async () => {
  for (const [error,status] of [[{message:'forbidden'},403],[{message:'delete_not_confirmed'},400],[{message:'event_id_conflict'},409],[{code:'PGRST202',message:'missing function'},503],[{message:'unexpected'},500]]) {
    reset(); state.error=error;
    assert.equal((await POST(request(payload))).status,status);
  }
});
