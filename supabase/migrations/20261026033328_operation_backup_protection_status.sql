-- Cheap read-only metadata for the existing, explicit diagnostic refresh.
begin;
create function public.get_operation_backup_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 with latest as (
  select created_at,confirmed_at from public.business_backup_receipts order by created_at desc limit 1
 ), confirmed as (
  select r.created_at,r.confirmed_at,r.object_name,
   exists(select 1 from storage.objects o where o.id=r.object_id and o.bucket_id='business-backups'
    and o.name=r.object_name and o.version=r.object_version and o.updated_at=r.object_updated_at) as object_valid
  from public.business_backup_receipts r where r.confirmed_at is not null order by r.created_at desc limit 1
 ), valid as (
  select r.created_at,r.confirmed_at from public.business_backup_receipts r join storage.objects o
   on o.id=r.object_id and o.bucket_id='business-backups' and o.name=r.object_name
    and o.version=r.object_version and o.updated_at=r.object_updated_at
  where r.confirmed_at is not null and r.created_at>now()-interval '48 hours'
  order by r.created_at desc limit 1
 ) select jsonb_build_object(
  'state',case when exists(select 1 from valid) then 'confirmed'
   when exists(select 1 from confirmed where not object_valid) then 'object_unavailable'
   when exists(select 1 from confirmed where created_at<=now()-interval '48 hours') then 'expired'
   when exists(select 1 from latest) then 'awaiting_confirmation' else 'missing' end,
  'latestSnapshotAt',(select created_at from latest),
  'latestConfirmedAt',(select confirmed_at from confirmed),
  'validSnapshotAt',(select created_at from valid),
  'validConfirmedAt',(select confirmed_at from valid),
  'validUntil',(select created_at+interval '48 hours' from valid)
 );
$$;
revoke all on function public.get_operation_backup_status() from public,anon,authenticated;
grant execute on function public.get_operation_backup_status() to service_role;
notify pgrst,'reload schema';
commit;
