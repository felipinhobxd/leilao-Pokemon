-- Regressão da rodada 2026-09-24 (migration 20260924150000): rascunhos do
-- wizard em lote.
--  1. upsert_auction_draft: cria com id do cliente, re-save idempotente,
--     update substitui título/state;
--  2. guards: draftId inválido, título 1..120, cards 1..200, payload <=512KB,
--     forbidden sem admin_profile;
--  3. propriedade: outro admin NÃO altera/apaga o rascunho alheio
--     (draft_not_found / deleted=0);
--  4. delete idempotente por estado;
--  5. export_business_backup cobre a tabela; purge_all_business_data apaga e
--     conta (primeira cobertura SQL do purge);
--  6. RLS: staff lê, browser não escreve, não-staff não lê.
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000021');
insert into auth.users(id) values('00000000-0000-0000-0000-000000000022');
insert into auth.users(id) values('00000000-0000-0000-0000-000000000023');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000021','Admin Um');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-0000-0000-000000000022','Admin Dois');
create function pg_temp.check_that(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',message; end if; end $$;
-- Estado de wizard com N cartas (pad opcional para estourar o limite de bytes).
create function pg_temp.state(p_cards int, p_pad text default null) returns jsonb language sql as $$
  select jsonb_build_object(
      'version',1,'step',2,'firstLot','1','groupId','','intervalValue','30','intervalUnit','seconds','publication','now','scheduledInput','',
      'cards',(select jsonb_agg(jsonb_build_object('name','Pikachu','imageUrl','https://cdn.example/x.webp','lotNumber','1')) from generate_series(1,p_cards)))
    || case when p_pad is null then '{}'::jsonb else jsonb_build_object('pad',p_pad) end
$$;
-- O argumento de plpgsql é avaliado ANTES do call: o helper de "espera erro"
-- precisa CHAMAR o RPC dentro do próprio handler (mesma regra do
-- rejects_wizard em tests/quick-polls-reminders.sql).
create function pg_temp.rejects_draft(p jsonb, p_admin uuid, expected text) returns void language plpgsql as $$
begin
  perform public.upsert_auction_draft(p,p_admin);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
create function pg_temp.rejects_delete(p uuid, p_admin uuid, expected text) returns void language plpgsql as $$
begin
  perform public.delete_auction_draft(p,p_admin);
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
end $$;
set local role service_role;
do $$
declare result jsonb; backup jsonb; purge_result jsonb;
begin
  -- ------------------------------------------------------------------
  -- 1) upsert: cria, é idempotente e atualiza.
  -- ------------------------------------------------------------------
  result:=public.upsert_auction_draft(jsonb_build_object(
    'draftId','11111111-1111-1111-1111-111111111111',
    'title','Rascunho de 23/09/2026 14:32 · 12 cartas',
    'state',pg_temp.state(12)),'00000000-0000-0000-0000-000000000021');
  perform pg_temp.check_that((result->>'id')='11111111-1111-1111-1111-111111111111','upsert returns the client id');
  perform pg_temp.check_that((result->>'cardCount')='12','cardCount comes from the payload');
  perform pg_temp.check_that((select count(*)=1 from public.auction_drafts where id='11111111-1111-1111-1111-111111111111'),'row persisted');

  result:=public.upsert_auction_draft(jsonb_build_object(
    'draftId','11111111-1111-1111-1111-111111111111',
    'title','Rascunho de 23/09/2026 14:32 · 12 cartas',
    'state',pg_temp.state(12)),'00000000-0000-0000-0000-000000000021');
  perform pg_temp.check_that((select count(*)=1 from public.auction_drafts),'replay of the same save keeps one row');

  result:=public.upsert_auction_draft(jsonb_build_object(
    'draftId','11111111-1111-1111-1111-111111111111',
    'title','Editado depois','state',pg_temp.state(3)),'00000000-0000-0000-0000-000000000021');
  perform pg_temp.check_that((result->>'cardCount')='3','update replaces state');
  perform pg_temp.check_that((select title='Editado depois' from public.auction_drafts where id='11111111-1111-1111-1111-111111111111'),'update replaces title');

  -- ------------------------------------------------------------------
  -- 2) guards do RPC (espelham a rota e a tabela).
  -- ------------------------------------------------------------------
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','nao-e-uuid','title','x','state',pg_temp.state(1)),
    '00000000-0000-0000-0000-000000000021','invalid_draft_id');
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','22222222-2222-2222-2222-222222222222','title','','state',pg_temp.state(1)),
    '00000000-0000-0000-0000-000000000021','invalid_draft_title');
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','22222222-2222-2222-2222-222222222222','title',repeat('x',121),'state',pg_temp.state(1)),
    '00000000-0000-0000-0000-000000000021','invalid_draft_title');
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','22222222-2222-2222-2222-222222222222','title','x','state',pg_temp.state(0)),
    '00000000-0000-0000-0000-000000000021','invalid_draft_state');
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','22222222-2222-2222-2222-222222222222','title','x','state',pg_temp.state(201)),
    '00000000-0000-0000-0000-000000000021','invalid_draft_state');
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','22222222-2222-2222-2222-222222222222','title','x','state',pg_temp.state(2,repeat('x',600000))),
    '00000000-0000-0000-0000-000000000021','invalid_draft_state');
  perform pg_temp.check_that((select count(*)=1 from public.auction_drafts),'guards never insert');

  -- forbidden: usuário sem admin_profile ativo.
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','33333333-3333-3333-3333-333333333333','title','x','state',pg_temp.state(1)),
    '00000000-0000-0000-0000-000000000023','forbidden');
  perform pg_temp.rejects_delete('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000023','forbidden');

  -- ------------------------------------------------------------------
  -- 3) propriedade: rascunho é do admin que salvou.
  -- ------------------------------------------------------------------
  perform pg_temp.rejects_draft(jsonb_build_object('draftId','11111111-1111-1111-1111-111111111111','title','Sequestro','state',pg_temp.state(1)),
    '00000000-0000-0000-0000-000000000022','draft_not_found');
  perform pg_temp.check_that((select title='Editado depois' from public.auction_drafts where id='11111111-1111-1111-1111-111111111111'),'hijack attempt changes nothing');
  result:=public.delete_auction_draft('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000022');
  perform pg_temp.check_that((result->>'deleted')='0','other admin deletes nothing');

  -- ------------------------------------------------------------------
  -- 4) delete do dono + idempotência por estado.
  -- ------------------------------------------------------------------
  result:=public.delete_auction_draft('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000021');
  perform pg_temp.check_that((result->>'deleted')='1','owner deletes the draft');
  result:=public.delete_auction_draft('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000021');
  perform pg_temp.check_that((result->>'deleted')='0','delete is idempotent');

  -- ------------------------------------------------------------------
  -- 5) backup cobre rascunhos (fixture nova para a checagem de RLS).
  -- ------------------------------------------------------------------
  result:=public.upsert_auction_draft(jsonb_build_object(
    'draftId','44444444-4444-4444-4444-444444444444','title','Backup me','state',pg_temp.state(2)),
    '00000000-0000-0000-0000-000000000021');
  backup:=public.export_business_backup();
  perform pg_temp.check_that(jsonb_array_length(coalesce(backup->'auction_drafts','[]'::jsonb))=1,'backup includes drafts');
  perform pg_temp.check_that((backup->'auction_drafts'->0->>'title')='Backup me','backup keeps title');
