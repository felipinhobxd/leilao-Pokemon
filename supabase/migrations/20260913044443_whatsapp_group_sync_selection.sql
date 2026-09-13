alter table public.whatsapp_groups
  add column if not exists is_default boolean not null default false;

alter table public.whatsapp_groups
  add column if not exists last_synced_at timestamptz;

create unique index if not exists whatsapp_groups_single_default_idx
  on public.whatsapp_groups ((is_default))
  where is_default;

with candidate as (
  select id
  from public.whatsapp_groups
  where active
  order by created_at asc, id asc
  limit 1
)
update public.whatsapp_groups g
set is_default = true,
    updated_at = clock_timestamp()
where g.id = (select id from candidate)
  and not exists (select 1 from public.whatsapp_groups where is_default);

create or replace function public.sync_whatsapp_groups(p_groups jsonb)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  if jsonb_typeof(p_groups) is distinct from 'array' then
    raise exception 'invalid_groups_payload';
  end if;

  with incoming as (
    select distinct on (trim(item->>'id'))
      trim(item->>'id') as group_jid,
      coalesce(nullif(trim(item->>'name'), ''), trim(item->>'id')) as name
    from jsonb_array_elements(p_groups) item
    where trim(coalesce(item->>'id', '')) like '%@g.us'
    order by trim(item->>'id')
  )
  update public.whatsapp_groups g
  set active = false,
      is_default = false,
      last_synced_at = v_now,
      updated_at = v_now
  where g.active
    and not exists (select 1 from incoming i where i.group_jid = g.group_jid);

  with incoming as (
    select distinct on (trim(item->>'id'))
      trim(item->>'id') as group_jid,
      coalesce(nullif(trim(item->>'name'), ''), trim(item->>'id')) as name
    from jsonb_array_elements(p_groups) item
    where trim(coalesce(item->>'id', '')) like '%@g.us'
    order by trim(item->>'id')
  ), upserted as (
    insert into public.whatsapp_groups (group_jid, name, active, last_synced_at, updated_at)
    select group_jid, name, true, v_now, v_now
    from incoming
    on conflict (group_jid) do update
      set name = excluded.name,
          active = true,
          last_synced_at = v_now,
          updated_at = v_now
    returning 1
  )
  select count(*) into v_count from upserted;

  return jsonb_build_object('count', v_count, 'synced_at', v_now);
end;
$$;

create or replace function public.set_whatsapp_default_group(p_group_id uuid)
returns uuid
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.whatsapp_groups where id = p_group_id and active
  ) then
    raise exception 'whatsapp_group_not_found';
  end if;

  update public.whatsapp_groups
  set is_default = (id = p_group_id),
      updated_at = case
        when is_default is distinct from (id = p_group_id) then clock_timestamp()
        else updated_at
      end
  where is_default or id = p_group_id;

  return p_group_id;
end;
$$;
