# 17 — Quiz e brindes com vencedor (0.2.9)

Pedido autorizado em 2026-10-25: uma única opção correta, escolhida pelo operador, nos brindes; modo Quiz separado, na mesma área e dentro da fila de leilões. Primeiro acerto confirmado ganha a carta, como arremate.

## Uso

- `/auctions/brinde`: selecionar Brinde ou Quiz, nome da carta/prêmio, opções e única resposta correta. Quiz também exige pergunta. Foto por URL HTTPS opcional, grupo e agendamento em Brasília. Bot 0.2.9+ exigido pela API.
- Cadastro em lote: botões Brinde e Quiz em cada carta; ambos ocupam uma posição de publicação e não geram leilão, cobrança ou número de lote. Em Valores, o operador configura pergunta/opções/resposta. Rascunhos v1 preservam os novos campos. Alterar opções limpa a seleção correta, exigindo revisão. Copiar configurações inclui tipo/pergunta/resposta.
- Leilões mantêm seu encerramento comum ou individual. Jogos terminam no primeiro acerto; fila só de jogos não pede horário de encerramento de lances.
- Mensagem: `🎉 Parabéns, Maria, você acertou e ganhou Pikachu ex!`. Se o JID for resolvido, adiciona a menção real ao vencedor. Nome e carta vêm do resultado persistido, não do último voto recebido.
- Enquetes antigas continuam `legacy`, sem apuração retroativa. Rascunhos antigos de brinde precisam de seleção explícita da resposta para publicação pelo novo fluxo.

## Banco e segurança

Migration CLI `20261025080442_quick_poll_prizes_and_quiz.sql`, instalada pelo SQL Editor autenticado com versão/nome/source na mesma transação. Catálogo: game_ready/answers_private/award_private=true e registered=1. Total atual **67 migrations locais / 75 registros remotos**; não reparar histórico divergente automaticamente.

`whatsapp_quick_polls` ganha game_kind/correct_index/prize_name, mensagem original criptográfica e resultado (winner_participant_id/name/event_id/won_at). RLS mantida; SELECT direto de authenticated revogado para não expor resposta e chave de enquete. Leituras do painel seguem via API autenticada/service_role e não retornam resposta ou chave. Criação exige admin/operator e valida grupos, opções distintas e uma resposta dentro do intervalo.

RPCs service-only, security invoker/search_path vazio: validate_poll_game, create_quick_poll_game, create_auction_queue_with_games e claim_quick_poll_prize. Wrapper preserva limite 200, ordem, pausa, idempotência e horário dos leilões; usa a criação transacional existente. Standalone serializa por eventId, retorna anterior para retry idêntico e rejeita conflito, inclusive horário/imagem. UI mantém o mesmo ID/payload após falha incerta.

`claim_quick_poll_prize` bloqueia a linha da enquete. Exige enquete publicada, alternativa correta, participante ativo/sem suspensão e grupo ativo. Primeiro vencedor confirmado fica fixo: troca, retirada, voto atrasado ou replay não transferem prêmio. winner_event_id conserva encerramento mesmo se o cadastro do vencedor for removido. Grava resultado, um evento de auditoria e um aviso de entrega durável na mesma transação; sem purchases/payments/deliveries.

Backup inclui novos campos e avisos; limites de cobertura/500 enquetes anteriores continuam. Não foi gerado backup grande nesta tarefa.

## Bot

Mesma descriptografia Baileys dos leilões, com checagem do grupo. Mensagem original e secret são persistidas antes de liberar votos pendentes. Pendências de publicação entram na fila serial de votos para não serem ultrapassadas por votos novos durante a confirmação. Poll de seleção única; payload com zero, múltiplas opções, hash desconhecido ou resposta errada não disputa o prêmio.

Cache limitado a 200 enquetes; carregamento após reinício usa o banco. Depois de confirmar vencedor, votos adicionais nessa enquete são ignorados pelo cache. Votos incorretos não fazem RPC de prêmio nem geram eventos de auditoria. Não há novo timer ou polling. Claim do prêmio recebe uma tentativa própria em indisponibilidade, como lances essenciais, sem replay automático de escrita.

Outbox existente ganha tipo quick_poll_winner/quick_poll_id com índice único por enquete. O anúncio só é marcado entregue após ACK; falha/reinício mantém pendência e ID de mensagem estável. Isso mitiga duplicatas, não oferece exactly-once no WhatsApp.

## Validação e limites

- 105 testes raiz, 68 do bot; typecheck/build/check/smoke incluindo GET/POST quick-polls.
- 22 cenários SQL no PGlite descartável: respostas erradas, bloqueio de participante, vencedor fixo, retry, aviso único, permissões e fila mista. CI também executa disputa em oito conexões PostgreSQL reais (`concurrency-quiz.py`) e mantém as disputas de arremate existentes; consultar resultado da CI após push.
- Componentes reais com API/auth de demonstração no harness local: cadastro avulso e em lote, seleção correta e avanço de etapas; axe WCAG A/AA sem violações nas telas verificadas. Nenhuma mensagem, prêmio real, leilão ou participante de produção criado durante testes.
- “Primeiro” segue a primeira resposta correta confirmada no banco, como o arremate. Atrasos de WhatsApp/rede e indisponibilidade podem alterar ordem de chegada; não promete identificar o clique físico mais antigo entre dispositivos desconectados.
- Sem consultas de logs, carga de votos em produção ou backup grande. Franquia de Log Ingestion continua uma restrição; último valor observado antes desta tarefa era 0,88/1GB, arredondado e atrasado, sem garantia de consumo futuro.

Reabrir supervisor/filho para carregar **0.2.9**. A API bloqueia novos jogos com worker anterior; enquetes antigas não são convertidas em jogos automaticamente.
