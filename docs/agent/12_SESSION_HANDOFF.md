# SESSION HANDOFF

## Última atualização
2026-09-25 (rodada 8: CICLO de 3 avisos com reset + auto-save de rascunho + backup na nuvem + DM de lote falho + edição de lote pendente na fila)

## Rodada 8 (o que foi feito)
1. **Ciclo de 3 avisos com RESET (decisão do operador)**: migration `20260924200000_warning_cycle_reset.sql` — coluna `cycle_closed` em participant_warnings + `process_auction_command` copiado VERBATIM por EXTRAÇÃO programática (gerador node; zero transcrição manual) com a única mudança marcada no hook: o contador considera apenas avisos APÓS o último cycle_closed; o 3º do ciclo notifica os admins E marca a linha (baseline do próximo ciclo); nova sequência de 3 → nova notificação. Histórico nunca é apagado. DM aos admins: "ciclo atual — o contador reinicia após esta notificação". Dashboard mostra K do CICLO + "contador reiniciado" na linha que fechou. Teste SQL: 2 ciclos completos → 2 notificações, ambas marcadas, histórico com 6 linhas.
2. **Auto-save de rascunho**: intervalo de 45s no wizard; fingerprint (transições de reconhecimento NÃO contam); silencioso (sem banner de erro — desativa na sessão se falhar, ex. migration pendente); "salvo automaticamente às HH:MM". Botão manual continua.
3. **Backup fora do disco**: `uploadBackupToCloud` (bot/backup.mjs) sobe o JSON diário ao Storage Supabase (bucket privado `business-backups`, cria se não existir, upsert por stamp, retenção nuvem `BOT_BACKUP_CLOUD_KEEP`=7 vs local 30); falha na nuvem NUNCA derruba o local (warn).
4. **DM aos admins quando um lote FALHA de vez**: `notifyAdminsDispatchFailed` (idempotente por `dispatch-failed:{id}`) nos dois caminhos terminais (markDispatchFailed irrecuperável + markDispatchRetry esgotando 5 tentativas); dreno dos admins formata por kind (`formatDispatchFailedNotification`): lote, carta, tentativas, erro, "NÃO volta para a fila".
5. **Edição de lote PENDENTE na fila**: migration `20260924210000_edit_queue_item.sql` (`update_pending_queue_item`: só dispatch scheduled de fila não-terminal; reescreve preços/duração/foto + REGENERA poll_options + recompute de scheduled_end_at; audita previous/next — capturados ANTES dos updates; variável `new_image_url` por causa do PERIGOS 42702). API: `POST /api/auctions/queue {action:"edit_item"}` (valida + buildPollPlan igual à criação; readQueue agora traz duration_seconds/poll_options/prices). UI: botão "✏️ Editar lote" em lotes scheduled + diálogo (inicial, incremento, ARREMATE, duração, opções, URL da foto). Teste SQL tests/edit-queue-item.sql (+ci.yml).
6. Reconhecimento verificado SÃO ao vivo (lote de 12 fotos do zap: PROVAVEL/IDENTIFICADO corretos, 0 crash — o "piorou" era a fila/estado do serviço na hora).

## Migrations pendentes do operador (P-13)
`20260924180000_dashboard_warnings_snapshot.sql` (avisos no dashboard — snapshot agora inclui created_at/cycle_closed), `20260924200000_warning_cycle_reset.sql`, `20260924210000_edit_queue_item.sql` (+ confirmar 170000/190000 se ainda não colou). 150000/160000 confirmadas aplicadas.

## Próximo passo EXATO
1. Push + CI verde.
2. OPERADOR: aplicar as migrations pendentes no SQL Editor (ordem lexical) → `npm run doctor` → smoke: editar um lote pendente; 3+3 reduções → 2 DMs de ciclo; backup diário com cloudPath no log; lote forçado a falhar → DM.
3. P-11 (secret na Vercel) segue pendente.

## Histórico das rodadas anteriores (resumo)
- R1-7: rascunhos (150000), hotfixes do bot (libsignal/dedup/sync 90s), brinde por carta (160000), variante/bandeira na legenda, drag só no ☰, pipeline de reconhecimento VISÍVEL (P-11 diagnóstico), DM ao participante REMOVIDA por decisão do operador (180000 reescrita in-place), figurinha+@todos com gatilho pela FILA (grace 15min), avisos no terminal em tempo real.
