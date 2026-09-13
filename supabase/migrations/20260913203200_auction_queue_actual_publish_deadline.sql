create or replace function public.sync_auction_publish_queue_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.queue_id is null then return new; end if;
  if new.status='sent' then
    update public.auction_publish_queues
       set status=case when status='scheduled' then 'running' else status end,
           updated_at=clock_timestamp()
     where id=new.queue_id and status not in('paused','cancelled','completed');
  end if;
  if not exists(
    select 1 from public.whatsapp_dispatches
    where queue_id=new.queue_id and status in('scheduled','sending')
  ) then
    update public.auction_publish_queues
       set status='completed',updated_at=clock_timestamp()
     where id=new.queue_id and status not in('cancelled','paused');
  end if;
  return new;
end $$;

revoke execute on function public.sync_auction_publish_queue_status() from public, anon, authenticated;
grant execute on function public.sync_auction_publish_queue_status() to service_role;

create or replace function public.sync_queue_auction_deadline_from_poll()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.queue_id is not null
     and new.poll_sent_at is not null
     and new.duration_seconds is not null
     and old.poll_sent_at is distinct from new.poll_sent_at then
    update public.auctions
       set scheduled_end_at=new.poll_sent_at+make_interval(secs=>new.duration_seconds::double precision),
           updated_at=clock_timestamp()
     where id=new.auction_id and status='draft';
  end if;
  return new;
end $$;

revoke execute on function public.sync_queue_auction_deadline_from_poll() from public, anon, authenticated;
grant execute on function public.sync_queue_auction_deadline_from_poll() to service_role;

drop trigger if exists sync_queue_auction_deadline_after_poll on public.whatsapp_dispatches;
create trigger sync_queue_auction_deadline_after_poll
  after update of poll_sent_at on public.whatsapp_dispatches
  for each row when (old.poll_sent_at is distinct from new.poll_sent_at)
  execute function public.sync_queue_auction_deadline_from_poll();
