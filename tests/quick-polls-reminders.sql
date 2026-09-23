-- Regressão da rodada 2026-09-24 (migration 20260924120000):
--  1. extra_images nas cartas (wizard): válidas persistem; >4 e não-HTTPS
--     são rejeitadas (invalid_extra_images);
--  2. mark_purchase_paid: baixa de pagamento idempotente (payment → paid,
--     delivery → ready, 1 único evento de auditoria);
--  3. payment_reminders: cascade com a compra;
--  4. whatsapp_quick_polls: inserção service_role + duplicado de evento
--     rejeitado (idempotência do painel); RLS staff-only.
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000011');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000011','Test admin');
insert into public.whatsapp_groups(id,group_jid,name,active,is_default)
values('33333333-3333-3333-3333-333333333333','33333333-3333333333@g.us','Grupo Teste',true,false);
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
create function pg_temp.cmd(c jsonb) returns jsonb language sql as $$ select public.process_auction_command(c,'00000000-0000-0000-0000-000000000011') $$;
create function pg_temp.rejects(c jsonb, expected text) returns void language plpgsql as $$
begin
  perform pg_temp.cmd(c);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
-- O argumento de plpgsql é avaliado ANTES do call: um `rejects(create_auction_wizard(...))`
-- deixaria a exceção escapar. O wrapper chama o wizard DENTRO do handler.
create function pg_temp.rejects_wizard(p jsonb, expected text) returns void language plpgsql as $$
begin
  perform public.create_auction_wizard(p,'00000000-0000-0000-0000-000000000011');
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare wizard jsonb; card_id uuid; v_purchase uuid; result jsonb; p uuid;
  poll jsonb:=jsonb_build_array(
    jsonb_build_object('label','R$ 1,00','amount',1,'isBuyout',false),
    jsonb_build_object('label','R$ 2,00','amount',2,'isBuyout',false),
    jsonb_build_object('label','R$ 10,00 🦭','amount',10,'isBuyout',true));
  base jsonb:=jsonb_build_object('starting_price',1,'bid_increment',1,'buyout_price',10,
    'scheduled_at',clock_timestamp()+interval '1 hour',
    'group_id','33333333-3333-3333-3333-333333333333','poll_options',poll);
