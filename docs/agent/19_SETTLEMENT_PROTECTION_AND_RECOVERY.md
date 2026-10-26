# 19 — Proteção financeira e recuperação de backup

> Política atual autorizada: [25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md](25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md). Limpeza automática inclui vendidos/arremates e dados financeiros após 12h do envio, condicionada à cobertura do backup. Substitui a preservação automática de compras descrita historicamente abaixo. Migration 20261026041119 instalada (74 locais/82 remotos).

> Atualização posterior: P-19 implementado em [22_BACKUP_COVERAGE_BEFORE_CLEANUP.md](22_BACKUP_COVERAGE_BEFORE_CLEANUP.md). Recibo confirmado da nuvem e cobertura das linhas antes da limpeza. Código do backup/supervisor alterado, sem reiniciar processos. Detalhes/limites e versão efetiva no documento 22; trechos anteriores são históricos.

Atualizado em 2026-10-25. Pedido do operador: começar pelas pendências financeiras e recuperação de backups, com cuidado para não quebrar o bot. Este documento complementa e substitui as regras de retenção/cobertura descritas anteriormente no documento 18.

## O que mudou

- Migration **20261025220841_protect_settlements_and_complete_backups.sql**, criada pela CLI e renomeada para a versão efetivamente registrada pelo conector. Instalada no projeto `gsyuoggymjdzxibfujyv`. **69 arquivos locais / 77 registros remotos**; diferenças históricas preservadas.
- `cleanup_old_auctions(p_hours default 12,p_audit_days default 7)` mantém assinatura e formato `deleted` usados pelo supervisor. Seleção única de candidatos com locks e rechecagem antes da exclusão. **Todo leilão com compra vinculada é preservado**, mesmo pago, com pagamentos, entregas, lembretes, lances e carta. É uma proteção conservadora do histórico financeiro; não depende de inferir quitação ou entrega.
- Leilões terminais sem compras continuam elegíveis após 12h. Avisos de resultado ainda pendentes também impedem limpeza automática. Filas com dispatches sobreviventes, quizzes/brindes ou avisos pendentes são mantidas, evitando cascata sobre vendas e jogos.
- Auditoria ligada a leilões sobreviventes também é mantida e exportada; a janela de sete dias continua para auditoria sem leilão sobrevivente e para cache de comandos.
- O botão de encerrados continua exigindo **duas frases** e idempotência. Agora ignora leilões com compras e devolve `preserved_financial_auctions`; o painel explica a regra e informa quantos preservou.
- **Exclusão individual e “Excluir TUDO” continuam ações destrutivas explícitas**, com suas confirmações. Não representam a limpeza protegida e ainda podem remover dados financeiros. Nenhuma exclusão real foi acionada nesta tarefa.

## Cobertura do download e do backup automático

Os dois exportadores (`export_business_backup` e a versão JSON-texto usada pelos blocos) exportam todas as linhas de rascunhos e quick polls, sem os limites de 50/500. Incluem todas as colunas de jogos e lembretes, inclusive `payment_reminders.id`. O envelope dos backups novos tem `format_version: 2`, `includes_image_bytes: false` e `audit_window_days: 7` (com a exceção de auditoria vinculada descrita acima).

O download continua sendo `.json.gz`, privado e com link temporário. O supervisor continua salvando JSON local e Gzip na nuvem, nos mesmos horários/retentativas. Não se iniciou nem reiniciou o bot para testar. **Nenhum arquivo em `bot/` foi alterado nesta rodada**, e nenhuma assinatura de RPC do bot mudou.

## Pacote de recuperação com imagens

A partir de um **backup v2 já baixado**, em uma pasta nova:

```powershell
cd D:\LeilaoPokemon
npm run backup:pack -- --file D:\Backups\leilao-backup.json.gz --output D:\Backups\pacote-novo
```

Isso não acessa Supabase nem inicia o bot. Produz `backup.json`, `recovery.sql`, `manifest.json` e pasta `images/`. O manifesto registra quantidades de todas as 22 tabelas e SHA-256 dos arquivos. Se houver imagens referenciadas que não foram baixadas, sinaliza `images_complete: false` e código de saída 2; não declara recuperação integral.

