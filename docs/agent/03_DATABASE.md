# 03_DATABASE — Supabase / PostgreSQL

> Área: Banco de dados
> Escopo: Tabelas, RPCs, triggers, RLS, estados, idempotência, perigos
> Última atualização: 2026-09-24
> Fonte principal: `supabase/schema.sql`, `supabase/operations.sql`, `supabase/whatsapp_bridge.sql`, `supabase/migrations/*.sql` (todas), `lib/backend.ts`, `app/api/**`, `bot/**`

## Como o schema chega ao banco

Ordem de aplicação (confirmada no CI `ci.yml`): `tests/bootstrap.sql` → `supabase/schema.sql` → `supabase/whatsapp_bridge.sql` → `supabase/migrations/*.sql` (ordem lexical). Em produção o operador aplica manualmente via SQL Editor (padrão do projeto; `lib/purge.ts` documenta esse fluxo).

## Tabelas (núcleo de negócio)

| Tabela | Papel | Campos essenciais | Usada por |
|---|---|---|---|
| `cards` | carta cadastrada | `name, collection, card_number, variant, language, condition, image_url, starting_price, buyout_price, status, notes` | API, export, wizard |
| `auctions` | lote/leilão | `card_id, lot_number, status, starting_price, bid_increment, buyout_price, scheduled_end_at, started_at, ended_at, winner_participant_id, final_price, win_type, created_by` | API, bot, export, dashboard |
| `bids` | lances | `auction_id, participant_id, amount, kind('bid'/'buyout'), status('active'/'replaced'/'withdrawn'), whatsapp_event_id, whatsapp_event_at, processed_at, confirmation_order, replaced_by` | RPC, export, tie-break |
| `participants` | usuários dos grupos | `display_name, whatsapp_id, phone_e164, status, suspension_until, notes, first_seen_at, last_seen_at` | bot, export |
| `participant_identities` | múltiplos JIDs (LID + telefone) por participante | resolvidos por `resolve_whatsapp_participant` | bot |
| `purchases` | venda confirmada | `auction_id, participant_id, card_id, amount, status, confirmed_at` | export |
| `payments` / `deliveries` | fluxo pós-venda | referenciam `purchases` | export |
| `warnings` | advertências legadas por leilão | `participant_id, auction_id, type, reason, active, starts_at, ends_at` | export |
| `value_change_log` | histórico de alterações de valor (migration 20260923093000) | `auction_id, participant_id, previous_amount, new_amount, difference, external_event_id UNIQUE, occurred_at` | export, avisos |
| `participant_warnings` | contador GLOBAL de avisos por usuário (idem; **notified_at** na 20260924180000 = DM ao participante entregue) | `participant_id, auction_id (ON DELETE SET NULL), card_name, lot_number, previous_amount, new_amount, external_event_id UNIQUE, occurred_at, notified_at` | bot drena (DM ao participante), export, dashboard |
| `admin_notifications` | DM pendente aos admins (idem) | `participant_id, kind, payload jsonb, external_event_id UNIQUE, sent_at` | bot drena |
| `whatsapp_quick_polls` | brindes: enquete livre agendada (20260924120000) + **itens de brinde da fila** (20260924160000: foto da carta + posição na fila) | `group_id FK, title, options jsonb, image_url, queue_id FK CASCADE, queue_position, scheduled_at, sent_at, poll_message_id UNIQUE, external_event_id UNIQUE, created_by` | bot publica (P-07); fila com brinde |
| `payment_reminders` | ciclo de lembretes de pagamento (idem) | `purchase_id UNIQUE FK CASCADE, participant_id, reminded_count, last_reminded_at` | bot drena (P-09) |
| `auction_drafts` | rascunhos do wizard em lote (20260924150000): snapshot serializável para continuar a programação depois | `id uuid PK (client-generated), title 1..120, payload jsonb (≤512KB, cards 1..200), created_by, created_at, updated_at` | API drafts, purge/backup |
| `cards.extra_images` | coluna jsonb: até 4 URLs HTTPS de fotos de detalhe (idem) | `default '[]'` | wizard + bot envia em sequência (P-08) |
| `auction_events` | auditoria append-only | `auction_id, participant_id, admin_user_id, event_type, external_event_id, payload` | export/auditoria |
| `processed_commands` | cache de idempotência | `external_event_id, request, result` | TODOS os eventos |

