# SESSION HANDOFF

## Última atualização
2026-09-24 (rodada 4: "verificação de cartas muito ruim de novo" — diagnóstico: painel da VERCEL degradando silenciosamente para o pipeline do NAVEGADOR (P-11, sem o secret); agora o wizard MOSTRA o pipeline ativo)

## Sessão atual (resumo das 4 rodadas)
1. **Rascunhos do wizard em lote** (CI verde em 529c0f9d): salvar/abrir/excluir, fotos no Storage no salvar, apaga ao publicar; migration 20260924150000.
2. **Hotfixes do bot** (04605f72 + e9c68aa0, verdes): spam libsignal (patch, privKeys não vazam), spam "enquete desconhecida" dedup, sync de grupos 30s→90s (justificativa medida), brinde avulso movido para /auctions/brinde (layout force-dynamic).
3. **Brinde por carta** (270a9d74/cdbb8f1b, verdes): botão "🎁 Brinde" na EDIÇÃO da carta → foto + enquete no lugar do leilão (migration 20260924160000); + variante/bandeira "Outro" na legenda; + drag só no ☰ (seleção de texto volta a funcionar).
4. **Rodada 4** (esta): qualidade do reconhecimento "muito ruim de novo" no painel publicado.

## O que foi concluído (rodada 4)
1. **Diagnóstico**: o operador usa o painel PUBLICADO (citou leilaopokemon.vercel.app). Sem `RECOGNITION_SERVICE_SHARED_SECRET` na Vercel (P-11 aberto), `/api/card-recognition/token` falha e TODA foto degrada silenciosamente para o pipeline do NAVEGADOR (~47 MB WASM, sem SIFT/índice) — o pipeline local (49% IDENTIFICADO no holdout real de 96 fotos) segue saudável no PC. Nada regrediu no código; era o fallback invisível.
2. **Pipeline ativo VISÍVEL**: `probeRecognitionPipeline()` em lib/card-recognition-local.ts — probe + MINT de token (o probe sozinho MENTE no painel publicado: o navegador alcança 127.0.0.1:8765, mas o mint é server-side) → chip no wizard (etapa 1): "🔎 serviço local ✅" / "⚠ NAVEGADOR (pior)" com causa nomeada por host (PC: ligar npm run start; Vercel: configurar o secret) / "⏸️ desativado" / "verificando…". Resultados auto-corrigem o chip (`result.localPipeline`). Texto antigo "O reconhecimento roda localmente" (mentia na Vercel) corrigido.
3. Teste estático novo (probe+mint+chip+auto-heal). Drifts de docs limpos: P-01 marcado CONCLUÍDO (07 já documentava o fix de 2026-09-23; 11 estava stale).

## O que está em andamento
- Nada de código. **O OPERADOR também publica no repo** (20260924170000_backup_giveaway_fields.sql, commit 1e85df8c — backup cobrindo os campos do brinde; verificado: partiu da versão mais recente, mantém auction_drafts, correto). Meu commit da rodada 4 rebaseado em cima. Push + CI desta rodada pendentes ao fechar a sessão.

## Testes executados
- Node 170 OK (novo teste de pipeline visível), bot 31 OK, typecheck OK, build OK. Python não tocado nesta rodada (252 no CI).

## Ponto EXATO onde paramos
A CORREÇÃO REAL da qualidade é ação do OPERADOR (2 min): copiar `RECOGNITION_SERVICE_SHARED_SECRET` do .env.local para a Vercel (Settings → Environment Variables, server-only) → Redeploy → o chip do wizard em /auctions/new deve virar "🔎 Reconhecimento: serviço local ✅". Sem isso, o painel publicado continua no pipeline do navegador.

## Próximo passo EXATO
1. Push + CI verde desta rodada.
2. OPERADOR (P-11): secret na Vercel + redeploy + conferir o chip "serviço local ✅" no painel publicado.
3. P-13: aplicar migrations 20260924150000 + 20260924160000 + 20260924170000 no SQL Editor (ordem lexical) → `npm run doctor` → smoke (rascunho + brinde por carta).
4. P-04 (SigLIP2 quantizado) no backlog. P-01 CONCLUÍDO (drift limpo).

## Arquivos de código prioritários
- `lib/card-recognition-local.ts` (probeRecognitionPipeline), `app/auctions/new/bulk-wizard.tsx` (chip + brinde + rascunhos + drag)
- `supabase/migrations/20260924150000_auction_drafts.sql` + `20260924160000_giveaway_queue_items.sql`

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
- **P-11 é o gargalo da qualidade no painel publicado** — sem o secret, TODO reconhecimento roda no navegador. O chip do wizard agora torna isso visível.
- Migrations 20260924150000+20260924160000+20260924170000 NÃO aplicadas em produção (P-13): rascunho/brinde-por-carta falham com erro claro até aplicar.
- O operador escreve migrations também — ANTES de substituir função, verificar se o remoto tem commits novos (`git fetch`); o push desta rodada foi rejeitado por non-fast-forward e resolvido com rebase.
- `uploadImages(keepFiles)`: publicação false, rascunho true — não inverter.
- Migrations que substituem função: SEMPRE verbatim da última versão com adições marcadas (esta sessão errei 1× copiando trigger antigo — o CI pegou).
- Página client-side nova com createPublicSupabaseClient PRECISA de layout force-dynamic.
- Suíte que persiste estado redireciona o diretório ANTES do import dinâmico (BOT_DATA_DIR).
- Atualizar `11_PENDING_WORK.md` e ESTE arquivo ao concluir qualquer item.
