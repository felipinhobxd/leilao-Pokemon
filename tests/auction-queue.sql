begin;

insert into auth.users(id) values('00000000-0000-0000-0000-000000000031');
insert into public.admin_profiles(user_id,display_name,role,active)
values('00000000-0000-0000-0000-000000000031','Queue admin','admin',true);
insert into public.whatsapp_groups(id,group_jid,name,active)
values('00000000-0000-0000-0000-000000000032','120000000000000111@g.us','Fila teste',true);

create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;

set local role service_role;

do $$
declare
  payload jsonb;
  first_result jsonb;
  replay_result jsonb;
  qid uuid;
  first_dispatch uuid;
  claimed integer;
begin
  payload:=jsonb_build_object(
    'eventId','queue-test-1',
    'queue',jsonb_build_object(
      'group_id','00000000-0000-0000-0000-000000000032',
      'starts_at',clock_timestamp()-interval '1 second',
      'interval_seconds',30
    ),
    'items',jsonb_build_array(
      jsonb_build_object(
        'card',jsonb_build_object('name','Charizard','collection','151','card_number','1/100','variant','Holo','condition','NM — Near Mint','language','pt-BR'),
        'auction',jsonb_build_object('lot_number',501,'starting_price',5,'bid_increment',1,'buyout_price',12,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','R$ 5,00','amount',5,'isBuyout',false),jsonb_build_object('label','R$ 12,00 🦭','amount',12,'isBuyout',true)))
      ),
      jsonb_build_object(
        'card',jsonb_build_object('name','Pikachu','collection','151','card_number','2/100','variant','Normal','condition','NM — Near Mint','language','pt-BR'),
        'auction',jsonb_build_object('lot_number',502,'starting_price',5,'bid_increment',1,'buyout_price',15,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','R$ 5,00','amount',5,'isBuyout',false),jsonb_build_object('label','R$ 15,00 🦭','amount',15,'isBuyout',true)))
      ),
      jsonb_build_object(
        'card',jsonb_build_object('name','Mew','collection','151','card_number','3/100','variant','Normal','condition','NM — Near Mint','language','pt-BR'),
        'auction',jsonb_build_object('lot_number',503,'starting_price',10,'bid_increment',5,'buyout_price',null,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','R$ 10,00','amount',10,'isBuyout',false),jsonb_build_object('label','R$ 15,00','amount',15,'isBuyout',false)))
      )
    )
  );

  first_result:=public.create_auction_publish_queue(payload,'00000000-0000-0000-0000-000000000031');
  replay_result:=public.create_auction_publish_queue(payload,'00000000-0000-0000-0000-000000000031');
  qid:=(first_result->'queue'->>'id')::uuid;

  perform pg_temp.check_that(first_result=replay_result,'queue creation must be idempotent');
  perform pg_temp.check_that((select count(*)=1 from public.auction_publish_queues where id=qid),'one queue created');
  perform pg_temp.check_that((select count(*)=3 from public.whatsapp_dispatches where queue_id=qid),'three dispatches created');
  perform pg_temp.check_that((select count(*)=3 from public.auctions where lot_number between 501 and 503),'three auctions created');
  perform pg_temp.check_that((select count(*)=3 from public.cards where name in('Charizard','Pikachu','Mew')),'three cards created');
  perform pg_temp.check_that((select extract(epoch from (max(scheduled_at)-min(scheduled_at)))=60 from public.whatsapp_dispatches where queue_id=qid),'30 second publication spacing');
  perform pg_temp.check_that((select bool_and(abs(extract(epoch from (a.scheduled_end_at-d.scheduled_at))-120)<0.01) from public.whatsapp_dispatches d join public.auctions a on a.id=d.auction_id where d.queue_id=qid),'duration is independent from publication interval');

  perform public.control_auction_publish_queue(qid,'pause','00000000-0000-0000-0000-000000000031');
  select count(*) into claimed from public.claim_whatsapp_dispatch('ci-worker');
  perform pg_temp.check_that(claimed=0,'paused queue cannot be claimed');

  perform public.control_auction_publish_queue(qid,'resume','00000000-0000-0000-0000-000000000031');
  select count(*) into claimed from public.claim_whatsapp_dispatch('ci-worker');
  perform pg_temp.check_that(claimed=1,'resumed queue claims exactly one due item');
  select id into first_dispatch from public.whatsapp_dispatches where queue_id=qid and status='sending' limit 1;
  update public.whatsapp_dispatches set status='sent',sent_at=clock_timestamp(),locked_at=null,locked_by=null where id=first_dispatch;

  perform public.control_auction_publish_queue(qid,'cancel','00000000-0000-0000-0000-000000000031');
  perform pg_temp.check_that((select status='cancelled' from public.auction_publish_queues where id=qid),'queue cancelled');
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_dispatches where queue_id=qid and status='sent'),'already published item is preserved');
  perform pg_temp.check_that((select count(*)=2 from public.whatsapp_dispatches where queue_id=qid and status='cancelled'),'unpublished items cancelled');
end $$;

reset role;
rollback;
