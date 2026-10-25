# 00_INDEX — Memória persistente do projeto

> Última atualização: 2026-10-25
> Fonte: código local, validação da sessão anterior e conferência de produção em 2026-10-25.

## Protocolo de início

1. Ler este índice e `12_SESSION_HANDOFF.md`.
2. Para banco, ler `13_MIGRATION_AUDIT.md` antes de propor aplicação de SQL.
3. Ler o documento da área e o backlog; não executar tarefas antigas automaticamente só por estarem em um handoff histórico.
4. Ao concluir mudanças, atualizar área, backlog, handoff e índice. Distinguir fato do código, evidência de produção e hipótese; não inventar validação.

## Estado atual

- Sistema web de leilões de cartas Pokémon: painel Next.js, PostgreSQL/Supabase e bot local Baileys. Cadastro manual; IA/OCR e Electron foram removidos por decisão do operador.
- Filas de até 200 itens, rascunhos com auto-save 45s, brindes, quatro fotos extras, preços automáticos/personalizados, pausa/retomada e edição pendente.
- Avisos globais por redução direta ou retirada/re-oferta: histórico total preservado, ciclo de três com reset e DM apenas aos administradores. Suspensão com prazo/indefinida, banimento e reativação.
- **Banco**: 68 registros remotos / 60 arquivos locais após a migration 20261025054810. Corrigida RPC instalada com guard 100 para aceitar 200; a constraint e o corpo local já aceitavam 200. Histórico por nome não comprova corpo integral. Mapeamento anterior: 23 versões diferentes e oito extras; não reaplicar por timestamp. Ver documento 13.
- Backup mais recente: local 20261010100000 / remoto 20261010192429; sete dias de auditoria/cache, timeout 55s e work_mem 32MB.
- **Log Ingestion observado: 0,88/1 GB** em 2026-10-25, arredondado no Dashboard. Não é previsão nem consumo medido desta sessão. Evitar chamadas repetidas; não desligar proteções.
- Validação anterior à correção P-25/P-26: typecheck, 78 testes da raiz, 52 do bot, check do bot (27), build e smoke sem login passaram. CI aprovado no commit d79feb9b; testes SQL do CI são em Postgres isolado.

## Mapa das áreas

| Arquivo | Área / situação |
|---|---|
| [01_PROJECT_CONTEXT.md](01_PROJECT_CONTEXT.md) | Produto e componentes |
| [02_ARCHITECTURE.md](02_ARCHITECTURE.md) | Comunicação, processos e contratos |
| [03_DATABASE.md](03_DATABASE.md) | Tabelas, RPCs, RLS, limites e retenção |
| [04_API.md](04_API.md) | 20 rotas; health público, demais administrativas |
| [05_FRONTEND.md](05_FRONTEND.md) | Wizard, painel e Realtime confirmado |
| [06_WHATSAPP_BOT.md](06_WHATSAPP_BOT.md) | Bot, supervisor, votos, fila e limitações de envio |
| [08_AUCTION_DOMAIN.md](08_AUCTION_DOMAIN.md) | Regras e invariantes; sem reconhecimento de cartas |
| [09_TESTS_AND_VALIDATION.md](09_TESTS_AND_VALIDATION.md) | 78 raiz, 52 bot, check 27, SQL/CI e lacunas |
| [10_SECURITY_AND_PERFORMANCE.md](10_SECURITY_AND_PERFORMANCE.md) | Auth, custos e restrição de Log Ingestion |
| [11_PENDING_WORK.md](11_PENDING_WORK.md) | Pendências reais; aplicação antiga de migrations encerrada |
| [12_SESSION_HANDOFF.md](12_SESSION_HANDOFF.md) | Checkpoint atual e próxima ação |
| [13_MIGRATION_AUDIT.md](13_MIGRATION_AUDIT.md) | Mapeamento completo local/remoto e verificação de produção |
| [14_FRONTEND_AND_MENTIONS_PLAN.md](14_FRONTEND_AND_MENTIONS_PLAN.md) | P-25/P-26 implementados: fila de prévias + @all nativo; validação e limites |

O número 07 foi retirado com o reconhecimento de cartas; não é documento faltante a recriar.

## Atenções para o próximo trabalho

Riscos identificados, ainda sem correção autorizada nesta sessão: retenção 12h remove pós-venda pendente; backup do dia não prova cobertura de todas as exclusões; anúncio final sem nova tentativa persistente; janela de concorrência da abertura; limites de snapshots e diagnóstico doctor incompleto. Ver backlog.

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
