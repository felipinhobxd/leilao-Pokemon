begin;
alter table public.whatsapp_quick_polls
 add column game_kind text not null default 'legacy' check(game_kind in('legacy','giveaway','quiz')),
 add column correct_index integer,
 add column prize_name text,
 add column poll_message_json jsonb,
 add column winner_participant_id uuid references public.participants(id) on delete set null,
 add column winner_name text,
 add column winner_event_id text,
 add column won_at timestamptz;
alter table public.whatsapp_quick_polls add constraint quick_poll_game_valid check(game_kind='legacy' or (correct_index is not null and prize_name is not null and correct_index>=0 and correct_index<jsonb_array_length(options) and length(trim(prize_name)) between 1 and 200));
-- Secret keys and the answer stay behind the authorized server API.
revoke select on public.whatsapp_quick_polls from authenticated;
alter table public.whatsapp_auction_notices drop constraint whatsapp_auction_notices_kind_check;
alter table public.whatsapp_auction_notices add constraint whatsapp_auction_notices_kind_check check(kind in('queue_finished','auction_closed','quick_poll_winner'));
alter table public.whatsapp_auction_notices add column quick_poll_id uuid references public.whatsapp_quick_polls(id) on delete cascade;
create unique index quick_poll_prize_notice_once on public.whatsapp_auction_notices(quick_poll_id) where kind='quick_poll_winner';

