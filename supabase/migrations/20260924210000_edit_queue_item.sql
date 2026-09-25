-- 2026-09-24 round: edit a PENDING queue item from the queue screen.
--
-- A typo in 1 of 20 scheduled lots used to force canceling the WHOLE queue.
-- New RPC update_pending_queue_item: rewrite prices/duration/image of a
-- scheduled dispatch + its auction, and REGENERATE the poll options the bot
-- will publish. Only scheduled dispatches of non-terminal queues; paused
-- queues CAN be edited (safest moment). Audited like every mutation.
--
-- The API route pre-builds poll_options (same builder as creation); the RPC
-- re-validates everything (defense in depth, mirrors create_auction_publish_queue).
begin;

create or replace function public.update_pending_queue_item(p_dispatch_id uuid,p_payload jsonb,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  d public.whatsapp_dispatches;
  a public.auctions;
  c public.cards;
  q public.auction_publish_queues;
  start_price numeric;
  increment_value numeric;
  buyout numeric;
  duration_value integer;
  options jsonb;
  new_image_url text;
  prev_start numeric; prev_increment numeric; prev_buyout numeric; prev_duration integer;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_payload)<>'object' then raise exception 'invalid_payload'; end if;

  select * into d from public.whatsapp_dispatches where id=p_dispatch_id for update;
  if not found then raise exception 'dispatch_not_found'; end if;
  if d.status<>'scheduled' then raise exception 'dispatch_not_editable'; end if;
  if d.queue_id is null then raise exception 'dispatch_not_in_queue'; end if;
  select * into q from public.auction_publish_queues where id=d.queue_id for share;
  if not found or q.status in('completed','cancelled') then raise exception 'queue_not_editable'; end if;
  select * into a from public.auctions where id=d.auction_id for update;
  if not found then raise exception 'auction_not_found'; end if;
  select * into c from public.cards where id=a.card_id for update;

  start_price:=coalesce((p_payload->>'starting_price')::numeric,a.starting_price);
  increment_value:=coalesce((p_payload->>'bid_increment')::numeric,a.bid_increment);
  buyout:=coalesce(nullif(p_payload->>'buyout_price','')::numeric,a.buyout_price);
  duration_value:=coalesce((p_payload->>'duration_seconds')::integer,d.duration_seconds);
  options:=coalesce(p_payload->'poll_options',d.poll_options);
  new_image_url:=coalesce(nullif(trim(coalesce(p_payload->>'image_url','')),''),nullif(trim(coalesce(c.image_url,'')),''));

  if start_price<0 or increment_value<=0 or buyout is not null and buyout<=start_price then raise exception 'invalid_auction_values'; end if;
  if duration_value<1 or duration_value>604800 then raise exception 'invalid_auction_duration'; end if;
  if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;
  if new_image_url is not null and new_image_url not like 'https://%' then raise exception 'invalid_card_image'; end if;

  prev_start:=a.starting_price; prev_increment:=a.bid_increment; prev_buyout:=a.buyout_price; prev_duration:=d.duration_seconds;

  perform set_config('app.admin_user_id',p_admin_user_id::text,true);
  update public.auctions
     set starting_price=start_price,bid_increment=increment_value,buyout_price=buyout,
         scheduled_end_at=d.scheduled_at+make_interval(secs=>duration_value::double precision),
         updated_at=clock_timestamp()
   where id=a.id returning * into a;
  if new_image_url is distinct from nullif(trim(coalesce(c.image_url,'')),'') then
    update public.cards set image_url=new_image_url,updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
  update public.whatsapp_dispatches
     set poll_options=options,duration_seconds=duration_value,updated_at=clock_timestamp()
   where id=d.id returning * into d;

  insert into public.auction_events(auction_id,admin_user_id,event_type,external_event_id,payload)
  values(a.id,p_admin_user_id,'AUCTION_QUEUE_ITEM_UPDATED','queue-item-updated:'||d.id::text||':'||extract(epoch from clock_timestamp())::bigint::text,
    jsonb_build_object('queue_id',q.id,'dispatch_id',d.id,'lot_number',a.lot_number,
      'previous',jsonb_build_object('starting_price',prev_start,'bid_increment',prev_increment,'buyout_price',prev_buyout,'duration_seconds',prev_duration),
      'next',jsonb_build_object('starting_price',start_price,'bid_increment',increment_value,'buyout_price',buyout,'duration_seconds',duration_value)));

  return jsonb_build_object('auction',to_jsonb(a),'dispatch',to_jsonb(d),'card',to_jsonb(c));
end $$;
revoke execute on function public.update_pending_queue_item(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.update_pending_queue_item(uuid,jsonb,uuid) to service_role;

commit;
