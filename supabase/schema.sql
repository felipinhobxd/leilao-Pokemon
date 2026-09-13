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
