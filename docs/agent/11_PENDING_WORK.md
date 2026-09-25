# 11_PENDING_WORK — Trabalho pendente (real, verificado)

> Área: Backlog
> Escopo: Bugs, melhorias, features pedidas pelo operador, dívidas, testes faltantes
> Última atualização: 2026-09-24
> Fonte principal: pedidos explícitos do operador nas sessões de trabalho + diagnóstico das sessões (logs citados abaixo)

## Bugs

```text
ID: P-01
Título: /memory/confirm recebia chamada SEM Authorization → 401/500
Prioridade: Alta
Status: CONCLUÍDO 2026-09-23 (registrado em 07_CARD_RECOGNITION.md; item em 11 era drift de documentação, limpo em 2026-09-24): endpoints de memória/catálogo usam `require_service_auth` (401/503 limpos em vez de 500+traceback).
Arquivos relacionados: recognition/recognition_server.py (require_service_auth), lib/card-recognition-local.ts (confirmRecognitionMemory)
Próximo passo: nenhum.
```

```text
ID: P-02
Título: Aplicar as migrations 2026-09-23/24 no Supabase
Prioridade: Alta
Status: CONCLUÍDO 2026-09-24 — CONFIRMADO pelo npm run doctor: tabelas novas (participant_warnings, value_change_log, admin_notifications, whatsapp_quick_polls, payment_reminders) e RPCs (export_business_backup, mark_purchase_paid, cleanup_old_auctions) todos presentes na instância. Padrão futuro: rodar `npm run doctor` para conferir migrations após aplicar novas.
Arquivos relacionados: supabase/migrations/20260923093000_global_warnings_value_history.sql
Descrição: Migration versionada e testada no CI (aplicada em Postgres 17 limpo), mas produção aplica manualmente via SQL Editor (fluxo do projeto).
O que já foi investigado: bot/site funcionam sem ela (dreno de notificações loga erro até aplicar; limpeza 30d idem).
O que falta: operador colar o arquivo no SQL Editor; depois `npm run start` e validar (ver item "Smoke de avisos" em 09_TESTS).
Próximo passo: confirmar com o operador se já aplicou; se sim, rodar o smoke de avisos (reduzir 3 valores com o mesmo usuário → DM nos 2 admins).
```

## Melhorias / Performance

```text
ID: P-03
Título: Índice visual do idioma es
Prioridade: —
Status: CANCELADO pelo operador (2026-09-24: "espanhol não quero no código/bot"). O índice permanece com 0 linhas es (confirmado ao vivo: npz tem 0 chaves es). Análise de segurança feita na mesma data:
  - fotos es caem para a rota de TEXTO (catálogo mantém 15.510 cartas es — identificação honesta via OCR, custo zero) ou em REVISAR com languageStatus=conflict — sem crash em nenhum caminho;
  - detect_language mantém es (empates pt/es resolvem para pt-BR via max() de tuplas);
  - "Espanhol" foi REMOVIDO do dropdown de idiomas (cardLanguages) → a API rejeita lotes es novos (400 idioma inválido); dados legados com es renderizam normalmente;
  - BUG ENCONTRADO E CORRIGIDO na análise: candidatos es do reconhecimento deixavam o select do wizard em branco e o lote era rejeitado NA PUBLICAÇÃO — agora mapLanguage mapeia es→"other" e o wizard guarda wizardLanguage() nos dois pontos de aplicação (useCandidate + merge de preenchimento automático). Suíte 155/155 verde.
Arquivos relacionados: lib/auction-wizard.ts, lib/card-recognition-service-contract.ts, lib/card-recognition-core-legacy.ts (tipo + Record), app/auctions/new/bulk-wizard.tsx
Próximo passo: nenhum — decisão final do operador.
```

```text
ID: P-04
Título: SigLIP2 quantizado (fp16/int8) para PC fraco
Prioridade: Média (meta declarada: "rodar até num PC meio ruim")
Status: Não iniciado
Arquivos relacionados: recognition/scripts/download_models.py, calibrate_thresholds.py, benchmark.py; recognizer/config.py (EMBEDDING_CALIBRATION)
Descrição: modelo 1,5 GB → ~400 MB e 2–3× mais rápido em CPU; exige recalibrar floor/strong/medium/weight por benchmark.
O que já foi investigado: pipeline de calibração existe (splits sem vazamento); thresholds são por-modelo em config.py.
O que falta: gerar/validar ONNX quantizado, rodar bake-off + calibração, ajustar config e README.
Próximo passo: rodar scripts/bakeoff_embeddings.py com o candidato quantizado nas fixtures existentes.
```

## Funcionalidades pedidas pelo operador (ordem de preferência declarada)

```text
ID: P-05
Título: Aviso de início do leilão — figurinha "O leilão vai começar!" + @todos antes do primeiro lote
Prioridade: Média
Status: Não iniciado (aguardando a figurinha do operador)
Arquivos relacionados: bot/index.mjs (fluxo de publicação), bot/queue-worker.mjs, supabase (posição na fila)
Descrição: ao iniciar uma fila (agendada), bot publica a figurinha e menciona @todos (mentionedJid) antes do primeiro dispatch.
O que falta: asset da figurinha; decidir gatilho (início de fila vs. X min antes); implementar envio de sticker no Baileys.
Próximo passo: pedir a figurinha ao operador e definir o momento do disparo.
```

