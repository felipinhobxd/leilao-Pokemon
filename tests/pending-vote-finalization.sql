begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000091');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000091','Vote inbox admin');
insert into public.whatsapp_groups(id,group_jid,name,active) values('00000000-0000-0000-0000-000000000092','120000000000000992@g.us','Vote inbox group',true);
create function pg_temp.check_that(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
set local role service_role;
do $$
declare result jsonb; aid uuid; blocked uuid[]:='{}'; free_id uuid; deadline timestamptz:=clock_timestamp()-interval '1 second'; i integer;
begin
  for i in 1..4 loop
    result:=public.create_auction_wizard(jsonb_build_object('eventId','guarded-'||i,
      'card',jsonb_build_object('name','Pending vote card '||i,'condition','NM — Near Mint','language','pt-BR'),
      'auction',jsonb_build_object('lot_number',1000+i,'scheduled_end_at',clock_timestamp()+interval '1 hour','starting_price',5,'bid_increment',1,'duration_seconds',120,
        'group_id','00000000-0000-0000-0000-000000000092','scheduled_at',clock_timestamp()+interval '1 minute',
        'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5),jsonb_build_object('label','6','amount',6)))),'00000000-0000-0000-0000-000000000091');
    aid:=(result->'auction'->>'id')::uuid;
    update public.auctions set status='open',started_at=clock_timestamp()-interval '1 hour',scheduled_end_at=deadline,whatsapp_group_id='120000000000000992@g.us',poll_id=case when i=1 then 'guard-direct' else null end where id=aid;
    update public.whatsapp_dispatches set poll_message_id='guard-canonical-'||i,poll_remote_message_id='guard-remote-'||i where auction_id=aid;
    if i<4 then blocked:=array_append(blocked,aid); else free_id:=aid; end if;
  end loop;
  perform pg_temp.check_that(public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000091',array['guard-direct','guard-canonical-2','guard-remote-3'],clock_timestamp())=1,'unrelated auction finalizes despite three pending polls');
  perform pg_temp.check_that((select status='closed' from public.auctions where id=free_id),'unaffected auction closes');
  perform pg_temp.check_that((select bool_and(status='open' and scheduled_end_at=deadline) from public.auctions where id=any(blocked)),'guard holds only affected auctions without extending deadlines');
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_auction_notices where kind='auction_closed'),'no premature results for pending polls');
  perform pg_temp.check_that(public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000091','{}',deadline-interval '1 second')=0,'a request crossing a new deadline cannot finalize beyond its observed window');
  perform pg_temp.check_that(public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000091','{}',clock_timestamp())=3,'resolved pending votes release automatic results');
  perform pg_temp.check_that(public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000091','{}',clock_timestamp())=0,'no duplicate results on retry');
  begin
    perform public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000091',null,clock_timestamp());
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm<>'invalid_pending_poll_ids' then raise; end if; end;
  begin
    perform public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000091',array[null]::text[],clock_timestamp());
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm<>'invalid_pending_poll_ids' then raise; end if; end;
  begin
    perform public.finalize_due_auction_batch_guarded('00000000-0000-0000-0000-000000000099','{}',clock_timestamp());
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
end $$;
reset role;
select pg_temp.check_that(not has_function_privilege('anon','public.finalize_due_auction_batch_guarded(uuid,text[],timestamptz)','execute'),'anon has no access');
select pg_temp.check_that(not has_function_privilege('authenticated','public.finalize_due_auction_batch_guarded(uuid,text[],timestamptz)','execute'),'authenticated has no direct access');
rollback;
