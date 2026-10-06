-- 2026-10-05: the card recognition system was removed from the project
-- (operator decision). card_recognition_examples existed only as instance
-- memory for the local recognition service — nothing in the remaining schema
-- (FKs, RPCs, snapshots, purge) references it. Drop it wholesale.
begin;

drop table if exists public.card_recognition_examples;

commit;
