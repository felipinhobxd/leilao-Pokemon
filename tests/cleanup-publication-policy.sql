-- Explicit operator policy: all completed outcomes after 12h from publication.
begin;
insert into public.participants(id,display_name,whatsapp_id) values('10000000-0000-0000-0000-000000000095','Retention buyer','retention-buyer');
insert into public.whatsapp_groups(id,name,group_jid) values('50000000-0000-0000-0000-000000000095','Retention group','retention@g.us');
insert into public.cards(id,name,starting_price)
 select ('20000000-0000-0000-0000-'||lpad((950+i)::text,12,'0'))::uuid,'Policy '||i,5 from generate_series(1,7)i;
insert into public.auctions(id,card_id,status,starting_price,started_at,ended_at,created_at)
 select ('30000000-0000-0000-0000-'||lpad((950+i)::text,12,'0'))::uuid,
 ('20000000-0000-0000-0000-'||lpad((950+i)::text,12,'0'))::uuid,
 (case i when 1 then 'open' when 2 then 'closed' when 3 then 'open' when 4 then 'review_required' when 5 then 'draft' when 6 then 'draft' else 'sold' end)::public.auction_status,
 5,case when i in (5,6) then null else now()-make_interval(hours=>case when i=2 then 11 else 14 end) end,
 case when i in (1,2,7) then now()-interval '30 minutes' else null end,now()-interval '15 hours'
 from generate_series(1,7)i;
insert into public.bids(auction_id,participant_id,amount)
 values('30000000-0000-0000-0000-000000000951','10000000-0000-0000-0000-000000000095',50);
update public.auctions set status='sold',winner_participant_id='10000000-0000-0000-0000-000000000095',final_price=50,win_type='buyout'
 where id='30000000-0000-0000-0000-000000000951';
insert into public.whatsapp_dispatches(auction_id,group_id,scheduled_at,poll_options,status,announcement_sent_at,poll_sent_at)
 select ('30000000-0000-0000-0000-'||lpad((950+i)::text,12,'0'))::uuid,'50000000-0000-0000-0000-000000000095',now()-interval '14 hours','["5","10"]'::jsonb,
 case when i=5 then 'failed' when i=6 then 'scheduled' else 'sent' end,
 case when i=6 then null else now()-interval '13 hours' end,
 case when i in (5,6) then null when i=7 then now()-interval '2 hours' else now()-interval '13 hours' end
 from unnest(array[1,5,6,7]) i;
insert into public.purchases(id,auction_id,participant_id,card_id,amount)
 values('40000000-0000-0000-0000-000000000095','30000000-0000-0000-0000-000000000951','10000000-0000-0000-0000-000000000095','20000000-0000-0000-0000-000000000951',50);
insert into public.payments(purchase_id,amount,status) values('40000000-0000-0000-0000-000000000095',50,'paid');
insert into public.deliveries(purchase_id,status) values('40000000-0000-0000-0000-000000000095','waiting_payment');
insert into public.payment_reminders(purchase_id,participant_id) values('40000000-0000-0000-0000-000000000095','10000000-0000-0000-0000-000000000095');
set local role service_role;
do $$ declare r jsonb; begin
 perform public.test_confirm_backup();
 update public.business_backup_receipts set coverage=coverage-'payments'-'purchases'-'deliveries'-'payment_reminders';
 if public.has_confirmed_business_backup(now()-interval '1 day') then raise exception 'legacy_manifest_authorized_financial_backup'; end if;
 if public.cleanup_old_auctions()->>'reason'<>'backup_coverage_incomplete' then raise exception 'legacy_manifest_allowed_financial_delete'; end if;
 perform public.test_confirm_backup();
 update public.payments set amount=49 where purchase_id='40000000-0000-0000-0000-000000000095';
 if public.cleanup_old_auctions()->>'reason'<>'backup_coverage_incomplete' then raise exception 'payment_changed_after_snapshot_not_protected'; end if;
 perform public.test_confirm_backup();
 update public.payment_reminders set reminded_count=1 where purchase_id='40000000-0000-0000-0000-000000000095';
 if public.cleanup_old_auctions()->>'reason'<>'backup_coverage_incomplete' then raise exception 'reminder_changed_after_snapshot_not_protected'; end if;
 perform public.test_confirm_backup();r:=public.cleanup_old_auctions();
 if (r->'deleted'->>'auctions')::int<>2 or (r->'deleted'->>'purchases')::int<>1 or (r->'deleted'->>'payment_reminders')::int<>1 or (r->'deleted'->>'bids')::int<>1 then raise exception 'publication_policy_wrong: %',r; end if;
 if exists(select 1 from public.auctions where id in ('30000000-0000-0000-0000-000000000951','30000000-0000-0000-0000-000000000955')) then raise exception 'old_sent_sale_or_partial_failure_survived'; end if;
 if (select count(*) from public.auctions)<>5 then raise exception 'recent_active_review_or_unsent_draft_removed'; end if;
 if exists(select 1 from public.purchases) or exists(select 1 from public.payments) or exists(select 1 from public.deliveries) or exists(select 1 from public.payment_reminders) then raise exception 'financial_cascade_incomplete'; end if;
end $$;
reset role;
rollback;
select 'CLEANUP_PUBLICATION_POLICY_OK' as result;
