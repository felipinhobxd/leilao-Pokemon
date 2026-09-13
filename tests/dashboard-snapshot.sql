-- Verify the projection preserves all operational rows and restricts RPC access.
do $$
declare full_data jsonb := public.read_auction_snapshot(); compact jsonb := public.read_dashboard_snapshot(); k text;
begin
  foreach k in array array['cards','participants','auctions','bids','purchases'] loop
    if compact->k is distinct from full_data->k then raise exception 'dashboard mismatch: %',k; end if;
  end loop;
  if jsonb_array_length(compact->'auction_events') > 15 then raise exception 'unbounded timeline'; end if;
  if exists(select 1 from jsonb_array_elements(compact->'auction_events') e where e ? 'payload') then raise exception 'audit payload exposed'; end if;
  if has_function_privilege('anon','public.read_dashboard_snapshot()','EXECUTE') or has_function_privilege('authenticated','public.read_dashboard_snapshot()','EXECUTE') then raise exception 'RPC is not server-only'; end if;
  if not has_function_privilege('service_role','public.read_dashboard_snapshot()','EXECUTE') then raise exception 'service role cannot read'; end if;
end $$;
