-- 2026-09-24: export_business_backup cobria 18 tabelas; as duas tabelas de
-- negócio criadas na mesma rodada (whatsapp_quick_polls, payment_reminders)
-- ficaram FORA — um backup que ignora tabelas novas não é um backup do
-- negócio. Este arquivo é uma migration SEPARADA (não um edit na 20260923120000)
-- porque a ordem lexical do CI aplica o backup ANTES das tabelas existirem e
-- funções LANGUAGE SQL validam as referências no CREATE.
--
-- Corpo copiado verbatim da 20260923120000 com APENAS as duas linhas novas.
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
  'whatsapp_quick_polls', coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,group_id,title,options,scheduled_at,sent_at,poll_message_id,external_event_id,created_by,created_at from public.whatsapp_quick_polls order by created_at desc,id desc limit 500) t),'[]'::jsonb),
  'payment_reminders',  coalesce((select jsonb_agg(t order by last_reminded_at desc nulls last) from (select purchase_id,participant_id,reminded_count,last_reminded_at,created_at from public.payment_reminders) t),'[]'::jsonb)
 );
$body$;
revoke execute on function public.export_business_backup() from public,anon,authenticated;
grant execute on function public.export_business_backup() to service_role;

commit;
