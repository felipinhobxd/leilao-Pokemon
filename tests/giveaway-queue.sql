-- Regressão da rodada 2026-09-24 (migration 20260924160000): a carta marcada
-- como "Brinde" no wizard NÃO vira leilão — foto + enquete livre no lugar do
-- lote ("quem clicar primeiro leva", sem rastrear votos).
--  1. fila [leilão, brinde, leilão]: quick_poll na posição 2 com
--     título/foto/opções; NENHUM cards/auctions/dispatches para o brinde;
--     o lote seguinte é agendado DEPOIS do brinde;
--  2. replay idêntico = mesma fila (idempotência por eventId);
--  3. guards: opções 2..12 (1, 13, >100 chars, não-string) e foto http;
--  4. cancelar a fila apaga os brindes pendentes (nada enviado é perdido).
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000031');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000031','Test admin');
insert into public.whatsapp_groups(id,group_jid,name,active,is_default)
values('44444444-4444-4444-4444-444444444444','4444444444444@g.us','Grupo Brinde',true,false);
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
-- O argumento de plpgsql é avaliado ANTES do call: o helper chama o RPC
-- DENTRO do próprio handler (regra dos PERIGOS).
create function pg_temp.rejects_queue(p jsonb, p_admin uuid, expected text) returns void language plpgsql as $$
begin
  perform public.create_auction_publish_queue(p,p_admin);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare
  result jsonb; qid uuid; poll public.whatsapp_quick_polls; result2 jsonb;
  poll_options jsonb:=jsonb_build_array(
    jsonb_build_object('label','R$ 1,00','amount',1,'isBuyout',false),
    jsonb_build_object('label','R$ 2,00','amount',2,'isBuyout',false));
  auction_item jsonb:=jsonb_build_object('card',jsonb_build_object('name','Lote','language','pt-BR'),
    'auction',jsonb_build_object('starting_price',1,'bid_increment',1,'poll_options',poll_options));
  base jsonb:=jsonb_build_object(
    'eventId','x-give-1',
    'queue',jsonb_build_object('group_id','44444444-4444-4444-4444-444444444444','starts_at',clock_timestamp()+interval '1 hour','interval_seconds',60));
