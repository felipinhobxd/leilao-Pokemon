import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const backend='data:text/javascript,'+encodeURIComponent(`
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export const state={role:'admin',version:'0.2.9',calls:[]};
export async function authorize(request,write){if(!request.headers.has('authorization'))throw new HttpError(401,'Entre');if(write&&state.role==='viewer')throw new HttpError(403,'Sem permissão');return {user:{id:'admin'},db:{from(){return {select(){return this},order(){return this},limit(){return this},async maybeSingle(){return {data:{version:state.version}}}}},async rpc(name,args){state.calls.push({name,args});return {data:{id:'poll'}}}}};}
export function failure(error){return Response.json({error:error.message},{status:error.status??500});}
`);
const hooks=registerHooks({resolve(s,c,next){if(s==='@/lib/backend')return {url:backend,shortCircuit:true};if(s==='@/lib/poll-game')return {url:new URL('../lib/poll-game.ts',import.meta.url).href,shortCircuit:true};return next(s,c)}});
const {POST}=await import('../app/api/quick-polls/route.ts');const {state}=await import(backend);hooks.deregister();
const payload=()=>({eventId:'test',kind:'quiz',groupId:'00000000-0000-0000-0000-000000000092',prizeName:'Pikachu ex',title:'Evolução do Pikachu?',options:['Raichu','Pichu'],correctIndex:0});
const request=(body,auth=true)=>new Request('http://local/api/quick-polls',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
test('quiz API enforces authentication, write role and correct answer before creating anything',async()=>{
 assert.equal((await POST(request(payload(),false))).status,401);state.role='viewer';assert.equal((await POST(request(payload()))).status,403);state.role='admin';state.calls=[];
 for(const patch of [{correctIndex:null},{options:['A','A']},{prizeName:''},{title:''}])assert.equal((await POST(request({...payload(),...patch}))).status,400);
 assert.equal(state.calls.length,0);
});
test('old bot cannot create new games; valid quiz reaches atomic creation RPC without exposing the answer in a message',async()=>{
 state.version='0.2.8';assert.equal((await POST(request(payload()))).status,409);state.version='0.2.9';state.calls=[];
 assert.equal((await POST(request(payload()))).status,201);assert.equal(state.calls[0].name,'create_quick_poll_game');assert.equal(state.calls[0].args.p_payload.correctIndex,0);assert.equal(state.calls[0].args.p_payload.title,'Evolução do Pikachu?');
});
