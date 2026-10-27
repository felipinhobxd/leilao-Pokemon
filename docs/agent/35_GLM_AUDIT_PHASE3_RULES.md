# 35 — Auditoria GLM, fase 3: regras escolhidas pelo operador

Decisões explícitas de 27/10/2026: primeiro acerto ganha brinde/quiz sem exigir compra; lance comum só pode ser retirado até um minuto após o lance; fila com cartas não publicadas anuncia o prazo quando não houver mais itens pendentes, informando as falhas. Arremate imediato continua definitivo.

## Retirada: contrato do banco e do bot

`BID_WITHDRAWN` recusa com `withdrawal_window_expired` quando o instante do evento excede o instante do lance ativo em mais de 60 segundos. Exatamente 60 segundos é permitido, desde que os guards existentes de leilão aberto, horário final, participante elegível e ordem dos eventos também permitam. Usa `bids.whatsapp_event_at`, ou `processed_at` em dados legados. O comando sem `occurredAt` usa o relógio do servidor; o bot envia o instante original do voto.

Uma troca aceita cria um novo lance e inicia uma nova janela de um minuto. A alteração de valor continua permitida pelas regras existentes; esta decisão restringe a retirada, não altera o tratamento de reduções, avisos ou critério de vencedor. O tempo de recebimento do evento é preservado em retentativas, sem renovar o minuto ao reprocessar. O corte final do leilão continua validado pelo relógio do servidor: processamento após o encerramento não reabre a disputa.

A migration insere a verificação apenas no ramo de retirada do comando instalado, conferindo a presença única do marcador antes de substituir a definição. Mantém guards, locks, cache de comandos, regras financeiras e demais ramos da versão instalada. Recusa não grava sucesso em `processed_commands`, não muda o lance e não gera cobrança nova. Replay de uma retirada já aceita continua retornando seu resultado idempotente.

O bot reconhece a recusa de um minuto, grava `BID_WITHDRAWN_AFTER_WINDOW` com auditoria confirmada e preserva o estado do lance aceito. Falha da auditoria continua pendente; resposta perdida pode ser reconhecida pelo readback da fase 1. A API do painel traduz a recusa em mensagem clara. Arremate permanece sem retirada, inclusive dentro do primeiro minuto.

## Brinde, quiz e texto das regras

O primeiro acerto confirmado continua premiado sem exigir compra: o RPC já aplicava essa regra e não foi alterado. Testes explicitam os dois tipos sem compras anteriores, o vencedor único e a ausência de cobrança. Participantes banidos/inelegíveis continuam bloqueados pelos guards existentes.

O texto padrão deixou de prometer elegibilidade por compra e passagem ao próximo comprador. Explicita o minuto do último lance comum aceito e que arremate é definitivo, sem a antiga promessa de cancelar arremate em um minuto. Na conferência local não havia `rules-message.json` privado sobrescrevendo o padrão; nenhum override personalizado foi apagado/criado. Edições futuras de override continuam sendo responsabilidade da operação e podem substituir o texto padrão.

## Conclusão parcial da fila

O trigger aceita dispatches terminais `sent/failed/cancelled`, exige todos os jogos enviados e a contagem total dos itens. Havendo ao menos um item publicado, enfileira um único `queue_finished` com prazo comum e contagens `published_count`, `failed_count`, `cancelled_count`, `not_published_count`.

O bot acrescenta “X cartas não foram publicadas. O prazo vale apenas para as cartas publicadas.”, com singular quando necessário. Mantém @all nativo ou o fallback autorizado na fase 2. Aviso atrasado continua dizendo que o prazo já encerrou; não amplia o corte. Resultados individuais mantêm o espaçamento de 15s.

Não anuncia fila pausada/cancelada, com pendências, contagem incompleta ou zero itens publicados. Não transforma falhas em sucesso, não reenfileira cartas e não retroage sobre filas já concluídas. A instalação não dispara mensagens de publicações antigas. Avisos preexistentes mantêm seu payload; não são reescritos.

## Migration e operação

Arquivo `20261027163530_auction_withdrawal_minute_and_partial_queue_notice.sql`, criado pela CLI e renomeado para a versão efetivamente registrada pelo conector no projeto `gsyuoggymjdzxibfujyv`. **76 arquivos locais / 84 registros remotos**. Catálogo confirmou os dois novos ramos, SECURITY INVOKER, privilégios públicos revogados e execução para service_role. Histórico antigo divergente preservado; não foi executado repair/db push geral.

Instalada após aprovação dos testes SQL locais em banco descartável; timeout de lock/statement limita espera da alteração. Não houve lance, publicação, limpeza, backup ou download de imagem em produção para testar. Apenas consultas pequenas de catálogo e aplicação da migration; sem consulta pesada de logs ou aumento de polling. O consumo atual de Log Ingestion não foi medido nem se garante o limite mensal.

Bot **0.2.18 no disco, não ativado**. Não havia processo local do bot em execução na conferência anterior à instalação; nenhum foi iniciado/reiniciado. O banco já impõe a nova regra. Antes de voltar a operar o WhatsApp, iniciar a versão atual, que reconhece essa recusa; não executar uma cópia antiga do bot contra o novo contrato.

## Evidências

- **171 testes raiz**, **141 testes bot** e typecheck aprovados localmente.
- **34 arquivos de teste SQL** aprovados em PostgreSQL isolado via PGlite, após aplicar schema/bridge e todas as migrations. Extensão pgcrypto omitida apenas nesse ambiente conforme harness anterior; CI PostgreSQL 17 mantém o caminho completo.
- `withdrawal-minute.sql`: 59,999s, 60s, 60,001s; replay; preservação do lance recusado; relógio do servidor; fallback legado; mudança aceita reiniciando janela; corte do leilão e privilégios.
- `partial-queue-notice.sql`: falha/cancelamento individual, todos falhados, fila pausada/cancelada, contagem incompleta, jogo pendente, prazo mantido e idempotência do resumo. `poll-game.sql` explicita quiz/brinde sem compra.
- Pipeline real com inbox isolada: recusa de um minuto e resposta perdida da auditoria, sem apagar lance nem deixar bloqueio indevido; formatter parcial exercitado com fallback de @all.
- Novos arquivos SQL incluídos na CI. Conferir banco, concorrência, restauração, navegador, build e deploy do commit final antes de anunciar aprovação remota.

**Parar e perguntar antes de outra fase.** Conflitos de identidade e redução do piso de polling continuam separados; nenhuma fusão automática ou alteração nesses fluxos foi feita aqui.
