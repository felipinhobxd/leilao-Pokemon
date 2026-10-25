-- Disposable database only. Never run this file against production.
begin;
insert into auth.users(id) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from generate_series(81,84) i;
insert into public.admin_profiles(user_id,display_name,role,active) values
('00000000-0000-0000-0000-000000000081','Bulk admin','admin',true),
('00000000-0000-0000-0000-000000000082','Bulk operator','operator',true),
('00000000-0000-0000-0000-000000000083','Bulk viewer','viewer',true),
('00000000-0000-0000-0000-000000000084','Inactive admin','admin',false);
insert into public.whatsapp_groups(id,group_jid,name,active)
values('00000000-0000-0000-0000-000000000085','120000000000000885@g.us','Bulk deletion test',true);
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000081') $$;
create function pg_temp.rejects_bulk(c1 text,c2 text,actor uuid,expected text) returns void language plpgsql as $$
begin
  perform public.delete_completed_auctions(gen_random_uuid(),c1,c2,actor);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
-- Fail after deletion starts, proving that the entire batch and audit-trigger
-- changes roll back together when any item fails.
create function pg_temp.fail_bulk() returns trigger language plpgsql as $$
begin
  if current_setting('app.test_fail_bulk',true)='yes' then raise exception 'test_bulk_failure'; end if;
  return old;
end $$;
create trigger test_fail_bulk before delete on public.auctions for each row execute function pg_temp.fail_bulk();

select pg_temp.check_that(
  has_function_privilege('service_role','public.delete_completed_auctions(uuid,text,text,uuid)','execute')
  and not has_function_privilege('anon','public.delete_completed_auctions(uuid,text,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.delete_completed_auctions(uuid,text,text,uuid)','execute'),
  'bulk deletion stays service-role only');
set local role service_role;
do $$
declare
  admin_id uuid := '00000000-0000-0000-0000-000000000081';
  event_id uuid := gen_random_uuid();
  c jsonb; a jsonb; p jsonb; q jsonb; result jsonb; again jsonb;
  shared_card uuid; target_queue_id uuid; keep_id uuid; expected_count bigint; before_events bigint;
