-- Cleanup retention (12 hours, 2026-10-05 — era 24h; antes piso de 30 dias).
-- 1. um leilão terminal de 30 minutos SOBREVIVE ao cleanup padrão (12h);
-- 2. um leilão terminal de 2 horas é APAGADO com p_hours=1 — granularidade em
--    HORAS (com o antigo parâmetro em dias ele sobreviveria);
-- 3. um leilão terminal de 6 horas SOBREVIVE ao padrão (janela >= 6h);
-- 4. um leilão terminal de 13 horas é APAGADO pelo padrão (janela < 24h).
begin;

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000092');
insert into public.admin_profiles(user_id,display_name)
values ('00000000-0000-0000-0000-000000000092','Cleanup retention test');

set local role service_role;

do $$
declare
  card jsonb;
  auction jsonb;
  result jsonb;
  aid uuid;
begin
  -- Lote 1: cria, abre e finaliza (sem lances -> terminal 'closed').
  card := public.process_auction_command(
    jsonb_build_object(
      'type','CARD_CREATE',
      'eventId','cleanup-retention-card',
      'data',jsonb_build_object('name','Cleanup Retention One','starting_price',5)
    ),
    '00000000-0000-0000-0000-000000000092'
  );
  auction := public.process_auction_command(
    jsonb_build_object(
      'type','AUCTION_CREATE',
      'eventId','cleanup-retention-auction',
      'data',jsonb_build_object('card_id',card->>'id')
    ),
    '00000000-0000-0000-0000-000000000092'
  );
  aid := (auction->>'id')::uuid;

  perform public.process_auction_command(
    jsonb_build_object('type','AUCTION_OPEN','eventId','cleanup-retention-open','auctionId',aid),
    '00000000-0000-0000-0000-000000000092'
  );
  perform public.process_auction_command(
    jsonb_build_object('type','AUCTION_FINALIZE','eventId','cleanup-retention-finalize','auctionId',aid),
    '00000000-0000-0000-0000-000000000092'
  );

  -- (1) Terminal de 30 minutos: o padrao (12h) tem que mante-lo.
  update public.auctions
     set ended_at=now()-interval '30 minutes',
         updated_at=now()-interval '30 minutes'
   where id=aid;
  result := public.cleanup_old_auctions();
  if not exists(select 1 from public.auctions where id=aid) then
    raise exception 'ASSERT_FAILED: default retention deleted a 30-minute-old auction';
  end if;

  -- (2) Terminal de 2 horas + p_hours=1 => apagado. E a prova de que o
  -- parametro agora e em HORAS: com piso de 1 DIA ele sobreviveria.
  update public.auctions
     set ended_at=now()-interval '2 hours',
         updated_at=now()-interval '2 hours'
   where id=aid;
  result := public.cleanup_old_auctions(1);
  if exists(select 1 from public.auctions where id=aid) then
    raise exception 'ASSERT_FAILED: p_hours=1 kept a 2-hour-old auction';
  end if;
  if coalesce((result->'deleted'->>'auctions')::int,0) < 1 then
    raise exception 'ASSERT_FAILED: cleanup did not report the deleted auction';
  end if;

  -- Lote 2: os dois lados da janela padrao de 12h.
  card := public.process_auction_command(
    jsonb_build_object(
      'type','CARD_CREATE',
      'eventId','cleanup-retention-card-2',
      'data',jsonb_build_object('name','Cleanup Retention Two','starting_price',5)
    ),
    '00000000-0000-0000-0000-000000000092'
  );
  auction := public.process_auction_command(
    jsonb_build_object(
      'type','AUCTION_CREATE',
      'eventId','cleanup-retention-auction-2',
      'data',jsonb_build_object('card_id',card->>'id')
    ),
    '00000000-0000-0000-0000-000000000092'
  );
  aid := (auction->>'id')::uuid;

  perform public.process_auction_command(
    jsonb_build_object('type','AUCTION_OPEN','eventId','cleanup-retention-open-2','auctionId',aid),
    '00000000-0000-0000-0000-000000000092'
  );
  perform public.process_auction_command(
    jsonb_build_object('type','AUCTION_FINALIZE','eventId','cleanup-retention-finalize-2','auctionId',aid),
    '00000000-0000-0000-0000-000000000092'
  );

  -- (3) Terminal de 6 horas: ainda dentro da janela de 12h.
  update public.auctions
     set ended_at=now()-interval '6 hours',
         updated_at=now()-interval '6 hours'
   where id=aid;
  result := public.cleanup_old_auctions();
  if not exists(select 1 from public.auctions where id=aid) then
    raise exception 'ASSERT_FAILED: 6-hour-old auction disappeared (default retention should be 12h)';
  end if;

  -- (4) Terminal de 13 horas: alem da janela de 12h => apagado.
  update public.auctions
     set ended_at=now()-interval '13 hours',
         updated_at=now()-interval '13 hours'
   where id=aid;
  result := public.cleanup_old_auctions();
  if exists(select 1 from public.auctions where id=aid) then
    raise exception 'ASSERT_FAILED: 13-hour-old auction survived the 12h retention';
  end if;
  if coalesce((result->'deleted'->>'auctions')::int,0) < 1 then
    raise exception 'ASSERT_FAILED: cleanup did not report the deleted auction';
  end if;
end $$;

reset role;
rollback;

select 'CLEANUP_RETENTION_OK' as result;
