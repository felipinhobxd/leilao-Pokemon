-- 2026-09-24: keep the business backup aligned with the giveaway-in-queue
-- fields introduced by 20260924160000_giveaway_queue_items.
-- This is a separate, forward-only migration so the backup includes the
-- giveaway image + queue position metadata.
begin;

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
$body$;

revoke execute on function public.export_business_backup() from public,anon,authenticated;
grant execute on function public.export_business_backup() to service_role;

commit;
