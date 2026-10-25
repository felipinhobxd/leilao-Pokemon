# 15 — Horário comum, resultados e recuperação do backup

Atualizado em 2026-10-25. Implementação autorizada pelo operador; bot 0.2.7.

## Fluxo solicitado

O operador confirmou: a mensagem de encerramento da publicação sai **após a última carta ser publicada**, antes de fechar a janela de lances. Em uma fila com prazo 01:00 de Brasília:

```text
@all

LEILÃO FINALIZADO!

LANCES VÁLIDOS ATÉ 1H DA MANHÃ!
```

O horário é dinâmico. Depois do prazo, o banco fecha os leilões devidos e os resultados individuais saem com intervalo **mínimo de 15 segundos por grupo**; atraso de rede pode ampliar esse intervalo, nunca deve prolongar os lances. Sem Redis obrigatório. Mensagens de ARREMATE imediato continuam pelo caminho existente.

## Implementação

- Wizard: endMode/commonEndInput opcionais em rascunhos v1; novas filas começam em modo comum, próxima 1h; rascunhos antigos mantêm duração. Valida prazo após última publicação e até 7d. Revisão mostra data/hora de Brasília.
- API batch exige worker mais recente 0.2.7+ para prazo comum; usa create_auction_queue_with_deadline, preservando base/idempotência. Não aplicar novo comportamento a filas antigas automaticamente.
- Trigger preserva queue.ends_at em publicação efetiva, edição e retomada. Publicação atrasada para depois do prazo é recusada.
- Resumo entra na outbox somente quando a fila termina com todos os dispatches realmente sent e brindes com sent_at; fila com falha/cancelamento não anuncia publicação completa.
- finalize_due_auction_batch fecha até 200 devidos e registra resultados na mesma transação. Bot aguarda a fila de votos recebidos antes de finalizar. claim/finish usam locks, backoff, sent_at e intervalo persistente; reinício não esvazia a fila. MessageId estável mitiga duplicatas, sem garantia absoluta de exatamente uma entrega no WhatsApp.
- @all usa mentionAll nativo e valida metadata/permissão. Em grupos >32 o bot precisa ser admin. Falha de permissão mantém o aviso pendente. Se só conseguir enviar após o prazo, o texto informa que o prazo já encerrou.

## Backup

O caminho antigo devolvia um JSON enorme pela função Vercel e concentrava a exportação em um RPC. Foram observados 41.721 eventos nos últimos 7d, 1.022 comandos e 105 leilões/dispatches (apenas contagens, não dados em logs).

O novo caminho gera **um snapshot consistente** com JSON textual, divide-o em linhas de 262144 caracteres e devolve metadados pequenos. RPCs seguintes leem somente os blocos necessários, evitando repetir a descompressão de um TOAST de dezenas de MB. O snapshot e os chunks são service_role-only com RLS. Há uma preparação por vez, descarte ao terminar a leitura e recolhimento de sobras com mais de cinco minutos na próxima preparação. Timeout específico: preparo 55s/32MB, leitura 15s. Não elevar timeout global do projeto.

Servidor compacta JSON com Gzip, salva no bucket privado business-backups, caminho manual/backup-[admin].json.gz, e devolve link assinado de 120s. O browser baixa direto do Storage, evitando a resposta grande da Vercel. Cópia manual anterior .json é removida após a nova estar pronta (melhor esforço). A cópia automática da nuvem também usa .json.gz; o JSON no disco do bot continua normal. A exigência de backup diário para cleanup foi preservada e reconhece os dois formatos.

Mantém os filtros/limites do export existente: auditoria e cache de 7d, rascunhos 50 e quick polls 500, sem bytes de imagens/sessão. Não é validação de restauração nem correção da cobertura temporal P-19.

## Validação real e limites

Houve **cinco tentativas reais de exportação**, necessárias ao diagnóstico: duas falharam no caminho antigo, uma identificou timeout do preparo, duas concluíram. Não houve teste de carga repetitivo, limpeza de leilões, cancelamento ou publicação WhatsApp.

| Caminho validado | JSON original | Download | Tempo total observado |
|---|---:|---:|---:|
| Primeiro snapshot em blocos | 52.289.109 bytes | JSON normal | 100.964 ms |
| Blocos separados + Gzip | 52.289.109 bytes | 6.390.926 bytes | 71.447 ms |

O arquivo final foi baixado do Storage, descompactado e interpretado; 22 tabelas e chave da outbox presentes. Artefato do operador fora do Git: outputs/leilao-backup-2026-10-25T07-08-41-402Z.json.gz. Tem dados de negócio privados; não colocar no repositório. Snapshot/chunks temporários confirmados vazios no catálogo após o teste. Quatro migrations registradas com a mesma versão local: 20261025062419, 20261025065040, 20261025065722, 20261025070438. Totais: 65 arquivos / 73 registros remotos.

96 testes raiz, 62 bot, check/syntax (47 testes somados), typecheck, build e smoke HTTP sem login passaram. Os 20 cenários SQL passaram em PGlite descartável (UUID nativo sem pgcrypto); CI faz Postgres 17 real. Navegador local usou componentes reais com auth/dados simulados; nenhum envio real de @all/resultados. O supervisor e o filho precisam carregar 0.2.7; não foi iniciado segundo bot nem reiniciada sessão operacional.

## Erros do anexo e cota

O anexo trouxe 521/522 e timeout no endereço Supabase. Circuito de recuperação reduz consultas de fundo durante falhas; comandos de lance/participante e um backup legítimo ainda têm sua própria tentativa. AbortSignal cancela a requisição de heartbeat aos 10s; não deixa a Promise antiga em voo. Logs extraem título de HTML e limitam repetição a uma linha por escopo/minuto. Não desabilita auditoria/segurança e não promete uptime do provedor.

Última leitura do Dashboard: **Log Ingestion 0,88/1 GB**. É dado agregado/arredondado e sujeito a atraso; não mede o delta desta tarefa nem garante consumo futuro. Não repetir exportações para rever migrations já verificadas.

Referências: [limite de resposta da Vercel](https://vercel.com/docs/functions/limitations), [timeouts por função no Supabase](https://supabase.com/docs/guides/database/postgres/timeouts). O conector apply_migration retornou Unknown tool; instalação foi pelo SQL Editor com registro de histórico na mesma transação e verificações de catálogo/RLS/permissões. Advisors do conector já estavam indisponíveis; não houve novo laudo automatizado.
