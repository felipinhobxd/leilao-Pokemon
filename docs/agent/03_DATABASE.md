# 03_DATABASE — Supabase / PostgreSQL

> Área: Banco de dados
> Escopo: Tabelas, RPCs, triggers, RLS, estados, idempotência, perigos
> Última atualização: 2026-10-25
> Fonte principal: `supabase/schema.sql`, `supabase/operations.sql`, `supabase/whatsapp_bridge.sql`, `supabase/migrations/*.sql` (todas), `lib/backend.ts`, `app/api/**`, `bot/**`

## Estado de produção conferido em 2026-10-25

Histórico com 67 registros, 59 arquivos locais correspondentes por nome; assinaturas/trechos principais confirmados em catálogo. As antigas pendências P-13/P-17 estão registradas. Versões remotas podem diferir dos nomes locais. Veja o mapeamento completo e os limites da conferência em `13_MIGRATION_AUDIT.md`; não reaplicar a lista antiga.

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
| `value_change_log` | histórico de alterações de valor (migration 20260923093000) | `auction_id, participant_id, previous_amount, new_amount, difference, external_event_id UNIQUE, occurred_at, change_kind ('change'\|'withdraw_rebid', 20261007110000)` | export, avisos |
| `participant_warnings` | contador GLOBAL de avisos por usuário (20260923093000; **cycle_closed** na 20260924180000 = aviso que fechou o ciclo de 3; `change_kind` na 20261007110000) | `participant_id, auction_id (ON DELETE SET NULL), card_name, lot_number, previous_amount, new_amount, external_event_id UNIQUE, occurred_at, created_at, cycle_closed, change_kind` | export, dashboard, stats do painel |
| `admin_notifications` | DM pendente aos admins (idem) | `participant_id, kind, payload jsonb, external_event_id UNIQUE, sent_at` | bot drena |
| `whatsapp_quick_polls` | brindes: enquete livre agendada (20260924120000) + **itens de brinde da fila** (20260924160000: foto da carta + posição na fila) | `group_id FK, title, options jsonb, image_url, queue_id FK CASCADE, queue_position, scheduled_at, sent_at, poll_message_id UNIQUE, external_event_id UNIQUE, created_by` | bot publica (P-07); fila com brinde |
| `payment_reminders` | ciclo de lembretes de pagamento (idem) | `purchase_id UNIQUE FK CASCADE, participant_id, reminded_count, last_reminded_at` | bot drena (P-09) |
| `auction_drafts` | rascunhos do wizard em lote (20260924150000): snapshot serializável para continuar a programação depois | `id uuid PK (client-generated), title 1..120, payload jsonb (≤512KB, cards 1..200), created_by, created_at, updated_at` | API drafts, purge/backup |
| `auction_publish_queues.total_items` | constraint: 1..**200** (era 100; 20260925140000) | `check (total_items between 1 and 200)` | wizard em lote |
| `cards.extra_images` | coluna jsonb: até 4 URLs HTTPS de fotos de detalhe (idem) | `default '[]'` | wizard + bot envia em sequência (P-08) |
| `auction_events` | auditoria append-only | `auction_id, participant_id, admin_user_id, event_type, external_event_id, payload` | export/auditoria |
| `processed_commands` | cache de idempotência | `external_event_id, request, result` | TODOS os eventos |

## Tabelas de infraestrutura WhatsApp

`whatsapp_groups` (grupos, `is_default`, `group_jid`), `whatsapp_dispatches` (um por lote: `poll_message_id, poll_message_json, status scheduled/sending/sent/failed/cancelled, queue_id, queue_position, duration_seconds, attempts, locked_at, worker_id`), `auction_publish_queues` (`status scheduled/running/paused/completed/cancelled, starts_at, interval_seconds, total_items, paused_at`), `whatsapp_vote_state` (`option_label, amount, is_buyout, active, last_event_id, last_event_at` por participante/leilão), `whatsapp_bot_commands`, `whatsapp_bot_workers`.

Índices: `whatsapp_dispatch_queue_position_key` (único, parcial por fila), `whatsapp_dispatch_queue_status_idx`, `auction_publish_queues_status_idx`, índices de bids/warnings/participants em `operations.sql` e nas migrations.

## RPCs (funções)

### `process_auction_command(p_command jsonb, p_admin_user_id uuid)` — o coração

