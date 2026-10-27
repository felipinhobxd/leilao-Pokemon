import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./service.mjs',import.meta.url),'utf8');
function fixture() {
  const state={exports:0,checks:0,events:[],running:0,maxRunning:0};
  const now=new Date();
  const context=vm.createContext({Date,process:{env:{BOT_BACKUP_HOUR:'0'}},backupBusy:false,shuttingDown:false,lastBackupDay:'',
    backupRetryBlocked:()=>false,clearBackupFailure(){},markBackupFailure(){},describeError:String,
    getTodayKey:async()=> 'fixture-day',
    hasTodaysCloudBackup:async()=>{state.checks++;return false;},
    runBusinessBackup:async()=>{state.exports++;state.running++;state.maxRunning=Math.max(state.maxRunning,state.running);await Promise.resolve();state.running--;return {path:'private-fixture',bytes:1,kept:1,cloudPath:'private-fixture'};},
    db:{},operationHealth:{backup:(...args)=>state.events.push(args)},console:{log(){},error(){}}});
  vm.runInContext(source.slice(source.indexOf('async function dailyBackup()'),source.indexOf('async function cleanupOldAuctions()')),context);
  return {context,state,now};
}

test('real daily backup and cleanup guard share a single export after asynchronous day lookup',async()=>{
  for(const order of ['cleanup-first','daily-first','two-daily']) {
    const {context:c,state,now}=fixture();
    const calls=order==='cleanup-first'?[c.ensureCloudBackupForCleanup(now),c.dailyBackup()]
      :order==='daily-first'?[c.dailyBackup(),c.ensureCloudBackupForCleanup(now)]:[c.dailyBackup(),c.dailyBackup()];
    await Promise.all(calls);
    assert.equal(state.exports,1,order);assert.equal(state.checks,1,order);assert.equal(state.maxRunning,1);
    assert.equal(c.backupBusy,false);assert.equal(c.lastBackupDay,'fixture-day');
    assert.equal(state.events.filter(row=>row[0]==='failed').length,0);
  }
});

test('shutdown during day lookup cannot launch a daily backup',async()=>{
  const {context:c,state}=fixture();
  c.getTodayKey=async()=>{c.shuttingDown=true;return 'fixture-day';};
  await c.dailyBackup();assert.equal(state.exports,0);assert.equal(state.checks,0);
});

test('existing daily receipt skips export; unavailable backup never certifies cleanup',async()=>{
  const {context:c,state,now}=fixture();c.hasTodaysCloudBackup=async()=>true;
  assert.equal(await c.ensureCloudBackupForCleanup(now),true);await c.dailyBackup();assert.equal(state.exports,0);
  const failed=fixture();failed.context.runBusinessBackup=async()=>{throw Error('offline');};
  assert.equal(await failed.context.ensureCloudBackupForCleanup(now),false);
  assert.equal(failed.context.lastBackupDay,'');assert.equal(failed.context.backupBusy,false);
});
