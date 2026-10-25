begin;
alter table public.auction_publish_queues add column if not exists ends_at timestamptz;

create table public.whatsapp_auction_notices(
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in('queue_finished','auction_closed')),
  queue_id uuid references public.auction_publish_queues(id) on delete cascade,
  auction_id uuid references public.auctions(id) on delete cascade,
  group_jid text not null,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_by text,
  locked_at timestamptz
);
create unique index auction_notice_once on public.whatsapp_auction_notices(auction_id) where kind='auction_closed';
create unique index queue_notice_once on public.whatsapp_auction_notices(queue_id) where kind='queue_finished';
create index auction_notice_pending on public.whatsapp_auction_notices(next_attempt_at,created_at) where sent_at is null;
create index auction_notice_last_result on public.whatsapp_auction_notices(group_jid,sent_at desc) where kind='auction_closed' and sent_at is not null;
alter table public.whatsapp_auction_notices enable row level security;
revoke all on public.whatsapp_auction_notices from public,anon,authenticated;
grant all on public.whatsapp_auction_notices to service_role;

create function public.create_auction_queue_with_deadline(p_payload jsonb,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
<<queue_creation>>
declare
  deadline timestamptz := nullif(p_payload->'queue'->>'ends_at','')::timestamptz;
  start_time timestamptz := (p_payload->'queue'->>'starts_at')::timestamptz;
  gap integer := (p_payload->'queue'->>'interval_seconds')::integer;
  result jsonb; qid uuid;
begin
  result:=public.create_auction_publish_queue(p_payload,p_admin_user_id);
  if deadline is null or result->'queue'->>'ends_at' is not null then return result; end if;
  if deadline is not null and (deadline<=clock_timestamp() or deadline<=start_time+make_interval(secs=>(jsonb_array_length(p_payload->'items')-1)*gap)
      or deadline>start_time+interval '7 days') then raise exception 'invalid_common_deadline'; end if;
  qid:=(result->'queue'->>'id')::uuid;
  update public.auction_publish_queues set ends_at=deadline where id=qid;
  update public.auctions a set scheduled_end_at=deadline
    from public.whatsapp_dispatches d where d.auction_id=a.id and d.queue_id=qid;
  result:=jsonb_set(result,'{queue,ends_at}',to_jsonb(deadline));
  result:=jsonb_set(result,'{items}',(select jsonb_agg(case when value ? 'auction' then jsonb_set(value,'{auction,scheduled_end_at}',to_jsonb(deadline)) else value end order by ord)
    from jsonb_array_elements(result->'items') with ordinality as e(value,ord)));
  update public.processed_commands set result=queue_creation.result
    where external_event_id=p_payload->>'eventId';
  return result;
end $$;

-- Every existing writer (actual poll publication, pause/resume, item edits)
-- must preserve the absolute deadline instead of adding a duration again.
create function public.keep_common_auction_deadline() returns trigger
language plpgsql security invoker set search_path='' as $$
declare deadline timestamptz;
begin
  select q.ends_at into deadline from public.whatsapp_dispatches d
    join public.auction_publish_queues q on q.id=d.queue_id where d.auction_id=new.id limit 1;
  if deadline is not null then
    new.scheduled_end_at:=deadline;
    if new.status='open' and old.status='draft' and deadline<=clock_timestamp() then raise exception 'auction_deadline_passed'; end if;
  end if;
  return new;
end $$;
create trigger keep_common_deadline before update of scheduled_end_at,status on public.auctions
for each row execute function public.keep_common_auction_deadline();

create function public.enqueue_queue_finished_notice() returns trigger
language plpgsql security invoker set search_path='' as $$
declare jid text;
begin
  if new.status<>'completed' or old.status='completed' or new.ends_at is null then return new; end if;
  if exists(select 1 from public.whatsapp_dispatches where queue_id=new.id and status<>'sent')
     or exists(select 1 from public.whatsapp_quick_polls where queue_id=new.id and sent_at is null)
     or (select count(*) from public.whatsapp_dispatches where queue_id=new.id)+(select count(*) from public.whatsapp_quick_polls where queue_id=new.id)<>new.total_items then return new; end if;
  select group_jid into jid from public.whatsapp_groups where id=new.group_id and active;
  if jid is not null then
    insert into public.whatsapp_auction_notices(kind,queue_id,group_jid,payload)
      values('queue_finished',new.id,jid,jsonb_build_object('ends_at',new.ends_at)) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger enqueue_queue_finished after update of status on public.auction_publish_queues
for each row execute function public.enqueue_queue_finished_notice();

-- Close due auctions now; delivery timing never extends the bidding window.
create function public.finalize_due_auction_batch(p_admin_user_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare a record; r jsonb; final_row jsonb; total integer:=0;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  for a in select id,card_id,whatsapp_group_id,scheduled_end_at from public.auctions
    where status='open' and scheduled_end_at<=clock_timestamp() order by scheduled_end_at,lot_number,id limit 200 for update skip locked
  loop
    r:=public.process_auction_command(jsonb_build_object('type','AUCTION_FINALIZE','eventId','bot-finalize:'||a.id||':'||a.scheduled_end_at,'auctionId',a.id),p_admin_user_id);
    final_row:=r->'auction';
    if final_row->>'status' in('sold','closed') and a.whatsapp_group_id is not null then
      insert into public.whatsapp_auction_notices(kind,auction_id,group_jid,payload)
      values('auction_closed',a.id,a.whatsapp_group_id,final_row||jsonb_build_object(
        'card_name',(select name from public.cards where id=a.card_id),
        'winner_name',(select display_name from public.participants where id=nullif(final_row->>'winner_participant_id','')::uuid),
        'tie',(select count(*)>1 from public.bids where auction_id=a.id and status='active' and amount=(final_row->>'final_price')::numeric))) on conflict do nothing;
    end if;
    total:=total+1;
  end loop;
  return total;
end $$;

create function public.claim_auction_notice(p_worker_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n public.whatsapp_auction_notices;
begin
  if coalesce(length(p_worker_id),0) not between 1 and 200 then raise exception 'invalid_worker'; end if;
  perform pg_advisory_xact_lock(hashtextextended('auction-notice-delivery',0));
  select * into n from public.whatsapp_auction_notices p
    where p.sent_at is null and p.next_attempt_at<=clock_timestamp()
      and (p.locked_at is null or p.locked_at<clock_timestamp()-interval '2 minutes')
      and not exists(select 1 from public.whatsapp_auction_notices x where x.group_jid=p.group_jid and x.locked_at>=clock_timestamp()-interval '2 minutes' and x.sent_at is null)
      and (p.kind<>'auction_closed' or not exists(select 1 from public.whatsapp_auction_notices x where x.group_jid=p.group_jid and x.kind='auction_closed' and x.sent_at>clock_timestamp()-interval '15 seconds'))
    order by case p.kind when 'queue_finished' then 0 else 1 end,p.created_at,p.id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.whatsapp_auction_notices set locked_by=p_worker_id,locked_at=clock_timestamp(),attempts=attempts+1 where id=n.id returning * into n;
  return to_jsonb(n);
end $$;
create function public.finish_auction_notice(p_id uuid,p_worker_id text,p_success boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.whatsapp_auction_notices set sent_at=case when p_success then clock_timestamp() else null end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,30*greatest(1,attempts))),locked_at=null,locked_by=null
    where id=p_id and locked_by=p_worker_id and sent_at is null;
  if not found then raise exception 'notice_claim_lost'; end if;
end $$;

revoke execute on function public.create_auction_queue_with_deadline(jsonb,uuid),public.keep_common_auction_deadline(),public.enqueue_queue_finished_notice(),public.finalize_due_auction_batch(uuid),public.claim_auction_notice(text),public.finish_auction_notice(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.create_auction_queue_with_deadline(jsonb,uuid),public.keep_common_auction_deadline(),public.enqueue_queue_finished_notice(),public.finalize_due_auction_batch(uuid),public.claim_auction_notice(text),public.finish_auction_notice(uuid,text,boolean) to service_role;

-- New durable delivery state belongs in the business backup too.
do $patch$
declare ddl text;
begin
  ddl:=pg_get_functiondef('public.export_business_backup()'::regprocedure);
  if strpos(ddl,'whatsapp_auction_notices')=0 then
    if strpos(ddl,'select jsonb_build_object(')=0 then raise exception 'backup_definition_not_recognized'; end if;
    execute replace(ddl,'select jsonb_build_object(', 'select jsonb_build_object(''whatsapp_auction_notices'',coalesce((select jsonb_agg(n) from public.whatsapp_auction_notices n),''[]''::jsonb),');
  end if;
end $patch$;
commit;