Para incluir as imagens públicas do bucket `card-images`, habilite explicitamente:

```powershell
npm run backup:pack -- --file D:\Backups\leilao-backup.json.gz --output D:\Backups\pacote-com-imagens --images --source-origin https://gsyuoggymjdzxibfujyv.supabase.co
npm run backup:pack -- --verify --output D:\Backups\pacote-com-imagens
```

Downloads são sequenciais, deduplicados por URL, sem credenciais, sem redirects e sem retentativas automáticas. Limites: 20MB por imagem, 500MB no total e 30s por requisição. Varre também imagens de rascunhos e jogos. URLs externas, privadas/assinadas, falhas e limites excedidos ficam explícitos no manifesto; não são buscados arbitrariamente. O caminho original do objeto fica em `storage_path` para reposição assistida. Não executamos downloads de imagens reais nesta tarefa. Copie o pacote para outro disco/local seguro; hashes detectam corrupção, não autenticam a origem de um arquivo adulterado deliberadamente.

## Ensaio de restauração e limites

`recovery.sql` é destinado a **banco descartável com o mesmo schema e migrations**. Cria um schema privado novo `leilao_recovery`, recusa sobrescrever um existente, restaura todas as colunas, chaves únicas/checks e FKs entre tabelas de negócio. Não copia triggers de envio/auditoria, não escreve em `public`, não executa o bot e não restaura publicações em uma fila operacional. Recusa incompatibilidade de colunas em vez de descartar campos silenciosamente. Schema e tabelas não dão acesso a anon/authenticated.

O ensaio compara todas as linhas/campos exportados às 22 tabelas restauradas, incluindo compra parcialmente paga, entrega, lembrete, Unicode, rascunho, correta e ganhador do quiz. A CI executa o SQL **gerado pela ferramenta**, em PostgreSQL 17; teste local equivalente passou em PGlite. O arquivo antigo `backup-restore.sql` também permanece como regressão complementar.

**Não é restauração automática em produção.** A promoção dos dados e reposição das imagens exigem procedimento assistido, com o bot parado, contas administrativas recriadas/mapeadas e validação antes de liberar filas. Auth/senhas, chaves, sessões do WhatsApp, workers e configurações de infraestrutura não fazem parte deste backup de negócio. IDs de autores são conservados no staging como informação, sem recriar contas. Backups antigos não ganham imagens ou linhas que já estavam ausentes; a ferramenta recusa formato legado como pacote completo. A [documentação oficial do Supabase](https://supabase.com/docs/guides/platform/backups) também distingue backup do banco dos objetos do Storage.

## Validação e limites de operação

- Local: **123 testes raiz, 70 do bot, 25 cenários SQL**, typecheck, check do bot e build aprovados. Ensaio adicional das 22 tabelas aprovado. CI inclui ensaio PostgreSQL e regressão de navegador da dupla confirmação/contagem preservada; conferir o resultado do commit publicado antes de afirmar sucesso remoto.
- Produção: advisors e leitura pontual das definições antes da migration; instalação e uma consulta curta confirmaram `cleanup_ready`, `bulk_ready`, `backup_v2_ready` e `private` como true. Não chamamos cleanup/delete/backup para conferir instalação.
- Avisos de segurança existentes: tabelas privadas de outbox/snapshots têm RLS sem policy intencional; proteção de senhas vazadas permanece desativada no provedor. Orientação: [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- **P-19 continua aberto:** o guard antigo comprova arquivo no dia, não cobertura exata de cada registro apagado depois. A proteção financeira não depende dele. Também existe diferença UTC/fuso local. Não se alterou o cronograma do supervisor para gerar backups a cada limpeza, evitando aumentar carga/ingestão sem necessidade.
- Preservar vendas/histórico faz o banco crescer; acompanhar tamanho sob demanda e definir arquivamento financeiro separado antes de voltar a remover vendas automaticamente. Sem polling ou novo canal Realtime.
- Meta de Log Ingestion: 1GB. Nenhuma medição nova de quota, teste de carga, backup de produção ou mensagem real nesta rodada. Não há garantia de consumo dos processos que já estavam em execução.

Melhorias de navegação interna, indicação de dados desatualizados e edição em massa continuam opcionais; não foram misturadas a esta alteração de dados.
