import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {RECOVERY_TABLES,parseRecoveryBackup,createRecoveryPackage,verifyRecoveryPackage,recoveryImageUrls,recoverySql,storageImagePath} from '../lib/recovery-package.mjs';

const origin='https://fixture.supabase.co';
const image=origin+'/storage/v1/object/public/card-images/carta.png';
const fixture=()=>({format_version:2,exported_at:'2026-10-25T20:00:00Z',tables:Object.fromEntries(RECOVERY_TABLES.map(t=>[t,[]]))});
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'leilao-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('recovery rejects legacy/incomplete downloads rather than claiming full coverage',()=>{
  assert.throws(()=>parseRecoveryBackup(Buffer.from(JSON.stringify({tables:{cards:[]}}))),/backup_v2_required/);
  const data=fixture();delete data.tables.auction_drafts;
  assert.throws(()=>parseRecoveryBackup(Buffer.from(JSON.stringify(data))),/backup_table_missing/);
  const full=fixture();full.tables.invented=[];
  assert.throws(()=>parseRecoveryBackup(Buffer.from(JSON.stringify(full))),/backup_unknown_table/);
});

test('recovery packages gzip, Unicode and draft/game images; verifies hashes and corruption',async t=>{
  const dir=await temp(t),file=join(dir,'source.json.gz'),output=join(dir,'package');
  const data=fixture();data.tables.cards=[{id:'card',name:'Ação 😊',image_url:image,extra_images:[image]}];
  data.tables.auction_drafts=[{payload:{cards:[{imageUrl:image,extraImages:[image]}]}}];
  data.tables.whatsapp_quick_polls=[{image_url:image,correct_index:1,winner_name:'João'}];
  assert.deepEqual(recoveryImageUrls(data),[image]);
  await writeFile(file,gzipSync(JSON.stringify(data)));
  let requests=0;
  const result=await createRecoveryPackage({file,output,downloadImages:true,sourceOrigin:origin,fetchImage:async(url,options)=>{
    requests++;assert.equal(url,image);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);
    return new Response(Buffer.from('fixture image'),{headers:{'Content-Type':'image/png'}});
  }});
  assert.equal(requests,1);assert.equal(result.images_complete,true);
  assert.equal((await verifyRecoveryPackage(output)).rows.whatsapp_quick_polls,1);
  assert.match(await readFile(join(output,'recovery.sql'),'utf8'),/create schema leilao_recovery/);
  await assert.rejects(createRecoveryPackage({file,output}),/EEXIST/);
  await writeFile(join(output,result.images[0].file),'corrupted');
  await assert.rejects(verifyRecoveryPackage(output),/package_hash_mismatch/);
});

test('no downloads by default, redirects/external URLs/budget failures are explicit incomplete packages',async t=>{
  const dir=await temp(t),file=join(dir,'source.json'),data=fixture();
  data.tables.cards=[{image_url:image,extra_images:['https://external.example/image.png']}];await writeFile(file,JSON.stringify(data));
  let requests=0;
  const fetchImage=async()=>{requests++;return new Response('too large',{headers:{'Content-Type':'image/png','Content-Length':'999'}});};
  const first=await createRecoveryPackage({file,output:join(dir,'offline'),fetchImage});
  assert.equal(requests,0);assert.equal(first.images_complete,false);
  const second=await createRecoveryPackage({file,output:join(dir,'bounded'),downloadImages:true,sourceOrigin:origin,fetchImage,maxImageBytes:1});
  assert.equal(requests,1);assert.equal(second.images_complete,false);
  assert.deepEqual(second.images.map(i=>i.status).sort(),['failed','unsupported_origin_or_path']);
  assert.equal((await verifyRecoveryPackage(join(dir,'bounded'))).images_complete,false);
});

test('image allowlist never reaches arbitrary hosts, paths, credentials or signed tokens',()=>{
  for(const url of ['http://127.0.0.1/private',origin+'/storage/v1/object/public/another/x',origin+'/storage/v1/object/public/card-images/a%2F..%2Fx',image+'?token=secret','https://evil.example/a','https://user:pass@fixture.supabase.co/storage/v1/object/public/card-images/x'])assert.equal(storageImagePath(url,origin),null);
  assert.equal(storageImagePath(image,origin),'carta.png');
  assert.equal(storageImagePath(image,'https://evil.example'),null);
});

test('restore SQL always stages privately, rebuilds FKs and does not execute payload as SQL',()=>{
  const data=fixture();data.tables.cards=[{name:"'); drop schema public cascade; -- $restore$"}];
  const sql=recoverySql(data);
  assert.match(sql,/revoke all on schema leilao_recovery from public,anon,authenticated/);
  assert.match(sql,/including constraints including indexes/);
  assert.match(sql,/REFERENCES leilao_recovery/);
  assert.match(sql,/restore_schema_mismatch/);
  assert.doesNotMatch(sql,/truncate|disable trigger|insert into public\./i);
});
