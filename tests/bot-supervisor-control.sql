begin;
create function pg_temp.control_check(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT: %',message;end if;end $$;
select pg_temp.control_check(not has_function_privilege('anon','public.claim_whatsapp_bot_control(text)','EXECUTE'),'anon denied');
select pg_temp.control_check(not has_function_privilege('authenticated','public.claim_whatsapp_bot_control(text)','EXECUTE'),'panel denied');
insert into public.whatsapp_bot_workers(worker_id) values('control-one'),('control-other');
set local role service_role;
do $$
declare r jsonb; first_id uuid; second_id uuid; v text;
begin
  r:=public.claim_whatsapp_bot_control('control-one');
  perform pg_temp.control_check(r='{"logout_requested":false,"command":null}'::jsonb,'idle result');
  insert into public.whatsapp_bot_commands(worker_id,command) values('control-other','reconnect');
  r:=public.claim_whatsapp_bot_control('control-one');
  perform pg_temp.control_check(r->'command'='null'::jsonb,'worker isolation');
  insert into public.whatsapp_bot_commands(worker_id,command,requested_at) values('control-one','disconnect',clock_timestamp()-interval '1 minute') returning id into first_id;
  insert into public.whatsapp_bot_commands(worker_id,command) values('control-one','reconnect') returning id into second_id;
  update public.whatsapp_bot_workers set logout_requested=true where worker_id='control-one';
  for i in 1..2 loop
    r:=public.claim_whatsapp_bot_control('control-one');
    perform pg_temp.control_check(r='{"logout_requested":true,"command":null}'::jsonb,'logout wins on repeated claims');
  end loop;
  perform pg_temp.control_check((select logout_requested from public.whatsapp_bot_workers where worker_id='control-one'),'logout is durable until local acknowledgement');
  perform pg_temp.control_check((select count(*)=2 from public.whatsapp_bot_commands where worker_id='control-one' and status='pending'),'logout never consumes commands');
  update public.whatsapp_bot_workers set logout_requested=false where worker_id='control-one';
  r:=public.claim_whatsapp_bot_control('control-one');
  perform pg_temp.control_check(r->'command'->>'id'=first_id::text and r->'command'->>'status'='running','oldest command claimed');
  r:=public.claim_whatsapp_bot_control('control-one');
  perform pg_temp.control_check(r->'command'->>'id'=second_id::text,'fresh running command not reclaimed');
  r:=public.claim_whatsapp_bot_control('control-one');
  perform pg_temp.control_check(r->'command'='null'::jsonb,'no duplicate claim');
  update public.whatsapp_bot_commands set claimed_at=clock_timestamp()-interval '3 minutes' where id=first_id;
  r:=public.claim_whatsapp_bot_control('control-one');
  perform pg_temp.control_check(r->'command'->>'id'=first_id::text,'stale claim recovered');
  foreach v in array array[null::text,'',repeat('x',201)] loop
    begin
      perform public.claim_whatsapp_bot_control(v);raise exception 'expected rejection';
    exception when others then
      if sqlerrm<>'invalid_worker_id' then raise;end if;
    end;
  end loop;
end $$;
rollback;
