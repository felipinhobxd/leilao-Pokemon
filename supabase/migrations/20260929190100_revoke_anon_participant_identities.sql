-- participant_identities is server-side WhatsApp identity data.
-- The bot uses service_role; no anonymous Data API access is required.
revoke select on public.participant_identities from anon;
