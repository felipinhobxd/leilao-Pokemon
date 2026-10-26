-- Production-sized fictional audit history. Disposable PostgreSQL ONLY.
begin;
set local timezone='UTC';
insert into public.auction_events(event_type,payload)
 select 'backup_scale',jsonb_build_object('description',repeat(md5(i::text),30),'index',i)
 from generate_series(1,42000) i;
set local role service_role;
do $$ declare eid uuid:=gen_random_uuid(); meta jsonb; content text; hashes jsonb; stamp timestamptz:=clock_timestamp(); begin
 meta:=public.prepare_business_backup(eid);
 if (meta->>'bytes')::bigint<40000000 then raise exception 'scale_fixture_too_small'; end if;
 select string_agg(c.content,'' order by position) into content from public.business_backup_export_chunks c where export_id=eid;
 select coverage->'auction_events' into hashes from public.business_backup_receipts where export_id=eid;
 if (select count(*) from jsonb_object_keys(hashes))<>42000 then raise exception 'scale_fingerprints_lost'; end if;
 if octet_length(content)<>(meta->>'bytes')::bigint or length(content)<>(meta->>'characters')::int then raise exception 'scale_chunks_truncated'; end if;
 if encode(sha256(convert_to(content,'UTF8')),'hex')<>(select payload_sha256 from public.business_backup_receipts where export_id=eid) then raise exception 'scale_snapshot_digest_mismatch'; end if;
 if exists(select 1 from public.auction_events t where not(hashes ? encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))) then raise exception 'scale_row_missing_from_manifest'; end if;
 perform public.discard_business_backup(eid);
 raise notice 'BACKUP_SCALE_OK bytes=% elapsed=%',meta->>'bytes',clock_timestamp()-stamp;
end $$;
reset role;
rollback;