## Tabelas de infraestrutura WhatsApp

`whatsapp_groups` (grupos, `is_default`, `group_jid`), `whatsapp_dispatches` (um por lote: `poll_message_id, poll_message_json, status scheduled/sending/sent/failed/cancelled, queue_id, queue_position, duration_seconds, attempts, locked_at, worker_id`), `auction_publish_queues` (`status scheduled/running/paused/completed/cancelled, starts_at, interval_seconds, total_items, paused_at`), `whatsapp_vote_state` (`option_label, amount, is_buyout, active, last_event_id, last_event_at` por participante/leilão), `whatsapp_bot_commands`, `whatsapp_bot_workers`.

Índices: `whatsapp_dispatch_queue_position_key` (único, parcial por fila), `whatsapp_dispatch_queue_status_idx`, `auction_publish_queues_status_idx`, índices de bids/warnings/participants em `operations.sql` e nas migrations.

## RPCs (funções)

### `process_auction_command(p_command jsonb, p_admin_user_id uuid)` — o coração

- Definida em `supabase/migrations/20260921130000_tiebreak_and_purge_all.sql`; **corpo substituído** (verbatim + adições marcadas `ADDITION A/B`) em `20260923093000_global_warnings_value_history.sql`.
- Tipos: `CARD_*`, `PARTICIPANT_*`, `AUCTION_CREATE/UPDATE/DELETE/OPEN/FINALIZE`, `BID_PLACED/BID_CHANGED/BID_WITHDRAWN`, `BUYOUT_REQUESTED/BUYOUT_CONFIRMED`.
- Idempotência: `pg_advisory_xact_lock(hashtextextended(eid,0))` + `processed_commands`; repetição idêntica devolve resultado em cache; divergente → `event_id_conflict`.
- Guardas de lance: `auction_not_open`, `deadline_expired`, `participant_not_eligible`, `stale_event`, `invalid_bid_amount` (≥ inicial, 2 casas), `active_bid_exists/not_found`, `bid_increment_required`.
- Tie-break do vencedor: `amount DESC, COALESCE(whatsapp_event_at, processed_at), processed_at, confirmation_order` (horário REAL do voto).
- Hooks 20260923093000 (apenas em `BID_CHANGED`): grava `value_change_log`; se `novo < anterior` → 1 linha em `participant_warnings` (ON CONFLICT nada); se total do usuário = **exatamente 3** → 1 linha em `admin_notifications` com payload completo (histórico incluso).

### Demais RPCs

