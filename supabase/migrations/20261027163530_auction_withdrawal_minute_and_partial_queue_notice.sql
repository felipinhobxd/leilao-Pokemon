begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

-- Keep the installed command's idempotency, financial protections and locks.
-- Fail closed if its expected withdrawal branch has drifted.
do $patch$
declare ddl text; marker text := 'if k=''BID_WITHDRAWN'' then';
begin
  select pg_get_functiondef(p.oid) into strict ddl from pg_proc p
    where p.oid='public.process_auction_command(jsonb,uuid)'::regprocedure and not p.prosecdef;
  if (length(ddl)-length(replace(ddl,marker,'')))/length(marker)<>1
    or position('withdrawal_window_expired' in ddl)>0 then
    raise exception 'withdrawal_command_definition_mismatch';
  end if;
  ddl:=replace(ddl,marker,$branch$if k='BID_WITHDRAWN' then
     -- occurredAt is the source event's clock (or server clock for panel commands).
     -- An accepted change creates a new bid and starts its own one-minute window.
     -- The existing auction deadline, stale-event and eligibility guards ran first.
     if exists(select 1 from public.bids prior_bid where prior_bid.id=old_bid
       and event_at>coalesce(prior_bid.whatsapp_event_at,prior_bid.processed_at)+interval '1 minute') then
       raise exception 'withdrawal_window_expired';
     end if;
  $branch$);
  execute ddl;
end $patch$;

-- Announce the deadline after every queue item is terminal, even when some
-- dispatches failed/cancelled. Never announce an empty/unpublished queue or
-- replay old completed queues during installation.
create or replace function public.enqueue_queue_finished_notice() returns trigger
language plpgsql security invoker set search_path='' as $$
declare jid text; published integer; failed integer; cancelled integer; games integer; dispatches integer;
begin
  if new.status<>'completed' or old.status='completed' or new.ends_at is null then return new; end if;
  if exists(select 1 from public.whatsapp_dispatches where queue_id=new.id and status not in('sent','failed','cancelled'))
    or exists(select 1 from public.whatsapp_quick_polls where queue_id=new.id and sent_at is null) then return new; end if;
  select count(*),count(*) filter(where status='sent'),count(*) filter(where status='failed'),count(*) filter(where status='cancelled')
    into dispatches,published,failed,cancelled from public.whatsapp_dispatches where queue_id=new.id;
  select count(*) into games from public.whatsapp_quick_polls where queue_id=new.id;
  if dispatches+games<>new.total_items or published+games=0 then return new; end if;
  select group_jid into jid from public.whatsapp_groups where id=new.group_id and active;
  if jid is not null then
    insert into public.whatsapp_auction_notices(kind,queue_id,group_jid,payload)
      values('queue_finished',new.id,jid,jsonb_build_object('ends_at',new.ends_at,
        'published_count',published+games,'failed_count',failed,'cancelled_count',cancelled,
        'not_published_count',failed+cancelled)) on conflict do nothing;
  end if;
  return new;
end $$;

revoke execute on function public.process_auction_command(jsonb,uuid),public.enqueue_queue_finished_notice() from public,anon,authenticated;
grant execute on function public.process_auction_command(jsonb,uuid),public.enqueue_queue_finished_notice() to service_role;
commit;
