begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000081');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000081','Game admin');
insert into public.whatsapp_groups(id,group_jid,name,active) values('00000000-0000-0000-0000-000000000082','game-test@g.us','Game test',true);
insert into public.participants(id,whatsapp_id,display_name) values('00000000-0000-0000-0000-000000000083','game-a','Maria'),('00000000-0000-0000-0000-000000000084','game-b','João');
create function pg_temp.game_check(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
select pg_temp.game_check(not has_function_privilege('authenticated','public.claim_quick_poll_prize(uuid,uuid,integer,text,timestamptz)','execute'),'no public award RPC');
select pg_temp.game_check(not has_table_privilege('authenticated','public.whatsapp_quick_polls','select'),'no direct answer/secret exposure');
set local role service_role;
do $$
declare payload jsonb; result jsonb; pid uuid; qid uuid; game public.whatsapp_quick_polls;
begin
 payload:=jsonb_build_object('eventId','quiz-test','groupId','00000000-0000-0000-0000-000000000082','kind','quiz','title','Evolução do Pikachu?','prizeName','Pikachu ex','options',jsonb_build_array('Raichu','Pichu'),'correctIndex',0,'scheduledAt',clock_timestamp());
 result:=public.create_quick_poll_game(payload,'00000000-0000-0000-0000-000000000081');pid:=(result->>'id')::uuid;
 perform pg_temp.game_check(public.create_quick_poll_game(payload,'00000000-0000-0000-0000-000000000081')=result,'create retry idempotent');
 begin perform public.create_quick_poll_game(jsonb_set(payload,'{correctIndex}','1'),'00000000-0000-0000-0000-000000000081');raise exception 'EXPECTED_ERROR';exception when others then if sqlerrm<>'event_id_conflict' then raise;end if;end;
 perform pg_temp.game_check((public.claim_quick_poll_prize(pid,'00000000-0000-0000-0000-000000000083',0,'before-send',clock_timestamp())->>'won')::boolean=false,'cannot win unpublished poll');
 update public.whatsapp_quick_polls set sent_at=clock_timestamp(),poll_message_id='game-test-poll',poll_message_json='{}' where id=pid;
 perform pg_temp.game_check((public.claim_quick_poll_prize(pid,'00000000-0000-0000-0000-000000000083',1,'wrong',clock_timestamp())->>'won')::boolean=false,'wrong answer loses');
 update public.participants set status='banned' where id='00000000-0000-0000-0000-000000000083';
 perform pg_temp.game_check((public.claim_quick_poll_prize(pid,'00000000-0000-0000-0000-000000000083',0,'banned',clock_timestamp())->>'won')::boolean=false,'banned cannot win');
 update public.participants set status='active' where id='00000000-0000-0000-0000-000000000083';
 perform pg_temp.game_check((public.claim_quick_poll_prize(pid,'00000000-0000-0000-0000-000000000083',0,'correct',clock_timestamp())->>'won')::boolean,'first correct wins');
 perform pg_temp.game_check((public.claim_quick_poll_prize(pid,'00000000-0000-0000-0000-000000000084',0,'later',clock_timestamp())->>'won')::boolean=false,'later correct loses');
 perform public.claim_quick_poll_prize(pid,'00000000-0000-0000-0000-000000000083',0,'correct',clock_timestamp());
 perform pg_temp.game_check((select count(*)=1 from public.whatsapp_auction_notices where quick_poll_id=pid),'one durable announcement');
 perform pg_temp.game_check((select winner_name='Maria' from public.whatsapp_quick_polls where id=pid),'winner persists');
 -- Mixed queue: quiz consumes a publication slot, never a lot/auction/purchase.
 payload:=jsonb_build_object('eventId','mixed-game-queue','queue',jsonb_build_object('group_id','00000000-0000-0000-0000-000000000082','starts_at',clock_timestamp()+interval '10 minutes','interval_seconds',30),'items',jsonb_build_array(jsonb_build_object('card',jsonb_build_object('name','Eevee'),'giveaway',jsonb_build_object('kind','quiz','question','Quantas evoluções?','options',jsonb_build_array('8','2'),'correctIndex',0)),jsonb_build_object('card',jsonb_build_object('name','Normal card'),'auction',jsonb_build_object('starting_price',5,'bid_increment',1,'duration_seconds',120,'poll_options',jsonb_build_array(jsonb_build_object('label','5','amount',5))))));
 result:=public.create_auction_queue_with_games(payload,'00000000-0000-0000-0000-000000000081');qid:=(result->'queue'->>'id')::uuid;
 perform pg_temp.game_check((select count(*)=1 from public.whatsapp_dispatches where queue_id=qid),'only normal card creates auction dispatch');
 select * into game from public.whatsapp_quick_polls where queue_id=qid;
 perform pg_temp.game_check(game.game_kind='quiz' and game.correct_index=0 and game.prize_name='Eevee' and game.title='Quantas evoluções?' and game.queue_position=1,'quiz config saved in mixed queue');
 perform pg_temp.game_check(public.create_auction_queue_with_games(payload,'00000000-0000-0000-0000-000000000081')=result,'mixed queue retry idempotent');
 perform pg_temp.game_check((select count(*)=0 from public.purchases where participant_id='00000000-0000-0000-0000-000000000083'),'free prize creates no charge');
end $$;
rollback;
