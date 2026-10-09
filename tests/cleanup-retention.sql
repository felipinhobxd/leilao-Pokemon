-- Cleanup retention (12 hours, 2026-10-05 — era 24h; antes piso de 30 dias).
-- 1. um leilão terminal de 30 minutos SOBREVIVE ao cleanup padrão (12h);
-- 2. um leilão terminal de 2 horas é APAGADO com p_hours=1 — granularidade em
--    HORAS (com o antigo parâmetro em dias ele sobreviveria);
-- 3. um leilão terminal de 6 horas SOBREVIVE ao padrão (janela >= 6h);
-- 4. um leilão terminal de 13 horas é APAGADO pelo padrão (janela > 12h).
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

  -- (5) P-17 (2026-10-08): auditoria (auction_events) e cache de idempotência
  --     (processed_commands) são PODADOS com janela de 7 dias (p_audit_days).
  -- 5a. Semear os dois lados da janela: 8 dias (vai embora) e 1 dia (fica).
  insert into public.auction_events(admin_user_id,event_type,external_event_id,created_at)
  values ('00000000-0000-0000-0000-000000000092','participants_UPDATE','prune-old-audit',now()-interval '8 days');
  insert into public.auction_events(admin_user_id,event_type,external_event_id,created_at)
  values ('00000000-0000-0000-0000-000000000092','participants_UPDATE','prune-fresh-audit',now()-interval '1 day');
  insert into public.processed_commands(external_event_id,request,result,created_at)
  values ('prune-old-command','{}'::jsonb,'{}'::jsonb,now()-interval '8 days');
  insert into public.processed_commands(external_event_id,request,result,created_at)
  values ('prune-fresh-command','{}'::jsonb,'{}'::jsonb,now()-interval '1 day');

  result := public.cleanup_old_auctions();
  if exists(select 1 from public.auction_events where external_event_id='prune-old-audit') then
    raise exception 'ASSERT_FAILED: 8-day-old audit event survived the 7-day prune';
  end if;
  if not exists(select 1 from public.auction_events where external_event_id='prune-fresh-audit') then
    raise exception 'ASSERT_FAILED: fresh audit event was pruned by the 7-day window';
  end if;
  if exists(select 1 from public.processed_commands where external_event_id='prune-old-command') then
    raise exception 'ASSERT_FAILED: 8-day-old processed_commands row survived the 7-day prune';
  end if;
  if not exists(select 1 from public.processed_commands where external_event_id='prune-fresh-command') then
    raise exception 'ASSERT_FAILED: fresh processed_commands row was pruned by the 7-day window';
  end if;
  if coalesce((result->'deleted'->>'audit_events')::int,0) < 1 then
    raise exception 'ASSERT_FAILED: cleanup did not report pruned audit events';
  end if;
  if coalesce((result->'deleted'->>'processed_commands')::int,0) < 1 then
    raise exception 'ASSERT_FAILED: cleanup did not report pruned processed_commands';
  end if;

  -- 5b. Eventos de negócio FRESCOS (deste teste, < 1 dia) sobrevivem ao prune
  --     padrão — o prune nunca interfere na janela de disputa real.
  if not exists(select 1 from public.auction_events where external_event_id='cleanup-retention-card') then
    raise exception 'ASSERT_FAILED: fresh business event was pruned';
  end if;
  if not exists(select 1 from public.processed_commands where external_event_id='cleanup-retention-card') then
    raise exception 'ASSERT_FAILED: fresh idempotency cache was pruned';
  end if;

  -- 5c. Granularidade: p_audit_days=1 apaga também o evento/comando de 1 dia.
  result := public.cleanup_old_auctions(12, 1);
  if exists(select 1 from public.auction_events where external_event_id='prune-fresh-audit') then
    raise exception 'ASSERT_FAILED: p_audit_days=1 did not prune the 1-day-old audit event';
  end if;
  if not exists(select 1 from public.auction_events where external_event_id='cleanup-retention-card') then
    raise exception 'ASSERT_FAILED: p_audit_days=1 pruned events created minutes ago';
  end if;

  -- 5d. O trigger immutable_audit VOLTOU depois do prune: UPDATE em
  --     auction_events volta a ser bloqueado (append-only preservado).
  begin
    update public.auction_events set payload=payload where external_event_id='cleanup-retention-card';
    raise exception 'ASSERT_FAILED: immutable_audit trigger did not come back after the prune';
  exception when others then
    if sqlerrm <> 'audit_is_append_only' then
      raise;
    end if;
  end;
end $$;

reset role;
rollback;

select 'CLEANUP_RETENTION_OK' as result;
