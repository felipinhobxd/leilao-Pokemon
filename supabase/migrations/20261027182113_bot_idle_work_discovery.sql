begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

-- Conservative discovery: future/paused work keeps the original workers
-- running too. A stale 'sending' claim must still be recovered.
-- EXISTS stops at the first match; no payload or participant data leaves SQL.
create function public.bot_has_pending_work() returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.auction_publish_queues where status in ('scheduled','running'))
    or exists(select 1 from public.whatsapp_dispatches where status in ('scheduled','sending'))
    or exists(select 1 from public.auctions where status='open')
    or exists(select 1 from public.whatsapp_quick_polls where sent_at is null);
$$;
revoke execute on function public.bot_has_pending_work() from public,anon,authenticated;
grant execute on function public.bot_has_pending_work() to service_role;
notify pgrst,'reload schema';
commit;
