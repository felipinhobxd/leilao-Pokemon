-- Disposable database only. No business deletion is exercised in production.
begin;
insert into public.participants(id,whatsapp_id,display_name) values('10000000-0000-0000-0000-000000000099','settlement-test','Pós-venda');
insert into public.cards(id,name,starting_price) select ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Financeiro '||i,5 from generate_series(1,5) i;
insert into public.auctions(id,card_id,status,starting_price,ended_at)
 select ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'sold',5,now()-interval '20 days' from generate_series(1,5) i;
insert into public.purchases(id,auction_id,participant_id,card_id,amount)
 select ('40000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000099',('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,100 from generate_series(1,4) i;
insert into public.payments(purchase_id,amount,status)
 select id,100,(case right(id::text,1) when '1' then 'pending' when '2' then 'partial' when '3' then 'paid' else 'refunded' end)::public.payment_status from public.purchases;
insert into public.deliveries(purchase_id,status) select id,'waiting_payment' from public.purchases;
insert into public.payment_reminders(purchase_id,participant_id) select id,participant_id from public.purchases;
insert into public.auction_events(auction_id,event_type,created_at) select auction_id,'settlement_history',now()-interval '20 days' from public.purchases;
set local role service_role;
do $$ declare result jsonb; begin
 result:=public.cleanup_old_auctions();
 if (result->>'preserved_financial_auctions')::int<>4 or (result->'deleted'->>'auctions')::int<>1 then raise exception 'financial_cleanup_selection_wrong: %',result; end if;
 if (select count(*) from public.purchases)<>4 or (select count(*) from public.payments)<>4 or (select count(*) from public.deliveries)<>4 or (select count(*) from public.payment_reminders)<>4 then raise exception 'financial_tree_lost'; end if;
 if (select count(*) from public.auction_events where event_type='settlement_history')<>4 then raise exception 'financial_audit_pruned'; end if;
 if exists(select 1 from public.auctions where id='30000000-0000-0000-0000-000000000005') then raise exception 'nonfinancial_cleanup_stopped'; end if;
end $$;
reset role;
rollback;
