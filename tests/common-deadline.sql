begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000091');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000091','Common deadline admin');
insert into public.whatsapp_groups(id,group_jid,name,active) values('00000000-0000-0000-0000-000000000092','120000000000000992@g.us','Common deadline group',true);
create function pg_temp.check_that(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
set local role service_role;
do $$
declare payload jsonb; result jsonb; items jsonb; qid uuid; deadline timestamptz:=clock_timestamp()+interval '3 hours'; n jsonb; first_id uuid; total integer;
begin
  select jsonb_agg(jsonb_build_object('card',jsonb_build_object('name','Common card '||i),
    'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5))))) into items from generate_series(1,200) i;
  payload:=jsonb_build_object('eventId','common-200','queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000092','starts_at',clock_timestamp()+interval '5 minutes','interval_seconds',1,'ends_at',deadline),'items',items);
  result:=public.create_auction_queue_with_deadline(payload,'00000000-0000-0000-0000-000000000091');
  qid:=(result->'queue'->>'id')::uuid;
  perform pg_temp.check_that((select count(*)=200 and bool_and(a.scheduled_end_at=deadline) from public.auctions a join public.whatsapp_dispatches d on d.auction_id=a.id where d.queue_id=qid),'all 200 share deadline');
  perform pg_temp.check_that((result->'queue'->>'ends_at')::timestamptz=deadline,'returned queue includes deadline');
  perform pg_temp.check_that(public.create_auction_queue_with_deadline(payload,'00000000-0000-0000-0000-000000000091')=result,'retry returns adjusted result');
  begin
    perform public.create_auction_queue_with_deadline(jsonb_set(jsonb_set(payload,'{eventId}','"invalid-common"'),'{queue,ends_at}',to_jsonb(clock_timestamp())),'00000000-0000-0000-0000-000000000091');
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm<>'invalid_common_deadline' then raise; end if; end;
  -- Actual publication used to extend the deadline by per-card duration.
  update public.whatsapp_dispatches set poll_sent_at=clock_timestamp() where queue_id=qid;
  perform pg_temp.check_that((select bool_and(a.scheduled_end_at=deadline) from public.auctions a join public.whatsapp_dispatches d on d.auction_id=a.id where d.queue_id=qid),'actual poll publication keeps deadline');
  perform public.control_auction_publish_queue(qid,'pause','00000000-0000-0000-0000-000000000091');
  perform public.control_auction_publish_queue(qid,'resume','00000000-0000-0000-0000-000000000091');
  perform pg_temp.check_that((select bool_and(a.scheduled_end_at=deadline) from public.auctions a join public.whatsapp_dispatches d on d.auction_id=a.id where d.queue_id=qid),'resume keeps deadline');
  update public.whatsapp_dispatches set status='sent',sent_at=clock_timestamp() where queue_id=qid;
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_auction_notices where kind='queue_finished' and queue_id=qid),'one summary after last published card');
  update public.auctions set status='open',whatsapp_group_id='120000000000000992@g.us' where id in(select auction_id from public.whatsapp_dispatches where queue_id=qid);
  update public.auction_publish_queues set ends_at=clock_timestamp()-interval '1 second' where id=qid;
  update public.auctions set scheduled_end_at=clock_timestamp() where id in(select auction_id from public.whatsapp_dispatches where queue_id=qid);
  total:=public.finalize_due_auction_batch('00000000-0000-0000-0000-000000000091');
  perform pg_temp.check_that(total=200,'all auctions close together before deliveries');
  perform pg_temp.check_that((select count(*)=200 from public.whatsapp_auction_notices where kind='auction_closed'),'200 durable result notices');
  perform pg_temp.check_that(public.finalize_due_auction_batch('00000000-0000-0000-0000-000000000091')=0,'finalize retry creates no duplicates');
  n:=public.claim_auction_notice('worker-1');
  perform pg_temp.check_that(n->>'kind'='queue_finished','summary has priority');
  perform public.finish_auction_notice((n->>'id')::uuid,'worker-1',true);
  n:=public.claim_auction_notice('worker-1'); first_id:=(n->>'id')::uuid;
  perform pg_temp.check_that(n->>'kind'='auction_closed','first result ready');
  perform pg_temp.check_that(public.claim_auction_notice('worker-2') is null,'concurrent worker cannot overlap group');
  perform public.finish_auction_notice(first_id,'worker-1',false);
  perform pg_temp.check_that((select sent_at is null and next_attempt_at>clock_timestamp() from public.whatsapp_auction_notices where id=first_id),'failed delivery remains pending with backoff');
  n:=public.claim_auction_notice('worker-2');
  perform public.finish_auction_notice((n->>'id')::uuid,'worker-2',true);
  perform pg_temp.check_that(public.claim_auction_notice('worker-after-restart') is null,'15s interval survives worker restart');
  update public.whatsapp_auction_notices set sent_at=clock_timestamp()-interval '16 seconds' where sent_at is not null;
  n:=public.claim_auction_notice('worker-after-restart');
  perform pg_temp.check_that(n is not null,'next result available after interval');
  perform pg_temp.check_that(public.export_business_backup() ? 'whatsapp_auction_notices','backup covers delivery outbox');
end $$;
reset role;
rollback;
