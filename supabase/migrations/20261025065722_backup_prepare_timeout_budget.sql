-- PostgREST reads the called RPC's budget; the timeout on the nested export
-- does not exempt prepare_business_backup from the role's short API limit.
begin;
alter function public.prepare_business_backup(uuid) set statement_timeout='55s';
alter function public.prepare_business_backup(uuid) set work_mem='32MB';
alter function public.read_business_backup_chunk(uuid,integer,integer) set statement_timeout='15s';
commit;
