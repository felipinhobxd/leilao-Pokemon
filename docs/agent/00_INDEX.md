# 00_INDEX — Memória persistente do projeto

> Política atual autorizada: [25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md](25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md). Limpeza automática inclui vendidos/arremates e dados financeiros após 12h do envio, condicionada à cobertura do backup. Substitui a preservação automática de compras descrita historicamente abaixo. Migration 20261026041119 instalada (74 locais/82 remotos).

> Atualização atual: [24_SAFE_RESUME_AND_FIRST_CONFIRMED_BACKUP.md](24_SAFE_RESUME_AND_FIRST_CONFIRMED_BACKUP.md). Supervisor retomado/conectado, primeiro backup confirmado (52,7MB, 22 tabelas). Duas otimizações de memória/UTF-8 instaladas: 73 migrations locais/81 remotas. Etapas anteriores que dizem não iniciar o bot são histórico.

> Etapa atual: [23_BACKUP_PROTECTION_PANEL.md](23_BACKUP_PROTECTION_PANEL.md). Confirmação de backup e resultado histórico da limpeza no diagnóstico manual. Migration 20261026033328 instalada (71 locais/79 remotos). Sem iniciar/reiniciar bot; supervisor sem sinal recente.

> Atualização posterior: P-19 implementado em [22_BACKUP_COVERAGE_BEFORE_CLEANUP.md](22_BACKUP_COVERAGE_BEFORE_CLEANUP.md). Recibo confirmado da nuvem e cobertura das linhas antes da limpeza. Código do backup/supervisor alterado, sem reiniciar processos. Migration 20261026014353 instalada, 70 locais/78 remotos. Detalhes/limites no documento 22; trechos anteriores são históricos.

> Estado atual consolidado: [19_SETTLEMENT_PROTECTION_AND_RECOVERY.md](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md) e [18_RELIABILITY_AND_UI_REVIEW.md](18_RELIABILITY_AND_UI_REVIEW.md), bot 0.2.10, Next.js 16.4.3. Seções de versões anteriores abaixo são histórico; não reaplicar migrations ou instruções antigas automaticamente.


> Última atualização: 2026-10-25
> Fonte: código local, validação da sessão anterior e conferência de produção em 2026-10-25.

## Alteração financeira e recuperação — 2026-10-25

Proteção conservadora de compras na limpeza automática/manual dos encerrados; backup v2 sem truncar drafts/quizzes; pacote opcional de imagens e restauração em schema privado descartável. Migration 20261025220841 instalada: 69 locais / 77 remotos. Bot 0.2.10 sem arquivos alterados nesta rodada. Documento 19.

## Painel — implementação em etapas

Documento [20_PANEL_FRESHNESS_AND_NAVIGATION.md](20_PANEL_FRESHNESS_AND_NAVIGATION.md): aviso de dados desatualizados, última leitura completa e tentativa manual, sem ampliar polling ou alterar o bot. Etapa 1 com CI aprovada. Após aviso explícito, implementada confirmação nos menus/links de cancelar e Salvar rascunho e sair; limites de beforeunload/histórico no documento 20.

## Edição das selecionadas — próxima etapa autorizada

[21_SELECTED_CARD_EDITING.md](21_SELECTED_CARD_EDITING.md): seleção estável entre páginas/filtros, aplicação de campos às escolhidas, cópia segura e desfazer preservando edições posteriores. Apenas no cadastro ainda não publicado, sem alterar bot/migrations.

## Protocolo de início

1. Ler este índice e `12_SESSION_HANDOFF.md`.
2. Para banco, ler `13_MIGRATION_AUDIT.md` antes de propor aplicação de SQL.
3. Ler o documento da área e o backlog; não executar tarefas antigas automaticamente só por estarem em um handoff histórico.
4. Ao concluir mudanças, atualizar área, backlog, handoff e índice. Distinguir fato do código, evidência de produção e hipótese; não inventar validação.

## Estado atual

- Sistema web de leilões de cartas Pokémon: painel Next.js, PostgreSQL/Supabase e bot local Baileys. Cadastro manual; IA/OCR e Electron foram removidos por decisão do operador.
- Filas de até 200 itens, rascunhos com auto-save 45s, brindes, quatro fotos extras, preços automáticos/personalizados, pausa/retomada e edição pendente.
- Avisos globais por redução direta ou retirada/re-oferta: histórico total preservado, ciclo de três com reset e DM apenas aos administradores. Suspensão com prazo/indefinida, banimento e reativação.
- **Banco**: 75 registros remotos / 67 arquivos locais. Quatro migrations de prazo comum e backup de 2026-10-25 instaladas para prazo comum, outbox e backup em blocos/Gzip; não reaplicar história antiga. Mapeamento e limites no documento 13.
- **Excluir leilões encerrados**: botão admin no painel, duas frases escritas verificadas na UI/API/RPC. Remove todos sold/closed/cancelled e dependências, inclusive pendências financeiras; preserva open/draft/review e agendados. Nenhuma exclusão real feita na implementação. Testes 87 raiz, typecheck, build e smoke aprovados, SQL isolado com mais de 500 registros.
- **Bot 0.2.9**: novo horário comum nas filas, @all após última publicação e resultados a cada >=15s/grupo com outbox. API exige worker atualizado; reabrir supervisor/filho antes de usar modo comum. Detalhes no documento 15.
- **Backup validado**: snapshot consistente em blocos e link privado .json.gz. Teste real: 52,3MB para 6,4MB, 22 tabelas, ~71s. Snapshots/chunks temporários esvaziados; limites históricos de cobertura permanecem.
- **Log Ingestion observado: 0,88/1 GB** em 2026-10-25, arredondado no Dashboard. Não é previsão nem consumo medido desta sessão. Evitar chamadas repetidas; não desligar proteções.
- Validação anterior à correção P-25/P-26: typecheck, 78 testes da raiz, 52 do bot, check do bot (27), build e smoke sem login passaram. CI aprovado no commit d79feb9b; testes SQL do CI são em Postgres isolado.

