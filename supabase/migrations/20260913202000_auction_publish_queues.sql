begin;

create table if not exists public.auction_publish_queues (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'scheduled' check (status in ('scheduled','running','paused','completed','cancelled')),
  group_id uuid not null references public.whatsapp_groups(id) on delete restrict,
  interval_seconds integer not null check (interval_seconds between 1 and 86400),
  starts_at timestamptz not null,
  total_items integer not null check (total_items between 1 and 100),
  paused_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.whatsapp_dispatches
  add column if not exists queue_id uuid references public.auction_publish_queues(id) on delete restrict,
  add column if not exists queue_position integer,
  add column if not exists duration_seconds integer;

create unique index if not exists whatsapp_dispatch_queue_position_key
  on public.whatsapp_dispatches(queue_id,queue_position)
  where queue_id is not null;
create index if not exists whatsapp_dispatch_queue_status_idx
  on public.whatsapp_dispatches(queue_id,status,queue_position)
  where queue_id is not null;
create index if not exists auction_publish_queues_status_idx
  on public.auction_publish_queues(status,starts_at);

alter table public.auction_publish_queues enable row level security;
revoke all on public.auction_publish_queues from public,anon,authenticated;
grant select on public.auction_publish_queues to authenticated;
grant all on public.auction_publish_queues to service_role;

drop policy if exists staff_read on public.auction_publish_queues;
create policy staff_read on public.auction_publish_queues
  for select to authenticated
  using (exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

create or replace function public.create_auction_publish_queue(p_payload jsonb,p_admin_user_id uuid)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  eid text:=trim(coalesce(p_payload->>'eventId',''));
  qd jsonb:=coalesce(p_payload->'queue','{}'::jsonb);
  items jsonb:=coalesce(p_payload->'items','[]'::jsonb);
  req jsonb;
  prior public.processed_commands;
  q public.auction_publish_queues;
  g public.whatsapp_groups;
  item jsonb;
  cd jsonb;
  ad jsonb;
  c public.cards;
  a public.auctions;
  d public.whatsapp_dispatches;
  result jsonb;
  result_items jsonb:='[]'::jsonb;
  group_id uuid;
  queue_start timestamptz;
  schedule_at timestamptz;
  end_at timestamptz;
  interval_value integer;
  duration_value integer;
  lot bigint;
  start_price numeric;
  increment_value numeric;
  buyout numeric;
  options jsonb;
  position_value integer:=0;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  if length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items)<1 or jsonb_array_length(items)>100 then raise exception 'invalid_queue_items'; end if;

  req:=p_payload||jsonb_build_object('actor',p_admin_user_id,'type','AUCTION_QUEUE_CREATE');
  perform pg_advisory_xact_lock(hashtextextended(eid,0));
  select * into prior from public.processed_commands where external_event_id=eid;
  if found then
    if prior.request<>req then raise exception 'event_id_conflict'; end if;
    return prior.result;
  end if;

  group_id:=(qd->>'group_id')::uuid;
  queue_start:=(qd->>'starts_at')::timestamptz;
  interval_value:=(qd->>'interval_seconds')::integer;
  if interval_value<1 or interval_value>86400 then raise exception 'invalid_queue_interval'; end if;
  select * into g from public.whatsapp_groups where id=group_id and active for share;
  if not found then raise exception 'whatsapp_group_unavailable'; end if;

  perform set_config('app.admin_user_id',p_admin_user_id::text,true);
  insert into public.auction_publish_queues(group_id,interval_seconds,starts_at,total_items,created_by)
  values(group_id,interval_value,queue_start,jsonb_array_length(items),p_admin_user_id)
  returning * into q;

  for item in select value from jsonb_array_elements(items) loop
    position_value:=position_value+1;
    cd:=coalesce(item->'card','{}'::jsonb);
    ad:=coalesce(item->'auction','{}'::jsonb);
    if length(trim(coalesce(cd->>'name','')))<1 then raise exception 'invalid_card_name'; end if;

    start_price:=(ad->>'starting_price')::numeric;
    increment_value:=(ad->>'bid_increment')::numeric;
    buyout:=nullif(ad->>'buyout_price','')::numeric;
    duration_value:=(ad->>'duration_seconds')::integer;
    options:=ad->'poll_options';
    lot:=nullif(ad->>'lot_number','')::bigint;

    if start_price<0 or increment_value<=0 or buyout is not null and buyout<=start_price then raise exception 'invalid_auction_values'; end if;
    if duration_value<1 or duration_value>604800 then raise exception 'invalid_auction_duration'; end if;
    if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;

    if lot is not null then
      if lot<=0 or exists(select 1 from public.auctions where lot_number=lot) then raise exception 'lot_number_in_use'; end if;
    else
      loop
        lot:=nextval('public.auction_lot_number_seq');
        exit when not exists(select 1 from public.auctions where lot_number=lot);
      end loop;
    end if;

    schedule_at:=queue_start+make_interval(secs=>((position_value-1)*interval_value)::double precision);
    end_at:=schedule_at+make_interval(secs=>duration_value::double precision);

    insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price)
    values(
      trim(cd->>'name'),
      nullif(trim(coalesce(cd->>'collection','')),''),
      nullif(trim(coalesce(cd->>'card_number','')),''),
      nullif(trim(coalesce(cd->>'variant','')),''),
      coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),
      nullif(trim(coalesce(cd->>'condition','')),''),
      nullif(trim(coalesce(cd->>'image_url','')),''),
      start_price,buyout
    ) returning * into c;

    insert into public.auctions(card_id,lot_number,starting_price,bid_increment,buyout_price,scheduled_end_at,created_by)
    values(c.id,lot,start_price,increment_value,buyout,end_at,p_admin_user_id)
    returning * into a;

    insert into public.whatsapp_dispatches(
      auction_id,group_id,scheduled_at,poll_title,poll_options,status,created_by,
      queue_id,queue_position,duration_seconds
    ) values(
      a.id,g.id,schedule_at,lot::text||'. Lances',options,'scheduled',p_admin_user_id,
      q.id,position_value,duration_value
    ) returning * into d;

    insert into public.auction_events(auction_id,admin_user_id,event_type,external_event_id,payload)
    values(a.id,p_admin_user_id,'AUCTION_QUEUE_ITEM_CREATED',eid||':'||position_value,
      jsonb_build_object('queue_id',q.id,'position',position_value,'card_id',c.id,'dispatch_id',d.id,'lot_number',lot,'group_id',g.id));

    result_items:=result_items||jsonb_build_array(jsonb_build_object(
      'card',to_jsonb(c),'auction',to_jsonb(a),'dispatch',to_jsonb(d),'position',position_value
    ));
  end loop;

  result:=jsonb_build_object('queue',to_jsonb(q),'items',result_items);
  insert into public.processed_commands(external_event_id,request,result) values(eid,req,result);
  return result;
