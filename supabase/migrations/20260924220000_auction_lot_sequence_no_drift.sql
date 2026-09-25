-- 2026-09-25: prevent auction lot-number sequence drift.
--
-- Explicit lot numbers from the wizard/queue advance the shared sequence.
-- The normal AUCTION_CREATE path takes the same transaction advisory lock,
-- preventing an explicit lot from racing with nextval() and leaving the
-- sequence behind the real maximum lot.
begin;

create or replace function public.create_auction_wizard(p_payload jsonb,p_admin_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare eid text:=trim(coalesce(p_payload->>'eventId','')); cd jsonb:=coalesce(p_payload->'card','{}'::jsonb); ad jsonb:=coalesce(p_payload->'auction','{}'::jsonb); req jsonb; prior public.processed_commands; c public.cards; a public.auctions; d public.whatsapp_dispatches; g public.whatsapp_groups; result jsonb; lot bigint; start_price numeric; increment_value numeric; buyout numeric; schedule_at timestamptz; end_at timestamptz; group_id uuid; options jsonb;
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
 if length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
 req:=p_payload||jsonb_build_object('actor',p_admin_user_id,'type','AUCTION_WIZARD_CREATE'); perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into prior from public.processed_commands where external_event_id=eid; if found then if prior.request<>req then raise exception 'event_id_conflict'; end if; return prior.result; end if;
 perform set_config('app.admin_user_id',p_admin_user_id::text,true);
 start_price:=(ad->>'starting_price')::numeric; increment_value:=(ad->>'bid_increment')::numeric; buyout:=nullif(ad->>'buyout_price','')::numeric; schedule_at:=(ad->>'scheduled_at')::timestamptz; end_at:=nullif(ad->>'scheduled_end_at','')::timestamptz; group_id:=(ad->>'group_id')::uuid; options:=ad->'poll_options'; lot:=nullif(ad->>'lot_number','')::bigint;
 if start_price<0 or increment_value<=0 or buyout is not null and buyout<start_price then raise exception 'invalid_auction_values'; end if;
 if end_at is not null and end_at<=schedule_at then raise exception 'invalid_end_time'; end if;
 if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;
 select * into g from public.whatsapp_groups where id=group_id and active for share; if not found then raise exception 'whatsapp_group_unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('auction_lot_number_seq',0));
 if lot is not null then
  if lot<=0 or exists(select 1 from public.auctions where lot_number=lot) then raise exception 'lot_number_in_use'; end if;
  perform setval('public.auction_lot_number_seq',greatest((select last_value from public.auction_lot_number_seq),lot),true);
 else
  loop lot:=nextval('public.auction_lot_number_seq'); exit when not exists(select 1 from public.auctions where lot_number=lot); end loop;
 end if;
 insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price) values(trim(cd->>'name'),nullif(trim(coalesce(cd->>'collection','')),''),nullif(trim(coalesce(cd->>'card_number','')),''),nullif(trim(coalesce(cd->>'variant','')),''),coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),nullif(trim(coalesce(cd->>'condition','')),''),nullif(trim(coalesce(cd->>'image_url','')),''),start_price,buyout) returning * into c;
 insert into public.auctions(card_id,lot_number,starting_price,bid_increment,buyout_price,scheduled_end_at,created_by) values(c.id,lot,start_price,increment_value,buyout,end_at,p_admin_user_id) returning * into a;
 insert into public.whatsapp_dispatches(auction_id,group_id,scheduled_at,poll_title,poll_options,status,created_by) values(a.id,g.id,schedule_at,lot::text||'. Lances',options,'scheduled',p_admin_user_id) returning * into d;
 insert into public.auction_events(auction_id,admin_user_id,event_type,external_event_id,payload) values(a.id,p_admin_user_id,'AUCTION_WIZARD_CREATED',eid,jsonb_build_object('card_id',c.id,'dispatch_id',d.id,'lot_number',lot,'group_id',g.id));
 result:=jsonb_build_object('card',to_jsonb(c),'auction',to_jsonb(a),'dispatch',to_jsonb(d)); insert into public.processed_commands(external_event_id,request,result) values(eid,req,result); return result;
