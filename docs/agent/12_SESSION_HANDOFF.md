# 12 — Handoff atual

> Fase 3: [27_PHASED_REVIEW_FIXES.md](27_PHASED_REVIEW_FIXES.md). Anti-join de filas pausadas antes do limite de dois, preservando avulsos e ordem; quatro regressões novas e contrato REST validado. 150 testes raiz/112 bot, check/typecheck/build/smoke locais aprovados; conferir CI/deployment final. Bot 0.2.13 no disco, supervisor/filho preservados; ativação completa exige reinício planejado. Sem migration ou mensagens reais de teste; uma leitura REST pontual retornou zero pendentes. **PARAR e pedir autorização para fase 4**.

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
