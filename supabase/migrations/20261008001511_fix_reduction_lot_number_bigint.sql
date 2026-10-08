-- 2026-10-08: fix the reduction helper's lot-number parameter type.
-- public.auctions.lot_number is bigint, so the helper must accept bigint too.
-- This avoids a runtime function-resolution error in process_auction_command.

begin;

drop function if exists public.register_participant_reduction(
  uuid,uuid,text,integer,text,numeric,numeric,text,timestamptz,text
);

create function public.register_participant_reduction(
  p_auction_id uuid, p_participant_id uuid, p_card_name text, p_lot_number bigint,
  p_participant_name text, p_previous_amount numeric, p_new_amount numeric,
  p_event_id text, p_event_at timestamptz, p_change_kind text
) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.value_change_log(
   auction_id,participant_id,previous_amount,new_amount,difference,
   external_event_id,occurred_at,change_kind
 )
 values(
   p_auction_id,p_participant_id,p_previous_amount,p_new_amount,
   p_new_amount-p_previous_amount,p_event_id,p_event_at,p_change_kind
 )
 on conflict (external_event_id) do nothing;

 if p_new_amount<p_previous_amount then
  insert into public.participant_warnings(
    participant_id,auction_id,card_name,lot_number,previous_amount,
    new_amount,external_event_id,occurred_at,change_kind
  )
  values(
    p_participant_id,p_auction_id,p_card_name,p_lot_number,p_previous_amount,
    p_new_amount,p_event_id,p_event_at,p_change_kind
  )
  on conflict (external_event_id) do nothing;

  if (
    select count(*)
    from public.participant_warnings pw
    where pw.participant_id=p_participant_id
      and pw.created_at>coalesce((
        select max(pw2.created_at)
        from public.participant_warnings pw2
        where pw2.participant_id=p_participant_id
          and pw2.cycle_closed
      ),'-infinity'::timestamptz)
  )=3 then
   insert into public.admin_notifications(
     participant_id,kind,external_event_id,payload
   )
   values(
     p_participant_id,'WARNING_THRESHOLD',p_event_id,
     jsonb_build_object(
       'participant_name',p_participant_name,
       'total_warnings',3,
       'card_name',p_card_name,
       'lot_number',p_lot_number,
       'previous_amount',p_previous_amount,
       'new_amount',p_new_amount,
       'event_at',p_event_at,
       'warnings',(
         select jsonb_agg(jsonb_build_object(
           'card_name',w.card_name,
           'lot_number',w.lot_number,
           'previous_amount',w.previous_amount,
           'new_amount',w.new_amount,
           'occurred_at',w.occurred_at
         ) order by w.created_at)
         from public.participant_warnings w
         where w.participant_id=p_participant_id
           and w.created_at>coalesce((
             select max(pw2.created_at)
             from public.participant_warnings pw2
             where pw2.participant_id=p_participant_id
               and pw2.cycle_closed
           ),'-infinity'::timestamptz)
       )
     )
   )
   on conflict (external_event_id) do nothing;

   update public.participant_warnings pw
   set cycle_closed=true
   where pw.participant_id=p_participant_id
     and pw.external_event_id=p_event_id;
  end if;
 end if;
end $$;

revoke execute on function public.register_participant_reduction(
  uuid,uuid,text,bigint,text,numeric,numeric,text,timestamptz,text
) from public,anon,authenticated;

grant execute on function public.register_participant_reduction(
  uuid,uuid,text,bigint,text,numeric,numeric,text,timestamptz,text
) to service_role;

commit;
