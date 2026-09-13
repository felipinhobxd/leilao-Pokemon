begin;

insert into auth.users(id) values('00000000-0000-0000-0000-000000000051');
insert into public.admin_profiles(user_id,display_name,role,active)
values('00000000-0000-0000-0000-000000000051','Queue scale admin','admin',true);
insert into public.whatsapp_groups(id,group_jid,name,active)
values('00000000-0000-0000-0000-000000000052','120000000000000333@g.us','Fila 35 cartas',true);

create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;

set local role service_role;

do $$
declare
  items jsonb;
  result jsonb;
  qid uuid;
begin
  select jsonb_agg(
    jsonb_build_object(
      'card',jsonb_build_object(
        'name','Carta '||i,
        'collection','Teste 35',
        'card_number',i||'/35',
        'variant','Normal',
        'condition','NM — Near Mint',
        'language','pt-BR'
      ),
      'auction',jsonb_build_object(
        'lot_number',700+i,
        'starting_price',5,
        'bid_increment',1,
        'buyout_price',12,
        'duration_seconds',120,
        'poll_options',jsonb_build_array(
          jsonb_build_object('label','R$ 5,00','amount',5,'isBuyout',false),
          jsonb_build_object('label','R$ 12,00 🦭','amount',12,'isBuyout',true)
        )
      )
    ) order by i
  ) into items
  from generate_series(1,35) i;

  result:=public.create_auction_publish_queue(
    jsonb_build_object(
      'eventId','queue-scale-35',
      'queue',jsonb_build_object(
        'group_id','00000000-0000-0000-0000-000000000052',
        'starts_at',clock_timestamp()+interval '5 minutes',
        'interval_seconds',30
      ),
      'items',items
    ),
    '00000000-0000-0000-0000-000000000051'
  );
  qid:=(result->'queue'->>'id')::uuid;

  perform pg_temp.check_that(jsonb_array_length(result->'items')=35,'RPC returns all 35 items');
  perform pg_temp.check_that((select total_items=35 from public.auction_publish_queues where id=qid),'queue stores 35 items');
  perform pg_temp.check_that((select count(*)=35 from public.whatsapp_dispatches where queue_id=qid),'35 dispatches persisted');
  perform pg_temp.check_that((select count(distinct queue_position)=35 from public.whatsapp_dispatches where queue_id=qid),'all queue positions are unique');
  perform pg_temp.check_that((select abs(extract(epoch from (max(scheduled_at)-min(scheduled_at)))-1020)<0.01 from public.whatsapp_dispatches where queue_id=qid),'35 items keep exact 30 second spacing');
end $$;

reset role;
rollback;
