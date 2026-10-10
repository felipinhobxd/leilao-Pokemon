-- 2026-10-10: keep the business backup within the already approved 7-day
-- retention window for high-volume audit/idempotency tables.
--
-- The previous backup RPC aggregated ~39k auction_events (including audit
-- rows already outside P-17 retention) into one JSON response. On the small
-- project compute this can stall the REST API and cause Cloudflare 520/521/522.
-- Rows older than 7 days are explicitly pruned by cleanup_old_auctions, so
-- exporting them first is redundant and prevents the first safe backup from
-- ever completing. Business tables remain fully exported.
--
-- created_at indexes serve both this filtered export and the P-17 prune.
begin;

create index if not exists auction_events_created_at_idx
  on public.auction_events (created_at);

create index if not exists processed_commands_created_at_idx
  on public.processed_commands (created_at);

create or replace function public.export_business_backup()
returns jsonb
language sql
stable
set search_path = ''
set statement_timeout = '55s'
set work_mem = '32MB'
as $function$
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
  'auction_events',     coalesce((select jsonb_agg(t order by id) from public.auction_events t where t.created_at >= now() - interval '7 days'),'[]'::jsonb),
  'processed_commands', coalesce((select jsonb_agg(t order by external_event_id) from public.processed_commands t where t.created_at >= now() - interval '7 days'),'[]'::jsonb),
  'whatsapp_groups',    coalesce((select jsonb_agg(t order by id) from public.whatsapp_groups t),'[]'::jsonb),
  'whatsapp_dispatches', coalesce((select jsonb_agg(t order by id) from public.whatsapp_dispatches t),'[]'::jsonb),
  'auction_publish_queues', coalesce((select jsonb_agg(t order by id) from public.auction_publish_queues t),'[]'::jsonb),
  'whatsapp_vote_state', coalesce((select jsonb_agg(t order by auction_id, voter_jid) from public.whatsapp_vote_state t),'[]'::jsonb),
  'whatsapp_quick_polls', coalesce((
    select jsonb_agg(t order by created_at desc,id desc)
    from (
      select id,group_id,queue_id,queue_position,title,options,image_url,scheduled_at,sent_at,poll_message_id,external_event_id,created_by,created_at
      from public.whatsapp_quick_polls
      order by created_at desc,id desc
      limit 500
    ) t
  ),'[]'::jsonb),
  'payment_reminders',  coalesce((select jsonb_agg(t order by last_reminded_at desc nulls last) from (select purchase_id,participant_id,reminded_count,last_reminded_at,created_at from public.payment_reminders) t),'[]'::jsonb),
  'auction_drafts',     coalesce((select jsonb_agg(t order by updated_at desc) from (select id,title,payload,created_by,created_at,updated_at from public.auction_drafts order by updated_at desc limit 50) t),'[]'::jsonb)
 );
$function$;

commit;
