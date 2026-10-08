-- Regressão da redução via RETIRADA + RE-OFERTA (migration 20261007110000):
--  1. retirar o lance e re-ofertar MENOR gera value_change_log com
--     change_kind='withdraw_rebid' + 1 aviso global com contexto
--     lote/carta (o fluxo chegava como BID_PLACED e passava batido);
--  2. retirar e re-ofertar MAIOR/IGUAL gera o log, ZERO avisos
--     (mesma semântica do BID_CHANGED: só a redução conta);
--  3. primeiro lance (sem retirada anterior) não gera log;
--  4. a troca direta continua gravando change_kind='change' (B.2 intacto);
--  5. o ciclo de 3 soma os DOIS caminhos → 1 DM (admin_notifications) com o
--     payload no contrato do bot/warning-notify.mjs;
--  6. replay do mesmo eventId não duplica NADA (cache processed_commands +
--     ON CONFLICT external_event_id);
--  7. o snapshot do dashboard expõe change_kind nas duas listas de avisos
--     e o participante com ciclo fechado reinicia o contador em 0.
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000071');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000071','Test admin');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000071') $$;
set local role service_role;
do $$
declare card jsonb; p1 jsonb; a1 jsonb; snap jsonb;
begin
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"wr-card1","data":{"name":"Mewtwo","starting_price":10,"buyout_price":1000}}');
  a1:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','wr-a1','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','wr-open1','auctionId',a1->>'id'));
  p1:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"wr-p1","data":{"display_name":"Ana","whatsapp_id":"ana-withdraw","status":"active"}}');

  -- Primeiro lance: SEM valor anterior → nada no value_change_log.
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','wr-b1','auctionId',a1->>'id','participantId',p1->>'id','amount',50));
  perform pg_temp.check_that((select count(*)=0 from public.value_change_log),'first bid logs no value change');

  -- RETIRADA sozinha não loga (a auditoria acontece na re-oferta).
  perform pg_temp.cmd(jsonb_build_object('type','BID_WITHDRAWN','eventId','wr-w1','auctionId',a1->>'id','participantId',p1->>'id'));
  perform pg_temp.check_that((select count(*)=0 from public.value_change_log),'withdrawal alone logs nothing');

  -- RE-OFERTA MENOR: log withdraw_rebid + 1 aviso com contexto lote/carta.
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','wr-b2','auctionId',a1->>'id','participantId',p1->>'id','amount',40));
  perform pg_temp.check_that((select count(*)=1 and bool_and(change_kind='withdraw_rebid' and previous_amount=50 and new_amount=40) from public.value_change_log),'lower rebid is logged as withdraw_rebid');
  perform pg_temp.check_that((select count(*)=1 and bool_and(change_kind='withdraw_rebid' and previous_amount=50 and new_amount=40) from public.participant_warnings where participant_id=(p1->>'id')::uuid),'lower rebid warns once');
  perform pg_temp.check_that((select lot_number is not null and card_name='Mewtwo' and occurred_at is not null from public.participant_warnings where participant_id=(p1->>'id')::uuid),'warning carries poll/lot, card and time');

  -- RETIRADA + RE-OFERTA MAIOR: log sim, aviso NÃO.
  perform pg_temp.cmd(jsonb_build_object('type','BID_WITHDRAWN','eventId','wr-w2','auctionId',a1->>'id','participantId',p1->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','wr-b3','auctionId',a1->>'id','participantId',p1->>'id','amount',60));
  perform pg_temp.check_that((select count(*)=2 and bool_and(change_kind='withdraw_rebid') from public.value_change_log),'higher rebid is still logged');
  perform pg_temp.check_that((select count(*)=1 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'higher rebid never warns');

  -- RETIRADA + MESMO VALOR: log sem aviso (igualar nunca avisa).
  perform pg_temp.cmd(jsonb_build_object('type','BID_WITHDRAWN','eventId','wr-w3','auctionId',a1->>'id','participantId',p1->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','wr-b4','auctionId',a1->>'id','participantId',p1->>'id','amount',60));
  perform pg_temp.check_that((select count(*)=3 from public.value_change_log where change_kind='withdraw_rebid'),'equal rebid is logged');
  perform pg_temp.check_that((select count(*)=1 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'equal rebid never warns');

  -- TROCA DIRETA segue o caminho B.2 (verbatim): change_kind='change'.
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','wr-c1','auctionId',a1->>'id','participantId',p1->>'id','amount',70));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','wr-c2','auctionId',a1->>'id','participantId',p1->>'id','amount',55));
  perform pg_temp.check_that((select count(*)=2 and bool_and(change_kind='change') from public.value_change_log where change_kind='change'),'direct changes keep change_kind=change');
  perform pg_temp.check_that((select count(*)=2 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'direct reduction still warns');

  -- CICLO DE 3 MISTO: aviso 1 via retirada (wr-b2), aviso 2 via troca direta
  -- (wr-c2), aviso 3 via RETIRADA (wr-b5) → UMA DM, ciclo fechado.
  perform pg_temp.cmd(jsonb_build_object('type','BID_WITHDRAWN','eventId','wr-w4','auctionId',a1->>'id','participantId',p1->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','wr-b5','auctionId',a1->>'id','participantId',p1->>'id','amount',45));
  perform pg_temp.check_that((select count(*)=3 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'mixed paths share the same cycle counter');
  perform pg_temp.check_that((select count(*)=1 from public.admin_notifications where participant_id=(p1->>'id')::uuid and kind='WARNING_THRESHOLD' and sent_at is null),'third mixed warning fires ONE admin DM');
  perform pg_temp.check_that((select jsonb_array_length(payload->'warnings')=3 from public.admin_notifications where participant_id=(p1->>'id')::uuid),'DM history carries the full cycle');
  perform pg_temp.check_that((select payload->>'participant_name'='Ana' and payload->>'card_name'='Mewtwo' and payload->>'lot_number' is not null from public.admin_notifications where participant_id=(p1->>'id')::uuid),'DM payload keeps the bot contract (warning-notify.mjs)');
  perform pg_temp.check_that((select count(*)=1 from public.participant_warnings where participant_id=(p1->>'id')::uuid and cycle_closed),'the 3rd mixed warning closes the cycle');

  -- REPLAY: mesmo eventId, mesmo payload → cache, nada duplicado.
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','wr-b5','auctionId',a1->>'id','participantId',p1->>'id','amount',45));
  perform pg_temp.check_that((select count(*)=3 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'replay never double-warns');
  perform pg_temp.check_that((select count(*)=1 from public.admin_notifications where participant_id=(p1->>'id')::uuid),'replay never double-notifies');
  perform pg_temp.check_that((select count(*)=4 from public.value_change_log where change_kind='withdraw_rebid'),'replay never double-logs');

  -- SNAPSHOT do dashboard: change_kind visível nas duas listas; ciclo fechado
  -- reinicia o contador (warnings_cycle=0), total global segue contando.
  snap:=public.read_dashboard_snapshot();
  perform pg_temp.check_that((select (snap->'participant_warnings'->0->>'change_kind')='withdraw_rebid'),'dashboard warnings expose change_kind');
  perform pg_temp.check_that(
    exists(select 1 from jsonb_array_elements(snap->'value_change_log') e where e->>'change_kind'='withdraw_rebid'),
    'dashboard value changes expose change_kind'
  );
  perform pg_temp.check_that((select (s->>'warnings_total')::int=3 and (s->>'warnings_cycle')::int=0
    from jsonb_array_elements(snap->'participant_warning_stats') s
    where s->>'participant_id'=p1->>'id'),'closed cycle restarts the counter, total keeps counting');

  -- Helper é server-only.
  perform pg_temp.check_that(
    not has_function_privilege('anon','public.register_participant_reduction(uuid,uuid,text,bigint,text,numeric,numeric,text,timestamptz,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.register_participant_reduction(uuid,uuid,text,bigint,text,numeric,numeric,text,timestamptz,text)','EXECUTE'),
    'reduction helper is server-only'
  );
end $$;
reset role;
rollback;