```text
ID: P-06
Título: @mencionar o arrematante no fechamento do lote (em vez de só texto)
Prioridade: Média
Status: CONCLUÍDO 2026-09-24 — `bot/participant-contact.mjs` (resolveParticipantJid: pn > lid > whatsapp_id/phone_e164; mentionMessage) aplicado no ARREMATADO e no "Leilão encerrado". Sem JID pn resolvível, a mensagem sai com nome plano (nunca deixa de enviar).
Arquivos relacionados: bot/index.mjs (BUYOUT_CONFIRMED / AUCTION_FINALIZE announcements), participant_identities (JID do vencedor)
Descrição: mensagem de fechamento com mentionedJid real do vencedor.
O que falta: nada — validado por `node --check` + suíte do bot.
```

```text
ID: P-07
Título: Enquete rápida de brindes (texto livre/emojis, "quem clicar primeiro leva")
Prioridade: Média
Status: CONCLUÍDO 2026-09-24 — decisão do operador: SÓ painel, SÓ publicar (votos visíveis na própria enquete do WhatsApp; sem rastrear vencedor). Tabela `whatsapp_quick_polls` + `POST /api/quick-polls` (valida título 1-200, 2-12 opções ≤100 chars, grupo ativo, idempotente por external_event_id) + dreno `sendDueQuickPolls()` no ciclo de 3s do bot (messageId estável, sent_at só após envio). ATUALIZAÇÃO 2026-09-24 (rodada 2): formulário movido para `/auctions/brinde` (botão "🎁 Brinde" no topbar do wizard). ATUALIZAÇÃO 2026-09-24 (rodada 3): **BRINDE POR CARTA** (decisão do operador: "o brinde é uma opção nas cartas") — botão "🎁 Brinde" na EDIÇÃO da carta marca a carta como brinde: NÃO vira leilão, o bot publica FOTO + enquete livre (opções pré-preenchidas `GIVEAWAY_DEFAULT_OPTIONS`, editáveis) na posição do lote (migration 20260924160000: quick_polls ganha image_url/queue_id/queue_position; RPC da fila com branch de brinde; resume/cancel/conclusão cientes de brindes). A fila mostra brindes entre os leilões. Erros novos: invalid_giveaway_options/invalid_giveaway_image.
Arquivos relacionados: app/api/quick-polls/route.ts, bot/index.mjs::sendDueQuickPolls, app/auctions/brinde/page.tsx, app/auctions/new/bulk-wizard.tsx (botão na edição da carta), supabase/migrations/20260924160000, tests/giveaway-queue.sql
Descrição: enquete com título/opções livres, sem carta/lance; publicada no grupo. Brinde por carta: foto + enquete no lugar do leilão.
O que falta: aplicação das migrations 20260924150000+20260924160000 em produção (P-13) e smoke ao vivo.
```

