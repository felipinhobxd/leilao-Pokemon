-- Operator-authorized retention of all outcomes, including financial sales.
begin;
create or replace function public.prepare_business_backup(p_export_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' set statement_timeout='55s' set work_mem='32MB' as $$
declare stamp timestamptz:=clock_timestamp(); content text; characters integer; fingerprints jsonb; encoded bytea; byte_pos integer:=1; take_bytes integer; total_bytes integer; part text; chunk_index integer:=0;
begin
 if p_export_id is null then raise exception 'invalid_backup_id'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('business-backup-prepare',0)) then raise exception 'backup_busy'; end if;
 delete from public.business_backup_exports where created_at<clock_timestamp()-interval '5 minutes';
 if exists(select 1 from public.business_backup_exports) then raise exception 'backup_busy'; end if;
 delete from public.business_backup_receipts where created_at<clock_timestamp()-interval '48 hours'
   or (confirmed_at is null and created_at<clock_timestamp()-interval '1 hour');
 -- One SQL statement supplies ONE MVCC snapshot to both the stable exporter
 -- and direct row fingerprints. Do not split these into separate statements:
 -- a later READ COMMITTED snapshot could certify rows absent from the export.
 select json_build_object('format_version',2,'audit_window_days',null,'complete_audit',true,
   'includes_image_bytes',false,'exported_at',stamp,'tables',public.export_business_backup_text())::text,
   jsonb_build_object(
    'purchases',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.purchases t),'{}'::jsonb),
    'payments',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.payments t),'{}'::jsonb),
    'deliveries',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.deliveries t),'{}'::jsonb),
    'payment_reminders',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.payment_reminders t),'{}'::jsonb),
    'auctions',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.auctions t),'{}'::jsonb),
    'cards',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.cards t),'{}'::jsonb),
    'bids',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.bids t),'{}'::jsonb),
    'warnings',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.warnings t),'{}'::jsonb),
    'whatsapp_vote_state',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.whatsapp_vote_state t),'{}'::jsonb),
    'whatsapp_dispatches',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.whatsapp_dispatches t),'{}'::jsonb),
    'auction_publish_queues',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.auction_publish_queues t),'{}'::jsonb),
    'value_change_log',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.value_change_log t),'{}'::jsonb),
    'participant_warnings',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.participant_warnings t),'{}'::jsonb),
    'whatsapp_auction_notices',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.whatsapp_auction_notices t),'{}'::jsonb),
    'auction_events',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.auction_events t),'{}'::jsonb),
    'processed_commands',coalesce((select jsonb_object_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),true) from public.processed_commands t),'{}'::jsonb)
   ) into content,fingerprints;
 encoded:=convert_to(content,'UTF8');
 total_bytes:=octet_length(encoded);
 characters:=length(content);
 insert into public.business_backup_receipts(export_id,created_at,payload_sha256,payload_bytes,coverage)
 values(p_export_id,stamp,encode(sha256(encoded),'hex'),total_bytes,fingerprints);
 insert into public.business_backup_exports(id,payload,created_at) values(p_export_id,'',stamp);
 -- bytea offsets avoid rescanning the entire UTF-8 prefix for every chunk.
 -- Read at most 4*262144+3 bytes: after aligning the end, this contains
 -- at least 262144 code points (unless it is the final block).
 while byte_pos<=total_bytes loop
  take_bytes:=least(1048579,total_bytes-byte_pos+1);
  if byte_pos+take_bytes<=total_bytes then
   while get_byte(encoded,byte_pos+take_bytes-1) between 128 and 191 loop
    take_bytes:=take_bytes-1;
   end loop;
  end if;
  part:=left(convert_from(substring(encoded from byte_pos for take_bytes),'UTF8'),262144);
  insert into public.business_backup_export_chunks(export_id,position,content) values(p_export_id,chunk_index,part);
  byte_pos:=byte_pos+octet_length(part);
  chunk_index:=chunk_index+1;
 end loop;
 return jsonb_build_object('id',p_export_id,'characters',characters,'bytes',octet_length(content),'exported_at',stamp);
