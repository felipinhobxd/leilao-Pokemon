begin;

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000092');
insert into public.admin_profiles(user_id,display_name)
values ('00000000-0000-0000-0000-000000000092','Cleanup retention test');

set local role service_role;

do $$
declare
  card jsonb;
  auction jsonb;
  result jsonb;
  aid uuid;
begin
  card := public.process_auction_command(
    jsonb_build_object(
      'type','CARD_CREATE',
      'eventId','cleanup-retention-card',
      'data',jsonb_build_object('name','Cleanup Retention Test','starting_price',5)
    ),
    '00000000-0000-0000-0000-000000000092'
  );
  auction := public.process_auction_command(
    jsonb_build_object(
      'type','AUCTION_CREATE',
      'eventId','cleanup-retention-auction',
      'data',jsonb_build_object('card_id',card->>'id')
    ),
    '00000000-0000-0000-0000-000000000092'
  );
  aid := (auction->>'id')::uuid;

  perform public.process_auction_command(
    jsonb_build_object('type','AUCTION_OPEN','eventId','cleanup-retention-open','auctionId',aid),
    '00000000-0000-0000-0000-000000000092'
  );
  perform public.process_auction_command(
    jsonb_build_object('type','AUCTION_FINALIZE','eventId','cleanup-retention-finalize','auctionId',aid),
    '00000000-0000-0000-0000-000000000092'
  );

  update public.auctions
     set ended_at=now()-interval '2 days',
         updated_at=now()-interval '2 days'
   where id=aid;

  result := public.cleanup_old_auctions(1);
  if (result->'deleted'->>'auctions')::int <> 0 then
    raise exception 'ASSERT_FAILED: p_days=1 deleted a 2-day-old auction';
  end if;

  if not exists(select 1 from public.auctions where id=aid) then
    raise exception 'ASSERT_FAILED: 2-day-old auction disappeared';
  end if;

  update public.auctions
     set ended_at=now()-interval '31 days',
         updated_at=now()-interval '31 days'
   where id=aid;

  result := public.cleanup_old_auctions(1);
  if (result->'deleted'->>'auctions')::int <> 1 then
    raise exception 'ASSERT_FAILED: 31-day-old auction was not cleaned';
  end if;
end $$;

reset role;
rollback;

select 'CLEANUP_RETENTION_OK' as result;
