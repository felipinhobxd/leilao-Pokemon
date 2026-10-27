# 27 — Correções da revisão em quatro fases

> Revisão real posterior: [28_LIVE_END_TO_END_AUDIT.md](28_LIVE_END_TO_END_AUDIT.md). Bot 0.2.14 ativado e conectado; testes reais de publicação, votos, quiz/brinde, encerramento, arremate, backup e Excel concluídos. Correção de retirada vencida, 169 testes raiz/118 bot/31 SQL. As instruções anteriores de preservar processos/aguardar ativação são histórico; ver limites de relógio e quota no documento 28.


Autorização de 26/10/2026: **parar ao final de cada fase e pedir autorização antes da próxima**. Não iniciar fases seguintes por inferência deste documento.

| Fase | Escopo | Estado |
|---|---|---|
| 1 | Votos após falha temporária | Código implementado e RPC instalada; ativação completa requer carregar supervisor/filho 0.2.11. Processos reais preservados nesta fase. |
| 2 | Erro na consulta de grupo não pode virar brinde enviado | Autorizada e implementada em 26/10; bot 0.2.12 no disco, processos preservados. |
| 3 | Dois brindes pausados não podem bloquear os seguintes | Autorizada e implementada em 26/10; bot 0.2.13 no disco, processos preservados. |
| 4 | Desbloquear com segurança criação pendente inexistente e recusada | Autorizada e implementada em 26/10; alteração no painel, bot 0.2.13 preservado. |

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

Envio só é tentado com socket pronto. Uma falha fica isolada ao item e permite tentar o outro já selecionado. A seleção de dois itens antes do filtro de pausa foi corrigida na **fase 3**, autorizada posteriormente; dois itens permanentemente inválidos continuam podendo reter essa janela até correção/cancelamento.

Após confirmação do socket, o UPDATE retorna `id,sent_at,poll_message_id` na própria resposta. Zero linhas, resposta incompatível ou erro não ativam o cache de votos nem anunciam sucesso local. Se o UPDATE acusa erro, uma leitura pontual tenta confirmar se ele foi efetivado apesar da resposta perdida. Só libera votos se encontrar o mesmo ID de mensagem e `sent_at` preenchido. Se ambas as respostas falharem após um commit, a confirmação continua inconclusiva: conferir antes de intervir, sem apagar a fila local de votos ou republicar manualmente por inferência.

IDs determinísticos de anúncio/enquete, segredo da enquete, serialização e fila durável da fase 1 preservados. IDs estáveis reduzem o risco de repetição; não representam garantia transacional entre WhatsApp e banco. Não reconstrói automaticamente brindes historicamente marcados como enviados pelo código antigo.

- **Bot 0.2.12 no disco**; supervisor/filho em execução preservados. Ativação completa das fases 1/2 exige reinício planejado de ambos, sem disputa ativa.
- Sem migration, alteração de dados reais, backup, mensagem de teste real ou nova consulta periódica. UPDATE confirma na mesma requisição; leitura adicional apenas quando sua resposta falha. Reporter existente limita esse escopo a uma linha local/minuto. Sem nova medição/garantia do consumo do Supabase.
- **20 testes novos** executam a função real com fronteiras de rede simuladas: falhas de consulta/envio/gravação, zero linhas, confirmação perdida/recuperada, retentativa com os mesmos IDs/segredo, opções inválidas, pausa, socket desconectado e compatibilidade com brindes antigos. Incluídos no `check` do bot/CI.
- Validação local: **150 testes raiz e 108 testes do bot**, check do bot, typecheck, build e smoke de autenticação aprovados. Dois testes usam o cliente Supabase instalado com transporte local simulado e conferem o retorno da atualização na mesma requisição. Sem alteração de SQL/UI; a CI completa também verifica essas áreas antes de encerrar a fase.

Fase 2 publicada: commit `f976ab4f`, [CI 40409811880](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40409811880) e deployment aprovados. A fase 3 recebeu autorização explícita depois dessa conclusão.

## Fase 3 — filas pausadas fora da seleção

