-- Cloud receipts describe the actual exported rows, never just a file name.
begin;
create table public.business_backup_receipts(
 export_id uuid primary key, created_at timestamptz not null,
 payload_sha256 text not null, payload_bytes bigint not null, coverage jsonb not null,
 object_id uuid, object_version text, object_name text, object_updated_at timestamptz, confirmed_at timestamptz
);
alter table public.business_backup_receipts enable row level security;
revoke all on public.business_backup_receipts from public,anon,authenticated;
grant all on public.business_backup_receipts to service_role;

-- Include old audit/cache rows too, before allowing their retention prune.
do $$ declare ddl text; name text; begin
 foreach name in array array['export_business_backup','export_business_backup_text'] loop
  ddl:=pg_get_functiondef(('public.'||name||'()')::regprocedure);
  ddl:=replace(ddl,' where t.created_at >= now() - interval ''7 days'' or exists(select 1 from public.auctions kept where kept.id=t.auction_id)','');
  ddl:=replace(ddl,' where t.created_at >= now() - interval ''7 days''','');
  execute ddl;
 end loop;
end $$;
alter function public.export_business_backup() set timezone='UTC';
alter function public.export_business_backup_text() set timezone='UTC';

create or replace function public.prepare_business_backup(p_export_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' set statement_timeout='55s' set work_mem='32MB' as $$
declare stamp timestamptz:=clock_timestamp(); content text; characters integer; data jsonb; fingerprints jsonb;
begin
 if p_export_id is null then raise exception 'invalid_backup_id'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('business-backup-prepare',0)) then raise exception 'backup_busy'; end if;
 delete from public.business_backup_exports where created_at<clock_timestamp()-interval '5 minutes';
 if exists(select 1 from public.business_backup_exports) then raise exception 'backup_busy'; end if;
 delete from public.business_backup_receipts where created_at<clock_timestamp()-interval '48 hours'
   or (confirmed_at is null and created_at<clock_timestamp()-interval '1 hour');
 content:=json_build_object('format_version',2,'audit_window_days',null,'complete_audit',true,
  'includes_image_bytes',false,'exported_at',stamp,'tables',public.export_business_backup_text())::text;
 data:=content::jsonb->'tables';
 select jsonb_object_agg(key,hashes) into fingerprints from (
  select key,coalesce((select jsonb_object_agg(encode(sha256(convert_to(r::text,'UTF8')),'hex'),true)
   from jsonb_array_elements(value) r),'{}'::jsonb) hashes from jsonb_each(data)
  where key in ('auctions','cards','bids','warnings','whatsapp_vote_state','whatsapp_dispatches',
    'auction_publish_queues','value_change_log','participant_warnings','whatsapp_auction_notices',
    'auction_events','processed_commands')
 ) sets;
 characters:=length(content);
 insert into public.business_backup_receipts(export_id,created_at,payload_sha256,payload_bytes,coverage)
 values(p_export_id,stamp,encode(sha256(convert_to(content,'UTF8')),'hex'),octet_length(content),fingerprints);
 insert into public.business_backup_exports(id,payload,created_at) values(p_export_id,'',stamp);
 insert into public.business_backup_export_chunks(export_id,position,content)
  select p_export_id,offset_value/262144,substring(content from offset_value+1 for 262144)
  from generate_series(0,characters-1,262144) offset_value;
 return jsonb_build_object('id',p_export_id,'characters',characters,'bytes',octet_length(content),'exported_at',stamp);
end $$;

create function public.confirm_business_backup(p_export_id uuid,p_payload_sha256 text,p_object_name text,p_compressed_bytes bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare receipt public.business_backup_receipts; obj storage.objects;
begin
 select * into receipt from public.business_backup_receipts where export_id=p_export_id for update;
 if not found or receipt.created_at<clock_timestamp()-interval '1 hour'
  or receipt.payload_sha256 is distinct from p_payload_sha256 then raise exception 'backup_receipt_mismatch'; end if;
 if p_object_name is null or p_object_name !~ '^backups/backup-[0-9]{8}-[0-9]{4}\.json\.gz$'
  or p_compressed_bytes is null or p_compressed_bytes<1 then raise exception 'invalid_backup_object'; end if;
 select * into obj from storage.objects where bucket_id='business-backups' and name=p_object_name for share;
 if not found or obj.id is null or obj.version is null or obj.updated_at is null
  or (obj.metadata->>'size')::bigint is distinct from p_compressed_bytes then raise exception 'backup_upload_unconfirmed'; end if;
 update public.business_backup_receipts set object_id=obj.id,object_version=obj.version,object_name=obj.name,
  object_updated_at=obj.updated_at,confirmed_at=clock_timestamp() where export_id=p_export_id;
 return true;
end $$;

create function public.has_confirmed_business_backup(p_since timestamptz)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.business_backup_receipts r join storage.objects o
  on o.id=r.object_id and o.bucket_id='business-backups' and o.name=r.object_name and o.version=r.object_version and o.updated_at=r.object_updated_at
  where r.confirmed_at is not null and r.created_at>=p_since and r.created_at>now()-interval '48 hours');
