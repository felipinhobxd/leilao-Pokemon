-- Supabase production migration history: replace the legacy cleanup function signature.
begin;
drop function if exists public.cleanup_old_auctions(integer);
commit;
