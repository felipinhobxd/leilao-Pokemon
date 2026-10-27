# 31 — Fase 2: restauração de backup real em banco isolado

Autorizada pelo operador em 27/10/2026, após apresentação da fase 1. **Dados restaurados e conferidos com sucesso**. Esta fase não autoriza iniciar a fase 3 automaticamente.

## Origem e isolamento

Foi usada a cópia privada já baixada `bot/backups/audit-manual-download-20261026.json.gz`, sem gerar outro backup ou acessar Supabase. Snapshot exportado em **26/10/2026 às 21:24:41.816723 (Brasília)**. Não contém alterações posteriores, incluindo os lotes de reinício da fase 1.

SHA-256 comprimido: `34e12636d24d7a3422f598bfcdfed0b7e682e967d00c0db592ba029b6327daf8`. Pacote e hashes verificados pela ferramenta existente. Destino privado e ignorado pelo Git: `recovery-packages/phase2-20261027-manual/`. Contém dados pessoais: não publicar o JSON, SQL de recuperação ou manifesto.

Restauração executada com **PGlite local/embutido**, sem URL de banco ou conexão de rede, usando bootstrap de teste, schema, bridge e as **75 migrations locais** em ordem. O SQL gerado pela ferramenta criou apenas o staging `leilao_recovery` nessa instância descartável. A instância foi fechada ao terminar; não foi promovida para produção.

Nenhuma migration aplicada em produção, envio de WhatsApp, backup remoto, download de imagens ou chamada ao Supabase nesta fase. Não se mediu quota/delta de Log Ingestion. Não houve início, parada ou reinício do bot. A leitura local inicial não localizou processos `service.mjs`/`index.mjs`; isso não foi causado pelo ensaio e não se afirma bot conectado nesta fase.

## Resultado do backup real

**29.927 registros nas 22 tabelas**. Comparadas todas as linhas e todos os campos por serialização canônica, preservando arrays e valores; hashes iguais para cada tabela. Comparação em UTC para igualar a representação do backup, preservando microssegundos. A diferença preliminar de fuso local/UTC representava os mesmos instantes, não perda de dados.

| Tabelas principais | Registros |
|---|---:|
| Cartas / leilões / compras / entregas | 3 / 3 / 3 / 3 |
| Participantes / identidades | 188 / 376 |
| Lances / alterações de valor | 7 / 4 |
| Eventos de leilão / comandos processados | 28.521 / 716 |
| Grupos / filas / dispatches | 38 / 2 / 3 |
| Estado dos votos / jogos / rascunhos / avisos | 3 / 4 / 1 / 5 |
| Advertências por participante / notificações admin | 40 / 7 |
| Pagamentos / lembretes / warnings legados | 0 / 0 / 0 |

- **35 chaves estrangeiras de negócio restauradas e validadas**, mesmo total do schema de origem; nenhuma referência de negócio inválida na restauração.
- Zero gatilhos de negócio no staging: restaurar não agenda nem envia mensagens.
- RLS habilitada em todas as tabelas copiadas, sem USAGE do schema ou permissões de leitura/escrita para anon/authenticated.
- Conteúdo das tabelas públicas da instância de teste preservado pela recuperação; nenhum acesso ao banco real.
- Segunda execução recusada porque o schema já existe; nenhum overwrite do staging.

Relatório privado local: `recovery-packages/phase2-20261027-manual/restore-verification.json`, com contagens, hashes por tabela e `ok: true`. Arquivos `preliminary-timezone-*` documentam a comparação preliminar de fuso e não são o resultado final. O verificador usado fica na pasta de trabalho da sessão, `work/pg-queue-test/phase2-real-restore.mjs`, fora do repositório.

## Complemento automatizado e limites

Como o snapshot real tem pagamentos e lembretes vazios, esses casos são cobertos separadamente pelo ensaio fictício existente `scripts/test-recovery-drill.mjs`: venda de 100 com pagamento parcial de 25, entrega e lembrete vinculados, Unicode, rascunho e quiz com resposta/ganhador. O check foi ampliado para verificar FKs validadas, RLS/permissões em todas as tabelas, ausência de gatilhos de negócio, recusa de overwrite e comparação em UTC. CI executa esse SQL em **PostgreSQL 17 isolado**. Conferir o resultado do commit publicado antes de afirmar execução remota aprovada. Cinco testes locais do empacotador passaram; syntax check aprovado. Nenhum código de runtime do painel/bot foi alterado.

O pacote referencia **179 URLs de imagens**, mas não inclui os bytes: `images_complete: false` é esperado e a CLI sinaliza incompletude. Os dados/URLs foram restaurados; não foi testada reposição ou disponibilidade das fotos. Auth/senhas, chaves, sessão do WhatsApp, worker e infraestrutura continuam fora do backup de negócio. Este resultado não é uma recuperação integral da instalação nem garante o conteúdo que já estava ausente do snapshot.

**Fase 2 concluída para os dados do snapshot. Parar, apresentar resultado e pedir autorização para a fase 3: verificar a limpeza de 12h com cobertura de backup, começando em ambiente isolado.**
