import test from 'node:test';
import assert from 'node:assert/strict';
import { readBotStatus } from '../lib/whatsapp-status.ts';
function db(worker) {
  const chain={select(){return this},order(){return this},limit(){return this},async maybeSingle(){return {data:worker,error:null}}};
  return {from(){return chain}};
}
const worker=()=>({worker_id:'test',status:'waiting_qr',heartbeat_at:new Date().toISOString(),qr_render:'PRIVATE_QR',qr_expires_at:new Date(Date.now()+60000).toISOString()});
test('viewer never receives QR; active operator can connect',async()=>{
  assert.equal((await readBotStatus(db(worker()),{role:'viewer'})).worker.qrText,null);
  assert.equal((await readBotStatus(db(worker()),{role:'operator'})).worker.qrText,'PRIVATE_QR');
});
test('expired, offline and connected workers do not expose stale QR',async()=>{
  for(const patch of [{qr_expires_at:new Date(0).toISOString()},{heartbeat_at:new Date(0).toISOString()},{status:'connected'}]){
    assert.equal((await readBotStatus(db({...worker(),...patch}),{role:'admin'})).worker.qrText,null);
  }
  assert.equal((await readBotStatus(db(null),{role:'admin'})).online,false);
});
