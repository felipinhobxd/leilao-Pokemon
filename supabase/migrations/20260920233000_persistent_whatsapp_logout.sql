begin;

alter table public.whatsapp_bot_workers
  add column if not exists logout_requested boolean not null default false;

commit;
