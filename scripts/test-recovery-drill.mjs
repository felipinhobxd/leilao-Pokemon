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
// Compare timestamp text in a fixed zone while preserving microseconds.
function psql(file){return execFileSync('psql',[target,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',"set timezone='UTC'",'-f',file],{encoding:'utf8',maxBuffer:20_000_000});}
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
  await writeFile(check,`select has_schema_privilege('anon','leilao_recovery','usage') or has_schema_privilege('authenticated','leilao_recovery','usage')
    or exists(select 1 from pg_class c where c.relnamespace='leilao_recovery'::regnamespace and c.relkind='r' and
      (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')));`);
  assert.equal(psql(check).trim(),'f');
  await writeFile(check,`select jsonb_build_object(
    'expected', (select count(*) from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_class parent on parent.oid=c.confrelid where c.contype='f' and child.relnamespace='public'::regnamespace and parent.relnamespace='public'::regnamespace and child.relname in (${RECOVERY_TABLES.map(t=>"'"+t+"'").join(',')}) and parent.relname in (${RECOVERY_TABLES.map(t=>"'"+t+"'").join(',')})),
    'restored', (select count(*) from pg_constraint where contype='f' and connamespace='leilao_recovery'::regnamespace),
    'unvalidated', (select count(*) from pg_constraint where contype='f' and connamespace='leilao_recovery'::regnamespace and not convalidated),
    'business_triggers', (select count(*) from pg_trigger where tgrelid in (select oid from pg_class where relnamespace='leilao_recovery'::regnamespace) and not tgisinternal));`);
  const constraints=JSON.parse(psql(check).trim());
  assert.ok(constraints.expected>0);assert.equal(constraints.restored,constraints.expected);
  assert.equal(constraints.unvalidated,0);assert.equal(constraints.business_triggers,0);
  assert.throws(()=>psql(restore),/already exists/,'a second restore must never overwrite staging');
  console.log(`RECOVERY_DRILL_OK: ${RECOVERY_TABLES.length} tables, exact values, ${constraints.restored} validated references, private staging and overwrite protection`);
}finally{
  if(restored){const cleanup=join(dir,'cleanup.sql');await writeFile(cleanup,'drop schema leilao_recovery cascade;');psql(cleanup);}
  await rm(dir,{recursive:true,force:true});
}
