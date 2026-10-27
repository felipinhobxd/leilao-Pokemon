begin;
create function pg_temp.discovery_check(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message;end if;end $$;
select pg_temp.discovery_check(not has_function_privilege('anon','public.bot_has_pending_work()','EXECUTE'),'anon cannot inspect worker activity');
select pg_temp.discovery_check(not has_function_privilege('authenticated','public.bot_has_pending_work()','EXECUTE'),'panel sessions cannot inspect worker activity');
insert into auth.users(id) values('00000000-0000-0000-0000-000000000071');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000071','Discovery admin');
insert into public.whatsapp_groups(id,group_jid,name,active) values('00000000-0000-0000-0000-000000000072','discovery@g.us','Discovery',true);
set local role service_role;
select pg_temp.discovery_check(not public.bot_has_pending_work(),'empty database is idle');
do $$
declare result jsonb; qid uuid; aid uuid;
begin
  result:=public.create_auction_queue_with_deadline(jsonb_build_object('eventId','discovery-queue','queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000072','starts_at',clock_timestamp()+interval '1 day','interval_seconds',30),
    'items',jsonb_build_array(jsonb_build_object('card',jsonb_build_object('name','Discovery card'),'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5)))))),'00000000-0000-0000-0000-000000000071');
  qid:=(result->'queue'->>'id')::uuid;
  select auction_id into strict aid from public.whatsapp_dispatches where queue_id=qid;
  perform pg_temp.discovery_check(public.bot_has_pending_work(),'future queue never hidden');
  update public.auction_publish_queues set status='paused' where id=qid;
  perform pg_temp.discovery_check(public.bot_has_pending_work(),'scheduled dispatch remains discoverable in paused queue');
  update public.whatsapp_dispatches set status='sending',locked_at=clock_timestamp()-interval '5 minutes' where queue_id=qid;
  perform pg_temp.discovery_check(public.bot_has_pending_work(),'stale sending claim remains discoverable');
  update public.whatsapp_dispatches set status='failed' where queue_id=qid;
  update public.auctions set status='draft' where id=aid;
  perform pg_temp.discovery_check(not public.bot_has_pending_work(),'terminal dispatch and paused queue do not invent work');
  update public.auction_publish_queues set status='running' where id=qid;
  perform pg_temp.discovery_check(public.bot_has_pending_work(),'running queue discovered even without a pending dispatch');
  update public.auction_publish_queues set status='cancelled' where id=qid;
  update public.auctions set status='open',scheduled_end_at=clock_timestamp()+interval '1 hour' where id=aid;
  perform pg_temp.discovery_check(public.bot_has_pending_work(),'open auction keeps finalization active before deadline');
  update public.auctions set status='closed' where id=aid;
  perform pg_temp.discovery_check(not public.bot_has_pending_work(),'closed auction alone is idle');
  insert into public.whatsapp_quick_polls(group_id,title,options,scheduled_at,external_event_id)
    values('00000000-0000-0000-0000-000000000072','Discovery game','["A","B"]',clock_timestamp()+interval '1 day','discovery-game');
  perform pg_temp.discovery_check(public.bot_has_pending_work(),'standalone future game discovered');
  update public.whatsapp_quick_polls set sent_at=clock_timestamp() where external_event_id='discovery-game';
  perform pg_temp.discovery_check(not public.bot_has_pending_work(),'sent game does not keep workers active');
end $$;
rollback;
