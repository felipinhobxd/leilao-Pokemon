import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';

export const RECOVERY_TABLES=Object.freeze([
  'cards','participants','participant_identities','whatsapp_groups','auction_publish_queues',
  'auctions','bids','purchases','payments','deliveries','warnings','value_change_log',
  'participant_warnings','admin_notifications','auction_events','processed_commands',
  'whatsapp_dispatches','whatsapp_vote_state','whatsapp_quick_polls','payment_reminders',
  'auction_drafts','whatsapp_auction_notices',
]);
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function parseRecoveryBackup(bytes) {
  const plain=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:100_000_000}):bytes;
  if(plain.length>100_000_000)throw new Error('backup_too_large');
  const data=JSON.parse(plain.toString('utf8'));
  if(data.format_version!==2||!Number.isFinite(Date.parse(data.exported_at))||!data.tables)throw new Error('backup_v2_required');
  if(RECOVERY_TABLES.some(table=>!Array.isArray(data.tables[table])))throw new Error('backup_table_missing');
  if(Object.keys(data.tables).some(table=>!RECOVERY_TABLES.includes(table)))throw new Error('backup_unknown_table');
  for(const rows of Object.values(data.tables))if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('backup_invalid_row');
  return {data,plain};
}

// Include images referenced by saved drafts as well as published cards/games.
export function recoveryImageUrls(data) {
  const urls=new Set();
  function visit(value,key='') {
    if(typeof value==='string'&&/^(image_url|imageUrl|extra_images|extraImages)$/.test(key)&&value)urls.add(value);
    else if(Array.isArray(value))for(const item of value)visit(item,key);
    else if(value&&typeof value==='object')for(const [child,item] of Object.entries(value))visit(item,child);
  }
  visit(data.tables);
  return [...urls].sort();
}

export function storageImagePath(raw,sourceOrigin) {
  try {
    const url=new URL(raw),source=new URL(sourceOrigin);
    if(source.protocol!=='https:'||!source.hostname.endsWith('.supabase.co')||source.username||source.password||source.port||source.pathname!=='/'||source.search||source.hash)return null;
    if(url.origin!==source.origin||url.username||url.password||url.search||url.hash)return null;
    const prefix='/storage/v1/object/public/card-images/';
    if(!url.pathname.startsWith(prefix))return null;
    const path=decodeURIComponent(url.pathname.slice(prefix.length));
    if(!path||path.split('/').some(segment=>!segment||segment==='.'||segment==='..')||/[\\\x00-\x1f]/.test(path))return null;
    return path;
  } catch {return null;}
}

// This restores into a private, isolated schema. Nothing in public is changed,
// and no publication/reminder/WhatsApp trigger can run on these copied tables.
export function recoverySql(data) {
  const payload=JSON.stringify(data.tables);
  let delimiter='$backup_'+sha256(payload).slice(0,20)+'$';
  while(payload.includes(delimiter))delimiter=delimiter.replace('$backup_','$backup_x');
  const names=RECOVERY_TABLES.map(name=>"'"+name+"'").join(',');
  return `-- Execute only in a DISPOSABLE database with the same schema/migrations.
-- Fails if leilao_recovery already exists; never replaces data.
-- No accounts, sessions, workers or messages are restored to production.
begin;
set local search_path='';
create schema leilao_recovery;
revoke all on schema leilao_recovery from public,anon,authenticated;
create temporary table leilao_restore_payload(payload jsonb);
insert into leilao_restore_payload values (${delimiter}${payload}${delimiter}::jsonb);
do $restore$
declare names text[]:=array[${names}]; t text; constraint_row record; item jsonb; cols text[]; actual text[];
begin
 foreach t in array names loop
  execute format('create table leilao_recovery.%I (like public.%I including constraints including indexes)',t,t);
  execute format('alter table leilao_recovery.%I enable row level security',t);
  execute format('revoke all on leilao_recovery.%I from public,anon,authenticated',t);
  select array_agg(a.attname::text order by a.attname) into cols from pg_catalog.pg_attribute a
    where a.attrelid=format('public.%I',t)::regclass and a.attnum>0 and not a.attisdropped;
  for item in select value from leilao_restore_payload p,jsonb_array_elements(p.payload->t) loop
   select array_agg(key order by key) into actual from jsonb_object_keys(item) key;
   if actual is distinct from cols then raise exception 'restore_schema_mismatch: %',t; end if;
  end loop;
  execute format('insert into leilao_recovery.%I select * from jsonb_populate_recordset(null::leilao_recovery.%I, (select payload->%L from leilao_restore_payload))',t,t,t);
 end loop;
 -- Rebuild all business foreign keys after inserting every table. Auth IDs
 -- remain informational: credentials/accounts must be recovered separately.
 for constraint_row in
  select c.conname,child.relname,pg_catalog.pg_get_constraintdef(c.oid) definition
  from pg_catalog.pg_constraint c join pg_catalog.pg_class child on child.oid=c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid=child.relnamespace
    join pg_catalog.pg_class parent on parent.oid=c.confrelid
    join pg_catalog.pg_namespace pn on pn.oid=parent.relnamespace
  where c.contype='f' and ns.nspname='public' and pn.nspname='public'
    and child.relname=any(names) and parent.relname=any(names)
 loop
  execute format('alter table leilao_recovery.%I add constraint %I %s',constraint_row.relname,constraint_row.conname,
    replace(constraint_row.definition,'REFERENCES public.','REFERENCES leilao_recovery.'));
 end loop;
end $restore$;
drop table leilao_restore_payload;
commit;
`;
}

