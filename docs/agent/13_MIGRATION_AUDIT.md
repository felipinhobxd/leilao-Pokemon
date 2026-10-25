# 13_MIGRATION_AUDIT — Conferência de produção

> Última atualização: 2026-10-25
> Projeto: PokemonLeilao — `gsyuoggymjdzxibfujyv` (mesma referência do ambiente local)
> Fonte: Dashboard Supabase autenticado pelo operador; histórico e consultas pontuais de catálogo, sem dados de negócio.

## Inclusão posterior: exclusão manual dos encerrados

Migration **20261025055529_delete_completed_auctions_with_two_confirmations.sql** criada pela CLI e instalada em produção pelo SQL Editor, sem chamar a RPC de exclusão. Um novo registro de versão/nome/SQL foi inserido no histórico na mesma transação; contagem resultante **61 locais / 69 remotos**. Conector continua retornando Unknown tool, inclusive get_advisors; não houve laudo novo do advisor. Revisão de acesso: SECURITY INVOKER, search_path vazio, EXECUTE somente service_role, ator admin ativo e duas frases obrigatórias; a exclusão efetiva reutiliza o helper existente.

Antes da instalação, o MD5 do corpo de delete_auction (normalizado LF) confirmou compatibilidade com a versão local testada: `d203812c37fa13ee51af675eea59a206`. Após instalação, corpo de delete_completed_auctions confirmado por hash `b76972de48ed4ca70baec241a11d970c`, invoker, grants e registro da migration. Nenhum dado de negócio foi consultado ou apagado; nenhuma função de limpeza/backup foi executada. Log Ingestion no fim: **0,88/1 GB**, leitura arredondada, sem medição do delta exclusivo da tarefa.

## Correção posterior: filas acima de 100 cartas

Em 2026-10-25, a inspeção de `pg_proc.prosrc` confirmou que a função **instalada em produção** ainda rejeitava `jsonb_array_length(items)>100`, apesar da tabela aceitar 200. O corpo local de `20260924220000_auction_lot_sequence_no_drift.sql` já usa 200; portanto, a correspondência do histórico não comprovou o corpo efetivamente instalado. A conferência inicial abaixo validou a constraint, não esse guard da RPC.

Nova migration **20261025054810_raise_auction_queue_rpc_limit_to_200.sql**, criada pela CLI e aplicada pontualmente no SQL Editor porque o conector retornou `Unknown tool`. A aplicação e a inserção de **um novo registro** com a mesma versão/nome/SQL em `supabase_migrations.schema_migrations` foram feitas na mesma transação. Nenhum registro histórico anterior foi reparado ou reaplicado. Totais após esta inclusão: **60 arquivos locais / 68 registros remotos**; o mapeamento histórico abaixo permanece válido.

A migration altera apenas a expressão conhecida de 100 para 200, preservando o restante da definição via `pg_get_functiondef` + `CREATE OR REPLACE`. É idempotente quando já há 200 e recusa guard desconhecido. Catálogo após aplicação confirmou guard 200, MD5 do corpo igual à substituição prevista (`64029848172f8ab70730622f591444c2`), grants somente postgres/service_role e `search_path` vazio preservados. Não foram criadas filas de teste na produção.

Validação em banco descartável PGlite: schema/bridge e migrations locais carregados; simulação do guard antigo reproduziu `invalid_queue_items` em 101; após correção, 35/100/101/200 passaram e 201 foi rejeitado. Também passaram espaçamento, posições completas, idempotência e teste existente de brindes. PGlite usa `gen_random_uuid` nativo, sem carregar pgcrypto; o CI mantém PostgreSQL 17 com a extensão real.

## Conferência inicial: resultado e limites

Há **67 registros remotos** e **59 arquivos locais** em `supabase/migrations/`. Todos os 59 arquivos têm correspondência pelo nome lógico no histórico; **23 usam versões diferentes**. Em três registros, o nome remoto inclui também a versão local como prefixo; eles coexistem com registros mais antigos sem esse prefixo. Há oito registros além de um correspondente por arquivo, discriminados abaixo. Não foi encontrada migration local sem correspondente por nome lógico; isso não equivale a comparação integral, byte a byte, de todos os corpos SQL.

As pendências antigas P-13 e P-17 estão registradas em produção. A última migration é `20261010192429_bound_backup_audit_export`, correspondente ao arquivo local `20261010100000_bound_backup_audit_export.sql`. Seu SQL foi lido no painel: janela de sete dias, índices created_at, timeout 55s e work_mem 32MB.

