# 12 — Handoff atual

> Lista contínua — 28/10/2026: [39_CONTINUOUS_CARD_LISTS.md](39_CONTINUOUS_CARD_LISTS.md). Paginação de 12 itens removida de Cartas, Valores e Revisão. Busca/filtros/seleção/foco mantidos, renderização fora da tela adiada. 200 cartas validadas em desktop/celular; 171 testes raiz, 62 navegador, typecheck e build locais aprovados. Bot e banco inalterados; somente site local iniciado após build. Conferir CI/deploy e entregar. Entradas abaixo são histórico.

> Fase 7: [38_PHASE7_SUPERVISOR_CONTROL.md](38_PHASE7_SUPERVISOR_CONTROL.md). Controle do supervisor unificado em uma RPC, mantendo 5s e prioridade de logout. **0.2.21 ativado/conectado após CI e deploy aprovados**. Migration `20261027184029` aplicada, só service_role. 154 testes bot/171 raiz/typecheck/36 SQL locais aprovados; concorrência de oito claims adicionada à CI. CI passou também 60 testes de navegador e oito claims concorrentes. Janela real de 15h45–15h46: 12 RPCs novas, zero nas duas leituras antigas; heartbeat mantido. Às 15h46, pending/review zero. **Fase concluída; parar antes de nova fase.**

> Fase 5 autorizada e implementada: [37_PHASE5_IDLE_DATABASE_REQUESTS.md](37_PHASE5_IDLE_DATABASE_REQUESTS.md). Bot **0.2.20 ativado/conectado**, migration `20261027182113` aplicada/verificada. Uma consulta substitui quatro leituras vazias; descoberta continua a cada 5s, votos e avisos permanecem ativos. 148 testes bot, 171 raiz, typecheck e 35 SQL locais aprovados. Redução de 75% somente nos quatro caminhos ociosos simulados; não garante consumo abaixo de 1 GB. CI do código `c7f58523` e deploy aprovados (60 testes navegador adicionais). Às 15h27: 0.2.20 conectado, pending/review zero, cerca de 6min sem nova queda inesperada. **Fase concluída; parar e perguntar antes de nova fase.** Entradas abaixo são histórico.

> Encerramento da fase 4 conferido às 14h24: resultado automático entregue na primeira tentativa, lance de teste de R$ 1 preservado, 0.2.19 conectado e pending/review zero; cerca de 22min sem queda inesperada nova. CI do runtime `702a2482` aprovada (171 raiz/144 bot/60 navegador, SQL/build/deploy). [Relatório final](36_GLM_AUDIT_PHASE4_LIVE_VALIDATION.md). Próximo commit é apenas evidência Markdown. **Fase concluída; não iniciar nova fase sem autorização.**

> Auditoria GLM — fase 4 (2026-10-27): [36_GLM_AUDIT_PHASE4_LIVE_VALIDATION.md](36_GLM_AUDIT_PHASE4_LIVE_VALIDATION.md). Bot **0.2.19 ativado e conectado**, painel local no ar. Corrigida corrida no backup da partida (reproduzida: duas exportações; agora uma). Validação real no grupo de testes: retirada em 12,907s aceita; retirada em 96,293s recusada preservando lance, pending/review zero; quiz/brinde sem compra; resumo parcial entregue com 3 publicados/1 falha simulada. Prazo comum mantido em 14h24. 144 testes bot e build locais aprovados. Sem migration nova. **Parar após CI/deploy e apresentar resultados.** Entradas anteriores são histórico.


> Auditoria GLM — fase 3 (2026-10-27): [35_GLM_AUDIT_PHASE3_RULES.md](35_GLM_AUDIT_PHASE3_RULES.md). Operador escolheu primeiro acerto sem compra para quiz/brinde, retirada de lance comum em até 60s e conclusão parcial com aviso das cartas não publicadas. Bot **0.2.18 no disco, não ativado**; sem processo local ativo na conferência. Migration `20261027163530` instalada/verificada, **76 arquivos locais / 84 registros remotos**, sem reparação de histórico. 141 testes bot, 171 raiz, typecheck e 34 suítes SQL locais aprovados. **Parar após CI/deploy e perguntar antes da próxima fase.** Entradas anteriores são histórico.


> Auditoria GLM — fase 2 (2026-10-27): [34_GLM_AUDIT_PHASE2_NOTICES.md](34_GLM_AUDIT_PHASE2_NOTICES.md). Bot **0.2.17 no disco, não ativado**. Operador autorizou conclusão sem @all quando a falta de permissão for confirmada, com alerta administrativo idempotente e decisão persistida. Falha de entrega por dez tentativas também escala aos admins, sem descartar a mensagem. 138 testes bot, 171 raiz e typecheck aprovados localmente; SQL ampliado na CI. Sem migration, produção ou polling novo. **Parar após CI e pedir autorização para fase 3.** Entradas anteriores são histórico.


