# 11_PENDING_WORK — Trabalho pendente

> Última atualização: 2026-10-25
> Escopo desta sessão: conferir migrations e atualizar documentação, preservando a cota de Log Ingestion. Nenhuma correção funcional ou migration foi aplicada.

## P-13 — Conferência das migrations: concluída

As migrations antes listadas como pendentes já constam no histórico de produção. São 67 registros remotos e 59 arquivos locais correspondentes por nome. Há versões diferentes e oito registros remotos adicionais; detalhes em [13_MIGRATION_AUDIT.md](13_MIGRATION_AUDIT.md).

Confirmados no catálogo: limpeza 12h/prune 7d, helper com lote bigint, comandos de participantes e redução, estatísticas/change_kind do dashboard, limite 200, remoção da tabela de IA e configuração do backup mais recente. Não executar novamente a lista antiga nem reparar timestamps automaticamente.

Os antigos nomes de 05/10 da limpeza/remoção foram substituídos pelos arquivos de 06/10 existentes no repositório. A correção do backup de 10/10 também está registrada remotamente (20261010192429).

Limite da conclusão: correspondência de histórico por nome + metadados/trechos efetivos; não foi feita comparação byte a byte de todos os SQLs ou smoke de leilão real.

## P-17 — Retenção da auditoria/cache e backup: implementação registrada

- Prune 7d: local `20261008230000_prune_audit_and_commands.sql`, remoto **20261009001546**.
- Backup limitado à janela de auditoria/cache: local `20261010100000_bound_backup_audit_export.sql`, remoto **20261010192429**.
- Configuração efetiva do backup confirmada: 55s / 32MB; índices created_at presentes.
- Não executar backup/cleanup para provar aplicação; já foram confirmados por metadados. O incidente de 08/10 e a estimativa de 39k eventos pertencem ao histórico, não a uma contagem atual de produção.

## Riscos identificados na análise — ainda não corrigidos

| ID | Prioridade | Pendência / evidência |
|---|---|---|
| P-18 | Alta | Limpeza 12h de leilão terminal apaga compras/pagamentos/entregas sem preservar pendência; lembrete padrão exige 7d. Avaliar retenção separada do pós-venda, preservando a decisão de limpeza do operador. Código: cleanup_old_auctions e bot/payment-reminder.mjs. |
| P-19 | Alta | Guard de backup verifica arquivo do dia e não cobertura dos registros apagados posteriormente. Banco em UTC; arquivos Node usam fuso local. Definir cobertura temporal e validar restauração antes de mudar a rotina. |
| P-20 | Média | Resultado pode fechar no banco e falhar ao ser anunciado. finalizeDueAuctions busca só abertos e marca finalizeAnnounced antes do envio. Avaliar outbox persistente. |
| P-21 | Média | openingBusy retorna imediatamente ao próximo tick; abertura que dura mais de 5s pode não bloquear dispatch de outro tick. Avaliar Promise compartilhada ou exclusão do ciclo inteiro. Cenário inferido do código, sem reprodução WhatsApp. |
| P-22 | Média | doctor valida presença parcial, trata respostas não-404 como tabela presente, usa select=id para payment_reminders e não aceita SUPABASE_SECRET_KEY como o backend. Fortalecer diagnóstico sem loops. |
| P-23 | Média | Snapshots limitados podem gerar relatório parcial; backup limita drafts/quick polls e não inclui bytes de imagens/sessão. Tornar limites explícitos e testar recuperação. |
| P-24 | Baixa | Histórico remoto inclui global_warnings_fk_indexes sem arquivo local dedicado; índices existem em produção. Avaliar versionamento desses índices em trabalho de banco separado, sem reaplicar história antiga. |

Os itens P-18 a P-24 são registros de revisão, não autorização para alterar produção automaticamente.

## P-25 e P-26 — Implementados em 2026-10-25

| ID | Prioridade | Estado / plano |
|---|---|---|
| P-25 | Concluído no código | Fila compartilhada de duas prévias, placeholders, entrega progressiva, liberação/cancelamento, limite 200 e coordenação com salvamento/publicação. Testes unitários + navegador isolado com 200 fotos sintéticas de 12 MP; sem reprodução com os arquivos reais no Brave. |
| P-26 | Concluído no código | @all nativo com mentionAll preservado até o envio e serializador; permissão admin para grupos >32 e fallback explícito. Bot 0.2.6. Recebimento real/conta admin dependem do ambiente do operador. |

Implementação, evidência e limites da validação em [14_FRONTEND_AND_MENTIONS_PLAN.md](14_FRONTEND_AND_MENTIONS_PLAN.md). Após o diagnóstico, o operador autorizou implementar os dois itens e publicar no GitHub. Código e docs atualizados; nenhum envio WhatsApp ou consulta ao Supabase.

## P-27 — Concluído: publicação acima de 100 cartas

Migration 20261025054810 corrigiu o guard da RPC instalada de 100 para 200, sem mudar dados ou grants. Constraint/código local já aceitavam 200. Teste SQL ampliado para limites e idempotência; validação isolada e confirmação de catálogo em produção. Detalhes em 13_MIGRATION_AUDIT.md. Limite continua 200 itens por fila, incluindo brindes.

## Log Ingestion — restrição atual

Última leitura do Dashboard em 2026-10-25, após P-27: **0,88/1 GB**, valor arredondado do ciclo. Evitar polling extra, consultas repetidas, backups manuais ou testes de carga na produção. Nesta revisão houve leitura do histórico e uma consulta SQL de catálogo; nenhuma medição exata do delta de ingestão. Não há garantia sobre tráfego dos processos já ativos.

O antigo 0,96/1 GB e estimativas de MB/dia são históricos e não devem ser tratados como medição atual. Limpar auction_events não estorna Log Ingestion. Ver [10_SECURITY_AND_PERFORMANCE.md](10_SECURITY_AND_PERFORMANCE.md).

## Decisões encerradas

- **P-14 — Electron/.exe: cancelado pelo operador em 2026-09-29.** Projeto segue web + bot. Não reabrir por iniciativa do agente.
- **P-15 — IA/OCR de cartas: removido pelo operador em 2026-10-05.** Cadastro manual. A tabela histórica foi removida; não reintroduzir.

## Validações ainda não realizadas

Smokes reais de WhatsApp, pausa/retomada, dois ciclos de avisos, suspensão/expiração, Excel visual e recuperação de backup exigem sessão operacional própria. A existência de migrations não comprova esses fluxos. Não executá-los nesta tarefa documental.

## P-28 — Concluído: botão para excluir todos os encerrados

Solicitação explícita do operador substituiu a proposta de preservar pós-venda nesta etapa. Admin deve digitar duas frases; UI/API/RPC verificam ambas. Exclui sold/closed/cancelled e dependências, inclusive pendências financeiras; preserva open/draft/review e filas futuras. Operação transacional/idempotente por eventId e auditoria resumida. Migration 20261025055529 instalada/registrada e conferida sem exclusão de dados reais. P-18 permanece como decisão futura, não implementar a proteção de pós-venda por iniciativa própria.
