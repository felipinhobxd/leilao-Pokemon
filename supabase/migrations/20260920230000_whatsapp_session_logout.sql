begin;

alter table public.whatsapp_bot_commands
  drop constraint if exists whatsapp_bot_commands_command_check;

alter table public.whatsapp_bot_commands
  add constraint whatsapp_bot_commands_command_check
  check (command in ('reconnect','disconnect','sync_groups','logout'));

commit;
