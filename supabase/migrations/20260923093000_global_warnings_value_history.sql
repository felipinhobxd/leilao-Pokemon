-- 2026-09-23 round: (1) detailed value-change history, (2) GLOBAL per-user
-- warning counter (one per real DECREASE, idempotent by event id), (3) admin
-- notification at exactly 3 warnings (idempotent, delivered by the bot via
-- WhatsApp DM), (4) 30-day automatic cleanup routine (dashboard window was 7d;
-- there was no deletion routine at all).
--
-- All changes are create-or-replace / additive — safe on a live database.
-- Apply once in the Supabase SQL Editor (same workflow as the other files).
begin;

-- ---------------------------------------------------------------------------
-- 1) Tables: value-change history + GLOBAL warnings + admin notifications.
--
-- Idempotency comes from the UNIQUE external_event_id on all three tables:
-- process_auction_command already returns the CACHED result for a repeated
-- eventId (processed_commands), and the ON CONFLICT DO NOTHING inserts are a
-- second belt: a retried/replayed BID_CHANGED can never log the change, the
-- warning or the notification twice.
-- ----------------------------------------------------------------------------
create table if not exists public.value_change_log (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  previous_amount numeric(12,2) not null,
  new_amount numeric(12,2) not null,
  difference numeric(12,2) not null,
  external_event_id text not null unique,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists value_change_participant_idx on public.value_change_log(participant_id);
create index if not exists value_change_auction_idx on public.value_change_log(auction_id);

create table if not exists public.participant_warnings (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  -- The GLOBAL counter must SURVIVE the 30-day auction cleanup: the FK is
  -- SET NULL and the human-readable context (card/lot) is DENORMALIZED here,
  -- so the history stays queryable after the auction rows are gone.
  auction_id uuid references public.auctions(id) on delete set null,
  card_name text,
  lot_number integer,
  previous_amount numeric(12,2) not null,
  new_amount numeric(12,2) not null,
  external_event_id text not null unique,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists participant_warnings_participant_idx on public.participant_warnings(participant_id);

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.participants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  external_event_id text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz
);
create index if not exists admin_notifications_pending_idx on public.admin_notifications(created_at) where sent_at is null;

alter table public.value_change_log enable row level security;
revoke all on public.value_change_log from public,anon,authenticated;
grant select on public.value_change_log to authenticated;
grant all on public.value_change_log to service_role;
drop policy if exists staff_read on public.value_change_log;
create policy staff_read on public.value_change_log
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

alter table public.participant_warnings enable row level security;
revoke all on public.participant_warnings from public,anon,authenticated;
grant select on public.participant_warnings to authenticated;
grant all on public.participant_warnings to service_role;
drop policy if exists staff_read on public.participant_warnings;
create policy staff_read on public.participant_warnings
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public,anon,authenticated;
grant select on public.admin_notifications to authenticated;
grant all on public.admin_notifications to service_role;
drop policy if exists staff_read on public.admin_notifications;
create policy staff_read on public.admin_notifications
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

-- ---------------------------------------------------------------------------
-- 2) process_auction_command: BID_CHANGED now records the value-change
--    history, and a DECREASE (new < previous) registers ONE global warning.
--    Body copied verbatim from 20260921130000 with ONLY the marked additions;
--    the processed_commands early-return keeps every hook idempotent.
--    ADDITION A: declare old_amount
--    ADDITION B: fetch previous amount + history/warning/notification hooks
-- ----------------------------------------------------------------------------
create or replace function public.process_auction_command(p_command jsonb,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 k text:=p_command->>'type'; eid text:=p_command->>'eventId';
 d jsonb:=coalesce(p_command->'data','{}'::jsonb);
 aid uuid:=nullif(p_command->>'auctionId','')::uuid;
 pid uuid:=nullif(p_command->>'participantId','')::uuid;
 rid uuid:=nullif(p_command->>'id','')::uuid;
 a public.auctions; c public.cards; p public.participants; b public.bids;
 prior public.processed_commands; result jsonb; request jsonb;
 amount numeric; purchase_id uuid; old_bid uuid; stamp timestamptz;
 event_at timestamptz; last_at timestamptz;
 old_amount numeric; -- ADDITION A: previous bid amount of the SAME participant
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in ('admin','operator')) then raise exception 'forbidden'; end if;
 perform set_config('app.admin_user_id',p_admin_user_id::text,true);
 if eid is null or length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
 request:=p_command||jsonb_build_object('actor',p_admin_user_id);
 perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into prior from public.processed_commands where external_event_id=eid;
 if found then
  if prior.request<>request then raise exception 'event_id_conflict'; end if;
  return prior.result;
 end if;
 if k in ('CARD_CREATE','CARD_UPDATE','CARD_DELETE') then
  if k<>'CARD_CREATE' then
   select * into c from public.cards where id=rid for update;
   if not found then raise exception 'card_not_found'; end if;
   if c.status not in ('available','archived') or exists(select 1 from public.auctions where card_id=rid and status in ('open','review_required')) then raise exception 'card_in_use'; end if;
  end if;
  if k='CARD_DELETE' then update public.cards set status='archived',updated_at=clock_timestamp() where id=rid returning * into c;
  else
   if length(trim(coalesce(d->>'name','')))=0 then raise exception 'invalid_name'; end if;
   if k='CARD_CREATE' then
    insert into public.cards(name,collection,card_number,image_url,starting_price,buyout_price,notes)
     values(d->>'name',d->>'collection',d->>'card_number',d->>'image_url',(d->>'starting_price')::numeric,(d->>'buyout_price')::numeric,d->>'notes') returning * into c;
   else
    update public.cards set name=d->>'name',collection=d->>'collection',card_number=d->>'card_number',image_url=d->>'image_url',starting_price=(d->>'starting_price')::numeric,buyout_price=(d->>'buyout_price')::numeric,notes=d->>'notes',updated_at=clock_timestamp() where id=rid returning * into c;
   end if;
  end if;
  result:=to_jsonb(c);
 elsif k in ('PARTICIPANT_CREATE','PARTICIPANT_UPDATE','PARTICIPANT_DELETE') then
  if k<>'PARTICIPANT_CREATE' then
   select * into p from public.participants where id=rid for update;
   if not found then raise exception 'participant_not_found'; end if;
  end if;
  if k='PARTICIPANT_DELETE' then update public.participants set status='banned',updated_at=clock_timestamp() where id=rid returning * into p;
  else
   if length(trim(coalesce(d->>'display_name','')))=0 or length(trim(coalesce(d->>'whatsapp_id','')))=0 then raise exception 'invalid_participant'; end if;
   if k='PARTICIPANT_CREATE' then
    insert into public.participants(display_name,whatsapp_id,phone_e164,status,notes)
     values(d->>'display_name',d->>'whatsapp_id',d->>'phone_e164',coalesce(d->>'status','active')::public.participant_status,d->>'notes') returning * into p;
   else
    update public.participants set display_name=d->>'display_name',whatsapp_id=d->>'whatsapp_id',phone_e164=d->>'phone_e164',status=(d->>'status')::public.participant_status,notes=d->>'notes',updated_at=clock_timestamp() where id=rid returning * into p;
   end if;
  end if;
  result:=to_jsonb(p);
 elsif k='AUCTION_CREATE' then
  select * into c from public.cards where id=(d->>'card_id')::uuid for update;
  if not found or c.status<>'available' then raise exception 'card_unavailable'; end if;
  insert into public.auctions(card_id,starting_price,buyout_price,scheduled_end_at,created_by)
   values(c.id,c.starting_price,c.buyout_price,(d->>'scheduled_end_at')::timestamptz,p_admin_user_id) returning * into a;
  result:=to_jsonb(a);
 else
  select * into a from public.auctions where id=aid for update;
  if not found then raise exception 'auction_not_found'; end if;
  stamp:=clock_timestamp();
  if k in ('AUCTION_UPDATE','AUCTION_DELETE','AUCTION_OPEN') then
   if a.status<>'draft' then raise exception 'auction_not_draft'; end if;
   if k='AUCTION_UPDATE' then
    update public.auctions set starting_price=(d->>'starting_price')::numeric,buyout_price=(d->>'buyout_price')::numeric,scheduled_end_at=(d->>'scheduled_end_at')::timestamptz,updated_at=stamp where id=aid returning * into a;
   elsif k='AUCTION_DELETE' then update public.auctions set status='cancelled',cancellation_reason='Removed by staff',updated_at=stamp where id=aid returning * into a;
   else
    select * into c from public.cards where id=a.card_id for update;
    if c.status<>'available' then raise exception 'card_unavailable'; end if;
    if a.scheduled_end_at is not null and a.scheduled_end_at<=stamp then raise exception 'deadline_expired'; end if;
    update public.auctions set status='open',started_at=stamp,updated_at=stamp where id=aid returning * into a;
    update public.cards set status='in_auction',updated_at=stamp where id=c.id;
   end if;
   result:=to_jsonb(a);
  else
   if a.status<>'open' then raise exception 'auction_not_open'; end if;
   if k='AUCTION_FINALIZE' then
    perform 1 from public.participants where id in(select participant_id from public.bids where auction_id=aid and status='active') order by id for share;
    select bids.* into b from public.bids bids join public.participants pp on pp.id=bids.participant_id
     where bids.auction_id=aid and bids.status='active' and pp.status='active' and (pp.suspension_until is null or pp.suspension_until<=stamp)
     order by bids.amount desc,coalesce(bids.whatsapp_event_at,bids.processed_at),bids.processed_at,bids.confirmation_order limit 1;
    if not found then
     update public.auctions set status='closed',ended_at=stamp,updated_at=stamp where id=aid returning * into a;
     update public.cards set status='available',updated_at=stamp where id=a.card_id;
    else
     pid:=b.participant_id; amount:=b.amount;
    end if;
   elsif k in ('BID_PLACED','BID_CHANGED','BID_WITHDRAWN','BUYOUT_REQUESTED','BUYOUT_CONFIRMED') then
    if a.scheduled_end_at is not null and a.scheduled_end_at<=stamp then raise exception 'deadline_expired'; end if;
    select * into p from public.participants where id=pid for share;
    if not found then raise exception 'participant_not_found'; end if;
    if p.status<>'active' or (p.suspension_until is not null and p.suspension_until>stamp) then raise exception 'participant_not_eligible'; end if;
    event_at:=coalesce((p_command->>'occurredAt')::timestamptz,stamp);
    if event_at>stamp+interval '5 minutes' then raise exception 'invalid_event_time'; end if;
    select max((payload->>'event_at')::timestamptz) into last_at from public.auction_events where auction_id=aid and participant_id=pid and event_type in ('BID_PLACED','BID_CHANGED','BID_WITHDRAWN','BUYOUT_REQUESTED','BUYOUT_CONFIRMED');
    if event_at<a.started_at or (last_at is not null and event_at<last_at) then raise exception 'stale_event'; end if;
    select id into old_bid from public.bids where auction_id=aid and participant_id=pid and status='active';
    if k in ('BID_CHANGED','BID_WITHDRAWN') and old_bid is null then raise exception 'active_bid_not_found'; end if;
    if k='BID_PLACED' and old_bid is not null then raise exception 'active_bid_exists'; end if;
    if k='BID_WITHDRAWN' then
     update public.bids set status='withdrawn' where id=old_bid;
    elsif k in ('BUYOUT_REQUESTED','BUYOUT_CONFIRMED') then
     if a.buyout_price is null then raise exception 'buyout_not_enabled'; end if;
     if k='BUYOUT_CONFIRMED' then amount:=a.buyout_price; end if;
    end if;
    if k in ('BID_PLACED','BID_CHANGED','BUYOUT_CONFIRMED') then
     if k<>'BUYOUT_CONFIRMED' then amount:=(p_command->>'amount')::numeric; end if;
     if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<a.starting_price or amount<>round(amount,2) then raise exception 'invalid_bid_amount'; end if;
     if k='BID_CHANGED' and old_bid is not null then
      -- ADDITION B.1 — aliased on purpose: a bare `amount` here is ambiguous
      -- between bids.amount (column) and the plpgsql variable `amount`
      -- (SQLSTATE 42702 at runtime, raised BEFORE the enforce_bid_increment
      -- trigger could answer with bid_increment_required — CI failure
      -- tests/auction.sql "below_increment", fixed 2026-09-23).
      select prev.amount into old_amount from public.bids prev where prev.id=old_bid;
     end if;
     update public.bids set status='replaced' where id=old_bid;
     insert into public.bids(auction_id,participant_id,amount,kind,whatsapp_event_id,whatsapp_event_at,processed_at)
     values(aid,pid,amount,case when k='BUYOUT_CONFIRMED' then 'buyout'::public.bid_kind else 'bid'::public.bid_kind end,eid,event_at,stamp) returning * into b;
     update public.bids set replaced_by=b.id where id=old_bid;
     -- ADDITION B.2: value-change history + GLOBAL warning on DECREASE only.
     -- Increases and equal values never warn (equal labels are filtered by the
     -- bot; different labels cannot share an amount in this poll design).
     -- Every insert is idempotent on the event id (processed_commands already
     -- returns early for repeats; ON CONFLICT is the second belt).
     if k='BID_CHANGED' and old_amount is not null then
      insert into public.value_change_log(auction_id,participant_id,previous_amount,new_amount,difference,external_event_id,occurred_at)
      values(aid,pid,old_amount,amount,amount-old_amount,eid,event_at)
      on conflict (external_event_id) do nothing;
      if amount<old_amount then
       insert into public.participant_warnings(participant_id,auction_id,card_name,lot_number,previous_amount,new_amount,external_event_id,occurred_at)
       select pid,aid,cards.name,a.lot_number,old_amount,amount,eid,event_at
       from public.cards where id=a.card_id
       on conflict (external_event_id) do nothing;
       -- Exactly 3 GLOBAL warnings -> ONE admin notification (idempotent).
       if (select count(*) from public.participant_warnings where participant_id=pid)=3 then
        insert into public.admin_notifications(participant_id,kind,external_event_id,payload)
        select pid,'WARNING_THRESHOLD',eid,jsonb_build_object(
          'participant_name',p.display_name,
          'total_warnings',3,
          'card_name',cards.name,'lot_number',a.lot_number,
          'previous_amount',old_amount,'new_amount',amount,'event_at',event_at,
          'warnings',(select jsonb_agg(jsonb_build_object(
             'card_name',w.card_name,'lot_number',w.lot_number,
             'previous_amount',w.previous_amount,'new_amount',w.new_amount,
             'occurred_at',w.occurred_at) order by w.created_at)
           from public.participant_warnings w where w.participant_id=pid))
        from public.cards where id=a.card_id
        on conflict (external_event_id) do nothing;
       end if;
      end if;
     end if;
    end if;
   else raise exception 'unknown_command'; end if;
   if (k='AUCTION_FINALIZE' and b.id is not null) or k='BUYOUT_CONFIRMED' then
    update public.auctions set status='sold',winner_participant_id=pid,final_price=amount,win_type=case when k='BUYOUT_CONFIRMED' then 'buyout' else 'highest_bid' end,ended_at=stamp,updated_at=stamp where id=aid returning * into a;
    update public.cards set status='sold',updated_at=stamp where id=a.card_id;
    insert into public.purchases(auction_id,participant_id,card_id,amount) values(aid,pid,a.card_id,amount) returning id into purchase_id;
    insert into public.deliveries(purchase_id) values(purchase_id);
   end if;
   result:=jsonb_build_object('auction',to_jsonb(a),'bid',case when b.id is not null then to_jsonb(b) else null end,'purchase_id',purchase_id);
  end if;
 end if;
 insert into public.auction_events(auction_id,participant_id,admin_user_id,event_type,external_event_id,payload)
 values(coalesce(aid,a.id),pid,p_admin_user_id,k,eid,jsonb_build_object('result',result,'event_at',event_at));
 insert into public.processed_commands(external_event_id,request,result) values(eid,request,result);
 return result;
