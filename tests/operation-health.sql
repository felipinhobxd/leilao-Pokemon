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
  -- Existing schema supports durable delivery mode and one private alert per
  -- notice. Replaying the insert must not reset an already delivered DM.
  insert into public.admin_notifications(kind,external_event_id,payload,sent_at)
    values('NOTICE_MENTION_DENIED','NOTICE_MENTION_DENIED:'||notice_id,
      '{"sent_to":["synthetic-admin"]}',clock_timestamp()) on conflict(external_event_id) do nothing;
  insert into public.admin_notifications(kind,external_event_id,payload)
    values('NOTICE_MENTION_DENIED','NOTICE_MENTION_DENIED:'||notice_id,'{}') on conflict(external_event_id) do nothing;
  perform pg_temp.health_check((select count(*)=1 and bool_and(sent_at is not null and payload->'sent_to'='["synthetic-admin"]'::jsonb)
    from public.admin_notifications where external_event_id='NOTICE_MENTION_DENIED:'||notice_id),'replayed fallback alert preserves delivery receipt');
  insert into public.admin_notifications(kind,external_event_id,payload)
    values('NOTICE_DELIVERY_DELAYED','NOTICE_DELIVERY_DELAYED:'||notice_id,'{}') on conflict(external_event_id) do nothing;
  update public.whatsapp_auction_notices set payload=payload||'{"mention_denied":true,"delivery_alerted":true}'::jsonb
    where id=notice_id and locked_by='health-worker' and sent_at is null;
  perform public.finish_auction_notice(notice_id,'health-worker',true);
  perform pg_temp.health_check((select last_error is null and sent_at is not null from public.whatsapp_auction_notices where whatsapp_auction_notices.id=notice_id),'success clears error without duplicate delivery');
  perform pg_temp.health_check((select payload->>'mention_denied'='true' and payload->>'delivery_alerted'='true'
    from public.whatsapp_auction_notices where id=notice_id),'delivery acknowledgement retains fallback and escalation decisions');
end $$;
rollback;