end $$;
revoke execute on function public.create_auction_wizard(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_auction_wizard(jsonb,uuid) to service_role;

create table if not exists public.auction_publish_queues (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'scheduled' check (status in ('scheduled','running','paused','completed','cancelled')),
  group_id uuid not null references public.whatsapp_groups(id) on delete restrict,
  interval_seconds integer not null check (interval_seconds between 1 and 86400),
  starts_at timestamptz not null,
  total_items integer not null check (total_items between 1 and 100),
  paused_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.whatsapp_dispatches
  add column if not exists queue_id uuid references public.auction_publish_queues(id) on delete restrict,
  add column if not exists queue_position integer,
  add column if not exists duration_seconds integer;

create unique index if not exists whatsapp_dispatch_queue_position_key
  on public.whatsapp_dispatches(queue_id,queue_position)
  where queue_id is not null;
create index if not exists whatsapp_dispatch_queue_status_idx
  on public.whatsapp_dispatches(queue_id,status,queue_position)
  where queue_id is not null;
create index if not exists auction_publish_queues_status_idx
  on public.auction_publish_queues(status,starts_at);

alter table public.auction_publish_queues enable row level security;
revoke all on public.auction_publish_queues from public,anon,authenticated;
grant select on public.auction_publish_queues to authenticated;
grant all on public.auction_publish_queues to service_role;

drop policy if exists staff_read on public.auction_publish_queues;
create policy staff_read on public.auction_publish_queues
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

create or replace function public.create_auction_publish_queue(p_payload jsonb,p_admin_user_id uuid)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  eid text:=trim(coalesce(p_payload->>'eventId',''));
  qd jsonb:=coalesce(p_payload->'queue','{}'::jsonb);
  items jsonb:=coalesce(p_payload->'items','[]'::jsonb);
  req jsonb;
  prior public.processed_commands;
  q public.auction_publish_queues;
  g public.whatsapp_groups;
  item jsonb;
  cd jsonb;
  ad jsonb;
  c public.cards;
  a public.auctions;
  d public.whatsapp_dispatches;
  result jsonb;
  result_items jsonb:='[]'::jsonb;
  group_id uuid;
  queue_start timestamptz;
  schedule_at timestamptz;
  end_at timestamptz;
  interval_value integer;
  duration_value integer;
  lot bigint;
  start_price numeric;
  increment_value numeric;
  buyout numeric;
  options jsonb;
  position_value integer:=0;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  if length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items)<1 or jsonb_array_length(items)>100 then raise exception 'invalid_queue_items'; end if;

  req:=p_payload||jsonb_build_object('actor',p_admin_user_id,'type','AUCTION_QUEUE_CREATE');
  perform pg_advisory_xact_lock(hashtextextended(eid,0));
  select * into prior from public.processed_commands where external_event_id=eid;
  if found then
    if prior.request<>req then raise exception 'event_id_conflict'; end if;
    return prior.result;
  end if;

  group_id:=(qd->>'group_id')::uuid;
  queue_start:=(qd->>'starts_at')::timestamptz;
  interval_value:=(qd->>'interval_seconds')::integer;
  if interval_value<1 or interval_value>86400 then raise exception 'invalid_queue_interval'; end if;
  select * into g from public.whatsapp_groups where id=group_id and active for share;
  if not found then raise exception 'whatsapp_group_unavailable'; end if;

  perform set_config('app.admin_user_id',p_admin_user_id::text,true);
  insert into public.auction_publish_queues(group_id,interval_seconds,starts_at,total_items,created_by)
  values(group_id,interval_value,queue_start,jsonb_array_length(items),p_admin_user_id)
  returning * into q;

  for item in select value from jsonb_array_elements(items) loop
    position_value:=position_value+1;
    cd:=coalesce(item->'card','{}'::jsonb);
    ad:=coalesce(item->'auction','{}'::jsonb);
    if length(trim(coalesce(cd->>'name','')))<1 then raise exception 'invalid_card_name'; end if;

    start_price:=(ad->>'starting_price')::numeric;
    increment_value:=(ad->>'bid_increment')::numeric;
    buyout:=nullif(ad->>'buyout_price','')::numeric;
    duration_value:=(ad->>'duration_seconds')::integer;
    options:=ad->'poll_options';
    lot:=nullif(ad->>'lot_number','')::bigint;

    if start_price<0 or increment_value<=0 or buyout is not null and buyout<=start_price then raise exception 'invalid_auction_values'; end if;
    if duration_value<1 or duration_value>604800 then raise exception 'invalid_auction_duration'; end if;
    if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;

    perform pg_advisory_xact_lock(hashtextextended('auction_lot_number_seq',0));
    if lot is not null then
      if lot<=0 or exists(select 1 from public.auctions where lot_number=lot) then raise exception 'lot_number_in_use'; end if;
      perform setval('public.auction_lot_number_seq',greatest((select last_value from public.auction_lot_number_seq),lot),true);
    else
      loop
        lot:=nextval('public.auction_lot_number_seq');
        exit when not exists(select 1 from public.auctions where lot_number=lot);
      end loop;
    end if;

    schedule_at:=queue_start+make_interval(secs=>((position_value-1)*interval_value)::double precision);
    end_at:=schedule_at+make_interval(secs=>duration_value::double precision);

    insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price)
    values(
      trim(cd->>'name'),
      nullif(trim(coalesce(cd->>'collection','')),''),
      nullif(trim(coalesce(cd->>'card_number','')),''),
      nullif(trim(coalesce(cd->>'variant','')),''),
      coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),
      nullif(trim(coalesce(cd->>'condition','')),''),
      nullif(trim(coalesce(cd->>'image_url','')),''),
      start_price,buyout
    ) returning * into c;

    insert into public.auctions(card_id,lot_number,starting_price,bid_increment,buyout_price,scheduled_end_at,created_by)
    values(c.id,lot,start_price,increment_value,buyout,end_at,p_admin_user_id)
    returning * into a;

    insert into public.whatsapp_dispatches(
      auction_id,group_id,scheduled_at,poll_title,poll_options,status,created_by,
      queue_id,queue_position,duration_seconds
    ) values(
      a.id,g.id,schedule_at,lot::text||'. Lances',options,'scheduled',p_admin_user_id,
      q.id,position_value,duration_value
    ) returning * into d;

    insert into public.auction_events(auction_id,admin_user_id,event_type,external_event_id,payload)
    values(a.id,p_admin_user_id,'AUCTION_QUEUE_ITEM_CREATED',eid||':'||position_value,
      jsonb_build_object('queue_id',q.id,'position',position_value,'card_id',c.id,'dispatch_id',d.id,'lot_number',lot,'group_id',g.id));

    result_items:=result_items||jsonb_build_array(jsonb_build_object(
      'card',to_jsonb(c),'auction',to_jsonb(a),'dispatch',to_jsonb(d),'position',position_value
    ));
  end loop;

  result:=jsonb_build_object('queue',to_jsonb(q),'items',result_items);
  insert into public.processed_commands(external_event_id,request,result) values(eid,req,result);
  return result;
