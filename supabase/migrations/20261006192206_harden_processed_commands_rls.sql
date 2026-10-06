-- Defense-in-depth: processed_commands is backend-only.
begin;
drop policy if exists deny_client_access on public.processed_commands;
create policy deny_client_access on public.processed_commands
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
commit;
