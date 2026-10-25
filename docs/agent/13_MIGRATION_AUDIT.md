# 13_MIGRATION_AUDIT — Conferência de produção

> Última atualização: 2026-10-25
> Projeto: PokemonLeilao — `gsyuoggymjdzxibfujyv` (mesma referência do ambiente local)
> Fonte: Dashboard Supabase autenticado pelo operador; histórico de migrations + uma consulta de catálogo, sem dados de negócio.

## Resultado e limites

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
