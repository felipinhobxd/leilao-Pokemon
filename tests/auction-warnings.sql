-- Regressão da regra de avisos globais (migration 20260923093000):
--  1. aumentar valor não gera aviso;
--  2. manter o mesmo valor não gera aviso;
--  3. cada redução gera EXATAMENTE 1 aviso global (contador por USUÁRIO,
--     acumula entre leilões diferentes);
--  4. 3 avisos => 1 única notificação de admin (idempotente por evento);
--  5. evento repetido (retry/replay) não gera aviso nem notificação dupla;
--  6. limpeza de 30 dias APAGA os leilões velhos mas PRESERVA os avisos
--     (auction_id vira NULL, contexto card_name/lot_number continua lá).
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000009');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000009','Test admin');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000009') $$;
create function pg_temp.rejects(c jsonb, expected text) returns void language plpgsql as $$
begin
  perform pg_temp.cmd(c);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare card jsonb; p1 jsonb; p2 jsonb; a1 jsonb; a2 jsonb; r jsonb;
begin
  -- Leilão 1: incremento 1, inicial 10 (ARREMATE 1000 para nunca disparar).
  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"w-card1","data":{"name":"Charizard EX","starting_price":10,"buyout_price":1000}}');
  a1:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','w-a1','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','w-open1','auctionId',a1->>'id'));
  p1:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"w-p1","data":{"display_name":"Ana","whatsapp_id":"ana","status":"active"}}');
  p2:=pg_temp.cmd('{"type":"PARTICIPANT_CREATE","eventId":"w-p2","data":{"display_name":"Bia","whatsapp_id":"bia","status":"active"}}');
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','w-b1','auctionId',a1->>'id','participantId',p1->>'id','amount',20));
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','w-b2','auctionId',a1->>'id','participantId',p2->>'id','amount',21));

  -- SUBIR valor: histórico gravado, ZERO avisos.
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-up','auctionId',a1->>'id','participantId',p1->>'id','amount',30));
  perform pg_temp.check_that((select count(*)=1 from public.value_change_log where auction_id=(a1->>'id')::uuid and previous_amount=20 and new_amount=30 and difference=10),'increase logged');
  perform pg_temp.check_that((select count(*)=0 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'increase never warns');

  -- MESMO valor (comando forjado): histórico gravado, zero avisos.
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-same','auctionId',a1->>'id','participantId',p1->>'id','amount',30));
  perform pg_temp.check_that((select count(*)=2 from public.value_change_log where auction_id=(a1->>'id')::uuid),'same value logged');
  perform pg_temp.check_that((select count(*)=0 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'same value never warns');

  -- REDUÇÃO legal (ainda >= maior lance DE OUTROS + incremento): 1º aviso.
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-down1','auctionId',a1->>'id','participantId',p1->>'id','amount',22));
  perform pg_temp.check_that((select count(*)=1 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'first decrease warns once');
  perform pg_temp.check_that((select previous_amount=30 and new_amount=22 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'warning carries the change that originated it');

  -- Redução ABAIXO do incremento de outros participantes continua barrada
  -- pelo trigger enforce_bid_increment (guarda intacta com os hooks).
  perform pg_temp.rejects(jsonb_build_object('type','BID_CHANGED','eventId','w-below','auctionId',a1->>'id','participantId',p1->>'id','amount',21),'bid_increment_required');

  -- 2º aviso no MESMO leilão; 3º aviso em OUTRO leilão (contador GLOBAL).
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-up2','auctionId',a1->>'id','participantId',p1->>'id','amount',25));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-down2','auctionId',a1->>'id','participantId',p1->>'id','amount',23));
  perform pg_temp.check_that((select count(*)=2 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'second decrease warns');

  card:=pg_temp.cmd('{"type":"CARD_CREATE","eventId":"w-card2","data":{"name":"Blastoise","starting_price":5,"buyout_price":900}}');
  a2:=pg_temp.cmd(jsonb_build_object('type','AUCTION_CREATE','eventId','w-a2','data',jsonb_build_object('card_id',card->>'id')));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','w-open2','auctionId',a2->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','BID_PLACED','eventId','w-b3','auctionId',a2->>'id','participantId',p1->>'id','amount',15));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-down3','auctionId',a2->>'id','participantId',p1->>'id','amount',12));

  -- 3 avisos globais => EXATAMENTE 1 notificação, com histórico completo.
  perform pg_temp.check_that((select count(*)=3 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'counter is global across auctions');
  perform pg_temp.check_that((select count(*)=1 from public.admin_notifications where participant_id=(p1->>'id')::uuid and kind='WARNING_THRESHOLD' and sent_at is null),'exactly three warnings fire one admin notification');
  perform pg_temp.check_that((select payload->>'total_warnings'='3' from public.admin_notifications where participant_id=(p1->>'id')::uuid),'notification reports the global total');
  perform pg_temp.check_that((select jsonb_array_length(payload->'warnings')=3 from public.admin_notifications where participant_id=(p1->>'id')::uuid),'notification carries the warning history');

  -- Replay do MESMO evento: resultado em cache, nada novo (anti-duplicação).
  r:=pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-down3','auctionId',a2->>'id','participantId',p1->>'id','amount',12));
  perform pg_temp.check_that((select count(*)=3 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'replay never double-warns');
  perform pg_temp.check_that((select count(*)=1 from public.admin_notifications where participant_id=(p1->>'id')::uuid),'replay never double-notifies');

  -- 4º aviso NÃO gera segunda notificação (gatilho é exatamente 3).
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-up3','auctionId',a2->>'id','participantId',p1->>'id','amount',20));
  perform pg_temp.cmd(jsonb_build_object('type','BID_CHANGED','eventId','w-down4','auctionId',a2->>'id','participantId',p1->>'id','amount',6));
  perform pg_temp.check_that((select count(*)=4 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'fourth decrease still warns');
  perform pg_temp.check_that((select count(*)=1 from public.admin_notifications where participant_id=(p1->>'id')::uuid),'notification fires only at exactly three');

  -- LIMPEZA: termina os leilões, empurra 40 dias para trás e roda o cleanup.
  -- Os avisos GLOBAIS têm que sobreviver (auction_id NULL + contexto intacto).
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_FINALIZE','eventId','w-final1','auctionId',a1->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_FINALIZE','eventId','w-final2','auctionId',a2->>'id'));
  update public.auctions set ended_at = now() - interval '40 days', updated_at = now() - interval '40 days' where id in ((a1->>'id')::uuid,(a2->>'id')::uuid);
  declare result jsonb;
  begin
    result:=public.cleanup_old_auctions(30);
    perform pg_temp.check_that((result->'deleted'->>'auctions')::int=2,'cleanup removed both old auctions');
  end;
  perform pg_temp.check_that((select count(*)=0 from public.auctions where id in ((a1->>'id')::uuid,(a2->>'id')::uuid)),'old auctions gone');
  perform pg_temp.check_that((select count(*)=4 from public.participant_warnings where participant_id=(p1->>'id')::uuid),'global warnings survive the cleanup');
  perform pg_temp.check_that((select count(*)=4 and bool_and(auction_id is null) from public.participant_warnings where participant_id=(p1->>'id')::uuid),'surviving warnings keep denormalized context with null auction');
  perform pg_temp.check_that((select bool_and(card_name is not null) from public.participant_warnings where participant_id=(p1->>'id')::uuid),'card_name context preserved');
end $$;
reset role;
-- Browser readers: active staff only.
set local role authenticated;
select pg_temp.check_that((select count(*)=0 from public.value_change_log),'non-staff cannot read warnings tables');
rollback;
