-- Disposable database only. No waiting 12h, production deletion or real Storage.
begin;
insert into public.participants(id,display_name,whatsapp_id)
 values('10000000-0000-0000-0000-000000000089','Phase 3 synthetic buyer','phase3-isolated');
insert into public.whatsapp_groups(id,name,group_jid)
 values('50000000-0000-0000-0000-000000000089','Phase 3 isolated','phase3-isolated@g.us');
insert into public.cards(id,name,starting_price)
 select ('20000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid,'Phase 3 card '||i,1 from generate_series(1,10)i;
insert into public.auctions(id,card_id,status,starting_price,started_at,ended_at,created_at,win_type)
 select ('30000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid,
 ('20000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid,
 (case when i in(2,3,5) then 'open' when i=6 then 'review_required' when i in(7,9) then 'draft' when i=8 then 'cancelled' else 'closed' end)::public.auction_status,
 1,case when i in(7,9) then null else now()-interval '20 hours' end,
 case when i in(1,2,3,4,8,10) then now()-interval '1 minute' else null end,
 now()-interval '20 hours',
 case when i=2 then 'buyout' when i=3 then 'highest_bid' else null end
 from generate_series(1,10)i;
insert into public.whatsapp_dispatches(auction_id,group_id,scheduled_at,poll_options,status,poll_sent_at,announcement_sent_at)
 select ('30000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid,
 '50000000-0000-0000-0000-000000000089',now()-interval '20 hours','["1","2"]',
 case when i=7 then 'scheduled' when i=9 then 'failed' else 'sent' end,
 case when i in(7,9) then null when i=1 then now()-interval '11 hours 59 minutes' else now()-interval '12 hours 1 minute' end,
 case when i=7 then null else now()-interval '13 hours' end
 from generate_series(1,9)i;
-- Case 10 is a terminal legacy item, without a dispatch: old start is fallback.
insert into public.bids(auction_id,participant_id,amount)
 select ('30000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000089',2 from unnest(array[2,3])i;
update public.auctions set status='sold',winner_participant_id='10000000-0000-0000-0000-000000000089',final_price=2
 where id in('30000000-0000-0000-0000-000000000892','30000000-0000-0000-0000-000000000893');
-- Historical sale may share a card with an active auction, after it is terminal.
update public.auctions set card_id='20000000-0000-0000-0000-000000000895' where id='30000000-0000-0000-0000-000000000893';
insert into public.purchases(id,auction_id,card_id,participant_id,amount)
 select ('40000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid,a.id,a.card_id,'10000000-0000-0000-0000-000000000089',2
 from unnest(array[2,3])i join public.auctions a on a.id=('30000000-0000-0000-0000-'||lpad((890+i)::text,12,'0'))::uuid;
insert into public.payments(purchase_id,amount,status)
 select id,1,'partial' from public.purchases where participant_id='10000000-0000-0000-0000-000000000089';
insert into public.deliveries(purchase_id)
 select id from public.purchases where participant_id='10000000-0000-0000-0000-000000000089';
insert into public.payment_reminders(purchase_id,participant_id)
 select id,participant_id from public.purchases where participant_id='10000000-0000-0000-0000-000000000089';
insert into public.whatsapp_auction_notices(kind,auction_id,group_jid,payload)
 values('auction_closed','30000000-0000-0000-0000-000000000894','phase3-isolated@g.us','{}');

-- Stable full business snapshot, including empty tables, for no-partial-delete checks.
create function pg_temp.phase3_snapshot() returns jsonb language plpgsql as $$
declare name text; rows jsonb; result jsonb:='{}';
begin
 foreach name in array array['cards','participants','participant_identities','whatsapp_groups','auction_publish_queues','auctions','bids','purchases','payments','deliveries','warnings','value_change_log','participant_warnings','admin_notifications','auction_events','processed_commands','whatsapp_dispatches','whatsapp_vote_state','whatsapp_quick_polls','payment_reminders','auction_drafts','whatsapp_auction_notices'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',name) into rows;
  result:=result||jsonb_build_object(name,rows);
 end loop;
 return result;
end $$;
set local role service_role;
do $$
declare r jsonb; before_rows jsonb;
begin
 before_rows:=pg_temp.phase3_snapshot();r:=public.cleanup_old_auctions();
 if r->>'reason'<>'confirmed_cloud_backup_missing' or pg_temp.phase3_snapshot()<>before_rows then raise exception 'missing_backup_changed_business_data';end if;
 perform public.test_confirm_backup();
 update public.payments set amount=0.5 where purchase_id='40000000-0000-0000-0000-000000000892';
 before_rows:=pg_temp.phase3_snapshot();r:=public.cleanup_old_auctions();
 if r->>'reason'<>'backup_coverage_incomplete' or pg_temp.phase3_snapshot()<>before_rows then raise exception 'one_changed_payment_allowed_partial_cleanup';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.auction_events'::regclass and tgname='immutable_audit' and tgenabled<>'D') then raise exception 'blocked_cleanup_disabled_audit';end if;
 perform public.test_confirm_backup();r:=public.cleanup_old_auctions();
 if coalesce((r->>'blocked')::boolean,false) or (r->'deleted'->>'auctions')::int<>5 then raise exception 'covered_cleanup_wrong_candidates: %',r;end if;
 if (r->'deleted'->>'purchases')::int<>2 or (r->'deleted'->>'payments')::int<>2 or (r->'deleted'->>'deliveries')::int<>2 or (r->'deleted'->>'payment_reminders')::int<>2 or (r->'deleted'->>'bids')::int<>2 then raise exception 'covered_sale_tree_incomplete: %',r;end if;
 if exists(select 1 from public.auctions where id in('30000000-0000-0000-0000-000000000892','30000000-0000-0000-0000-000000000893','30000000-0000-0000-0000-000000000898','30000000-0000-0000-0000-000000000899','30000000-0000-0000-0000-000000000900')) then raise exception 'eligible_item_survived';end if;
 if (select count(*) from public.auctions)<>5 then raise exception 'recent_open_review_unsent_or_pending_notice_deleted';end if;
 if not exists(select 1 from public.cards where id='20000000-0000-0000-0000-000000000895') or not exists(select 1 from public.cards where id='20000000-0000-0000-0000-000000000893') then raise exception 'shared_or_unauctioned_card_deleted';end if;
 if not exists(select 1 from public.whatsapp_auction_notices where auction_id='30000000-0000-0000-0000-000000000894' and sent_at is null) then raise exception 'pending_notice_not_preserved';end if;
 -- Delivery unlocks eligibility, but changed notice still needs a new snapshot.
 update public.whatsapp_auction_notices set sent_at=clock_timestamp() where auction_id='30000000-0000-0000-0000-000000000894';
 before_rows:=pg_temp.phase3_snapshot();r:=public.cleanup_old_auctions();
 if r->>'reason'<>'backup_coverage_incomplete' or pg_temp.phase3_snapshot()<>before_rows then raise exception 'newly_sent_notice_bypassed_coverage';end if;
 perform public.test_confirm_backup();r:=public.cleanup_old_auctions();
 if (r->'deleted'->>'auctions')::int<>1 or exists(select 1 from public.auctions where id='30000000-0000-0000-0000-000000000894') then raise exception 'covered_sent_notice_did_not_release_cleanup';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.auction_events'::regclass and tgname='immutable_audit' and tgenabled<>'D') then raise exception 'successful_cleanup_lost_audit_protection';end if;
end $$;
reset role;
rollback;
select 'CLEANUP_BOUNDARIES_ATOMICITY_OK' as result;
