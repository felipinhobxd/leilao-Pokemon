begin;
-- Small, bounded diagnostics carried by the existing heartbeat; no new polling.
alter table public.whatsapp_bot_workers add column if not exists operational_health jsonb not null default '{}'::jsonb;
alter table public.whatsapp_auction_notices add column if not exists last_error text;
create or replace function public.finish_auction_notice(p_id uuid,p_worker_id text,p_success boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.whatsapp_auction_notices set sent_at=case when p_success then clock_timestamp() else null end,
    last_error=case when p_success then null else last_error end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,30*greatest(1,attempts))),locked_at=null,locked_by=null
    where id=p_id and locked_by=p_worker_id and sent_at is null;
  if not found then raise exception 'notice_claim_lost'; end if;
end $$;
revoke execute on function public.finish_auction_notice(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_auction_notice(uuid,text,boolean) to service_role;
commit;
