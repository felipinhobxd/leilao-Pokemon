-- Regressão da rodada 2026-09-24 (migration 20260924180000): o painel ao vivo
-- ENXERGA as alterações de valores e os avisos globais.
-- Decisão do operador (re-confirmada 2026-09-24): o participante NÃO recebe
-- DM — a redução só CONTA no avisômetro global; aos 3 exatos os admins são
-- acionados (admin_notifications → bot, ver tests/auction-warnings.sql).
-- Aqui valida-se o que o DASHBOARD consome:
--  1. uma redução real gera 1 linha em participant_warnings com contexto
--     lote/carta/valores/horário (é o que a tela lista);
--  2. subir valor não gera aviso;
--  3. o snapshot do dashboard expõe participant_warnings e value_change_log
--     (bounded 100, mais recentes primeiro).
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000051');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000051','Test admin');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000051') $$;
set local role service_role;
do $$
declare card jsonb; p1 jsonb; a1 jsonb; snap jsonb;
begin
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"n-card1","data":{"name":"Gengar","starting_price":10,"buyout_price":1000}}');
  a1:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','n-a1','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','n-open1','auctionId',a1->>'id'));
  p1:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"n-p1","data":{"display_name":"Ana","whatsapp_id":"ana-notice","status":"active"}}');
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','n-b1','auctionId',a1->>'id','participantId',p1->>'id','amount',20));

  -- SUBIR valor: histórico no value_change_log, ZERO avisos.
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','n-up','auctionId',a1->>'id','participantId',p1->>'id','amount',30));
  perform pg_temp.check_that((select count(*)=0 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'increase never warns');

  -- REDUÇÃO: 1 aviso global com o contexto que a TELA lista (lote, carta,
  -- valores, horário). Sem DM ao participante (decisão do operador).
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','n-down','auctionId',a1->>'id','participantId',p1->>'id','amount',22));
  perform pg_temp.check_that((select count(*)=1 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'decrease warns once');
  perform pg_temp.check_that((select lot_number is not null and card_name='Gengar' and previous_amount=30 and new_amount=22 and occurred_at is not null from public.participant_warnings where participant_id=(p1->>'id')::uuid),'warning carries poll/lot, card, values and time');

  -- Snapshot do DASHBOARD: as duas tabelas ao vivo (o painel antes só via
  -- isso no Excel).
  snap:=public.read_dashboard_snapshot();
  perform pg_temp.check_that((select jsonb_array_length(coalesce(snap->'participant_warnings','[]'::jsonb))=1),'dashboard snapshot exposes participant_warnings');
  perform pg_temp.check_that((select (snap->'participant_warnings'->0->>'lot_number') is not null and (snap->'participant_warnings'->0->>'card_name')='Gengar'),'snapshot warning carries lot and card');
  perform pg_temp.check_that((select jsonb_array_length(coalesce(snap->'value_change_log','[]'::jsonb))=2),'dashboard snapshot exposes value_change_log');
end $$;
reset role;
rollback;
