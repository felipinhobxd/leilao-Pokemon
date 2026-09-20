-- 2026-09-21 round: (1) tie-break by TRUE vote time, (2) purge-all RPC.
-- All changes are create-or-replace / additive — safe on a live database.
begin;

-- ---------------------------------------------------------------------------
-- 1) Tie-break: when two participants hold the SAME amount, the winner is
--    whoever placed that bid FIRST. The old ORDER BY used processed_at (the
--    server clock when the RPC ran), which scrambles when the bot drains a
--    backlog after a restart/reconnect. whatsapp_event_at is the timestamp of
--    the vote in WhatsApp itself (falls back to processed_at when absent, e.g.
--    manual dashboard bids) — the honest "who was faster" key.
--    (Body copied verbatim from the baseline with ONLY the finalize ORDER BY
--    changed.)
create or replace function public.process_auction_command(p_command jsonb,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 k text:=p_command->>'type'; eid text:=p_command->>'eventId';
 d jsonb:=coalesce(p_command->'data','{}'::jsonb);
 aid uuid:=nullif(p_command->>'auctionId','')::uuid;
 pid uuid:=nullif(p_command->>'participantId','')::uuid;
 rid uuid:=nullif(p_command->>'id','')::uuid;
 a public.auctions; c public.cards; p public.participants; b public.bids;
 prior public.processed_commands; result jsonb; request jsonb;
 amount numeric; purchase_id uuid; old_bid uuid; stamp timestamptz;
 event_at timestamptz; last_at timestamptz;
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in ('admin','operator')) then raise exception 'forbidden'; end if;
 perform set_config('app.admin_user_id',p_admin_user_id::text,true);
 if eid is null or length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
 request:=p_command||jsonb_build_object('actor',p_admin_user_id);
 perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into prior from public.processed_commands where external_event_id=eid;
 if found then
  if prior.request<>request then raise exception 'event_id_conflict'; end if;
  return prior.result;
 end if;
 if k in ('CARD_CREATE','CARD_UPDATE','CARD_DELETE') then
  if k<>'CARD_CREATE' then
   select * into c from public.cards where id=rid for update;
   if not found then raise exception 'card_not_found'; end if;
   if c.status not in ('available','archived') or exists(select 1 from public.auctions where card_id=rid and status in ('open','review_required')) then raise exception 'card_in_use'; end if;
  end if;
  if k='CARD_DELETE' then update public.cards set status='archived',updated_at=clock_timestamp() where id=rid returning * into c;
  else
   if length(trim(coalesce(d->>'name','')))=0 then raise exception 'invalid_name'; end if;
   if k='CARD_CREATE' then
    insert into public.cards(name,collection,card_number,image_url,starting_price,buyout_price,notes)
    values(d->>'name',d->>'collection',d->>'card_number',d->>'image_url',(d->>'starting_price')::numeric,(d->>'buyout_price')::numeric,d->>'notes') returning * into c;
   else
    update public.cards set name=d->>'name',collection=d->>'collection',card_number=d->>'card_number',image_url=d->>'image_url',starting_price=(d->>'starting_price')::numeric,buyout_price=(d->>'buyout_price')::numeric,notes=d->>'notes',updated_at=clock_timestamp() where id=rid returning * into c;
   end if;
  end if;
  result:=to_jsonb(c);
 elsif k in ('PARTICIPANT_CREATE','PARTICIPANT_UPDATE','PARTICIPANT_DELETE') then
  if k<>'PARTICIPANT_CREATE' then
   select * into p from public.participants where id=rid for update;
   if not found then raise exception 'participant_not_found'; end if;
  end if;
  if k='PARTICIPANT_DELETE' then update public.participants set status='banned',updated_at=clock_timestamp() where id=rid returning * into p;
  else
   if length(trim(coalesce(d->>'display_name','')))=0 or length(trim(coalesce(d->>'whatsapp_id','')))=0 then raise exception 'invalid_participant'; end if;
   if k='PARTICIPANT_CREATE' then
    insert into public.participants(display_name,whatsapp_id,phone_e164,status,notes)
    values(d->>'display_name',d->>'whatsapp_id',d->>'phone_e164',coalesce(d->>'status','active')::public.participant_status,d->>'notes') returning * into p;
   else
    update public.participants set display_name=d->>'display_name',whatsapp_id=d->>'whatsapp_id',phone_e164=d->>'phone_e164',status=(d->>'status')::public.participant_status,notes=d->>'notes',updated_at=clock_timestamp() where id=rid returning * into p;
   end if;
  end if;
  result:=to_jsonb(p);
 elsif k='AUCTION_CREATE' then
  select * into c from public.cards where id=(d->>'card_id')::uuid for update;
  if not found or c.status<>'available' then raise exception 'card_unavailable'; end if;
  insert into public.auctions(card_id,starting_price,buyout_price,scheduled_end_at,created_by)
  values(c.id,c.starting_price,c.buyout_price,(d->>'scheduled_end_at')::timestamptz,p_admin_user_id) returning * into a;
  result:=to_jsonb(a);
 else
  select * into a from public.auctions where id=aid for update;
  if not found then raise exception 'auction_not_found'; end if;
  stamp:=clock_timestamp();
  if k in ('AUCTION_UPDATE','AUCTION_DELETE','AUCTION_OPEN') then
   if a.status<>'draft' then raise exception 'auction_not_draft'; end if;
   if k='AUCTION_UPDATE' then
    update public.auctions set starting_price=(d->>'starting_price')::numeric,buyout_price=(d->>'buyout_price')::numeric,scheduled_end_at=(d->>'scheduled_end_at')::timestamptz,updated_at=stamp where id=aid returning * into a;
   elsif k='AUCTION_DELETE' then update public.auctions set status='cancelled',cancellation_reason='Removed by staff',updated_at=stamp where id=aid returning * into a;
   else
    select * into c from public.cards where id=a.card_id for update;
    if c.status<>'available' then raise exception 'card_unavailable'; end if;
    if a.scheduled_end_at is not null and a.scheduled_end_at<=stamp then raise exception 'deadline_expired'; end if;
    update public.auctions set status='open',started_at=stamp,updated_at=stamp where id=aid returning * into a;
    update public.cards set status='in_auction',updated_at=stamp where id=c.id;
   end if;
   result:=to_jsonb(a);
  else
   if a.status<>'open' then raise exception 'auction_not_open'; end if;
   if k='AUCTION_FINALIZE' then
    -- Lock eligible participants against concurrent suspension while selecting winner.
    perform 1 from public.participants where id in(select participant_id from public.bids where auction_id=aid and status='active') order by id for share;
    select bids.* into b from public.bids bids join public.participants pp on pp.id=bids.participant_id
     where bids.auction_id=aid and bids.status='active' and pp.status='active' and (pp.suspension_until is null or pp.suspension_until<=stamp)
     order by bids.amount desc,coalesce(bids.whatsapp_event_at,bids.processed_at),bids.processed_at,bids.confirmation_order limit 1;
    if not found then
     update public.auctions set status='closed',ended_at=stamp,updated_at=stamp where id=aid returning * into a;
     update public.cards set status='available',updated_at=stamp where id=a.card_id;
    else
     pid:=b.participant_id; amount:=b.amount;
    end if;
   elsif k in ('BID_PLACED','BID_CHANGED','BID_WITHDRAWN','BUYOUT_REQUESTED','BUYOUT_CONFIRMED') then
    if a.scheduled_end_at is not null and a.scheduled_end_at<=stamp then raise exception 'deadline_expired'; end if;
    select * into p from public.participants where id=pid for share;
    if not found then raise exception 'participant_not_found'; end if;
    if p.status<>'active' or (p.suspension_until is not null and p.suspension_until>stamp) then raise exception 'participant_not_eligible'; end if;
    event_at:=coalesce((p_command->>'occurredAt')::timestamptz,stamp);
    if event_at>stamp+interval '5 minutes' then raise exception 'invalid_event_time'; end if;
    select max((payload->>'event_at')::timestamptz) into last_at from public.auction_events where auction_id=aid and participant_id=pid and event_type in ('BID_PLACED','BID_CHANGED','BID_WITHDRAWN','BUYOUT_REQUESTED','BUYOUT_CONFIRMED');
    if event_at<a.started_at or (last_at is not null and event_at<last_at) then raise exception 'stale_event'; end if;
    select id into old_bid from public.bids where auction_id=aid and participant_id=pid and status='active';
    if k in ('BID_CHANGED','BID_WITHDRAWN') and old_bid is null then raise exception 'active_bid_not_found'; end if;
    if k='BID_PLACED' and old_bid is not null then raise exception 'active_bid_exists'; end if;
    if k='BID_WITHDRAWN' then
     update public.bids set status='withdrawn' where id=old_bid;
    elsif k in ('BUYOUT_REQUESTED','BUYOUT_CONFIRMED') then
     if a.buyout_price is null then raise exception 'buyout_not_enabled'; end if;
     if k='BUYOUT_CONFIRMED' then amount:=a.buyout_price; end if;
    end if;
    if k in ('BID_PLACED','BID_CHANGED','BUYOUT_CONFIRMED') then
     if k<>'BUYOUT_CONFIRMED' then amount:=(p_command->>'amount')::numeric; end if;
     if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<a.starting_price or amount<>round(amount,2) then raise exception 'invalid_bid_amount'; end if;
     update public.bids set status='replaced' where id=old_bid;
     insert into public.bids(auction_id,participant_id,amount,kind,whatsapp_event_id,whatsapp_event_at,processed_at)
     values(aid,pid,amount,case when k='BUYOUT_CONFIRMED' then 'buyout'::public.bid_kind else 'bid'::public.bid_kind end,eid,event_at,stamp) returning * into b;
     update public.bids set replaced_by=b.id where id=old_bid;
    end if;
   else raise exception 'unknown_command'; end if;
   if (k='AUCTION_FINALIZE' and b.id is not null) or k='BUYOUT_CONFIRMED' then
    update public.auctions set status='sold',winner_participant_id=pid,final_price=amount,win_type=case when k='BUYOUT_CONFIRMED' then 'buyout' else 'highest_bid' end,ended_at=stamp,updated_at=stamp where id=aid returning * into a;
    update public.cards set status='sold',updated_at=stamp where id=a.card_id;
    insert into public.purchases(auction_id,participant_id,card_id,amount) values(aid,pid,a.card_id,amount) returning id into purchase_id;
    insert into public.deliveries(purchase_id) values(purchase_id);
   end if;
   result:=jsonb_build_object('auction',to_jsonb(a),'bid',case when b.id is not null then to_jsonb(b) else null end,'purchase_id',purchase_id);
  end if;
 end if;
 insert into public.auction_events(auction_id,participant_id,admin_user_id,event_type,external_event_id,payload)
 values(coalesce(aid,a.id),pid,p_admin_user_id,k,eid,jsonb_build_object('result',result,'event_at',event_at));
 insert into public.processed_commands(external_event_id,request,result) values(eid,request,result);
 return result;
