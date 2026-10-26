import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {uploadBackupToCloud} from '../bot/backup.mjs';

function mock({uploadError=false,confirmationError=false}={}) {
 const calls=[];let uploaded;
 const bucket={
  async upload(path,bytes){calls.push('upload');uploaded={path,bytes};return uploadError?{error:new Error('offline')}:{error:null};},
  async list(){calls.push('retention');return {data:[]};},
 };
 const db={storage:{async listBuckets(){return {data:[{name:'business-backups'}]};},from(){return bucket;}},
  rpc(name,args){calls.push({name,args});return {async abortSignal(){return confirmationError?{error:new Error('mismatch')}:{data:true};}}}};
 return {db,calls,get uploaded(){return uploaded;}};
}
test('cloud receipt is confirmed only after successful gzip upload with exact payload hash and byte size',async()=>{
 const fixture=mock(),payload='{"tables":{"cards":[{"name":"João 😊"}]}}';
 const path=await uploadBackupToCloud(fixture.db,payload,new Date(2026,9,25,4,30),'snapshot-id');
 assert.equal(gunzipSync(fixture.uploaded.bytes).toString(),payload);
 assert.equal(path,fixture.uploaded.path);
 assert.deepEqual(fixture.calls,['upload',{name:'confirm_business_backup',args:{p_export_id:'snapshot-id',
  p_payload_sha256:createHash('sha256').update(payload).digest('hex'),p_object_name:path,p_compressed_bytes:fixture.uploaded.bytes.length}},'retention']);
});
test('failed upload never confirms coverage or prunes old copies',async()=>{
 const fixture=mock({uploadError:true});
 await assert.rejects(uploadBackupToCloud(fixture.db,'{}',new Date(),'snapshot'),/offline/);
 assert.deepEqual(fixture.calls,['upload']);
});
test('failed confirmation does not report cloud success or prune older backups',async()=>{
 const fixture=mock({confirmationError:true});
 await assert.rejects(uploadBackupToCloud(fixture.db,'{}',new Date(),'snapshot'),/backup_cloud_confirmation_failed/);
 assert.equal(fixture.calls.some(call=>call==='retention'),false);
 await assert.rejects(uploadBackupToCloud(fixture.db,'{}'),/backup_export_id_missing/);
});