- Há versões históricas em `20260921130000` e `20260923093000`; o corpo local atual está em `20261007110000_withdraw_rebid_reduction_warning.sql` (remoto `20261008001232`), com comandos de participantes, ciclo de avisos e redução pós-retirada. Não editar apenas uma versão antiga.
- Tipos: `CARD_*`, `PARTICIPANT_*`, `AUCTION_CREATE/UPDATE/DELETE/OPEN/FINALIZE`, `BID_PLACED/BID_CHANGED/BID_WITHDRAWN`, `BUYOUT_REQUESTED/BUYOUT_CONFIRMED`.
- Idempotência: `pg_advisory_xact_lock(hashtextextended(eid,0))` + `processed_commands`; repetição idêntica devolve resultado em cache; divergente → `event_id_conflict`.
- Guardas de lance: `auction_not_open`, `deadline_expired`, `participant_not_eligible`, `stale_event`, `invalid_bid_amount` (≥ inicial, 2 casas), `active_bid_exists/not_found`, `bid_increment_required`.
- Tie-break do vencedor: `amount DESC, COALESCE(whatsapp_event_at, processed_at), processed_at, confirmation_order` (horário REAL do voto).
- Comandos `PARTICIPANT_SUSPEND`/`PARTICIPANT_REACTIVATE` (20261007100000): SUSPEND com prazo grava SÓ `suspension_until` (status segue 'active' → o guard `participant_not_eligible` AUTO-EXPIRA quando o prazo passa); sem prazo vira `status='suspended'` (indefinida); banido não é suspenso (`participant_banned`); REACTIVATE limpa status+prazo (desfaz ban também). Erros novos: `invalid_suspension_until`, `participant_banned`. O evento de auditoria liga o `participant_id` (pid:=rid).
- ADDITION C (20261007110000): `BID_PLACED` pós-RETIRADA compara com o último lance `withdrawn` do participante NO MESMO leilão (alias `prev` — regra 42702; índice `bids_auction_participant_recent_idx`) → `register_participant_reduction` grava `value_change_log` (change_kind='withdraw_rebid') para toda re-oferta e aviso+ciclo de 3 apenas na REDUÇÃO. O bloco B.2 (BID_CHANGED) permanece inline verbatim, intocado.
- Hooks 20260923093000 (apenas em `BID_CHANGED`): grava `value_change_log`; se `novo < anterior` → 1 linha em `participant_warnings` (ON CONFLICT nada); se total do usuário = **3 no ciclo aberto** → 1 linha em `admin_notifications` com payload completo (histórico incluso).

### `register_participant_reduction(...)` — helper do caminho retirada+re-oferta (20261007110000)

- A versão atual é a correção `20261008001511_fix_reduction_lot_number_bigint.sql`: `p_lot_number bigint`, confirmado no catálogo de produção. A assinatura integer da migration anterior foi substituída.
- Grava `value_change_log` + `participant_warnings` + ciclo de 3 + `admin_notifications` com o MESMO shape de payload que `bot/warning-notify.mjs` lê (zero mudança no bot). Chamado apenas pelo ADDITION C do `process_auction_command` (BID_PLACED pós-withdrawn); roda DENTRO da transação do chamador. Idempotência: `ON CONFLICT (external_event_id)` + o cache `processed_commands` do comando que o chamou. Server-only (revoke + grant execute to service_role).

### Demais RPCs

- `delete_completed_auctions(p_event_id uuid,p_confirm1 text,p_confirm2 text,p_admin_user_id uuid)` — 20261025055529, invoker, execute somente service_role, ator admin ativo. Exige as duas frases literais; seleciona **todos** sold/closed/cancelled com locks e reutiliza `delete_auction`, incluindo árvore de compras/pagamentos/entregas e consistência de filas/cartas compartilhadas. Sem cutoff, LIMIT ou reset de sequência. Uma transação, auditoria resumida `COMPLETED_AUCTIONS_DELETED` e cache de resultado em processed_commands por eventId (retenção vigente 7d). Retry do mesmo ID não exclui leilões encerrados depois da primeira execução. Não chamar para verificar instalação: usar catálogo.

