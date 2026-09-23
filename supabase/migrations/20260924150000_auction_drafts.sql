-- 2026-09-24 round: auction_drafts — "Salvar rascunho" no wizard em lote.
-- The operator can stop programming an auction mid-way and resume later:
-- every photo is already in Supabase Storage at save time (content-addressed,
-- deduped), so the draft only stores HTTPS urls + the wizard's field state.
--
-- Conventions (docs/agent/03_DATABASE.md): create-or-replace/additive; every
-- table gets the RLS trio; replaced functions are copied VERBATIM from their
-- LATEST versions with ONLY the marked additions.
begin;

-- ---------------------------------------------------------------------------
-- 1) auction_drafts: one row per saved wizard draft, owned by the admin who
--    saved it (id is CLIENT-generated — crypto.randomUUID() — which makes the
--    upsert idempotent by primary key without processed_commands).
-- ----------------------------------------------------------------------------
create table if not exists public.auction_drafts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  payload jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists auction_drafts_owner_idx
  on public.auction_drafts (created_by, updated_at desc);
alter table public.auction_drafts enable row level security;
revoke all on public.auction_drafts from public,anon,authenticated;
grant select on public.auction_drafts to authenticated;
grant all on public.auction_drafts to service_role;
drop policy if exists staff_read on public.auction_drafts;
create policy staff_read on public.auction_drafts
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

