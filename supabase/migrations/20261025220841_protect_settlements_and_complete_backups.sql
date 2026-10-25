-- Maintenance preserves every financial sale, including paid purchases.
-- No changes to bidding, scheduling, individual deletion or explicit full reset.
begin;
CREATE OR REPLACE FUNCTION public.cleanup_old_auctions(p_hours integer DEFAULT 12, p_audit_days integer DEFAULT 7)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
declare
  cutoff timestamptz:=clock_timestamp()-make_interval(hours=>greatest(coalesce(p_hours,12),1));
  -- ADDITION (P-17, 2026-10-08): janela de prune da auditoria/idempotência.
  audit_cutoff timestamptz:=clock_timestamp()-make_interval(days=>greatest(coalesce(p_audit_days,7),1));
  card_ids uuid[];
  eligible_ids uuid[];
  preserved_financial bigint:=0;
  n_payments bigint:=0; n_deliveries bigint:=0; n_purchases bigint:=0; n_warnings bigint:=0; n_votes bigint:=0;
  n_dispatches bigint:=0; n_queues bigint:=0; n_events bigint:=0; n_bids bigint:=0; n_changes bigint:=0;
  n_auctions bigint:=0; n_cards bigint:=0; n_tmp bigint:=0;
  -- ADDITION (P-17, 2026-10-08): contadores do prune.
  n_audit_events bigint:=0; n_commands bigint:=0;
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id='business-backups'
      and (name like 'backups/backup-' || to_char(clock_timestamp(),'YYYYMMDD') || '-%.json' or name like 'backups/backup-' || to_char(clock_timestamp(),'YYYYMMDD') || '-%.json.gz')
  ) then
    return jsonb_build_object(
      'cutoff', cutoff, 'blocked', true, 'reason', 'daily_cloud_backup_missing',
      'deleted', jsonb_build_object('payments',0,'deliveries',0,'purchases',0,'warnings',0,'vote_state',0,'dispatches',0,'queues',0,'events',0,'bids',0,'value_changes',0,'auctions',0,'cards',0,'audit_events',0,'processed_commands',0)
    );
  end if;
  -- Freeze and lock candidates once. A concurrent purchase needs a FK key
  -- lock on its auction and cannot appear while we remove this tree.
  select coalesce(array_agg(id),'{}'::uuid[]) into eligible_ids from (
    select a.id from public.auctions a
    where coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
      and a.status in ('closed','sold','cancelled')
      and not exists(select 1 from public.purchases p where p.auction_id=a.id)
      and not exists(select 1 from public.whatsapp_auction_notices n where n.auction_id=a.id and n.sent_at is null)
    order by a.id for update of a
  ) candidates;
  -- A purchase may have committed after the candidate statement's snapshot.
  -- Recheck after acquiring auction locks; later FK inserts must now wait.
  select coalesce(array_agg(a.id),'{}'::uuid[]) into eligible_ids
    from public.auctions a where a.id=any(eligible_ids)
      and not exists(select 1 from public.purchases p where p.auction_id=a.id);
  select count(*) into preserved_financial from public.auctions a
    where coalesce(a.ended_at,a.scheduled_end_at,a.created_at)<cutoff
      and a.status in ('closed','sold','cancelled')
      and exists(select 1 from public.purchases p where p.auction_id=a.id);
  execute 'drop trigger if exists immutable_audit on public.auction_events';
  with gone as (delete from public.payments pu using public.purchases z join public.auctions a on a.id=z.auction_id
    where pu.purchase_id=z.id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_payments from gone;
  with gone as (delete from public.deliveries dl using public.purchases z join public.auctions a on a.id=z.auction_id
    where dl.purchase_id=z.id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_deliveries from gone;
  with gone as (delete from public.purchases z using public.auctions a
    where a.id=z.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_purchases from gone;
  with gone as (delete from public.warnings w using public.auctions a
    where a.id=w.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_warnings from gone;
  with gone as (delete from public.whatsapp_vote_state v using public.auctions a
    where a.id=v.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_votes from gone;
  with gone as (delete from public.whatsapp_dispatches dd using public.auctions a
    where a.id=dd.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_dispatches from gone;
  with gone as (delete from public.auction_publish_queues q where q.created_at<cutoff and q.status in ('completed','cancelled') and not exists(select 1 from public.whatsapp_dispatches kept where kept.queue_id=q.id) and not exists(select 1 from public.whatsapp_quick_polls qp where qp.queue_id=q.id) and not exists(select 1 from public.whatsapp_auction_notices n where n.queue_id=q.id and n.sent_at is null) returning 1)
  select count(*) into n_queues from gone;
  with gone as (delete from public.auction_events e using public.auctions a
    where a.id=e.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_events from gone;
  with gone as (delete from public.bids b2 using public.auctions a
    where a.id=b2.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_bids from gone;
  with gone as (delete from public.value_change_log vc using public.auctions a
    where a.id=vc.auction_id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_changes from gone;
  with gone as (delete from public.auctions a where a.id=any(eligible_ids) returning a.card_id)
  select count(*), coalesce(array_agg(distinct card_id) filter (where card_id is not null), '{}'::uuid[]) into n_auctions, card_ids from gone;
  -- Only cards orphaned BY THIS RUN are deleted: a standalone card (manual
  -- or brinde, never auctioned) survives the cleanup untouched.
  with gone as (delete from public.cards c where c.id = any(card_ids) and not exists(select 1 from public.auctions a where a.card_id=c.id) returning 1)
  select count(*) into n_cards from gone;
  -- ADDITION (P-17, 2026-10-08): prune da auditoria e do cache de
  -- idempotência além da janela de p_audit_days (default 7 dias). O trigger
  -- immutable_audit está derrubado desde o topo e volta logo abaixo — o
  -- prune só acontece dentro desta transação, protegida pelo guard de
  -- backup do dia. Eventos NOVOS (< janela) sobrevivem, inclusive os de
  -- filas futuras recém-criadas; guardas de negócio (stale_event) leem
  -- eventos do leilão EM DISPUTA (minutos/horas), nunca de 7 dias atrás.
  with gone as (delete from public.auction_events e where e.created_at < audit_cutoff and not exists(select 1 from public.auctions kept where kept.id=e.auction_id) returning 1)
  select count(*) into n_audit_events from gone;
  with gone as (delete from public.processed_commands where created_at < audit_cutoff returning 1)
  select count(*) into n_commands from gone;
  execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';
  return jsonb_build_object('cutoff',cutoff,'preserved_financial_auctions',preserved_financial,'deleted',jsonb_build_object(
   'payments',n_payments,'deliveries',n_deliveries,'purchases',n_purchases,'warnings',n_warnings,
   'vote_state',n_votes,'dispatches',n_dispatches,'queues',n_queues,'events',n_events,'bids',n_bids,
   'value_changes',n_changes,'auctions',n_auctions,'cards',n_cards,
   'audit_events',n_audit_events,'processed_commands',n_commands));
end
$function$;

revoke execute on function public.cleanup_old_auctions(integer,integer) from public,anon,authenticated;
grant execute on function public.cleanup_old_auctions(integer,integer) to service_role;


create or replace function public.delete_completed_auctions(
  p_event_id uuid,p_confirm1 text,p_confirm2 text,p_admin_user_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  prior public.processed_commands;
  req jsonb;
  target record;
  removed integer := 0;
  preserved integer := 0;
  result jsonb;
begin
  if not exists(select 1 from public.admin_profiles where user_id=p_admin_user_id and active and role='admin') then
    raise exception 'forbidden';
  end if;
  if coalesce(p_confirm1,'')<>'excluir leilões encerrados'
     or coalesce(p_confirm2,'')<>'quero excluir os encerrados' then
    raise exception 'delete_not_confirmed';
  end if;
  if p_event_id is null then raise exception 'invalid_event_id'; end if;
  req := jsonb_build_object('type','COMPLETED_AUCTIONS_DELETE','actor',p_admin_user_id,'eventId',p_event_id);
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  select * into prior from public.processed_commands where external_event_id=p_event_id::text;
  if found then
    if prior.request<>req then raise exception 'event_id_conflict'; end if;
    return prior.result;
  end if;

  -- Locks recheck status after concurrent changes. Draft/open/review never
  -- qualify, including scheduled drafts whose dispatch is still pending.
  for target in select id from public.auctions
    where status in ('sold','closed','cancelled') order by id for update
  loop
    if exists(select 1 from public.purchases p where p.auction_id=target.id) then
      preserved:=preserved+1;
      continue;
    end if;
    perform public.delete_auction(target.id,'sim quero',p_admin_user_id);
    removed := removed+1;
  end loop;

  result := jsonb_build_object('deleted_auctions',removed,'preserved_financial_auctions',preserved);
  insert into public.auction_events(admin_user_id,event_type,external_event_id,payload)
    values(p_admin_user_id,'COMPLETED_AUCTIONS_DELETED','completed-auctions-delete:'||p_event_id::text,result);
  insert into public.processed_commands(external_event_id,request,result)
    values(p_event_id::text,req,result);
  return result;
end $$;
revoke execute on function public.delete_completed_auctions(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_completed_auctions(uuid,text,text,uuid) to service_role;

create or replace function public.export_business_backup()
returns jsonb
language sql
stable
set search_path = ''
set statement_timeout = '55s'
set work_mem = '32MB'
as $function$
 select jsonb_build_object(
  'cards',              coalesce((select jsonb_agg(t order by id) from public.cards t),'[]'::jsonb),
  'participants',       coalesce((select jsonb_agg(t order by id) from public.participants t),'[]'::jsonb),
  'participant_identities', coalesce((select jsonb_agg(t order by identity) from public.participant_identities t),'[]'::jsonb),
  'auctions',           coalesce((select jsonb_agg(t order by id) from public.auctions t),'[]'::jsonb),
  'bids',               coalesce((select jsonb_agg(t order by id) from public.bids t),'[]'::jsonb),
  'purchases',          coalesce((select jsonb_agg(t order by id) from public.purchases t),'[]'::jsonb),
  'payments',           coalesce((select jsonb_agg(t order by id) from public.payments t),'[]'::jsonb),
  'deliveries',         coalesce((select jsonb_agg(t order by id) from public.deliveries t),'[]'::jsonb),
  'warnings',           coalesce((select jsonb_agg(t order by id) from public.warnings t),'[]'::jsonb),
  'value_change_log',   coalesce((select jsonb_agg(t order by occurred_at desc,id desc) from public.value_change_log t),'[]'::jsonb),
  'participant_warnings', coalesce((select jsonb_agg(t order by created_at desc,id desc) from public.participant_warnings t),'[]'::jsonb),
  'admin_notifications', coalesce((select jsonb_agg(t order by created_at desc,id desc) from public.admin_notifications t),'[]'::jsonb),
  'auction_events',     coalesce((select jsonb_agg(t order by id) from public.auction_events t where t.created_at >= now() - interval '7 days' or exists(select 1 from public.auctions kept where kept.id=t.auction_id)),'[]'::jsonb),
  'processed_commands', coalesce((select jsonb_agg(t order by external_event_id) from public.processed_commands t where t.created_at >= now() - interval '7 days'),'[]'::jsonb),
  'whatsapp_groups',    coalesce((select jsonb_agg(t order by id) from public.whatsapp_groups t),'[]'::jsonb),
  'whatsapp_dispatches', coalesce((select jsonb_agg(t order by id) from public.whatsapp_dispatches t),'[]'::jsonb),
  'auction_publish_queues', coalesce((select jsonb_agg(t order by id) from public.auction_publish_queues t),'[]'::jsonb),
  'whatsapp_vote_state', coalesce((select jsonb_agg(t order by auction_id, voter_jid) from public.whatsapp_vote_state t),'[]'::jsonb),
  'whatsapp_quick_polls', coalesce((select jsonb_agg(t order by id) from public.whatsapp_quick_polls t),'[]'::jsonb),
  'payment_reminders',  coalesce((select jsonb_agg(t order by last_reminded_at desc nulls last) from public.payment_reminders t),'[]'::jsonb),
  'auction_drafts', coalesce((select jsonb_agg(t order by id) from public.auction_drafts t),'[]'::jsonb),
  'whatsapp_auction_notices', coalesce((select jsonb_agg(t order by id) from public.whatsapp_auction_notices t),'[]'::jsonb)
 );
$function$;


create or replace function public.export_business_backup_text()
returns json
language sql
stable
set search_path = ''
set statement_timeout = '55s'
set work_mem = '32MB'
as $function$
 select json_build_object(
  'cards',              coalesce((select json_agg(t order by id) from public.cards t),'[]'::json),
  'participants',       coalesce((select json_agg(t order by id) from public.participants t),'[]'::json),
  'participant_identities', coalesce((select json_agg(t order by identity) from public.participant_identities t),'[]'::json),
  'auctions',           coalesce((select json_agg(t order by id) from public.auctions t),'[]'::json),
  'bids',               coalesce((select json_agg(t order by id) from public.bids t),'[]'::json),
  'purchases',          coalesce((select json_agg(t order by id) from public.purchases t),'[]'::json),
  'payments',           coalesce((select json_agg(t order by id) from public.payments t),'[]'::json),
  'deliveries',         coalesce((select json_agg(t order by id) from public.deliveries t),'[]'::json),
  'warnings',           coalesce((select json_agg(t order by id) from public.warnings t),'[]'::json),
  'value_change_log',   coalesce((select json_agg(t order by occurred_at desc,id desc) from public.value_change_log t),'[]'::json),
  'participant_warnings', coalesce((select json_agg(t order by created_at desc,id desc) from public.participant_warnings t),'[]'::json),
  'admin_notifications', coalesce((select json_agg(t order by created_at desc,id desc) from public.admin_notifications t),'[]'::json),
  'auction_events',     coalesce((select json_agg(t order by id) from public.auction_events t where t.created_at >= now() - interval '7 days' or exists(select 1 from public.auctions kept where kept.id=t.auction_id)),'[]'::json),
  'processed_commands', coalesce((select json_agg(t order by external_event_id) from public.processed_commands t where t.created_at >= now() - interval '7 days'),'[]'::json),
  'whatsapp_groups',    coalesce((select json_agg(t order by id) from public.whatsapp_groups t),'[]'::json),
  'whatsapp_dispatches', coalesce((select json_agg(t order by id) from public.whatsapp_dispatches t),'[]'::json),
  'auction_publish_queues', coalesce((select json_agg(t order by id) from public.auction_publish_queues t),'[]'::json),
  'whatsapp_vote_state', coalesce((select json_agg(t order by auction_id, voter_jid) from public.whatsapp_vote_state t),'[]'::json),
  'whatsapp_quick_polls', coalesce((select json_agg(t order by id) from public.whatsapp_quick_polls t),'[]'::json),
  'payment_reminders',  coalesce((select json_agg(t order by last_reminded_at desc nulls last) from public.payment_reminders t),'[]'::json),
  'auction_drafts', coalesce((select json_agg(t order by id) from public.auction_drafts t),'[]'::json),
  'whatsapp_auction_notices', coalesce((select json_agg(t order by id) from public.whatsapp_auction_notices t),'[]'::json)
 );
$function$;


revoke execute on function public.export_business_backup(),public.export_business_backup_text() from public,anon,authenticated;
grant execute on function public.export_business_backup(),public.export_business_backup_text() to service_role;
-- Version the download envelope without changing the existing chunk contract.
do $$ declare ddl text; begin
 ddl:=pg_get_functiondef('public.prepare_business_backup(uuid)'::regprocedure);
 if strpos(ddl,'''exported_at'', stamp')>0 then
  ddl:=replace(ddl,'''exported_at'', stamp','''format_version'', 2, ''audit_window_days'', 7, ''includes_image_bytes'', false, ''exported_at'', stamp');
 elsif strpos(ddl,'''exported_at'',stamp')>0 then
  ddl:=replace(ddl,'''exported_at'',stamp','''format_version'',2,''audit_window_days'',7,''includes_image_bytes'',false,''exported_at'',stamp');
 else raise exception 'backup_envelope_not_recognized'; end if;
 execute ddl;
end $$;
notify pgrst,'reload schema';
commit;
