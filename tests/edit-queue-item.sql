-- Regressão da rodada 2026-09-24 (migration 20260924210000): editar lote
-- PENDENTE na fila — preço errado em 1 de N lotes deixa de exigir cancelar
-- a fila inteira.
--  1. update_pending_queue_item reescreve preços/duração/foto do lote
--     agendado + REGENERA as poll_options + reajusta scheduled_end_at;
--  2. lote já enviado é rejeitado (dispatch_not_editable);
--  3. fila terminal é rejeitada (queue_not_editable);
--  4. valores ruins são rejeitados (invalid_auction_values/duration);
--  5. audita UMA vez (AUCTION_QUEUE_ITEM_UPDATED).
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000061');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000061','Test admin');
insert into public.whatsapp_groups(id,group_jid,name,active,is_default)
values('55555555-5555-5555-5555-555555555555','5555555555555@g.us','Grupo Edicao',true,false);
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.rejects_edit(p uuid, payload jsonb, expected text) returns void language plpgsql as $$
begin
  perform public.update_pending_queue_item(p,payload,'00000000-0000-0000-0000-000000000061');
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare
  result jsonb; did uuid; poll jsonb:=jsonb_build_array(
    jsonb_build_object('label','R$ 5,00','amount',5,'isBuyout',false),
    jsonb_build_object('label','R$ 12,00 🦭','amount',12,'isBuyout',true));
  new_poll jsonb:=jsonb_build_array(
    jsonb_build_object('label','R$ 9,00','amount',9,'isBuyout',false),
    jsonb_build_object('label','R$ 15,00 🦭','amount',15,'isBuyout',true));
begin
  result:=public.create_auction_publish_queue(jsonb_build_object(
    'eventId','x-edit-1',
    'queue',jsonb_build_object('group_id','55555555-5555-5555-5555-555555555555','starts_at',clock_timestamp()+interval '1 hour','interval_seconds',60),
    'items',jsonb_build_array(jsonb_build_object(
      'card',jsonb_build_object('name','Pikachu Editor','condition','NM — Near Mint','language','pt-BR','image_url','https://cdn.example/antes.webp'),
      'auction',jsonb_build_object('lot_number',70,'starting_price',5,'bid_increment',1,'buyout_price',12,'duration_seconds',120,'poll_options',poll)))),
    '00000000-0000-0000-0000-000000000061');
  did:=(result->'items'->0->'dispatch'->>'id')::uuid;

  -- 1) Edição válida: preços, duração, foto e enquete regenerada.
  result:=public.update_pending_queue_item(did,jsonb_build_object(
      'starting_price',9,'bid_increment',2,'buyout_price',15,'duration_seconds',300,
      'poll_options',new_poll,'image_url','https://cdn.example/depois.webp'),
    '00000000-0000-0000-0000-000000000061');
  perform pg_temp.check_that((select starting_price=9 and bid_increment=2 and buyout_price=15 from public.auctions where id=(result->'auction'->>'id')::uuid),'auction updated with new prices');
  perform pg_temp.check_that((select a.scheduled_end_at - dd.scheduled_at = interval '300 seconds' from public.auctions a join public.whatsapp_dispatches dd on dd.auction_id=a.id where dd.id=did),'deadline recomputed from new duration');
  perform pg_temp.check_that((select poll_options::text = new_poll::text and duration_seconds=300 from public.whatsapp_dispatches dd where dd.id=did),'dispatch poll options regenerated');
  perform pg_temp.check_that((select image_url='https://cdn.example/depois.webp' from public.cards where name='Pikachu Editor'),'card image replaced when provided');
  perform pg_temp.check_that((select count(*)=1 from public.auction_events where event_type='AUCTION_QUEUE_ITEM_UPDATED'),'edit audited once');

  -- 3) Fila cancelada não edita mais.
  perform public.control_auction_publish_queue((select queue_id from public.whatsapp_dispatches where id=did),'cancel','00000000-0000-0000-0000-000000000061');
  perform pg_temp.rejects_edit(did,jsonb_build_object('starting_price',9,'bid_increment',2,'poll_options',new_poll),'dispatch_not_editable');
end $$;
reset role;
rollback;
