begin;

insert into auth.users(id) values('00000000-0000-0000-0000-000000000051');
insert into public.admin_profiles(user_id,display_name,role,active)
values('00000000-0000-0000-0000-000000000051','Queue scale admin','admin',true);
insert into public.whatsapp_groups(id,group_jid,name,active)
values('00000000-0000-0000-0000-000000000052','120000000000000333@g.us','Fila até 200 cartas',true);

create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;

select pg_temp.check_that(
  has_function_privilege('service_role','public.create_auction_publish_queue(jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.create_auction_publish_queue(jsonb,uuid)','execute')
  and not has_function_privilege('authenticated','public.create_auction_publish_queue(jsonb,uuid)','execute'),
  'queue RPC stays service-role only'
);

set local role service_role;

do $$
declare
  items jsonb;
  result jsonb;
  qid uuid;
  payload jsonb;
  item_count integer;
  prior_queue_count bigint;
begin
  foreach item_count in array array[35,100,101,200,201] loop
  select jsonb_agg(
    jsonb_build_object(
      'card',jsonb_build_object(
        'name','Carta '||i,
        'collection','Teste '||item_count,
        'card_number',i||'/'||item_count,
        'variant','Normal',
        'condition','NM — Near Mint',
        'language','pt-BR'
      ),
      'auction',jsonb_build_object(
        'lot_number',item_count*1000+i,
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
  from generate_series(1,item_count) i;

  payload:=jsonb_build_object(
      'eventId','queue-scale-'||item_count,
      'queue',jsonb_build_object(
        'group_id','00000000-0000-0000-0000-000000000052',
        'starts_at',clock_timestamp()+interval '5 minutes',
        'interval_seconds',30
      ),
      'items',items
    );
  if item_count=201 then
    select count(*) into prior_queue_count from public.auction_publish_queues;
    begin
      perform public.create_auction_publish_queue(payload,'00000000-0000-0000-0000-000000000051');
      raise exception 'ASSERT: 201 items must be rejected';
    exception when raise_exception then
      if sqlerrm<>'invalid_queue_items' then raise; end if;
    end;
    perform pg_temp.check_that((select count(*)=prior_queue_count from public.auction_publish_queues),'201 items leave no queue');
    continue;
  end if;

  result:=public.create_auction_publish_queue(
    payload,
    '00000000-0000-0000-0000-000000000051'
  );
  qid:=(result->'queue'->>'id')::uuid;

  perform pg_temp.check_that(jsonb_array_length(result->'items')=item_count,'RPC returns all '||item_count||' items');
  perform pg_temp.check_that((select total_items=item_count from public.auction_publish_queues where id=qid),'queue stores all items');
  perform pg_temp.check_that((select count(*)=item_count from public.whatsapp_dispatches where queue_id=qid),'all dispatches persisted');
  perform pg_temp.check_that((select count(distinct queue_position)=item_count and min(queue_position)=1 and max(queue_position)=item_count from public.whatsapp_dispatches where queue_id=qid),'queue positions are complete and unique');
  perform pg_temp.check_that((select abs(extract(epoch from (max(scheduled_at)-min(scheduled_at)))-(item_count-1)*30)<0.01 from public.whatsapp_dispatches where queue_id=qid),'items keep exact 30 second spacing');
  perform pg_temp.check_that(public.create_auction_publish_queue(payload,'00000000-0000-0000-0000-000000000051')=result,'retry returns the same queue');
  perform pg_temp.check_that((select count(*)=item_count from public.whatsapp_dispatches where queue_id=qid),'retry does not duplicate dispatches');
  end loop;
end $$;

reset role;
rollback;
