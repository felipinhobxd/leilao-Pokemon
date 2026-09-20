begin;

create or replace function public.purge_all_business_data(p_confirm text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 n_payments bigint; n_deliveries bigint; n_purchases bigint; n_warnings bigint;
 n_votes bigint; n_dispatches bigint; n_queues bigint; n_events bigint;
 n_bids bigint; n_auctions bigint; n_cards bigint; n_identities bigint;
 n_participants bigint; n_commands bigint; n_bot_commands bigint;
begin
 if coalesce(p_confirm,'') <> 'quero excluir mesmo' then raise exception 'purge_not_confirmed'; end if;

 execute 'drop trigger if exists immutable_audit on public.auction_events';

 with gone as (delete from public.payments where true returning 1) select count(*) into n_payments from gone;
 with gone as (delete from public.deliveries where true returning 1) select count(*) into n_deliveries from gone;
 with gone as (delete from public.purchases where true returning 1) select count(*) into n_purchases from gone;
 with gone as (delete from public.warnings where true returning 1) select count(*) into n_warnings from gone;
 with gone as (delete from public.whatsapp_vote_state where true returning 1) select count(*) into n_votes from gone;
 with gone as (delete from public.whatsapp_dispatches where true returning 1) select count(*) into n_dispatches from gone;
 with gone as (delete from public.auction_publish_queues where true returning 1) select count(*) into n_queues from gone;
 with gone as (delete from public.auction_events where true returning 1) select count(*) into n_events from gone;
 with gone as (delete from public.bids where true returning 1) select count(*) into n_bids from gone;
 with gone as (delete from public.auctions where true returning 1) select count(*) into n_auctions from gone;
 with gone as (delete from public.cards where true returning 1) select count(*) into n_cards from gone;
 with gone as (delete from public.participant_identities where true returning 1) select count(*) into n_identities from gone;
 with gone as (delete from public.participants where true returning 1) select count(*) into n_participants from gone;
 with gone as (delete from public.processed_commands where true returning 1) select count(*) into n_commands from gone;
 with gone as (delete from public.whatsapp_bot_commands where true returning 1) select count(*) into n_bot_commands from gone;

 execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';

 execute 'alter sequence public.auction_lot_number_seq restart with 1';
 execute 'alter sequence public.bids_confirmation_order_seq restart with 1';

 return jsonb_build_object(
   'deleted', jsonb_build_object(
     'payments', n_payments, 'deliveries', n_deliveries, 'purchases', n_purchases,
     'warnings', n_warnings, 'vote_state', n_votes, 'dispatches', n_dispatches,
     'queues', n_queues, 'events', n_events, 'bids', n_bids, 'auctions', n_auctions,
     'cards', n_cards, 'identities', n_identities, 'participants', n_participants,
     'commands', n_commands, 'bot_commands', n_bot_commands),
   'sequences_reset', true);
end $$;

revoke execute on function public.purge_all_business_data(text) from public,anon,authenticated;
grant execute on function public.purge_all_business_data(text) to service_role;

commit;
