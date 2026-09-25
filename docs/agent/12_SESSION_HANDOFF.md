# SESSION HANDOFF

## Última atualização
2026-09-24 (rodada 5: avisos de alteração de valores — DM ao PARTICIPANTE que reduziu o lance + painel ao vivo no dashboard; migration 20260924180000)

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