```text
ID: P-08
Título: Múltiplas fotos por lote (detalhes/estado/avarias)
Prioridade: Média (maior esforço da lista)
Status: CONCLUÍDO 2026-09-24 — `cards.extra_images jsonb` (≤4 URLs HTTPS) via migration 20260924120000; validação nos DOIS RPCs (create_auction_wizard + create_auction_publish_queue) e nas duas rotas; wizard em lote + wizard único com upload incremental (`${cardId}#e${n}`) e thumbnails removíveis; bot publica em SEQUÊNCIA após a foto principal (álbum nativo é instável no Baileys — decisão técnica), com messageIds estáveis `extra-1..4` ANTES de persistir announcement_sent_at (crash → reenvio deduplicado); delay de 5s da enquete conta após a última.
Arquivos relacionados: supabase/migrations/20260924120000, app/auctions/new/{bulk-wizard,wizard}.tsx, app/api/auctions/{new,batch}/route.ts, bot/index.mjs::sendDispatchInternal
Descrição: mais de uma foto por carta; o bot publica como sequência antes da enquete.
O que falta: nada.
```

```text
ID: P-09
Título: Cobrança automática pós-leilão (lembrete de pagamento após prazo)
Prioridade: Baixa
Status: CONCLUÍDO 2026-09-24 — decisão do operador: DM a cada 7 dias, SEM aviso/punição, até marcar pago. `payment_reminders` (purchase_id UNIQUE, cascade) + `mark_purchase_paid` RPC (idempotente por estado, audita 1×, delivery → ready) + `bot/payment-reminder.mjs` (dreno com in-flight/throttle 1h; pula quem já tem payment paid; limite máx `BOT_PAYMENT_REMINDER_MAX`=5, 0=ilimitado) + botão "✓ Recebido" na tabela Compras do dashboard (`POST /api/purchases/paid`) + snapshot do dashboard agora traz payments/payment_reminders reais (era '[]' hardcoded).
Arquivos relacionados: bot/payment-reminder.mjs, app/api/purchases/paid/route.ts, app/dashboard.tsx, supabase/migrations/20260924120000
Descrição: lembrete automático a arrematantes sem baixa de pagamento em N dias.
O que falta: aplicação da migration em produção (P-02 consolidado) e smoke ao vivo (arrematar, esperar/forçar cutoff, conferir DM e o botão de baixa).
```

## Dívidas técnicas / testes faltantes

```text
ID: P-10
Título: Suíte SQL para a migration de avisos (20260923093000)
Prioridade: Média
Status: CONCLUÍDO — `tests/auction-warnings.sql` existe e roda no CI (ci.yml), cobrindo exatamente o checklist: subida de valor sem aviso, mesmo valor sem aviso, redução = 1 aviso, 3 reduções = 1 notificação, replay sem duplicar, limpeza 30d preserva participant_warnings. A anotação anterior de "não iniciado" era drift de documentação (2026-09-24).
Arquivos relacionados: tests/auction-warnings.sql, supabase/migrations/20260923093000_*.sql
Próximo passo: nenhum.
```

```text
ID: P-13
Título: Aplicar as migrations de rascunhos + brinde por carta (20260924150000 e 20260924160000) no Supabase
Prioridade: Alta (o botão "Salvar rascunho" e o brinde por carta só funcionam após aplicar)
Status: Aberto — ação do OPERADOR (SQL Editor), código e CI prontos
Arquivos relacionados: supabase/migrations/20260924150000_auction_drafts.sql (tabela auction_drafts + RPCs upsert/delete + purge/backup atualizados), supabase/migrations/20260924160000_giveaway_queue_items.sql (quick_polls ganha image_url/queue_id/queue_position + RPCs da fila cientes de brinde), scripts/doctor.mjs (checa tabela/RPCs de rascunho), app/api/auctions/drafts/route.ts, app/auctions/new/bulk-wizard.tsx, lib/auction-draft.ts
Descrição: rascunhos do wizard em lote salvos no Supabase (fotos sobem ao Storage no salvar) + brinde por carta na fila. Sem as migrations aplicadas, salvar devolve erro de função ausente e itens de brinde são rejeitados.
Próximo passo: operador colar os DOIS arquivos no SQL Editor (ordem lexical: 150000 → 160000) → `npm run doctor` → smoke: (1) salvar rascunho com 2 cartas, fechar, reabrir, Abrir, publicar fila de teste e conferir que o rascunho sumiu; (2) marcar uma carta como "🎁 Brinde" com opções, publicar fila e conferir foto+enquete no grupo.
```

```text
ID: P-11
Título: Vercel — RECOGNITION_SERVICE_SHARED_SECRET como env server-only
Prioridade: Alta para quem usa o painel publicado (senão pipeline do navegador no Vercel)
Status: Aguardando configuração do operador (feito localmente; falta na Vercel)
Arquivos relacionados: .env.local (valor de referência local), painel Vercel → Settings → Environment Variables, lib/card-recognition-local.ts::probeRecognitionPipeline
Descrição: sem o env na Vercel, o painel publicado não minta token e cai no pipeline do navegador (~47 MB WASM por visitante frio, sem SIFT/índice). SINTOMA REAL (2026-09-24): operador relatou "verificação de cartas muito ruim de novo" usando https://leilaopokemon.vercel.app — era exatamente este fallback silencioso. Desde 2026-09-24 o wizard MOSTRA o pipeline ativo (chip "⚠ Reconhecimento pelo NAVEGADOR … configure RECOGNITION_SERVICE_SHARED_SECRET na Vercel").
Próximo passo: operador copiar o valor de RECOGNITION_SERVICE_SHARED_SECRET do .env.local para a Vercel (Settings → Environment Variables, server-only) → Redeploy → conferir no wizard o chip "🔎 Reconhecimento: serviço local ✅".
```

## Investigações

```text
ID: P-12
Título: Benchmarks ptcg/* têm "truth-key" de path inválido
Prioridade: Baixa
Status: Identificado durante benchmark pré-2011 (2026-09-22)
Arquivos relacionadoss: scripts ad hoc de benchmark (não versionados) que derivam card_id do caminho do cache ptcg
Descrição: linhas ptcg/* do benchmark reportam "identidade errada" por derivação de path incorreta (layout image-cache/ptcg/<set>/<file>), não erro do pipeline.
O que falta: derivar truth pela tabela scans do SQLite ao rodar benchmarks de acurácia.
Próximo passo: corrigir o utilitário de benchmark antes de qualquer nova rodada de acurácia com fontes ptcg.
```

## Não confirmado / fora de escopo atual

- Supabase Realtime no dashboard (README menciona; uso direto não confirmado no código atual — precisa de investigação antes de mexer).
- Limitless como fonte do catálogo (cliente pronto em `recognizer/sources.py`, requer `LIMITLESS_API_KEY` — nunca configurado).
- Domínio próprio/HTTPS do painel publicado (hoje: leilaopokemon.vercel.app no allow-list do serviço local).
