# SESSION HANDOFF

## Última atualização

2026-10-25 — conferência das migrations em produção e reconciliação dos MDs.

## O que foi solicitado e concluído

O operador autorizou conferir migrations e atualizar MDs, com cuidado para permanecer na cota gratuita de Log Ingestion. A imagem e o Dashboard mostraram **0,86/1 GB**. A revisão não mudou funcionalidades, bot, configuração de logs, SQL de produção ou histórico de migrations.

O plugin Supabase retornou Unknown tool para list_projects/list_migrations/search_docs. O operador autenticou o navegador e a conferência foi concluída no Dashboard do projeto **PokemonLeilao**, referência **gsyuoggymjdzxibfujyv**, a mesma do ambiente local.

## Resultado do banco

- **67 registros remotos / 59 arquivos locais**. Todos correspondem por nome; 23 versões são diferentes e existem oito registros adicionais no remoto. Tabela completa em [13_MIGRATION_AUDIT.md](13_MIGRATION_AUDIT.md).
- As antigas pendências P-13/P-17 estão registradas, inclusive participantes, retirada/re-oferta, correção bigint, prune 7d e backup de 10/10.
- Última migration remota: **20261010192429_bound_backup_audit_export**; arquivo local: 20261010100000_bound_backup_audit_export.sql. SQL registrado foi lido.
- Uma consulta SQL de catálogo (12 linhas de saída) confirmou: assinatura cleanup 12h/7d, backup 55s/32MB e janela 7d, helper bigint, comandos e stats/change_kind, constraint 200, tabela de IA ausente e índices relevantes presentes. Sessão SQL em UTC.
- Não foram executados RPCs de negócio, cleanup, backup, testes de carga ou consultas a dados de participantes/vendas.
- Diferença de timestamp não é migration pendente. Não rodar db push, renomear arquivos ou reparar histórico com base apenas na diferença.

## Documentação reconciliada

Atualizados README da raiz, README do bot e docs de agente: versões de migrations e estado de aplicação, janela de envios 24h, fila 200, Realtime confirmado, polling do bot/comandos 5s, testes 78/52/check27, limites de export/backup, ciclo de avisos e restrição de Log Ingestion. Retiradas instruções antigas para reaplicar migrations, cabeçalhos corrompidos e garantias absolutas de entrega onde identificadas.

## Próximo passo

Não há aplicação pendente identificada entre os 59 arquivos locais por nome. A próxima alteração funcional deve ser escolhida pelo operador a partir do backlog. Prioridades sugeridas: P-18 (pós-venda x limpeza 12h) e P-19 (cobertura do backup). A conferência não corrigiu esses riscos.

Antes de nova mudança de banco, usar evidência local e o mapeamento já salvo; consultar produção apenas se necessário e de forma pontual. Não reiniciar bot nem gerar backups para repetir esta conferência.

## Validação e limites

- Sessão anterior: typecheck, 78 testes raiz, 52 bot, check bot 27, build e smoke HTTP sem login aprovados. CI d79feb9b aprovado, SQL em Postgres isolado.
- Sessão documental: verificação local de diff, referências e consistência; sem repetir suites ou testes contra produção.
- Correspondência por nome e catálogo não é comparação integral de todos os corpos SQL nem smoke de WhatsApp. Estado de Log Ingestion é arredondado; não se calculou custo exato desta sessão nem se promete limite para processos já ativos.
- O doctor é parcial e não comprova versões de todas as migrations. A sua revisão está no P-22.

## Contratos e decisões a preservar

- PostgreSQL decide resultado; eventIds estáveis, transações e locks protegem lances/arremates. Cache de idempotência com retenção 7d.
- Histórico de avisos global; ciclo de três reinicia e envia DM só aos admins. Retirada + re-oferta menor soma no mesmo ciclo.
- Cadastro de cartas manual; reconhecimento IA/OCR removido. Electron cancelado. Não reabrir.
- Até quatro fotos extras; brinde na fila não vira leilão pago; menções usam JIDs reais.
- Abertura pretendida: regras → figurinha → @all, antes do lote. Existe janela entre ticks a revisar (P-21); não afirmar garantia absoluta.
- Suspensão com prazo: suspension_until; indefinida: status suspended; reativar limpa status/prazo.
- Excluir leilão exige “sim quero”; purge total usa frases próprias. Não executar na conferência.
- Componentes cliente podem importar tipos de backend; nunca valores do módulo privilegiado. Preservar server-only.
- Testes de estado local devem redirecionar BOT_DATA_DIR antes do import.
- Ler mudanças do operador antes de substituir funções/push; atualizar área, backlog, este handoff e índice ao concluir trabalho.

## Histórico técnico resumido

As sessões anteriores corrigiram votos encapsulados (ephemeralMessage), identidade LID/telefone, repetição de anúncio final, travas de sessão, estágios de publicação, rascunhos/brindes, avisos e redução pós-retirada. Em 08/10 houve queda do Supabase e endurecimento do tratamento de erros do filho; prune e backup limitado foram registrados depois. Os detalhes técnicos e limitações atuais estão nos documentos de área. Instruções antigas para aplicar migrations foram superadas pela conferência de 25/10.
