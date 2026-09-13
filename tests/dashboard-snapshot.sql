begin;

create function pg_temp.check_that(ok boolean, message text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERT: %', message; end if;
end
$$;

set local role service_role;

do $$
declare
  payload jsonb;
  old_payload jsonb;
begin
  payload := public.read_dashboard_snapshot();
  old_payload := public.read_auction_snapshot();

  perform pg_temp.check_that(payload ? 'cards', 'dashboard snapshot has cards');
  perform pg_temp.check_that(payload ? 'participants', 'dashboard snapshot has participants');
  perform pg_temp.check_that(payload ? 'auctions', 'dashboard snapshot has auctions');
  perform pg_temp.check_that(payload ? 'bids', 'dashboard snapshot has bids');
  perform pg_temp.check_that(payload ? 'auction_events', 'dashboard snapshot has events');
  perform pg_temp.check_that(payload ? 'purchases', 'dashboard snapshot has purchases');
  perform pg_temp.check_that(jsonb_array_length(payload->'auction_events') <= 80, 'events are capped');
  perform pg_temp.check_that(jsonb_typeof(payload->'payments') = 'array', 'payments compatibility key exists');
  perform pg_temp.check_that(jsonb_typeof(payload->'deliveries') = 'array', 'deliveries compatibility key exists');
  perform pg_temp.check_that(jsonb_typeof(payload->'warnings') = 'array', 'warnings compatibility key exists');
  perform pg_temp.check_that(octet_length(payload::text) <= octet_length(old_payload::text), 'optimized snapshot is not larger than legacy snapshot');
end $$;

reset role;
rollback;
