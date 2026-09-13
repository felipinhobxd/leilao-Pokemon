alter table public.whatsapp_dispatches
  add column if not exists announcement_sent_at timestamptz,
  add column if not exists poll_sent_at timestamptz;

create index if not exists whatsapp_dispatch_pending_stage_idx
  on public.whatsapp_dispatches(status, scheduled_at, announcement_sent_at, poll_sent_at)
  where status in ('scheduled','sending');
