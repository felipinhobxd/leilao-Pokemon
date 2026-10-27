begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000061');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000061','Withdrawal minute admin');
create function pg_temp.minute_check(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if;end $$;
create function pg_temp.minute_cmd(c jsonb) returns jsonb language sql as $$select public.process_auction_command(c,'00000000-0000-0000-0000-000000000061')$$;
set local role service_role;
do $$
declare card jsonb; person jsonb; auction jsonb; bid jsonb; command jsonb; result jsonb;
  base timestamptz:=clock_timestamp()-interval '3 minutes'; offset_ms integer;
begin
  person:=pg_temp.minute_cmd('{"type":"PARTICIPANT_CREATE","eventId":"minute-person","data":{"display_name":"Minute participant","whatsapp_id":"minute-person"}}');
  foreach offset_ms in array array[59999,60000,60001] loop
    card:=pg_temp.minute_cmd(jsonb_build_object('type','CARD_CREATE','eventId','minute-card-'||offset_ms,'data',jsonb_build_object('name','Minute card','starting_price',10,'buyout_price',100)));
    auction:=pg_temp.minute_cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','minute-auction-'||offset_ms,'data',jsonb_build_object('card_id',card->>'id')));
    perform pg_temp.minute_cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','minute-open-'||offset_ms,'auctionId',auction->>'id'));
    update public.auctions set started_at=base-interval '1 minute',scheduled_end_at=clock_timestamp()+interval '1 hour' where id=(auction->>'id')::uuid;
    result:=pg_temp.minute_cmd(jsonb_build_object('type','BID_PLACED','eventId','minute-bid-'||offset_ms,'auctionId',auction->>'id','participantId',person->>'id','amount',20,'occurredAt',base));
    bid:=result->'bid';
    command:=jsonb_build_object('type','BID_WITHDRAWN','eventId','minute-withdraw-'||offset_ms,'auctionId',auction->>'id','participantId',person->>'id','occurredAt',base+offset_ms*interval '1 millisecond');
    if offset_ms<=60000 then
      result:=pg_temp.minute_cmd(command);
      perform pg_temp.minute_check((select status='withdrawn' from public.bids where id=(bid->>'id')::uuid),'withdraw at/before exact 60s allowed');
      perform pg_temp.minute_check(pg_temp.minute_cmd(command)=result,'withdraw replay still returns original result');
    else
      begin perform pg_temp.minute_cmd(command);raise exception 'EXPECTED_ERROR';
      exception when others then if sqlerrm<>'withdrawal_window_expired' then raise;end if;end;
      perform pg_temp.minute_check((select status='active' from public.bids where id=(bid->>'id')::uuid),'late withdrawal leaves accepted bid active');
      perform pg_temp.minute_check(not exists(select 1 from public.processed_commands where external_event_id=command->>'eventId'),'refusal not cached as success');
      -- Panel commands without a source clock must use the server clock.
      begin perform pg_temp.minute_cmd((command-'occurredAt')||'{"eventId":"minute-panel"}');raise exception 'EXPECTED_ERROR';
      exception when others then if sqlerrm<>'withdrawal_window_expired' then raise;end if;end;
      -- Legacy bids without WhatsApp clocks use their confirmed processing time.
      update public.bids set whatsapp_event_at=null,processed_at=base where id=(bid->>'id')::uuid;
      begin perform pg_temp.minute_cmd(command||'{"eventId":"minute-legacy"}');raise exception 'EXPECTED_ERROR';
      exception when others then if sqlerrm<>'withdrawal_window_expired' then raise;end if;end;
      -- A newly accepted change is a new bid, with its own minute.
      perform pg_temp.minute_cmd(jsonb_build_object('type','BID_CHANGED','eventId','minute-change','auctionId',auction->>'id','participantId',person->>'id','amount',21,'occurredAt',base+interval '80 seconds'));
      perform pg_temp.minute_cmd(command||jsonb_build_object('eventId','minute-after-change','occurredAt',base+interval '130 seconds'));
      perform pg_temp.minute_check(not exists(select 1 from public.bids where auction_id=(auction->>'id')::uuid and status='active'),'withdraw within 50s of accepted change allowed');
    end if;
  end loop;
  perform pg_temp.minute_cmd(jsonb_build_object('type','BID_PLACED','eventId','minute-before-close','auctionId',auction->>'id','participantId',person->>'id','amount',30));
  update public.auctions set scheduled_end_at=clock_timestamp()-interval '1 second' where id=(auction->>'id')::uuid;
  begin perform pg_temp.minute_cmd(jsonb_build_object('type','BID_WITHDRAWN','eventId','minute-after-close','auctionId',auction->>'id','participantId',person->>'id'));raise exception 'EXPECTED_ERROR';
  exception when others then if sqlerrm<>'deadline_expired' then raise;end if;end;
  perform pg_temp.minute_check((select count(*)=1 from public.bids where auction_id=(auction->>'id')::uuid and status='active'),'auction cutoff still takes precedence');
  perform pg_temp.minute_check(not has_function_privilege('authenticated','public.process_auction_command(jsonb,uuid)','execute'),'commands remain service-only');
end $$;
rollback;
