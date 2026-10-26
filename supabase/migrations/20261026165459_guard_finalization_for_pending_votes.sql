-- The bot owns a durable inbox on its PC. Delay only results whose poll still
-- has an unconfirmed vote. The bidding deadline is NEVER extended here.
begin;
create function public.finalize_due_auction_batch_guarded(p_admin_user_id uuid, p_pending_poll_ids text[], p_due_before timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare a record; r jsonb; final_row jsonb; total integer:=0;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  if p_due_before is null or p_pending_poll_ids is null or cardinality(p_pending_poll_ids)>5000
    or exists(select 1 from unnest(p_pending_poll_ids) id where id is null or length(id) not between 1 and 200) then raise exception 'invalid_pending_poll_ids'; end if;
  for a in select x.id,x.card_id,x.whatsapp_group_id,x.scheduled_end_at from public.auctions x
    where x.status='open' and x.scheduled_end_at<=least(p_due_before,clock_timestamp())
      and not coalesce(x.poll_id=any(p_pending_poll_ids),false)
      and not exists(select 1 from public.whatsapp_dispatches d where d.auction_id=x.id
        and (d.poll_message_id=any(p_pending_poll_ids) or d.poll_remote_message_id=any(p_pending_poll_ids)))
    order by x.scheduled_end_at,x.lot_number,x.id limit 200 for update of x skip locked
  loop
    r:=public.process_auction_command(jsonb_build_object('type','AUCTION_FINALIZE','eventId','bot-finalize:'||a.id||':'||a.scheduled_end_at,'auctionId',a.id),p_admin_user_id);
    final_row:=r->'auction';
    if final_row->>'status' in('sold','closed') and a.whatsapp_group_id is not null then
      insert into public.whatsapp_auction_notices(kind,auction_id,group_jid,payload)
      values('auction_closed',a.id,a.whatsapp_group_id,final_row||jsonb_build_object(
        'card_name',(select name from public.cards where id=a.card_id),
        'winner_name',(select display_name from public.participants where id=nullif(final_row->>'winner_participant_id','')::uuid),
        'tie',(select count(*)>1 from public.bids where auction_id=a.id and status='active' and amount=(final_row->>'final_price')::numeric))) on conflict do nothing;
    end if;
    total:=total+1;
  end loop;
  return total;
end $$;
revoke execute on function public.finalize_due_auction_batch_guarded(uuid,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.finalize_due_auction_batch_guarded(uuid,text[],timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