- **Saúde da operação e UI**: diagnóstico sob demanda, backup automático, pendências, falhas identificadas por carta/lote e recuperação segura de avisos. Navegação compartilhada, tema claro/escuro/sistema, buscas locais e acessibilidade revisada. Reabrir bot 0.2.8 para telemetria; documento 16.

- **Quiz e brindes com vencedor (0.2.9)**: uma correta, primeiro acerto confirmado, prêmio fixo, anúncio durável. Área avulsa e lote, rascunhos e privacidade; reabrir bot 0.2.9. Documento 17.

## Mapa das áreas

| Arquivo | Área / situação |
|---|---|
| [01_PROJECT_CONTEXT.md](01_PROJECT_CONTEXT.md) | Produto e componentes |
| [02_ARCHITECTURE.md](02_ARCHITECTURE.md) | Comunicação, processos e contratos |
| [03_DATABASE.md](03_DATABASE.md) | Tabelas, RPCs, RLS, limites e retenção |
| [04_API.md](04_API.md) | Rotas; health público, demais administrativas |
| [05_FRONTEND.md](05_FRONTEND.md) | Wizard, painel e Realtime confirmado |
| [06_WHATSAPP_BOT.md](06_WHATSAPP_BOT.md) | Bot, supervisor, votos, fila e limitações de envio |
| [08_AUCTION_DOMAIN.md](08_AUCTION_DOMAIN.md) | Regras e invariantes; sem reconhecimento de cartas |
| [09_TESTS_AND_VALIDATION.md](09_TESTS_AND_VALIDATION.md) | 105 raiz, 68 bot, SQL/CI e limites |
| [10_SECURITY_AND_PERFORMANCE.md](10_SECURITY_AND_PERFORMANCE.md) | Auth, custos e restrição de Log Ingestion |
| [11_PENDING_WORK.md](11_PENDING_WORK.md) | Pendências reais; aplicação antiga de migrations encerrada |
| [12_SESSION_HANDOFF.md](12_SESSION_HANDOFF.md) | Checkpoint atual e próxima ação |
| [13_MIGRATION_AUDIT.md](13_MIGRATION_AUDIT.md) | Mapeamento completo local/remoto e verificação de produção |
| [14_FRONTEND_AND_MENTIONS_PLAN.md](14_FRONTEND_AND_MENTIONS_PLAN.md) | P-25/P-26 implementados: fila de prévias + @all nativo; validação e limites |
| [15_DEADLINE_BACKUP_AND_RECOVERY.md](15_DEADLINE_BACKUP_AND_RECOVERY.md) | Bot 0.2.7: horário comum, resultados de 15s, backup Gzip e evidência real |
| [16_OPERATION_HEALTH_AND_UI.md](16_OPERATION_HEALTH_AND_UI.md) | Diagnóstico, recuperação segura, UI/UX e acessibilidade — 0.2.8 |
| [17_QUIZ_AND_GIVEAWAY_PRIZES.md](17_QUIZ_AND_GIVEAWAY_PRIZES.md) | Jogos, prêmio único, privacidade e bot 0.2.9 |
| [19_SETTLEMENT_PROTECTION_AND_RECOVERY.md](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md) | Proteção financeira, backup v2 e ensaio de recuperação |
| [18_RELIABILITY_AND_UI_REVIEW.md](18_RELIABILITY_AND_UI_REVIEW.md) | Estado atual: segurança, recuperação, fotos, disputa e revisão UI — 0.2.10 |

O número 07 foi retirado com o reconhecimento de cartas; não é documento faltante a recriar.

## Atenções para o próximo trabalho

Riscos identificados, ainda sem correção autorizada nesta sessão: retenção 12h remove pós-venda pendente; backup do dia não prova cobertura de todas as exclusões; janela de concorrência da abertura; limites de snapshots e diagnóstico doctor incompleto. Ver backlog.

P-25/P-26 implementados: seleção de até 200 fotos com duas prévias simultâneas e progresso; bot 0.2.6 envia @all nativo com verificação de permissão e fallback explícito. Validação atual: typecheck, 83 testes raiz, 56 bot, check 41 e build aprovados; navegador isolado com 200 fotos sintéticas. Documento 14 contém limites e evidência.

## Comandos de referência

```bash
npm run typecheck
npm test
node --test bot/*.test.mjs
npm --prefix bot run check
npm run build
node tests/smoke.mjs
```

`npm start` inicia site **e bot**, gerando tráfego real; não executar para revisão documental. `npm run doctor` consulta produção e não certifica todas as versões de migrations. Build antes de iniciar o painel local de produção, quando essa inicialização fizer parte da tarefa.
