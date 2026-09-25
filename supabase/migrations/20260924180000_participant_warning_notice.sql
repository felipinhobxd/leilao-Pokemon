-- 2026-09-24 round: the participant NOW receives the warning DM.
--
-- The 3-warning rule already existed end-to-end (20260923093000): each REAL
-- reduction writes 1 row in participant_warnings (global counter per user)
-- and, at EXACTLY 3, one admin_notifications row that the bot DMs to the
-- admins. What was missing (operator request 2026-09-24):
--  1. the PARTICIPANT gets a DM naming which poll/lot, values and time;
--  2. the operator SEES the changes/warnings live in the dashboard (the
--     dashboard snapshot had neither table — only the Excel export did).
--
-- Conventions (docs/agent/03_DATABASE.md): additive; replaced functions are
-- copied VERBATIM from their LATEST versions with ONLY the marked additions.
begin;

-- ---------------------------------------------------------------------------
-- 1) participant_warnings.notified_at: DM delivery state for the participant
--    (same pattern as admin_notifications.sent_at / payment flow). NULL =
--    pending; the bot marks it ONLY after the WhatsApp DM is sent (crash →
--    retry). A participant with no resolvable phone JID is also marked, so an
--    undeliverable DM can never wedge the drain — the warning still counts.
-- ----------------------------------------------------------------------------
alter table public.participant_warnings
  add column if not exists notified_at timestamptz;
create index if not exists participant_warnings_unnotified_idx
  on public.participant_warnings (occurred_at) where notified_at is null;

-- ---------------------------------------------------------------------------
-- 2) read_dashboard_snapshot: LATEST body is 20260924120000 (ADDITION C
--    round: real payments + payment_reminders). Copied VERBATIM with ONLY the
--    marked addition: value_change_log + participant_warnings (bounded 100,
--    most recent first) so the live dashboard shows which poll/lot, values
--    and times — 'warnings' (legacy per-auction table) stays as is.
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
  'warnings','[]'::jsonb,
  -- ADDITION (20260924180000): alterações de valores + avisos globais ao vivo
  -- (bounded 100, mais recentes primeiro; participant_warnings traz lote/
  -- carta/horário denormalizados e o estado do DM ao participante).
  'value_change_log',coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from (select id,participant_id,auction_id,previous_amount,new_amount,difference,external_event_id,occurred_at from public.value_change_log order by occurred_at desc,id desc limit 100) t),'[]'::jsonb),
  'participant_warnings',coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from (select id,participant_id,auction_id,card_name,lot_number,previous_amount,new_amount,external_event_id,occurred_at,notified_at from public.participant_warnings order by occurred_at desc,id desc limit 100) t),'[]'::jsonb)
 );
$body$;
revoke execute on function public.read_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.read_dashboard_snapshot() to service_role;

commit;
