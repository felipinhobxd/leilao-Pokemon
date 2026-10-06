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
  bucket_id text not null,
  name text not null,
  primary key (bucket_id,name)
);

-- Seed today's backup metadata for CI so retention tests exercise the real
-- cleanup path instead of being blocked by the production safety guard.
insert into storage.objects(bucket_id,name)
values (
  'business-backups',
  'backups/backup-' || to_char(clock_timestamp(),'YYYYMMDD') || '-ci.json'
);