-- ---------------------------------------------------------------------------
-- 2) upsert_auction_draft: save/refresh a draft. The wizard sends
--    {draftId, title, state}; guards mirror the API route (title 1..120,
--    state object, cards 1..200, <=512KB). Ownership: updating someone
--    else's draft raises draft_not_found (existence is never leaked).
--    Same input twice = same row, no side tables (idempotent by PK).
-- ----------------------------------------------------------------------------
create or replace function public.upsert_auction_draft(p_payload jsonb,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_draft_id text:=trim(coalesce(p_payload->>'draftId',''));
  v_title text:=trim(coalesce(p_payload->>'title',''));
  v_state jsonb:=coalesce(p_payload->'state','null'::jsonb);
  d public.auction_drafts;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  if v_draft_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'invalid_draft_id'; end if;
  if char_length(v_title)<1 or char_length(v_title)>120 then raise exception 'invalid_draft_title'; end if;
  if jsonb_typeof(v_state)<>'object' then raise exception 'invalid_draft_state'; end if;
  if jsonb_typeof(coalesce(v_state->'cards','[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(v_state->'cards','[]'::jsonb))<1
     or jsonb_array_length(coalesce(v_state->'cards','[]'::jsonb))>200
     or octet_length(v_state::text)>524288 then raise exception 'invalid_draft_state'; end if;

  select ad.* into d from public.auction_drafts ad where ad.id=v_draft_id::uuid for update;
  if found then
    if d.created_by<>p_admin_user_id then raise exception 'draft_not_found'; end if;
    update public.auction_drafts ad set title=v_title, payload=v_state, updated_at=clock_timestamp()
    where ad.id=v_draft_id::uuid returning ad.* into d;
  else
    insert into public.auction_drafts(id,title,payload,created_by)
    values(v_draft_id::uuid,v_title,v_state,p_admin_user_id)
    returning * into d;
  end if;

  return jsonb_build_object('id',d.id,'title',d.title,'updated_at',d.updated_at,
    'cardCount',jsonb_array_length(coalesce(d.payload->'cards','[]'::jsonb)));
exception
  when unique_violation then raise exception 'draft_save_conflict';
end $$;
revoke execute on function public.upsert_auction_draft(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.upsert_auction_draft(jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) delete_auction_draft: discard (or auto-delete after publishing).
--    Idempotent by state: deleting an already-deleted draft returns deleted=0.
-- ----------------------------------------------------------------------------
create or replace function public.delete_auction_draft(p_draft_id uuid,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n bigint:=0;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  with gone as (delete from public.auction_drafts ad where ad.id=p_draft_id and ad.created_by=p_admin_user_id returning 1)
    select count(*) into n from gone;
  return jsonb_build_object('deleted',n);
end $$;
revoke execute on function public.delete_auction_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_auction_draft(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) purge_all_business_data: LATEST body is 20260924120000 (ADDITION B
--    round). Copied VERBATIM with ONLY the marked addition: drafts are
--    panel work-in-progress, but "Excluir TUDO" still means everything.
-- ----------------------------------------------------------------------------
create or replace function public.purge_all_business_data(p_confirm text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 n_payments bigint; n_deliveries bigint; n_purchases bigint; n_warnings bigint;
 n_votes bigint; n_dispatches bigint; n_queues bigint; n_events bigint;
 n_bids bigint; n_auctions bigint; n_cards bigint; n_identities bigint;
 n_participants bigint; n_commands bigint; n_bot_commands bigint;
 n_reminders bigint; n_quick_polls bigint; -- ADDITION B
 n_drafts bigint; -- ADDITION (20260924150000): auction drafts
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
 -- ADDITION (20260924150000): saved wizard drafts are panel data — purge-all
 -- would not keep its name with orphan drafts surviving it.
 with gone as (delete from public.auction_drafts where true returning 1) select count(*) into n_drafts from gone;

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
     'payment_reminders', n_reminders, 'quick_polls', n_quick_polls,
     'auction_drafts', n_drafts), -- ADDITION (20260924150000)
   'sequences_reset', true);
end $$;
revoke execute on function public.purge_all_business_data(text) from public,anon,authenticated;
grant execute on function public.purge_all_business_data(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) export_business_backup: LATEST body is 20260924140000 (backup covers new
--    tables). Copied VERBATIM with ONLY the marked addition: the 50 most
--    recent drafts (a draft can weigh up to 512 KB — bounded on purpose).
-- ----------------------------------------------------------------------------
create or replace function public.export_business_backup()
returns jsonb language sql stable security invoker set search_path='' as $body$
 select jsonb_build_object(
  'cards',              coalesce((select jsonb_agg(t order by id) from public.cards t),'[]'::jsonb),
  'participants',       coalesce((select jsonb_agg(t order by id) from public.participants t),'[]'::jsonb),
  'participant_identities', coalesce((select jsonb_agg(t order by identity) from public.participant_identities t),'[]'::jsonb),
  'auctions',           coalesce((select jsonb_agg(t order by id) from public.auctions t),'[]'::jsonb),
  'bids',               coalesce((select jsonb_agg(t order by id) from public.bids t),'[]'::jsonb),
  'purchases',          coalesce((select jsonb_agg(t order by id) from public.purchases t),'[]'::jsonb),
  'payments',           coalesce((select jsonb_agg(t order by id) from public.payments t),'[]'::jsonb),
  'deliveries',         coalesce((select jsonb_agg(t order by id) from public.deliveries t),'[]'::jsonb),
  'warnings',           coalesce((select jsonb_agg(t order by id) from public.warnings t),'[]'::jsonb),
  'value_change_log',   coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from public.value_change_log t),'[]'::jsonb),
  'participant_warnings', coalesce((select jsonb_agg(t order by created_at desc,id desc) from public.participant_warnings t),'[]'::jsonb),
  'admin_notifications', coalesce((select jsonb_agg(t order by created_at desc,id desc) from public.admin_notifications t),'[]'::jsonb),
  'auction_events',     coalesce((select jsonb_agg(t order by id) from public.auction_events t),'[]'::jsonb),
  'processed_commands', coalesce((select jsonb_agg(t order by external_event_id) from public.processed_commands t),'[]'::jsonb),
  'whatsapp_groups',    coalesce((select jsonb_agg(t order by id) from public.whatsapp_groups t),'[]'::jsonb),
  'whatsapp_dispatches', coalesce((select jsonb_agg(t order by id) from public.whatsapp_dispatches t),'[]'::jsonb),
  'auction_publish_queues', coalesce((select jsonb_agg(t order by id) from public.auction_publish_queues t),'[]'::jsonb),
  'whatsapp_vote_state', coalesce((select jsonb_agg(t order by auction_id, voter_jid) from public.whatsapp_vote_state t),'[]'::jsonb),
  'whatsapp_quick_polls', coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,group_id,title,options,scheduled_at,sent_at,poll_message_id,external_event_id,created_by,created_at from public.whatsapp_quick_polls order by created_at desc,id desc limit 500) t),'[]'::jsonb),
  'payment_reminders',  coalesce((select jsonb_agg(t order by last_reminded_at desc nulls last) from (select purchase_id,participant_id,reminded_count,last_reminded_at,created_at from public.payment_reminders) t),'[]'::jsonb),
  'auction_drafts',     coalesce((select jsonb_agg(t order by updated_at desc) from (select id,title,payload,created_by,created_at,updated_at from public.auction_drafts order by updated_at desc limit 50) t),'[]'::jsonb) -- ADDITION (20260924150000)
 );
$body$;
revoke execute on function public.export_business_backup() from public,anon,authenticated;
grant execute on function public.export_business_backup() to service_role;

commit;