end $$;
revoke execute on function public.process_auction_command(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.process_auction_command(jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) read_dashboard_snapshot: expose bids.whatsapp_event_at so the dashboard
--    ranks ties with the same key the database crowns winners with.
create or replace function public.read_dashboard_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $body$
 select jsonb_build_object(
  'cards',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,name,collection,card_number,image_url,starting_price,buyout_price,status,variant,language,condition,notes
      from public.cards
    ) x
  ),'[]'::jsonb),
  'participants',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,display_name,whatsapp_id,phone_e164,status,suspension_until,notes
      from public.participants
    ) x
  ),'[]'::jsonb),
  'auctions',coalesce((
    select jsonb_agg(x order by created_at desc)
    from (
      select id,card_id,status,starting_price,bid_increment,buyout_price,scheduled_end_at,winner_participant_id,final_price,lot_number,created_at,win_type
      from public.auctions
    ) x
  ),'[]'::jsonb),
  'bids',coalesce((
    select jsonb_agg(x order by processed_at desc)
    from (
      select id,auction_id,participant_id,amount,status,processed_at,confirmation_order,whatsapp_event_at
      from public.bids
    ) x
  ),'[]'::jsonb),
  'auction_events',coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,created_at,event_type,participant_id from public.auction_events order by created_at desc,id desc limit 15) t),'[]'::jsonb),
  'purchases',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,card_id,participant_id,auction_id,amount,status
      from public.purchases
    ) x
  ),'[]'::jsonb),
  'payments','[]'::jsonb,
  'deliveries','[]'::jsonb,
  'warnings','[]'::jsonb
 );
