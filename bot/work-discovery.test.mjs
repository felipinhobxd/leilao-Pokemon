import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createWorkDiscovery} from './work-discovery.mjs';

test('idle discovery is fresh every cycle; remote work wakes the very next cycle', async () => {
  let calls = 0, active = false, time = 0;
  const hasWork = createWorkDiscovery({db:{rpc:async name => {
    assert.equal(name,'bot_has_pending_work'); calls++; return {data:active};
  }}, now:()=>time});
  for (;time<60_000;time+=5000) assert.equal(await hasWork(),false);
  assert.equal(calls,12);
  active=true;
  assert.equal(await hasWork(),true);
  assert.equal(calls,13);
  active=false;
  for (time=65_000;time<120_000;time+=5000) assert.equal(await hasWork(),true);
  assert.equal(calls,13,'active workers keep running without discovery overhead');
  assert.equal(await hasWork(),false);
  assert.equal(calls,14);
});

test('database errors, absent migration and malformed results keep all workers enabled', async () => {
  for (const reply of [{error:{code:'PGRST202'}},{data:null},{data:'false'},new Error('timeout')]) {
    let calls=0,time=0,errors=0;
    const hasWork=createWorkDiscovery({db:{rpc:async()=>{calls++;if(reply instanceof Error)throw reply;return reply;}},now:()=>time,onError:()=>errors++});
    assert.equal(await hasWork(),true);
    time=5000;assert.equal(await hasWork(),true);
    assert.equal(calls,1);assert.equal(errors,1);
    time=60_000;assert.equal(await hasWork(),true);assert.equal(calls,2);
  }
});

test('one simulated idle hour replaces 2880 empty worker requests with 720 probes',async()=>{
  let time=0,requests=0;
  const hasWork=createWorkDiscovery({db:{rpc:async()=>{requests++;return {data:false};}},now:()=>time});
  for(;time<3_600_000;time+=5000)assert.equal(await hasWork(),false);
  assert.equal(requests,720);
  assert.equal(requests/(4*720),0.25);
});

// Exercise the actual production cycle, not a duplicate scheduler. Votes and
// drains must remain live in idle mode; openings must precede dispatches.
const source=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
const start=source.indexOf('const schedulerCycle = createSerialCycle(');
const end=source.indexOf('schedulerTimer = setInterval',start);
test('production idle cycle skips four database workers but drains votes and notices',async()=>{
  for (const active of [false,true]) {
    const events=[];
    const work=name=>async()=>{events.push(name);};
    const context=vm.createContext({createSerialCycle:fn=>fn,hasPendingWork:async()=>active,
      sendOpeningSequence:work('opening'),runScheduler:work('dispatch'),finalizeDueAuctions:work('finalize'),sendDueQuickPolls:work('poll'),
      voteQueue:Promise.resolve(),voteInbox:{drain:work('votes')},auctionNoticeDrain:{tick:work('notice')},
      adminNotificationDrain:{tick:work('admin')},paymentReminderDrain:{tick:work('payment')},reportServiceError:()=>assert.fail('unexpected error')});
    await vm.runInContext(source.slice(start,end)+'\nschedulerCycle();',context);
    for(const name of ['votes','notice','admin','payment'])assert.ok(events.includes(name));
    for(const name of ['opening','dispatch','finalize','poll'])assert.equal(events.includes(name),active);
    if(active){assert.ok(events.indexOf('opening')<events.indexOf('dispatch'));assert.ok(events.indexOf('votes')<events.indexOf('finalize'));assert.ok(events.indexOf('finalize')<events.indexOf('notice'));}
  }
});
