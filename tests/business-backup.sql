begin;
insert into public.cards(name,starting_price,notes) select 'Snapshot 😊 '||i,5,repeat('Backup text ',180) from generate_series(1,100) i;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000096');
insert into public.auction_drafts(title,payload,created_by) select 'Draft '||i,'{"cards":[]}'::jsonb,'00000000-0000-0000-0000-000000000096' from generate_series(1,51) i;
insert into public.whatsapp_groups(id,group_jid,name) values('50000000-0000-0000-0000-000000000096','coverage@g.us','Coverage');
insert into public.whatsapp_quick_polls(group_id,title,options,external_event_id,game_kind,correct_index,prize_name,winner_name)
 select '50000000-0000-0000-0000-000000000096','Quiz '||i,'["A","B"]','coverage-'||i,'quiz',1,'Carta '||i,'Ganhador 😊' from generate_series(1,501) i;
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
  if data->>'format_version'<>'2' then raise exception 'backup_version_missing'; end if;
  if jsonb_array_length(data->'tables'->'auction_drafts')<>51 or jsonb_array_length(data->'tables'->'whatsapp_quick_polls')<>501 then raise exception 'backup_still_truncated'; end if;
  if exists(select 1 from jsonb_array_elements(data->'tables'->'whatsapp_quick_polls') q where q->>'correct_index'<>'1' or q->>'winner_name'<>'Ganhador 😊') then raise exception 'backup_quiz_fields_lost'; end if;
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
do $$begin
 if (public.cleanup_old_auctions()->>'blocked')::boolean is not true then raise exception 'filename_is_not_coverage'; end if;
 perform public.test_confirm_backup();
 if (public.cleanup_old_auctions()->>'blocked')::boolean is true then raise exception 'confirmed_snapshot_must_allow_cleanup'; end if;
end $$;
reset role;
rollback;
