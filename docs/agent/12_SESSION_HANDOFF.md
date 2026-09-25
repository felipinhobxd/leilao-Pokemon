# SESSION HANDOFF

## Última atualização
2026-09-24 (rodada 7: CORREÇÃO de produto — participante NÃO recebe DM de aviso; só conta e aos 3 os admins são DMados. Migration 180000 reescrita ANTES da aplicação)

## Rodada 7 (o que foi feito)
1. **Correção do operador**: "o aviso não é mandando para a pessoa que trocou os valores, só para os admins". Removida a DM ao participante (dreno + formatParticipantWarning + wiring no ciclo + 6 testes + coluna notified_at). A regra volta ao desenho original: redução CONTA silenciosamente; 3 exatos → DM aos admins (554197285978 + 5519989759121, já funcionando).
2. **Migration 20260924180000 reescrita e renomeada** (`dashboard_warnings_snapshot.sql`): só o snapshot do dashboard (`participant_warnings` + `value_change_log`, limit 100, sem notified_at). Verificação ao vivo ANTES da decisão: coluna notified_at NÃO existia no Supabase (não foi aplicada) → edição in-place é segura; se o operador tivesse aplicado a versão antiga, a nova roda sem conflito (só substitui a função; coluna sobrando é inofensiva).
3. **Terminal em tempo real**: o log do voto agora traz o LOTE e marca redução — "🔄 Voto alterado: Ana (+55…) → R$ 30,00 → R$ 22,00 · lote 7 · ⚠️ redução: aviso global registrado" (no processamento do voto, sem polling). O log resumido do 3º aviso aos admins continua.
4. **Dashboard**: painel "Avisos de alteração de valores" mantido (coluna DM removida) — participante, lote, carta, anterior→novo, horário, K de 3.
5. **Verificação ao vivo de migrations** (novo aprendizado, via PostgREST com a service key do .env.local — read-only): 150000 APLICADA, 160000 APLICADA, 180000 pendente. Doctor continua confirmando rascunhos.
6. Testes: warning-notice.sql reescrito (sem notified_at/DM), bot warning-notify limpo (32 testes), site 170, typecheck, build — verdes.

## Decisão de produto (definitiva — não reverter)
- **Avisos globais**: redução = +1 no contador (global, sem reset, idempotente por evento); 3 exatos = DM aos admins; SEM DM ao participante, sem punição. Visibilidade: terminal (log do voto em tempo real + resumo do 3º) + dashboard (painel) + Excel (abas).

## Pendências do operador
- **P-13 (atualizado)**: aplicar `20260924180000_dashboard_warnings_snapshot.sql` no SQL Editor (150000/160000 já estão aplicadas ✓; confirmar a 170000 do próprio operador) → `npm run doctor` → smoke: reduzir lance de teste → terminal loga com lote + painel mostra.
- **P-11**: `RECOGNITION_SERVICE_SHARED_SECRET` na Vercel (painel publicado).
- Próxima fila: conferir figurinha + @todos no grupo (gatilho corrigido na rodada 6).

## Rodada 6 (o que foi feito)
1. **Figurinha + @todos (P-05, gatilho corrigido)**: o recurso JÁ existia (figurinha capturada 2026-09-23, arquivo em bot/data/announcement-sticker.json ✓) mas NUNCA disparava: (a) filas "Agora" — o runScheduler claimava o lote 1 antes do anúncio consultar (status scheduled sumia); (b) fila começando com BRINDE nem tem dispatch na posição 1. Gatilho novo: pela FILA (`auction_publish_queues.starts_at`), janela 5 min antes (`BOT_ANNOUNCE_MINUTES_BEFORE`) até 15 min depois (`ANNOUNCE_GRACE_MINUTES` — cobre bot que subiu atrasado; fila velha fica em silêncio); pausada não anuncia; idempotente (announce-state.json); **o anúncio agora roda PRIMEIRO no ciclo de 3s**. P-05 marcado CONCLUÍDO (11_PENDING_WORK).
2. **Avisos no terminal**: os drenos agora logam QUEM, QUAL enquete/lote e QUAIS valores — "⚠️ Ana reduziu o lance no lote 7 (Gengar): R$ 30,00 → R$ 22,00 · aviso 1 de 3 · DM enviada." e no 3º: "⚠️ 3 AVISOS: Ana — última redução no lote N (carta): R$ X → R$ Y · DM enviada a 2 admin(s)". No SITE o painel "Avisos de alteração de valores" já mostra (rodada 5).
3. **Revisão geral (pedido do operador)**: sem sobras do gatilho antigo (grep); sticker/announce/doctor conferidos; defaults de env OK (BOT_ADMIN_WA_JIDS = 554197285978+5519989759121); suítes: bot 38, site 170, typecheck, build — verdes.
4. Docs: 06 (P-05 + logs de terminal), 11 (P-05 CONCLUÍDO), este handoff.

## Pendências do operador (repetindo)
- **P-13**: aplicar as 4 migrations no SQL Editor (150000→160000→170000→180000) → `npm run doctor` → smokes (rascunho, brinde por carta, avisos).
- **P-11**: `RECOGNITION_SERVICE_SHARED_SECRET` na Vercel (reconhecimento do painel publicado).
- Próxima fila agendada/"Agora": conferir figurinha + @todos chegando no grupo (janela de 5 min antes até 15 min depois do início).

