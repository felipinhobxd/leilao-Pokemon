-- 2026-10-07 round 2: Detecção e auditoria de redução via RETIRADA + RE-OFERTA.
--
-- Hoje só a TROCA DIRETA (BID_CHANGED) gera histórico/aviso: o fluxo
-- "participante retira o voto e dá lance MENOR" chega ao RPC como
-- BID_PLACED (o bot zera o vote_state na retirada) e passava batido —
-- sem log, sem aviso, sem DM. Agora:
--  (1) value_change_log e participant_warnings ganham change_kind
--      ('change' = troca direta | 'withdraw_rebid' = re-oferta pós-retirada);
--  (2) NOVA função register_participant_reduction grava histórico + aviso +
--      ciclo de 3 + admin_notifications com o MESMO shape de payload que o
--      bot lê em bot/warning-notify.mjs (zero mudança no bot); roda DENTRO
--      da transação do chamador; idempotente por ON CONFLICT + o cache
--      processed_commands do process_auction_command;
--  (3) process_auction_command: ADDITION C no BID_PLACED compara com o
--      último lance WITHDRAWN do participante naquele leilão e chama o
--      helper. Toda re-oferta pós-retirada gera value_change_log; apenas a
--      REDUÇÃO conta aviso (mesma semântica do bloco B.2, que permanece
--      VERBATIM intocado — o caminho novo tem implementação própria);
--  (4) read_dashboard_snapshot expõe change_kind nas duas listas de avisos
--      (com a ADDITION participant_warning_stats de 20261007100000).
--      read_auction_snapshot (export/backup) usa select * — a coluna nova
--      flui sozinha para o Excel e para o backup JSON.
--
-- LATEST bodies: process_auction_command = 20261007100000 (esta cadeia);
-- read_dashboard_snapshot = 20261007100000. Copiados VERBATIM com apenas as
-- adições marcadas (regra docs/agent/03_DATABASE.md).
begin;

-- ---------------------------------------------------------------------------
-- 1) Colunas + índice (aditivos; backfill automático 'change').
-- ---------------------------------------------------------------------------
alter table public.value_change_log
  add column if not exists change_kind text not null default 'change';
alter table public.value_change_log
  drop constraint if exists value_change_log_change_kind_check;
alter table public.value_change_log
  add constraint value_change_log_change_kind_check
  check (change_kind in ('change','withdraw_rebid'));

alter table public.participant_warnings
  add column if not exists change_kind text not null default 'change';
alter table public.participant_warnings
  drop constraint if exists participant_warnings_change_kind_check;
alter table public.participant_warnings
  add constraint participant_warnings_change_kind_check
  check (change_kind in ('change','withdraw_rebid'));

-- Lookup do ADDITION C: último lance do participante no leilão. Também serve
-- o lookup de lance ativo existente (auction_id+participant_id).
create index if not exists bids_auction_participant_recent_idx
  on public.bids(auction_id,participant_id,processed_at desc,confirmation_order desc);