Não reaplicar arquivos porque o timestamp local não aparece no histórico. Não renomear versões antigas nem executar `db push`/repair automaticamente: os históricos não são idênticos. Uma reconciliação futura para deploy automático exige plano próprio e comparação dos SQLs. Nesta sessão não houve DDL, alteração de histórico, execução de cleanup ou backup.

## Verificação do estado efetivo

Uma única consulta leu `pg_proc`, `pg_namespace`, `pg_constraint`, nomes de relações e a contagem de `supabase_migrations.schema_migrations`. Retornou 12 linhas:

| Verificação | Resultado observado |
|---|---|
| Contagem do histórico | 67 |
| Limpeza | `p_hours integer DEFAULT 12, p_audit_days integer DEFAULT 7` |
| Configuração do backup | `search_path=""; statement_timeout=55s; work_mem=32MB` |
| Corpo do backup contém janela de sete dias | true |
| RPC central contém SUSPEND, REACTIVATE e helper de redução | true |
| Dashboard contém participant_warning_stats e change_kind | true |
| Helper de redução | p_lot_number **bigint**; demais argumentos esperados presentes |
| card_recognition_examples removida | true |
| Constraint da fila | total_items entre 1 e **200** |
| Índices de auditoria/cache para backup | ambos presentes |
| Índices adicionais de avisos/notificações | ambos presentes |
| Fuso da sessão SQL | UTC |

Esses testes confirmam assinaturas, configuração e trechos dos corpos atuais; não executam comandos de leilão, não verificam toda a semântica SQL e não substituem smoke funcional. A comparação geral é de histórico/nome, não um diff completo de schemas.

## Mapeamento dos 59 arquivos locais

