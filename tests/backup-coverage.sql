-- Disposable database only: fake Storage metadata, real snapshot/receipt RPCs.
begin;
insert into public.cards(id,name,starting_price) values('20000000-0000-0000-0000-000000000094','Coverage 😊',5);
insert into public.auctions(id,card_id,status,starting_price,ended_at)
 values('30000000-0000-0000-0000-000000000094','20000000-0000-0000-0000-000000000094','closed',5,now()-interval '20 hours');
insert into public.whatsapp_auction_notices(kind,auction_id,group_jid,payload,sent_at)
 values('auction_closed','30000000-0000-0000-0000-000000000094','coverage@g.us','{}',now());
insert into public.auction_events(event_type,created_at) values('old_coverage',now()-interval '9 days');
insert into public.processed_commands(external_event_id,request,result,created_at)
 values('old-coverage','{}','{}',now()-interval '9 days');
set local role service_role;
do $$
declare eid uuid:=gen_random_uuid(); meta jsonb; digest text; r jsonb; path text:='backups/backup-20000101-0000.json.gz';
begin
 r:=public.cleanup_old_auctions();
 if r->>'reason'<>'confirmed_cloud_backup_missing' then raise exception 'file_name_authorized_cleanup: %',r; end if;
 meta:=public.prepare_business_backup(eid);
 select payload_sha256 into digest from public.business_backup_receipts where export_id=eid;
 if not exists(select 1 from jsonb_array_elements(public.export_business_backup()->'auction_events') e where e->>'event_type'='old_coverage')
  or not exists(select 1 from jsonb_array_elements(public.export_business_backup()->'processed_commands') e where e->>'external_event_id'='old-coverage') then raise exception 'old_prunable_rows_missing_from_export'; end if;
 begin
  perform public.confirm_business_backup(eid,digest,path,123);raise exception 'expected_missing_upload';
 exception when others then if sqlerrm<>'backup_upload_unconfirmed' then raise; end if; end;
 insert into storage.objects(bucket_id,name,metadata) values('business-backups',path,'{"size":123}');
 begin
  perform public.confirm_business_backup(eid,repeat('0',64),path,123);raise exception 'expected_wrong_hash';
 exception when others then if sqlerrm<>'backup_receipt_mismatch' then raise; end if; end;
 begin
  perform public.confirm_business_backup(eid,digest,path,124);raise exception 'expected_wrong_size';
 exception when others then if sqlerrm<>'backup_upload_unconfirmed' then raise; end if; end;
 r:=public.cleanup_old_auctions();
 if r->>'reason'<>'confirmed_cloud_backup_missing' then raise exception 'unconfirmed_export_authorized_cleanup'; end if;
 perform public.confirm_business_backup(eid,digest,path,123);
 perform public.discard_business_backup(eid);
 -- Unchanged auction, but a changed child or card must block the whole tree.
 update public.whatsapp_auction_notices set attempts=attempts+1 where auction_id='30000000-0000-0000-0000-000000000094';
 r:=public.cleanup_old_auctions();
 if r->>'reason'<>'backup_coverage_incomplete' or (r->'deleted'->>'auctions')::int<>0 then raise exception 'changed_notice_not_protected: %',r; end if;
 if not exists(select 1 from public.processed_commands where external_event_id='old-coverage') then raise exception 'partial_cleanup_on_coverage_failure'; end if;
 perform public.test_confirm_backup();
 update public.cards set name='Edited after backup' where id='20000000-0000-0000-0000-000000000094';
 if public.cleanup_old_auctions()->>'reason'<>'backup_coverage_incomplete' then raise exception 'changed_card_not_protected'; end if;
 perform public.test_confirm_backup();
 insert into public.auction_events(event_type,created_at) values('late_old_event',now()-interval '9 days');
 if public.cleanup_old_auctions()->>'reason'<>'backup_coverage_incomplete' then raise exception 'new_old_audit_not_protected'; end if;
 perform public.test_confirm_backup();
 -- Object replacement or removal invalidates every receipt for that version.
 update storage.objects set version=gen_random_uuid()::text where name=path;
 if public.has_confirmed_business_backup(now()-interval '1 day') then raise exception 'replaced_object_still_confirmed'; end if;
 if public.cleanup_old_auctions()->>'reason'<>'confirmed_cloud_backup_missing' then raise exception 'replaced_object_authorized_cleanup'; end if;
 perform public.test_confirm_backup();
 delete from storage.objects where name=path;
 if public.cleanup_old_auctions()->>'reason'<>'confirmed_cloud_backup_missing' then raise exception 'deleted_object_authorized_cleanup'; end if;
 perform public.test_confirm_backup();
 update public.business_backup_receipts set created_at=now()-interval '49 hours';
 if public.cleanup_old_auctions()->>'reason'<>'confirmed_cloud_backup_missing' then raise exception 'expired_snapshot_authorized_cleanup'; end if;
 perform public.test_confirm_backup();
 -- Explicit old filename proves no dependency on UTC/local calendar naming.
 if not public.has_confirmed_business_backup(now()-interval '1 day') then raise exception 'fresh_receipt_rejected_old_filename'; end if;
 r:=public.cleanup_old_auctions();
 if (r->>'blocked')::boolean is true or (r->'deleted'->>'auctions')::int<>1 then raise exception 'covered_cleanup_failed: %',r; end if;
 if exists(select 1 from public.auctions where id='30000000-0000-0000-0000-000000000094')
  or exists(select 1 from public.cards where id='20000000-0000-0000-0000-000000000094')
  or exists(select 1 from public.whatsapp_auction_notices where auction_id='30000000-0000-0000-0000-000000000094')
  or exists(select 1 from public.processed_commands where external_event_id='old-coverage') then raise exception 'covered_tree_not_deleted'; end if;
 if has_function_privilege('anon','public.confirm_business_backup(uuid,text,text,bigint)','execute')
  or has_function_privilege('authenticated','public.cleanup_old_auctions(integer,integer)','execute')
  or has_table_privilege('authenticated','public.business_backup_receipts','select') then raise exception 'coverage_privileges_leaked'; end if;
end $$;
reset role;
rollback;
begin isolation level repeatable read;
do $$ begin
 if public.cleanup_old_auctions()->>'reason'<>'unsupported_cleanup_isolation' then
  raise exception 'stale_transaction_snapshot_not_rejected';
 end if;
end $$;
rollback;
select 'BACKUP_COVERAGE_OK' as result;