create function public.validate_poll_game(p_kind text,p_options jsonb,p_correct integer,p_prize text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_kind is null or p_kind not in('legacy','giveaway','quiz') or jsonb_typeof(p_options) is distinct from 'array' then raise exception 'invalid_poll_game'; end if;
 if jsonb_array_length(p_options) not between 2 and 12 or exists(select 1 from jsonb_array_elements(p_options) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 100) or (select count(distinct trim(x#>>'{}'))<>count(*) from jsonb_array_elements(p_options) x) then raise exception 'invalid_poll_game'; end if;
 if p_kind<>'legacy' and (p_correct is null or p_correct<0 or p_correct>=jsonb_array_length(p_options) or coalesce(length(trim(p_prize)),0) not between 1 and 200) then raise exception 'invalid_poll_game'; end if;
end $$;

create function public.create_auction_queue_with_games(p_payload jsonb,p_admin_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; game jsonb; result jsonb; qid uuid; pos integer:=0;
begin
 for item in select value from jsonb_array_elements(p_payload->'items') loop
  game:=item->'giveaway';
  if game is not null then
   perform public.validate_poll_game(coalesce(game->>'kind','legacy'),game->'options',(game->>'correctIndex')::integer,item->'card'->>'name');
   if game->>'kind'='quiz' and coalesce(length(trim(game->>'question')),0) not between 1 and 200 then raise exception 'invalid_poll_game'; end if;
  end if;
 end loop;
 result:=public.create_auction_queue_with_deadline(p_payload,p_admin_user_id);
 qid:=(result->'queue'->>'id')::uuid;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
  pos:=pos+1;game:=item->'giveaway';
  if game is not null then
   update public.whatsapp_quick_polls set game_kind=coalesce(game->>'kind','legacy'),correct_index=(game->>'correctIndex')::integer,prize_name=item->'card'->>'name',
    title=case when game->>'kind'='quiz' then trim(game->>'question') else title end
    where queue_id=qid and queue_position=pos and sent_at is null;
  end if;
 end loop;
 return result;
end $$;

create function public.create_quick_poll_game(p_payload jsonb,p_admin_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare row public.whatsapp_quick_polls; eid text:='quick-poll:'||(p_payload->>'eventId'); request_key jsonb;
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
 if length(eid) not between 12 and 200 then raise exception 'invalid_poll_game'; end if;
 perform public.validate_poll_game(p_payload->>'kind',p_payload->'options',(p_payload->>'correctIndex')::integer,p_payload->>'prizeName');
 if coalesce(length(trim(p_payload->>'title')),0) not between 1 and 200 then raise exception 'invalid_poll_game'; end if;
 perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into row from public.whatsapp_quick_polls where external_event_id=eid;
 if found then
  if row.created_by is distinct from p_admin_user_id or row.title is distinct from p_payload->>'title' or row.options is distinct from p_payload->'options' or row.game_kind is distinct from p_payload->>'kind' or row.correct_index is distinct from (p_payload->>'correctIndex')::integer or row.prize_name is distinct from p_payload->>'prizeName' or row.group_id is distinct from (p_payload->>'groupId')::uuid or row.image_url is distinct from nullif(p_payload->>'imageUrl','') or row.scheduled_at is distinct from (p_payload->>'scheduledAt')::timestamptz then raise exception 'event_id_conflict'; end if;
  return jsonb_build_object('id',row.id,'title',row.title,'scheduled_at',row.scheduled_at);
 end if;
 if not exists(select 1 from public.whatsapp_groups where id=(p_payload->>'groupId')::uuid and active) then raise exception 'whatsapp_group_unavailable'; end if;
 if p_payload->>'scheduledAt' is null or (p_payload->>'scheduledAt')::timestamptz<clock_timestamp()-interval '2 minutes' then raise exception 'invalid_poll_game'; end if;
 if coalesce(p_payload->>'imageUrl','')<>'' and (p_payload->>'imageUrl' !~ '^https://' or length(p_payload->>'imageUrl')>500) then raise exception 'invalid_poll_game'; end if;
 insert into public.whatsapp_quick_polls(group_id,title,options,scheduled_at,external_event_id,created_by,game_kind,correct_index,prize_name,image_url)
 values((p_payload->>'groupId')::uuid,p_payload->>'title',p_payload->'options',(p_payload->>'scheduledAt')::timestamptz,eid,p_admin_user_id,p_payload->>'kind',(p_payload->>'correctIndex')::integer,p_payload->>'prizeName',nullif(p_payload->>'imageUrl','')) returning * into row;
 return jsonb_build_object('id',row.id,'title',row.title,'scheduled_at',row.scheduled_at);
end $$;

create function public.claim_quick_poll_prize(p_poll_id uuid,p_participant_id uuid,p_option_index integer,p_event_id text,p_event_at timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare poll public.whatsapp_quick_polls; person public.participants; group_jid text;
begin
 select * into poll from public.whatsapp_quick_polls where id=p_poll_id for update;
 if not found or poll.game_kind='legacy' or poll.sent_at is null or poll.poll_message_id is null then return jsonb_build_object('won',false); end if;
 if poll.winner_event_id is not null then return jsonb_build_object('won',false,'finished',true); end if;
 if p_option_index is distinct from poll.correct_index then return jsonb_build_object('won',false); end if;
 if p_event_at is null or p_event_at<poll.sent_at-interval '5 seconds' or p_event_at>clock_timestamp()+interval '2 minutes' or coalesce(length(p_event_id),0) not between 1 and 200 then raise exception 'invalid_game_vote'; end if;
 select * into person from public.participants where id=p_participant_id for share;
 if not found or person.status<>'active' or person.suspension_until>clock_timestamp() then return jsonb_build_object('won',false); end if;
 select g.group_jid into group_jid from public.whatsapp_groups g where g.id=poll.group_id and g.active;
 if group_jid is null then return jsonb_build_object('won',false); end if;
 update public.whatsapp_quick_polls set winner_participant_id=person.id,winner_name=person.display_name,winner_event_id=p_event_id,won_at=clock_timestamp() where id=poll.id;
 insert into public.whatsapp_auction_notices(kind,quick_poll_id,group_jid,payload)
 values('quick_poll_winner',poll.id,group_jid,jsonb_build_object('winner_participant_id',person.id,'winner_name',person.display_name,'prize_name',poll.prize_name,'game_kind',poll.game_kind));
 insert into public.auction_events(participant_id,event_type,external_event_id,occurred_at,payload)
 values(person.id,'QUICK_POLL_PRIZE_WON','quick-prize:'||poll.id,p_event_at,jsonb_build_object('poll_id',poll.id,'kind',poll.game_kind,'prize_name',poll.prize_name));
 return jsonb_build_object('won',true,'finished',true);
end $$;
revoke execute on function public.validate_poll_game(text,jsonb,integer,text),public.create_auction_queue_with_games(jsonb,uuid),public.create_quick_poll_game(jsonb,uuid),public.claim_quick_poll_prize(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.validate_poll_game(text,jsonb,integer,text),public.create_auction_queue_with_games(jsonb,uuid),public.create_quick_poll_game(jsonb,uuid),public.claim_quick_poll_prize(uuid,uuid,integer,text,timestamptz) to service_role;
-- Preserve existing export scope/limits and include new game/result fields.
do $$ declare ddl text; signature text; old_columns text:='id,group_id,queue_id,queue_position,title,options,image_url,scheduled_at,sent_at,poll_message_id,external_event_id,created_by,created_at'; begin
 foreach signature in array array['public.export_business_backup()','public.export_business_backup_text()'] loop
  ddl:=pg_get_functiondef(signature::regprocedure);
  if strpos(ddl,old_columns)=0 then raise exception 'backup_game_patch_target_missing'; end if;
  execute replace(ddl,old_columns,old_columns||',game_kind,correct_index,prize_name,poll_message_json,winner_participant_id,winner_name,winner_event_id,won_at');
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