exception
  when unique_violation then
    raise exception 'lot_number_in_use';
end $$;

revoke execute on function public.create_auction_publish_queue(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_auction_publish_queue(jsonb,uuid) to service_role;

create or replace function public.control_auction_publish_queue(p_queue_id uuid,p_action text,p_admin_user_id uuid)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  q public.auction_publish_queues;
  d public.whatsapp_dispatches;
  position_offset integer:=0;
  next_time timestamptz;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  select * into q from public.auction_publish_queues where id=p_queue_id for update;
  if not found then raise exception 'queue_not_found'; end if;

  if p_action='pause' then
    if q.status not in('scheduled','running') then raise exception 'queue_not_pauseable'; end if;
    update public.auction_publish_queues set status='paused',paused_at=clock_timestamp(),updated_at=clock_timestamp() where id=q.id returning * into q;
  elsif p_action='resume' then
    if q.status<>'paused' then raise exception 'queue_not_resumable'; end if;
    for d in
      select * from public.whatsapp_dispatches
      where queue_id=q.id and status='scheduled'
      order by queue_position,id
      for update
    loop
      next_time:=clock_timestamp()+make_interval(secs=>(position_offset*q.interval_seconds)::double precision);
      update public.whatsapp_dispatches
         set scheduled_at=next_time,locked_at=null,locked_by=null,updated_at=clock_timestamp()
       where id=d.id;
      update public.auctions
         set scheduled_end_at=next_time+make_interval(secs=>coalesce(d.duration_seconds,1)::double precision),updated_at=clock_timestamp()
       where id=d.auction_id and status='draft';
      position_offset:=position_offset+1;
    end loop;
    update public.auction_publish_queues set status='running',paused_at=null,updated_at=clock_timestamp() where id=q.id returning * into q;
  elsif p_action='cancel' then
    if q.status in('completed','cancelled') then raise exception 'queue_not_cancellable'; end if;
    update public.whatsapp_dispatches
       set status='cancelled',locked_at=null,locked_by=null,updated_at=clock_timestamp()
     where queue_id=q.id and status in('scheduled','failed');
    update public.auction_publish_queues set status='cancelled',updated_at=clock_timestamp() where id=q.id returning * into q;
  else
    raise exception 'invalid_queue_action';
  end if;

  return to_jsonb(q);
end $$;

revoke execute on function public.control_auction_publish_queue(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.control_auction_publish_queue(uuid,text,uuid) to service_role;

create or replace function public.sync_auction_publish_queue_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.queue_id is null then return new; end if;
  if new.status='sent' then
    update public.auction_publish_queues
       set status=case when status='scheduled' then 'running' else status end,
           updated_at=clock_timestamp()
     where id=new.queue_id and status not in('paused','cancelled','completed');
  end if;
  if not exists(
    select 1 from public.whatsapp_dispatches
    where queue_id=new.queue_id and status in('scheduled','sending','failed')
  ) then
    update public.auction_publish_queues
       set status='completed',updated_at=clock_timestamp()
     where id=new.queue_id and status not in('cancelled','paused');
  end if;
  return new;
end $$;

drop trigger if exists sync_auction_publish_queue_after_dispatch on public.whatsapp_dispatches;
create trigger sync_auction_publish_queue_after_dispatch
  after update of status on public.whatsapp_dispatches
  for each row when (old.status is distinct from new.status)
  execute function public.sync_auction_publish_queue_status();

create or replace function public.claim_whatsapp_dispatch(p_worker_id text)
returns setof public.whatsapp_dispatches
language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_queue_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 or length(p_worker_id)>200 then raise exception 'invalid_worker_id'; end if;

  update public.whatsapp_dispatches d
     set status=case
       when exists(select 1 from public.auction_publish_queues q where q.id=d.queue_id and q.status='cancelled') then 'cancelled'
       when attempts>=5 then 'failed'
       else 'scheduled'
     end,
     locked_at=null,locked_by=null,
     last_error=coalesce(last_error,'Recovered after stale worker lock'),
     updated_at=clock_timestamp()
   where d.status='sending' and d.locked_at<clock_timestamp()-interval '2 minutes';

  select d.id,d.queue_id into v_id,v_queue_id
    from public.whatsapp_dispatches d
   where d.status='scheduled'
     and d.scheduled_at<=clock_timestamp()
     and d.attempts<5
     and (
       d.queue_id is null
       or exists(select 1 from public.auction_publish_queues q where q.id=d.queue_id and q.status in('scheduled','running'))
     )
   order by d.scheduled_at,d.created_at
   for update skip locked
   limit 1;

  if v_id is null then return; end if;
  if v_queue_id is not null then
    update public.auction_publish_queues set status='running',updated_at=clock_timestamp()
     where id=v_queue_id and status='scheduled';
  end if;

  return query update public.whatsapp_dispatches
     set status='sending',locked_at=clock_timestamp(),locked_by=p_worker_id,
         attempts=attempts+1,last_error=null,updated_at=clock_timestamp()
   where id=v_id returning *;
end $$;

revoke execute on function public.claim_whatsapp_dispatch(text) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_dispatch(text) to service_role;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='auction_publish_queues') then
    alter publication supabase_realtime add table public.auction_publish_queues;
  end if;
end $$;

-- A coluna cycle_closed nasce na 20260924180000 (o snapshot a seleciona e
-- ela aplica antes na ordem lexical); aqui fica apenas a logica do ciclo.

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
  perform pg_advisory_xact_lock(hashtextextended('auction_lot_number_seq',0));
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
       -- ADDITION (20260924200000): ciclo de 3 - exatamente 3 avisos NO
       -- CICLO ATUAL -> UMA notificacao de admin (idempotente). O contador
       -- considera apenas os avisos APOS o ultimo que fechou ciclo: a
       -- notificacao aos admins REINICIA o contador (decisao do operador
       -- 2026-09-24); nova sequencia de 3 gera nova notificacao.
       -- Baseline por created_at (ordem de INSERCAO - imune a event_at fora de ordem).
       if (select count(*) from public.participant_warnings pw
           where pw.participant_id=pid
             and pw.created_at>coalesce((select max(pw2.created_at) from public.participant_warnings pw2
                 where pw2.participant_id=pid and pw2.cycle_closed),'-infinity'::timestamptz))=3 then
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
        from public.participant_warnings w where w.participant_id=pid
          and w.created_at>coalesce((select max(pw2.created_at) from public.participant_warnings pw2
              where pw2.participant_id=pid and pw2.cycle_closed),'-infinity'::timestamptz)))
        from public.cards where id=a.card_id
        on conflict (external_event_id) do nothing;
       -- ADDITION (20260924200000): o aviso que FECHOU o ciclo fica marcado
       -- (cycle_closed) - e o baseline do proximo ciclo.
       update public.participant_warnings pw set cycle_closed=true
        where pw.participant_id=pid and pw.external_event_id=eid;
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

commit;