$$;

create function public.cleanup_backup_blocked(p_cutoff timestamptz,p_reason text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('cutoff',p_cutoff,'blocked',true,'reason',p_reason,'deleted',
 jsonb_build_object('payments',0,'deliveries',0,'purchases',0,'warnings',0,'vote_state',0,'dispatches',0,
 'queues',0,'events',0,'bids',0,'value_changes',0,'auctions',0,'cards',0,'audit_events',0,'processed_commands',0));
$$;
revoke all on function public.confirm_business_backup(uuid,text,text,bigint),public.has_confirmed_business_backup(timestamptz),public.cleanup_backup_blocked(timestamptz,text) from public,anon,authenticated;
grant execute on function public.confirm_business_backup(uuid,text,text,bigint),public.has_confirmed_business_backup(timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_auctions(p_hours integer DEFAULT 12, p_audit_days integer DEFAULT 7)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  SET timezone = 'UTC'
AS $function$
declare
  cutoff timestamptz:=clock_timestamp()-make_interval(hours=>greatest(coalesce(p_hours,12),1));
  -- ADDITION (P-17, 2026-10-08): janela de prune da auditoria/idempotência.
  audit_cutoff timestamptz:=clock_timestamp()-make_interval(days=>greatest(coalesce(p_audit_days,7),1));
  receipt public.business_backup_receipts;
  queue_ids uuid[];
  card_ids uuid[];
  eligible_ids uuid[];
  preserved_financial bigint:=0;
  n_payments bigint:=0; n_deliveries bigint:=0; n_purchases bigint:=0; n_warnings bigint:=0; n_votes bigint:=0;
  n_dispatches bigint:=0; n_queues bigint:=0; n_events bigint:=0; n_bids bigint:=0; n_changes bigint:=0;
  n_auctions bigint:=0; n_cards bigint:=0; n_tmp bigint:=0;
  -- ADDITION (P-17, 2026-10-08): contadores do prune.
  n_audit_events bigint:=0; n_commands bigint:=0;
begin
  -- Freeze writes only during this short check/delete transaction. Never
  -- wait behind business writes: contention defers maintenance immediately.
  begin
    lock table public.auctions, public.cards, public.purchases, public.payments,
      public.deliveries, public.warnings, public.whatsapp_vote_state,
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
  select coalesce(array_agg(c.id),'{}'::uuid[]) into card_ids from public.cards c
    where exists(select 1 from public.auctions a where a.id=any(eligible_ids) and a.card_id=c.id)
      and not exists(select 1 from public.auctions a where a.card_id=c.id and not(a.id=any(eligible_ids)))
      and not exists(select 1 from public.purchases p where p.card_id=c.id);
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
  return jsonb_build_object('cutoff',cutoff,'preserved_financial_auctions',preserved_financial,'deleted',jsonb_build_object(
   'payments',n_payments,'deliveries',n_deliveries,'purchases',n_purchases,'warnings',n_warnings,
   'vote_state',n_votes,'dispatches',n_dispatches,'queues',n_queues,'events',n_events,'bids',n_bids,
   'value_changes',n_changes,'auctions',n_auctions,'cards',n_cards,
   'audit_events',n_audit_events,'processed_commands',n_commands));
exception when lock_not_available then
  return public.cleanup_backup_blocked(cutoff,'maintenance_busy');
end
$function$;

revoke execute on function public.cleanup_old_auctions(integer,integer) from public,anon,authenticated;
grant execute on function public.cleanup_old_auctions(integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
