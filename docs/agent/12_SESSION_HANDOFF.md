# SESSION HANDOFF

## Última atualização
2026-10-07 (painel de gestão de participantes + redução via retirada e re-oferta)

## Hotfix 2026-09-29 — finalize repetido + corrida de conexão
- **Sintoma**: 7x "⏰ Leilão encerrado: sem comprador" (grupo + terminal) em ~30s, e foto/lote antes do "@all O leilão vai começar!".
- **Causa 1 (spam)**: leilão travado em `open` (carta "teste" de 25/09 ficou `in_auction` 4 dias) re-anunciado a CADA ciclo de 5s — o `finalizeDueAuctions` anunciava sempre que o RPC resolvia sem vencedor, sem checar se o leilão realmente fechou, e re-anunciava após falha de envio.
- **Causa 2 (ordem)**: `connect()` no `open` rodava `void runScheduler()` + `void finalizeDueAuctions()` IMEDIATOS, em paralelo com a sequência de abertura — foto/lote saía antes do @all e o finalize antecipava (anúncio #1 às 15:11:56, antes da fila ser anunciada).
- **Fix (bot/index.mjs)**: (a) Set `finalizeAnnounced` (cap 200) — um anúncio por `bot-finalize:{id}:{end}`, nunca mais repete; (b) anúncio SÓ quando `result.auction.status` é `closed`/`sold` — resultado sem transição loga `⚠️ Finalize sem transição` UMA vez, sem mensagem no grupo; (c) `auction_not_open` no catch marca o evento como anunciado (fechado por ARREMATE corrida) e `continue`; (d) disparos imediatos do `open` REMOVIDOS — o 1º tick (5s) cobre a reconexão com a ordem garantida (await sendOpeningSequence → scheduler → finalize).
- **Validação**: bot 38 + 13 testes, typecheck limpo. RPC `process_auction_command` testado DIRETO no banco de produção: open+vencido+0 lances → `closed` (funciona — o spam não era o RPC).
- **Evidência**: `processed_commands` NÃO tinha nenhum `bot-finalize` de 29/09 (as 7 tentativas falharam no banco silenciosamente); log `bot/logs/bot-2026-09-29.log`.

## Sessão atual (resumo das 10+ rodadas)
1. **Rascunhos do wizard em lote** (150000): salvar/abrir/excluir, fotos no Storage, auto-save 45s, apaga ao publicar.
2. **Hotfixes do bot**: spam libsignal (patch), spam "enquete desconhecida" (dedup), sync 90s, brinde avulso /auctions/brinde.
3. **Brinde por carta** (160000): botão na EDIÇÃO → foto + enquete no lugar do leilão; variante/bandeira na legenda; drag só no ☰.
4. **Pipeline de reconhecimento VISÍVEL**: chip no wizard (P-11 diagnóstico); warming backoff 5s (era 60s cego).
5. **Avisos com ciclo de 3** (200000): 3 → DM admins + RESET; participante NÃO recebe DM (decisão final).
6. **Figurinha + @all ATÔMICO** (reconciliado 220000): regras → 3s → figurinha → @all (menções REAIS, todos os JIDs). Uma função, uma chave, nunca duplica, nunca inverte. O scheduler ESPERA a abertura terminar.
7. **Editar lote pendente** (210000): preços/duração/foto + enquete re-gerada, sem cancelar a fila.
8. **Excluir leilão DE VERDADE** (delete_auction): frase "sim quero" (UI→API→RPC); árvore FK-safe inteira; carta órfã junto; SECURITY DEFINER; fila vazia limpa (operador).
9. **DM de lote falho** para os admins (kind DISPATCH_FAILED nos dois caminhos terminais).
10. **200 cartas máx** (era 100): constraint + RPC + API.
11. **Export Excel FIX**: snapshot com LIMITs (era TODAS as linhas → timeout 57014).
12. **Egress/Log Ingestion FIX**: dashboard snapshot com LIMITs (~50-80 KB, era 288 KB); Realtime debounce 250ms→5s; polling global ~56% menor.
13. **Backup na nuvem**: bucket privado business-backups, retenção 7 (nuvem) / 30 (local).
14. **Limpeza 12 horas** (2026-10-05, era 24h; antes piso de 30 dias): retenção fixa de 12h no RPC (`cleanup_old_auctions(p_hours=12)`, parâmetro em HORAS com piso de 1h) e no bot (`p_hours: 12`); a limpeza continua exigindo backup na nuvem no mesmo dia. Migration `20261005120000` + `tests/cleanup-retention.sql` reescrito e incluído no CI.
15. **Auto-save de rascunho**: 45s, fingerprint, silencioso em falha.
16. **REMOÇÃO COMPLETA DO RECONHECIMENTO** (2026-10-05, decisão do operador): toda a IA de identificação de cartas saiu do projeto — `recognition/` (Python/FastAPI/ONNX/OCR), 26 módulos `lib/card-recognition-*`, `lib/card-catalog.ts` (validação de lote contra o catálogo — o campo `collection` já não vinha da UI, o check estava morto), API `/api/card-recognition/*`, toggle/debug/wiring do wizard, 6 scripts, 2 workflows, benchmarks, docs, 11 arquivos de teste e a tabela `card_recognition_examples` (migration `20261005130000` de drop). Dependências `@huggingface/transformers` + `onnxruntime-common` + override/stubs removidas. Wizard agora é 100% manual: imagem → preencher dados → preços → revisão → publicar. `npm start` sobe só site + bot. `doctor` sem checks de reconhecimento e com verificações de tabela em paralelo. Rascunhos antigos continuam abrindo (whitelist ignora campos de IA).
17. **PAINEL DE GESTÃO DE PARTICIPANTES** (2026-10-07, migration 20261007100000): comandos idempotentes `PARTICIPANT_SUSPEND`/`PARTICIPANT_REACTIVATE` no RPC; UI com colunas Avisos (total + K de 3 via nova chave `participant_warning_stats` do snapshot), Suspensão e Notas; ações Suspender… (24h/48h/7d/data Brasília/indefinida), Reativar, Banir (relabel do PARTICIPANT_DELETE). Suspensão COM prazo auto-expira (status fica 'active' + suspension_until); indefinida = status 'suspended'; banido não é suspenso (participant_banned); reativar limpa status+prazo. Select de lances manuais filtra suspenso com prazo vigente.
18. **REDUÇÃO VIA RETIRADA + RE-OFERTA** (2026-10-07, migration 20261007110000): o fluxo "retira o voto e dá lance menor" chegava como BID_PLACED e passava batido. ADDITION C no BID_PLACED compara com o último lance withdrawn (alias `prev`, índice novo `bids_auction_participant_recent_idx`) → nova função `register_participant_reduction` grava value_change_log/participant_warnings com `change_kind` ('change'|'withdraw_rebid'), aviso na redução, ciclo de 3 e DM com o MESMO payload do bot (zero mudança em bot/). Bloco B.2 (BID_CHANGED) permanece inline verbatim. Excel ganha coluna "Como" (3 abas); painel Avisos marca "após retirar o lance". Testes: `tests/participants-panel.sql` + `tests/withdraw-rebid-warning.sql` (17 SQL files no CI).

## Ponto EXATO onde paramos
2026-09-29 (sessão de auditoria geral): (1) hotfix do spam "sem comprador" 7x no finalize; (2) CORREÇÃO RAIZ DOS VOTOS — votos de enquete encapsulados em ephemeralMessage nunca eram reconhecidos (check direto message.message.pollUpdateMessage); unwrapMessageContent agora normaliza em handleIncomingMessages/processIncomingPollMessage/decryptIncomingPollVote; (3) ideia .exe/Electron REMOVIDA por completo (P-14 cancelado). Migrations PENDENTES de aplicação manual (P-13 — ver 11_PENDING_WORK.md).
2026-10-05 (limpeza 12h): retenção da limpeza de leilões 24h → 12h (pedido do operador). Migration `20261005120000_cleanup_12h_retention.sql` (PENDENTE — item 7 do P-13), bot já chama `p_hours=12`, `tests/cleanup-retention.sql` reescrito (janela 12h + granularidade em horas) e adicionado ao CI, docs e `.env.example` atualizados.
2026-10-05 (remoção do reconhecimento): Toda a IA de cartas foi eliminada (itens da sessão: ver item 16 acima). Migrations PENDENTES de aplicação: `20261005120000` (limpeza 12h) + `20261005130000_drop_card_recognition_examples.sql` (P-13). `npm install` já feito (lockfile regenerado, 22 pacotes a menos); faltam `npm ci` local + build.
2026-10-07 (participantes + retirada/re-oferta): duas migrations NOVAS e encadeadas — `20261007100000_participants_panel_commands.sql` (comandos SUSPEND/REACTIVATE + participant_warning_stats no snapshot) e `20261007110000_withdraw_rebid_reduction_warning.sql` (change_kind + register_participant_reduction + ADDITION C no BID_PLACED). Código validado localmente (typecheck, 71 testes node, 15 bot, build); SQL valida no CI. ZERO mudança em `bot/` (payload da DM idêntico). Migrations PENDENTES de aplicação manual (P-13 itens 9-10 — a #10 contém o corpo do RPC já com a #9, aplicar em ordem).

## Próximo passo EXATO
1. **OPERADOR**: reiniciar o bot (npm run start) e testar um voto numa enquete de um grupo NOVO (mensagens temporárias) — o terminal deve logar "🗳️ Voto recebido".
2. **OPERADOR (P-13)**: aplicar as migrations pendentes no SQL Editor (ver 11_PENDING_WORK.md — incl. as duas de 2026-10-07: participantes + retirada/re-oferta, NESSA ORDEM) → `npm run doctor` → smokes.
3. Se novo trabalho: `npm run build` ANTES do `npm run start` (o build local precisa ter os últimos fixes).
4. Smokes novos (após aplicar 20261007*): (h) suspender participante com prazo → voto rejeitado, expira sozinho; (i) retirar lance + dar menor → aviso "após retirar o lance" no painel e "Como" no Excel; 3 avisos somando troca direta + retirada = 1 DM.

## Arquivos de código prioritários
- `supabase/migrations/` (pendentes — ver P-13), `bot/index.mjs` (sendOpeningSequence atômica), `bot/announce-sticker.mjs` (@all + regras)
- `app/dashboard.tsx` (painel de avisos + exclusão + dialog)
- `lib/auction-draft.ts` (contrato dos rascunhos), `bot/warning-notify.mjs` (ciclo + DM de falha)

## Comandos úteis
```bash
npm run doctor
npm run start          # RODE npm run build ANTES!
npm test && npm run typecheck && npm run build
node --test bot/*.test.mjs
```

## Atenções
- **npm run build ANTES do npm run start** — o build carrega os últimos fixes; sem ele o painel/bot usam código velho.
- Migrations 180000..250000 NÃO aplicadas em produção: avisos/ciclo/edição/exclusão/LIMITs falham com erro claro até aplicar.
- **Supabase Log Ingestion** estava 0.96/1 GB — polling reduzido mas logs acumulados só resetam no próximo billing.
- Migrations que substituem função: verbatim da última versão com adições marcadas (extração programática quando possível).
- O OPERADOR também escreve migrations — `git fetch` ANTES de substituir função/push.
- RPC que mexe em TRIGGER: precisa ser SECURITY DEFINER.
- Client components NUNCA importam lib/backend (server-only).
- Suíte que persiste estado: redirecionar o diretório ANTES do import (BOT_DATA_DIR).
- Atualizar `11_PENDING_WORK.md` e ESTE arquivo ao concluir qualquer item.

## Decisões de produto (definitivas — não reverter)
- Avisos: redução = +1 no ciclo; 3 = DM aos admins + RESET do contador; participante NÃO recebe DM.
- Brinde por carta: foto + enquete no lugar do leilão; enquete avulsa em /auctions/brinde.
- @all: menção coletiva nativa do WhatsApp (todos os JIDs no mentions, texto diz @all).
- Sequência de abertura: ATÔMICA (regras → figurinha → @all); o scheduler espera.
- Excluir leilão: "sim quero" (tripla validação); SECURITY DEFINER; carta órfã junto.
- Reconhecimento: REMOVIDO por completo (2026-10-05) — não reabrir; cadastro de cartas é manual.
- Espanhol: CANCELADO do produto (0 es no índice, dropdown sem es).
- Fotos de detalhe: até 4 por carta, em sequência após a principal.
- Suspensão (2026-10-07): COM prazo = só suspension_until (status 'active', auto-expira pelo guard); SEM prazo = status 'suspended' (indefinida); banido não é suspenso; Reativar limpa status+prazo (desfaz ban também).
- Redução via retirada (2026-10-07): retirar o lance e re-ofertar MENOR conta aviso no MESMO ciclo dos 3 (marcado 'withdraw_rebid' / "após retirar o lance"); subir/igualar após retirar só registra histórico, sem aviso.
