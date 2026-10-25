// CI only. Uses fictional data and the actual generated SQL, never production.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RECOVERY_TABLES,recoverySql} from '../lib/recovery-package.mjs';

const target=process.env.TEST_DATABASE_URL;
const parsed=new URL(target);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.endsWith('_test'))throw new Error('disposable_test_database_required');
const dir=await mkdtemp(join(tmpdir(),'leilao-restore-drill-'));
let restored=false;
function psql(file){return execFileSync('psql',[target,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-f',file],{encoding:'utf8',maxBuffer:20_000_000});}
try {
  const seed=await readFile(new URL('../tests/fixtures/recovery-data.sql',import.meta.url),'utf8');
  const source=join(dir,'source.sql');
  await writeFile(source,`begin;\n${seed}\nselect jsonb_build_object('format_version',2,'exported_at',now(),'tables',public.export_business_backup());\nrollback;`);
  const data=JSON.parse(psql(source).trim());
  const restore=join(dir,'recovery.sql');await writeFile(restore,recoverySql(data));psql(restore);restored=true;
  for(const table of RECOVERY_TABLES){
    const check=join(dir,'check.sql');
    await writeFile(check,`select coalesce(jsonb_agg(t),'[]'::jsonb) from leilao_recovery.${table} t;`);
    const actual=JSON.parse(psql(check).trim());
    const normalize=rows=>rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort();
    assert.deepEqual(normalize(actual),normalize(data.tables[table]),table);
  }
  const check=join(dir,'private.sql');
  await writeFile(check,"select has_schema_privilege('anon','leilao_recovery','usage') or has_schema_privilege('authenticated','leilao_recovery','usage');");
  assert.equal(psql(check).trim(),'f');
  console.log(`RECOVERY_DRILL_OK: ${RECOVERY_TABLES.length} tables, values, references, quiz answers and private staging`);
}finally{
  if(restored){const cleanup=join(dir,'cleanup.sql');await writeFile(cleanup,'drop schema leilao_recovery cascade;');psql(cleanup);}
  await rm(dir,{recursive:true,force:true});
}