end $$;
revoke execute on function public.process_auction_command(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.process_auction_command(jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) read_auction_snapshot: expose the new tables to /api/export.
-- ----------------------------------------------------------------------------
create or replace function public.read_auction_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $body$
 select jsonb_build_object(
  'cards',coalesce((select jsonb_agg(t order by id) from public.cards t),'[]'::jsonb),
  'participants',coalesce((select jsonb_agg(t order by id) from public.participants t),'[]'::jsonb),
  'auctions',coalesce((select jsonb_agg(t order by id) from public.auctions t),'[]'::jsonb),
  'bids',coalesce((select jsonb_agg(t order by id) from public.bids t),'[]'::jsonb),
  'auction_events',coalesce((select jsonb_agg(t order by id) from public.auction_events t),'[]'::jsonb),
  'purchases',coalesce((select jsonb_agg(t order by id) from public.purchases t),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(t order by id) from public.payments t),'[]'::jsonb),
  'deliveries',coalesce((select jsonb_agg(t order by id) from public.deliveries t),'[]'::jsonb),
  'warnings',coalesce((select jsonb_agg(t order by id) from public.warnings t),'[]'::jsonb),
  'value_change_log',coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from public.value_change_log t),'[]'::jsonb),
  'participant_warnings',coalesce((select jsonb_agg(t order by created_at desc,id desc) from public.participant_warnings t),'[]'::jsonb),
  'admin_notifications',coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,participant_id,kind,payload,external_event_id,created_at,sent_at from public.admin_notifications order by created_at desc,id desc limit 200) t),'[]'::jsonb)
 );
