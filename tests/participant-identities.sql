begin;

do $$
declare
  first_result jsonb;
  enriched_result jsonb;
  participant_id uuid;
  participant_count integer;
  identity_count integer;
  stored_phone text;
  stored_name text;
begin
  first_result := public.resolve_whatsapp_participant(
    array['80179053510687@lid'],
    null,
    'Participante WhatsApp',
    clock_timestamp()
  );
  participant_id := (first_result->>'id')::uuid;

  enriched_result := public.resolve_whatsapp_participant(
    array['80179053510687@lid','554198587027@s.whatsapp.net'],
    '+554198587027',
    'Felipe',
    clock_timestamp() + interval '1 second'
  );

  if (enriched_result->>'id')::uuid <> participant_id then
    raise exception 'PN/LID mapping created a duplicate participant';
  end if;

  select count(*), max(phone_e164), max(display_name)
    into participant_count, stored_phone, stored_name
  from public.participants
  where id = participant_id;

  if participant_count <> 1 then
    raise exception 'expected exactly one participant, got %', participant_count;
  end if;
  if stored_phone <> '+554198587027' then
    raise exception 'phone was not enriched: %', stored_phone;
  end if;
  if stored_name <> 'Felipe' then
    raise exception 'name was not enriched: %', stored_name;
  end if;

  select count(*) into identity_count
  from public.participant_identities
  where participant_identities.participant_id = participant_id
    and identity in ('80179053510687@lid','554198587027@s.whatsapp.net');

  if identity_count <> 2 then
    raise exception 'expected two aliases for the same participant, got %', identity_count;
  end if;
end
$$;

rollback;
