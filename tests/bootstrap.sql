-- Disposable test database ONLY. These objects are provided by hosted Supabase.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create publication supabase_realtime;

-- Minimal Storage metadata mock for CI. Production uses Supabase Storage;
-- the cleanup retention guard only reads bucket_id/name from this table.
create schema storage;
create table storage.objects(
  id uuid not null default gen_random_uuid(),
  version text not null default gen_random_uuid()::text,
  updated_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}',
  bucket_id text not null,
  name text not null,
  primary key (bucket_id,name)
);
grant usage on schema storage to service_role;
grant all on storage.objects to service_role;

-- Test-only fake upload metadata: snapshots/receipts use the production RPCs.
-- Never installed in production; no network or actual Storage upload.
create function public.test_confirm_backup() returns void language plpgsql as $$
declare eid uuid:=gen_random_uuid(); meta jsonb; digest text; path text;
begin
 meta:=public.prepare_business_backup(eid);
 select payload_sha256 into digest from public.business_backup_receipts where export_id=eid;
 path:='backups/backup-20000101-0000.json.gz';
 insert into storage.objects(bucket_id,name,metadata) values('business-backups',path,'{"size":123}')
 on conflict(bucket_id,name) do update set version=gen_random_uuid()::text,updated_at=clock_timestamp(),metadata=excluded.metadata;
 perform public.confirm_business_backup(eid,digest,path,123);
 perform public.discard_business_backup(eid);
end $$;

-- Seed today's backup metadata for CI so retention tests exercise the real
-- cleanup path instead of being blocked by the production safety guard.
insert into storage.objects(bucket_id,name)
values (
  'business-backups',
  'backups/backup-' || to_char(clock_timestamp(),'YYYYMMDD') || '-ci.json'
);
