-- Status reads no row hashes/payload, performs no backup or cleanup.
begin;
set local role service_role;
do $$ declare eid uuid:=gen_random_uuid(); r jsonb; begin
 r:=public.get_operation_backup_status();
 if r->>'state'<>'missing' then raise exception 'missing_receipt_status: %',r; end if;
 perform public.prepare_business_backup(eid);
 if public.get_operation_backup_status()->>'state'<>'awaiting_confirmation' then raise exception 'unconfirmed_reported_as_valid'; end if;
 perform public.discard_business_backup(eid);
 perform public.test_confirm_backup();
 r:=public.get_operation_backup_status();
 if r->>'state'<>'confirmed' or r->>'validSnapshotAt' is null or r->>'validUntil' is null then raise exception 'valid_receipt_missing_dates: %',r; end if;
 -- A newer failed/unconfirmed attempt must not hide the existing valid copy.
 eid:=gen_random_uuid();perform public.prepare_business_backup(eid);perform public.discard_business_backup(eid);
 if public.get_operation_backup_status()->>'state'<>'confirmed' then raise exception 'new_attempt_hid_valid_copy'; end if;
 update storage.objects set version=gen_random_uuid()::text where bucket_id='business-backups';
 r:=public.get_operation_backup_status();
 if r->>'state'<>'object_unavailable' or r->>'validSnapshotAt' is not null then raise exception 'replaced_copy_still_valid'; end if;
 perform public.test_confirm_backup();
 delete from public.business_backup_receipts where object_version is distinct from
  (select version from storage.objects where name='backups/backup-20000101-0000.json.gz');
 update public.business_backup_receipts set created_at=now()-interval '49 hours' where confirmed_at is not null;
 r:=public.get_operation_backup_status();
 if r->>'state'<>'expired' or r->>'validSnapshotAt' is not null or r->>'latestConfirmedAt' is null then raise exception 'expired_copy_still_valid'; end if;
 if has_function_privilege('anon','public.get_operation_backup_status()','execute')
  or has_function_privilege('authenticated','public.get_operation_backup_status()','execute') then raise exception 'status_metadata_exposed'; end if;
end $$;
reset role;
rollback;
select 'OPERATION_BACKUP_STATUS_OK' as result;
