create table if not exists public.participant_identities (
  identity text primary key,
  participant_id uuid not null references public.participants(id) on delete restrict,
  kind text not null check (kind in ('pn','lid','jid')),
  source text not null default 'whatsapp',
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);

create index if not exists participant_identities_participant_idx
  on public.participant_identities(participant_id);

alter table public.participant_identities enable row level security;

drop policy if exists staff_read on public.participant_identities;
create policy staff_read on public.participant_identities
  for select to authenticated
  using (exists (
    select 1 from public.admin_profiles
    where admin_profiles.user_id = (select auth.uid())
      and admin_profiles.active
  ));

grant select on public.participant_identities to authenticated;
grant select, insert, update, delete on public.participant_identities to service_role;
revoke insert, update, delete on public.participant_identities from anon, authenticated;

insert into public.participant_identities(identity, participant_id, kind, source, first_seen_at, last_seen_at)
select p.whatsapp_id,
       p.id,
       case when p.whatsapp_id like '%@lid' then 'lid'
            when p.whatsapp_id like '%@s.whatsapp.net' then 'pn'
            else 'jid' end,
       'legacy',
       p.first_seen_at,
       p.last_seen_at
from public.participants p
where nullif(trim(p.whatsapp_id),'') is not null
on conflict (identity) do update
set last_seen_at = greatest(public.participant_identities.last_seen_at, excluded.last_seen_at);

insert into public.participant_identities(identity, participant_id, kind, source, first_seen_at, last_seen_at)
select regexp_replace(p.phone_e164, '[^0-9]', '', 'g') || '@s.whatsapp.net',
       p.id,
       'pn',
       'legacy_phone',
       p.first_seen_at,
       p.last_seen_at
from public.participants p
where p.phone_e164 ~ '^\+[0-9]{8,15}$'
on conflict (identity) do update
set last_seen_at = greatest(public.participant_identities.last_seen_at, excluded.last_seen_at);

create or replace function public.resolve_whatsapp_participant(
  p_identities text[],
  p_phone_e164 text,
  p_display_name text,
  p_seen_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  ids text[];
  phone text := nullif(trim(coalesce(p_phone_e164,'')), '');
  label text := nullif(trim(coalesce(p_display_name,'')), '');
  matched uuid[];
  chosen uuid;
  preferred text;
  row_value public.participants;
begin
  select coalesce(array_agg(v order by case when v like '%@s.whatsapp.net' then 0 when v like '%@lid' then 1 else 2 end, v), array[]::text[])
    into ids
  from (
    select distinct trim(x) as v
    from unnest(coalesce(p_identities, array[]::text[])) x
    where nullif(trim(x),'') is not null
      and trim(x) not like '%@g.us'
  ) q;

  if phone is not null and phone !~ '^\+[0-9]{8,15}$' then
    phone := null;
  end if;

  if phone is not null then
    ids := array(
      select distinct v
      from unnest(ids || (regexp_replace(phone, '[^0-9]', '', 'g') || '@s.whatsapp.net')) v
      where nullif(v,'') is not null
      order by v
    );
  end if;

  if cardinality(ids) = 0 then
    raise exception 'whatsapp_identity_required';
  end if;

  select array_agg(distinct candidate) into matched
  from (
    select pi.participant_id as candidate
    from public.participant_identities pi
    where pi.identity = any(ids)
    union
    select p.id
    from public.participants p
    where phone is not null and p.phone_e164 = phone
  ) s;

  if coalesce(cardinality(matched),0) > 1 then
    raise exception 'whatsapp_identity_conflict';
  end if;

  chosen := matched[1];
  select v into preferred
  from unnest(ids) v
  order by case when v like '%@s.whatsapp.net' then 0 when v like '%@lid' then 1 else 2 end, v
  limit 1;

  if chosen is null then
    insert into public.participants(whatsapp_id, phone_e164, display_name, status, first_seen_at, last_seen_at)
    values(
      preferred,
      phone,
      coalesce(label, phone, 'Participante WhatsApp'),
      'active',
      coalesce(p_seen_at, clock_timestamp()),
      coalesce(p_seen_at, clock_timestamp())
    ) returning * into row_value;
    chosen := row_value.id;
  else
    select * into row_value from public.participants where id = chosen for update;
    update public.participants
       set phone_e164 = coalesce(row_value.phone_e164, phone),
           whatsapp_id = case
             when row_value.whatsapp_id like '%@lid' and preferred like '%@s.whatsapp.net' then preferred
             else row_value.whatsapp_id
           end,
           display_name = case
             when label is not null
              and label <> 'Participante WhatsApp'
              and label !~ '^\+?[0-9]{8,15}$'
              and (row_value.display_name = 'Participante WhatsApp'
                   or row_value.display_name ~ '^\+?[0-9]{8,15}$'
                   or row_value.display_name like '%@lid'
                   or row_value.display_name like '%@s.whatsapp.net')
             then label
             else row_value.display_name
           end,
           last_seen_at = greatest(row_value.last_seen_at, coalesce(p_seen_at, clock_timestamp())),
           updated_at = clock_timestamp()
     where id = chosen
     returning * into row_value;
  end if;

  insert into public.participant_identities(identity, participant_id, kind, source, first_seen_at, last_seen_at)
  select v,
         chosen,
         case when v like '%@lid' then 'lid'
              when v like '%@s.whatsapp.net' then 'pn'
              else 'jid' end,
         'whatsapp',
         coalesce(p_seen_at, clock_timestamp()),
         coalesce(p_seen_at, clock_timestamp())
  from unnest(ids) v
  on conflict (identity) do update
     set last_seen_at = greatest(public.participant_identities.last_seen_at, excluded.last_seen_at),
         source = case when public.participant_identities.source = 'legacy' then excluded.source else public.participant_identities.source end;

  return to_jsonb(row_value);
end
$function$;

revoke all on function public.resolve_whatsapp_participant(text[], text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_participant(text[], text, text, timestamptz) to service_role;
