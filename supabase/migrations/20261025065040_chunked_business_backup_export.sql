begin;
-- Transient snapshots are service-only and are not themselves backed up.
create table public.business_backup_exports(
  id uuid primary key,
  payload text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.business_backup_exports enable row level security;
revoke all on public.business_backup_exports from public,anon,authenticated;
grant all on public.business_backup_exports to service_role;

-- JSON text aggregation avoids expanding tens of thousands of audit payloads
-- into another giant jsonb tree. Keep the same tables and retention filters.
do $patch$
declare ddl text;
begin
  ddl:=pg_get_functiondef('public.export_business_backup()'::regprocedure);
  if strpos(ddl,'public.export_business_backup()')=0 or strpos(ddl,'RETURNS jsonb')=0 then raise exception 'backup_definition_not_recognized'; end if;
  ddl:=replace(ddl,'public.export_business_backup()','public.export_business_backup_text()');
  ddl:=replace(ddl,'RETURNS jsonb','RETURNS json');
  ddl:=replace(replace(replace(ddl,'jsonb_build_object','json_build_object'),'jsonb_agg','json_agg'),'''[]''::jsonb','''[]''::json');
  execute ddl;
end $patch$;

create function public.prepare_business_backup(p_export_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); content text;
begin
  if p_export_id is null then raise exception 'invalid_backup_id'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('business-backup-prepare',0)) then raise exception 'backup_busy'; end if;
  delete from public.business_backup_exports where created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.business_backup_exports) then raise exception 'backup_busy'; end if;
  content:=json_build_object('exported_at',stamp,'tables',public.export_business_backup_text())::text;
  insert into public.business_backup_exports(id,payload,created_at) values(p_export_id,content,stamp);
  return jsonb_build_object('id',p_export_id,'characters',length(content),'bytes',octet_length(content),'exported_at',stamp);
end $$;
create function public.read_business_backup_chunk(p_export_id uuid,p_offset integer,p_length integer default 262144)
returns text language plpgsql stable security invoker set search_path='' as $$
declare part text;
begin
  if p_offset<1 or p_length not between 1 and 262144 then raise exception 'invalid_backup_chunk'; end if;
  select substring(payload from p_offset for p_length) into part from public.business_backup_exports where id=p_export_id;
  if not found then raise exception 'backup_not_found'; end if;
  return part;
end $$;
create function public.discard_business_backup(p_export_id uuid) returns void
language sql security invoker set search_path='' as $$ delete from public.business_backup_exports where id=p_export_id $$;

revoke execute on function public.export_business_backup_text(),public.prepare_business_backup(uuid),public.read_business_backup_chunk(uuid,integer,integer),public.discard_business_backup(uuid) from public,anon,authenticated;
grant execute on function public.export_business_backup_text(),public.prepare_business_backup(uuid),public.read_business_backup_chunk(uuid,integer,integer),public.discard_business_backup(uuid) to service_role;
commit;
