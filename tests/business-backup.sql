begin;
insert into public.cards(name,starting_price,notes) select 'Snapshot 😊 '||i,5,repeat('Backup text ',180) from generate_series(1,100) i;
set local role service_role;
do $$
declare id uuid:=gen_random_uuid(); meta jsonb; data jsonb; content text:=''; part text; pos integer:=1;
begin
  meta:=public.prepare_business_backup(id);
  while pos<=(meta->>'characters')::integer loop
    part:=public.read_business_backup_chunk(id,pos,262144);
    content:=content||part;pos:=pos+262144;
  end loop;
  data:=content::jsonb;
  if length(content)<=262144 or public.read_business_backup_chunk(id,262140,31)<>substring(content from 262140 for 31) then raise exception 'chunk_boundary_mismatch'; end if;
  if octet_length(content)<>(meta->>'bytes')::integer or not (data->'tables' ? 'auctions') or not (data->'tables' ? 'whatsapp_auction_notices') then raise exception 'invalid_backup_snapshot'; end if;
  if data->'tables'<>public.export_business_backup() then raise exception 'text_backup_must_preserve_tables_and_content'; end if;
  begin
    perform public.prepare_business_backup(gen_random_uuid());raise exception 'expected_busy';
  exception when others then if sqlerrm<>'backup_busy' then raise; end if; end;
  perform public.discard_business_backup(id);
  if exists(select 1 from public.business_backup_exports) then raise exception 'snapshot_not_discarded'; end if;
end $$;
reset role;
update storage.objects set name=name||'.gz' where bucket_id='business-backups';
set local role service_role;
do $$begin if (public.cleanup_old_auctions()->>'blocked')::boolean is true then raise exception 'gzip_copy_must_satisfy_daily_guard'; end if; end $$;
reset role;
rollback;