> Auditoria GLM — fase 1 (2026-10-27): [33_GLM_AUDIT_PHASE1_FIXES.md](33_GLM_AUDIT_PHASE1_FIXES.md). Bot **0.2.16 no disco, não ativado**. Contatos removidos da árvore atual e configurados em `.env` privado; CI executa todos os testes do bot; replay da auditoria exige leitura/identidade; falha de projeção dos IDs é tratada sem falhar publicação entregue; manifesto/README corrigidos. 171 testes raiz, 130 bot e typecheck locais aprovados. Sem acesso ao Supabase/WhatsApp nesta fase. **Parar após CI e perguntar antes da fase 2.** As entradas anteriores abaixo são histórico, não diagnóstico do processo atual.


> Fase 3: [32_PHASE3_BACKUP_GUARDED_CLEANUP.md](32_PHASE3_BACKUP_GUARDED_CLEANUP.md). Limpeza protegida validada em isolamento: 32 cenários SQL, limite de envio, vendas/arremates, bloqueio total por alteração após backup e preservação de avisos/ativos. Concorrência ampliada para pagamentos/lembretes na CI. Zero chamada ao Supabase ou limpeza real. **Três fases concluídas; apresentar resultados e parar.**


> Fase 2: [31_PHASE2_REAL_BACKUP_RESTORE.md](31_PHASE2_REAL_BACKUP_RESTORE.md). Snapshot real restaurado em PGlite local: 22 tabelas, 29.927 registros, 35 FKs válidas, comparação de todos os campos e staging privado. Zero acesso ao Supabase; fotos não incluídas (179 referências). Teste de CI fortalecido, sem runtime/migration. **Parar e pedir autorização para fase 3**. Bot não iniciado/reiniciado; sem processo ativo na leitura inicial.


> Testes em fases: [30_PHASED_RESILIENCE_TESTS.md](30_PHASED_RESILIENCE_TESTS.md). Fase 1: filho encerrado durante fila, reconexão automática em 7,163s e 3/3 enviados sem reenvio observado. Journal validado entre dois processos isolados após commit simulado sem confirmação. 124 testes bot. **Parar e pedir autorização para fase 2 (restauração isolada)**.


> Atualização: [29_CONNECTION_DIAGNOSTICS.md](29_CONNECTION_DIAGNOSTICS.md). Bot 0.2.15 ativado: histórico local limitado de desconexões, duração, reinício inesperado e contagem de 24h no diagnóstico manual. Resumo no heartbeat existente, sem migration ou polling extra. 170 testes raiz/123 bot; monitoramento iniciado às 21h48 de 26/10/2026.


> Revisão real posterior: [28_LIVE_END_TO_END_AUDIT.md](28_LIVE_END_TO_END_AUDIT.md). Bot 0.2.14 ativado e conectado; testes reais de publicação, votos, quiz/brinde, encerramento, arremate, backup e Excel concluídos. Correção de retirada vencida, 169 testes raiz/118 bot/31 SQL. As instruções anteriores de preservar processos/aguardar ativação são histórico; ver limites de relógio e quota no documento 28.


> Fase 4: [27_PHASED_REVIEW_FIXES.md](27_PHASED_REVIEW_FIXES.md). Lote/individual liberam edição só após recusa de validação e recuperação com ausência confirmada. Mesmo ID preservado inclusive na sessão editável após reload; dados do payload restaurados. 169 testes raiz/check do bot/typecheck/build/smoke locais aprovados; conferir CI/deployment final. Sete cenários de navegador novos em desktop/celular. Sem migration ou alteração/reinício do bot (disco 0.2.13). **Quatro fases de código concluídas: PARAR e informar a pendência de carregar supervisor/filho em reinício planejado, sem executar automaticamente**.

> Excel atualizado: [26_EXCEL_BID_HISTORY.md](26_EXCEL_BID_HISTORY.md). Nova aba por participante/leilão e alterações com valor anterior → novo, primeiro/último horário e vínculo anterior quando identificável. 148 testes raiz, typecheck e build locais aprovados; conferir CI/deploy do commit final. Sem migration, consultas ao Supabase ou alterações/reinício do bot. Exportar antes da limpeza de 12h; dados excluídos não reaparecem no Excel.

> Política atual autorizada: [25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md](25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md). Limpeza automática inclui vendidos/arremates e dados financeiros após 12h do envio, condicionada à cobertura do backup. Substitui a preservação automática de compras descrita historicamente abaixo. Migration 20261026041119 instalada (74 locais/82 remotos).