end $$;
reset role;
-- RLS: leitura staff-only, browser não escreve, não-staff não lê.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',true);
select pg_temp.check_that((select count(*)=1 from public.auction_drafts),'staff can read drafts');
select pg_temp.check_that(not has_table_privilege(current_user,'public.auction_drafts','INSERT'),'browser cannot write drafts');
select pg_temp.check_that(not has_table_privilege(current_user,'public.auction_drafts','DELETE'),'browser cannot delete drafts');
set local role authenticated;
-- o claim do staff check acima ainda está ativo na transação: limpa antes
select set_config('request.jwt.claim.sub',null,true);
select pg_temp.check_that((select count(*)=0 from public.auction_drafts),'non-staff cannot read drafts');
reset role;
-- Purge por último: apaga TUDO (inclusive o fixture acima) e reporta o total
-- de rascunhos — primeira cobertura SQL do purge_all_business_data.
set local role service_role;
do $$
declare purge_result jsonb;
begin
  purge_result:=public.purge_all_business_data('quero excluir mesmo');
  perform pg_temp.check_that((purge_result->'deleted'->>'auction_drafts')='1','purge counts deleted drafts');
  perform pg_temp.check_that((select count(*)=0 from public.auction_drafts),'purge leaves no drafts behind');
end $$;
reset role;
rollback;
