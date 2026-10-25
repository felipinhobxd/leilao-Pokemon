import test from 'node:test';
import assert from 'node:assert/strict';
import {readBusinessBackup} from '../lib/business-backup.mjs';

test('snapshot chunks use PostgreSQL Unicode offsets and are discarded after reading',async()=>{
  const payload=JSON.stringify({exported_at:'now',tables:{cards:[{name:'Pikachu 😊 ação'}]}}),characters=Array.from(payload),calls=[];
  const db={rpc(name,args){calls.push({name,args});return {async abortSignal(){
    if(name==='prepare_business_backup')return {data:{id:'snapshot',characters:characters.length,bytes:Buffer.byteLength(payload),exported_at:'now'}};
    if(name==='read_business_backup_chunk')return {data:characters.slice(args.p_offset-1,args.p_offset-1+args.p_length).join('')};
    return {};
  }}}};
  const read=await readBusinessBackup(db,{chunkCharacters:7});assert.equal(read.payload,payload);
  assert.equal(calls.at(-1).name,'discard_business_backup');
  assert.deepEqual(calls.filter(c=>c.name==='read_business_backup_chunk').slice(0,3).map(c=>c.args.p_offset),[1,8,15]);
});
test('incomplete snapshot fails and still releases its temporary row',async()=>{
  let discarded=false;
  const db={rpc(name){return {async abortSignal(){if(name==='prepare_business_backup')return {data:{id:'id',characters:3,bytes:3}};if(name==='read_business_backup_chunk')return {error:{message:'outage'}};discarded=true;return {};}}}};
  await assert.rejects(readBusinessBackup(db),/backup_chunk_unavailable/);assert.equal(discarded,true);
});
