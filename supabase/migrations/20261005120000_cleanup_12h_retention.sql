-- 2026-10-05: auction cleanup retention drops from 24 hours to 12 hours
-- (operator request). The parameter is now p_hours (floor: 1 hour) so a
-- sub-day retention is expressible; named callers must pass p_hours — the
-- bot was updated in the same change. Default: 12 hours.
-- This redefines the function wholesale: it supersedes 20260928165333
-- (30-day floor) and 20260929191637 (24h) whichever of them is applied.
begin;

create or replace function public.cleanup_old_auctions(p_hours integer default 12)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
 cutoff timestamptz:=clock_timestamp()-make_interval(hours=>greatest(coalesce(p_hours,12),1));
 card_ids uuid[];
 n_payments bigint:=0; n_deliveries bigint:=0; n_purchases bigint:=0; n_warnings bigint:=0; n_votes bigint:=0;
 n_dispatches bigint:=0; n_queues bigint:=0; n_events bigint:=0; n_bids bigint:=0; n_changes bigint:=0;
 n_auctions bigint:=0; n_cards bigint:=0; n_tmp bigint:=0;
begin
 execute 'drop trigger if exists immutable_audit on public.auction_events';
 with gone as (delete from public.payments pu using public.purchases z join public.auctions a on a.id=z.auction_id
   where pu.purchase_id=z.id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_payments from gone;
 with gone as (delete from public.deliveries dl using public.purchases z join public.auctions a on a.id=z.auction_id
   where dl.purchase_id=z.id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_deliveries from gone;
 with gone as (delete from public.purchases z using public.auctions a
   where a.id=z.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_purchases from gone;
 with gone as (delete from public.warnings w using public.auctions a
   where a.id=w.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_warnings from gone;
 with gone as (delete from public.whatsapp_vote_state v using public.auctions a
   where a.id=v.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_votes from gone;
 with gone as (delete from public.whatsapp_dispatches dd using public.auctions a
   where a.id=dd.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_dispatches from gone;
 with gone as (delete from public.whatsapp_dispatches dd using public.auction_publish_queues q
   where q.id=dd.queue_id and q.created_at<cutoff and q.status in ('completed','cancelled') returning 1)
 select coalesce((select count(*) from gone),0) into n_tmp;
 n_dispatches:=n_dispatches+n_tmp;
 with gone as (delete from public.auction_publish_queues q where q.created_at<cutoff and q.status in ('completed','cancelled') returning 1)
 select count(*) into n_queues from gone;
 with gone as (delete from public.auction_events e using public.auctions a
   where a.id=e.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_events from gone;
 with gone as (delete from public.bids b2 using public.auctions a
   where a.id=b2.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_bids from gone;
 with gone as (delete from public.value_change_log vc using public.auctions a
   where a.id=vc.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_changes from gone;
 with gone as (delete from public.auctions a where coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
 select count(*) into n_auctions from gone;
 with gone as (delete from public.cards c where not exists(select 1 from public.auctions a where a.card_id=c.id) returning 1)
 select count(*) into n_cards from gone;
 execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';
 return jsonb_build_object('cutoff',cutoff,'deleted',jsonb_build_object(
  'payments',n_payments,'deliveries',n_deliveries,'purchases',n_purchases,'warnings',n_warnings,
  'vote_state',n_votes,'dispatches',n_dispatches,'queues',n_queues,'events',n_events,'bids',n_bids,
  'value_changes',n_changes,'auctions',n_auctions,'cards',n_cards));
end
$function$;

revoke execute on function public.cleanup_old_auctions(integer) from public,anon,authenticated;
grant execute on function public.cleanup_old_auctions(integer) to service_role;

commit;
