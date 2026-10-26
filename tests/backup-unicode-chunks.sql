-- Large mixed-width UTF-8 fixture; no production data or network.
begin;
insert into public.cards(name,starting_price,notes)
 values('Mixed bytes',5,repeat('😊漢áA',90000)),('Four-byte boundary',5,repeat('😊',300000)),('ASCII boundary',5,repeat('x',1200000));
set local role service_role;
do $$ declare eid uuid:=gen_random_uuid(); meta jsonb; data text; expected text; start_pos integer; begin
 meta:=public.prepare_business_backup(eid);
 select string_agg(content,'' order by position) into data from public.business_backup_export_chunks where export_id=eid;
 if octet_length(data)<>(meta->>'bytes')::int or length(data)<>(meta->>'characters')::int then raise exception 'unicode_byte_character_counts'; end if;
 if exists(select 1 from public.business_backup_export_chunks where export_id=eid and position<(select max(position) from public.business_backup_export_chunks where export_id=eid) and length(content)<>262144) then raise exception 'short_middle_chunk'; end if;
 if data::jsonb->'tables'<>public.export_business_backup() then raise exception 'unicode_snapshot_changed'; end if;
 for start_pos in select generate_series(262130,length(data),262144) loop
  expected:=substring(data from start_pos for 50);
  if public.read_business_backup_chunk(eid,start_pos,50)<>expected then raise exception 'unicode_cross_boundary_read'; end if;
 end loop;
 if encode(sha256(convert_to(data,'UTF8')),'hex')<>(select payload_sha256 from public.business_backup_receipts where export_id=eid) then raise exception 'unicode_digest_changed'; end if;
 perform public.discard_business_backup(eid);
end $$;
reset role;
rollback;
select 'BACKUP_UNICODE_CHUNKS_OK' as result;
