begin;
alter table public.whatsapp_auction_notices drop constraint whatsapp_auction_notices_kind_check;
alter table public.whatsapp_auction_notices add constraint whatsapp_auction_notices_kind_check
  check (kind in ('queue_finished','auction_closed','quick_poll_winner','buyout_confirmed'));
create unique index buyout_notice_once on public.whatsapp_auction_notices(auction_id) where kind='buyout_confirmed';

-- The notice and financial transition commit or roll back together.
create function public.enqueue_buyout_notice() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='sold' and new.win_type='buyout'
    and (old.status is distinct from new.status or old.win_type is distinct from new.win_type)
    and nullif(new.whatsapp_group_id,'') is not null then
    insert into public.whatsapp_auction_notices(kind,auction_id,group_jid,payload)
    select 'buyout_confirmed',new.id,new.whatsapp_group_id,jsonb_build_object(
      'winner_participant_id',new.winner_participant_id,'winner_name',p.display_name,
      'card_name',c.name,'lot_number',new.lot_number,'final_price',new.final_price,'win_type','buyout')
    from public.cards c left join public.participants p on p.id=new.winner_participant_id
    where c.id=new.card_id
    on conflict (auction_id) where kind='buyout_confirmed' do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.enqueue_buyout_notice() from public,anon,authenticated;
grant execute on function public.enqueue_buyout_notice() to service_role;
create trigger enqueue_buyout_notice after update of status,win_type on public.auctions
for each row execute function public.enqueue_buyout_notice();

alter table public.admin_notifications
  add column attempts integer not null default 0 check(attempts>=0),
  add column next_attempt_at timestamptz not null default clock_timestamp(),
  add column locked_by text,
  add column locked_at timestamptz;
create index admin_notification_due on public.admin_notifications(next_attempt_at,created_at) where sent_at is null;

create function public.claim_admin_notification(p_worker_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if nullif(btrim(p_worker_id),'') is null then raise exception 'worker_id_required'; end if;
  with candidate as (
    select id from public.admin_notifications where sent_at is null
      and next_attempt_at<=clock_timestamp()
      and (locked_at is null or locked_at<clock_timestamp()-interval '2 minutes')
    order by next_attempt_at,created_at,id limit 1 for update skip locked
  )
  update public.admin_notifications n set locked_by=p_worker_id,locked_at=clock_timestamp(),attempts=n.attempts+1
  from candidate c where n.id=c.id returning to_jsonb(n) into result;
  return result;
end $$;
create function public.finish_admin_notification(p_id uuid,p_worker_id text,p_sent_to jsonb,p_success boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_sent_to) is distinct from 'array' then raise exception 'invalid_sent_to'; end if;
  update public.admin_notifications set payload=jsonb_set(payload,'{sent_to}',p_sent_to),
    sent_at=case when p_success then clock_timestamp() else null end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,30*least(10,greatest(1,attempts)))),
    locked_by=null,locked_at=null
  where id=p_id and locked_by=p_worker_id and sent_at is null;
  if not found then raise exception 'admin_notice_claim_lost'; end if;
end $$;
revoke execute on function public.claim_admin_notification(text),public.finish_admin_notification(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.claim_admin_notification(text),public.finish_admin_notification(uuid,text,jsonb,boolean) to service_role;
create function public.bot_delivery_revision() returns integer language sql security invoker set search_path='' as $$ select 1 $$;
revoke execute on function public.bot_delivery_revision() from public,anon,authenticated;
grant execute on function public.bot_delivery_revision() to service_role;
commit;