begin
  -- ------------------------------------------------------------------
  -- 1) fila [leilão, brinde, leilão].
  -- ------------------------------------------------------------------
  result:=public.create_auction_publish_queue(base
    ||jsonb_build_object('items',jsonb_build_array(
      auction_item||jsonb_build_object('auction',jsonb_build_object('lot_number',10,'starting_price',1,'bid_increment',1,'poll_options',poll_options)),
      jsonb_build_object('card',jsonb_build_object('name','Pikachu Brinde','image_url','https://cdn.example/brinde.webp'),
        'auction',jsonb_build_object(),'giveaway',jsonb_build_object('options',jsonb_build_array('Quero!','Bora!'))),
      auction_item||jsonb_build_object('auction',jsonb_build_object('lot_number',11,'starting_price',1,'bid_increment',1,'poll_options',poll_options)))),
    '00000000-0000-0000-0000-000000000031');
  qid:=(result->'queue'->>'id')::uuid;
  perform pg_temp.check_that((select total_items=3 from public.auction_publish_queues where id=qid),'queue counts the giveaway item');
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_quick_polls where queue_id=qid and queue_position=2),'giveaway poll created at its position');
  select * into poll from public.whatsapp_quick_polls where queue_id=qid and queue_position=2;
  perform pg_temp.check_that((poll.title='🎁 Brinde: Pikachu Brinde'),'giveaway title comes from the card name');
  perform pg_temp.check_that((poll.image_url='https://cdn.example/brinde.webp'),'giveaway carries the card photo');
  perform pg_temp.check_that((jsonb_array_length(poll.options)=2 and poll.options->>0='Quero!'),'giveaway options persisted in order');
  perform pg_temp.check_that((select count(*)=2 from public.whatsapp_dispatches where queue_id=qid and queue_position in (1,3)),'only the two auctions have dispatches');
  perform pg_temp.check_that((select count(*)=0 from public.cards where name='Pikachu Brinde'),'giveaway does not create a card row');
  perform pg_temp.check_that((select scheduled_at from public.whatsapp_dispatches where queue_id=qid and queue_position=3)
    > (select scheduled_at from public.whatsapp_quick_polls where queue_id=qid and queue_position=2),'next auction is scheduled after the giveaway');

  -- ------------------------------------------------------------------
  -- 2) replay idêntico devolve a mesma fila (idempotência).
  -- ------------------------------------------------------------------
  result2:=public.create_auction_publish_queue(base
    ||jsonb_build_object('items',jsonb_build_array(
      auction_item||jsonb_build_object('auction',jsonb_build_object('lot_number',10,'starting_price',1,'bid_increment',1,'poll_options',poll_options)),
      jsonb_build_object('card',jsonb_build_object('name','Pikachu Brinde','image_url','https://cdn.example/brinde.webp'),
        'auction',jsonb_build_object(),'giveaway',jsonb_build_object('options',jsonb_build_array('Quero!','Bora!'))),
      auction_item||jsonb_build_object('auction',jsonb_build_object('lot_number',11,'starting_price',1,'bid_increment',1,'poll_options',poll_options)))),
    '00000000-0000-0000-0000-000000000031');
  perform pg_temp.check_that((result2->'queue'->>'id')=(result->'queue'->>'id'),'replay returns the same queue');
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_quick_polls where queue_id=qid),'replay never duplicates the giveaway');

  -- ------------------------------------------------------------------
  -- 3) guards do brinde.
  -- ------------------------------------------------------------------
  perform pg_temp.rejects_queue(base||jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('card',jsonb_build_object('name','Pika'),'auction',jsonb_build_object(),'giveaway',jsonb_build_object('options',jsonb_build_array('Só uma'))))),
    '00000000-0000-0000-0000-000000000031','invalid_giveaway_options');
  perform pg_temp.rejects_queue(base||jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('card',jsonb_build_object('name','Pika'),'auction',jsonb_build_object(),
      'giveaway',jsonb_build_object('options',(select jsonb_agg('opção '||n) from generate_series(1,13) n))))),
    '00000000-0000-0000-0000-000000000031','invalid_giveaway_options');
  perform pg_temp.rejects_queue(base||jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('card',jsonb_build_object('name','Pika'),'auction',jsonb_build_object(),
      'giveaway',jsonb_build_object('options',jsonb_build_array('Quero!',repeat('x',101)))))),
    '00000000-0000-0000-0000-000000000031','invalid_giveaway_options');
  perform pg_temp.rejects_queue(base||jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('card',jsonb_build_object('name','Pika'),'auction',jsonb_build_object(),
      'giveaway',jsonb_build_object('options',jsonb_build_array('Quero!',42))))),
    '00000000-0000-0000-0000-000000000031','invalid_giveaway_options');
  perform pg_temp.rejects_queue(base||jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('card',jsonb_build_object('name','Pika','image_url','http://inseguro/1.webp'),'auction',jsonb_build_object(),
      'giveaway',jsonb_build_object('options',jsonb_build_array('Quero!','Bora!'))))),
    '00000000-0000-0000-0000-000000000031','invalid_giveaway_image');
  perform pg_temp.rejects_queue(base||jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('card',jsonb_build_object('name',''),'auction',jsonb_build_object(),
      'giveaway',jsonb_build_object('options',jsonb_build_array('Quero!','Bora!'))))),
    '00000000-0000-0000-0000-000000000031','invalid_card_name');

  -- ------------------------------------------------------------------
  -- 4) cancelar a fila apaga os brindes pendentes.
  -- ------------------------------------------------------------------
  perform public.control_auction_publish_queue(qid,'cancel','00000000-0000-0000-0000-000000000031');
  perform pg_temp.check_that((select count(*)=0 from public.whatsapp_quick_polls where queue_id=qid),'cancel deletes pending giveaways');
  perform pg_temp.check_that((select count(*)=2 from public.whatsapp_dispatches where queue_id=qid and status='cancelled'),'cancel still cancels dispatches');
end $$;
reset role;
rollback;
