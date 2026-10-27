begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000063');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000063','Partial queue admin');
insert into public.whatsapp_groups(id,group_jid,name,active) values('00000000-0000-0000-0000-000000000064','partial-queue@g.us','Partial queue',true);
create function pg_temp.partial_check(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message;end if;end $$;
set local role service_role;
do $$
declare payload jsonb; result jsonb; qid uuid; first_id uuid; last_id uuid; scenario text; n jsonb;
begin
  foreach scenario in array array['failed','cancelled','all_failed','paused','cancelled_queue','count_mismatch','game_pending'] loop
    payload:=jsonb_build_object('eventId','partial-'||scenario,'queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000064','starts_at',clock_timestamp()+interval '1 minute','interval_seconds',1,'ends_at',clock_timestamp()+interval '1 hour'),
      'items',jsonb_build_array(
        jsonb_build_object('card',jsonb_build_object('name','Partial card A'),'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5)))),
        jsonb_build_object('card',jsonb_build_object('name','Partial card B'),'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5))))));
    result:=public.create_auction_queue_with_deadline(payload,'00000000-0000-0000-0000-000000000063');
    qid:=(result->'queue'->>'id')::uuid;
    select id into first_id from public.whatsapp_dispatches where queue_id=qid order by queue_position limit 1;
    select id into last_id from public.whatsapp_dispatches where queue_id=qid order by queue_position desc limit 1;
    if scenario='paused' then update public.auction_publish_queues set status='paused' where id=qid;
    elsif scenario='cancelled_queue' then update public.auction_publish_queues set status='cancelled' where id=qid;
    elsif scenario='count_mismatch' then update public.auction_publish_queues set total_items=3 where id=qid;
    elsif scenario='game_pending' then
      update public.auction_publish_queues set total_items=3 where id=qid;
      insert into public.whatsapp_quick_polls(group_id,queue_id,queue_position,title,options,scheduled_at,external_event_id)
        values('00000000-0000-0000-0000-000000000064',qid,3,'Pending game','["A","B"]',clock_timestamp(),'partial-pending-game');
    end if;
    update public.whatsapp_dispatches set status=case when scenario='all_failed' then 'failed' else 'sent' end where id=first_id;
    perform pg_temp.partial_check(not exists(select 1 from public.whatsapp_auction_notices where queue_id=qid),'no completion while final dispatch pending');
    update public.whatsapp_dispatches set status=case when scenario='cancelled' then 'cancelled' else 'failed' end where id=last_id;
    if scenario in('failed','cancelled') then
      select notice.payload into n from public.whatsapp_auction_notices notice where queue_id=qid and kind='queue_finished';
      perform pg_temp.partial_check(n->>'not_published_count'='1' and n->>'published_count'='1','partial queue announces one missing card and one published');
      perform pg_temp.partial_check((n->>'ends_at')::timestamptz=(select ends_at from public.auction_publish_queues where id=qid),'summary retains common cutoff');
      update public.auction_publish_queues set status='running' where id=qid;
      update public.auction_publish_queues set status='completed' where id=qid;
      perform pg_temp.partial_check((select count(*)=1 from public.whatsapp_auction_notices where queue_id=qid),'completed transition replay does not duplicate summary');
    else
      perform pg_temp.partial_check(not exists(select 1 from public.whatsapp_auction_notices where queue_id=qid),'no misleading summary for unpublished, paused, cancelled, missing or pending items');
    end if;
  end loop;
end $$;
rollback;