begin
  -- More than the 500 auctions shown by read_dashboard_snapshot, all new:
  -- manual deletion has no retention-age cutoff or front-end pagination cap.
  with added as (insert into public.cards(name,starting_price)
    select 'Bulk closed '||i,5 from generate_series(1,501) i returning id)
  insert into public.auctions(card_id,status,starting_price)
    select id,'closed',5 from added;
  insert into public.cards(name,starting_price) values('Shared with active',5) returning id into shared_card;
  insert into public.auctions(card_id,status,starting_price) values(shared_card,'open',5),(shared_card,'cancelled',5);
  with added as (insert into public.cards(name,starting_price) values('Needs review',5) returning id)
  insert into public.auctions(card_id,status,starting_price) select id,'review_required',5 from added;
  with added as (insert into public.cards(name,starting_price) values('Draft to keep',5) returning id)
  insert into public.auctions(card_id,status,starting_price) select id,'draft',5 from added returning id into keep_id;

  -- A genuine sold auction with bids, warning, unpaid purchase and delivery.
  c:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"bulk-card","data":{"name":"Bulk sale","starting_price":5,"buyout_price":50}}');
  a:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','bulk-auction','data',jsonb_build_object('card_id',c->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','bulk-open','auctionId',a->>'id'));
  p:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"bulk-participant","data":{"display_name":"Bulk participant","whatsapp_id":"bulk-test","status":"active"}}');
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','bulk-bid','auctionId',a->>'id','participantId',p->>'id','amount',10));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','bulk-reduction','auctionId',a->>'id','participantId',p->>'id','amount',6));
  perform pg_temp.cmd(jsonb_build_object('type','BUYOUT_CONFIRMED','eventId','bulk-buy','auctionId',a->>'id','participantId',p->>'id'));

  q:=public.create_auction_publish_queue(jsonb_build_object('eventId','bulk-mixed-queue',
    'queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000085','starts_at',clock_timestamp()+interval '1 day','interval_seconds',30),
    'items',jsonb_build_array(
      jsonb_build_object('card',jsonb_build_object('name','Queued terminal'), 'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','R$5','amount',5)))),
      jsonb_build_object('card',jsonb_build_object('name','Queued future'), 'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','R$5','amount',5))))
    )),admin_id);
  target_queue_id:=(q->'queue'->>'id')::uuid;
  update public.auctions set status='cancelled' where id=(q->'items'->0->'auction'->>'id')::uuid;
  select count(*) into expected_count from public.auctions where status in('sold','closed','cancelled');
  perform pg_temp.check_that(expected_count>500,'fixture exceeds dashboard cap');

  perform pg_temp.rejects_bulk('','quero excluir os encerrados',admin_id,'delete_not_confirmed');
  perform pg_temp.rejects_bulk('excluir leilões encerrados','',admin_id,'delete_not_confirmed');
  perform pg_temp.rejects_bulk('excluir leilões encerrados','quero excluir mesmo',admin_id,'delete_not_confirmed');
  perform pg_temp.rejects_bulk('excluir leilões encerrados','quero excluir os encerrados','00000000-0000-0000-0000-000000000082','forbidden');
  perform pg_temp.rejects_bulk('excluir leilões encerrados','quero excluir os encerrados','00000000-0000-0000-0000-000000000083','forbidden');
  perform pg_temp.rejects_bulk('excluir leilões encerrados','quero excluir os encerrados','00000000-0000-0000-0000-000000000084','forbidden');

  perform set_config('app.test_fail_bulk','yes',true);
  perform pg_temp.rejects_bulk('excluir leilões encerrados','quero excluir os encerrados',admin_id,'test_bulk_failure');
  perform set_config('app.test_fail_bulk','no',true);
  perform pg_temp.check_that((select count(*)=expected_count from public.auctions where status in('sold','closed','cancelled')),'failure rolls back entire batch');

  result:=public.delete_completed_auctions(event_id,'excluir leilões encerrados','quero excluir os encerrados',admin_id);
  perform pg_temp.check_that((result->>'deleted_auctions')::bigint=expected_count-1 and (result->>'preserved_financial_auctions')::int=1,'financial sale skipped while other terminal auctions deleted');
  perform pg_temp.check_that((select count(*)=1 from public.auctions where status in('sold','closed','cancelled')),'financial terminal auction remains');
  perform pg_temp.check_that((select count(*)=5 from public.auctions),'open, review, draft and scheduled draft survive');
  perform pg_temp.check_that(exists(select 1 from public.cards where id=shared_card),'shared active card survives');
  perform pg_temp.check_that(not exists(select 1 from public.cards where name like 'Bulk closed %' ),'orphan cards deleted');
  perform pg_temp.check_that((select total_items=1 from public.auction_publish_queues where id=target_queue_id),'mixed queue reconciled');
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_dispatches where queue_id=target_queue_id),'pending dispatch kept');
  perform pg_temp.check_that(exists(select 1 from public.purchases where auction_id=(a->>'id')::uuid),'unpaid purchase preserved');
  perform pg_temp.check_that(exists(select 1 from public.bids where auction_id=(a->>'id')::uuid),'financial bids preserved');
  perform pg_temp.check_that((select count(*)=1 and bool_and(auction_id is not null) from public.participant_warnings where participant_id=(p->>'id')::uuid),'global warnings preserved');
  perform pg_temp.check_that(exists(select 1 from public.participants where id=(p->>'id')::uuid),'participant preserved');
  perform pg_temp.check_that((select count(*)=1 from public.auction_events where event_type='COMPLETED_AUCTIONS_DELETED'),'one summary audit event');
  select count(*) into before_events from public.auction_events where event_type='COMPLETED_AUCTIONS_DELETED';

  -- Lost response/retry must NOT erase auctions that closed after first call.
  update public.auctions set status='closed' where id=keep_id;
  again:=public.delete_completed_auctions(event_id,'excluir leilões encerrados','quero excluir os encerrados',admin_id);
  perform pg_temp.check_that(again=result and exists(select 1 from public.auctions where id=keep_id),'retry returns original result and keeps newly closed auction');
  perform pg_temp.check_that((select count(*)=before_events from public.auction_events where event_type='COMPLETED_AUCTIONS_DELETED'),'retry creates no duplicate audit');
  perform public.delete_completed_auctions(gen_random_uuid(),'excluir leilões encerrados','quero excluir os encerrados',admin_id);
  result:=public.delete_completed_auctions(gen_random_uuid(),'excluir leilões encerrados','quero excluir os encerrados',admin_id);
  perform pg_temp.check_that((result->>'deleted_auctions')::int=0,'empty selection succeeds with zero');
  begin
    delete from public.auction_events where event_type='COMPLETED_AUCTIONS_DELETED';
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then
    if sqlerrm='EXPECTED_ERROR_NOT_RAISED' then raise exception 'audit trigger not restored'; end if;
  end;
end $$;
reset role;
rollback;