`sendDueQuickPolls()` agora exclui enquetes associadas a filas pausadas **no servidor, antes de aplicar o limite de dois**. Usa a relação vazia `paused_queue:auction_publish_queues()`, filtra essa relação por `status=paused` e exige sua ausência (`paused_queue is null`), conforme o [anti-join documentado pelo PostgREST](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html#null-filtering-on-embedded-resources). A relação original `queue(status)` permanece disponível e mantém a checagem defensiva local.

Brindes avulsos (sem fila) continuam elegíveis. Mantidos `sent_at is null`, prazo já vencido e ordem por `scheduled_at`; o ID desempata horários iguais. Não aumenta o limite, não pagina em loop nem baixa todos os pausados. Uma consulta de seleção por ciclo existente de 5s, com no máximo dois itens retornados. Sem migration, RPC nova, alteração de políticas ou gravação de teste no Supabase.

A pausa é observada no snapshot da seleção; esta correção não cria claim distribuído nem transação entre WhatsApp e banco para uma pausa concorrente posterior. Não muda reagendamento ao retomar, IDs/segredo de mensagem, confirmação de publicação da fase 2, fila durável de votos da fase 1, prazo dos lances ou intervalo dos resultados. Configurações inválidas permanecem pendentes e exigem correção/cancelamento pelo operador, como descrito na fase 2.

- **Bot 0.2.13 no disco**; supervisor e filho ativos não foram reiniciados. Ativação completa das fases 1–3 exige carregar os dois em reinício planejado, sem disputa ativa.
- **Quatro testes novos**, além dos 20 da fase 2: dois pausados antes de quiz ativo/brinde avulso; 1.001 pausados antes de um elegível; todos pausados e posterior retomada; prazo/envio anterior/desempate/limite de dois. O cliente Supabase real com transporte simulado também confere o alias e filtros serializados na URL REST.
- Consulta real somente de leitura no projeto `PokemonLeilao`, reproduzindo a seleção do código: API aceitou o filtro e retornou **zero registros** no momento da verificação. Não houve dados pendentes reais para demonstrar o bloqueio; a regressão e a retomada foram verificadas com dados fictícios nos testes.
- **150 testes raiz, 112 testes do bot**, check do bot, typecheck, build e smoke de autenticação locais aprovados. Conferir CI completa e deployment do commit final antes de encerrar a fase.
- Sem mensagem real, backup, logs detalhados, consulta periódica adicional ou novo timer. Uma leitura pontual de validação na produção; consumo de Log Ingestion não medido e sem garantia sobre o bot em execução.

Fase 3 publicada: commit `afaf7371`, [CI 40410780296](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40410780296) e deployment aprovados. A fase 4 recebeu autorização explícita depois dessa conclusão.

## Fase 4 — recusa definitiva libera edição com proteção contra duplicação

Os cadastros **em lote e individual** usam `lib/auction-creation.ts` para confirmar a mesma operação. A tentativa incerta mantém ID, payload e horário congelados. Ao confirmar, a recuperação existente é consultada primeiro; se houver criação, ela é exibida sem outro POST. Se estiver ausente, o mesmo POST é repetido.

Respostas 400/409/415/422 só liberam edição depois de **outra recuperação bem-sucedida, após a recusa, retornar `data: null`**. Se essa consulta encontrar um resultado, ele é recuperado. Erros de rede, 5xx, 408/429, sessão/permissão indisponível, JSON inválido, recuperação malformada ou sucesso sem o identificador esperado continuam pendentes. O painel não deduz ausência de uma consulta que falhou nem anuncia sucesso sem ID.

Depois da recusa confirmada, os campos são liberados e a mensagem pede revisar os dados. O ID permanece o mesmo, inclusive após recarregar a página: o registro da sessão passa a `editable: true`, e deixa de representar confirmação pendente. Um novo envio congela novamente o payload sob esse ID; sucesso confirmado remove o registro. A identidade da operação fica limitada ao usuário, modalidade e sessão/aba atuais. Se o navegador bloquear o armazenamento, somente o estado em memória é preservado.

A recuperação de sessão restaura campos a partir do payload salvo: cartas/ordem, URLs já enviadas, valores e valores personalizados, opções/resposta/pergunta do quiz, grupo, intervalo e horários em Brasília. Após recarregar, o agendamento original é mostrado explicitamente; horários vencidos precisam ser revisados ou trocados para Agora depois do desbloqueio. Arquivos locais/blob e metadados que não entravam no payload enviado (como campos extras do brinde) não são reconstruídos. Não é um salvamento automático das edições posteriores à recusa; o rascunho e a proteção de navegação continuam necessários.

A RPC existente `recover_auction_creation` já usa o mesmo advisory lock por evento e confere o operador. Nenhuma alteração de SQL, auth, RLS ou migration nesta fase. Mesmo para uma requisição antiga excepcionalmente atrasada, a nova tentativa no formulário preserva o ID e continua sujeita à idempotência/conflito de payload no banco. Não promete transação entre navegador, requisições e WhatsApp.

- **19 testes novos de unidade/integração local**: recusa inicial e após incerteza, ausência confirmada, commit encontrado antes/depois da recusa, consulta indisponível/malformada, resposta perdida, mesmo ID/payload/horário, restauração de preços/cartas/jogo e sessão editável.
- **Sete cenários novos de navegador**, executados em desktop e celular: lote/individual com e sem recarregamento, nova recarga após desbloquear, correção e reenvio com o mesmo ID; recuperação indisponível mantém proteção; cadastro individual salvo com resposta perdida é recuperado sem novo POST. Cenário equivalente do lote já existia e permanece.
- Validação local: **169 testes raiz**, check do bot, typecheck, build e smoke de autenticação aprovados; conferir CI/deployment final. Bot continua **0.2.13**; código e processos reais do bot preservados nesta fase. Não houve mensagem ou criação real para testar.
- Consultas de recuperação somente por ação explícita: uma antes de repetir operação incerta e uma após recusa de validação. Nenhum timer/polling novo, backup ou leitura de logs de produção. Não mede nem garante o consumo ativo de Log Ingestion.

**As quatro fases de código ficam concluídas após a CI desta publicação.** Parar, apresentar resultados e pendências de ativação. O supervisor/filho das fases anteriores ainda precisam carregar a versão nova em reinício planejado, sem disputa ativa; não iniciar outra fase ou reiniciar processos automaticamente.
