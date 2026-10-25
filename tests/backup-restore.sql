-- Isolated restore drill: exported operational records retain IDs and references.
begin;
insert into public.participants(id,display_name,whatsapp_id) values('10000000-0000-0000-0000-000000000093','Backup participante','backup-fixture');
insert into public.cards(id,name,starting_price) values('20000000-0000-0000-0000-000000000093','Backup carta 😊',5);
insert into public.auctions(id,card_id,status,starting_price,lot_number,winner_participant_id,final_price,win_type) values('30000000-0000-0000-0000-000000000093','20000000-0000-0000-0000-000000000093','sold',5,10003,'10000000-0000-0000-0000-000000000093',100,'highest_bid');
insert into public.purchases(id,auction_id,card_id,participant_id,amount) values('40000000-0000-0000-0000-000000000093','30000000-0000-0000-0000-000000000093','20000000-0000-0000-0000-000000000093','10000000-0000-0000-0000-000000000093',100);
create temporary table restored_cards (like public.cards including defaults);
create temporary table restored_participants (like public.participants including defaults);
create temporary table restored_auctions (like public.auctions including defaults);
create temporary table restored_purchases (like public.purchases including defaults);
do $$declare payload jsonb:=public.export_business_backup();begin
 insert into restored_cards select * from jsonb_populate_recordset(null::public.cards,payload->'cards');
 insert into restored_participants select * from jsonb_populate_recordset(null::public.participants,payload->'participants');
 insert into restored_auctions select * from jsonb_populate_recordset(null::public.auctions,payload->'auctions');
 insert into restored_purchases select * from jsonb_populate_recordset(null::public.purchases,payload->'purchases');
 if not exists(select 1 from restored_purchases p join restored_cards c on c.id=p.card_id join restored_auctions a on a.id=p.auction_id join restored_participants person on person.id=p.participant_id where c.name='Backup carta 😊' and p.amount=100 and a.winner_participant_id=person.id) then raise exception 'restore_lost_value_or_reference';end if;
end $$;
rollback;