| Arquivo local | Versão remota por nome | Comparação |
|---|---|---|
| `20260913042848_whatsapp_bot_runtime.sql` | `20260913042848` | Versão igual |
| `20260913043449_whatsapp_bot_command_requester_index.sql` | `20260913043449` | Versão igual |
| `20260913044443_whatsapp_group_sync_selection.sql` | `20260913044443` | Versão igual |
| `20260913045744_auction_lot_increment_fields.sql` | `20260913045744` | Versão igual |
| `20260913045753_auction_lot_number_sequence.sql` | `20260913045753` | Versão igual |
| `20260913045801_auction_lot_number_constraints.sql` | `20260913045801` | Versão igual |
| `20260913045807_auction_increment_constraint.sql` | `20260913045807` | Versão igual |
| `20260913045819_auction_lot_edit_guard.sql` | `20260913045819` | Versão igual |
| `20260913045826_card_images_bucket.sql` | `20260913045826` | Versão igual |
| `20260913045842_create_auction_wizard_rpc.sql` | `20260913045842` | Versão igual |
| `20260913050837_auction_lot_sequence_service_role_grant.sql` | `20260913050837` | Versão igual |
| `20260913052500_whatsapp_dispatch_delivery_stages.sql` | `20260913053750` | Nome igual; versão diferente |
| `20260913053833_whatsapp_dispatch_delivery_stages_noop_guard.sql` | `20260913053833` | Versão igual |
| `20260913173647_dashboard_snapshot_perf.sql` | `20260913173647` | Versão igual |
| `20260913180958_dashboard_snapshot.sql` | `20260913180958` | Versão igual |
| `20260913193000_whatsapp_participant_identities.sql` | `20260913193352` | Nome igual; versão diferente |
| `20260913202000_auction_publish_queues.sql` | `20260913202252` | Nome igual; versão diferente |
| `20260913202500_auction_queue_trigger_permissions.sql` | `20260913202324` | Nome igual; versão diferente |
| `20260913202800_auction_queue_fk_indexes.sql` | `20260913202507` | Nome igual; versão diferente |
| `20260913203200_auction_queue_actual_publish_deadline.sql` | `20260913203221` | Nome igual; versão diferente |
| `20260914163500_card_recognition_memory.sql` | `20260914163529` | Nome igual; versão diferente |
| `20260920230000_whatsapp_session_logout.sql` | `20260920225050` | Nome igual; versão diferente |
| `20260920231500_purge_delete_where.sql` | `20260920225403` | Nome igual; versão diferente |
| `20260920233000_persistent_whatsapp_logout.sql` | `20260920225558` | Nome igual; versão diferente |
| `20260921120000_review_round_fixes.sql` | `20260920224352` | Nome remoto inclui prefixo 20260921120000; versão diferente |
| `20260921130000_tiebreak_and_purge_all.sql` | `20260920224359` | Nome remoto inclui prefixo 20260921130000; versão diferente |
| `20260921140000_purge_security_definer.sql` | `20260920224409` | Nome remoto inclui prefixo 20260921140000; versão diferente |
| `20260921150000_bid_increment_guard.sql` | `20260921181548` | Nome igual; versão diferente |
| `20260921153000_whatsapp_dispatch_idempotency.sql` | `20260921182225` | Nome igual; versão diferente |
| `20260923093000_global_warnings_value_history.sql` | `20260923163815` | Nome igual; versão diferente |
| `20260923120000_business_backup.sql` | `20260923165839` | Nome igual; versão diferente |
| `20260924120000_quick_polls_extra_images_reminders.sql` | `20260923181819` | Nome igual; versão diferente |
| `20260924140000_backup_covers_new_tables.sql` | `20260923183508` | Nome igual; versão diferente |
| `20260924150000_auction_drafts.sql` | `20260924150000` | Versão igual |
| `20260924160000_giveaway_queue_items.sql` | `20260924160000` | Versão igual |
| `20260924170000_backup_giveaway_fields.sql` | `20260924170000` | Versão igual |
| `20260924180000_dashboard_warnings_snapshot.sql` | `20260924180000` | Versão igual |
| `20260924190000_repair_auction_lot_sequence.sql` | `20260924190000` | Versão igual |
| `20260924200000_warning_cycle_reset.sql` | `20260924200000` | Versão igual |
| `20260924210000_edit_queue_item.sql` | `20260924210000` | Versão igual |
| `20260924220000_auction_lot_sequence_no_drift.sql` | `20260924220000` | Versão igual |
| `20260925130000_delete_auction.sql` | `20260925130000` | Versão igual |
| `20260925135000_delete_auction_queue_integrity.sql` | `20260925135000` | Versão igual |
| `20260925140000_max200_export_limits.sql` | `20260925140000` | Versão igual |
| `20260925150000_dashboard_snapshot_limits.sql` | `20260925150000` | Versão igual |
| `20260928165333_cleanup_minimum_30.sql` | `20260928165333` | Versão igual |
| `20260929190312_revoke_anon_participant_identities.sql` | `20260929190312` | Versão igual |
| `20260929191637_cleanup_24h_retention.sql` | `20260929191637` | Versão igual |
| `20261006192047_replace_cleanup_retention_signature.sql` | `20261006192047` | Versão igual |
| `20261006192053_cleanup_12h_retention_v2.sql` | `20261006192053` | Versão igual |
| `20261006192100_drop_card_recognition_examples.sql` | `20261006192100` | Versão igual |
| `20261006192206_harden_processed_commands_rls.sql` | `20261006192206` | Versão igual |
| `20261006192241_cleanup_backup_guard_v2.sql` | `20261006192241` | Versão igual |
| `20261007100000_participants_panel_commands.sql` | `20261008001222` | Nome igual; versão diferente |
| `20261007100551_export_business_backup_timeout.sql` | `20261007100551` | Versão igual |
| `20261007110000_withdraw_rebid_reduction_warning.sql` | `20261008001232` | Nome igual; versão diferente |
| `20261008001511_fix_reduction_lot_number_bigint.sql` | `20261008001511` | Versão igual |
| `20261008230000_prune_audit_and_commands.sql` | `20261009001546` | Nome igual; versão diferente |
| `20261010100000_bound_backup_audit_export.sql` | `20261010192429` | Nome igual; versão diferente |

## Registros remotos adicionais

| Versão remota | Nome |
|---|---|
| `20260923163904` | `global_warnings_fk_indexes` |
| `20260920224349` | `purge_security_definer` |
| `20260920224342` | `tiebreak_and_purge_all` |
| `20260920224334` | `review_round_fixes` |
| `20260913033550` | `whatsapp_bridge_indexes` |
| `20260913032850` | `whatsapp_auction_bridge_foundation` |
| `20260913024153` | `restrict_platform_event_trigger_execution` |
| `20260913024025` | `initial_auction_administration` |

