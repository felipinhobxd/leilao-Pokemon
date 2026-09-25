-- 2026-09-25 round: REALLY delete an auction (operator request).
--
-- Test auctions were polluting the Excel export forever: AUCTION_DELETE only
-- sets status='cancelled' (audit trail). New RPC delete_auction removes the
-- auction AND its whole tree (bids, votes, dispatches, events, purchases,
-- payments, deliveries, value history) FK-safe, same discipline as
-- cleanup_old_auctions; the card goes too when orphaned. Guarded by the
-- typed phrase 'sim quero' (UI + API + RPC, same triple check as purge).
-- participant_warnings SURVIVE (auction_id SET NULL - global counter intact).
begin;

create or replace function public.delete_auction(p_auction_id uuid,p_confirm text,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a public.auctions;
  c public.cards;
  n_payments bigint; n_reminders bigint; n_deliveries bigint; n_purchases bigint;
  n_votes bigint; n_dispatches bigint; n_events bigint; n_bids bigint;
  n_values bigint; card_orphaned boolean;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_confirm),'') <> 'sim quero' then raise exception 'delete_not_confirmed'; end if;
  select * into a from public.auctions where id=p_auction_id for update;
  if not found then raise exception 'auction_not_found'; end if;
  if a.status='open' then raise exception 'auction_not_deletable'; end if;
  select * into c from public.cards where id=a.card_id;

  perform set_config('app.admin_user_id',p_admin_user_id::text,true);
  -- immutable_audit blocks DELETE on auction_events: dropped and recreated
  -- INSIDE the transaction (rollback restores) - same dance as
  -- cleanup_old_auctions / purge_all_business_data.
  execute 'drop trigger if exists immutable_audit on public.auction_events';

  with gone as (delete from public.payments pay
     where pay.purchase_id in (select pr.id from public.purchases pr where pr.auction_id=a.id) returning 1)
    select count(*) into n_payments from gone;
  with gone as (delete from public.payment_reminders rem
     where rem.purchase_id in (select pr.id from public.purchases pr where pr.auction_id=a.id) returning 1)
    select count(*) into n_reminders from gone;
  with gone as (delete from public.deliveries del
     where del.purchase_id in (select pr.id from public.purchases pr where pr.auction_id=a.id) returning 1)
    select count(*) into n_deliveries from gone;
  with gone as (delete from public.purchases pr where pr.auction_id=a.id returning 1)
    select count(*) into n_purchases from gone;
  with gone as (delete from public.whatsapp_vote_state vs where vs.auction_id=a.id returning 1)
    select count(*) into n_votes from gone;
  with gone as (delete from public.value_change_log vcl where vcl.auction_id=a.id returning 1)
    select count(*) into n_values from gone;
  with gone as (delete from public.whatsapp_dispatches dd where dd.auction_id=a.id returning 1)
    select count(*) into n_dispatches from gone;
  with gone as (delete from public.auction_events ev where ev.auction_id=a.id returning 1)
    select count(*) into n_events from gone;
  with gone as (delete from public.bids bi where bi.auction_id=a.id returning 1)
    select count(*) into n_bids from gone;
  -- participant_warnings.auction_id é SET NULL: avisos globais sobrevivem.
  delete from public.auctions where id=a.id;
  -- A carta vai junto SÓ quando não sobra nenhum outro leilão dela
  -- (teste criado pelo wizard: some de vez do Excel; carta real com
  -- histórico em outro leilão fica).
  select not exists(select 1 from public.auctions au where au.card_id=c.id) into card_orphaned;
  if card_orphaned then delete from public.cards where id=c.id; end if;

  execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';

  return jsonb_build_object(
    'lot_number',a.lot_number,'card_name',c.name,'card_deleted',card_orphaned,
    'deleted',jsonb_build_object('payments',n_payments,'reminders',n_reminders,'deliveries',n_deliveries,
      'purchases',n_purchases,'vote_state',n_votes,'value_change_log',n_values,
      'dispatches',n_dispatches,'events',n_events,'bids',n_bids));
end $$;
revoke execute on function public.delete_auction(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_auction(uuid,text,uuid) to service_role;

commit;
