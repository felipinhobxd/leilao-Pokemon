# 06_WHATSAPP_BOT — Worker Baileys (bot/)

> Estado atual consolidado: [19_SETTLEMENT_PROTECTION_AND_RECOVERY.md](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md) e [18_RELIABILITY_AND_UI_REVIEW.md](18_RELIABILITY_AND_UI_REVIEW.md), bot 0.2.10, Next.js 16.4.3. Seções de versões anteriores abaixo são histórico; não reaplicar migrations ou instruções antigas automaticamente.


> Área: Bot WhatsApp
> Escopo: Supervisor, filho Baileys, fila, votos, avisos, sessão, segurança
> Última atualização: 2026-10-25
> Fonte principal: `bot/service.mjs`, `bot/index.mjs`, `bot/queue-worker.mjs`, `bot/poll-votes.mjs`, `bot/poll-identities.mjs`, `bot/warning-notify.mjs`, `bot/session-guard.mjs`, `bot/group-participants.mjs`, `bot/format.mjs`, `bot/dispatch-id.mjs`, `bot/instrument.mjs`, `bot/sync-groups.mjs`, `bot/package.json`, `.github/workflows/ci.yml`

## Arquitetura do processo

- **`service.mjs` (supervisor, Node 24, Windows)**: único ponto de entrada (`npm --prefix bot start` = `node --env-file=.env service.mjs`; também spawnado por `scripts/start-all.mjs`).
  - Exige env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_ADMIN_USER_ID`.
  - Cria seu próprio client Supabase; **não** tem socket do WhatsApp.
  - Ciclos: heartbeat (10–15s) em `whatsapp_bot_workers` (status/QR/expiração → painel); poll de `whatsapp_bot_commands` (5s); **limpeza 12h** (`cleanup_old_auctions`, no máximo 1x/hora; timer de verificação 10min); **restart noturno** (`BOT_NIGHT_RESTART_HOUR` default 4h05 — mata o filho, exit handler reinicia em 5s).
  - Spawn do filho com `--max-old-space-size=384` (RAM era 1,8–2 GB ocioso; V8 não devolvia ao Windows).
  - Shutdown limpo (SIGINT/SIGTERM): para filho, limpa timers, publica estado `disconnected`.
- **`index.mjs` (filho Baileys)**: conecta a sessão (`./sessao`, multi-file auth), processa eventos, publica dispatches, finaliza leilões, drena notificações de admins.
- **`session-guard.mjs`**: trava de sessão única — porta TCP `40000 + sha256(sessão)%20000` em `127.0.0.1` exclusive; segundo processo → erro "Já existe um bot usando esta sessão" (exit code 2 → supervisor reporta erro 440). Supervisor marca `LEILAO_SESSION_OWNER_PID` para o filho imediato herdar a posse.

## Inicialização e reconexão (index.mjs)

- `makeWASocket({ markOnlineOnConnect: false, syncFullHistory: false, emitOwnEvents: true, getMessage: getStoredPollMessage })` + `patch-baileys.mjs` no postinstall.
- `connection.update`: `open` → inicia scheduler 5s + sync de grupos; `close` → backoff exponencial de reconexão; QR com TTL (`BOT_QR_TTL_SECONDS`); `connectionReplaced` → encerra com code 2 (só um processo pode ter a sessão).
- Variáveis-chave: `sock`, `socketReady`, `schedulerTimer`, `reconnecting`.

## Fila e dispatches (queue-worker.mjs + index.mjs)

- Worker clama dispatches vencidos via `claim_whatsapp_dispatch` (fila precisa estar `running`; **pausada não é claimada** — pausa/retomada é persistente e sem perda de progresso).
- Lock por `locked_at` + heartbeat (evita re-claim prematuro durante retries longos, máx ~23min com backoff).
- Publicação do lote: **imagem primeiro** (legenda `buildAuctionCaption` de `format.mjs`: nº do lote, nome, condição, bandeira de idioma) e **enquete 5s depois** (`buildPollTitle`: "N. Lances"; opções = `dispatch.poll_options` do banco).
- `dispatch-id.mjs` gera ids estáveis de mensagem/enquete (idempotência de envio: jobId duplicado = lote já na fila → ignora).
- Estados de entrega: `scheduled → sending → sent | failed` (+`attempts`, `last_error`); retry com backoff; falha não perde o restante da fila.
- **Duplicação**: claim atômica, IDs estáveis e etapas persistidas reduzem o risco. Enviar ao WhatsApp e confirmar no banco são operações separadas; não há garantia absoluta de exactly-once.

## Votos de enquete → lances (poll-votes.mjs, poll-identities.mjs, index.mjs)

- WhatsApp encripta votos (poll encryption): `decryptIncomingPollVote` tenta pares de identidade (LID vs telefone — `buildPollCryptoCandidates`).
- `handlePollVote`: resolve participante (`resolve_whatsapp_participant`; conflito de identidade → evento auditado + voto descartado), agrega a seleção atual, compara com `whatsapp_vote_state` (findVoteState) e emite comando idempotente:
  - novo voto → `BID_PLACED`; troca → `BID_CHANGED` (eventId `wa-vote:{poll}:{participant}:{ts}:{amount}`); remoção → `BID_WITHDRAWN` (`wa-withdraw:...`); ARREMATE → `BUYOUT_CONFIRMED` (mensagem "ARREMATADO!" no grupo com nome da carta/vencedor/valor).
  - Erros esperados (`auction_not_open`, `deadline_expired`, `stale_event`, `participant_not_eligible`, `bid_increment_required`) → evento de auditoria (`auditLateVote`), sem crash.
- Tie-break no banco usa `whatsapp_event_at` (horário real do voto), não a hora do processamento.
- **Fechamento por tempo ANUNCIA no grupo** (`finalizeDueAuctions`): mensagem de vencedor com nota de empate ("venceu quem deu o lance primeiro") e aviso de encerrado sem lances — CONFIRMADO 2026-09-23. **HOTFIX 2026-09-29 (spam 7x)**: anúncio UMA vez por leilão (Set `finalizeAnnounced`, cap 200); anúncio SÓ quando o `result.auction.status` é `closed`/`sold` — RPC que resolve sem transição loga `⚠️ Finalize sem transição` e NÃO anuncia; `auction_not_open` no catch marca o evento (ARREMATE corrida) e segue; erro real logado com a mensagem completa. Disparos imediatos de scheduler/finalize no `open` REMOVIDOS (corrida com a abertura invertia a ordem no grupo; o 1º tick de 5s cobre a reconexão).
- **Supervisor mantém** (2026-09-23): backup diário 4h30 (`bot/backup.mjs` → `bot/backups/`), limpeza 12h, restart noturno e tee de log em `bot/logs/bot-YYYY-MM-DD.log` (`bot/file-logger.mjs`, retenção 14 dias).
- **P-06 (2026-09-24)**: ARREMATADO e Leilão encerrado fazem **@menção real** ao vencedor — JID de telefone resolvido por `bot/participant-contact.mjs` (pn > lid > fallback); sem JID, mensagem sai com nome plano.
- **P-07 (2026-09-24)**: `sendDueQuickPolls()` no ciclo de 5s publica brindes agendados pelo painel (`whatsapp_quick_polls`); idempotente por `sent_at` + messageId estável; grupo inativo/opções ruins → marcado sem envio. **Formulário movido para `/auctions/brinde`** (decisão do operador: brinde pertence à área de leilões — botão "🎁 Brinde" no topbar do wizard; a Central WhatsApp não tem mais o formulário). **Brinde por carta (20260924160000)**: brindes da FILA (carta marcada como brinde no wizard) publicam FOTO da carta (caption = título, messageId estável `quick-announce`, crash → reenvio dedup) + a enquete; fila PAUSADA não publica brinde (`queue.status` via embed — o resume re-agenda); a conclusão da fila espera brindes pendentes (trigger em quick_polls).
- **Spam de "Voto recebido para enquete desconhecida" corrigido (2026-09-24)**: votos em enquetes que o bot não rastreia (brindes do painel, enquetes antigas já limpas pela rotina de 12h) são ESPERADOS — o warn por EVENTO inundava o console (dezenas de linhas idênticas por enquete). Agora loga UMA vez por enquete por sessão (`unknownPollWarned`, Set limitado a 200 em index.mjs).
- **CORREÇÃO RAIZ — votos não computados (2026-09-29)**: votos de enquete chegam às vezes ENCAPSULADOS em `ephemeralMessage` (padrão em grupos com mensagens temporárias — ex.: grupos novos) / `viewOnceMessage` / `editedMessage`. O Baileys normaliza internamente, mas o evento entrega a mensagem CRUA: o check DIRETO `message.message.pollUpdateMessage` nunca via o voto — ele caía no fluxo de "mensagem comum" (só enriquecia o participante) e era DESCARTADO EM SILÊNCIO. Fix: `unwrapMessageContent` (poll-votes.mjs, espelha normalizeMessageContent do Baileys) usado em `handleIncomingMessages` + `processIncomingPollMessage` + `decryptIncomingPollVote` (aceita/deriva o conteúdo normalizado). Atualização de enquete SEM payload de voto agora loga em vez de silêncio. Testes: `bot/poll-votes.test.mjs` (voto encapsulado decriptado + unwrap aninhado/cíclico).
- **REGRAS DO LEILÃO — implementação atual**: `sendOpeningSequence` envia regras → espera 3s quando há figurinha → figurinha → @all. O gatilho é a janela da fila (padrão cinco minutos antes, grace quinze minutos depois), usando a mesma marcação de abertura. A descrição antiga de regras em T-7 e figurinha em T-5 não corresponde mais a esse caminho. O texto pode ser substituído em `bot/data/rules-message.json`.
- **P-05 (2026-09-24: gatilho corrigido)**: figurinha de abertura capturada pelo operador (`!figurinha` na mesma conversa da figurinha; persiste em `bot/data/announcement-sticker.json`, doctor checa) + mensagem "@all O leilão vai começar!" com flag nativa `mentionAll` (corrigido em 2026-10-25), sujeita à permissão validada por `groupMetadata`. **Auditoria 2 (2026-09-29)**: a captura agora também desembrulha containers (ephemeralMessage) — em conversas com mensagens temporárias, figurinha e comando `!figurinha` chegam encapsulados e a captura falhava em silêncio (mesma família do bug dos votos). **Gatilho pela FILA** (`starts_at`): janela `BOT_ANNOUNCE_MINUTES_BEFORE` (5) antes até `ANNOUNCE_GRACE_MINUTES` (15) depois; pausada = silêncio; idempotente por `announce-state.json`; roda PRIMEIRO no ciclo de 5s (o gatilho antigo, no 1º dispatch, perdia a corrida com o claim em filas "Agora" e nem existia com brinde na posição 1).
- **Avisos no TERMINAL (2026-09-24)**: os drenos logam quem trocou e onde — participante: "⚠️ {nome} reduziu o lance no lote N ({carta}): R$ X → R$ Y · aviso K de 3 · DM enviada/SEM DM"; admins (no 3º): "⚠️ 3 AVISOS: {nome} — última redução no lote N ({carta}): R$ X → R$ Y · DM enviada a N admin(s)".
- **Re-oferta pós-retirada no TERMINAL (2026-10-08)**: o `BID_PLACED` após uma retirada (participante remove o voto e volta com outro valor) loga `🗳️ Voto após retirada: {nome} → retirou R$ X → R$ Y · lote N[ · ⚠️ redução: aviso global registrado]` — `describeVoteReceived` (`bot/vote-log.mjs`, 5 testes no `check`) consulta o último lance **withdrawn** do participante no leilão, espelhando o ADDITION C do RPC. Primeiro voto da pessoa segue logando "🗳️ Voto recebido".
- **BLINDAGEM CONTRA QUEDA DO SUPABASE (2026-10-08)**: na queda de 2026-10-08 (Cloudflare 520/521/525 no host do Supabase, ~18h18 SP), o FILHO morreu com `UnhandledPromiseRejection` — `finalizeDueAuctions` era try/finally SEM catch e jogava o erro cru do supabase-js (`throw error`) para fora via `void finalizeDueAuctions()` (IIFE do ciclo sem .catch); o supervisor tem handlers e sobreviveu, mas o filho não tinha NENHUM. Correções: (1) catch no `finalizeDueAuctions`; (2) `.catch` no IIFE do ciclo (index.mjs); (3) handlers `uncaughtException`/`unhandledRejection` no FILHO — loga e SEGUE VIVO (exit 1/2 continuam sendo a via real de saída: logout/440); (4) `describeError` (`bot/error-log.mjs`, 7 testes no `check`) — logs de erro em UMA linha: extrai o `<title>` das páginas HTML do Cloudflare, remove tags, colapsa espaços e trunca (antes, CADA erro despejava a página HTML inteira no terminal e nos arquivos de log).
- **Timeout da sync de grupos: 30s → 90s (filho) / 35s → 95s (corrida do pai)** (2026-09-24): em 2 boots reais o socket descartável precisou de >30s para abrir+syncar logo após o kill do bot principal (o servidor leva instantes para liberar a conexão anterior da mesma sessão); a tentativa seguinte sincronizou 13 grupos. O bound continua existindo (sync travada de verdade ainda é morta).
- **P-08 (2026-09-24)**: fotos de detalhe (`cards.extra_images`, até 4) saem em sequência após a foto principal, ANTES de persistir `announcement_sent_at` (crash → reenvio com os MESMOS messageIds estáveis `extra-1..4`).
- **P-09 (2026-09-24)**: `bot/payment-reminder.mjs` — DM ao arrematante a cada 7 dias (`BOT_PAYMENT_REMINDER_DAYS`) enquanto a entrega estiver `waiting_payment` sem payment `paid`; sem aviso/punição; máx. 5 por padrão (`BOT_PAYMENT_REMINDER_MAX`, 0 = ilimitado); idempotente por `payment_reminders.purchase_id` UNIQUE.

## Avisos globais (warning-notify.mjs — commit 6b9e8a6e + rodadas 2026-09-24)

- O RPC grava avisos por **redução** de lance e, com 3 exatos, insere `admin_notifications` (idempotente).
- **O PARTICIPANTE NÃO RECEBE DM** (decisão do operador, re-confirmada 2026-09-24): a redução apenas CONTA no avisômetro global — sem punição, sem mensagem direta à pessoa.
- **Terminal em tempo real (2026-09-24)**: no processamento do voto o bot loga `🔄 Voto alterado: {nome} (fone) → R$ X → R$ Y · lote N · ⚠️ redução: aviso global registrado` — quem trocou, em qual enquete/lote e os preços, na hora.
- O filho drena no ciclo de 5s: formata a DM (`formatWarningNotification`: usuário, total global, última ocorrência com carta/lote/valores/horário, histórico dos anteriores) e envia para `BOT_ADMIN_WA_JIDS` (default 554197285978 e 5519989759121).
- `sent_at` só após TODOS os admins; `payload.sent_to` faz retry parcial reenviar só ao destinatário ainda não registrado. Reduz duplicação, sujeito à janela entre envio e persistência. No 3º aviso o terminal loga o resumo (quem/lote/valores/quantos admins).
- O DASHBOARD mostra a lista ao vivo (painel "Avisos de alteração de valores" — migration 20260924180000, snapshot com `participant_warnings` + `value_change_log`).
- Migration de avisos registrada em produção com versão remota `20260923163815`; não há pendência de aplicação desse item (conferência 2026-10-25).

## Grupos, participantes e estado

- `sync-groups.mjs` (spawnado pelo supervisor) + `syncOpenAuctionGroups` no filho: `whatsapp_groups` ativos e default; participantes sincronizados (`group-participants.mjs`, mapa LID↔telefone). O fluxo automático é stop-bot → sync → restart: o bot fica fora por até ~95s quando o sync demora; a sincronização manual também existe ("Atualizar grupos" na Central → comando `sync_groups`).
- Caches limitados: `contactNames` (LRU cap), `pollMessageCache` (máx 200), `pendingPollVotes`, `dispatchInFlight`, `groupMetadataCache` (TTL por timestamp), `enrichmentMemo`.
- `poll-store.mjs`/`instrument.mjs`: persistência de mensagens de enquete para re-decrypt e telemetria de eventos.

## Segurança

- Nenhum segredo no código: service role só em `bot/.env` (gitignored); painel nunca recebe o service role.
- QR/session só para operador autenticado; `whatsapp_bot_commands` é o único canal de controle do painel→bot (claim único por comando).
- Trava de sessão única (session-guard) evita 2 bots brigando pela sessão (corrupção de creds).

## Dependências

- **Supabase** (direto, sem API HTTP): dispatches, comandos, votos, workers, notificações, limpeza.
- **Painel**: só indiretamente (painel escreve comandos; bot publica estado que o painel lê).
- **Baileys 7.0.0-rc14** + `patch-baileys.mjs` (pinned; upgrade = risco de protocolo). Patches: pre-login ACK `creds.me?.id`, rotação do adv secret (`companion_reg_refresh` re-renderiza o QR) e **silenciamento do spam de churn de sessão do libsignal** (2026-09-24): a sync de grupos roda num socket descartável (`sync-groups.mjs`); na volta, o socket principal substitui as sessões Signal dos participantes e o libsignal imprimia a SessionEntry INTEIRA (chains/ratchets/**privKey**) via `console.info` a cada troca — dezenas de "Closing session:" por reconexão. 7 call sites viraram `void 0` em `session_record.js`/`session_builder.js`/`session_cipher.js`; `console.error` de falhas reais (decrypt, migração) permanece. O close é só marcação `indexInfo.closed = Date.now()` — nada é apagado do disco (esperado em troca de sessão, NÃO é logout).

## Riscos / atenção especial

- **Queda do processo**: supervisor reinicia em 5s; votos que chegarem durante a queda ficam no WhatsApp e são processados no reconnect (guardas `stale_event` protegem ordem).
- **`connectionReplaced`**: sessão aberta em outro lugar → filho sai com code 2; operador vê erro 440.
- **Reprocessamento**: `processed_commands` + advisory lock + vote_state protegem contra repetição; preservar o MESMO eventId em retries. O cache possui retenção padrão de sete dias, não garantia eterna de replay.
- **processamento repetido de enquetes**: mensagens de enquete re-hidratadas de `poll_message_json` (`reviveStoredMessage`) — cuidado ao mexer nesse formato.
- Windows: supervisor mata a árvore via `taskkill /T /F` no start-all.

## Limites identificados na revisão de 2026-10-25

- **P-26 corrigido no bot 0.2.6**: builder usa `mentionAll: true` e o envio preserva o objeto completo. `sendOpeningMention` valida metadata/conta admin nos grupos >32 (PN/LID normalizados); sem permissão/metadata, envia aviso simples sem @all e registra motivo. Serialização real do SDK validada com nonJidMentions=1, sem lista individual. Sem teste de recebimento em celulares. Ver [14_FRONTEND_AND_MENTIONS_PLAN.md](14_FRONTEND_AND_MENTIONS_PLAN.md).
- A abertura é sequenciada dentro de uma chamada; `openingBusy` retorna imediatamente a ciclos seguintes. Atrasos maiores que 5s podem deixar outro tick iniciar o scheduler antes de a abertura anterior terminar. Não afirmar atomicidade entre ticks.
- O fechamento é salvo antes do anúncio; falha do WhatsApp após a transação pode deixar resultado sem anúncio. Não há outbox persistente nesse caminho.
- Retenção de vendas em 12h conflita com lembrete padrão em 7d; backup do dia não prova cobertura de registros posteriores à cópia. Pendências em `11_PENDING_WORK.md`; não corrigidas nesta revisão.

## Telemetria 0.2.8

`operation-health.mjs` mantém estado limitado e restaurado do worker. `createSupabaseFetch.onHealth` informa falha/recuperação ao supervisor. Backup diário e antes da limpeza publicam estado; nenhuma mudança de retenção. Abertura transmite motivo de @all ao supervisor por marcador stdout, sem chamada extra ao banco; o heartbeat existente o publica apenas quando mudou. Outbox persiste last_error sob o lock e libera claim mesmo se gravar diagnóstico falhar. Nenhuma nova mensagem de teste foi enviada; reinício operacional do bot continua necessário.

## Apuração de jogos — 0.2.9

Votos de quick polls configurados são descriptografados como leilões. Hash da única opção selecionada é comparado localmente; errados/retirada/múltiplos não disputam e não geram auditoria. Certo resolve identidade e usa claim_quick_poll_prize (lock/resultado/outbox/evento atômicos). Mensagem/chave persistidas, pendências liberadas pela fila serial após publicação; cache limitado. Outbox anuncia nome/carta com menção. Primeiro confirmado ganha permanentemente; legacy não converte. Reabrir bot atualizado. Documento 17.