- `create_auction_publish_queue(p_payload, p_admin_user_id)` — fila + dispatches + leilões em massa; valida `pricing_mode: increment|custom` por item; grava `poll_options` prontas; erros `lot_number_in_use`, `whatsapp_group_unavailable`, `event_id_conflict`. Corpo base local atual: 20260924220000 (sequência sem drift); guard de 200 reafirmado pela 20261025054810 após divergência em produção — itens `giveaway` (carta marcada como Brinde) NÃO criam cards/auctions/dispatches: criam 1 linha em `whatsapp_quick_polls` (título "🎁 Brinde: {nome}", foto da carta, opções livres 2..12 ≤100 chars, `scheduled_at` na POSIÇÃO da fila — o próximo lote é agendado DEPOIS do brinde). Erros novos: `invalid_giveaway_options`, `invalid_giveaway_image`.
- `control_auction_publish_queue(...)` (20260913202000; corpo substituído na 20260924160000) — resume re-agenda brindes pendentes DEPOIS dos lotes pendentes (simplificação: ordem exata mantida entre leilões); cancel apaga brindes pendentes da fila (nada enviado é perdido).
- Trigger `sync_auction_publish_queue_status` (corpo substituído na 20260924160000) — serve as DUAS tabelas (`tg_table_name`: dispatches falam `status`, quick_polls fala `sent_at`); brindes pendentes seguram a conclusão da fila; trigger novo em `whatsapp_quick_polls` (after update of sent_at) move a fila para frente.
- `claim_whatsapp_dispatch(p_worker_id)` — claim atômica de dispatch vencido (fila `running`); `locked_at` + heartbeat do worker; recovery de lock stale (~2 min) no bot.
- `resolve_whatsapp_participant(...)` — LID/telefone → participante (merge de identidades; conflito → evento auditado).
- `read_auction_snapshot()` / `read_dashboard_snapshot()` — export/dashboard; a 20260923093000 adiciona as 3 tabelas novas ao auction snapshot; a **20260924180000** adiciona `value_change_log` + `participant_warnings` (limit 100) ao DASHBOARD snapshot — o painel ao vivo mostra qual enquete/lote, valores e horários (antes só o Excel tinha). A **20261007100000** adiciona a chave `participant_warning_stats` (total global + ciclo aberto por participante; as LINHAS de `participants` não mudam — contrato de tests/dashboard-snapshot.sql); a **20261007110000** adiciona `change_kind` às duas listas de avisos do dashboard snapshot (o export/backup usam `select *` — a coluna flui sozinha).
- `purge_all_business_data(p_confirm)` — exclusão total com frase `quero excluir mesmo` (validação tripla UI→API→DB), ordem FK-safe, SECURITY DEFINER, reseta sequences.
- `export_business_backup()` — snapshot JSON, consumido pelo bot e por `GET /api/admin/backup`. Corpo atual: `20261010100000_bound_backup_audit_export.sql` (remoto `20261010192429`), com campos de brinde, rascunhos e retenção da auditoria/cache; limites na seção de backup abaixo. A cópia diária nominal é às 4h30; o guard de limpeza também pode gerar cópia antes desse horário.
- `upsert_auction_draft(p_payload, p_admin_user_id)` / `delete_auction_draft(p_draft_id, p_admin_user_id)` (20260924150000) — salvar/excluir rascunho do wizard. Upsert idempotente por PK (id gerado no cliente, SEM processed_commands); guards espelham a rota (título 1..120, cards 1..200, ≤512KB); propriedade: rascunho alheio vira `draft_not_found`; delete idempotente por estado.
- `purge_all_business_data(p_confirm)` — corpo MAIS RECENTE agora é o da 20260924150000 (adicionou `auction_drafts` à cadeia de deletes e ao `deleted` do retorno).
- `mark_purchase_paid(p_purchase_id, p_admin_user_id, p_method, p_reference)` (20260924120000) — baixa de pagamento idempotente por estado: payments → `paid`, delivery → `ready`, audita UMA vez; para os lembretes DM do bot.
- `cleanup_old_auctions(p_hours=12, p_audit_days=7)` — o RPC usa **12 horas** como padrão para leilões terminais; o parâmetro é em HORAS, com piso de 1h. A limpeza só roda depois de existir backup na nuvem e remove apenas leilões terminais (`closed`, `sold`, `cancelled`) além de 12h. Só leilões terminais (`closed`, `sold`, `cancelled`) além de 12h entram na limpeza. Cartas SEM leilão (criadas manualmente ou brindes) SOBREVIVEM — só cartas órfãs dos leilões apagados na MESMA execução são removidas (o sweep antigo apagava qualquer carta sem leilão, por mais recente que fosse). **2026-10-08 (P-17)**: ganhou `p_audit_days` (default 7) — poda `auction_events` de auditoria (incluindo as ~39k linhas de `auction_id` NULL do trigger `audit_admin_change`) e `processed_commands` além de 7 dias, dentro da mesma transação protegida (drop/restaura do `immutable_audit` + guard de backup). Retorno ganha as chaves `audit_events`/`processed_commands`. Assinatura atual: `(integer, integer)` — drop + create (Postgres não aceita mudança de assinatura via CREATE OR REPLACE) com revoke/grant reestabelecidos; chamada do bot (só `p_hours`) segue resolvendo via default.
- `delete_auction(p_auction_id, p_confirm, p_admin)` (20260925130000) — exclusão REAL com frase "sim quero" (tripla UI→API→RPC); apaga árvore FK-safe; carta órfã junto; participant_warnings sobrevive (SET NULL); SECURITY DEFINER (drop/recreate do immutable_audit); fila vazia removida (adição do operador).
- `update_pending_queue_item(p_dispatch_id, p_payload, p_admin)` (20260924210000) — editar lote pendente: preços/duração/foto + re-gera poll_options + recompute scheduled_end_at.
- `read_auction_snapshot()` / `read_dashboard_snapshot()` — AMBAS com LIMITs, diferentes por finalidade: export (`20260925140000`) cards/auctions/compras 10k, bids 50k, events 5k; dashboard (`20261007110000`, corpo atual) cards/participants 2k, auctions/bids/compras 500, events 15. LIMITs não garantem relatório completo ao exceder o teto.

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
- **Migrations aplicadas manualmente**: arquivo novo no repo NÃO altera o banco do operador até aplicar; antes de aplicar uma mudança futura, o recurso pode falhar; arquivo novo no Git não comprova estado de produção.
- **`poll_options`** (jsonb) é o que o bot publica — mudança de formato quebra a publicação.
- **FKs**: `whatsapp_dispatches.queue_id` é RESTRICT (deletar fila exige deletar dispatches antes — `cleanup_old_auctions` faz nessa ordem); `participant_warnings.auction_id` é SET NULL (contador global sobrevive à limpeza).
- **RLS**: tabela nova sem o trio revoke/grant/policy = `authenticated` sem leitura.
- **Sequences** `auction_lot_number_seq` / `bids_confirmation_order_seq`: resetadas apenas pelo purge-all.

