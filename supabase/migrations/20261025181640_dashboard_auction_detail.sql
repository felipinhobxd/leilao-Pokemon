-- Read the selected auction from the full active-bid set, never a global history slice.
begin;
create or replace function public.read_dashboard_auction(p_auction_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $body$
 with target as (
   select a.* from public.auctions a
   where a.id=coalesce(p_auction_id,(select id from public.auctions order by (status='open') desc,created_at desc,id desc limit 1))
 ), eligible as materialized (
   select b.id,b.auction_id,b.participant_id,b.amount,b.status,b.processed_at,b.confirmation_order,b.whatsapp_event_at,
          jsonb_build_object('id',p.id,'display_name',p.display_name,'phone_e164',p.phone_e164,'whatsapp_id',p.whatsapp_id,'status',p.status,'suspension_until',p.suspension_until) as participant
   from public.bids b join public.participants p on p.id=b.participant_id
   where b.auction_id=(select id from target) and b.status='active' and p.status='active'
     and (p.suspension_until is null or p.suspension_until<=now())
 ), ranked as (
   select * from eligible order by amount desc,coalesce(whatsapp_event_at,processed_at),processed_at,confirmation_order,id limit 100
 )
 select jsonb_build_object(
   'auction',(select to_jsonb(t) from target t),
   'card',(select to_jsonb(c) from public.cards c where c.id=(select card_id from target)),
   'winner',(select jsonb_build_object('id',p.id,'display_name',p.display_name,'phone_e164',p.phone_e164,'whatsapp_id',p.whatsapp_id) from public.participants p where p.id=(select winner_participant_id from target)),
   'purchases',coalesce((select jsonb_agg(to_jsonb(x) order by confirmed_at desc nulls last,id) from (
     select p.*,c.name as card_name,person.display_name as person_name,person.phone_e164,person.whatsapp_id,a.win_type,
       exists(select 1 from public.payments pay where pay.purchase_id=p.id and pay.status='paid') as paid
     from public.purchases p join public.cards c on c.id=p.card_id join public.participants person on person.id=p.participant_id
     join public.auctions a on a.id=p.auction_id order by p.confirmed_at desc nulls last,p.id limit 500
   ) x),'[]'::jsonb),
   'participantCount',(select count(*) from eligible),
   'bids',coalesce((select jsonb_agg(to_jsonb(r) order by amount desc,coalesce(whatsapp_event_at,processed_at),processed_at,confirmation_order,id) from ranked r),'[]'::jsonb)
 );
$body$;
revoke execute on function public.read_dashboard_auction(uuid) from public,anon,authenticated;
grant execute on function public.read_dashboard_auction(uuid) to service_role;
-- A retry can recover a committed creation even after its scheduled time passed.
create or replace function public.recover_auction_creation(p_event_id text,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.processed_commands;
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
 if coalesce(length(p_event_id),0) not between 1 and 200 then raise exception 'invalid_event_id'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id,0));
 select * into prior from public.processed_commands where external_event_id=p_event_id;
 if not found or prior.request->>'actor' is distinct from p_admin_user_id::text or prior.request->>'type' not in('AUCTION_QUEUE_CREATE','AUCTION_WIZARD_CREATE') then return null; end if;
 return jsonb_build_object('queue',case when prior.result ? 'queue' then jsonb_build_object('id',prior.result->'queue'->>'id') else null end,
 'auction',case when prior.result ? 'auction' then jsonb_build_object('id',prior.result->'auction'->>'id','lot_number',prior.result->'auction'->'lot_number') else null end);
end $$;
revoke execute on function public.recover_auction_creation(text,uuid) from public,anon,authenticated;
grant execute on function public.recover_auction_creation(text,uuid) to service_role;
commit;
