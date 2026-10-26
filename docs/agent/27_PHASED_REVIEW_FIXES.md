# 27 — Correções da revisão em quatro fases

Autorização de 26/10/2026: **parar ao final de cada fase e pedir autorização antes da próxima**. Não iniciar fases seguintes por inferência deste documento.

| Fase | Escopo | Estado |
|---|---|---|
| 1 | Votos após falha temporária | Código implementado e RPC instalada; ativação completa requer carregar supervisor/filho 0.2.11. Processos reais preservados nesta fase. |
| 2 | Erro na consulta de grupo não pode virar brinde enviado | Autorizada e implementada em 26/10; bot 0.2.12 no disco, processos preservados. |
| 3 | Dois brindes pausados não podem bloquear os seguintes | Aguardando autorização. |
| 4 | Desbloquear com segurança criação pendente inexistente e recusada | Aguardando autorização. |

## Fase 1 — fila local durável

`bot/vote-inbox.mjs` guarda cada voto em arquivo antes de consultar o banco. `messages.upsert` persiste todos os votos do lote antes de encadear o processamento. O serializador preserva binários; protobuf Long do horário é normalizado uma vez, e um horário ausente recebe fallback fixo no recebimento. IDs de comando e horários não mudam durante a retentativa do mesmo registro.

- Pasta privada: `bot/data/vote-inbox/`, ou `BOT_DATA_DIR/vote-inbox/`, ignorada pelo Git. Contém metadados pessoais e payload de voto: não publicar os arquivos.
- Arquivo temporário exclusivo, fsync e rename. Pendentes voltam após reinício; confirmados saem da fila. Processamento pelo menos uma vez, com idempotência já existente no banco; não promete transação atômica entre disco/WhatsApp/Postgres.
- FIFO por **enquete**, inclusive entre participantes diferentes do quiz. Uma falha no primeiro acerto impede ultrapassagem; outras enquetes continuam. Não reconstrói ordem de cliques de eventos entregues fora de ordem pelo WhatsApp.
- Usa o ciclo de 5s existente. Até oito tentativas, com backoff de 5/10/20/40/80/160s e teto de 300s. Sem falha, não acrescenta consulta de negócio por voto. Não cria timer, polling ou tabela de logs novos.
- Enquete ainda em publicação aguarda registro por até 30min sem gastar tentativas de rede. O Map volátil anterior foi substituído pela fila persistente.
- Falha persistente, identidade conflitante/não resolvida ou recusa de negócio após retentativa deixam registro para revisão e retêm a enquete afetada. Descriptografia inválida vira quarentena visível **não bloqueante**, para um pacote malformado não paralisar outros votantes.
- Limites: 5.000 registros, orçamento de 16MiB com reserva de metadados e envelope de até 60KB. Nenhum pendente/revisão antigo é descartado para abrir espaço. Capacidade esgotada conserva o primeiro excedente em `attention.json` e suspende processamento/resultados até revisão. Eventos adicionais além do limite não têm garantia de retenção; a ocorrência exige conferência.
- Arquivo ilegível, identidade inconsistente ou temporário órfão indicam estado incompleto e suspendem processamento/resultados. Falha de gravação mantém o evento em memória e não chama seu RPC antes de persistir. Não protege contra perda física do PC/disco ou reinício enquanto nenhuma gravação é possível.

## Prazo e finalização

Nova RPC **`finalize_due_auction_batch_guarded(uuid,text[],timestamptz)`**: SECURITY INVOKER, search_path vazio, EXECUTE apenas para service_role e validação de administrador/operator ativo. Exclui até 5.000 IDs de enquetes com votos sem confirmação, por `auctions.poll_id` ou IDs canônico/remoto do dispatch. Leilões independentes continuam sendo finalizados.

Não altera `scheduled_end_at`, não aceita lance vencido e não reabre venda/leilão. Retentativa recusada após vencer o prazo fica para revisão. O corte observado de pelo menos 5s antes da consulta, limitado também pelo relógio do banco, impede incluir automaticamente uma disputa recém-vencida fora da janela conferida pelo bot. Esse atraso de apuração não estende o prazo de lances. Outbox e intervalo de 15s entre resultados mantidos.

O bot novo sempre usa a RPC protegida, inclusive sem pendentes. A função anterior permanece para compatibilidade com o processo já carregado. Ações explícitas de finalização no painel continuam sob responsabilidade do operador; apenas a automação usa o filtro local.

Migration criada pela CLI e renomeada para o registro efetivo: **20261026165459_guard_finalization_for_pending_votes.sql**, instalada no projeto `gsyuoggymjdzxibfujyv`. **75 arquivos locais/83 registros remotos**, divergências históricas preservadas. Catálogo confirmou argumentos, invoker, search_path e grants. Nenhuma finalização de produção foi executada para testar a instalação.

## Diagnóstico, ativação e revisão

O marcador `__LEILAO_VOTES__` leva apenas contagens/estado do filho ao supervisor, que as inclui no heartbeat existente quando mudam. `/api/operations` retorna campos permitidos; o cartão **Proteção dos votos** mostra pendências/revisões, sem voto bruto, telefone, caminho ou erro sensível. Consulta somente ao clique, sem Realtime adicional.

