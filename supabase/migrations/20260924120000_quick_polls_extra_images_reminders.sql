-- 2026-09-24 round: (1) quick giveaway polls (panel-created, bot-published),
-- (2) up to 4 extra detail photos per card, (3) payment reminders (DM every
-- 7 days until marked paid) + the mark-purchase-paid RPC that stops them.
--
-- Conventions: create-or-replace/additive; every table gets the project RLS
-- trio; the two replaced functions are copied VERBATIM from their LATEST
-- versions with ONLY the marked additions (same discipline as
-- 20260923093000 - see docs/agent/03_DATABASE.md PERIGOS).
begin;

-- ---------------------------------------------------------------------------
-- 1) cards.extra_images: detail photos. Array of HTTPS urls, max 4, in
--    display order. Main photo stays in cards.image_url (unchanged contract).
--    The bot sends extras sequentially right after the main photo.
-- ----------------------------------------------------------------------------
alter table public.cards
  add column if not exists extra_images jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2) whatsapp_quick_polls: giveaway polls ("quem clicar primeiro leva").
--    Panel-only creation; free text/emoji title + options; the bot's 3s
--    scheduler publishes due polls as native WhatsApp polls and marks sent.
--    Deliberately SEPARATE from whatsapp_dispatches: that table requires
--    auction_id NOT NULL UNIQUE (a giveaway has no auction).
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_quick_polls (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.whatsapp_groups(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  options jsonb not null,
  scheduled_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  poll_message_id text unique,
  external_event_id text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists whatsapp_quick_polls_due_idx
  on public.whatsapp_quick_polls (scheduled_at) where sent_at is null;
alter table public.whatsapp_quick_polls enable row level security;
revoke all on public.whatsapp_quick_polls from public,anon,authenticated;
grant select on public.whatsapp_quick_polls to authenticated;
grant all on public.whatsapp_quick_polls to service_role;
drop policy if exists staff_read on public.whatsapp_quick_polls;
create policy staff_read on public.whatsapp_quick_polls
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

-- ---------------------------------------------------------------------------
-- 3) payment_reminders: one row per purchase that entered the reminder cycle.
--    purchase_id UNIQUE = idempotency anchor; the bot UPSERTs count/last_at.
--    Rows cascade away with the purchase (purge + 30d cleanup need no change).
-- ----------------------------------------------------------------------------
create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.purchases(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  reminded_count integer not null default 0,
  last_reminded_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists payment_reminders_due_idx
  on public.payment_reminders (last_reminded_at);
alter table public.payment_reminders enable row level security;
revoke all on public.payment_reminders from public,anon,authenticated;
grant select on public.payment_reminders to authenticated;
grant all on public.payment_reminders to service_role;
drop policy if exists staff_read on public.payment_reminders;
create policy staff_read on public.payment_reminders
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

-- ---------------------------------------------------------------------------
-- 4) mark_purchase_paid: the panel "Pagamento recebido" button. Sets the
--    payments row to paid (inserting it when the purchase has none), moves
--    the delivery out of waiting_payment, audits the transition and — the
--    whole point — STOPS the bot's 7-day reminder DMs. Idempotent BY STATE:
--    calling it twice returns the same result without duplicate audit rows.
-- ----------------------------------------------------------------------------
create or replace function public.mark_purchase_paid(p_purchase_id uuid, p_admin_user_id uuid, p_method text default null, p_reference text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  purchase public.purchases;
  payment public.payments;
  delivery public.deliveries;
  already_paid boolean:=false;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in ('admin','operator')) then raise exception 'forbidden'; end if;
  perform set_config('app.admin_user_id',p_admin_user_id::text,true);
  select * into purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if purchase.status <> 'confirmed' then raise exception 'purchase_not_confirmable'; end if;

  select * into payment from public.payments where purchase_id=p_purchase_id for update;
  if payment is null then
    insert into public.payments(purchase_id,amount,status,method,paid_at,reference)
    values(p_purchase_id,purchase.amount,'paid'::public.payment_status,nullif(trim(coalesce(p_method,'')),''),clock_timestamp(),nullif(trim(coalesce(p_reference,'')),''))
    returning * into payment;
  elsif payment.status = 'paid'::public.payment_status then
    already_paid:=true;
  else
    update public.payments set status='paid'::public.payment_status, paid_at=coalesce(paid_at,clock_timestamp()),
      method=coalesce(nullif(trim(coalesce(p_method,'')),''),method),
      reference=coalesce(nullif(trim(coalesce(p_reference,'')),''),reference)
    where id=payment.id returning * into payment;
  end if;

  select * into delivery from public.deliveries where purchase_id=p_purchase_id for update;
  if delivery is not null and delivery.status='waiting_payment'::public.delivery_status then
    update public.deliveries set status='ready'::public.delivery_status, updated_at=clock_timestamp() where id=delivery.id returning * into delivery;
  end if;

  if not already_paid then
    insert into public.auction_events(auction_id,participant_id,admin_user_id,event_type,external_event_id,payload)
    values(purchase.auction_id,purchase.participant_id,p_admin_user_id,'PURCHASE_PAID','purchase-paid:'||p_purchase_id::text,
           jsonb_build_object('purchase_id',p_purchase_id,'amount',payment.amount,'paid_at',payment.paid_at));
  end if;

  return jsonb_build_object('purchase',to_jsonb(purchase),'payment',to_jsonb(payment),'delivery',case when delivery is null then null else to_jsonb(delivery) end,'already_paid',already_paid);
end $$;
revoke execute on function public.mark_purchase_paid(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_purchase_paid(uuid,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) create_auction_publish_queue: LATEST body is 20260913202000 (never
--    replaced since). Copied VERBATIM with ONLY the marked addition
--    (ADDITION A: validate + persist cd->'extra_images').
-- ----------------------------------------------------------------------------
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
  extras jsonb; -- ADDITION A
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
    -- ADDITION A.1: extra detail photos (max 4, all HTTPS, array order kept).
    extras:=coalesce(cd->'extra_images','[]'::jsonb);
    if jsonb_typeof(extras)<>'array' or jsonb_array_length(extras)>4
       or exists(select 1 from jsonb_array_elements(extras) e where jsonb_typeof(e)<>'string'
                 or not (e#>>'{}' ~ '^https://')
                 or char_length(e#>>'{}')>500) then raise exception 'invalid_extra_images'; end if;

    if start_price<0 or increment_value<=0 or buyout is not null and buyout<=start_price then raise exception 'invalid_auction_values'; end if;
    if duration_value<1 or duration_value>604800 then raise exception 'invalid_auction_duration'; end if;
    if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;

    if lot is not null then
      if lot<=0 or exists(select 1 from public.auctions where lot_number=lot) then raise exception 'lot_number_in_use'; end if;
    else
      loop
        lot:=nextval('public.auction_lot_number_seq');
        exit when not exists(select 1 from public.auctions where lot_number=lot);
      end loop;
    end if;

    schedule_at:=queue_start+make_interval(secs=>((position_value-1)*interval_value)::double precision);
    end_at:=schedule_at+make_interval(secs=>duration_value::double precision);

    insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price,extra_images)
    values(
      trim(cd->>'name'),
      nullif(trim(coalesce(cd->>'collection','')),''),
      nullif(trim(coalesce(cd->>'card_number','')),''),
      nullif(trim(coalesce(cd->>'variant','')),''),
      coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),
      nullif(trim(coalesce(cd->>'condition','')),''),
      nullif(trim(coalesce(cd->>'image_url','')),''),
      start_price,buyout,
      extras -- ADDITION A.2
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

-- ---------------------------------------------------------------------------
-- 6) create_auction_wizard: LATEST body is 20260921120000. Copied VERBATIM
--    with ONLY the marked ADDITION A (same extra_images rule as the queue).
-- ----------------------------------------------------------------------------
create or replace function public.create_auction_wizard(p_payload jsonb,p_admin_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare eid text:=trim(coalesce(p_payload->>'eventId','')); cd jsonb:=coalesce(p_payload->'card','{}'::jsonb); ad jsonb:=coalesce(p_payload->'auction','{}'::jsonb); req jsonb; prior public.processed_commands; c public.cards; a public.auctions; d public.whatsapp_dispatches; g public.whatsapp_groups; result jsonb; lot bigint; start_price numeric; increment_value numeric; buyout numeric; schedule_at timestamptz; end_at timestamptz; group_id uuid; options jsonb; extras jsonb; -- ADDITION A
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
 if length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
 req:=p_payload||jsonb_build_object('actor',p_admin_user_id,'type','AUCTION_WIZARD_CREATE'); perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into prior from public.processed_commands where external_event_id=eid; if found then if prior.request<>req then raise exception 'event_id_conflict'; end if; return prior.result; end if;
 perform set_config('app.admin_user_id',p_admin_user_id::text,true);
 start_price:=(ad->>'starting_price')::numeric; increment_value:=(ad->>'bid_increment')::numeric; buyout:=nullif(ad->>'buyout_price','')::numeric; schedule_at:=(ad->>'scheduled_at')::timestamptz; end_at:=nullif(ad->>'scheduled_end_at','')::timestamptz; group_id:=(ad->>'group_id')::uuid; options:=ad->'poll_options'; lot:=nullif(ad->>'lot_number','')::bigint;
 extras:=coalesce(cd->'extra_images','[]'::jsonb); -- ADDITION A.1
 if jsonb_typeof(extras)<>'array' or jsonb_array_length(extras)>4
    or exists(select 1 from jsonb_array_elements(extras) e where jsonb_typeof(e)<>'string'
              or not (e#>>'{}' ~ '^https://')
              or char_length(e#>>'{}')>500) then raise exception 'invalid_extra_images'; end if;
 if start_price<0 or increment_value<=0 or buyout is not null and buyout<=start_price then raise exception 'invalid_auction_values'; end if;
 if end_at is not null and end_at<=schedule_at then raise exception 'invalid_end_time'; end if;
 if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;
 select * into g from public.whatsapp_groups where id=group_id and active for share; if not found then raise exception 'whatsapp_group_unavailable'; end if;
 if lot is not null then if lot<=0 or exists(select 1 from public.auctions where lot_number=lot) then raise exception 'lot_number_in_use'; end if; else loop lot:=nextval('public.auction_lot_number_seq'); exit when not exists(select 1 from public.auctions where lot_number=lot); end loop; end if;
 insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price,extra_images) values(trim(cd->>'name'),nullif(trim(coalesce(cd->>'collection','')),''),nullif(trim(coalesce(cd->>'card_number','')),''),nullif(trim(coalesce(cd->>'variant','')),''),coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),nullif(trim(coalesce(cd->>'condition','')),''),nullif(trim(coalesce(cd->>'image_url','')),''),start_price,buyout,extras) returning * into c; -- ADDITION A.2 (extra_images column + value)
 insert into public.auctions(card_id,lot_number,starting_price,bid_increment,buyout_price,scheduled_end_at,created_by) values(c.id,lot,start_price,increment_value,buyout,end_at,p_admin_user_id) returning * into a;
 insert into public.whatsapp_dispatches(auction_id,group_id,scheduled_at,poll_title,poll_options,status,created_by) values(a.id,g.id,schedule_at,lot::text||'. Lances',options,'scheduled',p_admin_user_id) returning * into d;
 insert into public.auction_events(auction_id,admin_user_id,event_type,external_event_id,payload) values(a.id,p_admin_user_id,'AUCTION_WIZARD_CREATED',eid,jsonb_build_object('card_id',c.id,'dispatch_id',d.id,'lot_number',lot,'group_id',g.id));
 result:=jsonb_build_object('card',to_jsonb(c),'auction',to_jsonb(a),'dispatch',to_jsonb(d)); insert into public.processed_commands(external_event_id,request,result) values(eid,req,result); return result;
end $$;
revoke execute on function public.create_auction_wizard(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_auction_wizard(jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7) purge_all_business_data: LATEST body is 20260921140000 (SECURITY
--    DEFINER). Copied VERBATIM with ONLY the marked additions: the two new
--    tables join the explicit delete chain so "Excluir TUDO" keeps its name.
-- ----------------------------------------------------------------------------
create or replace function public.purge_all_business_data(p_confirm text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 n_payments bigint; n_deliveries bigint; n_purchases bigint; n_warnings bigint;
 n_votes bigint; n_dispatches bigint; n_queues bigint; n_events bigint;
 n_bids bigint; n_auctions bigint; n_cards bigint; n_identities bigint;
 n_participants bigint; n_commands bigint; n_bot_commands bigint;
 n_reminders bigint; n_quick_polls bigint; -- ADDITION B
begin
 if coalesce(p_confirm,'') <> 'quero excluir mesmo' then raise exception 'purge_not_confirmed'; end if;

 execute 'drop trigger if exists immutable_audit on public.auction_events';

 with gone as (delete from public.payments where true returning 1) select count(*) into n_payments from gone;
 -- ADDITION B.1: reminders die with their purchases (explicit for counting).
 with gone as (delete from public.payment_reminders where true returning 1) select count(*) into n_reminders from gone;
 with gone as (delete from public.deliveries where true returning 1) select count(*) into n_deliveries from gone;
 with gone as (delete from public.purchases where true returning 1) select count(*) into n_purchases from gone;
 with gone as (delete from public.warnings where true returning 1) select count(*) into n_warnings from gone;
 with gone as (delete from public.whatsapp_vote_state where true returning 1) select count(*) into n_votes from gone;
 with gone as (delete from public.whatsapp_dispatches where true returning 1) select count(*) into n_dispatches from gone;
 with gone as (delete from public.auction_publish_queues where true returning 1) select count(*) into n_queues from gone;
 with gone as (delete from public.auction_events where true returning 1) select count(*) into n_events from gone;
 with gone as (delete from public.bids where true returning 1) select count(*) into n_bids from gone;
 with gone as (delete from public.auctions where true returning 1) select count(*) into n_auctions from gone;
 with gone as (delete from public.cards where true returning 1) select count(*) into n_cards from gone;
 with gone as (delete from public.participant_identities where true returning 1) select count(*) into n_identities from gone;
 with gone as (delete from public.participants where true returning 1) select count(*) into n_participants from gone;
 with gone as (delete from public.processed_commands where true returning 1) select count(*) into n_commands from gone;
 with gone as (delete from public.whatsapp_bot_commands where true returning 1) select count(*) into n_bot_commands from gone;
 -- ADDITION B.2: giveaway polls are business data too (groups survive purge).
 with gone as (delete from public.whatsapp_quick_polls where true returning 1) select count(*) into n_quick_polls from gone;

 execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';

 execute 'alter sequence public.auction_lot_number_seq restart with 1';
 execute 'alter sequence public.bids_confirmation_order_seq restart with 1';

 return jsonb_build_object(
   'deleted', jsonb_build_object(
     'payments', n_payments, 'deliveries', n_deliveries, 'purchases', n_purchases,
     'warnings', n_warnings, 'vote_state', n_votes, 'dispatches', n_dispatches,
     'queues', n_queues, 'events', n_events, 'bids', n_bids, 'auctions', n_auctions,
     'cards', n_cards, 'identities', n_identities, 'participants', n_participants,
     'commands', n_commands, 'bot_commands', n_bot_commands,
     'payment_reminders', n_reminders, 'quick_polls', n_quick_polls), -- ADDITION B.3
   'sequences_reset', true);
end $$;
revoke execute on function public.purge_all_business_data(text) from public,anon,authenticated;
grant execute on function public.purge_all_business_data(text) to service_role;

-- ---------------------------------------------------------------------------
-- 8) read_dashboard_snapshot: payments were hardcoded '[]' (both 20260921120000
--    and the tie-break rewrite in 20260921130000). The compras table now
--    needs REAL payments + payment_reminders for the "Pagamento" column and
--    the reminder count badge. Body copied verbatim from the LATEST version
--    (20260921130000 — includes bids.whatsapp_event_at for the tie-break
--    ranking) with ONLY the marked ADDITION C.
-- ----------------------------------------------------------------------------
create or replace function public.read_dashboard_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $body$
 select jsonb_build_object(
  'cards',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,name,collection,card_number,image_url,starting_price,buyout_price,status,variant,language,condition,notes
      from public.cards
    ) x
  ),'[]'::jsonb),
  'participants',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,display_name,whatsapp_id,phone_e164,status,suspension_until,notes
      from public.participants
    ) x
  ),'[]'::jsonb),
  'auctions',coalesce((
    select jsonb_agg(x order by created_at desc)
    from (
      select id,card_id,status,starting_price,bid_increment,buyout_price,scheduled_end_at,winner_participant_id,final_price,lot_number,created_at,win_type
      from public.auctions
    ) x
  ),'[]'::jsonb),
  'bids',coalesce((
    select jsonb_agg(x order by processed_at desc)
    from (
      select id,auction_id,participant_id,amount,status,processed_at,confirmation_order,whatsapp_event_at
      from public.bids
    ) x
  ),'[]'::jsonb),
  'auction_events',coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,created_at,event_type,participant_id from public.auction_events order by created_at desc,id desc limit 15) t),'[]'::jsonb),
  'purchases',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,card_id,participant_id,auction_id,amount,status
      from public.purchases
    ) x
  ),'[]'::jsonb),
  -- ADDITION C: real payment state + reminder cycle (was hardcoded '[]').
  'payments',coalesce((select jsonb_agg(t order by id) from (select id,purchase_id,amount,status,method,paid_at,reference from public.payments) t),'[]'::jsonb),
  'payment_reminders',coalesce((select jsonb_agg(t order by last_reminded_at desc nulls last) from (select purchase_id,participant_id,reminded_count,last_reminded_at from public.payment_reminders) t),'[]'::jsonb),
  'deliveries','[]'::jsonb,
  'warnings','[]'::jsonb
 );
$body$;
revoke execute on function public.read_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.read_dashboard_snapshot() to service_role;

commit;
