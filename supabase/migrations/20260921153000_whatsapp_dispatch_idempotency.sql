begin;

-- Keep the deterministic message IDs as idempotency keys while separately
-- recording the ID returned by WhatsApp. If a process dies after WhatsApp
-- accepts a message but before Supabase is updated, a retry uses the SAME
-- messageId instead of generating a new one.
alter table public.whatsapp_dispatches
  add column if not exists announcement_remote_message_id text,
  add column if not exists poll_remote_message_id text;

create index if not exists whatsapp_dispatch_poll_remote_id_idx
  on public.whatsapp_dispatches(poll_remote_message_id)
  where poll_remote_message_id is not null;

create index if not exists whatsapp_dispatch_announcement_remote_id_idx
  on public.whatsapp_dispatches(announcement_remote_message_id)
  where announcement_remote_message_id is not null;

commit;
