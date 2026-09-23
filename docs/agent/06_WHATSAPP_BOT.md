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

## Avisos globais (warning-notify.mjs — commit 6b9e8a6e)

- O RPC grava avisos por **redução** de lance e, com 3 exatos, insere `admin_notifications` (idempotente).
- O filho drena no ciclo de 3s: formata a DM (`formatWarningNotification`: usuário, total global, última ocorrência com carta/lote/valores/horário, histórico dos anteriores) e envia para `BOT_ADMIN_WA_JIDS` (default 554197285978 e 5519989759121).
- `sent_at` só após TODOS os admins; `payload.sent_to` faz retry parcial reenviar SÓ ao que faltou (zero DM duplicada). Sem socket → não processa.
- ⚠️ Enquanto a migration `20260923093000` não for aplicada, o dreno loga erro (tabela inexistente) e continua funcional — barulho esperado no console.

## Grupos, participantes e estado

- `sync-groups.mjs` (spawnado pelo supervisor) + `syncOpenAuctionGroups` no filho: `whatsapp_groups` ativos e default; participantes sincronizados (`group-participants.mjs`, mapa LID↔telefone).
- Caches limitados: `contactNames` (LRU cap), `pollMessageCache` (máx 200), `pendingPollVotes`, `dispatchInFlight`, `groupMetadataCache` (TTL por timestamp), `enrichmentMemo`.
- `poll-store.mjs`/`instrument.mjs`: persistência de mensagens de enquete para re-decrypt e telemetria de eventos.

## Segurança

- Nenhum segredo no código: service role só em `bot/.env` (gitignored); painel nunca recebe o service role.
- QR/session só para operador autenticado; `whatsapp_bot_commands` é o único canal de controle do painel→bot (claim único por comando).
- Trava de sessão única (session-guard) evita 2 bots brigando pela sessão (corrupção de creds).

## Dependências

- **Supabase** (direto, sem API HTTP): dispatches, comandos, votos, workers, notificações, limpeza.
- **Painel**: só indiretamente (painel escreve comandos; bot publica estado que o painel lê).
- **Baileys 7.0.0-rc14** + `patch-baileys.mjs` (pinned; upgrade = risco de protocolo).

## Riscos / atenção especial

- **Queda do processo**: supervisor reinicia em 5s; votos que chegarem durante a queda ficam no WhatsApp e são processados no reconnect (guardas `stale_event` protegem ordem).
- **`connectionReplaced`**: sessão aberta em outro lugar → filho sai com code 2; operador vê erro 440.
- **Reprocessamento**: garantido ausente por `processed_commands` + advisory lock + vote_state; nunca "re-enviar" um comando sem o MESMO eventId.
- **processamento repetido de enquetes**: mensagens de enquete re-hidratadas de `poll_message_json` (`reviveStoredMessage`) — cuidado ao mexer nesse formato.
- Windows: supervisor mata a árvore via `taskkill /T /F` no start-all.
