begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000001');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000001','Test admin');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000001') $$;
create function pg_temp.rejects(c jsonb, expected text) returns void language plpgsql as $$
begin
 perform pg_temp.cmd(c);
 raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
 if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare card jsonb; p1 jsonb; p2 jsonb; a jsonb; a2 jsonb; r jsonb; cmd jsonb; count_before int;
begin
 card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"card1","data":{"name":"Pikachu","starting_price":10,"buyout_price":100}}');
 p1:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"p1","data":{"display_name":"Ana","whatsapp_id":"ana","status":"active"}}');
 p2:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"p2","data":{"display_name":"Bia","whatsapp_id":"bia","status":"active"}}');
 a:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','a1','data',jsonb_build_object('card_id',card->>'id')));
 perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','open1','auctionId',a->>'id'));
 cmd:=jsonb_build_object('type','BID_PLACED','eventId','b1','auctionId',a->>'id','participantId',p1->>'id','amount',20);
 r:=pg_temp.cmd(cmd);
 perform pg_temp.check_that(pg_temp.cmd(cmd)=r,'duplicate bid result');
 perform pg_temp.rejects(cmd||'{"amount":30}', 'event_id_conflict');
 perform pg_temp.rejects(cmd||'{"eventId":"below","amount":5}', 'active_bid_exists');
 perform pg_temp.rejects(cmd||jsonb_build_object('eventId','below2','participantId',p2->>'id','amount',5),'invalid_bid_amount');
 perform pg_temp.cmd(cmd||jsonb_build_object('eventId','b2','participantId',p2->>'id','amount',21));
 perform pg_temp.rejects(
   jsonb_build_object('type','BID_CHANGED','eventId','below_increment','auctionId',a->>'id','participantId',p1->>'id','amount',21),
   'bid_increment_required'
 );
 perform pg_temp.cmd(
   jsonb_build_object('type','BID_CHANGED','eventId','increment_ok','auctionId',a->>'id','participantId',p2->>'id','amount',22)
 );
 perform pg_temp.check_that((select count(*)=2 from public.bids where auction_id=(a->>'id')::uuid and status='active'),'two active bids');
 perform pg_temp.cmd(cmd||'{"type":"BID_CHANGED","eventId":"change","amount":25}');
 perform pg_temp.check_that((select count(*)=1 from public.bids where participant_id=(p1->>'id')::uuid and status='active'),'one active after change');
 perform pg_temp.check_that((select count(*)=1 from public.bids where participant_id=(p1->>'id')::uuid and status='replaced' and replaced_by is not null),'replacement history');
 perform pg_temp.rejects(cmd||jsonb_build_object('type','BID_CHANGED','eventId','stale','occurredAt','2000-01-01T00:00:00Z'),'stale_event');
 perform pg_temp.cmd(cmd||'{"type":"BID_WITHDRAWN","eventId":"withdraw"}');
 perform pg_temp.check_that((select count(*)=1 from public.bids where participant_id=(p1->>'id')::uuid and status='withdrawn'),'withdrawal retained');
 perform pg_temp.cmd(cmd||jsonb_build_object('eventId','b3','amount',23));
 r:=pg_temp.cmd(jsonb_build_object('type','AUCTION_FINALIZE','eventId','final1','auctionId',a->>'id'));
 perform pg_temp.check_that(r->'auction'->>'winner_participant_id'=p1->>'id','highest valid remaining bid wins');
 perform pg_temp.check_that((select count(*)=1 from public.purchases),'one purchase');
 perform pg_temp.check_that(pg_temp.cmd(cmd)->'bid'->>'id' is not null,'duplicate accepted after close');
 perform pg_temp.rejects(cmd||'{"type":"BID_WITHDRAWN","eventId":"late"}','auction_not_open');
 perform pg_temp.rejects(cmd||'{"type":"BUYOUT_CONFIRMED","eventId":"late-buyout"}','auction_not_open');

 -- Database-level guard: the UI/API cannot be the final authority for the
 -- increment. Use an isolated auction with increment R$ 5,00 and prove that
 -- R$ 24,00 is rejected after a R$ 20,00 bid while R$ 25,00 is accepted.
 card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"card-increment","data":{"name":"Gengar","starting_price":10,"buyout_price":100}}');
 a2:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','a-increment','data',jsonb_build_object('card_id',card->>'id')));
 update public.auctions set bid_increment=5 where id=(a2->>'id')::uuid;
 perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','open-increment','auctionId',a2->>'id'));
 perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','increment-b1','auctionId',a2->>'id','participantId',p1->>'id','amount',20));
 perform pg_temp.rejects(
   jsonb_build_object('type','BID_PLACED','eventId','increment-bad','auctionId',a2->>'id','participantId',p2->>'id','amount',24),
   'bid_increment_required'
 );
 perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','increment-ok','auctionId',a2->>'id','participantId',p2->>'id','amount',25));

 card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"card2","data":{"name":"Eevee","starting_price":10,"buyout_price":100}}');
 a2:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','a2','data',jsonb_build_object('card_id',card->>'id')));
 perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','open2','auctionId',a2->>'id'));
 cmd:=jsonb_build_object('type','BUYOUT_REQUESTED','eventId','request2','auctionId',a2->>'id','participantId',p1->>'id');
 perform pg_temp.cmd(cmd);
 perform pg_temp.check_that((select status='open' from public.auctions where id=(a2->>'id')::uuid),'request is not confirmation');
 cmd:=cmd||'{"type":"BUYOUT_CONFIRMED","eventId":"buyout2"}';
 r:=pg_temp.cmd(cmd);
 perform pg_temp.check_that(pg_temp.cmd(cmd)=r,'buyout replay returns same purchase');
 perform pg_temp.rejects(cmd||jsonb_build_object('eventId','second-buyout','participantId',p2->>'id'),'auction_not_open');
 perform pg_temp.rejects(cmd||'{"type":"BID_WITHDRAWN","eventId":"undo-buyout"}','auction_not_open');
 perform pg_temp.check_that((select count(*)=1 from public.purchases where auction_id=(a2->>'id')::uuid),'buyout has one purchase');
 perform pg_temp.check_that((select count(*)=1 from public.deliveries where purchase_id=(r->>'purchase_id')::uuid),'delivery created');
 -- Suspended participants are excluded both at bid time and finalization.
 card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"card3","data":{"name":"Mew","starting_price":1,"buyout_price":10}}');
 a:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','a3','data',jsonb_build_object('card_id',card->>'id')));
 perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','open3','auctionId',a->>'id'));
 cmd:=jsonb_build_object('type','BID_PLACED','eventId','b4','auctionId',a->>'id','participantId',p1->>'id','amount',5);
 perform pg_temp.cmd(cmd);
 perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_UPDATE','eventId','suspend','id',p1->>'id','data',jsonb_build_object('display_name','Ana','whatsapp_id','ana','status','suspended')));
 perform pg_temp.rejects(cmd||'{"type":"BID_CHANGED","eventId":"suspended"}','participant_not_eligible');
 r:=pg_temp.cmd(jsonb_build_object('type','AUCTION_FINALIZE','eventId','final3','auctionId',a->>'id'));
 perform pg_temp.check_that(r->'auction'->>'status'='closed','no eligible bid closes without purchase');
 begin update public.auction_events set event_type='tamper'; raise exception 'audit_mutable'; exception when others then if sqlerrm<>'audit_is_append_only' then raise; end if; end;
 perform pg_temp.check_that(jsonb_array_length(public.read_auction_snapshot()->'purchases')=2,'real snapshot');
end $$;
reset role;
-- Browser readers: active staff only; never direct writes / privileged RPCs.
set local role authenticated;
select pg_temp.check_that((select count(*)=0 from public.cards),'non-staff cannot read');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.check_that((select count(*)=4 from public.cards),'staff can read');
select pg_temp.check_that(not has_table_privilege(current_user,'public.cards','INSERT'),'browser cannot write');
select pg_temp.check_that(not has_function_privilege(current_user,'public.process_auction_command(jsonb,uuid)','EXECUTE'),'browser cannot call privileged command');
reset role;
select pg_temp.check_that(not has_function_privilege('service_role','public.confirm_auction_buyout(uuid,uuid,text,timestamptz)','EXECUTE'),'legacy RPC disabled');
rollback;
