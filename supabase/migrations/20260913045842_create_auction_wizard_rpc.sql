create or replace function public.create_auction_wizard(p_payload jsonb,p_admin_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare eid text:=trim(coalesce(p_payload->>'eventId','')); cd jsonb:=coalesce(p_payload->'card','{}'::jsonb); ad jsonb:=coalesce(p_payload->'auction','{}'::jsonb); req jsonb; prior public.processed_commands; c public.cards; a public.auctions; d public.whatsapp_dispatches; g public.whatsapp_groups; result jsonb; lot bigint; start_price numeric; increment_value numeric; buyout numeric; schedule_at timestamptz; end_at timestamptz; group_id uuid; options jsonb;
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in('admin','operator')) then raise exception 'forbidden'; end if;
 if length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
 req:=p_payload||jsonb_build_object('actor',p_admin_user_id,'type','AUCTION_WIZARD_CREATE'); perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into prior from public.processed_commands where external_event_id=eid; if found then if prior.request<>req then raise exception 'event_id_conflict'; end if; return prior.result; end if;
 perform set_config('app.admin_user_id',p_admin_user_id::text,true);
 start_price:=(ad->>'starting_price')::numeric; increment_value:=(ad->>'bid_increment')::numeric; buyout:=nullif(ad->>'buyout_price','')::numeric; schedule_at:=(ad->>'scheduled_at')::timestamptz; end_at:=nullif(ad->>'scheduled_end_at','')::timestamptz; group_id:=(ad->>'group_id')::uuid; options:=ad->'poll_options'; lot:=nullif(ad->>'lot_number','')::bigint;
 if start_price<0 or increment_value<=0 or buyout is not null and buyout<start_price then raise exception 'invalid_auction_values'; end if;
 if end_at is not null and end_at<=schedule_at then raise exception 'invalid_end_time'; end if;
 if jsonb_typeof(options)<>'array' or jsonb_array_length(options)<1 or jsonb_array_length(options)>12 then raise exception 'invalid_poll_options'; end if;
 select * into g from public.whatsapp_groups where id=group_id and active for share; if not found then raise exception 'whatsapp_group_unavailable'; end if;
 if lot is not null then if lot<=0 or exists(select 1 from public.auctions where lot_number=lot) then raise exception 'lot_number_in_use'; end if; else loop lot:=nextval('public.auction_lot_number_seq'); exit when not exists(select 1 from public.auctions where lot_number=lot); end loop; end if;
 insert into public.cards(name,collection,card_number,variant,language,condition,image_url,starting_price,buyout_price) values(trim(cd->>'name'),nullif(trim(coalesce(cd->>'collection','')),''),nullif(trim(coalesce(cd->>'card_number','')),''),nullif(trim(coalesce(cd->>'variant','')),''),coalesce(nullif(trim(coalesce(cd->>'language','')),''),'pt-BR'),nullif(trim(coalesce(cd->>'condition','')),''),nullif(trim(coalesce(cd->>'image_url','')),''),start_price,buyout) returning * into c;
 insert into public.auctions(card_id,lot_number,starting_price,bid_increment,buyout_price,scheduled_end_at,created_by) values(c.id,lot,start_price,increment_value,buyout,end_at,p_admin_user_id) returning * into a;
 insert into public.whatsapp_dispatches(auction_id,group_id,scheduled_at,poll_title,poll_options,status,created_by) values(a.id,g.id,schedule_at,lot::text||'. Lances',options,'scheduled',p_admin_user_id) returning * into d;
 insert into public.auction_events(auction_id,admin_user_id,event_type,external_event_id,payload) values(a.id,p_admin_user_id,'AUCTION_WIZARD_CREATED',eid,jsonb_build_object('card_id',c.id,'dispatch_id',d.id,'lot_number',lot,'group_id',g.id));
 result:=jsonb_build_object('card',to_jsonb(c),'auction',to_jsonb(a),'dispatch',to_jsonb(d)); insert into public.processed_commands(external_event_id,request,result) values(eid,req,result); return result;
end $$;
revoke execute on function public.create_auction_wizard(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_auction_wizard(jsonb,uuid) to service_role;