Os quatro registros iniciais descrevem fundação/índices/endurecimento da plataforma; o CI local carrega bootstrap/schema/bridge separadamente. Os três registros sem prefixo acima são anteriores aos registros com nome igual ao basename local completo usados no mapeamento. A coexistência é histórica, não indicação de três novas migrations a executar; não se afirmou igualdade integral entre os SQLs dessas reaplicações.

`global_warnings_fk_indexes` foi aberta no painel e contém:

```sql
create index if not exists admin_notifications_participant_idx on public.admin_notifications(participant_id);
create index if not exists participant_warnings_auction_idx on public.participant_warnings(auction_id);
```

Os dois índices existem em produção. Não há arquivo local dedicado com esse nome. A necessidade de incorporar esses índices ao bootstrap versionado deve ser avaliada em mudança de banco separada; não foi feita nesta revisão documental.

## Log Ingestion e método econômico

O painel da organização mostrou **0,86 / 1 GB** no início e novamente no encerramento da conferência. É uma leitura arredondada, sujeita ao atraso de contabilização e referente ao ciclo vigente, não medição exata do custo desta sessão. Não houve consultas ao Logs Explorer, loop de diagnóstico, leitura de tabelas de negócio, teste de carga, backup, início/reinício do bot ou abertura do painel do aplicativo para gerar polling. A navegação no Dashboard também faz suas próprias chamadas; não há promessa de consumo zero nem garantia sobre processos já ativos.

A única consulta SQL manual foi a conferência de catálogo acima. Alterações dos MDs e verificações locais não fazem chamadas ao Supabase. Não desabilitar auditoria/segurança para economizar logs. Excluir auction_events é retenção de dados de negócio e **não desfaz** Log Ingestion já contabilizado.

Referência oficial consultada: [Manage Logs Ingest usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest). A ingestão reúne logs dos serviços, não deve ser confundida com egress, tamanho do banco ou a tabela auction_events.

Na leitura posterior à correção P-27, o Dashboard passou a mostrar **0,88/1 GB**. Continua abaixo de 1 GB; não é possível atribuir o delta à tarefa, pois o valor é agregado/arredondado e os processos ativos também geram logs. Não houve carga de teste na produção.


## Inclusão posterior — horário comum, outbox e backup 0.2.7

Quatro migrations criadas pela CLI e instaladas pelo SQL Editor, cada uma com registro versão/nome/SQL na mesma transação: 20261025062419_common_auction_deadline_and_delivery_notices, 20261025065040_chunked_business_backup_export, 20261025065722_backup_prepare_timeout_budget e 20261025070438_efficient_backup_chunks_and_compression. Totais atuais: **65 locais / 73 remotos**; o mapeamento histórico permanece. PostgREST recebeu reload schema após alterações de orçamento.

Conferidos os hashes dos seis novos helpers de deadline/outbox e do export alterado, compatíveis com o banco descartável. Novas tabelas de notices/snapshot/chunks têm RLS, sem SELECT para authenticated e RPCs sem EXECUTE para anon/authenticated. Apenas service_role. O guard de limpeza foi alterado pontualmente para reconhecer Gzip sem remover a exigência diária. Não foi executada limpeza/exclusão de leilões nem teste de envio. Houve exportações reais autorizadas pelo pedido de conserto do backup; os dois primeiros testes no caminho antigo não geraram arquivo e o erro 57014 do preparo motivou orçamento específico na RPC chamada. Mais de 41k eventos/105 leilões foram vistos somente como contagens agregadas para diagnóstico. Documento 15 registra resultado final e limites.

Encerramento desta implementação: as quatro versões novas foram conferidas no histórico, tabelas temporárias vazias após download e RLS ativo. Dashboard ainda exibe 0,88/1GB. Valores e tempos do teste final no documento 15; trata-se de leitura arredondada com possível atraso de contabilização.

## Atualização 0.2.8 — diagnósticos

CLI gerou `20261025073504_operation_health_and_notice_errors.sql`. Instalada pelo SQL Editor autenticado, com registro de mesma versão na mesma transação, após verificação do esquema. Colunas `operational_health`/`last_error`, limpeza do erro no sucesso de outbox; sem alteração de permissões efetivas, RLS, leilões/lances ou limites. Catálogo confirmou worker_health/notice_errors/anon_blocked/rls_enabled=true. Total atual 66 arquivos locais / 74 registros remotos. Histórico divergente permanece mapeado acima; não fazer db push/repair geral.
