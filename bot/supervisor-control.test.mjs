import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./service.mjs',import.meta.url),'utf8');
function fixture(reply={data:{logout_requested:false,command:null}}) {
  const calls=[];
  const context=vm.createContext({WORKER_ID:'fixture-worker',commandBusy:false,shuttingDown:false,
    desiredRunning:true,restartTimer:null,runtime:{status:'connected'},console:{log(){}},clearTimeout(){},
    db:{rpc:async(name,args)=>{calls.push(['rpc',name,args]);if(reply instanceof Error)throw reply;return reply;},
      from:table=>({update:patch=>({eq:async()=>{calls.push(['ack',table,patch]);return {};}})})},
    stopChild:async()=>calls.push(['stop']),removeWhatsAppSession:async()=>calls.push(['remove']),
    publishState:async()=>calls.push(['publish']),executeBotCommand:async c=>calls.push(['execute',c.id]),
    finishBotCommand:async c=>calls.push(['finish',c.id]),reportServiceError:(_scope,e)=>calls.push(['error',e.message])});
  for(const [start,end] of [['async function claimBotControl()','async function finishBotCommand('],
    ['async function processPendingLogout(','// Backup diário'],['async function pollBotCommands()','async function shutdown(']]) {
    vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),context);
  }
  return {calls,context,poll:()=>vm.runInContext('pollBotCommands()',context)};
}

test('one simulated idle hour uses 720 control RPCs and no worker reads',async()=>{
  const f=fixture();for(let i=0;i<720;i++)await f.poll();
  assert.equal(f.calls.length,720);
  for(const call of f.calls){assert.equal(call[1],'claim_whatsapp_bot_control');assert.equal(call[2].p_worker_id,'fixture-worker');}
});

test('logout stops and removes session before clearing flag; no command executes',async()=>{
  const f=fixture({data:{logout_requested:true,command:null}});await f.poll();
  assert.deepEqual(f.calls.map(c=>c[0]),['rpc','stop','remove','ack','publish']);
  assert.equal(f.context.desiredRunning,false);assert.equal(f.calls[3][2].logout_requested,false);
});

test('session removal or acknowledgement failure keeps logout retryable',async()=>{
  const f=fixture({data:{logout_requested:true,command:null}});
  f.context.removeWhatsAppSession=async()=>{throw new Error('session removal failed');};
  await f.poll();assert.deepEqual(f.calls.map(c=>c[0]),['rpc','stop','error']);
  f.context.removeWhatsAppSession=async()=>f.calls.push(['remove']);
  await f.poll();assert.deepEqual(f.calls.slice(3).map(c=>c[0]),['rpc','stop','remove','ack','publish']);
  const g=fixture({data:{logout_requested:true,command:null}});
  g.context.db.from=()=>({update:()=>({eq:async()=>({error:{message:'ack failed'}})})});
  await g.poll();assert.equal(g.calls.at(-1)[0],'error');assert.ok(!g.calls.some(c=>c[0]==='publish'));
});

test('commands execute once per claim, including while child is disconnected',async()=>{
  const f=fixture({data:{logout_requested:false,command:{id:'cmd-1',worker_id:'fixture-worker',command:'reconnect'}}});
  f.context.desiredRunning=false;await f.poll();
  assert.deepEqual(f.calls.map(c=>c[0]),['rpc','execute','finish']);
});

test('failed or malformed claim never deletes a session or automatically replays a claim',async()=>{
  for(const reply of [new Error('lost response'),{error:{message:'missing migration'}},{data:null},
    {data:{logout_requested:false}},{data:{logout_requested:true,command:{id:'bad',worker_id:'fixture-worker'}}},
    {data:{logout_requested:false,command:{id:'other',worker_id:'other-worker'}}}]) {
    const f=fixture(reply);await f.poll();assert.deepEqual(f.calls.map(c=>c[0]),['rpc','error']);
    assert.equal(f.context.commandBusy,false);
  }
});

test('supervisor skips overlapping control polls and shutdown polls',async()=>{
  const f=fixture();let release;
  f.context.db.rpc=async()=>{f.calls.push(['rpc']);return new Promise(resolve=>{release=resolve;});};
  const first=f.poll();await f.poll();assert.equal(f.calls.length,1);
  release({data:{logout_requested:false,command:null}});await first;
  f.context.shuttingDown=true;await f.poll();assert.equal(f.calls.length,1);
});
