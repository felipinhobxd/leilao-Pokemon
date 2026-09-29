# SESSION HANDOFF

## Última atualização
2026-09-29 (hotfix do spam "Leilão encerrado: sem comprador" 7x + corrida de conexão)

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
14. **Limpeza 24 horas**: retenção fixa de 24h no RPC e no bot; a limpeza continua exigindo backup na nuvem no mesmo dia.
15. **Auto-save de rascunho**: 45s, fingerprint, silencioso em falha.

## Ponto EXATO onde paramos
Tudo concluído, testado e publicado. CI verde. Migrations PENDENTES de aplicação manual (P-13 — ver 11_PENDING_WORK.md). O operador também pediu avaliação de conversão para desktop .exe (P-14 — Electron wrapper recomendado, não SQLite).

## Próximo passo EXATO
1. **OPERADOR (P-13)**: aplicar as 6 migrations pendentes no SQL Editor (ordem lexical, ver 11_PENDING_WORK.md) → `npm run doctor` → smokes.
2. **OPERADOR (P-11)**: secret na Vercel → chip "serviço local ✅" no painel publicado.
3. **OPERADOR**: decidir sobre P-14 (desktop Electron vs. continuar como está).
4. Se novo trabalho: `npm run build` ANTES do `npm run start` (o build local precisa ter os últimos fixes).

## Arquivos de código prioritários
- `supabase/migrations/` (6 pendentes), `bot/index.mjs` (sendOpeningSequence atômica), `bot/announce-sticker.mjs` (@all + regras)
- `app/dashboard.tsx` (painel de avisos + exclusão + dialog), `lib/card-recognition-local.ts` (warming backoff)
- `lib/auction-draft.ts` (contrato dos rascunhos), `bot/warning-notify.mjs` (ciclo + DM de falha)

## Comandos úteis
```bash
npm run doctor
npm run start          # RODE npm run build ANTES!
npm test && npm run typecheck && npm run build
node --test bot/*.test.mjs
# python: a partir de recognition/ com o venv
.venv\Scripts\python.exe -m unittest discover -s tests
```

## Atenções
- **npm run build ANTES do npm run start** — o build carrega os últimos fixes; sem ele o painel/bot usam código velho.
- Migrations 180000..250000 NÃO aplicadas em produção: avisos/ciclo/edição/exclusão/LIMITs falham com erro claro até aplicar.
- **P-11 é o gargalo da qualidade no painel publicado** (secret na Vercel).
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
- Reconhecimento: a pessoa NÃO recebe DM de aviso; o chip no wizard nomeia o pipeline ativo.
- Espanhol: CANCELADO do produto (0 es no índice, dropdown sem es).
- Fotos de detalhe: até 4 por carta, em sequência após a principal.