-- ---------------------------------------------------------------------------
-- 2) Helper: mesmo contrato de gravação do bloco B.2, parametrizado para o
--    caminho novo. Chamado apenas pelo ADDITION C — o B.2 (BID_CHANGED)
--    permanece inline verbatim, sem risco de regressão no caminho em
--    produção. Payload idêntico ao B.2: bot/warning-notify.mjs lê as mesmas
--    chaves sem nenhuma mudança.
-- ---------------------------------------------------------------------------
create or replace function public.register_participant_reduction(
  p_auction_id uuid, p_participant_id uuid, p_card_name text, p_lot_number integer,
  p_participant_name text, p_previous_amount numeric, p_new_amount numeric,
  p_event_id text, p_event_at timestamptz, p_change_kind text
) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.value_change_log(auction_id,participant_id,previous_amount,new_amount,difference,external_event_id,occurred_at,change_kind)
 values(p_auction_id,p_participant_id,p_previous_amount,p_new_amount,p_new_amount-p_previous_amount,p_event_id,p_event_at,p_change_kind)
 on conflict (external_event_id) do nothing;
 if p_new_amount<p_previous_amount then
  insert into public.participant_warnings(participant_id,auction_id,card_name,lot_number,previous_amount,new_amount,external_event_id,occurred_at,change_kind)
  values(p_participant_id,p_auction_id,p_card_name,p_lot_number,p_previous_amount,p_new_amount,p_event_id,p_event_at,p_change_kind)
  on conflict (external_event_id) do nothing;
  if (select count(*) from public.participant_warnings pw
      where pw.participant_id=p_participant_id
        and pw.created_at>coalesce((select max(pw2.created_at) from public.participant_warnings pw2
            where pw2.participant_id=p_participant_id and pw2.cycle_closed),'-infinity'::timestamptz))=3 then
   insert into public.admin_notifications(participant_id,kind,external_event_id,payload)
   values(p_participant_id,'WARNING_THRESHOLD',p_event_id,jsonb_build_object(
    'participant_name',p_participant_name,
    'total_warnings',3,
    'card_name',p_card_name,'lot_number',p_lot_number,
    'previous_amount',p_previous_amount,'new_amount',p_new_amount,'event_at',p_event_at,
    'warnings',(select jsonb_agg(jsonb_build_object(
       'card_name',w.card_name,'lot_number',w.lot_number,
       'previous_amount',w.previous_amount,'new_amount',w.new_amount,
       'occurred_at',w.occurred_at) order by w.created_at)
     from public.participant_warnings w where w.participant_id=p_participant_id
       and w.created_at>coalesce((select max(pw2.created_at) from public.participant_warnings pw2
           where pw2.participant_id=p_participant_id and pw2.cycle_closed),'-infinity'::timestamptz))))
   on conflict (external_event_id) do nothing;
   update public.participant_warnings pw set cycle_closed=true
    where pw.participant_id=p_participant_id and pw.external_event_id=p_event_id;
  end if;
 end if;
end $$;

