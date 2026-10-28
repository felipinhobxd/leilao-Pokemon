import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDeliverySchema } from './delivery-schema.mjs';
test('delivery schema is checked once and missing migrations block connecting WhatsApp', async () => {
  let calls=0;
  await assertDeliverySchema({ async rpc(name){calls++;assert.equal(name,'bot_delivery_revision');return {data:1};} });
  assert.equal(calls,1);
  for(const result of [{data:0},{error:{code:'PGRST202'}},{error:{code:'42883'}}]) {
    await assert.rejects(assertDeliverySchema({rpc:async()=>result}),{code:'delivery_schema_missing'});
  }
  await assert.rejects(assertDeliverySchema({rpc:async()=>({error:{code:'NETWORK'}})}),{code:'NETWORK'});
});