## Sessão atual (resumo das 5 rodadas)
1. **Rascunhos do wizard em lote** (529c0f9d): salvar/abrir/excluir, fotos no Storage, apaga ao publicar; migration 150000.
2. **Hotfixes do bot** (04605f72 + e9c68aa0): spam libsignal (patch), spam "enquete desconhecida" dedup, sync de grupos 90s, brinde avulso /auctions/brinde.
3. **Brinde por carta** (270a9d74/cdbb8f1b): botão na EDIÇÃO da carta → foto+enquete no lugar do leilão (migration 160000); variante/bandeira "Outro" na legenda; drag só no ☰. OPERADOR também publica (170000, backup do brinde — verificado correto).
4. **Pipeline de reconhecimento VISÍVEL** (d5470f9c): chip no wizard; P-11 (secret na Vercel) era o motivo do "muito ruim de novo" no painel publicado.
5. **Rodada 5** (esta): avisos — ver qual enquete/horário + DM ao participante + 3 → admins.

## O que foi concluído (rodada 5)
1. **Pedido do operador**: "ver qual enquete a pessoa mudou o voto, que horas; se deu valor maior e põe menor recebe um aviso; com 3 contata os admins (554197285978, 5519989759121)". A regra dos 3 → admins JÁ EXISTIA (20260923093000 aplicada + dreno warning-notify.mjs); faltavam a DM à PESSOA e a visibilidade ao vivo.
2. **DM ao participante** (`bot/warning-notify.mjs::createParticipantWarningDrain`, migration 20260924180000): cada redução → DM direto nomeando a enquete/lote, carta, valores, horário e "aviso K de 3" (no 3º+ diz que os admins foram notificados). `participant_warnings.notified_at` só após enviar (crash → reenvio); sem JID resolvível marca sem DM (o aviso continua contando). Wired no ciclo de 3s do bot ao lado do dreno dos admins.
3. **Dashboard ao vivo**: `read_dashboard_snapshot` agora traz `participant_warnings` (lote/carta/valores/horário/notified_at) + `value_change_log` (limit 100) — novo painel "Avisos de alteração de valores" entre Disputa e Cartas (participante, lote, carta, anterior→novo, horário, K de 3, DM pendente/enviada). Antes só o Excel tinha esses dados.
4. **Testes**: `tests/warning-notice.sql` (novo, no ci.yml) + 6 testes do dreno em `bot/warning-notify.test.mjs`. Bot 37, site 170, typecheck, build — OK local.

## Ponto EXATO onde paramos
Código completo e testado localmente; push + CI desta rodada a caminho. **P-13 agora são QUATRO migrations** (150000→160000→170000→180000) — sem a 180000 o painel de avisos fica vazio (coluna notified_at) e o dreno do participante loga erro até aplicar. P-11 (secret na Vercel) segue pendente para o painel publicado.

## Próximo passo EXATO
1. Push + CI verde.
2. OPERADOR (P-13): colar as 4 migrations no SQL Editor (ordem lexical) → `npm run doctor` → smoke: reduzir um lance de teste → DM chega à pessoa + painel de avisos mostra lote/horário; 3 reduções → DM aos admins.
3. OPERADOR (P-11): secret na Vercel + redeploy → chip "serviço local ✅" no painel publicado.
4. P-04 (SigLIP2 quantizado) no backlog. P-01 CONCLUÍDO (drift limpo na rodada 4).

## Arquivos de código prioritários
- `bot/warning-notify.mjs` (formatParticipantWarning + createParticipantWarningDrain), `supabase/migrations/20260924180000_participant_warning_notice.sql`
- `app/dashboard.tsx` (painel de avisos), `bot/index.mjs` (wiring do dreno no ciclo de 3s)

## Comandos úteis
```bash
npm run doctor
npm run start
npm test && npm run typecheck && npm run build
node --test bot/*.test.mjs
# python: a partir de recognition/ com o venv
.venv\Scripts\python.exe -m unittest discover -s tests
```

## Atenções
- Migrations 150000..180000 NÃO aplicadas em produção (P-13): rascunho/brinde/avisos falham com erro claro até aplicar.
- **P-11 é o gargalo da qualidade no painel publicado** — sem o secret, TODO reconhecimento roda no navegador (o chip do wizard mostra).
- `uploadImages(keepFiles)`: publicação false, rascunho true — não inverter.
- Migrations que substituem função: SEMPRE verbatim da última versão com adições marcadas (errei 1× com trigger antigo — o CI pegou).
- O OPERADOR também escreve migrations — `git fetch` ANTES de substituir função/push (rodada 4 foi rejeitada por non-fast-forward, resolvida com rebase).
- Página client-side nova com createPublicSupabaseClient PRECISA de layout force-dynamic.
- Suíte que persiste estado redireciona o diretório ANTES do import dinâmico (BOT_DATA_DIR).
- Atualizar `11_PENDING_WORK.md` e ESTE arquivo ao concluir qualquer item.