## Backup atual e retenção

- `export_business_backup`: corpo local mais recente em `20261010100000_bound_backup_audit_export.sql`, registrado remotamente como `20261010192429`. Configuração efetiva confirmada: timeout 55s e work_mem 32MB. O ajuste anterior `20261007100551` usava 64MB e foi substituído.
- Auditoria/cache exportados só nos últimos sete dias; quick polls limitadas a 500 e rascunhos a 50. Demais tabelas exportadas pelo corpo atual sem aqueles LIMITs. JSON não inclui bytes de imagens nem sessão Baileys.
- `cleanup_old_auctions` atual: `(integer, integer)` defaults 12h/7d; registrado remotamente como `20261009001546`. Não executar para conferir: ler catálogo.
- Atenção: a seleção de limpeza não preserva compra não paga/entrega pendente; o guard verifica arquivo do dia, não cobertura temporal. São pendências separadas da aplicação de migrations.


## 2026-10-25 — prazo comum e backup escalável

Migrations 20261025062419, 20261025065040, 20261025065722 e 20261025070438 instaladas e registradas. Queue.ends_at é opcional. create_auction_queue_with_deadline reutiliza o criador existente; trigger preserva prazo absoluto ao publicar/retomar/editar. finalize_due_auction_batch encerra até 200 devidos e insere outbox transacional; claim/finish persistem espaçamento de 15s por grupo e tentativas.

whatsapp_auction_notices tem FKs CASCADE para fila/leilão; guarda resumo/resultados até exclusão dos pais. business_backup_exports e business_backup_export_chunks são estado temporário do snapshot, com RLS e acesso exclusivo service_role; não integram o próprio backup. prepare_business_backup tem timeout 55s/work_mem 32MB; read_business_backup_chunk, 15s. Payload é dividido no banco em linhas para evitar descompactar repetidamente um único TOAST gigante. Discard elimina snapshot/blocos após leitura; sob falha, a próxima preparação pode recolher sobras após cinco minutos. Há uma preparação de cada vez.

export_business_backup_text preserva tabelas/filtros do export original com agregação JSON textual. A cópia do snapshot é uma transação; leitura posterior dos blocos usa o material imutável, não tabelas vivas. Cleanup continua exigindo cópia do dia, agora aceita .json.gz também. Não executar cleanup para verificar produção. Documento 15 contém contratos e testes.

## Diagnósticos 0.2.8 — migration 20261025073504

`whatsapp_bot_workers.operational_health jsonb` guarda estado limitado do supervisor (backup/database/mention), enviado pelo heartbeat existente apenas quando muda. `whatsapp_auction_notices.last_error text` guarda o motivo curto da última falha; `finish_auction_notice` mantém erro no retry e o limpa no sucesso. Função continua invoker/service-only; RLS/grants existentes preservados. Aplicada e registrada com a mesma versão na mesma transação, catálogo confirmou colunas/RLS/grants. Agora 66 arquivos locais / 74 registros remotos; não reparar timestamps antigos automaticamente.
