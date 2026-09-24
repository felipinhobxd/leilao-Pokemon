-- 2026-09-24 round: giveaway items INSIDE the publish queue — a card marked
-- as "Brinde" in the wizard does NOT become an auction: in its queue position
-- the bot publishes the card photo + a free-text giveaway poll ("quem clicar
-- primeiro leva", votes are NOT tracked — operator decision).
--
-- whatsapp_quick_polls gains image_url + queue_id + queue_position so a
-- giveaway occupies a slot in the queue timeline and the NEXT auction's
-- dispatch is scheduled AFTER it. dispatches keeps auction_id NOT NULL
-- (untouched) — that is why giveaways live here.
--
-- Conventions (docs/agent/03_DATABASE.md): create-or-replace/additive;
-- replaced functions are copied VERBATIM from their LATEST versions with
-- ONLY the marked additions.
begin;

-- ---------------------------------------------------------------------------
-- 1) whatsapp_quick_polls: image (the card photo sent before the poll),
--    queue link (CASCADE: deleting a queue deletes its pending giveaways —
--    purge/cleanup need no extra step) and the position inside the queue.
-- ----------------------------------------------------------------------------
alter table public.whatsapp_quick_polls
  add column if not exists image_url text;
alter table public.whatsapp_quick_polls
  add column if not exists queue_id uuid references public.auction_publish_queues(id) on delete cascade;
alter table public.whatsapp_quick_polls
  add column if not exists queue_position integer;
create index if not exists whatsapp_quick_polls_queue_pending_idx
  on public.whatsapp_quick_polls (queue_id, queue_position) where sent_at is null;

