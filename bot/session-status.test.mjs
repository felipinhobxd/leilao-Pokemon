import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./service.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function publishState(');
const end=source.indexOf('async function loadPreviousWorkerState',start);

test('real heartbeat reflects authenticated socket even when saved registered flag is false',async()=>{
  for(const [status,saved,expected] of [['connected',false,true],['connecting',false,false],['disconnected',false,false],['waiting_qr',false,false],['connecting',true,true]]) {
    const writes=[];
    const context=vm.createContext({runtime:{status},clearExpiredQr(){},publishBusy:false,
      readSessionInfo:async()=>({sessionActive:saved}),Date,JSON,operationHealth:{state:{}},
      connectionHistory:{summary:()=>({})},lastPublishedHealth:'',WORKER_ID:'fixture',BOT_VERSION:'fixture',
      AbortSignal,db:{from(){return {upsert(row){writes.push(row);return {abortSignal:async()=>({})}}}}},
      reportServiceError:()=>assert.fail('unexpected error')});
    await vm.runInContext(source.slice(start,end)+'\npublishState();',context);
    assert.equal(writes.length,1);assert.equal(writes[0].session_active,expected);
    assert.equal(writes[0].status,status);
  }
});
