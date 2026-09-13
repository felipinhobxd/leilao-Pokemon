begin;

insert into auth.users(id) values('00000000-0000-0000-0000-000000000041');
insert into public.admin_profiles(user_id,display_name,role,active)
values('00000000-0000-0000-0000-000000000041','Queue runtime admin','admin',true);
insert into public.whatsapp_groups(id,group_jid,name,active)
values('00000000-0000-0000-0000-000000000042','120000000000000222@g.us','Fila runtime',true);

create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;

set local role service_role;

do $$
declare
  result jsonb;
  qid uuid;
  did uuid;
  aid uuid;
  sent_at timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  result:=public.create_auction_publish_queue(
    jsonb_build_object(
      'eventId','queue-runtime-test',
      'queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000042','starts_at',clock_timestamp()+interval '1 minute','interval_seconds',30),
      'items',jsonb_build_array(jsonb_build_object(
        'card',jsonb_build_object('name','Runtime test','condition','NM — Near Mint','language','pt-BR'),
        'auction',jsonb_build_object(
          'lot_number',601,'starting_price',5,'bid_increment',1,'buyout_price',12,'duration_seconds',120,
          'poll_options',jsonb_build_array(
            jsonb_build_object('label','R$ 5,00','amount',5,'isBuyout',false),
            jsonb_build_object('label','R$ 12,00 🦭','amount',12,'isBuyout',true)
          )
        )
      ))
    ),
    '00000000-0000-0000-0000-000000000041'
  );
  qid:=(result->'queue'->>'id')::uuid;
  did:=(result->'items'->0->'dispatch'->>'id')::uuid;
  aid:=(result->'items'->0->'auction'->>'id')::uuid;

  update public.whatsapp_dispatches set poll_sent_at=sent_at where id=did;
  perform pg_temp.check_that(
    (select abs(extract(epoch from (scheduled_end_at-sent_at))-120)<0.01 from public.auctions where id=aid),
    'auction deadline must be publication time plus duration'
  );

  update public.whatsapp_dispatches set status='failed',attempts=5 where id=did;
  perform pg_temp.check_that((select status='completed' from public.auction_publish_queues where id=qid),'terminal failure must not keep queue running forever');
end $$;

reset role;
rollback;
