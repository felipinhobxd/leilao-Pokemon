do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='whatsapp_dispatches' and column_name='announcement_sent_at'
  ) then
    raise exception 'announcement_sent_at_missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='whatsapp_dispatches' and column_name='poll_sent_at'
  ) then
    raise exception 'poll_sent_at_missing';
  end if;
end $$;
