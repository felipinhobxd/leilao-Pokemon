-- Regressão do painel de participantes (migration 20261007100000):
--  1. PARTICIPANT_SUSPEND com prazo futuro bloqueia novos lances
--     (participant_not_eligible) e o status continua 'active';
--  2. o prazo AUTO-EXPIRA: com suspension_until no passado o participante
--     volta a dar lances (guard existente, sem reativação manual);
--  3. suspensão INDEFINIDA grava status='suspended' e limpa o prazo;
--  4. prazo no passado é recusado (invalid_suspension_until);
--  5. suspender BANIDO é recusado (participant_banned — sem downgrade);
--  6. PARTICIPANT_REACTIVATE limpa status e prazo (vale para banido);
--  7. idempotência: replay do MESMO eventId devolve o cache sem erro nem
--     efeito colateral; payload divergente no mesmo eventId → event_id_conflict;
--  8. o snapshot do dashboard expõe participant_warning_stats (total global
--     + ciclo aberto) SEM mexer nas linhas da chave participants
--     (contrato de tests/dashboard-snapshot.sql);
--  9. o RPC continua server-only (anon/authenticated sem execute).
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000061');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000061','Test admin');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000061') $$;
create function pg_temp.rejects(c jsonb, expected text) returns void language plpgsql as $$
begin
  perform pg_temp.cmd(c);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare card jsonb; p1 jsonb; a1 jsonb; snap jsonb; deadline text;
begin
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"pp-card1","data":{"name":"Pikachu","starting_price":10,"buyout_price":1000}}');
  a1:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','pp-a1','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','pp-open1','auctionId',a1->>'id'));
  p1:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"pp-p1","data":{"display_name":"Ana","whatsapp_id":"ana-panel","status":"active"}}');
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','pp-b1','auctionId',a1->>'id','participantId',p1->>'id','amount',20));
  perform pg_temp.check_that((select status='active' and suspension_until is null from public.participants where id=(p1->>'id')::uuid),'baseline is active without deadline');

  -- SUSPENSÃO COM PRAZO: bloqueia o lance (guard existente), status segue active.
  deadline:=to_char(clock_timestamp()+interval '2 hours','YYYY-MM-DD"T"HH24:MI:SSOF');
  perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_SUSPEND','eventId','pp-s1','id',p1->>'id','data',jsonb_build_object('suspension_until',deadline)));
  perform pg_temp.check_that((select status='active' and suspension_until>now() from public.participants where id=(p1->>'id')::uuid),'timed suspension keeps status active with future deadline');
  perform pg_temp.rejects(jsonb_build_object('type','BID_PLACED','eventId','pp-b2','auctionId',a1->>'id','participantId',p1->>'id','amount',25),'participant_not_eligible');

  -- AUTO-EXPIRA: prazo no passado deixa votar de novo SEM reativação manual
  -- (o participante tem lance ativo, então a re-oferta vem como BID_CHANGED).
  update public.participants set suspension_until=now()-interval '1 minute' where id=(p1->>'id')::uuid;
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','pp-b3','auctionId',a1->>'id','participantId',p1->>'id','amount',25));
  perform pg_temp.check_that((select count(*)=1 from public.value_change_log where auction_id=(a1->>'id')::uuid),'bids work again after the deadline expires');

  -- SUSPENSÃO INDEFINIDA: status='suspended', prazo limpo.
  perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_SUSPEND','eventId','pp-s2','id',p1->>'id','data',jsonb_build_object('suspension_until',null)));
  perform pg_temp.check_that((select status='suspended' and suspension_until is null from public.participants where id=(p1->>'id')::uuid),'indefinite suspension sets status and clears deadline');
  perform pg_temp.rejects(jsonb_build_object('type','BID_CHANGED','eventId','pp-b4','auctionId',a1->>'id','participantId',p1->>'id','amount',30),'participant_not_eligible');

  -- Prazo no PASSADO é recusado pelo comando (a expiração automática só
  -- acontece com prazos que JÁ FORAM futuros no momento da suspensão).
  perform pg_temp.rejects(jsonb_build_object('type','PARTICIPANT_SUSPEND','eventId','pp-s3','id',p1->>'id','data',jsonb_build_object('suspension_until',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSOF'))),'invalid_suspension_until');

  -- BANIDO não pode ser suspenso (sem downgrade de ban).
  perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_DELETE','eventId','pp-ban','id',p1->>'id'));
  perform pg_temp.rejects(jsonb_build_object('type','PARTICIPANT_SUSPEND','eventId','pp-s4','id',p1->>'id','data',jsonb_build_object('suspension_until',to_char(now()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSOF'))),'participant_banned');

  -- REATIVAR limpa status e prazo (também desfaz ban); vota de novo.
  perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_REACTIVATE','eventId','pp-r1','id',p1->>'id'));
  perform pg_temp.check_that((select status='active' and suspension_until is null from public.participants where id=(p1->>'id')::uuid),'reactivate clears status and deadline');
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','pp-b5','auctionId',a1->>'id','participantId',p1->>'id','amount',30));

  -- IDEMPOTÊNCIA: replay do MESMO eventId + MESMO payload = cache, sem erro
  -- e sem efeito colateral (o estado atual é preservado).
  perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_SUSPEND','eventId','pp-s1','id',p1->>'id','data',jsonb_build_object('suspension_until',deadline)));
  perform pg_temp.check_that((select status='active' and suspension_until is null from public.participants where id=(p1->>'id')::uuid),'replay returns the cache without side effects');
  -- MESMO eventId com payload DIFERENTE → conflito (anti-replay).
  perform pg_temp.rejects(jsonb_build_object('type','PARTICIPANT_SUSPEND','eventId','pp-s1','id',p1->>'id','data',jsonb_build_object('suspension_until',null)),'event_id_conflict');

  -- SNAPSHOT: 2 reduções via BID_CHANGED para conferir participant_warning_stats.
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','pp-up1','auctionId',a1->>'id','participantId',p1->>'id','amount',40));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','pp-down1','auctionId',a1->>'id','participantId',p1->>'id','amount',35));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','pp-up2','auctionId',a1->>'id','participantId',p1->>'id','amount',45));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','pp-down2','auctionId',a1->>'id','participantId',p1->>'id','amount',38));
  snap:=public.read_dashboard_snapshot();
  perform pg_temp.check_that((select (s->>'warnings_total')::int=2 and (s->>'warnings_cycle')::int=2
    from jsonb_array_elements(snap->'participant_warning_stats') s
    where s->>'participant_id'=p1->>'id'),'stats expose the global total and the open cycle');
  perform pg_temp.check_that((select not (snap->'participants'->0 ? 'warnings_total')
    and not (snap->'participants'->0 ? 'warnings_cycle'),'participants rows stay out of the stats contract'));
  perform pg_temp.check_that((select jsonb_array_length(coalesce(snap->'participant_warning_stats','[]'::jsonb))=1),'stats only list participants with warnings');
end $$;
reset role;
-- O RPC novo continua server-only (anon/authenticated não executam).
select pg_temp.check_that(
  not has_function_privilege('anon','public.process_auction_command(jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.process_auction_command(jsonb,uuid)','EXECUTE'),'command RPC stays server-only');
rollback;
