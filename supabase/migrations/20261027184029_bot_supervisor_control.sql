begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

-- One round trip for the supervisor's priority flag and command claim.
-- Keep the logout flag until local session removal is confirmed by the bot.
create function public.claim_whatsapp_bot_control(p_worker_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare wants_logout boolean; claimed jsonb;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 or length(p_worker_id)>200 then
    raise exception 'invalid_worker_id';
  end if;
  select logout_requested into wants_logout from public.whatsapp_bot_workers
    where worker_id=p_worker_id for update;
  if coalesce(wants_logout,false) then
    return jsonb_build_object('logout_requested',true,'command',null);
  end if;
  -- Reuse existing worker scoping, SKIP LOCKED, ordering and stale recovery.
  select to_jsonb(c) into claimed from public.claim_whatsapp_bot_command(p_worker_id) c;
  return jsonb_build_object('logout_requested',false,'command',claimed);
end $$;
revoke execute on function public.claim_whatsapp_bot_control(text) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_bot_control(text) to service_role;
notify pgrst,'reload schema';
commit;