end $$;


CREATE OR REPLACE FUNCTION public.cleanup_old_auctions(p_hours integer DEFAULT 12, p_audit_days integer DEFAULT 7)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  SET timezone = 'UTC'
  SET lock_timeout = '500ms'
AS $function$
declare
  cutoff timestamptz:=clock_timestamp()-make_interval(hours=>greatest(coalesce(p_hours,12),1));
  -- ADDITION (P-17, 2026-10-08): janela de prune da auditoria/idempotência.
  audit_cutoff timestamptz:=clock_timestamp()-make_interval(days=>greatest(coalesce(p_audit_days,7),1));
  receipt public.business_backup_receipts;
  queue_ids uuid[];
  card_ids uuid[];
  eligible_ids uuid[];
  n_reminders bigint:=0;
  n_payments bigint:=0; n_deliveries bigint:=0; n_purchases bigint:=0; n_warnings bigint:=0; n_votes bigint:=0;
  n_dispatches bigint:=0; n_queues bigint:=0; n_events bigint:=0; n_bids bigint:=0; n_changes bigint:=0;
  n_auctions bigint:=0; n_cards bigint:=0; n_tmp bigint:=0;
  -- ADDITION (P-17, 2026-10-08): contadores do prune.
  n_audit_events bigint:=0; n_commands bigint:=0;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    return public.cleanup_backup_blocked(cutoff,'unsupported_cleanup_isolation');
  end if;
  -- Freeze writes only during this short check/delete transaction. Never
  -- wait behind business writes: contention defers maintenance immediately.
  begin
    lock table public.auctions, public.cards, public.purchases, public.payments,
      public.deliveries, public.payment_reminders, public.warnings, public.whatsapp_vote_state,
      public.whatsapp_dispatches, public.auction_publish_queues,
      public.auction_events, public.bids, public.value_change_log,
      public.participant_warnings, public.processed_commands,
      public.whatsapp_quick_polls, public.whatsapp_auction_notices
      in share row exclusive mode nowait;
  exception when lock_not_available then
    return public.cleanup_backup_blocked(cutoff,'maintenance_busy');
  end;
  select r.* into receipt from public.business_backup_receipts r
    join storage.objects o on o.id=r.object_id and o.bucket_id='business-backups'
      and o.name=r.object_name and o.version=r.object_version and o.updated_at=r.object_updated_at
    where r.confirmed_at is not null and r.created_at>clock_timestamp()-interval '48 hours'
    order by r.created_at desc limit 1 for share of r,o nowait;
  if not found then
    return public.cleanup_backup_blocked(cutoff,'confirmed_cloud_backup_missing');
  end if;
  -- Terminal items and partially sent drafts with a terminal dispatch only.
  -- Active auctions/reviews and unsent draft work remain outside maintenance.
  select coalesce(array_agg(a.id),'{}'::uuid[]) into eligible_ids
  from public.auctions a left join public.whatsapp_dispatches d on d.auction_id=a.id
  where coalesce(d.poll_sent_at,d.sent_at,a.started_at,d.announcement_sent_at,a.ended_at,a.created_at)<cutoff
    and (a.status in ('closed','sold','cancelled')
      or (a.status='draft' and d.status in ('failed','cancelled') and d.announcement_sent_at is not null))
    and not exists(select 1 from public.whatsapp_auction_notices n where n.auction_id=a.id and n.sent_at is null);
  select coalesce(array_agg(c.id),'{}'::uuid[]) into card_ids from public.cards c
    where exists(select 1 from public.auctions a where a.id=any(eligible_ids) and a.card_id=c.id)
      and not exists(select 1 from public.auctions a where a.card_id=c.id and not(a.id=any(eligible_ids)))
      and not exists(select 1 from public.purchases p where p.card_id=c.id and not(p.auction_id=any(eligible_ids)));
  select coalesce(array_agg(q.id),'{}'::uuid[]) into queue_ids from public.auction_publish_queues q
    where q.created_at<cutoff and q.status in ('completed','cancelled')
      and not exists(select 1 from public.whatsapp_dispatches d where d.queue_id=q.id and not(d.auction_id=any(eligible_ids)))
      and not exists(select 1 from public.whatsapp_quick_polls qp where qp.queue_id=q.id)
      and not exists(select 1 from public.whatsapp_auction_notices n where n.queue_id=q.id and n.sent_at is null);
  -- Check full rows, children, cascades and SET NULL preimages against ONE
  -- uploaded snapshot. Any missing/changed row defers the entire cleanup.
  if exists(with covered as materialized (
    select key as tbl,jsonb_object_keys(value) as fingerprint from jsonb_each(receipt.coverage)
  ) select 1 from (
    select 'purchases'::text as tbl,to_jsonb(t) as row_data from public.purchases t where t.auction_id=any(eligible_ids)
    union all
    select 'payments'::text as tbl,to_jsonb(t) as row_data from public.payments t where exists(select 1 from public.purchases p where p.id=t.purchase_id and p.auction_id=any(eligible_ids))
    union all
    select 'deliveries'::text as tbl,to_jsonb(t) as row_data from public.deliveries t where exists(select 1 from public.purchases p where p.id=t.purchase_id and p.auction_id=any(eligible_ids))
    union all
    select 'payment_reminders'::text as tbl,to_jsonb(t) as row_data from public.payment_reminders t where exists(select 1 from public.purchases p where p.id=t.purchase_id and p.auction_id=any(eligible_ids))
    union all
    select 'auctions'::text as tbl,to_jsonb(t) as row_data from public.auctions t where t.id=any(eligible_ids)
    union all
    select 'cards'::text as tbl,to_jsonb(t) as row_data from public.cards t where t.id=any(card_ids)
    union all
    select 'bids'::text as tbl,to_jsonb(t) as row_data from public.bids t where t.auction_id=any(eligible_ids) or exists(select 1 from public.bids b where b.id=t.replaced_by and b.auction_id=any(eligible_ids))
    union all
    select 'warnings'::text as tbl,to_jsonb(t) as row_data from public.warnings t where t.auction_id=any(eligible_ids) or t.card_id=any(card_ids)
    union all
    select 'whatsapp_vote_state'::text as tbl,to_jsonb(t) as row_data from public.whatsapp_vote_state t where t.auction_id=any(eligible_ids)
    union all
    select 'whatsapp_dispatches'::text as tbl,to_jsonb(t) as row_data from public.whatsapp_dispatches t where t.auction_id=any(eligible_ids)
    union all
    select 'auction_publish_queues'::text as tbl,to_jsonb(t) as row_data from public.auction_publish_queues t where t.id=any(queue_ids)
    union all
    select 'value_change_log'::text as tbl,to_jsonb(t) as row_data from public.value_change_log t where t.auction_id=any(eligible_ids)
    union all
    select 'participant_warnings'::text as tbl,to_jsonb(t) as row_data from public.participant_warnings t where t.auction_id=any(eligible_ids)
    union all
    select 'whatsapp_auction_notices'::text as tbl,to_jsonb(t) as row_data from public.whatsapp_auction_notices t where t.auction_id=any(eligible_ids) or t.queue_id=any(queue_ids)
    union all
    select 'auction_events'::text as tbl,to_jsonb(t) as row_data from public.auction_events t where t.auction_id=any(eligible_ids) or (t.created_at<audit_cutoff and not exists(select 1 from public.auctions a where a.id=t.auction_id and not(a.id=any(eligible_ids))))
    union all
    select 'processed_commands'::text as tbl,to_jsonb(t) as row_data from public.processed_commands t where t.created_at<audit_cutoff
  ) affected where not exists(select 1 from covered c where c.tbl=affected.tbl
    and c.fingerprint=encode(sha256(convert_to(affected.row_data::text,'UTF8')),'hex'))) then
    return public.cleanup_backup_blocked(cutoff,'backup_coverage_incomplete');
  end if;
  execute 'drop trigger if exists immutable_audit on public.auction_events';
  with gone as (delete from public.payments pu using public.purchases z join public.auctions a on a.id=z.auction_id
    where pu.purchase_id=z.id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_payments from gone;
  with gone as (delete from public.deliveries dl using public.purchases z join public.auctions a on a.id=z.auction_id
    where dl.purchase_id=z.id and a.id=any(eligible_ids) returning 1)
  select count(*) into n_deliveries from gone;
  with gone as (delete from public.payment_reminders r using public.purchases p
    where p.id=r.purchase_id and p.auction_id=any(eligible_ids) returning 1)
  select count(*) into n_reminders from gone;
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
  with gone as (delete from public.auction_publish_queues q where q.id=any(queue_ids) returning 1)
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
  with gone as (delete from public.cards c where c.id = any(card_ids) and not exists(select 1 from public.auctions a where a.card_id=c.id) and not exists(select 1 from public.purchases p where p.card_id=c.id) returning 1)
  select count(*) into n_cards from gone;
  -- ADDITION (P-17, 2026-10-08): prune da auditoria e do cache de
  -- idempotência além da janela de p_audit_days (default 7 dias). O trigger
  -- immutable_audit está derrubado desde o topo e volta logo abaixo — o
  -- prune só acontece dentro desta transação, protegida pelo guard de
  -- backup confirmado com cobertura. Eventos NOVOS (< janela) sobrevivem, inclusive os de
  -- filas futuras recém-criadas; guardas de negócio (stale_event) leem
  -- eventos do leilão EM DISPUTA (minutos/horas), nunca de 7 dias atrás.
  with gone as (delete from public.auction_events e where e.created_at < audit_cutoff and not exists(select 1 from public.auctions kept where kept.id=e.auction_id) returning 1)
  select count(*) into n_audit_events from gone;
  with gone as (delete from public.processed_commands where created_at < audit_cutoff returning 1)
  select count(*) into n_commands from gone;
  execute 'create trigger immutable_audit before update or delete on public.auction_events for each row execute function public.reject_audit_mutation()';
  return jsonb_build_object('cutoff',cutoff,'retention_basis','publication','deleted',jsonb_build_object(
   'payments',n_payments,'deliveries',n_deliveries,'payment_reminders',n_reminders,'purchases',n_purchases,'warnings',n_warnings,
   'vote_state',n_votes,'dispatches',n_dispatches,'queues',n_queues,'events',n_events,'bids',n_bids,
   'value_changes',n_changes,'auctions',n_auctions,'cards',n_cards,
   'audit_events',n_audit_events,'processed_commands',n_commands));
exception when lock_not_available then
  return public.cleanup_backup_blocked(cutoff,'maintenance_busy');
end
$function$;

revoke execute on function public.cleanup_old_auctions(integer,integer) from public,anon,authenticated;
grant execute on function public.cleanup_old_auctions(integer,integer) to service_role;


-- Legacy receipts still describe valid files, but the daily backup checker must
-- request the expanded manifest before financial cleanup can be authorized.
create or replace function public.has_confirmed_business_backup(p_since timestamptz)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.business_backup_receipts r join storage.objects o
  on o.id=r.object_id and o.bucket_id='business-backups' and o.name=r.object_name and o.version=r.object_version and o.updated_at=r.object_updated_at
  where r.confirmed_at is not null and r.created_at>=p_since and r.created_at>now()-interval '48 hours'
    and r.coverage ?& array['purchases','payments','deliveries','payment_reminders']);
$$;

notify pgrst,'reload schema';
commit;
