# 06_WHATSAPP_BOT — Worker Baileys (bot/)

> Área: Bot WhatsApp
> Escopo: Supervisor, filho Baileys, fila, votos, avisos, sessão, segurança
> Última atualização: 2026-09-23
> Fonte principal: `bot/service.mjs`, `bot/index.mjs`, `bot/queue-worker.mjs`, `bot/poll-votes.mjs`, `bot/poll-identities.mjs`, `bot/warning-notify.mjs`, `bot/session-guard.mjs`, `bot/group-participants.mjs`, `bot/format.mjs`, `bot/dispatch-id.mjs`, `bot/instrument.mjs`, `bot/sync-groups.mjs`, `bot/package.json`, `.github/workflows/ci.yml`

## Arquitetura do processo

- **`service.mjs` (supervisor, Node 24, Windows)**: único ponto de entrada (`npm --prefix bot start` = `node --env-file=.env service.mjs`; também spawnado por `scripts/start-all.mjs`).
  - Exige env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_ADMIN_USER_ID`.
  - Cria seu próprio client Supabase; **não** tem socket do WhatsApp.
  - Ciclos: heartbeat (10–15s) em `whatsapp_bot_workers` (status/QR/expiração → painel); poll de `whatsapp_bot_commands` (3s); **limpeza 30d** (`cleanup_old_auctions`, ≥1x/hora, `BOT_CLEANUP_DAYS`); **restart noturno** (`BOT_NIGHT_RESTART_HOUR` default 4h05 — mata o filho, exit handler reinicia em 5s).
  - Spawn do filho com `--max-old-space-size=384` (RAM era 1,8–2 GB ocioso; V8 não devolvia ao Windows).
  - Shutdown limpo (SIGINT/SIGTERM): para filho, limpa timers, publica estado `disconnected`.
- **`index.mjs` (filho Baileys)**: conecta a sessão (`./sessao`, multi-file auth), processa eventos, publica dispatches, finaliza leilões, drena notificações de admins.
- **`session-guard.mjs`**: trava de sessão única — porta TCP `40000 + sha256(sessão)%20000` em `127.0.0.1` exclusive; segundo processo → erro "Já existe um bot usando esta sessão" (exit code 2 → supervisor reporta erro 440). Supervisor marca `LEILAO_SESSION_OWNER_PID` para o filho imediato herdar a posse.

## Inicialização e reconexão (index.mjs)

- `makeWASocket({ markOnlineOnConnect: false, syncFullHistory: false, emitOwnEvents: true, getMessage: getStoredPollMessage })` + `patch-baileys.mjs` no postinstall.
- `connection.update`: `open` → inicia scheduler 3s + sync de grupos; `close` → backoff exponencial de reconexão; QR com TTL (`BOT_QR_TTL_SECONDS`); `connectionReplaced` → encerra com code 2 (só um processo pode ter a sessão).
- Variáveis-chave: `sock`, `socketReady`, `schedulerTimer`, `reconnecting`.

## Fila e dispatches (queue-worker.mjs + index.mjs)

- Worker clama dispatches vencidos via `claim_whatsapp_dispatch` (fila precisa estar `running`; **pausada não é claimada** — pausa/retomada é persistente e sem perda de progresso).
- Lock por `locked_at` + heartbeat (evita re-claim prematuro durante retries longos, máx ~23min com backoff).
- Publicação do lote: **imagem primeiro** (legenda `buildAuctionCaption` de `format.mjs`: nº do lote, nome, condição, bandeira de idioma) e **enquete 5s depois** (`buildPollTitle`: "N. Lances"; opções = `dispatch.poll_options` do banco).
- `dispatch-id.mjs` gera ids estáveis de mensagem/enquete (idempotência de envio: jobId duplicado = lote já na fila → ignora).
- Estados de entrega: `scheduled → sending → sent | failed` (+`attempts`, `last_error`); retry com backoff; falha não perde o restante da fila.
- **Duplicação**: impossível por design — claim atômica + event-id estável por dispatch + `poll_message_id` gravado no banco no primeiro envio.

## Votos de enquete → lances (poll-votes.mjs, poll-identities.mjs, index.mjs)

- WhatsApp encripta votos (poll encryption): `decryptIncomingPollVote` tenta pares de identidade (LID vs telefone — `buildPollCryptoCandidates`).
- `handlePollVote`: resolve participante (`resolve_whatsapp_participant`; conflito de identidade → evento auditado + voto descartado), agrega a seleção atual, compara com `whatsapp_vote_state` (findVoteState) e emite comando idempotente:
  - novo voto → `BID_PLACED`; troca → `BID_CHANGED` (eventId `wa-vote:{poll}:{participant}:{ts}:{amount}`); remoção → `BID_WITHDRAWN` (`wa-withdraw:...`); ARREMATE → `BUYOUT_CONFIRMED` (mensagem "ARREMATADO!" no grupo com nome da carta/vencedor/valor).
  - Erros esperados (`auction_not_open`, `deadline_expired`, `stale_event`, `participant_not_eligible`, `bid_increment_required`) → evento de auditoria (`auditLateVote`), sem crash.
- Tie-break no banco usa `whatsapp_event_at` (horário real do voto), não a hora do processamento.
- **Fechamento por tempo ANUNCIA no grupo** (`finalizeDueAuctions`): mensagem de vencedor com nota de empate ("venceu quem deu o lance primeiro") e aviso de encerrado sem lances — CONFIRMADO 2026-09-23.
- **Supervisor mantém** (2026-09-23): backup diário 4h30 (`bot/backup.mjs` → `bot/backups/`), limpeza 30d, restart noturno e tee de log em `bot/logs/bot-YYYY-MM-DD.log` (`bot/file-logger.mjs`, retenção 14 dias).
- **P-06 (2026-09-24)**: ARREMATADO e Leilão encerrado fazem **@menção real** ao vencedor — JID de telefone resolvido por `bot/participant-contact.mjs` (pn > lid > fallback); sem JID, mensagem sai com nome plano.
- **P-07 (2026-09-24)**: `sendDueQuickPolls()` no ciclo de 3s publica brindes agendados pelo painel (`whatsapp_quick_polls`); idempotente por `sent_at` + messageId estável; grupo inativo/opções ruins → marcado sem envio. **Formulário movido para `/auctions/brinde`** (decisão do operador: brinde pertence à área de leilões — botão "🎁 Brinde" no topbar do wizard; a Central WhatsApp não tem mais o formulário). **Brinde por carta (20260924160000)**: brindes da FILA (carta marcada como brinde no wizard) publicam FOTO da carta (caption = título, messageId estável `quick-announce`, crash → reenvio dedup) + a enquete; fila PAUSADA não publica brinde (`queue.status` via embed — o resume re-agenda); a conclusão da fila espera brindes pendentes (trigger em quick_polls).
- **Spam de "Voto recebido para enquete desconhecida" corrigido (2026-09-24)**: votos em enquetes que o bot não rastreia (brindes do painel, enquetes antigas já limpas pela 30d) são ESPERADOS — o warn por EVENTO inundava o console (dezenas de linhas idênticas por enquete). Agora loga UMA vez por enquete por sessão (`unknownPollWarned`, Set limitado a 200 em index.mjs).
- **P-05 (2026-09-24: gatilho corrigido)**: figurinha de abertura capturada pelo operador (`!figurinha` na mesma conversa da figurinha; persiste em `bot/data/announcement-sticker.json`, doctor checa) + mensagem "@todos O leilão vai começar!" com menção REAL de todos os participantes (`groupMetadata`). **Gatilho pela FILA** (`starts_at`): janela `BOT_ANNOUNCE_MINUTES_BEFORE` (5) antes até `ANNOUNCE_GRACE_MINUTES` (15) depois; pausada = silêncio; idempotente por `announce-state.json`; roda PRIMEIRO no ciclo de 3s (o gatilho antigo, no 1º dispatch, perdia a corrida com o claim em filas "Agora" e nem existia com brinde na posição 1).
- **Avisos no TERMINAL (2026-09-24)**: os drenos logam quem trocou e onde — participante: "⚠️ {nome} reduziu o lance no lote N ({carta}): R$ X → R$ Y · aviso K de 3 · DM enviada/SEM DM"; admins (no 3º): "⚠️ 3 AVISOS: {nome} — última redução no lote N ({carta}): R$ X → R$ Y · DM enviada a N admin(s)".
- **Timeout da sync de grupos: 30s → 90s (filho) / 35s → 95s (corrida do pai)** (2026-09-24): em 2 boots reais o socket descartável precisou de >30s para abrir+syncar logo após o kill do bot principal (o servidor leva instantes para liberar a conexão anterior da mesma sessão); a tentativa seguinte sincronizou 13 grupos. O bound continua existindo (sync travada de verdade ainda é morta).
- **P-08 (2026-09-24)**: fotos de detalhe (`cards.extra_images`, até 4) saem em sequência após a foto principal, ANTES de persistir `announcement_sent_at` (crash → reenvio com os MESMOS messageIds estáveis `extra-1..4`).
- **P-09 (2026-09-24)**: `bot/payment-reminder.mjs` — DM ao arrematante a cada 7 dias (`BOT_PAYMENT_REMINDER_DAYS`) enquanto a entrega estiver `waiting_payment` sem payment `paid`; sem aviso/punição; máx. 5 por padrão (`BOT_PAYMENT_REMINDER_MAX`, 0 = ilimitado); idempotente por `payment_reminders.purchase_id` UNIQUE.

## Avisos globais (warning-notify.mjs — commit 6b9e8a6e + rodada 2026-09-24)

- O RPC grava avisos por **redução** de lance e, com 3 exatos, insere `admin_notifications` (idempotente).
- **DM ao PARTICIPANTE (20260924180000, pedido do operador)**: `createParticipantWarningDrain` drena `participant_warnings.notified_at IS NULL` no ciclo de 3s — envia DM direto nomeando a enquete/lote, carta, valores e horário, e o nº do aviso ("aviso K de 3"; no 3º+ informa que os admins foram notificados). `notified_at` só após enviar (crash → reenvio); sem JID de telefone resolvível marca sem DM (o aviso continua contando). K = contador global do usuário (mesma régua dos admins).
- O filho drena no ciclo de 3s: formata a DM (`formatWarningNotification`: usuário, total global, última ocorrência com carta/lote/valores/horário, histórico dos anteriores) e envia para `BOT_ADMIN_WA_JIDS` (default 554197285978 e 5519989759121).
- `sent_at` só após TODOS os admins; `payload.sent_to` faz retry parcial reenviar SÓ ao que faltou (zero DM duplicada). Sem socket → não processa.
- ⚠️ Enquanto a migration `20260923093000` não for aplicada, o dreno loga erro (tabela inexistente) e continua funcional — barulho esperado no console.

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
- **Reprocessamento**: garantido ausente por `processed_commands` + advisory lock + vote_state; nunca "re-enviar" um comando sem o MESMO eventId.
- **processamento repetido de enquetes**: mensagens de enquete re-hidratadas de `poll_message_json` (`reviveStoredMessage`) — cuidado ao mexer nesse formato.
- Windows: supervisor mata a árvore via `taskkill /T /F` no start-all.
