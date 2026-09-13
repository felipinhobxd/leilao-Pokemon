-- Dashboard projection; full audit/export RPC remains unchanged.
create or replace function public.read_dashboard_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $body$
 select jsonb_build_object(
  'cards',coalesce((select jsonb_agg(t order by id) from public.cards t),'[]'::jsonb),
  'participants',coalesce((select jsonb_agg(t order by id) from public.participants t),'[]'::jsonb),
  'auctions',coalesce((select jsonb_agg(t order by id) from public.auctions t),'[]'::jsonb),
  'bids',coalesce((select jsonb_agg(t order by id) from public.bids t),'[]'::jsonb),
  'auction_events',coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,created_at,event_type,participant_id from public.auction_events order by created_at desc,id desc limit 15) t),'[]'::jsonb),
  'purchases',coalesce((select jsonb_agg(t order by id) from public.purchases t),'[]'::jsonb),
  'payments','[]'::jsonb,
  'deliveries','[]'::jsonb,
  'warnings','[]'::jsonb
 );
$body$;
revoke execute on function public.read_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.read_dashboard_snapshot() to service_role;
