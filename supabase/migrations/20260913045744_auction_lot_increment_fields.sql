alter table public.auctions add column if not exists lot_number bigint;
alter table public.auctions add column if not exists bid_increment numeric(12,2);
update public.auctions set bid_increment=1.00 where bid_increment is null;
alter table public.auctions alter column bid_increment set default 1.00;