revoke execute on function public.register_participant_reduction(uuid,uuid,text,integer,text,numeric,numeric,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.register_participant_reduction(uuid,uuid,text,integer,text,numeric,numeric,text,timestamptz,text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) process_auction_command: corpo de 20261007100000 + ADDITION C.
-- ---------------------------------------------------------------------------
create or replace function public.process_auction_command(p_command jsonb,p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 k text:=p_command->>'type'; eid text:=p_command->>'eventId';
 d jsonb:=coalesce(p_command->'data','{}'::jsonb);
 aid uuid:=nullif(p_command->>'auctionId','')::uuid;
 pid uuid:=nullif(p_command->>'participantId','')::uuid;
 rid uuid:=nullif(p_command->>'id','')::uuid;
 a public.auctions; c public.cards; p public.participants; b public.bids;
 prior public.processed_commands; result jsonb; request jsonb;
 amount numeric; purchase_id uuid; old_bid uuid; stamp timestamptz;
 event_at timestamptz; last_at timestamptz;
 old_amount numeric; -- ADDITION A: previous bid amount of the SAME participant
 suspend_until timestamptz; -- ADDITION (20261007100000): deadline for PARTICIPANT_SUSPEND
begin
 if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role in ('admin','operator')) then raise exception 'forbidden'; end if;
 perform set_config('app.admin_user_id',p_admin_user_id::text,true);
 if eid is null or length(eid)<1 or length(eid)>200 then raise exception 'invalid_event_id'; end if;
 request:=p_command||jsonb_build_object('actor',p_admin_user_id);
 perform pg_advisory_xact_lock(hashtextextended(eid,0));
 select * into prior from public.processed_commands where external_event_id=eid;
 if found then
  if prior.request<>request then raise exception 'event_id_conflict'; end if;
  return prior.result;
 end if;
 if k in ('CARD_CREATE','CARD_UPDATE','CARD_DELETE') then
  if k<>'CARD_CREATE' then
   select * into c from public.cards where id=rid for update;
   if not found then raise exception 'card_not_found'; end if;
   if c.status not in ('available','archived') or exists(select 1 from public.auctions where card_id=rid and status in ('open','review_required')) then raise exception 'card_in_use'; end if;
  end if;
  if k='CARD_DELETE' then update public.cards set status='archived',updated_at=clock_timestamp() where id=rid returning * into c;
  else
   if length(trim(coalesce(d->>'name','')))=0 then raise exception 'invalid_name'; end if;
   if k='CARD_CREATE' then
    insert into public.cards(name,collection,card_number,image_url,starting_price,buyout_price,notes)
     values(d->>'name',d->>'collection',d->>'card_number',d->>'image_url',(d->>'starting_price')::numeric,(d->>'buyout_price')::numeric,d->>'notes') returning * into c;
   else
    update public.cards set name=d->>'name',collection=d->>'collection',card_number=d->>'card_number',image_url=d->>'image_url',starting_price=(d->>'starting_price')::numeric,buyout_price=(d->>'buyout_price')::numeric,notes=d->>'notes',updated_at=clock_timestamp() where id=rid returning * into c;
   end if;
  end if;
  result:=to_jsonb(c);
 elsif k in ('PARTICIPANT_CREATE','PARTICIPANT_UPDATE','PARTICIPANT_DELETE') then
  if k<>'PARTICIPANT_CREATE' then
   select * into p from public.participants where id=rid for update;
   if not found then raise exception 'participant_not_found'; end if;
  end if;
  if k='PARTICIPANT_DELETE' then update public.participants set status='banned',updated_at=clock_timestamp() where id=rid returning * into p;
  else
   if length(trim(coalesce(d->>'display_name','')))=0 or length(trim(coalesce(d->>'whatsapp_id','')))=0 then raise exception 'invalid_participant'; end if;
   if k='PARTICIPANT_CREATE' then
    insert into public.participants(display_name,whatsapp_id,phone_e164,status,notes)
     values(d->>'display_name',d->>'whatsapp_id',d->>'phone_e164',coalesce(d->>'status','active')::public.participant_status,d->>'notes') returning * into p;
   else
    update public.participants set display_name=d->>'display_name',whatsapp_id=d->>'whatsapp_id',phone_e164=d->>'phone_e164',status=(d->>'status')::public.participant_status,notes=d->>'notes',updated_at=clock_timestamp() where id=rid returning * into p;
   end if;
  end if;
  result:=to_jsonb(p);
 elsif k in ('PARTICIPANT_SUSPEND','PARTICIPANT_REACTIVATE') then
  -- ADDITION (20261007100000): painel de participantes. SUSPEND com prazo
  -- grava só suspension_until (status continua 'active' — o guard
  -- participant_not_eligible AUTO-EXPIRA quando o prazo passa); sem prazo
  -- vira status='suspended' (indefinida, exige reativação manual). Banido
  -- não pode ser suspenso (não fazemos downgrade de ban). REACTIVATE limpa
  -- status e prazo — vale para suspenso e banido.
  select * into p from public.participants where id=rid for update;
  if not found then raise exception 'participant_not_found'; end if;
  if k='PARTICIPANT_SUSPEND' then
   if p.status='banned' then raise exception 'participant_banned'; end if;
   if nullif(trim(coalesce(d->>'suspension_until','')),'') is null then
    update public.participants set status='suspended',suspension_until=null,updated_at=clock_timestamp() where id=rid returning * into p;
   else
    suspend_until:=(d->>'suspension_until')::timestamptz;
    if suspend_until<=clock_timestamp() then raise exception 'invalid_suspension_until'; end if;
    update public.participants set suspension_until=suspend_until,updated_at=clock_timestamp() where id=rid returning * into p;
   end if;
  else
   update public.participants set status='active',suspension_until=null,updated_at=clock_timestamp() where id=rid returning * into p;
  end if;
  pid:=rid; -- ADDITION (20261007100000): liga o evento de auditoria ao participante
  result:=to_jsonb(p);
 elsif k='AUCTION_CREATE' then
  select * into c from public.cards where id=(d->>'card_id')::uuid for update;
  if not found or c.status<>'available' then raise exception 'card_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('auction_lot_number_seq',0));
  insert into public.auctions(card_id,starting_price,buyout_price,scheduled_end_at,created_by)
   values(c.id,c.starting_price,c.buyout_price,(d->>'scheduled_end_at')::timestamptz,p_admin_user_id) returning * into a;
  result:=to_jsonb(a);
 else
  select * into a from public.auctions where id=aid for update;
  if not found then raise exception 'auction_not_found'; end if;
  stamp:=clock_timestamp();
  if k in ('AUCTION_UPDATE','AUCTION_DELETE','AUCTION_OPEN') then
   if a.status<>'draft' then raise exception 'auction_not_draft'; end if;
   if k='AUCTION_UPDATE' then
    update public.auctions set starting_price=(d->>'starting_price')::numeric,buyout_price=(d->>'buyout_price')::numeric,scheduled_end_at=(d->>'scheduled_end_at')::timestamptz,updated_at=stamp where id=aid returning * into a;
   elsif k='AUCTION_DELETE' then update public.auctions set status='cancelled',cancellation_reason='Removed by staff',updated_at=stamp where id=aid returning * into a;
   else
    select * into c from public.cards where id=a.card_id for update;
    if c.status<>'available' then raise exception 'card_unavailable'; end if;
    if a.scheduled_end_at is not null and a.scheduled_end_at<=stamp then raise exception 'deadline_expired'; end if;
    update public.auctions set status='open',started_at=stamp,updated_at=stamp where id=aid returning * into a;
    update public.cards set status='in_auction',updated_at=stamp where id=c.id;
   end if;
   result:=to_jsonb(a);
  else
   if a.status<>'open' then raise exception 'auction_not_open'; end if;
   if k='AUCTION_FINALIZE' then
    perform 1 from public.participants where id in(select participant_id from public.bids where auction_id=aid and status='active') order by id for share;
    select bids.* into b from public.bids bids join public.participants pp on pp.id=bids.participant_id
     where bids.auction_id=aid and bids.status='active' and pp.status='active' and (pp.suspension_until is null or pp.suspension_until<=stamp)
     order by bids.amount desc,coalesce(bids.whatsapp_event_at,bids.processed_at),bids.processed_at,bids.confirmation_order limit 1;
    if not found then
     update public.auctions set status='closed',ended_at=stamp,updated_at=stamp where id=aid returning * into a;
     update public.cards set status='available',updated_at=stamp where id=a.card_id;
    else
     pid:=b.participant_id; amount:=b.amount;
    end if;
   elsif k in ('BID_PLACED','BID_CHANGED','BID_WITHDRAWN','BUYOUT_REQUESTED','BUYOUT_CONFIRMED') then
    if a.scheduled_end_at is not null and a.scheduled_end_at<=stamp then raise exception 'deadline_expired'; end if;
    select * into p from public.participants where id=pid for share;
    if not found then raise exception 'participant_not_found'; end if;
    if p.status<>'active' or (p.suspension_until is not null and p.suspension_until>stamp) then raise exception 'participant_not_eligible'; end if;
    event_at:=coalesce((p_command->>'occurredAt')::timestamptz,stamp);
    if event_at>stamp+interval '5 minutes' then raise exception 'invalid_event_time'; end if;
    select max((payload->>'event_at')::timestamptz) into last_at from public.auction_events where auction_id=aid and participant_id=pid and event_type in ('BID_PLACED','BID_CHANGED','BID_WITHDRAWN','BUYOUT_REQUESTED','BUYOUT_CONFIRMED');
    if event_at<a.started_at or (last_at is not null and event_at<last_at) then raise exception 'stale_event'; end if;
    select id into old_bid from public.bids where auction_id=aid and participant_id=pid and status='active';
    if k in ('BID_CHANGED','BID_WITHDRAWN') and old_bid is null then raise exception 'active_bid_not_found'; end if;
    if k='BID_PLACED' and old_bid is not null then raise exception 'active_bid_exists'; end if;
    if k='BID_WITHDRAWN' then
     update public.bids set status='withdrawn' where id=old_bid;
    elsif k in ('BUYOUT_REQUESTED','BUYOUT_CONFIRMED') then
     if a.buyout_price is null then raise exception 'buyout_not_enabled'; end if;
     if k='BUYOUT_CONFIRMED' then amount:=a.buyout_price; end if;
    end if;
    if k in ('BID_PLACED','BID_CHANGED','BUYOUT_CONFIRMED') then
     if k<>'BUYOUT_CONFIRMED' then amount:=(p_command->>'amount')::numeric; end if;
     if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<a.starting_price or amount<>round(amount,2) then raise exception 'invalid_bid_amount'; end if;
     if k='BID_CHANGED' and old_bid is not null then
      -- ADDITION B.1 — aliased on purpose: a bare `amount` here is ambiguous
      -- between bids.amount (column) and the plpgsql variable `amount`
      -- (SQLSTATE 42702 at runtime, raised BEFORE the enforce_bid_increment
      -- trigger could answer with bid_increment_required — CI failure
      -- tests/auction.sql "below_increment", fixed 2026-09-23).
      select prev.amount into old_amount from public.bids prev where prev.id=old_bid;
     end if;
     update public.bids set status='replaced' where id=old_bid;
     insert into public.bids(auction_id,participant_id,amount,kind,whatsapp_event_id,whatsapp_event_at,processed_at)
     values(aid,pid,amount,case when k='BUYOUT_CONFIRMED' then 'buyout'::public.bid_kind else 'bid'::public.bid_kind end,eid,event_at,stamp) returning * into b;
     update public.bids set replaced_by=b.id where id=old_bid;
     -- ADDITION B.2: value-change history + GLOBAL warning on DECREASE only.
     -- Increases and equal values never warn (equal labels are filtered by the
     -- bot; different labels cannot share an amount in this poll design).
     -- Every insert is idempotent on the event id (processed_commands already
     -- returns early for repeats; ON CONFLICT is the second belt).
     if k='BID_CHANGED' and old_amount is not null then
      insert into public.value_change_log(auction_id,participant_id,previous_amount,new_amount,difference,external_event_id,occurred_at)
      values(aid,pid,old_amount,amount,amount-old_amount,eid,event_at)
      on conflict (external_event_id) do nothing;
      if amount<old_amount then
       insert into public.participant_warnings(participant_id,auction_id,card_name,lot_number,previous_amount,new_amount,external_event_id,occurred_at)
       select pid,aid,cards.name,a.lot_number,old_amount,amount,eid,event_at
       from public.cards where id=a.card_id
       on conflict (external_event_id) do nothing;
       -- ADDITION (20260924200000): ciclo de 3 - exatamente 3 avisos NO
       -- CICLO ATUAL -> UMA notificacao de admin (idempotente). O contador
       -- considera apenas os avisos APOS o ultimo que fechou ciclo: a
       -- notificacao aos admins REINICIA o contador (decisao do operador
       -- 2026-09-24); nova sequencia de 3 gera nova notificacao.
       -- Baseline por created_at (ordem de INSERCAO - imune a event_at fora de ordem).
       if (select count(*) from public.participant_warnings pw
           where pw.participant_id=pid
             and pw.created_at>coalesce((select max(pw2.created_at) from public.participant_warnings pw2
                 where pw2.participant_id=pid and pw2.cycle_closed),'-infinity'::timestamptz))=3 then
        insert into public.admin_notifications(participant_id,kind,external_event_id,payload)
        select pid,'WARNING_THRESHOLD',eid,jsonb_build_object(
       'participant_name',p.display_name,
       'total_warnings',3,
       'card_name',cards.name,'lot_number',a.lot_number,
       'previous_amount',old_amount,'new_amount',amount,'event_at',event_at,
       'warnings',(select jsonb_agg(jsonb_build_object(
          'card_name',w.card_name,'lot_number',w.lot_number,
          'previous_amount',w.previous_amount,'new_amount',w.new_amount,
          'occurred_at',w.occurred_at) order by w.created_at)
        from public.participant_warnings w where w.participant_id=pid
          and w.created_at>coalesce((select max(pw2.created_at) from public.participant_warnings pw2
              where pw2.participant_id=pid and pw2.cycle_closed),'-infinity'::timestamptz)))
        from public.cards where id=a.card_id
        on conflict (external_event_id) do nothing;
       -- ADDITION (20260924200000): o aviso que FECHOU o ciclo fica marcado
       -- (cycle_closed) - e o baseline do proximo ciclo.
       update public.participant_warnings pw set cycle_closed=true
        where pw.participant_id=pid and pw.external_event_id=eid;
       end if;
      end if;
     end if;
     -- ADDITION C (20261007110000): re-oferta pós-RETIRADA. O fluxo "retira o
     -- voto e dá lance menor" chega como BID_PLACED (o bot zera o vote_state
     -- na retirada) e passava batido. Compara com o último lance WITHDRAWN do
     -- participante NO MESMO leilão: toda re-oferta pós-retirada gera
     -- value_change_log (change_kind='withdraw_rebid'); apenas a REDUÇÃO
     -- conta aviso + ciclo de 3 (mesma semântica do B.2 — subir/igualar não
     -- avisa). Alias `prev` obrigatório: `amount`/`status` de bids ×
     -- variáveis plpgsql é ambiguidade SQLSTATE 42702 (docs/agent/03_DATABASE).
     -- Primeiro lance (sem retirada anterior) não gera log. BUYOUT não passa
     -- aqui (não existe ARREMATE menor que lance). Concurrencia: SELECT
     -- indexado simples DENTRO da transação do comando — sem locks novos; a
     -- ordenação por participante continua garantida pelo guard stale_event.
     if k='BID_PLACED' then
      select prev.amount into old_amount
       from public.bids prev
       where prev.auction_id=aid and prev.participant_id=pid and prev.status='withdrawn'
       order by prev.processed_at desc,prev.confirmation_order desc limit 1;
      if found then
       perform public.register_participant_reduction(aid,pid,
        (select cc.name from public.cards cc where cc.id=a.card_id),a.lot_number,
        p.display_name,old_amount,amount,eid,event_at,'withdraw_rebid');
      end if;
     end if;
    end if;
   else raise exception 'unknown_command'; end if;
   if (k='AUCTION_FINALIZE' and b.id is not null) or k='BUYOUT_CONFIRMED' then
    update public.auctions set status='sold',winner_participant_id=pid,final_price=amount,win_type=case when k='BUYOUT_CONFIRMED' then 'buyout' else 'highest_bid' end,ended_at=stamp,updated_at=stamp where id=aid returning * into a;
    update public.cards set status='sold',updated_at=stamp where id=a.card_id;
    insert into public.purchases(auction_id,participant_id,card_id,amount) values(aid,pid,a.card_id,amount) returning id into purchase_id;
    insert into public.deliveries(purchase_id) values(purchase_id);
   end if;
   result:=jsonb_build_object('auction',to_jsonb(a),'bid',case when b.id is not null then to_jsonb(b) else null end,'purchase_id',purchase_id);
  end if;
 end if;
 insert into public.auction_events(auction_id,participant_id,admin_user_id,event_type,external_event_id,payload)
 values(coalesce(aid,a.id),pid,p_admin_user_id,k,eid,jsonb_build_object('result',result,'event_at',event_at));
 insert into public.processed_commands(external_event_id,request,result) values(eid,request,result);
 return result;
