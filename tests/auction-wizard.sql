begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000011');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000011','Wizard admin');
insert into public.whatsapp_groups(id,group_jid,name,active,is_default)
values('11111111-1111-1111-1111-111111111111','120000000000000000@g.us','Grupo teste',true,true);
create function pg_temp.check_that(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
set local role service_role;
do $$
declare payload jsonb; result jsonb; replay jsonb; aid uuid; cards_before bigint; auctions_before bigint; dispatches_before bigint; begin
 payload:=jsonb_build_object(
  'eventId','wizard-1',
  'card',jsonb_build_object('name','Kubfu','collection','Coleção X','card_number','093/198','variant','Normal','condition','NM — Near Mint','language','pt-BR','image_url','https://example.com/kubfu.jpg'),
  'auction',jsonb_build_object('lot_number',16,'starting_price',8,'bid_increment',1,'buyout_price',12,'scheduled_at',clock_timestamp()+interval '5 minutes','scheduled_end_at',clock_timestamp()+interval '65 minutes','group_id','11111111-1111-1111-1111-111111111111','poll_options',jsonb_build_array(jsonb_build_object('label','R$ 8,00','amount',8,'isBuyout',false),jsonb_build_object('label','R$ 9,00','amount',9,'isBuyout',false),jsonb_build_object('label','R$ 12,00 🦭','amount',12,'isBuyout',true)))
 );
 result:=public.create_auction_wizard(payload,'00000000-0000-0000-0000-000000000011');
 replay:=public.create_auction_wizard(payload,'00000000-0000-0000-0000-000000000011');
 aid:=(result->'auction'->>'id')::uuid;
 perform pg_temp.check_that(result=replay,'wizard request is idempotent');
 perform pg_temp.check_that((select lot_number=16 and bid_increment=1 from public.auctions where id=aid),'lot and increment persisted');
 perform pg_temp.check_that((select card_number='093/198' and variant='Normal' from public.cards where id=(result->'card'->>'id')::uuid),'card metadata persisted');
 perform pg_temp.check_that((select poll_title='16. Lances' and group_id='11111111-1111-1111-1111-111111111111'::uuid from public.whatsapp_dispatches where auction_id=aid),'dispatch uses selected group');
 begin
  perform public.create_auction_wizard(payload||jsonb_build_object('eventId','wizard-2'),'00000000-0000-0000-0000-000000000011');
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
 exception when others then
  if sqlerrm<>'lot_number_in_use' then raise; end if;
 end;
 select count(*) into cards_before from public.cards;
 select count(*) into auctions_before from public.auctions;
 select count(*) into dispatches_before from public.whatsapp_dispatches;
 begin
  perform public.create_auction_wizard(
    jsonb_set(jsonb_set(payload,'{eventId}','"wizard-invalid-group"'::jsonb),'{auction,lot_number}','17'::jsonb),
    '00000000-0000-0000-0000-000000000011'
  ) #- '{auction,group_id}' || jsonb_build_object('auction',(payload->'auction')||jsonb_build_object('lot_number',17,'group_id','22222222-2222-2222-2222-222222222222')),
    '00000000-0000-0000-0000-000000000011'
  );
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
 exception when others then
  if sqlerrm<>'whatsapp_group_unavailable' then raise; end if;
 end;
 perform pg_temp.check_that((select count(*) from public.cards)=cards_before,'failed wizard leaves no card');
 perform pg_temp.check_that((select count(*) from public.auctions)=auctions_before,'failed wizard leaves no auction');
 perform pg_temp.check_that((select count(*) from public.whatsapp_dispatches)=dispatches_before,'failed wizard leaves no dispatch');
end $$;
reset role;
rollback;
