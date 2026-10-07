-- 2026-10-07: the business backup can exceed the API role's default
-- statement timeout as auction_events grows. Keep the higher timeout scoped to
-- this RPC only; do not relax the timeout for the entire service_role.
begin;

alter function public.export_business_backup()
  set statement_timeout = '55s';

-- The export performs ordered JSON aggregation. A bounded per-function
-- work_mem avoids unnecessary temporary-file sorts without changing the
-- project's global memory configuration.
alter function public.export_business_backup()
  set work_mem = '64MB';

commit;
