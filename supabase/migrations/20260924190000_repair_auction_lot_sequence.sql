-- 2026-09-24: repair auction lot sequence drift found in production.
-- The auctions table currently contains lots above the sequence last_value.
-- Keep the next generated lot strictly above the current maximum.
begin;

do $$
declare
  v_max_lot bigint;
begin
  select max(lot_number) into v_max_lot from public.auctions;

  if v_max_lot is null then
    perform setval('public.auction_lot_number_seq', 1, false);
  else
    perform setval('public.auction_lot_number_seq', v_max_lot, true);
  end if;
end $$;

commit;
