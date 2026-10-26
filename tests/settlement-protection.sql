-- Disposable database only. Updated operator policy: automatic cleanup includes sales.
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
 perform public.test_confirm_backup();
 result:=public.cleanup_old_auctions();
 if (result->'deleted'->>'auctions')::int<>5 or (result->'deleted'->>'purchases')::int<>4 then raise exception 'authorized_sale_cleanup_wrong: %',result; end if;
 if exists(select 1 from public.purchases) or exists(select 1 from public.payments) or exists(select 1 from public.deliveries) or exists(select 1 from public.payment_reminders) then raise exception 'financial_children_not_removed'; end if;
 if exists(select 1 from public.auction_events where event_type='settlement_history') then raise exception 'sale_audit_not_removed'; end if;

end $$;
reset role;
rollback;
