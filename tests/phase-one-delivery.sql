begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000062');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000062','Phase one admin');
create function pg_temp.phase_check(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.phase_cmd(c jsonb) returns jsonb language sql as $$
select public.process_auction_command(c,'00000000-0000-0000-0000-000000000062') $$;
set local role service_role;
do $$
declare card jsonb; person jsonb; auction jsonb; command jsonb; result jsonb; n jsonb; notice_id uuid; i integer;
begin
  person:=pg_temp.phase_cmd('{"type":"PARTICIPANT_CREATE","eventId":"phase-person","data":{"display_name":"Winner","whatsapp_id":"phase-person"}}');
  card:=pg_temp.phase_cmd('{"type":"CARD_CREATE","eventId":"phase-card","data":{"name":"Phase card","starting_price":1,"buyout_price":3}}');
  auction:=pg_temp.phase_cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','phase-auction','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.phase_cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','phase-open','auctionId',auction->>'id'));
  update public.auctions set whatsapp_group_id='phase@g.us',scheduled_end_at=clock_timestamp()+interval '1 hour' where id=(auction->>'id')::uuid;
  command:=jsonb_build_object('type','BUYOUT_CONFIRMED','eventId','phase-buyout','auctionId',auction->>'id','participantId',person->>'id');
  -- A transaction rollback must undo both the sale and its announcement.
  begin
    perform pg_temp.phase_cmd(command);
    perform pg_temp.phase_check((select count(*)=1 from public.whatsapp_auction_notices where kind='buyout_confirmed'),'outbox created inside sale transaction');
    raise exception 'rollback_probe';
  exception when others then if sqlerrm<>'rollback_probe' then raise; end if; end;
  perform pg_temp.phase_check(not exists(select 1 from public.whatsapp_auction_notices where kind='buyout_confirmed'),'rolled back sale leaves no notice');
  result:=pg_temp.phase_cmd(command);
  perform pg_temp.phase_check(pg_temp.phase_cmd(command)=result,'idempotent sale replay');
  perform pg_temp.phase_check((select count(*)=1 from public.whatsapp_auction_notices where kind='buyout_confirmed'),'replay creates exactly one durable notice');
  n:=public.claim_auction_notice('phase-worker');notice_id:=(n->>'id')::uuid;
  perform pg_temp.phase_check(n->>'kind'='buyout_confirmed' and n->'payload'->>'card_name'='Phase card','claim carries buyout snapshot');
  perform public.finish_auction_notice(notice_id,'phase-worker',false);
  perform pg_temp.phase_check(public.claim_auction_notice('phase-restart') is null,'send failure backs off');
  update public.whatsapp_auction_notices set next_attempt_at=clock_timestamp()-interval '1 second' where id=notice_id;
  n:=public.claim_auction_notice('phase-restart');
  perform pg_temp.phase_check((n->>'id')::uuid=notice_id,'restart reclaims same durable notice');
  perform public.finish_auction_notice(notice_id,'phase-restart',true);
  perform pg_temp.phase_check(public.claim_auction_notice('phase-worker') is null,'completed notice cannot replay');

  for i in 1..4 loop
    insert into public.admin_notifications(kind,external_event_id,payload,next_attempt_at)
      values('DISPATCH_FAILED','phase-admin-'||i,'{}',clock_timestamp()-interval '1 minute'+i*interval '1 second');
  end loop;
  for i in 1..3 loop
    n:=public.claim_admin_notification('phase-admin');
    perform public.finish_admin_notification((n->>'id')::uuid,'phase-admin','["confirmed@s.whatsapp.net"]',false);
  end loop;
  n:=public.claim_admin_notification('phase-admin');
  perform pg_temp.phase_check(n->>'external_event_id'='phase-admin-4','three failures do not starve fourth notification');
  perform pg_temp.phase_check(public.claim_admin_notification('other-worker') is null,'in-flight item is not double claimed');
  perform public.finish_admin_notification((n->>'id')::uuid,'phase-admin','[]',true);
  perform pg_temp.phase_check(public.claim_admin_notification('phase-admin') is null,'idle tick produces no claim during backoff');
  update public.admin_notifications set next_attempt_at=clock_timestamp()-interval '1 second' where external_event_id='phase-admin-1';
  n:=public.claim_admin_notification('restart');
  perform pg_temp.phase_check(n->'payload'->'sent_to'='["confirmed@s.whatsapp.net"]'::jsonb,'partial recipient progress survives restart');
  update public.admin_notifications set locked_at=clock_timestamp()-interval '3 minutes' where id=(n->>'id')::uuid;
  n:=public.claim_admin_notification('recovery');
  perform pg_temp.phase_check(n is not null,'stale lease recovers after crash');
  begin
    perform public.finish_admin_notification((n->>'id')::uuid,'restart','[]',true);
    raise exception 'EXPECTED_FAILURE';
  exception when others then if sqlerrm<>'admin_notice_claim_lost' then raise; end if; end;
end $$;
reset role;
select pg_temp.phase_check(not has_function_privilege('authenticated','public.claim_admin_notification(text)','execute'),'claim restricted to service role');
select pg_temp.phase_check(not has_function_privilege('anon','public.enqueue_buyout_notice()','execute'),'trigger helper restricted');
rollback;
