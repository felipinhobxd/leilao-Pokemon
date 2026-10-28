begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000073');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000073','Economy admin');
insert into public.whatsapp_groups(id,group_jid,name,active,is_default)
  values('00000000-0000-0000-0000-000000000074','economy@g.us','Economy',true,true);
create function pg_temp.economy_check(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message;end if;end $$;
set local role service_role;
do $$
declare result jsonb; qid uuid; aid uuid; pid uuid; operations jsonb; stamp timestamptz:=clock_timestamp(); item record; i integer:=0;
  statuses text[]:=array['sent','failed','scheduled','sending','cancelled','sent'];
begin
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'empty database is idle');
  result:=public.create_auction_queue_with_deadline(jsonb_build_object('eventId','economy-queue',
    'queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000074','starts_at',stamp+interval '1 day','interval_seconds',30),
    'items',(select jsonb_agg(jsonb_build_object('card',jsonb_build_object('name','Economy card '||n),'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5))))) from generate_series(1,6) n)),
    '00000000-0000-0000-0000-000000000073');
  qid:=(result->'queue'->>'id')::uuid;
  select auction_id into aid from public.whatsapp_dispatches where queue_id=qid order by queue_position limit 1;
  perform pg_temp.economy_check(public.bot_has_pending_work() and not public.bot_has_due_work(5,15),'future queue avoids four empty worker queries');
  update public.auction_publish_queues set starts_at=stamp+interval '4 minutes' where id=qid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15) and not public.bot_has_due_work(3,15),'configured opening window honored');
  update public.auction_publish_queues set status='paused' where id=qid;
  update public.whatsapp_dispatches set scheduled_at=stamp-interval '1 second' where queue_id=qid;
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'paused due dispatches remain idle');
  update public.whatsapp_dispatches set status='sending',locked_at=stamp-interval '3 minutes' where auction_id=aid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15),'stale sending claim remains recoverable even in paused queue');
  update public.whatsapp_dispatches set locked_at=stamp where auction_id=aid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15),'fresh transport claim also keeps workers active');
  update public.whatsapp_dispatches set status='scheduled',locked_at=null where auction_id=aid;
  update public.auction_publish_queues set status='running',starts_at=stamp-interval '1 day' where id=qid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15),'dispatch after old opening window still due');
  update public.whatsapp_dispatches set scheduled_at=stamp+interval '1 day' where queue_id=qid;
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'running queue alone does not keep empty workers active');
  update public.auction_publish_queues set starts_at=stamp-interval '10 minutes' where id=qid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15) and not public.bot_has_due_work(5,5),'late opening honors configured grace window');
  update public.auction_publish_queues set starts_at=stamp-interval '1 day' where id=qid;
  update public.auctions set status='open',scheduled_end_at=stamp+interval '1 hour' where id=aid;
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'future closing deadline avoids empty finalization reads; votes are event driven');
  update public.auctions set scheduled_end_at=stamp-interval '1 second' where id=aid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15),'due closing deadline wakes workers');
  update public.auctions set status='closed' where id=aid;
  insert into public.whatsapp_quick_polls(group_id,queue_id,title,options,scheduled_at,external_event_id)
    values('00000000-0000-0000-0000-000000000074',qid,'Economy game','["A","B"]',stamp+interval '1 day','economy-game') returning id into pid;
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'future quiz remains idle');
  update public.whatsapp_quick_polls set scheduled_at=stamp-interval '1 second' where id=pid;
  update public.auction_publish_queues set status='paused' where id=qid;
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'due quiz in paused queue remains idle');
  update public.auction_publish_queues set status='running' where id=qid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15),'resumed quiz becomes visible immediately');
  update public.whatsapp_quick_polls set queue_id=null where id=pid;
  update public.auction_publish_queues set status='paused' where id=qid;
  perform pg_temp.economy_check(public.bot_has_due_work(5,15),'standalone due quiz remains visible');
  update public.whatsapp_quick_polls set sent_at=stamp where id=pid;
  perform pg_temp.economy_check(not public.bot_has_due_work(5,15),'sent quiz does not invent work');
  begin perform public.bot_has_due_work(null,15);raise exception 'EXPECTED_ERROR';
  exception when others then if sqlerrm<>'invalid_opening_window' then raise;end if;end;

  for item in select id from public.whatsapp_dispatches where queue_id=qid order by queue_position loop
    i:=i+1;
    update public.whatsapp_dispatches set status=statuses[i],updated_at=case when i=6 then stamp-interval '24 hours 1 millisecond' else stamp-interval '24 hours' end where id=item.id;
  end loop;
  insert into public.whatsapp_bot_workers(worker_id,status,heartbeat_at,version)
    values('economy-older','disconnected',stamp-interval '1 hour','old'),('economy-latest','connected',stamp,'0.2.23');
  operations:=public.read_dashboard_operations(stamp-interval '24 hours');
  perform pg_temp.economy_check(operations->'worker'->>'worker_id'='economy-latest','most recent worker selected');
  perform pg_temp.economy_check(operations->'group'->>'name'='Economy','active default group selected');
  perform pg_temp.economy_check(operations->'counts'='{"sent":1,"failed":1,"scheduled":1,"sending":1,"cancelled":1}'::jsonb,'single aggregate matches all five status counts and exact 24h boundary');
  update public.whatsapp_groups set active=false where id='00000000-0000-0000-0000-000000000074';
  perform pg_temp.economy_check(public.read_dashboard_operations(stamp+interval '1 hour')->'group'='null'::jsonb,'inactive default group not exposed');
  perform pg_temp.economy_check(public.read_dashboard_operations(stamp+interval '1 hour')->'counts'='{"sent":0,"failed":0,"scheduled":0,"sending":0,"cancelled":0}'::jsonb,'empty aggregate is complete with zero counts');
  perform pg_temp.economy_check(public.bot_delivery_revision()=2,'new runtime requires both delivery migrations');
end $$;
reset role;
select pg_temp.economy_check(not has_function_privilege('anon','public.read_dashboard_operations(timestamptz)','execute'),'anonymous cannot read operation summary');
select pg_temp.economy_check(not has_function_privilege('authenticated','public.bot_has_due_work(numeric,numeric)','execute'),'panel cannot inspect bot discovery directly');
rollback;
