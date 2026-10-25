import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBackupDownload} from '../lib/backup-download.ts';
import {gunzipSync} from 'node:zlib';

function fixture({data={auctions:[],cards:[],large:'x'.repeat(5_000_000)},error=null,isPublic=false}={}){
  const seen={};
  const content=JSON.stringify({exported_at:'2026-10-25T06:00:00Z',tables:data});
  return {seen,db:{rpc(name,args){return {async abortSignal(signal){seen.signal=signal;if(error)return {error};if(name==='prepare_business_backup')return {data:{id:'id',characters:content.length,bytes:Buffer.byteLength(content),exported_at:'2026-10-25T06:00:00Z'}};if(name==='read_business_backup_chunk')return {data:content.slice(args.p_offset-1,args.p_offset-1+args.p_length)};seen.discarded=true;return {};}}},storage:{async getBucket(){return {data:{public:isPublic}};},from(bucket){seen.bucket=bucket;return {async upload(path,payload,options){Object.assign(seen,{path,payload,options});return {};},async createSignedUrl(path,seconds,options){Object.assign(seen,{seconds,download:options.download});return {data:{signedUrl:'https://example.supabase.co/storage/v1/object/sign/business-backups/manual/backup.json?token=test'}};}};}}}};
}
test('backup over 4.5 MB returns only a private short-lived download link',async()=>{
  const {db,seen}=fixture();const result=await prepareBackupDownload(db,'admin',new Date('2026-10-25T06:00:00Z'));
  assert.ok(result.bytes>4_500_000);assert.ok(JSON.stringify(result).length<1000);
  assert.equal(seen.seconds,120);assert.equal(seen.bucket,'business-backups');assert.equal(seen.path,'manual/backup-admin.json.gz');
  assert.equal(seen.options.upsert,true);assert.equal(JSON.parse(gunzipSync(seen.payload).toString('utf8')).tables.auctions.length,0);
  assert.ok(result.compressedBytes<result.bytes);assert.ok(result.filename.endsWith('.json.gz'));
  assert.ok(seen.signal instanceof AbortSignal);
});
test('outage/null backup/public bucket never produces a fake or public backup',async()=>{
  for(const f of [fixture({error:{message:'521'}}),fixture({data:null}),fixture({isPublic:true})]){
    await assert.rejects(prepareBackupDownload(f.db,'admin'));assert.equal(f.seen.payload,undefined);
  }
});
