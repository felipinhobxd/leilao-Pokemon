-- Tiny, fictional snapshot for an actual restore drill. Always rolled back.
insert into auth.users(id) values('00000000-0000-0000-0000-000000000097');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000097','Recovery admin');
insert into public.participants(id,whatsapp_id,display_name) values('10000000-0000-0000-0000-000000000097','recovery-example','João 😊');
insert into public.cards(id,name,starting_price,image_url,extra_images) values('20000000-0000-0000-0000-000000000097','Recuperação 😊',5,'https://fixture.supabase.co/storage/v1/object/public/card-images/main.png','["https://fixture.supabase.co/storage/v1/object/public/card-images/detail.png"]');
insert into public.auctions(id,card_id,status,starting_price,lot_number,winner_participant_id,final_price,win_type) values('30000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000097','sold',5,19097,'10000000-0000-0000-0000-000000000097',100,'highest_bid');
insert into public.purchases(id,auction_id,card_id,participant_id,amount) values('40000000-0000-0000-0000-000000000097','30000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000097','10000000-0000-0000-0000-000000000097',100);
insert into public.payments(purchase_id,amount,status) values('40000000-0000-0000-0000-000000000097',25,'partial');
insert into public.deliveries(purchase_id) values('40000000-0000-0000-0000-000000000097');
insert into public.payment_reminders(purchase_id,participant_id) values('40000000-0000-0000-0000-000000000097','10000000-0000-0000-0000-000000000097');
insert into public.auction_drafts(title,payload,created_by) values('Quiz com foto','{"cards":[{"imageUrl":"https://fixture.supabase.co/storage/v1/object/public/card-images/draft.png","gameKind":"quiz","correctIndex":1}]}','00000000-0000-0000-0000-000000000097');
insert into public.whatsapp_groups(id,group_jid,name) values('50000000-0000-0000-0000-000000000097','recovery-example@g.us','Exemplo de recuperação');
insert into public.whatsapp_quick_polls(group_id,title,options,external_event_id,game_kind,correct_index,prize_name,winner_participant_id,winner_name,winner_event_id,won_at)
 values('50000000-0000-0000-0000-000000000097','Qual é?','["A","B"]','recovery-quiz','quiz',1,'Carta 😊','10000000-0000-0000-0000-000000000097','João 😊','recovery-answer',now());
