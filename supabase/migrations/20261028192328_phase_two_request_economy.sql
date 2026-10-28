begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

do $$ begin
  if to_regprocedure('public.bot_delivery_revision()') is null then raise exception 'install_phase_one_first'; end if;
  if public.bot_delivery_revision()<>1 then raise exception 'unexpected_delivery_revision'; end if;
end $$;

-- Same 24-hour window and source tables; one consistent snapshot/round trip.
create function public.read_dashboard_operations(p_window_start timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'worker',(select jsonb_build_object('worker_id',worker_id,'status',status,'heartbeat_at',heartbeat_at,'version',version)
      from public.whatsapp_bot_workers order by heartbeat_at desc nulls last limit 1),
    'group',(select jsonb_build_object('id',id,'name',name) from public.whatsapp_groups where active and is_default),
    'counts',(select jsonb_build_object(
      'sent',count(*) filter(where status='sent'), 'failed',count(*) filter(where status='failed'),
      'scheduled',count(*) filter(where status='scheduled'), 'sending',count(*) filter(where status='sending'),
      'cancelled',count(*) filter(where status='cancelled'))
      from public.whatsapp_dispatches where updated_at>=p_window_start)
  );
$$;
revoke execute on function public.read_dashboard_operations(timestamptz) from public,anon,authenticated;
grant execute on function public.read_dashboard_operations(timestamptz) to service_role;

-- Discover only work that the existing workers can act on NOW. An idle result
-- is never cached, so remote edits/resume/deadlines are observed next cycle.
create function public.bot_has_due_work(p_opening_minutes numeric,p_grace_minutes numeric) returns boolean
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if p_opening_minutes is null or p_grace_minutes is null or p_opening_minutes<0 or p_grace_minutes<0
    or p_opening_minutes::text in ('NaN','Infinity','-Infinity') or p_grace_minutes::text in ('NaN','Infinity','-Infinity')
    then raise exception 'invalid_opening_window'; end if;
  return exists(select 1 from public.auction_publish_queues where status in ('scheduled','running')
      and starts_at<=stamp+p_opening_minutes*interval '1 minute' and starts_at>=stamp-p_grace_minutes*interval '1 minute')
    or exists(select 1 from public.whatsapp_dispatches d where d.status='sending')
    or exists(select 1 from public.whatsapp_dispatches d where d.status='scheduled' and d.scheduled_at<=stamp and d.attempts<5
      and (d.queue_id is null or exists(select 1 from public.auction_publish_queues q where q.id=d.queue_id and q.status in ('scheduled','running'))))
    or exists(select 1 from public.auctions where status='open' and scheduled_end_at<=stamp)
    or exists(select 1 from public.whatsapp_quick_polls p where p.sent_at is null and p.scheduled_at<=stamp
      and not exists(select 1 from public.auction_publish_queues q where q.id=p.queue_id and q.status='paused'));
end $$;
revoke execute on function public.bot_has_due_work(numeric,numeric) from public,anon,authenticated;
grant execute on function public.bot_has_due_work(numeric,numeric) to service_role;
-- Guard the new child against starting with either migration missing.
create or replace function public.bot_delivery_revision() returns integer language sql security invoker set search_path='' as $$ select 2 $$;
revoke execute on function public.bot_delivery_revision() from public,anon,authenticated;
grant execute on function public.bot_delivery_revision() to service_role;
notify pgrst,'reload schema';
commit;
