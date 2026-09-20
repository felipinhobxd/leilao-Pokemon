begin;

create table if not exists public.whatsapp_bot_workers (
  worker_id text primary key check (length(trim(worker_id)) between 1 and 200),
  status text not null default 'starting' check (status in ('starting','waiting_qr','connecting','connected','reconnecting','disconnected','error')),
  heartbeat_at timestamptz,
  connected_at timestamptz,
  account_jid text,
  last_error text,
  qr_payload text,
  qr_render text,
  qr_expires_at timestamptz,
  groups_synced_at timestamptz,
  version text,
  session_active boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists whatsapp_bot_workers_heartbeat_idx
  on public.whatsapp_bot_workers(heartbeat_at desc);

create table if not exists public.whatsapp_bot_commands (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.whatsapp_bot_workers(worker_id) on delete cascade,
  command text not null check (command in ('reconnect','disconnect','sync_groups','logout')),
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text
);

create index if not exists whatsapp_bot_commands_pending_idx
  on public.whatsapp_bot_commands(worker_id, requested_at)
  where status='pending';

alter table public.whatsapp_bot_workers enable row level security;
alter table public.whatsapp_bot_commands enable row level security;

revoke all on public.whatsapp_bot_workers, public.whatsapp_bot_commands from public, anon, authenticated;
grant select on public.whatsapp_bot_workers, public.whatsapp_bot_commands to authenticated;
grant all on public.whatsapp_bot_workers, public.whatsapp_bot_commands to service_role;

create policy bot_operator_read on public.whatsapp_bot_workers
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_profiles
      where user_id=(select auth.uid())
        and active
        and role in ('admin','operator')
    )
  );

create policy bot_command_operator_read on public.whatsapp_bot_commands
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_profiles
      where user_id=(select auth.uid())
        and active
        and role in ('admin','operator')
    )
  );

create or replace function public.claim_whatsapp_bot_command(p_worker_id text)
returns setof public.whatsapp_bot_commands
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 or length(p_worker_id)>200 then
    raise exception 'invalid_worker_id';
  end if;

  update public.whatsapp_bot_commands
     set status='pending', claimed_at=null, last_error=coalesce(last_error,'Recovered after stale command lock')
   where worker_id=p_worker_id
     and status='running'
     and claimed_at < clock_timestamp()-interval '2 minutes';

  select id into v_id
    from public.whatsapp_bot_commands
   where worker_id=p_worker_id and status='pending'
   order by requested_at, id
   for update skip locked
   limit 1;

  if v_id is null then return; end if;

  return query
    update public.whatsapp_bot_commands
       set status='running', claimed_at=clock_timestamp(), last_error=null
     where id=v_id
     returning *;
end $$;

revoke execute on function public.claim_whatsapp_bot_command(text) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_bot_command(text) to service_role;

commit;
