-- 2026-10-08: P-17 (decisão do operador: janela de 7 DIAS) — prune da
-- auditoria (auction_events) e do cache de idempotência (processed_commands).
--
-- Raiz do incidente de 2026-10-08: ~39 mil auction_events com auction_id NULL
-- (linhas do trigger audit_admin_change — dispara a CADA UPDATE de
-- participants/cards/auctions, inclusive last_seen_at, com payload
-- before/after completo = 99,6% da tabela) e processed_commands (~1 linha por
-- comando, nunca limpos) engordam o export_business_backup para sempre. No
-- free tier, gerar o backup satura o compute por ~1min e o Supabase responde
-- 520/521/525 para TUDO (derrubando até o bot). A limpeza 12h existente só
-- remove leilões terminais + suas árvores — nunca essas duas tabelas.
--
-- Janela: p_audit_days (default 7, piso 1). Idempotência real precisa de
-- segundos (retries do bot); eventIds de voto carregam timestamp único e o
-- dashboard usa crypto.randomUUID — 7 dias é folgado (docs/agent/11 P-17).
--
-- LATEST body: 20261006192241 (backup guard v2), copiado VERBATIM com as
-- adições marcadas. A assinatura GANHA p_audit_days — Postgres não aceita
-- CREATE OR REPLACE com assinatura diferente (geraria overload), então DROP +
-- CREATE; o revoke/grant do fim reestabelece as permissões (mesma técnica de
-- 20261006192053). A chamada do bot (só p_hours) continua resolvendo via
-- default — ZERO mudança em bot/.
begin;

drop function if exists public.cleanup_old_auctions(integer);

CREATE OR REPLACE FUNCTION public.cleanup_old_auctions(p_hours integer DEFAULT 12, p_audit_days integer DEFAULT 7)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
declare
  cutoff timestamptz:=clock_timestamp()-make_interval(hours=>greatest(coalesce(p_hours,12),1));
  -- ADDITION (P-17, 2026-10-08): janela de prune da auditoria/idempotência.
  audit_cutoff timestamptz:=clock_timestamp()-make_interval(days=>greatest(coalesce(p_audit_days,7),1));
  card_ids uuid[];
  n_payments bigint:=0; n_deliveries bigint:=0; n_purchases bigint:=0; n_warnings bigint:=0; n_votes bigint:=0;
  n_dispatches bigint:=0; n_queues bigint:=0; n_events bigint:=0; n_bids bigint:=0; n_changes bigint:=0;
  n_auctions bigint:=0; n_cards bigint:=0; n_tmp bigint:=0;
  -- ADDITION (P-17, 2026-10-08): contadores do prune.
  n_audit_events bigint:=0; n_commands bigint:=0;
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id='business-backups'
      and name like 'backups/backup-' || to_char(clock_timestamp(),'YYYYMMDD') || '-%.json'
  ) then
    return jsonb_build_object(
      'cutoff', cutoff, 'blocked', true, 'reason', 'daily_cloud_backup_missing',
      'deleted', jsonb_build_object('payments',0,'deliveries',0,'purchases',0,'warnings',0,'vote_state',0,'dispatches',0,'queues',0,'events',0,'bids',0,'value_changes',0,'auctions',0,'cards',0,'audit_events',0,'processed_commands',0)
    );
  end if;
  execute 'drop trigger if exists immutable_audit on public.auction_events';
  with gone as (delete from public.payments pu using public.purchases z join public.auctions a on a.id=z.auction_id
    where pu.purchase_id=z.id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_payments from gone;
  with gone as (delete from public.deliveries dl using public.purchases z join public.auctions a on a.id=z.auction_id
    where dl.purchase_id=z.id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_deliveries from gone;
  with gone as (delete from public.purchases z using public.auctions a
    where a.id=z.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_purchases from gone;
  with gone as (delete from public.warnings w using public.auctions a
    where a.id=w.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_warnings from gone;
  with gone as (delete from public.whatsapp_vote_state v using public.auctions a
    where a.id=v.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_votes from gone;
  with gone as (delete from public.whatsapp_dispatches dd using public.auctions a
    where a.id=dd.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_dispatches from gone;
  with gone as (delete from public.whatsapp_dispatches dd using public.auction_publish_queues q
    where q.id=dd.queue_id and q.created_at<cutoff and q.status in ('completed','cancelled') returning 1)
  select coalesce((select count(*) from gone),0) into n_tmp;
  n_dispatches:=n_dispatches+n_tmp;
  with gone as (delete from public.auction_publish_queues q where q.created_at<cutoff and q.status in ('completed','cancelled') returning 1)
  select count(*) into n_queues from gone;
  with gone as (delete from public.auction_events e using public.auctions a
    where a.id=e.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_events from gone;
  with gone as (delete from public.bids b2 using public.auctions a
    where a.id=b2.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_bids from gone;
  with gone as (delete from public.value_change_log vc using public.auctions a
    where a.id=vc.auction_id and coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning 1)
  select count(*) into n_changes from gone;
  with gone as (delete from public.auctions a where coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff and a.status in ('closed','sold','cancelled') returning a.card_id)
  select count(*), coalesce(array_agg(distinct card_id) filter (where card_id is not null), '{}'::uuid[]) into n_auctions, card_ids from gone;
  -- Only cards orphaned BY THIS RUN are deleted: a standalone card (manual
  -- or brinde, never auctioned) survives the cleanup untouched.
  with gone as (delete from public.cards c where c.id = any(card_ids) and not exists(select 1 from public.auctions a where a.card_id=c.id) returning 1)
  select count(*) into n_cards from gone;
  -- ADDITION (P-17, 2026-10-08): prune da auditoria e do cache de
  -- idempotência além da janela de p_audit_days (default 7 dias). O trigger
  -- immutable_audit está derrubado desde o topo e volta logo abaixo — o
  -- prune só acontece dentro desta transação, protegida pelo guard de
  -- backup do dia. Eventos NOVOS (< janela) sobrevivem, inclusive os de
  -- filas futuras recém-criadas; guardas de negócio (stale_event) leem
  -- eventos do leilão EM DISPUTA (minutos/horas), nunca de 7 dias atrás.
  with gone as (delete from public.auction_events where created_at < audit_cutoff returning 1)
  select count(*) into n_audit_events from gone;
  with gone as (delete from public.processed_commands where created_at < audit_cutoff returning 1)
  select count(*) into n_commands from gone;
  execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';
  return jsonb_build_object('cutoff',cutoff,'deleted',jsonb_build_object(
   'payments',n_payments,'deliveries',n_deliveries,'purchases',n_purchases,'warnings',n_warnings,
   'vote_state',n_votes,'dispatches',n_dispatches,'queues',n_queues,'events',n_events,'bids',n_bids,
   'value_changes',n_changes,'auctions',n_auctions,'cards',n_cards,
   'audit_events',n_audit_events,'processed_commands',n_commands));
end
$function$;

revoke execute on function public.cleanup_old_auctions(integer,integer) from public,anon,authenticated;
grant execute on function public.cleanup_old_auctions(integer,integer) to service_role;

commit;
