begin;

-- Enforce the auction's minimum bid increment at the database boundary.
-- The API/UI already generate valid poll options, but PostgreSQL must also
-- reject a forged/stale command that tries to bid below the current highest
-- active bid + increment.
--
-- During BID_CHANGED the RPC marks the caller's previous bid as "replaced"
-- before this INSERT, so the increment is measured against other active bids.
-- A participant may therefore replace their own bid without having to beat
-- their previous amount.
create or replace function public.enforce_bid_increment()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  auction_row public.auctions;
  highest_other numeric;
  minimum_amount numeric;
begin
  -- Buyout is an explicit terminal price, not an incremental bid.
  if NEW.kind = 'buyout'::public.bid_kind then
    return NEW;
  end if;

  select *
    into auction_row
    from public.auctions
   where id = NEW.auction_id
   for update;

  if not found then
    raise exception 'auction_not_found';
  end if;

  if auction_row.status <> 'open' then
    raise exception 'auction_not_open';
  end if;

  select max(b.amount)
    into highest_other
    from public.bids b
   where b.auction_id = NEW.auction_id
     and b.status = 'active'
     and b.participant_id <> NEW.participant_id;

  minimum_amount := greatest(
    auction_row.starting_price,
    coalesce(highest_other + auction_row.bid_increment, auction_row.starting_price)
  );

  if NEW.amount < minimum_amount then
    raise exception 'bid_increment_required';
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_bid_increment on public.bids;
create trigger enforce_bid_increment
before insert on public.bids
for each row execute function public.enforce_bid_increment();

revoke execute on function public.enforce_bid_increment() from public, anon, authenticated;
grant execute on function public.enforce_bid_increment() to service_role;

commit;
