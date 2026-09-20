begin;
-- Leilão Pokémon - initial schema
-- Source of truth: PostgreSQL/Supabase. WhatsApp and Excel are integration/reporting layers.

create extension if not exists pgcrypto;

create type public.participant_status as enum ('active', 'suspended', 'banned');
create type public.card_status as enum ('available', 'in_auction', 'sold', 'archived');
create type public.auction_status as enum ('draft', 'open', 'sold', 'closed', 'cancelled', 'review_required');
create type public.bid_status as enum ('active', 'withdrawn', 'replaced', 'rejected', 'late');
create type public.bid_kind as enum ('bid', 'buyout');
create type public.purchase_status as enum ('confirmed', 'cancelled', 'refunded');
create type public.payment_status as enum ('pending', 'partial', 'paid', 'cancelled', 'refunded');
create type public.delivery_status as enum ('waiting_payment', 'ready', 'shipped', 'delivered', 'pickup', 'cancelled');

create table public.admin_profiles (user_id uuid primary key references auth.users(id) on delete cascade,display_name text not null,role text not null default 'admin' check (role in ('admin','operator','viewer')),active boolean not null default true,created_at timestamptz not null default now());
create table public.participants (id uuid primary key default gen_random_uuid(),whatsapp_id text not null unique,phone_e164 text,display_name text not null,status public.participant_status not null default 'active',suspension_until timestamptz,first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.cards (id uuid primary key default gen_random_uuid(),name text not null,collection text,card_number text,variant text,language text not null default 'pt-BR',condition text,image_url text,starting_price numeric(12,2) not null check(starting_price>=0),buyout_price numeric(12,2) check(buyout_price is null or buyout_price>=starting_price),status public.card_status not null default 'available',notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.auctions (id uuid primary key default gen_random_uuid(),card_id uuid not null references public.cards(id) on delete restrict,status public.auction_status not null default 'draft',whatsapp_group_id text,poll_id text unique,message_id text,starting_price numeric(12,2) not null check(starting_price>=0),buyout_price numeric(12,2) check(buyout_price is null or buyout_price>=starting_price),scheduled_end_at timestamptz,started_at timestamptz,ended_at timestamptz,winner_participant_id uuid references public.participants(id) on delete set null,final_price numeric(12,2),win_type text check(win_type is null or win_type in ('highest_bid','buyout','admin_decision')),cancellation_reason text,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint final_result_consistent check((winner_participant_id is null and final_price is null) or (winner_participant_id is not null and final_price is not null and final_price>=0)));
create unique index one_live_auction_per_card on public.auctions(card_id) where status in ('open','review_required');
create table public.bids (id uuid primary key default gen_random_uuid(),auction_id uuid not null references public.auctions(id) on delete restrict,participant_id uuid not null references public.participants(id) on delete restrict,amount numeric(12,2) not null check(amount>=0),kind public.bid_kind not null default 'bid',status public.bid_status not null default 'active',poll_option_id text,whatsapp_event_id text unique,whatsapp_event_at timestamptz,received_at timestamptz not null default now(),processed_at timestamptz not null default now(),replaced_by uuid references public.bids(id) on delete set null,rejection_reason text,metadata jsonb not null default '{}'::jsonb);
create unique index one_active_bid_per_participant_per_auction on public.bids(auction_id,participant_id) where status='active';
create index bids_auction_amount_idx on public.bids(auction_id,amount desc,processed_at asc) where status='active';
create table public.auction_events (id uuid primary key default gen_random_uuid(),auction_id uuid references public.auctions(id) on delete restrict,participant_id uuid references public.participants(id) on delete set null,admin_user_id uuid references auth.users(id) on delete set null,event_type text not null,external_event_id text unique,occurred_at timestamptz not null default now(),payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create index auction_events_timeline_idx on public.auction_events(auction_id,occurred_at desc);
create table public.warnings (id uuid primary key default gen_random_uuid(),participant_id uuid not null references public.participants(id) on delete restrict,auction_id uuid references public.auctions(id) on delete set null,card_id uuid references public.cards(id) on delete set null,type text not null,reason text not null,starts_at timestamptz not null default now(),ends_at timestamptz,active boolean not null default true,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create table public.purchases (id uuid primary key default gen_random_uuid(),auction_id uuid not null unique references public.auctions(id) on delete restrict,participant_id uuid not null references public.participants(id) on delete restrict,card_id uuid not null references public.cards(id) on delete restrict,amount numeric(12,2) not null check(amount>=0),status public.purchase_status not null default 'confirmed',confirmed_at timestamptz not null default now(),notes text,created_at timestamptz not null default now());
create table public.payments (id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.purchases(id) on delete restrict,amount numeric(12,2) not null check(amount>0),status public.payment_status not null default 'pending',method text,paid_at timestamptz,reference text,created_at timestamptz not null default now());
create table public.deliveries (id uuid primary key default gen_random_uuid(),purchase_id uuid not null unique references public.purchases(id) on delete restrict,status public.delivery_status not null default 'waiting_payment',tracking_code text,shipped_at timestamptz,delivered_at timestamptz,notes text,updated_at timestamptz not null default now(),created_at timestamptz not null default now());

create or replace function public.place_auction_bid(p_auction_id uuid,p_participant_id uuid,p_amount numeric,p_external_event_id text,p_event_at timestamptz default now()) returns public.bids language plpgsql security invoker set search_path='' as $$
declare v_auction public.auctions; v_participant public.participants; v_bid public.bids;
begin
 if p_amount<0 then raise exception 'invalid_bid_amount'; end if;
 select * into v_auction from public.auctions where id=p_auction_id for update;
 if not found then raise exception 'auction_not_found'; end if;
 if v_auction.status<>'open' then raise exception 'auction_not_open'; end if;
 select * into v_participant from public.participants where id=p_participant_id;
 if not found then raise exception 'participant_not_found'; end if;
 if v_participant.status<>'active' or (v_participant.suspension_until is not null and v_participant.suspension_until>now()) then raise exception 'participant_not_eligible'; end if;
 if p_external_event_id is not null and exists(select 1 from public.bids where whatsapp_event_id=p_external_event_id) then select * into v_bid from public.bids where whatsapp_event_id=p_external_event_id; return v_bid; end if;
 update public.bids set status='replaced',processed_at=now() where auction_id=p_auction_id and participant_id=p_participant_id and status='active';
 insert into public.bids(auction_id,participant_id,amount,kind,status,whatsapp_event_id,whatsapp_event_at) values(p_auction_id,p_participant_id,p_amount,'bid','active',p_external_event_id,p_event_at) returning * into v_bid;
 insert into public.auction_events(auction_id,participant_id,event_type,external_event_id,occurred_at,payload) values(p_auction_id,p_participant_id,'BID_PLACED',p_external_event_id,coalesce(p_event_at,now()),jsonb_build_object('bid_id',v_bid.id,'amount',p_amount)) on conflict(external_event_id) do nothing;
 return v_bid;
end;$$;

create or replace function public.confirm_auction_buyout(p_auction_id uuid,p_participant_id uuid,p_external_event_id text,p_event_at timestamptz default now()) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_auction public.auctions; v_participant public.participants; v_bid_id uuid; v_purchase_id uuid;
begin
 select * into v_auction from public.auctions where id=p_auction_id for update;
 if not found then raise exception 'auction_not_found'; end if;
 if p_external_event_id is not null then select (payload->>'purchase_id')::uuid into v_purchase_id from public.auction_events where external_event_id=p_external_event_id and event_type='BUYOUT_CONFIRMED'; if v_purchase_id is not null then return v_purchase_id; end if; end if;
 if v_auction.status<>'open' then raise exception 'auction_not_open'; end if;
 if v_auction.buyout_price is null then raise exception 'buyout_not_enabled'; end if;
 select * into v_participant from public.participants where id=p_participant_id;
 if not found then raise exception 'participant_not_found'; end if;
 if v_participant.status<>'active' or (v_participant.suspension_until is not null and v_participant.suspension_until>now()) then raise exception 'participant_not_eligible'; end if;
 update public.bids set status='replaced',processed_at=now() where auction_id=p_auction_id and participant_id=p_participant_id and status='active';
 insert into public.bids(auction_id,participant_id,amount,kind,status,whatsapp_event_id,whatsapp_event_at) values(p_auction_id,p_participant_id,v_auction.buyout_price,'buyout','active',p_external_event_id,p_event_at) returning id into v_bid_id;
 update public.auctions set status='sold',winner_participant_id=p_participant_id,final_price=v_auction.buyout_price,win_type='buyout',ended_at=now(),updated_at=now() where id=p_auction_id;
 update public.cards set status='sold',updated_at=now() where id=v_auction.card_id;
 insert into public.purchases(auction_id,participant_id,card_id,amount) values(p_auction_id,p_participant_id,v_auction.card_id,v_auction.buyout_price) returning id into v_purchase_id;
 insert into public.deliveries(purchase_id) values(v_purchase_id);
 insert into public.auction_events(auction_id,participant_id,event_type,external_event_id,occurred_at,payload) values(p_auction_id,p_participant_id,'BUYOUT_CONFIRMED',p_external_event_id,coalesce(p_event_at,now()),jsonb_build_object('purchase_id',v_purchase_id,'bid_id',v_bid_id,'amount',v_auction.buyout_price));
 return v_purchase_id;
end;$$;

alter table public.admin_profiles enable row level security; alter table public.participants enable row level security; alter table public.cards enable row level security; alter table public.auctions enable row level security; alter table public.bids enable row level security; alter table public.auction_events enable row level security; alter table public.warnings enable row level security; alter table public.purchases enable row level security; alter table public.payments enable row level security; alter table public.deliveries enable row level security;
revoke all on table public.admin_profiles,public.participants,public.cards,public.auctions,public.bids,public.auction_events,public.warnings,public.purchases,public.payments,public.deliveries from anon,authenticated;
revoke execute on function public.place_auction_bid(uuid,uuid,numeric,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.confirm_auction_buyout(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.place_auction_bid(uuid,uuid,numeric,text,timestamptz) to service_role;
grant execute on function public.confirm_auction_buyout(uuid,uuid,text,timestamptz) to service_role;
comment on function public.confirm_auction_buyout is 'Atomic buyout operation. Must be invoked only from trusted server code using service role.';
comment on table public.auction_events is 'Append-only audit trail for auction and administrative events.';
-- Upgrade for databases that already applied the initial schema.
-- For a NEW database use schema.sql (which includes this file's contents).
alter table public.bids add column if not exists confirmation_order bigint generated by default as identity;
create index if not exists bids_winner_idx on public.bids(auction_id,amount desc,processed_at,confirmation_order) where status='active';
create table if not exists public.processed_commands (
 external_event_id text primary key,
 request jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.processed_commands enable row level security;
revoke all on public.processed_commands from public,anon,authenticated;

-- All writes use the trusted backend. Browser access is SELECT only, for staff.
grant select on public.admin_profiles to authenticated;
drop policy if exists own_profile on public.admin_profiles;
create policy own_profile on public.admin_profiles for select to authenticated using(user_id=(select auth.uid()));
do $$ declare t text; begin
 foreach t in array array['cards','participants','auctions','bids','auction_events','purchases','payments','deliveries','warnings'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists staff_read on public.%I',t);
  execute format('create policy staff_read on public.%I for select to authenticated using (exists (select 1 from public.admin_profiles where user_id=(select auth.uid()) and active))',t);
 end loop;
end $$;
grant all on public.admin_profiles,public.cards,public.participants,public.auctions,public.bids,public.auction_events,public.purchases,public.payments,public.deliveries,public.warnings,public.processed_commands to service_role;
grant usage,select on sequence public.bids_confirmation_order_seq to service_role;

create or replace function public.reject_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'audit_is_append_only'; end $$;
drop trigger if exists immutable_audit on public.auction_events;
create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation();

create or replace function public.audit_admin_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare a uuid; aid uuid; pid uuid;
begin
 a:=nullif(current_setting('app.admin_user_id',true),'')::uuid;
 if tg_table_name='auctions' then aid:=new.id; end if;
 if tg_table_name='participants' then pid:=new.id; end if;
 insert into public.auction_events(auction_id,participant_id,admin_user_id,event_type,payload)
 values(aid,pid,a,tg_table_name||'_'||tg_op,jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['cards','participants','auctions'] loop
  execute format('drop trigger if exists audit_change on public.%I',t);
  execute format('create trigger audit_change after insert or update on public.%I for each row execute function public.audit_admin_change()',t);
 end loop;
end $$;

-- One entry point for admin commands and future bot events. The event ID is
-- global, mandatory and bound to the entire request, including the staff actor.
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
    -- Lock eligible participants against concurrent suspension while selecting winner.
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
     update public.bids set status='replaced' where id=old_bid;
     insert into public.bids(auction_id,participant_id,amount,kind,whatsapp_event_id,whatsapp_event_at,processed_at)
     values(aid,pid,amount,case when k='BUYOUT_CONFIRMED' then 'buyout'::public.bid_kind else 'bid'::public.bid_kind end,eid,event_at,stamp) returning * into b;
     update public.bids set replaced_by=b.id where id=old_bid;
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
-- Retire legacy write entry points so no caller can bypass the shared rules.
revoke execute on function public.place_auction_bid(uuid,uuid,numeric,text,timestamptz) from service_role;
revoke execute on function public.confirm_auction_buyout(uuid,uuid,text,timestamptz) from service_role;
revoke execute on function public.audit_admin_change(),public.reject_audit_mutation() from public,anon,authenticated;

-- One statement/snapshot: reports and dashboard cannot mix auction states.
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
  'warnings',coalesce((select jsonb_agg(t order by id) from public.warnings t),'[]'::jsonb)
 );
$body$;
revoke execute on function public.read_auction_snapshot() from public,anon,authenticated;
grant execute on function public.read_auction_snapshot() to service_role;

-- Relevant FK indexes used for participant eligibility/history and purchases.
create index if not exists bids_participant_idx on public.bids(participant_id);
create index if not exists bids_replaced_by_idx on public.bids(replaced_by);
create index if not exists events_participant_idx on public.auction_events(participant_id);
create index if not exists events_admin_idx on public.auction_events(admin_user_id);
create index if not exists auctions_card_idx on public.auctions(card_id);
create index if not exists auctions_winner_idx on public.auctions(winner_participant_id);
create index if not exists auctions_creator_idx on public.auctions(created_by);
create index if not exists purchases_participant_idx on public.purchases(participant_id);
create index if not exists purchases_card_idx on public.purchases(card_id);
create index if not exists payments_purchase_idx on public.payments(purchase_id);
create index if not exists warnings_participant_idx on public.warnings(participant_id);
create index if not exists warnings_auction_idx on public.warnings(auction_id);
create index if not exists warnings_card_idx on public.warnings(card_id);
create index if not exists warnings_creator_idx on public.warnings(created_by);

do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['cards','participants','auctions','bids','auction_events','purchases'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;