begin
  -- ------------------------------------------------------------------
  -- 1) extra_images via create_auction_wizard.
  -- ------------------------------------------------------------------
  wizard:=public.create_auction_wizard(jsonb_build_object(
    'eventId','x-img-1','card',jsonb_build_object('name','Pikachu','language','pt-BR','starting_price',1),
    'auction',base),'00000000-0000-0000-0000-000000000011');
  perform pg_temp.check_that((select jsonb_array_length(extra_images)=0 from public.cards where id=(wizard->'card'->>'id')::uuid),'wizard defaults extra_images to empty');

  perform pg_temp.rejects_wizard(jsonb_build_object(
    'eventId','x-img-2','card',jsonb_build_object('name','Pika','extra_images','["https://a/1","https://a/2","https://a/3","https://a/4","https://a/5"]'::jsonb),
    'auction',base),'invalid_extra_images');
  perform pg_temp.rejects_wizard(jsonb_build_object(
    'eventId','x-img-3','card',jsonb_build_object('name','Pika','extra_images','["http://inseguro/1"]'::jsonb),
    'auction',base),'invalid_extra_images');

  wizard:=public.create_auction_wizard(jsonb_build_object(
    'eventId','x-img-4',
    'card',jsonb_build_object('name','Charizard','extra_images','["https://cdn/1.jpg","https://cdn/2.jpg"]'::jsonb),
    'auction',base),'00000000-0000-0000-0000-000000000011');
  card_id:=(wizard->'card'->>'id')::uuid;
  perform pg_temp.check_that((select jsonb_array_length(extra_images)=2 from public.cards where id=card_id),'wizard persists valid extra_images');
  perform pg_temp.check_that((select extra_images->>0='https://cdn/1.jpg' from public.cards where id=card_id),'extra_images keep order');

  -- ------------------------------------------------------------------
  -- 2) mark_purchase_paid: arremate cria purchase + delivery em
  --    waiting_payment; a baixa é idempotente e audita UMA vez.
  -- ------------------------------------------------------------------
  perform pg_temp.cmd(jsonb_build_object('type','PARTICIPANT_CREATE','eventId','x-p1','data',jsonb_build_object('display_name','Ana','whatsapp_id','ana-x')));
  select id into p from public.participants where whatsapp_id='ana-x';
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','x-open','auctionId',wizard->'auction'->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','BUYOUT_CONFIRMED','eventId','x-buyout','auctionId',wizard->'auction'->>'id','participantId',p));
  select id into v_purchase from public.purchases where auction_id=(wizard->'auction'->>'id')::uuid;
  perform pg_temp.check_that((select status='waiting_payment' from public.deliveries deliv where deliv.purchase_id=v_purchase),'delivery starts waiting_payment');

  result:=public.mark_purchase_paid(v_purchase,'00000000-0000-0000-0000-000000000011','pix');
  perform pg_temp.check_that((result->>'already_paid')='false','first mark is a transition');
  perform pg_temp.check_that((select status='paid' from public.payments pay where pay.purchase_id=v_purchase),'payment marked paid');
  perform pg_temp.check_that((select amount=10 from public.payments pay where pay.purchase_id=v_purchase),'payment carries the purchase amount');
  perform pg_temp.check_that((select method='pix' from public.payments pay where pay.purchase_id=v_purchase),'payment keeps the method');
  perform pg_temp.check_that((select status='ready' from public.deliveries deliv where deliv.purchase_id=v_purchase),'delivery leaves waiting_payment');
  perform pg_temp.check_that((select count(*)=1 from public.auction_events where event_type='PURCHASE_PAID' and payload->>'purchase_id'=v_purchase::text),'exactly one audit event');

  result:=public.mark_purchase_paid(v_purchase,'00000000-0000-0000-0000-000000000011');
  perform pg_temp.check_that((result->>'already_paid')='true','second mark reports already_paid');
  perform pg_temp.check_that((select count(*)=1 from public.auction_events where event_type='PURCHASE_PAID'),'replay never re-audits');

  -- ------------------------------------------------------------------
  -- 3) payment_reminders: uma linha sobrevive para as checagens de RLS do
  --    fim do arquivo (compra 1); o CASCADE é provado numa segunda compra.
  -- ------------------------------------------------------------------
  insert into public.payment_reminders(purchase_id,participant_id,reminded_count,last_reminded_at)
  values(v_purchase,(select participant_id from public.purchases where id=v_purchase),1,now());
  perform pg_temp.check_that((select count(*)=1 from public.payment_reminders rem where rem.purchase_id=v_purchase),'reminder row created');

  wizard:=public.create_auction_wizard(jsonb_build_object(
    'eventId','x-img-5','card',jsonb_build_object('name','Cascade','language','pt-BR','starting_price',1),
    'auction',base),'00000000-0000-0000-0000-000000000011');
  perform pg_temp.cmd(jsonb_build_object('type','AUCTION_OPEN','eventId','x-open-2','auctionId',wizard->'auction'->>'id'));
  perform pg_temp.cmd(jsonb_build_object('type','BUYOUT_CONFIRMED','eventId','x-buyout-2','auctionId',wizard->'auction'->>'id','participantId',p));
  declare cascade_purchase uuid;
  begin
    select id into cascade_purchase from public.purchases where auction_id=(wizard->'auction'->>'id')::uuid;
    insert into public.payment_reminders(purchase_id,participant_id,reminded_count,last_reminded_at)
    values(cascade_purchase,(select participant_id from public.purchases where id=cascade_purchase),1,now());
    perform pg_temp.check_that((select count(*)=1 from public.payment_reminders rem2 where rem2.purchase_id=cascade_purchase),'cascade fixture created');
    delete from public.payments pay2 where pay2.purchase_id=cascade_purchase;
    delete from public.deliveries deliv2 where deliv2.purchase_id=cascade_purchase;
    delete from public.purchases purch2 where purch2.id=cascade_purchase;
    perform pg_temp.check_that((select count(*)=0 from public.payment_reminders rem2 where rem2.purchase_id=cascade_purchase),'reminders cascade with purchase');
  end;

  -- ------------------------------------------------------------------
  -- 4) whatsapp_quick_polls: inserção + duplicado de evento rejeitado.
  -- ------------------------------------------------------------------
  insert into public.whatsapp_quick_polls(group_id,title,options,external_event_id,scheduled_at)
  values('33333333-3333-3333-3333-333333333333','🎁 Brinde','["Quero! 🙋","Bora! 🔥"]'::jsonb,'quick-poll:dup-1',now());
  perform pg_temp.check_that((select count(*)=1 from public.whatsapp_quick_polls where external_event_id='quick-poll:dup-1'),'quick poll inserted');
  begin
    insert into public.whatsapp_quick_polls(group_id,title,options,external_event_id,scheduled_at)
    values('33333333-3333-3333-3333-333333333333','dup','["a","b"]'::jsonb,'quick-poll:dup-1',now());
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when unique_violation then
    null; -- conflito de evento: a rota devolve a mesma enquete em vez de duplicar
  end;
end $$;
reset role;
-- Browser: staff-only reads, no writes nas tabelas novas.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
select pg_temp.check_that((select count(*)=1 from public.payment_reminders),'staff can read reminders');
select pg_temp.check_that(not has_table_privilege(current_user,'public.whatsapp_quick_polls','INSERT'),'browser cannot write quick polls');
set local role authenticated;
-- o claim do staff check acima ainda está ativo na transação: limpa antes
select set_config('request.jwt.claim.sub',null,true);
select pg_temp.check_that((select count(*)=0 from public.payment_reminders),'non-staff cannot read reminders');
reset role;
rollback;
