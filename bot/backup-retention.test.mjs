import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backupRetention } from './numeric-config.mjs';
const source = readFileSync(new URL('./backup.mjs', import.meta.url), 'utf8');

test('actual local backup preserves the new copy and all previous copies with invalid retention', async () => {
  for (const value of ['invalid', '0', '-1', '1.5', 'Infinity']) {
    const removed=[]; let written;
    const context=vm.createContext({process:{env:{BOT_BACKUP_KEEP:value}},Date,backupRetention,
      readBusinessBackup:async()=>({payload:'{}',export_id:'fixture'}),
      join:path.join,BACKUPS_DIR:'FICTIONAL-DIRECTORY',mkdirSync(){},
      writeFileSync:file=>{written=file;},readdirSync:()=>['backup-20261026-1200.json','backup-20261027-1200.json',path.basename(written)],
      rmSync:file=>removed.push(file),uploadBackupToCloud:async()=> 'fixture-cloud',Buffer,console:{warn(){}}});
    vm.runInContext(source.slice(source.indexOf('export async function runBusinessBackup')).replace('export async function','async function'),context);
    const result=await context.runBusinessBackup({},new Date('2026-10-28T12:00:00Z'));
    assert.ok(written);assert.equal(removed.length,0);assert.equal(result.kept,3);
  }
});

test('actual cloud backup confirms the upload but never prunes with invalid cloud retention', async () => {
  let uploaded=false,confirmed=false;const removed=[];
  const context=vm.createContext({process:{env:{BOT_BACKUP_CLOUD_KEEP:'invalid'}},Date,backupRetention,createHash,
    BACKUP_BUCKET:'business-backups',compressBusinessBackup:async()=>Buffer.from('compressed'),AbortSignal});
  const db={storage:{async listBuckets(){return {data:[{name:'business-backups'}]};},from(){return {
    async upload(){uploaded=true;return {};},
    async list(){return {data:[{name:'backup-20261028-1200.json.gz'},{name:'backup-20261027-1200.json.gz'}]};},
    async remove(names){removed.push(...names);return {};},
  };}},rpc(){return {async abortSignal(){confirmed=true;return {data:true};}};}};
  const fn=source.slice(source.indexOf('export async function uploadBackupToCloud'),source.indexOf('export async function runBusinessBackup'));
  vm.runInContext(fn.replace('export async function','async function'),context);
  await context.uploadBackupToCloud(db,'{}',new Date('2026-10-28T12:00:00Z'),'fixture');
  assert.equal(uploaded,true);assert.equal(confirmed,true);assert.deepEqual(removed,[]);
});