$body$;
revoke execute on function public.read_auction_snapshot() from public,anon,authenticated;
grant execute on function public.read_auction_snapshot() to service_role;

-- ---------------------------------------------------------------------------
-- 4) 30-day automatic cleanup. There was NO deletion routine before (the 7d
--    the operator saw was the dashboard dispatch WINDOW). Terminal auctions
--    (closed/sold/cancelled) older than p_days (default 30) are removed
--    FK-safely with their children; open/review auctions and EVERYTHING
--    younger than the cutoff is never touched. Global warnings SURVIVE
--    (auction_id is set null; the denormalized card/lot context stays).
--    Called hourly by the bot supervisor (service.mjs).
--    SECURITY DEFINER: auction_events is append-only (immutable_audit
--    trigger); the guard is lifted and restored inside the transaction, the
--    same pattern as purge_all_business_data.
-- ----------------------------------------------------------------------------
create or replace function public.cleanup_old_auctions(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 cutoff timestamptz:=clock_timestamp()-make_interval(days=>greatest(coalesce(p_days,30),1));
 n_payments bigint:=0; n_deliveries bigint:=0; n_purchases bigint:=0; n_warnings bigint:=0;
 n_votes bigint:=0; n_dispatches bigint:=0; n_queues bigint:=0; n_events bigint:=0;
 n_bids bigint:=0; n_changes bigint:=0; n_auctions bigint:=0; n_cards bigint:=0;
 n_tmp bigint:=0;
begin
 execute 'drop trigger if exists immutable_audit on public.auction_events';

 with gone as (
   delete from public.payments pu using public.purchases z join public.auctions a on a.id=z.auction_id
   where pu.purchase_id=z.id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_payments from gone;
 with gone as (
   delete from public.deliveries dl using public.purchases z join public.auctions a on a.id=z.auction_id
   where dl.purchase_id=z.id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_deliveries from gone;
 with gone as (
   delete from public.purchases z using public.auctions a
   where a.id=z.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_purchases from gone;
 with gone as (
   delete from public.warnings w using public.auctions a
   where a.id=w.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_warnings from gone;
 with gone as (
   delete from public.whatsapp_vote_state v using public.auctions a
   where a.id=v.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_votes from gone;
 with gone as (
   delete from public.whatsapp_dispatches dd using public.auctions a
   where a.id=dd.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_dispatches from gone;
 -- Finished queues older than the cutoff go too (dispatches first: the FK
 -- is ON DELETE RESTRICT). Active/scheduled queues are never touched.
 with gone as (
   delete from public.whatsapp_dispatches dd using public.auction_publish_queues q
   where q.id=dd.queue_id and q.created_at<cutoff
     and q.status in ('completed','cancelled') returning 1)
 select coalesce((select count(*) from gone),0) into n_tmp;
 n_dispatches:=n_dispatches+n_tmp;
 with gone as (
   delete from public.auction_publish_queues q
   where q.created_at<cutoff and q.status in ('completed','cancelled') returning 1)
 select count(*) into n_queues from gone;
 with gone as (
   delete from public.auction_events e using public.auctions a
   where a.id=e.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_events from gone;
 with gone as (
   delete from public.bids b2 using public.auctions a
   where a.id=b2.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_bids from gone;
 with gone as (
   delete from public.value_change_log vc using public.auctions a
   where a.id=vc.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_changes from gone;
 with gone as (
   delete from public.auctions a
   where coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
     and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_auctions from gone;
 -- Cards that lost their last auction in this sweep (they were created for
 -- the deleted lots). participant_warnings survives: its auction_id becomes
 -- NULL and the denormalized card/lot text keeps the history readable.
 with gone as (
   delete from public.cards c
   where not exists(select 1 from public.auctions a where a.card_id=c.id) returning 1)
 select count(*) into n_cards from gone;

 execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';

 return jsonb_build_object(
   'cutoff',cutoff,
   'deleted',jsonb_build_object(
     'payments',n_payments,'deliveries',n_deliveries,'purchases',n_purchases,
     'warnings',n_warnings,'vote_state',n_votes,'dispatches',n_dispatches,
     'queues',n_queues,'events',n_events,'bids',n_bids,'value_changes',n_changes,
     'auctions',n_auctions,'cards',n_cards));
end $$;
revoke execute on function public.cleanup_old_auctions(integer) from public,anon,authenticated;
grant execute on function public.cleanup_old_auctions(integer) to service_role;

commit;

