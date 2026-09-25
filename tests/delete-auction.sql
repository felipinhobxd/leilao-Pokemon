-- Regressão da rodada 2026-09-25 (migration 20260924220000): excluir leilão
-- DE VERDADE (leilões de teste saem do Excel).
--  1. frase "sim quero" obrigatória (tripla UI→API→RPC; aqui o RPC);
--  2. leilão aberto não pode ser excluído (auction_not_deletable);
--  3. exclusão apaga a árvore inteira (bids, eventos, dispatches, compras,
--     pagamentos, entregas, histórico de valores) FK-safe;
--  4. carta órfã vai junto; carta com OUTRO leilão fica;
--  5. participant_warnings SOBREVIVE com auction_id NULL (contador global);
--  6. audit trigger immutable_audit é restaurado (DELETE em auction_events
--     volta a ser bloqueado).
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000071');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000071','Test admin');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000071') $$;
create function pg_temp.rejects_delete(p uuid, phrase text, expected text) returns void language plpgsql as $$
begin
  perform public.delete_auction(p,phrase,'00000000-0000-0000-0000-000000000071');
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare card jsonb; a1 jsonb; a2 jsonb; p1 jsonb; result jsonb; aid uuid; aid2 uuid;
begin
  -- Carta A: leilão de teste com lance, redução (aviso) e compra (buyout).
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"d-card1","data":{"name":"Teste Excel A","starting_price":5,"buyout_price":50}}');
  a1:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','d-a1','data',jsonb_build_object('card_id',card->>'id')));
  aid:=(a1->>'id')::uuid;
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','d-open1','auctionId',a1->>'id'));
  p1:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"d-p1","data":{"display_name":"Zé Teste","whatsapp_id":"ze-teste","status":"active"}}');
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','d-b1','auctionId',a1->>'id','participantId',p1->>'id','amount',10));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','d-b2','auctionId',a1->>'id','participantId',p1->>'id','amount',6));
  perform pg_temp.cmd(jsonb_build_object('type','BUYOUT_CONFIRMED','eventId','d-buy','auctionId',a1->>'id','participantId',p1->>'id'));
  perform pg_temp.check_that((select count(*)=1 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'warning exists before delete');

  -- 1) frase errada rejeitada; 2) aberto não exclui (novo leilão aberto).
  perform pg_temp.rejects_delete(aid,'nao quero','delete_not_confirmed');
  perform pg_temp.rejects_delete(aid,'sim quero ','delete_not_confirmed');
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"d-card2","data":{"name":"Aberto","starting_price":5}}');
  a2:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','d-a2','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','d-open2','auctionId',a2->>'id'));
  perform pg_temp.rejects_delete((a2->>'id')::uuid,'sim quero','auction_not_deletable');
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_FINALIZE','eventId','d-fin2','auctionId',a2->>'id'));

  -- 3..5) Exclusão REAL do leilão vendido.
  result:=public.delete_auction(aid,'sim quero','00000000-0000-0000-0000-000000000071');
  perform pg_temp.check_that((result->>'lot_number') is not null,'result carries lot number');
  perform pg_temp.check_that((select count(*)=0 from public.auctions where id=aid),'auction gone');
  perform pg_temp.check_that((select count(*)=0 from public.bids where auction_id=aid),'bids gone');
  perform pg_temp.check_that((select count(*)=0 from public.auction_events where auction_id=aid),'events gone');
  perform pg_temp.check_that((select count(*)=0 from public.purchases where auction_id=aid),'purchases gone');
  perform pg_temp.check_that((select count(*)=0 from public.cards where name='Teste Excel A'),'orphan card deleted');
  perform pg_temp.check_that((select count(*)=1 and bool_and(auction_id is null) from public.participant_warnings where participant_id=(p1->>'id')::uuid),'global warning SURVIVES with null auction');
  -- Carta com OUTRO leilão fica: cria segunda carta com 2 leilões, exclui 1.
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"d-card3","data":{"name":"Com Historico","starting_price":5}}');
  a1:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','d-a3','data',jsonb_build_object('card_id',card->>'id')));
  a2:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','d-a4','data',jsonb_build_object('card_id',card->>'id')));
  result:=public.delete_auction((a2->>'id')::uuid,'sim quero','00000000-0000-0000-0000-000000000071');
  perform pg_temp.check_that((result->>'card_deleted')='false','card with another auction SURVIVES');
  perform pg_temp.check_that((select count(*)=1 from public.cards where name='Com Historico'),'card kept');

  -- 6) immutable_audit restaurado: DELETE manual em auction_events bloqueia.
  begin
    delete from public.auction_events where id=(select min(id) from public.auction_events);
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then
    if sqlerrm='EXPECTED_ERROR_NOT_RAISED' then raise exception 'audit trigger must be restored after delete_auction'; end if;
  end;
end $$;
reset role;
rollback;
