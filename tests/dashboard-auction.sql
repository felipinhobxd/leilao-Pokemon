begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000091');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000091','Review admin');
insert into public.participants(id,whatsapp_id,display_name) values('10000000-0000-0000-0000-000000000091','review-leader','Líder');
insert into public.cards(id,name,starting_price) values('20000000-0000-0000-0000-000000000091','Carta A',1),('20000000-0000-0000-0000-000000000092','Carta B',1);
insert into public.auctions(id,card_id,status,starting_price,lot_number) values('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','open',1,10001),('30000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000092','open',1,10002);
insert into public.bids(auction_id,participant_id,amount,processed_at) values('30000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091',100,now()-interval '1 hour');
insert into public.bids(auction_id,participant_id,amount,status,processed_at) select '30000000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000091',1,'withdrawn',now()-interval '1 minute'+i*interval '1 millisecond' from generate_series(1,501)i;
set local role service_role;
do $$declare data jsonb;begin
 data:=public.read_dashboard_auction('30000000-0000-0000-0000-000000000091');
 if (data->'bids'->0->>'amount')::numeric<>100 or (data->>'participantCount')::integer<>1 or data->'bids'->0->'participant'->>'display_name'<>'Líder' then raise exception 'leader_lost_to_global_limit';end if;
 if has_function_privilege('anon','public.read_dashboard_auction(uuid)','execute') or has_function_privilege('authenticated','public.recover_auction_creation(text,uuid)','execute') then raise exception 'private_rpc_exposed';end if;
end $$;
reset role;
update public.participants set suspension_until=now()+interval '1 hour' where id='10000000-0000-0000-0000-000000000091';
set local role service_role;
do $$begin if (public.read_dashboard_auction('30000000-0000-0000-0000-000000000091')->>'participantCount')::integer<>0 then raise exception 'suspended_bidder_not_filtered';end if;end $$;
reset role;
insert into public.processed_commands(external_event_id,request,result) values('review-recovery','{"actor":"00000000-0000-0000-0000-000000000091","type":"AUCTION_QUEUE_CREATE"}','{"queue":{"id":"30000000-0000-0000-0000-000000000091","secret":"must not escape"}}');
set local role service_role;
do $$declare result jsonb;begin
 result:=public.recover_auction_creation('review-recovery','00000000-0000-0000-0000-000000000091');
 if result->'queue'->>'id'<>'30000000-0000-0000-0000-000000000091' or result->'queue' ? 'secret' then raise exception 'unsafe_recovery';end if;
 if public.recover_auction_creation('missing','00000000-0000-0000-0000-000000000091') is not null then raise exception 'false_recovery';end if;
end $$;
reset role;
rollback;