end $$;

revoke execute on function public.process_auction_command(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.process_auction_command(jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) read_dashboard_snapshot: corpo de 20261007100000 + change_kind nas duas
--    listas de avisos (o painel marca "após retirar o lance").
-- ---------------------------------------------------------------------------
create or replace function public.read_dashboard_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $body$
 select jsonb_build_object(
  'cards',coalesce((
    select jsonb_agg(x order by id)
    from (
      -- ADDITION (20260925150000): só cartas não-arquivadas (o painel não
      -- renderiza archived; eram TODAS as cartas inclusive vendidas antigas).
      select id,name,collection,card_number,image_url,starting_price,buyout_price,status,variant,language,condition,notes
      from public.cards
      where status <> 'archived'
      limit 2000
    ) x
  ),'[]'::jsonb),
  'participants',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,display_name,whatsapp_id,phone_e164,status,suspension_until,notes
      from public.participants
      limit 2000
    ) x
  ),'[]'::jsonb),
  'auctions',coalesce((
    select jsonb_agg(x order by created_at desc)
    from (
      select id,card_id,status,starting_price,bid_increment,buyout_price,scheduled_end_at,winner_participant_id,final_price,lot_number,created_at,win_type
      from public.auctions
      order by created_at desc
      limit 500
    ) x
  ),'[]'::jsonb),
  'bids',coalesce((
    select jsonb_agg(x order by processed_at desc)
    from (
      -- ADDITION (20260925150000): só os 500 lances mais recentes (o painel
      -- mostra o líder do leilão selecionado; 500 cobre qualquer leilão ao
      -- vivo). Antes: TODOS os lances acumulados = a maior parte dos 288 KB.
      select id,auction_id,participant_id,amount,status,processed_at,confirmation_order,whatsapp_event_at
      from public.bids
      order by processed_at desc
      limit 500
    ) x
  ),'[]'::jsonb),
  'auction_events',coalesce((select jsonb_agg(t order by created_at desc,id desc) from (select id,created_at,event_type,participant_id from public.auction_events order by created_at desc,id desc limit 15) t),'[]'::jsonb),
  'purchases',coalesce((
    select jsonb_agg(x order by id)
    from (
      select id,card_id,participant_id,auction_id,amount,status
      from public.purchases
      order by confirmed_at desc nulls last
      limit 500
    ) x
  ),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(t order by id) from (select id,purchase_id,amount,status,method,paid_at,reference from public.payments limit 1000) t),'[]'::jsonb),
  'payment_reminders',coalesce((select jsonb_agg(t order by last_reminded_at desc nulls last) from (select purchase_id,participant_id,reminded_count,last_reminded_at from public.payment_reminders limit 500) t),'[]'::jsonb),
  'deliveries','[]'::jsonb,
  'warnings','[]'::jsonb,
  'value_change_log',coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from (select id,participant_id,auction_id,previous_amount,new_amount,difference,external_event_id,occurred_at,change_kind from public.value_change_log order by occurred_at desc,id desc limit 200) t),'[]'::jsonb),
  'participant_warnings',coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from (select id,participant_id,auction_id,card_name,lot_number,previous_amount,new_amount,external_event_id,occurred_at,created_at,cycle_closed,change_kind from public.participant_warnings order by occurred_at desc,id desc limit 100) t),'[]'::jsonb),
  -- ADDITION (20261007100000): contadores de avisos por participante para o
  -- painel (o limit 100 da lista acima não serve para TOTAL). warnings_total =
  -- histórico completo (o contador é global e nunca zera); warnings_cycle =
  -- avisos no ciclo ABERTO, mesma fórmula de baseline cycle_closed do RPC
  -- (após fechar um ciclo, o contador reinicia em 0). Só participantes com
  -- pelo menos 1 aviso aparecem — os demais são 0/0 no painel.
  'participant_warning_stats',coalesce((
    select jsonb_agg(jsonb_build_object('participant_id',s.participant_id,'warnings_total',s.warnings_total,'warnings_cycle',s.warnings_cycle))
    from (
      select w.participant_id,
             count(*) as warnings_total,
             count(*) filter (where w.created_at>coalesce(b.baseline,'-infinity'::timestamptz)) as warnings_cycle
      from public.participant_warnings w
      left join lateral (
        select max(w2.created_at) as baseline
        from public.participant_warnings w2
        where w2.participant_id=w.participant_id and w2.cycle_closed
      ) b on true
      group by w.participant_id
      limit 2000
    ) s
  ),'[]'::jsonb)
 );
$body$;
revoke execute on function public.read_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.read_dashboard_snapshot() to service_role;

commit;
