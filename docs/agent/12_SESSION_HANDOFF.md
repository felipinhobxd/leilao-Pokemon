# SESSION HANDOFF

## Checkpoint atual — Quiz e brindes (0.2.9)

Operador pediu brinde com uma resposta correta e Quiz separado, avulso e no lote. Implementado com primeiro acerto confirmado, resultado imutável e anúncio durável de nome/carta. Migration 20261025080442 instalada/registrada; 67 locais/75 remotos. 105 testes raiz, 68 bot, 22 SQL PGlite; CI inclui disputa real em oito conexões isoladas. Nenhum prêmio/mensagem real. Reabrir bot 0.2.9. Ler documento 17.

## Checkpoint anterior — UI e saúde da operação (0.2.8)

Operador autorizou a proposta de diagnóstico/recuperação e melhorias gerais de UI/UX/acessibilidade. Implementação e limites em `16_OPERATION_HEALTH_AND_UI.md`. Migration `20261025073504_operation_health_and_notice_errors.sql` instalada no Supabase e registrada na mesma transação; 66 arquivos locais / 74 registros remotos. Nenhum leilão real reprocessado ou mensagem enviada. Reabrir supervisor/filho para carregar telemetria 0.2.8. As seções abaixo são histórico, não trabalho a executar automaticamente.

## Última atualização histórica

2026-10-25 — corrigida divergência de limite 100/200 da RPC em produção; fotos em lote/@all implementados.

## Publicação de 100 a 200 cartas

- Produção tinha guard de 100 em `create_auction_publish_queue`, mesmo com constraint 200 e corpo local de `20260924220000` já em 200. A auditoria anterior não conferiu esse trecho; histórico por nome não garante corpo idêntico.
- Nova migration `20261025054810_raise_auction_queue_rpc_limit_to_200.sql`: substituição pontual, idempotente, preserva demais regras/permissões. Aplicada no SQL Editor e registrada com a mesma versão na mesma transação, sem reaplicar histórico antigo. Catálogo confirmou 200, hash previsto e grants/config preservados.
- `tests/auction-queue-scale.sql` agora cobre 35/100/101/200, rejeição 201, posições, espaçamento e retries. PGlite descartável reproduziu o guard antigo e passou após correção, inclusive brindes. Sem RPC de negócio em produção ou reinício do bot. Detalhes e limites no documento 13.
- Agora são 60 arquivos locais e 68 registros remotos. As contagens 59/67 abaixo descrevem a conferência inicial, antes desta mudança.

## P-25/P-26 — implementação autorizada e concluída

- Operador autorizou corrigir os dois problemas documentados e fazer push no mesmo GitHub, autor **F <felipinhovecoski@gmail.com>**.
- Fotos: `lib/card-preview.ts` e wizard usam fila compartilhada de duas tarefas, placeholders, entrega progressiva, cancelamento/limpeza e limite 200; salvar/auto-save/publicar aguardam o preparo. Originais preservados para upload.
- @all: builder + `sendOpeningMention` encaminham flag nativa; verifica admin em grupos >32 e aliases PN/LID. Metadata/falta de permissão geram aviso simples e diagnóstico. Sem teste de envio real; não alterar permissões automaticamente.
- Bot atualizado para **0.2.6**. O processo já rodando não foi reiniciado para não interromper leilões; carregar a nova versão no próximo início/reinício operacional.
- Typecheck, 83 testes raiz, 56 bot, check 41 e build aprovados. Navegador isolado: 200 fotos JPEG sintéticas de 12 MP, duas seleções de 100, 15,5s total, concorrência máxima 2, primeira prévia 190ms e digitação durante o preparo. Não é benchmark dos arquivos reais no Brave ou do wizard autenticado completo.
- Nenhuma chamada ao Supabase/migration, mensagem para grupos ou início/reinício do bot. Documento 14 reúne evidência e limites. P-18 a P-24 seguem pendentes.
- Smoke HTTP após o build aprovado: servidor local iniciou e rotas administrativas rejeitaram chamadas sem login com 401. Publicação deste conjunto autorizada em `main`, no mesmo repositório; hash final consta no fechamento da conversa.

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

Última leitura de Log Ingestion após P-27: **0,88/1 GB**, agregada/arredondada; valores 0,86 acima descrevem observações anteriores. Não há medição do consumo exclusivo desta tarefa.

## Checkpoint mais recente — exclusão manual dos encerrados

2026-10-25: botão admin no painel + modal com duas frases escritas, rota POST /api/auctions/delete-completed e RPC delete_completed_auctions. Filtra sold/closed/cancelled no banco, sem LIMIT/cutoff; reutiliza delete_auction para dependências/filas/cartas. Mantém participantes, avisos globais, sessão WhatsApp, Storage e sequência. Remove compras/pagamentos/entregas vinculados mesmo pendentes; UI explica isso. Operador recusou a proposta de proteção do pós-venda nesta etapa; não implementar P-18 automaticamente.

Migration 20261025055529 instalada pelo SQL Editor e registrada na mesma transação; hash/grants/invoker confirmados. 61 arquivos locais / 69 registros remotos. Nenhuma exclusão real, reinício de bot, mensagem ou backup. 87 testes raiz, typecheck, build e smoke aprovados; SQL isolado com mais de 500 terminais e rollback/retry; navegador com auth/respostas simuladas. Log Ingestion observado ao fim continua 0,88/1 GB, arredondado. Advisor do plugin indisponível (Unknown tool); revisão de acesso manual registrada no documento 13. Código/docs devem ser publicados no mesmo GitHub com F <felipinhovecoski@gmail.com>.


## Checkpoint mais recente — bot 0.2.7

Horário comum nas novas filas, com API/SQL preservando deadline, outbox para resumo @all e resultados de 15s. Snapshot consistente em blocos + Gzip/link privado para backups manuais e nuvem do bot. Timeout real e recuperação de serviços/HTML. Migrations novas: 20261025062419, 20261025065040, 20261025065722, 20261025070438, registradas com mesmas versões no SQL Editor porque apply_migration do conector retornou Unknown tool. Agora 65 arquivos locais/73 registros remotos. Não reaplicar história antiga.

96 testes raiz, 62 bot, typecheck, build, smoke e 20 cenários SQL isolados passaram. Nenhum anúncio/resultado/teste WhatsApp ou limpeza de leilões na produção. A cópia real do backup foi necessária: o caminho antigo excedeu 65s; o primeiro caminho em blocos produziu JSON válido de 52.289.109 bytes/22 tabelas em ~101s, antes da otimização de chunks separados/Gzip. Resultado final e arquivo ficam no documento 15. Não incluir backup, segredos ou anexos no Git.

Bot no disco atualizado para 0.2.7; não foi iniciado um segundo bot nem reiniciado processo de leilão. O worker precisa carregar a nova versão antes de usar modo comum, exigência explícita da API. P-20 resolvido para encerramentos agendados; pendências de cobertura do backup/retenção não foram eliminadas.

Resultado final validado: JSON de 52.289.109 bytes compactado para 6.390.926 bytes, 22 tabelas, 71.447ms incluindo download/descompactação. Arquivo privado fora do Git em outputs/leilao-backup-2026-10-25T07-08-41-402Z.json.gz. Cinco tentativas reais no total (três falhas diagnosticadas, duas concluídas); não repetir sem nova necessidade. Catálogo confirmou as quatro versões, RLS e tabelas temporárias vazias. Dashboard segue exibindo Log Ingestion 0,88/1GB, arredondado/com atraso. Documento 15 consolida evidências.