- `create_auction_publish_queue(p_payload, p_admin_user_id)` — fila + dispatches + leilões em massa; valida `pricing_mode: increment|custom` por item; grava `poll_options` prontas; erros `lot_number_in_use`, `whatsapp_group_unavailable`, `event_id_conflict`. Corpo MAIS RECENTE: 20260924160000 — itens `giveaway` (carta marcada como Brinde) NÃO criam cards/auctions/dispatches: criam 1 linha em `whatsapp_quick_polls` (título "🎁 Brinde: {nome}", foto da carta, opções livres 2..12 ≤100 chars, `scheduled_at` na POSIÇÃO da fila — o próximo lote é agendado DEPOIS do brinde). Erros novos: `invalid_giveaway_options`, `invalid_giveaway_image`.
- `control_auction_publish_queue(...)` (20260913202000; corpo substituído na 20260924160000) — resume re-agenda brindes pendentes DEPOIS dos lotes pendentes (simplificação: ordem exata mantida entre leilões); cancel apaga brindes pendentes da fila (nada enviado é perdido).
- Trigger `sync_auction_publish_queue_status` (corpo substituído na 20260924160000) — serve as DUAS tabelas (`tg_table_name`: dispatches falam `status`, quick_polls fala `sent_at`); brindes pendentes seguram a conclusão da fila; trigger novo em `whatsapp_quick_polls` (after update of sent_at) move a fila para frente.
- `claim_whatsapp_dispatch(p_worker_id)` — claim atômica de dispatch vencido (fila `running`); `locked_at` + heartbeat do worker; recovery de lock stale (~2 min) no bot.
- `resolve_whatsapp_participant(...)` — LID/telefone → participante (merge de identidades; conflito → evento auditado).
- `read_auction_snapshot()` / `read_dashboard_snapshot()` — export/dashboard; a 20260923093000 adiciona as 3 tabelas novas ao auction snapshot; a **20260924180000** adiciona `value_change_log` + `participant_warnings` (limit 100) ao DASHBOARD snapshot — o painel ao vivo mostra qual enquete/lote, valores e horários (antes só o Excel tinha).
- `purge_all_business_data(p_confirm)` — exclusão total com frase `quero excluir mesmo` (validação tripla UI→API→DB), ordem FK-safe, SECURITY DEFINER, reseta sequences.
- `export_business_backup()` (20260923120000; corpo substituído na 20260924140000, 20260924150000 — drafts limit 50 — e na **20260924170000, do PRÓPRIO OPERADOR**, que acrescentou os campos do brinde na fila: `queue_id, queue_position, image_url` no bloco de quick_polls, limit 500) — snapshot JSON; consumido pelo bot (cópia diária 4h30 em `bot/backups/`) e por `GET /api/admin/backup`.
- `upsert_auction_draft(p_payload, p_admin_user_id)` / `delete_auction_draft(p_draft_id, p_admin_user_id)` (20260924150000) — salvar/excluir rascunho do wizard. Upsert idempotente por PK (id gerado no cliente, SEM processed_commands); guards espelham a rota (título 1..120, cards 1..200, ≤512KB); propriedade: rascunho alheio vira `draft_not_found`; delete idempotente por estado.
- `purge_all_business_data(p_confirm)` — corpo MAIS RECENTE agora é o da 20260924150000 (adicionou `auction_drafts` à cadeia de deletes e ao `deleted` do retorno).
- `mark_purchase_paid(p_purchase_id, p_admin_user_id, p_method, p_reference)` (20260924120000) — baixa de pagamento idempotente por estado: payments → `paid`, delivery → `ready`, audita UMA vez; para os lembretes DM do bot.
- `cleanup_old_auctions(p_days=30)` — limpeza horária de lotes terminais mais velhos que o corte; levanta/restaura `immutable_audit`; avisos globais sobrevivem (FK SET NULL + contexto denormalizado em `participant_warnings`).

## Triggers

`immutable_audit` (BEFORE UPDATE OR DELETE em `auction_events` → `public.reject_audit_mutation()`): append-only. `purge_all_business_data` e `cleanup_old_auctions` dropam e recriam DENTRO da transação (rollback restaura).

## RLS e permissões (padrão confirmado)

Toda tabela de negócio: `enable row level security` + `revoke from public,anon,authenticated` + `grant select to authenticated` com policy `staff_read` (exige `admin_profiles` ativo) + `grant all to service_role`. RPCs: `revoke` geral + `grant execute to service_role`; checagem interna `forbidden` do `p_admin_user_id`.

## Estados das entidades

- `auctions.status`: `draft → open → sold | closed | cancelled` (`review_required` referenciado nos guardas de card_in_use).
- `auction_publish_queues.status`: `scheduled → running ⇄ paused → completed | cancelled`.
- `whatsapp_dispatches.status`: `scheduled → sending → sent | failed | cancelled` (+`attempts`, `last_error`).
- `bids.status`: `active → replaced | withdrawn` (com `replaced_by`).
- `participants.status`: `active/banned/...` + `suspension_until`.

