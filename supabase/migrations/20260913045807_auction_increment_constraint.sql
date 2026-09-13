alter table public.auctions add constraint auctions_bid_increment_positive check(bid_increment>0 and bid_increment<=9999999999.99);