> Atualização atual: [24_SAFE_RESUME_AND_FIRST_CONFIRMED_BACKUP.md](24_SAFE_RESUME_AND_FIRST_CONFIRMED_BACKUP.md). Supervisor retomado/conectado, primeiro backup confirmado (52,7MB, 22 tabelas). Duas otimizações de memória/UTF-8 instaladas: 73 migrations locais/81 remotas. Etapas anteriores que dizem não iniciar o bot são histórico.

> Etapa atual: [23_BACKUP_PROTECTION_PANEL.md](23_BACKUP_PROTECTION_PANEL.md). Confirmação de backup e resultado histórico da limpeza no diagnóstico manual. Migration 20261026033328 instalada (71 locais/79 remotos). Sem iniciar/reiniciar bot; supervisor sem sinal recente.

> Atualização posterior: P-19 implementado em [22_BACKUP_COVERAGE_BEFORE_CLEANUP.md](22_BACKUP_COVERAGE_BEFORE_CLEANUP.md). Recibo confirmado da nuvem e cobertura das linhas antes da limpeza. Código do backup/supervisor alterado, sem reiniciar processos. Migration 20261026014353 instalada, 70 locais/78 remotos. Detalhes/limites no documento 22; trechos anteriores são históricos.

Projeto D:\LeilaoPokemon, main, remoto felipinhobxd/leilao-Pokemon. Autor F <felipinhovecoski@gmail.com>.

Estado: [19_SETTLEMENT_PROTECTION_AND_RECOVERY.md](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md), complementado pela revisão de UI/confiabilidade do documento 18. Bot 0.2.10 / Next 16.4.3. Nesta rodada nenhum arquivo em bot/ foi alterado, nenhum processo do bot foi iniciado/reiniciado e nenhuma mensagem real foi enviada.

Migration 20261025220841 instalada pelo conector no projeto gsyuoggymjdzxibfujyv. 69 locais / 77 registros remotos; divergências históricas preservadas. Não rodar db push/repair geral. Catálogo confirmou proteção da limpeza/bulk, backup v2 e acesso privado.

Limpeza automática 12h e botão de encerrados agora preservam todos os leilões com compras, mesmo pagas, mantendo o histórico financeiro. Filas com vendas/quizzes e avisos pendentes são protegidas na limpeza automática. Exclusão individual/Excluir TUDO continuam destrutivas explícitas. P-19 (arquivo diário não comprova cobertura exata) permanece aberto.

Backup v2 sem truncar rascunhos/quizzes, incluindo todas as colunas de lembretes/jogos. npm run backup:pack cria pacote com hashes, SQL de staging e imagens opcionais. Não executa SQL automaticamente. Restauração testada em schema leilao_recovery privado de banco descartável; não promove dados para produção nem restaura Auth/WhatsApp. Imagens externas/privadas ou falhas ficam explícitas como incompletas.

Local: 123 testes raiz, 70 bot, 25 cenários SQL, typecheck, check e build aprovados; ensaio adicional de 22 tabelas aprovado. CI adiciona ensaio PostgreSQL17 e teste de dupla confirmação com contagem preservada (desktop/celular). Consultar CI/deploy do commit publicado antes de afirmar resultado remoto.

Log Ingestion alvo 1GB: somente consultas pontuais de catálogo/advisors e uma instalação; sem backup real, imagens reais ou testes de carga. Último número conhecido 0,88/1GB é antigo; não medimos delta nem garantimos quota dos processos ativos. Não iniciar bot em testes.


Etapa posterior: documento 20, aviso de atualização do painel implementado, 125 testes raiz/typecheck locais aprovados e CI de navegador ampliada. Não iniciou proteção de navegação ainda; operador pediu aviso de transição. Nenhum arquivo de bot ou migration alterado nesta etapa.


Etapa de navegação iniciada após aviso ao operador e CI verde de 55e6a40e. Provider/GuardedLink cobre menus e links de cancelar nos dois wizards; lote pode salvar e sair somente com rascunho completo. Fotos locais pendentes continuam protegidas, falhas não navegam; single tem descarte explícito sem publicar. beforeunload centralizado; não bloqueia toda navegação de histórico do navegador. 127 testes raiz/typecheck/build locais aprovados e teste visual salvou/reabriu corretamente. Consultar CI/deploy finais. Documento 20.


Próxima etapa autorizada e anunciada: documento 21, edição das cartas selecionadas no cadastro ainda não publicado. Seleção por UUID entre páginas/filtros/reorder; campos explícitos, preços atômicos, jogos preservados, cópia de configuração com whitelist e desfazer de um nível que não sobrescreve alterações posteriores. CopyPrevious passa a mesma whitelist e não duplica mídia/respostas/tipo. 134 testes raiz, typecheck e build locais aprovados; conferir CI/deploy finais. Sem alterar bot, schema ou polling. Não iniciar P-19/recuperação operacional sem novo aviso/escopo.
