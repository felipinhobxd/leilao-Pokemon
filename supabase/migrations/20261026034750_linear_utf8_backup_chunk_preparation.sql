-- Linear bounded UTF-8 chunk preparation; same RPC/receipt/export contract.
begin;
create or replace function public.prepare_business_backup(p_export_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' set statement_timeout='55s' set work_mem='32MB' as $$
declare stamp timestamptz:=clock_timestamp(); content text; characters integer; data jsonb; fingerprints jsonb; encoded bytea; byte_pos integer:=1; take_bytes integer; total_bytes integer; part text; chunk_index integer:=0;
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
 encoded:=convert_to(content,'UTF8');
 total_bytes:=octet_length(encoded);
 characters:=length(content);
 insert into public.business_backup_receipts(export_id,created_at,payload_sha256,payload_bytes,coverage)
 values(p_export_id,stamp,encode(sha256(convert_to(content,'UTF8')),'hex'),octet_length(content),fingerprints);
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

notify pgrst,'reload schema';
commit;
