-- Manual, admin-only deletion of terminal auctions. No age cutoff or UI
-- snapshot limit. Reuse the existing deletion tree and queue reconciliation.
begin;
create or replace function public.delete_completed_auctions(
  p_event_id uuid,p_confirm1 text,p_confirm2 text,p_admin_user_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  prior public.processed_commands;
  req jsonb;
  target record;
  removed integer := 0;
  result jsonb;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role='admin') then
    raise exception 'forbidden';
  end if;
  if coalesce(p_confirm1,'')<>'excluir leilões encerrados'
     or coalesce(p_confirm2,'')<>'quero excluir os encerrados' then
    raise exception 'delete_not_confirmed';
  end if;
  if p_event_id is null then raise exception 'invalid_event_id'; end if;
  req := jsonb_build_object('type','COMPLETED_AUCTIONS_DELETE','actor',p_admin_user_id,'eventId',p_event_id);
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  select * into prior from public.processed_commands where external_event_id=p_event_id::text;
  if found then
    if prior.request<>req then raise exception 'event_id_conflict'; end if;
    return prior.result;
  end if;

  -- Locks recheck status after concurrent changes. Draft/open/review never
  -- qualify, including scheduled drafts whose dispatch is still pending.
  for target in select id from public.auctions
    where status in ('sold','closed','cancelled') order by id for update
  loop
    perform public.delete_auction(target.id,'sim quero',p_admin_user_id);
    removed := removed+1;
  end loop;

  result := jsonb_build_object('deleted_auctions',removed);
  insert into public.auction_events(admin_user_id,event_type,external_event_id,payload)
    values(p_admin_user_id,'COMPLETED_AUCTIONS_DELETED','completed-auctions-delete:'||p_event_id::text,result);
  insert into public.processed_commands(external_event_id,request,result)
    values(p_event_id::text,req,result);
  return result;
end $$;
revoke execute on function public.delete_completed_auctions(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_completed_auctions(uuid,text,text,uuid) to service_role;
commit;