-- ---------------------------------------------------------------------------
-- 2) create_auction_publish_queue: LATEST body is 20260924150000. Copied
--    VERBATIM with ONLY the marked additions (declare go/qp + the giveaway
--    branch right after the card-name check, before the auction path).
-- ----------------------------------------------------------------------------
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
  extras jsonb; -- ADDITION A
  go jsonb; -- ADDITION (20260924160000): giveaway item payload
  qp public.whatsapp_quick_polls; -- ADDITION (20260924160000): inserted giveaway row
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

    -- ADDITION (20260924160000): giveaway item — foto + enquete de brinde no
    -- lugar do leilão. Sem cards/auctions/dispatches (dispatches exige
    -- auction_id NOT NULL); a posição SEGUE contando, então o próximo lote é
    -- agendado DEPOIS do brinde. Título automático com o nome da carta.
    go:=item->'giveaway';
    if jsonb_typeof(go)='object' then
      if jsonb_typeof(coalesce(go->'options','null'::jsonb))<>'array'
         or jsonb_array_length(coalesce(go->'options','null'::jsonb))<2
         or jsonb_array_length(coalesce(go->'options','null'::jsonb))>12
         or exists(select 1 from jsonb_array_elements(coalesce(go->'options','[]'::jsonb)) e
                   where jsonb_typeof(e)<>'string'
                   or char_length(e#>>'{}')<1
                   or char_length(e#>>'{}')>100) then raise exception 'invalid_giveaway_options'; end if;
      if cd->>'image_url' is not null and cd->>'image_url' not like 'https://%' then raise exception 'invalid_giveaway_image'; end if;
      schedule_at:=queue_start+make_interval(secs=>((position_value-1)*interval_value)::double precision);
      insert into public.whatsapp_quick_polls(group_id,queue_id,queue_position,title,options,image_url,scheduled_at,external_event_id,created_by)
      values(g.id,q.id,position_value,left('🎁 Brinde: '||trim(cd->>'name'),200),go->'options',nullif(cd->>'image_url',''),schedule_at,eid||':giveaway:'||position_value,p_admin_user_id)
      returning * into qp;
      result_items:=result_items||jsonb_build_array(jsonb_build_object('poll',to_jsonb(qp),'position',position_value));
      continue;
    end if;

    start_price:=(ad->>'starting_price')::numeric;
    increment_value:=(ad->>'bid_increment')::numeric;
    buyout:=nullif(ad->>'buyout_price','')::numeric;
    duration_value:=(ad->>'duration_seconds')::integer;
    options:=ad->'poll_options';
    lot:=nullif(ad->>'lot_number','')::bigint;
    -- ADDITION A.1: extra detail photos (max 4, all HTTPS, array order kept).
    extras:=coalesce(cd->'extra_images','[]'::jsonb);
    if jsonb_typeof(extras)<>'array' or jsonb_array_length(extras)>4
       or exists(select 1 from jsonb_array_elements(extras) e where jsonb_typeof(e)<>'string'
                 or not (e#>>'{}' ~ '^https://')
                 or char_length(e#>>'{}')>500) then raise exception 'invalid_extra_images'; end if;

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

    insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price,extra_images)
    values(
      trim(cd->>'name'),
      nullif(trim(coalesce(cd->>'collection','')),''),
      nullif(trim(coalesce(cd->>'card_number','')),''),
      nullif(trim(coalesce(cd->>'variant','')),''),
      coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),
      nullif(trim(coalesce(cd->>'condition','')),''),
      nullif(trim(coalesce(cd->>'image_url','')),''),
      start_price,buyout,
      extras -- ADDITION A.2
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

-- ---------------------------------------------------------------------------
-- 3) control_auction_publish_queue: LATEST body is 20260913202000 (never
--    replaced since). Copied VERBATIM with ONLY the marked additions:
--    resume re-times pending giveaways AFTER the pending auctions
--    (simplification documented inline); cancel deletes pending giveaways
--    (nothing already sent is lost).
-- ----------------------------------------------------------------------------
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
    -- ADDITION (20260924160000): brindes pendentes são re-agendados DEPOIS dos
    -- lotes pendentes (a ordem exata de posições é mantida entre leilões;
    -- brindes vão para o fim da janela restante — sem duplicação).
    update public.whatsapp_quick_polls qp
      set scheduled_at=clock_timestamp()
           +make_interval(secs=>((position_offset + pending_ordinal.ordinal - 1) * q.interval_seconds)::double precision)
      from (
        select qp2.id, row_number() over (order by qp2.queue_position, qp2.id) as ordinal
        from public.whatsapp_quick_polls qp2
        where qp2.queue_id=q.id and qp2.sent_at is null
      ) pending_ordinal
      where qp.id=pending_ordinal.id;
    update public.auction_publish_queues set status='running',paused_at=null,updated_at=clock_timestamp() where id=q.id returning * into q;
  elsif p_action='cancel' then
    if q.status in('completed','cancelled') then raise exception 'queue_not_cancellable'; end if;
    update public.whatsapp_dispatches
       set status='cancelled',locked_at=null,locked_by=null,updated_at=clock_timestamp()
     where queue_id=q.id and status in('scheduled','failed');
    -- ADDITION (20260924160000): brindes pendentes morrem com a fila (nada
    -- já enviado é perdido).
    delete from public.whatsapp_quick_polls qp where qp.queue_id=q.id and qp.sent_at is null;
    update public.auction_publish_queues set status='cancelled',updated_at=clock_timestamp() where id=q.id returning * into q;
  else
    raise exception 'invalid_queue_action';
  end if;
  return to_jsonb(q);
end $$;
revoke execute on function public.control_auction_publish_queue(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.control_auction_publish_queue(uuid,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) sync_auction_publish_queue_status: LATEST body is 20260913203200 (it
--    REMOVED 'failed' from the pending list — a terminal failure must not
--    keep the queue running forever). Copied VERBATIM with ONLY the marked
--    additions: the function now serves BOTH tables (whatsapp_quick_polls
--    has no `status` column — "publicado" lá é sent_at) and pending
--    giveaways hold the queue from completing early. A second trigger wires
--    quick_poll updates into the same logic.
-- ----------------------------------------------------------------------------
create or replace function public.sync_auction_publish_queue_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  item_sent boolean; -- ADDITION (20260924160000)
begin
  if new.queue_id is null then return new; end if;
  -- ADDITION (20260924160000): dispatches falam `status`; quick_polls fala
  -- `sent_at` (não tem coluna status).
  if tg_table_name='whatsapp_quick_polls' then
    item_sent:=new.sent_at is not null;
  else
    item_sent:=new.status='sent';
  end if;
  if item_sent then
    update public.auction_publish_queues
       set status=case when status='scheduled' then 'running' else status end,
           updated_at=clock_timestamp()
     where id=new.queue_id and status not in('paused','cancelled','completed');
  end if;
  if not exists(
    select 1 from public.whatsapp_dispatches
    where queue_id=new.queue_id and status in('scheduled','sending')
  ) -- ADDITION (20260924160000): brindes pendentes também seguram a conclusão
  and not exists(
    select 1 from public.whatsapp_quick_polls
    where queue_id=new.queue_id and sent_at is null
  ) then
    update public.auction_publish_queues
       set status='completed',updated_at=clock_timestamp()
     where id=new.queue_id and status not in('cancelled','paused');
  end if;
  return new;
end $$;

revoke execute on function public.sync_auction_publish_queue_status() from public, anon, authenticated;
grant execute on function public.sync_auction_publish_queue_status() to service_role;

drop trigger if exists sync_auction_publish_queue_after_dispatch on public.whatsapp_dispatches;
create trigger sync_auction_publish_queue_after_dispatch
  after update of status on public.whatsapp_dispatches
  for each row when (old.status is distinct from new.status)
  execute function public.sync_auction_publish_queue_status();

-- ADDITION (20260924160000): publicar o brinde também move a fila para frente.
drop trigger if exists sync_auction_queue_after_quick_poll on public.whatsapp_quick_polls;
create trigger sync_auction_queue_after_quick_poll
  after update of sent_at on public.whatsapp_quick_polls
  for each row when (old.sent_at is distinct from new.sent_at)
  execute function public.sync_auction_publish_queue_status();

commit;
