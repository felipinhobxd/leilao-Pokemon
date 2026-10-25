begin;
-- Store chunks separately: reading substring of one compressed TOAST value
-- would repeatedly decompress the whole ~50MB snapshot for each API call.
create table public.business_backup_export_chunks(
  export_id uuid not null references public.business_backup_exports(id) on delete cascade,
  position integer not null,
  content text not null,
  primary key(export_id,position)
);
alter table public.business_backup_export_chunks enable row level security;
revoke all on public.business_backup_export_chunks from public,anon,authenticated;
grant all on public.business_backup_export_chunks to service_role;
create or replace function public.prepare_business_backup(p_export_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='55s' set work_mem='32MB' as $$
declare stamp timestamptz:=clock_timestamp(); content text; characters integer;
begin
  if p_export_id is null then raise exception 'invalid_backup_id'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('business-backup-prepare',0)) then raise exception 'backup_busy'; end if;
  delete from public.business_backup_exports where created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.business_backup_exports) then raise exception 'backup_busy'; end if;
  content:=json_build_object('exported_at',stamp,'tables',public.export_business_backup_text())::text;
  characters:=length(content);
  insert into public.business_backup_exports(id,payload,created_at) values(p_export_id,'',stamp);
  insert into public.business_backup_export_chunks(export_id,position,content)
    select p_export_id,offset_value/262144,substring(content from offset_value+1 for 262144)
    from generate_series(0,characters-1,262144) offset_value;
  return jsonb_build_object('id',p_export_id,'characters',characters,'bytes',octet_length(content),'exported_at',stamp);
end $$;
create or replace function public.read_business_backup_chunk(p_export_id uuid,p_offset integer,p_length integer default 262144)
returns text language plpgsql stable security invoker set search_path='' set statement_timeout='15s' as $$
declare part text;
begin
  if p_offset<1 or p_length not between 1 and 262144 then raise exception 'invalid_backup_chunk'; end if;
  if not exists(select 1 from public.business_backup_exports where id=p_export_id) then raise exception 'backup_not_found'; end if;
  select string_agg(content,'' order by position) into part from public.business_backup_export_chunks
    where export_id=p_export_id and position between (p_offset-1)/262144 and (p_offset+p_length-2)/262144;
  return substring(coalesce(part,'') from ((p_offset-1)%262144)+1 for p_length);
end $$;

-- Existing uncompressed copies still satisfy the guard. New compressed
-- automatic copies must also count, without weakening the daily requirement.
do $patch$
declare ddl text; needle text := 'name like ''backups/backup-'' || to_char(clock_timestamp(),''YYYYMMDD'') || ''-%.json''';
begin
  ddl:=pg_get_functiondef('public.cleanup_old_auctions(integer,integer)'::regprocedure);
  if strpos(ddl,needle)=0 then raise exception 'backup_guard_not_recognized'; end if;
  execute replace(ddl,needle,'('||needle||' or name like ''backups/backup-'' || to_char(clock_timestamp(),''YYYYMMDD'') || ''-%.json.gz'')');
end $patch$;
notify pgrst,'reload schema';
commit;