$body$;
revoke execute on function public.read_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.read_dashboard_snapshot() to service_role;

-- ---------------------------------------------------------------------------
-- 3) "Excluir TUDO": wipe every business row (auctions, winners, participants,
--    cards, dispatches, queues, the audit trail that feeds the Excel export)
--    while KEEPING the admin account, the WhatsApp group configuration and
--    the recognition memory. Lot/bid sequences restart at 1 so numbering
--    starts over. The phrase gate lives here AND in the API route; the
--    function is service_role-only either way.
--    FK-safe order (children before parents, all restrict):
--    payments/deliveries -> purchases -> warnings -> vote_state ->
--    dispatches -> queues -> events -> bids -> auctions -> cards ->
--    identities -> participants. auction_events is append-only (a trigger
--    raises on DELETE): the guard is lifted and restored inside this same
--    transaction.
create or replace function public.purge_all_business_data(p_confirm text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 n_payments bigint; n_deliveries bigint; n_purchases bigint; n_warnings bigint;
 n_votes bigint; n_dispatches bigint; n_queues bigint; n_events bigint;
 n_bids bigint; n_auctions bigint; n_cards bigint; n_identities bigint;
 n_participants bigint; n_commands bigint; n_bot_commands bigint;
begin
 if coalesce(p_confirm,'') <> 'quero excluir mesmo' then raise exception 'purge_not_confirmed'; end if;

 -- Utility DDL via EXECUTE (canonical pattern for triggers/sequences inside
 -- plpgsql). Everything runs in the caller's transaction: on any failure the
 -- trigger is restored by the rollback itself.
 execute 'drop trigger if exists immutable_audit on public.auction_events';

 with gone as (delete from public.payments returning 1) select count(*) into n_payments from gone;
 with gone as (delete from public.deliveries returning 1) select count(*) into n_deliveries from gone;
 with gone as (delete from public.purchases returning 1) select count(*) into n_purchases from gone;
 with gone as (delete from public.warnings returning 1) select count(*) into n_warnings from gone;
 with gone as (delete from public.whatsapp_vote_state returning 1) select count(*) into n_votes from gone;
 with gone as (delete from public.whatsapp_dispatches returning 1) select count(*) into n_dispatches from gone;
 with gone as (delete from public.auction_publish_queues returning 1) select count(*) into n_queues from gone;
 with gone as (delete from public.auction_events returning 1) select count(*) into n_events from gone;
 with gone as (delete from public.bids returning 1) select count(*) into n_bids from gone;
 with gone as (delete from public.auctions returning 1) select count(*) into n_auctions from gone;
 with gone as (delete from public.cards returning 1) select count(*) into n_cards from gone;
 with gone as (delete from public.participant_identities returning 1) select count(*) into n_identities from gone;
 with gone as (delete from public.participants returning 1) select count(*) into n_participants from gone;
 with gone as (delete from public.processed_commands returning 1) select count(*) into n_commands from gone;
 with gone as (delete from public.whatsapp_bot_commands returning 1) select count(*) into n_bot_commands from gone;

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
