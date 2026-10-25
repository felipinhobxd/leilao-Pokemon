-- Local migration 20260924220000 already sets the RPC guard to 200, but the
-- deployed function was verified to still reject more than 100 items.
-- Preserve its body, attributes and grants; change only that known guard.
begin;
do $migration$
declare
  definition text;
  old_guard constant text := 'jsonb_array_length(items)>100';
  new_guard constant text := 'jsonb_array_length(items)>200';
begin
  definition := pg_get_functiondef('public.create_auction_publish_queue(jsonb,uuid)'::regprocedure);
  if strpos(definition,old_guard)>0 then
    if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 then
      raise exception 'Unexpected queue RPC guard; inspect before applying';
    end if;
    execute replace(definition,old_guard,new_guard);
  elsif strpos(definition,new_guard)=0 then
    raise exception 'Queue RPC guard not recognized; inspect before applying';
  end if;
end
$migration$;
commit;
