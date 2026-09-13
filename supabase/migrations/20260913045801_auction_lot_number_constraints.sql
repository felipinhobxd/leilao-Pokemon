do $$ declare r record; begin
  for r in select id from public.auctions where lot_number is null order by created_at,id loop
    update public.auctions set lot_number=nextval('public.auction_lot_number_seq') where id=r.id;
  end loop;
end $$;
select setval('public.auction_lot_number_seq',greatest(coalesce((select max(lot_number) from public.auctions),0),1),coalesce((select max(lot_number) from public.auctions),0)>0);
alter table public.auctions alter column lot_number set default nextval('public.auction_lot_number_seq');
alter table public.auctions alter column lot_number set not null;
alter table public.auctions alter column bid_increment set not null;
create unique index if not exists auctions_lot_number_uidx on public.auctions(lot_number);
