begin;

create or replace function public.read_dashboard_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
      select id,card_id,status,starting_price,bid_increment,buyout_price,scheduled_end_at,winner_participant_id,final_price,lot_number,created_at
      from public.auctions
    ) x
  ),'[]'::jsonb),
  'bids',coalesce((
    select jsonb_agg(x order by processed_at desc)
    from (
      select id,auction_id,participant_id,amount,status,processed_at,confirmation_order
      from public.bids
    ) x
  ),'[]'::jsonb),
  'auction_events',coalesce((
    select jsonb_agg(x order by created_at desc)
    from (
      select id,auction_id,participant_id,event_type,created_at
      from public.auction_events
      order by created_at desc
      limit 80
    ) x
  ),'[]'::jsonb),
  'purchases',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,card_id,participant_id,amount,status
      from public.purchases
    ) x
  ),'[]'::jsonb),
  'payments','[]'::jsonb,
  'deliveries','[]'::jsonb,
  'warnings','[]'::jsonb
 );
$$;

revoke execute on function public.read_dashboard_snapshot() from public, anon, authenticated;
grant execute on function public.read_dashboard_snapshot() to service_role;

commit;
