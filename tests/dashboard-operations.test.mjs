import test from 'node:test';
import assert from 'node:assert/strict';
import { readDashboardOperations } from '../lib/dashboard-operations.ts';

test('uninstalled optimization never probes production for a missing RPC',async()=>{
  const before=process.env.DASHBOARD_OPERATIONS_RPC_ENABLED;delete process.env.DASHBOARD_OPERATIONS_RPC_ENABLED;
  let queries=0;const windowStart='2026-10-27T12:00:00Z';
  const db={rpc(){assert.fail('activation flag required')},from(table){queries++;const q={
    select(){return q},order(){return q},eq(){return q},gte(_key,value){assert.equal(value,windowStart);return q},limit(){return q},maybeSingle(){return q},
    then(resolve){return Promise.resolve({data:null,count:table==='whatsapp_dispatches'?2:null}).then(resolve)},
  };return q}};
  try{const result=await readDashboardOperations(db,windowStart);assert.equal(queries,7);assert.equal(result.counts.sent,2);}
  finally{if(before!==undefined)process.env.DASHBOARD_OPERATIONS_RPC_ENABLED=before;}
});

test('enabled optimization makes exactly one read and rejects incomplete or failed snapshots',async()=>{
  const before=process.env.DASHBOARD_OPERATIONS_RPC_ENABLED;process.env.DASHBOARD_OPERATIONS_RPC_ENABLED='1';
  const counts={sent:1,failed:0,scheduled:2,sending:1,cancelled:0};let calls=0,response={data:{worker:null,group:null,counts}};
  const db={async rpc(name,args){calls++;assert.equal(name,'read_dashboard_operations');assert.equal(args.p_window_start,'window');return response},from(){assert.fail('no fallback after an uncertain read')}};
  try{
    assert.deepEqual(await readDashboardOperations(db,'window'),response.data);assert.equal(calls,1);
    for(const failure of [{error:{code:'PGRST202'}},{error:{code:'timeout'}},{data:{}},{data:{counts:{...counts,sent:-1}}}]){
      response=failure;await assert.rejects(readDashboardOperations(db,'window'),/dashboard_operations_read_failed/);
    }
  }finally{if(before===undefined)delete process.env.DASHBOARD_OPERATIONS_RPC_ENABLED;else process.env.DASHBOARD_OPERATIONS_RPC_ENABLED=before;}
});