exception
  when unique_violation then
    raise exception 'lot_number_in_use';
end $$;

revoke execute on function public.create_auction_publish_queue(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_auction_publish_queue(jsonb,uuid) to service_role;

create or replace function public.control_auction_publish_queue(p_queue_id uuid,p_action text,p_admin_user_id uuid)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  q public.auction_publish_queues;
  d public.whatsapp_dispatches;
  position_offset integer:=0;
  next_time timestamptz;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  select * into q from public.auction_publish_queues where id=p_queue_id for update;
  if not found then raise exception 'queue_not_found'; end if;

  if p_action='pause' then
    if q.status not in('scheduled','running') then raise exception 'queue_not_pauseable'; end if;
    update public.auction_publish_queues set status='paused',paused_at=clock_timestamp(),updated_at=clock_timestamp() where id=q.id returning * into q;
  elsif p_action='resume' then
    if q.status<>'paused' then raise exception 'queue_not_resumable'; end if;
    for d in
      select * from public.whatsapp_dispatches
      where queue_id=q.id and status='scheduled'
      order by queue_position,id
      for update
    loop
      next_time:=clock_timestamp()+make_interval(secs=>(position_offset*q.interval_seconds)::double precision);
      update public.whatsapp_dispatches
         set scheduled_at=next_time,locked_at=null,locked_by=null,updated_at=clock_timestamp()
       where id=d.id;
      update public.auctions
         set scheduled_end_at=next_time+make_interval(secs=>coalesce(d.duration_seconds,1)::double precision),updated_at=clock_timestamp()
       where id=d.auction_id and status='draft';
      position_offset:=position_offset+1;
    end loop;
    update public.auction_publish_queues set status='running',paused_at=null,updated_at=clock_timestamp() where id=q.id returning * into q;
  elsif p_action='cancel' then
    if q.status in('completed','cancelled') then raise exception 'queue_not_cancellable'; end if;
    update public.whatsapp_dispatches
       set status='cancelled',locked_at=null,locked_by=null,updated_at=clock_timestamp()
     where queue_id=q.id and status in('scheduled','failed');
    update public.auction_publish_queues set status='cancelled',updated_at=clock_timestamp() where id=q.id returning * into q;
  else
    raise exception 'invalid_queue_action';
  end if;

  return to_jsonb(q);
end $$;

revoke execute on function public.control_auction_publish_queue(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.control_auction_publish_queue(uuid,text,uuid) to service_role;

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
    where queue_id=new.queue_id and status in('scheduled','sending','failed')
  ) then
    update public.auction_publish_queues
       set status='completed',updated_at=clock_timestamp()
     where id=new.queue_id and status not in('cancelled','paused');
  end if;
  return new;
end $$;

drop trigger if exists sync_auction_publish_queue_after_dispatch on public.whatsapp_dispatches;
create trigger sync_auction_publish_queue_after_dispatch
  after update of status on public.whatsapp_dispatches
  for each row when (old.status is distinct from new.status)
  execute function public.sync_auction_publish_queue_status();

create or replace function public.claim_whatsapp_dispatch(p_worker_id text)
returns setof public.whatsapp_dispatches
language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_queue_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 or length(p_worker_id)>200 then raise exception 'invalid_worker_id'; end if;

  update public.whatsapp_dispatches d
     set status=case
       when exists(select 1 from public.auction_publish_queues q where q.id=d.queue_id and q.status='cancelled') then 'cancelled'
       when attempts>=5 then 'failed'
       else 'scheduled'
     end,
     locked_at=null,locked_by=null,
     last_error=coalesce(last_error,'Recovered after stale worker lock'),
     updated_at=clock_timestamp()
   where d.status='sending' and d.locked_at<clock_timestamp()-interval '2 minutes';

  select d.id,d.queue_id into v_id,v_queue_id
    from public.whatsapp_dispatches d
   where d.status='scheduled'
     and d.scheduled_at<=clock_timestamp()
     and d.attempts<5
     and (
       d.queue_id is null
       or exists(select 1 from public.auction_publish_queues q where q.id=d.queue_id and q.status in('scheduled','running'))
     )
   order by d.scheduled_at,d.created_at
   for update skip locked
   limit 1;

  if v_id is null then return; end if;
  if v_queue_id is not null then
    update public.auction_publish_queues set status='running',updated_at=clock_timestamp()
     where id=v_queue_id and status='scheduled';
  end if;

  return query update public.whatsapp_dispatches
     set status='sending',locked_at=clock_timestamp(),locked_by=p_worker_id,
         attempts=attempts+1,last_error=null,updated_at=clock_timestamp()
   where id=v_id returning *;
end $$;

revoke execute on function public.claim_whatsapp_dispatch(text) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_dispatch(text) to service_role;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='auction_publish_queues') then
    alter publication supabase_realtime add table public.auction_publish_queues;
  end if;
end $$;

commit;
