begin;
create function pg_temp.health_check(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
select pg_temp.health_check((select relrowsecurity from pg_class where oid='public.whatsapp_bot_workers'::regclass),'worker RLS retained');
select pg_temp.health_check((select relrowsecurity from pg_class where oid='public.whatsapp_auction_notices'::regclass),'notice RLS retained');
select pg_temp.health_check(not has_function_privilege('anon','public.finish_auction_notice(uuid,text,boolean)','EXECUTE'),'anon cannot finish notice');
select pg_temp.health_check(not has_function_privilege('authenticated','public.finish_auction_notice(uuid,text,boolean)','EXECUTE'),'authenticated cannot finish notice');
set local role service_role;
insert into public.whatsapp_bot_workers(worker_id,operational_health) values('health-test','{"backup":{"status":"failed","error":"521"}}');
select pg_temp.health_check((select operational_health->'backup'->>'status'='failed' from public.whatsapp_bot_workers where worker_id='health-test'),'bounded state can persist on heartbeat');
do $$
declare n jsonb; notice_id uuid;
begin
  insert into public.whatsapp_auction_notices(kind,group_jid,payload,last_error) values('queue_finished','health@g.us','{}','admin permission missing') returning whatsapp_auction_notices.id into notice_id;
  n:=public.claim_auction_notice('health-worker');
  perform public.finish_auction_notice(notice_id,'health-worker',false);
  perform pg_temp.health_check((select last_error='admin permission missing' and sent_at is null from public.whatsapp_auction_notices where whatsapp_auction_notices.id=notice_id),'failure keeps diagnostic and pending notice');
  update public.whatsapp_auction_notices set next_attempt_at=clock_timestamp()-interval '1 second' where whatsapp_auction_notices.id=notice_id;
  n:=public.claim_auction_notice('health-worker');
  perform public.finish_auction_notice(notice_id,'health-worker',true);
  perform pg_temp.health_check((select last_error is null and sent_at is not null from public.whatsapp_auction_notices where whatsapp_auction_notices.id=notice_id),'success clears error without duplicate delivery');
end $$;
rollback;
