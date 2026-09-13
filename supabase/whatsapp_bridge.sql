-- WhatsApp scheduling/poll bridge. Apply after the base schema/operations on existing databases.
begin;

create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null unique check (group_jid like '%@g.us'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.whatsapp_dispatches (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null unique references public.auctions(id) on delete restrict,
  group_id uuid not null references public.whatsapp_groups(id) on delete restrict,
  scheduled_at timestamptz not null,
  poll_title text not null default '💰 Para dar o seu lance, selecione um dos valores:',
  poll_options jsonb not null,
  status text not null default 'scheduled' check (status in ('scheduled','sending','sent','failed','cancelled')),
  announcement_message_id text,
  poll_message_id text unique,
  poll_message_json jsonb,
  announcement_sent_at timestamptz,
  poll_sent_at timestamptz,
  sent_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_dispatch_options_array check (
    jsonb_typeof(poll_options) = 'array'
    and jsonb_array_length(poll_options) between 1 and 12
  )
);

create index if not exists whatsapp_dispatch_due_idx
  on public.whatsapp_dispatches(status, scheduled_at)
  where status in ('scheduled','sending');
create index if not exists whatsapp_dispatches_group_idx on public.whatsapp_dispatches(group_id);
create index if not exists whatsapp_dispatches_creator_idx on public.whatsapp_dispatches(created_by);
create index if not exists whatsapp_dispatch_pending_stage_idx
  on public.whatsapp_dispatches(status, scheduled_at, announcement_sent_at, poll_sent_at)
  where status in ('scheduled','sending');

create table if not exists public.whatsapp_vote_state (
  auction_id uuid not null references public.auctions(id) on delete restrict,
  voter_jid text not null,
  participant_id uuid not null references public.participants(id) on delete restrict,
  option_label text,
  amount numeric(12,2),
  is_buyout boolean not null default false,
  active boolean not null default true,
  last_event_id text,
  last_event_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (auction_id, voter_jid)
);
create index if not exists whatsapp_vote_state_participant_idx on public.whatsapp_vote_state(participant_id);

alter table public.whatsapp_groups enable row level security;
alter table public.whatsapp_dispatches enable row level security;
alter table public.whatsapp_vote_state enable row level security;
revoke all on public.whatsapp_groups, public.whatsapp_dispatches, public.whatsapp_vote_state from public, anon, authenticated;
grant select on public.whatsapp_groups, public.whatsapp_dispatches, public.whatsapp_vote_state to authenticated;
grant all on public.whatsapp_groups, public.whatsapp_dispatches, public.whatsapp_vote_state to service_role;

create policy staff_read on public.whatsapp_groups for select to authenticated
  using (exists (select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));
create policy staff_read on public.whatsapp_dispatches for select to authenticated
  using (exists (select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));
create policy staff_read on public.whatsapp_vote_state for select to authenticated
  using (exists (select 1 from public.admin_profiles where user_id=(select auth.uid()) and active));

create or replace function public.claim_whatsapp_dispatch(p_worker_id text)
returns setof public.whatsapp_dispatches
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 or length(p_worker_id)>200 then raise exception 'invalid_worker_id'; end if;
  update public.whatsapp_dispatches
     set status=case when attempts>=5 then 'failed' else 'scheduled' end,
         locked_at=null,locked_by=null,
         last_error=coalesce(last_error,'Recovered after stale worker lock'),
         updated_at=clock_timestamp()
   where status='sending' and locked_at<clock_timestamp()-interval '2 minutes';
  select id into v_id from public.whatsapp_dispatches
   where status='scheduled' and scheduled_at<=clock_timestamp() and attempts<5
   order by scheduled_at,created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.whatsapp_dispatches
     set status='sending',locked_at=clock_timestamp(),locked_by=p_worker_id,
         attempts=attempts+1,last_error=null,updated_at=clock_timestamp()
   where id=v_id returning *;
end $$;

revoke execute on function public.claim_whatsapp_dispatch(text) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_dispatch(text) to service_role;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='whatsapp_dispatches') then
    alter publication supabase_realtime add table public.whatsapp_dispatches;
  end if;
end $$;

commit;