async function boundedImage(response,maxBytes) {
  if(!response.ok||!response.body||!String(response.headers.get('content-type')).startsWith('image/'))throw new Error('image_unavailable');
  if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('image_too_large');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw new Error('image_too_large');chunks.push(chunk);}
  if(!bytes)throw new Error('image_empty');
  return Buffer.concat(chunks);
}

export async function createRecoveryPackage({file,output,downloadImages=false,sourceOrigin,fetchImage=fetch,maxImageBytes=20_000_000,maxTotalImageBytes=500_000_000}) {
  if((await stat(file)).size>100_000_000)throw new Error('backup_too_large');
  const {data,plain}=parseRecoveryBackup(await readFile(file));
  if(downloadImages&&!storageImagePath(`${sourceOrigin}/storage/v1/object/public/card-images/check`,sourceOrigin))throw new Error('invalid_source_origin');
  await mkdir(output); // No recursive/upsert: never overwrite an older package.
  const sql=Buffer.from(recoverySql(data));
  await writeFile(join(output,'backup.json'),plain,{flag:'wx'});
  await writeFile(join(output,'recovery.sql'),sql,{flag:'wx'});
  await mkdir(join(output,'images'));
  const manifest={version:1,exported_at:data.exported_at,created_at:new Date().toISOString(),
    files:{'backup.json':sha256(plain),'recovery.sql':sha256(sql)},
    rows:Object.fromEntries(RECOVERY_TABLES.map(table=>[table,data.tables[table].length])),
    audit_window_days:7,images:[],images_complete:false,
    excludes:['Auth accounts/passwords','WhatsApp session','API keys','worker state'],
  };
  let used=0;
  // Sequential downloads, only from the exact named project's public bucket.
  // No credentials, no redirects, no production SQL or automatic retries.
  for(const url of recoveryImageUrls(data)) {
    const path=storageImagePath(url,sourceOrigin);
    if(!downloadImages||!path){manifest.images.push({url,status:downloadImages?'unsupported_origin_or_path':'not_downloaded'});continue;}
    try {
      if(used>=maxTotalImageBytes)throw new Error('image_budget_exceeded');
      const bytes=await boundedImage(await fetchImage(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30_000)}),Math.min(maxImageBytes,maxTotalImageBytes-used));
      used+=bytes.length;
      const digest=sha256(bytes),local=`images/${digest}`;
      try{await writeFile(join(output,local),bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
      manifest.files[local]=digest;
      manifest.images.push({url,storage_path:path,file:local,sha256:digest,bytes:bytes.length,status:'saved'});
    } catch(error){manifest.images.push({url,status:'failed',reason:error.message});}
  }
  manifest.images_complete=manifest.images.every(image=>image.status==='saved');
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  return manifest;
}

export async function verifyRecoveryPackage(output) {
  const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  if(manifest.version!==1||!manifest.files||!Array.isArray(manifest.images)||!manifest.rows)throw new Error('manifest_invalid');
  for(const required of ['backup.json','recovery.sql'])if(!manifest.files[required])throw new Error('manifest_file_missing');
  for(const [name,digest] of Object.entries(manifest.files)){
    if(!/^(backup\.json|recovery\.sql|images\/[a-f0-9]{64})$/.test(name)||!/^([a-f0-9]{64})$/.test(digest))throw new Error('manifest_path_invalid');
    if(sha256(await readFile(join(output,name)))!==digest)throw new Error('package_hash_mismatch');
  }
  const {data}=parseRecoveryBackup(await readFile(join(output,'backup.json')));
  if(sha256(Buffer.from(recoverySql(data)))!==manifest.files['recovery.sql'])throw new Error('package_sql_mismatch');
  for(const table of RECOVERY_TABLES)if(manifest.rows[table]!==data.tables[table].length)throw new Error('package_row_count_mismatch');
  const urls=recoveryImageUrls(data);
  if(manifest.images.length!==urls.length||manifest.images.some((item,index)=>item.url!==urls[index]))throw new Error('package_images_mismatch');
  for(const item of manifest.images)if(item.status==='saved'&&(manifest.files[item.file]!==item.sha256||item.file!==`images/${item.sha256}`))throw new Error('package_images_mismatch');
  return {...manifest,images_complete:manifest.images.every(image=>image.status==='saved')};
}