## Fluxos transacionais críticos

1. Voto → lance: `handlePollVote` (bot) → `process_auction_command(BID_*)` → bids + vote_state + events + processed_commands numa transação (lock por event-id).
2. Fila → publicação: `create_auction_publish_queue` (tudo ou nada) → claim → envio → `sent`.
3. Fechamento: `AUCTION_FINALIZE` → vencedor → `purchases` + `deliveries` + `cards.status='sold'`.
4. Aviso global: MESMA transação do `BID_CHANGED` (log + warning + notification) — falha aborta o lance inteiro.

## PERIGOS DE ALTERAÇÃO

- **Ambiguidade plpgsql (SQLSTATE 42702 em runtime)**: dentro de `process_auction_command` existem variáveis com nomes perigosos (`amount`, `pid`, `aid`, `eid`, `event_at`, `old_amount`...). Qualquer SQL que referencie uma COLUNA com o mesmo nome de variável sem alias levanta `column reference "X" is ambiguous` quando a função RODA (DDL compila, CI de migrations passa, testes falham). Exemplo real: `select amount into old_amount from public.bids` (bids.amount × variável amount — corrigido em 2026-09-23 com alias `prev.amount`). **Regra: sempre qualifique com alias da tabela** (`select prev.amount ... from public.bids prev`).
- **Variantes da mesma armadilha (2026-09-24, pegas pelo CI)**: (1) o alvo de `INSERT INTO t(col)` também entra no escopo — `values(purchase_id,...)` com variável `purchase_id` na inserção em `payment_reminders(purchase_id,...)` é ambíguo: renomeie a variável; (2) o argumento de uma função helper é avaliado ANTES do call — `rejects(func_que_levanta_excecao(...))` deixa a exceção escapar: o helper precisa CHAMAR a função dentro do próprio handler (`rejects_wizard` em tests/quick-polls-reminders.sql).
- **`IS NOT NULL` em RECORD composto só é true se TODOS os campos forem não-nulos**: `delivery is not null` numa linha com `tracking_code NULL` é FALSO (mark_purchase_paid não atualizava a entrega — corrigido com `FOUND`). **Regra: teste de "linha existe" em plpgsql é `FOUND`, nunca `variavel is not null`.**
- **`set_config(...,true)` vive na TRANSAÇÃO inteira**: em SQL tests, limpe `request.jwt.claim.sub` (null) antes de checar o acesso "non-staff", senão o claim do staff check anterior continua ativo.
- **`process_auction_command`**: só altere reproduzindo o corpo inteiro verbatim + hooks marcados — drift quebra idempotência/tie-break/avisos.
- **`external_event_id`** é contrato de idempotência em 5 tabelas — nunca mude o formato dos eventIds do bot (`wa-vote:{poll}:{participant}:{ts}:{amount}`, `wa-withdraw:...`) sem tratar replay.
- **`immutable_audit`**: UPDATE/DELETE em `auction_events` fora das duas funções autorizadas levanta exceção.
- **Migrations aplicadas manualmente**: arquivo novo no repo NÃO altera o banco do operador até aplicar; antes de aplicar, recursos novos ficam desligados (com log de aviso, sem crash).
- **`poll_options`** (jsonb) é o que o bot publica — mudança de formato quebra a publicação.
- **FKs**: `whatsapp_dispatches.queue_id` é RESTRICT (deletar fila exige deletar dispatches antes — `cleanup_old_auctions` faz nessa ordem); `participant_warnings.auction_id` é SET NULL (contador global sobrevive à limpeza).
- **RLS**: tabela nova sem o trio revoke/grant/policy = `authenticated` sem leitura.
- **Sequences** `auction_lot_number_seq` / `bids_confirmation_order_seq`: resetadas apenas pelo purge-all.