**Bot no disco: 0.2.11. Supervisor e filho ativos não foram reiniciados nesta fase.** Ativação completa exige reinicialização planejada dos dois, sem disputa ativa. Reinício automático do filho lê arquivos novos, mas supervisor antigo não publica a telemetria nova. Não declarar versão carregada só pela edição do package.json; não iniciar outra instância ou apagar credenciais.

Revisões não são reprocessadas/excluídas automaticamente. Antes de decidir um resultado: preservar cópia da pasta, conferir evento/horário/participante com o grupo e banco e autorizar uma recuperação específica. Não editar/apagar JSON ou `attention.json` no processo ativo, nem aceitar lance vencido por inferência. Backup de negócio não inclui essa fila local do PC.

## Validação e custo

- **150 testes raiz, 88 bot**, check do bot, typecheck, build e smoke de autenticação locais aprovados.
- **31 cenários SQL descartáveis**, incluindo guardas direto/canônico/remoto, fechamento independente, aviso não antecipado, liberação, corte observado, idempotência e privilégios.
- Pipeline real testado sem iniciar index.mjs: primeiro acerto com falha e segundo acerto posterior; resposta perdida após commit; erro de lance; publicação ainda não pronta; recusa após prazo; decisão da finalização. Testes de disco cobrem ordem, reinício, binários, limites, escrita e arquivos incompletos. CI ampliada com diagnóstico/acessibilidade em desktop/celular; conferir resultado do commit final.
- Primeira CI: os **42 testes de navegador passaram em 44,1s**, mas instalação do Chromium + execução ultrapassaram o teto conjunto de 10min. Separados os passos: instalação até 15min, testes mantêm 10min. Não relaxa timeout de caso nem remove verificação. Conferir nova CI do ajuste.
- Supabase: metadados pontuais, instalação e advisors antes/depois. Sem logs detalhados, backup grande, carga, limpeza, mensagem ou reinício. Meta de Log Ingestion 1GB mantida, sem nova medição/garantia do consumo ativo. Advisors sem novidade: quatro INFO de tabelas privadas ([RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)) e WARN preexistente de [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Fase 1 publicada: CI [40366389765](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40366389765) e deployment aprovados. Fase 2 autorizada explicitamente em 26/10/2026.

## Fase 2 — confirmação real de publicação

`sendDueQuickPolls()` verifica o erro da consulta do grupo. Grupo ausente/inativo/sem destino e opções insuficientes continuam **pendentes**, sem gravar `sent_at` fictício. Exigem corrigir a configuração ou cancelar o item; a fila não deve concluir alegando publicação inexistente. O painel continua mostrando o agendamento pendente, sem novo estado persistido de erro nesta fase.

Envio só é tentado com socket pronto. Uma falha fica isolada ao item e permite tentar o outro já selecionado. A seleção de dois itens antes do filtro de pausa continua sendo a **fase 3**, ainda não autorizada; dois itens permanentemente inválidos também podem reter essa janela até correção/cancelamento.

Após confirmação do socket, o UPDATE retorna `id,sent_at,poll_message_id` na própria resposta. Zero linhas, resposta incompatível ou erro não ativam o cache de votos nem anunciam sucesso local. Se o UPDATE acusa erro, uma leitura pontual tenta confirmar se ele foi efetivado apesar da resposta perdida. Só libera votos se encontrar o mesmo ID de mensagem e `sent_at` preenchido. Se ambas as respostas falharem após um commit, a confirmação continua inconclusiva: conferir antes de intervir, sem apagar a fila local de votos ou republicar manualmente por inferência.

IDs determinísticos de anúncio/enquete, segredo da enquete, serialização e fila durável da fase 1 preservados. IDs estáveis reduzem o risco de repetição; não representam garantia transacional entre WhatsApp e banco. Não reconstrói automaticamente brindes historicamente marcados como enviados pelo código antigo.

- **Bot 0.2.12 no disco**; supervisor/filho em execução preservados. Ativação completa das fases 1/2 exige reinício planejado de ambos, sem disputa ativa.
- Sem migration, alteração de dados reais, backup, mensagem de teste real ou nova consulta periódica. UPDATE confirma na mesma requisição; leitura adicional apenas quando sua resposta falha. Reporter existente limita esse escopo a uma linha local/minuto. Sem nova medição/garantia do consumo do Supabase.
- **20 testes novos** executam a função real com fronteiras de rede simuladas: falhas de consulta/envio/gravação, zero linhas, confirmação perdida/recuperada, retentativa com os mesmos IDs/segredo, opções inválidas, pausa, socket desconectado e compatibilidade com brindes antigos. Incluídos no `check` do bot/CI.
- Validação local: **150 testes raiz e 108 testes do bot**, check do bot, typecheck, build e smoke de autenticação aprovados. Dois testes usam o cliente Supabase instalado com transporte local simulado e conferem o retorno da atualização na mesma requisição. Sem alteração de SQL/UI; a CI completa também verifica essas áreas antes de encerrar a fase.

Ao concluir publicação/CI, **parar e pedir autorização para a fase 3**. Fase 4 também requer autorização própria.
