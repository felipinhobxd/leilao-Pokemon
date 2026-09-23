# 11_PENDING_WORK — Trabalho pendente (real, verificado)

> Área: Backlog
> Escopo: Bugs, melhorias, features pedidas pelo operador, dívidas, testes faltantes
> Última atualização: 2026-09-23
> Fonte principal: pedidos explícitos do operador nas sessões de trabalho + diagnóstico das sessões (logs citados abaixo)

## Bugs

```text
ID: P-01
Título: /memory/confirm recebe chamada SEM Authorization → 401 "Token do reconhecimento local ausente"
Prioridade: Alta
Status: Aberto
Arquivos relacionados: recognition/recognition_server.py (memory_confirm), lib/card-recognition-local.ts (confirmRecognitionMemory), app/auctions/new/bulk-wizard.tsx (chamada de confirmação)
Descrição: Log do operador (2026-09-22) mostra 8 ASGI tracebacks seguidos de ServiceAuthError 401 "Token do reconhecimento local ausente" no endpoint /memory/confirm. As chamadas chegam sem o header Bearer — suspeita: algum caminho do wizard chama o endpoint direto (sem passar por confirmRecognitionMemory) ou o retry 401 não reanexa o header.
O que já foi investigado: confirmRecognitionMemory (lib/card-recognition-local.ts) SEMPRE anexa headers.Authorization; o retry após 401 também. Nada confirmado além disso — a origem da chamada sem header não foi localizada.
O que falta: reproduzir (abrir wizard, identificar carta, confirmar carta) capturando a stack do chamador; verificar se há fetch direto em algum componente; corrigir e testar E2E.
Próximo passo: procurar no frontend chamadas a "memory/confirm" que não usem confirmRecognitionMemory (grep) e reproduzir com o serviço logando o Origin/referer.
```

```text
ID: P-02
Título: Aplicar migration 20260923093000 (avisos globais/histórico/limpeza 30d) na instância Supabase
Prioridade: Alta (bloqueia os recursos de avisos/limpeza em produção)
Status: Aguardando ação manual do operador
Arquivos relacionados: supabase/migrations/20260923093000_global_warnings_value_history.sql
Descrição: Migration versionada e testada no CI (aplicada em Postgres 17 limpo), mas produção aplica manualmente via SQL Editor (fluxo do projeto).
O que já foi investigado: bot/site funcionam sem ela (dreno de notificações loga erro até aplicar; limpeza 30d idem).
O que falta: operador colar o arquivo no SQL Editor; depois `npm run start` e validar (ver item "Smoke de avisos" em 09_TESTS).
Próximo passo: confirmar com o operador se já aplicou; se sim, rodar o smoke de avisos (reduzir 3 valores com o mesmo usuário → DM nos 2 admins).
```

## Melhorias / Performance

```text
ID: P-03
Título: Completar índice visual do idioma es (13.271 cartas com scan fora do índice)
Prioridade: Média
Status: Adiado pelo operador (pedido explícito: "não precisa fazer o index")
Arquivos relacionados: scripts/recognition-shared.mjs (comando recognition:index, CPU-forçado), recognition/scripts/build_index.py
Descrição: builds de índice de 18/09 morreram 3× com NaN do DirectML; pt-BR/en/ja estão 100% no índice (37.917 linhas); es ficou de fora. Fotos do operador são pt-BR (não afeta o uso atual).
O que já foi investigado: causa raiz (DML NaN) mitigada com RECOGNITION_PROVIDERS=cpu no build.
O que falta: rodar `npm run recognition:index` (~2–3 h CPU) quando o operador quiser es.
Próximo passo: perguntar ao operador; se autorizar, rodar em background e validar `/health` indexSize ≈ 51k.
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
Status: Não iniciado
Arquivos relacionados: bot/index.mjs (BUYOUT_CONFIRMED / AUCTION_FINALIZE announcements), participant_identities (JID do vencedor)
Descrição: mensagem de fechamento com mentionedJid real do vencedor.
O que falta: garantir JID resolvível (LID vs telefone) no momento do anúncio; texto/formato.
Próximo passo: implementar no handler de ARREMATADO/finalização usando o JID já resolvido do participante.
```

```text
ID: P-07
Título: Enquete rápida de brindes (texto livre/emojis, "quem clicar primeiro leva")
Prioridade: Média
Status: Não iniciado
Arquivos relacionados: novo tipo de item na fila (app/api/auctions/batch + wizard) OU comando de bot direto; bot/format.mjs
Descrição: enquete com título/opções livres, sem carta/lance; publicada no grupo.
O que falta: decidir se vive na mesma fila de publicação (novo payload kind) ou em fluxo próprio.
Próximo passo: propor modelo de payload ao operador antes de implementar.
```

```text
ID: P-08
Título: Múltiplas fotos por lote (detalhes/estado/avarias)
Prioridade: Média (maior esforço da lista)
Status: Não iniciado
Arquivos relacionados: cards/auctions schema (imagens extras), bulk-wizard (multi-upload por carta), card-image.ts, bot (álbum antes da enquete), export?
Descrição: mais de uma foto por carta; o bot publica como álbum/sequência antes da enquete.
O que falta: schema (imagens extras por carta), wizard multi-arquivo por Draft, publicação em álbum no Baileys.
Próximo passo: desenhar o schema (coluna jsonb de urls) e validar álbum no Baileys antes de mexer no wizard.
```

```text
ID: P-09
Título: Cobrança automática pós-leilão (lembrete de pagamento após prazo)
Prioridade: Baixa (explícitamente "pro futuro" pelo operador; depende de número dedicado)
Status: Adiado
Arquivos relacionados: purchases/payments (prazos), bot (mensagens 1:1), participants
Descrição: lembrete automático a arrematantes sem baixa de pagamento em N dias.
O que falta: número dedicado, política de prazo, opt-in dos usuários (evitar spam).
Próximo passo: não iniciar sem decisão do operador.
```

## Dívidas técnicas / testes faltantes

```text
ID: P-10
Título: Suíte SQL para a migration de avisos (20260923093000)
Prioridade: Média
Status: Não iniciado
Arquivos relacionados: tests/*.sql (padrão do CI), supabase/migrations/20260923093000_*.sql
Descrição: os SQL tests do CI cobrem as migrations anteriores; a de avisos não tem arquivo dedicado (validada só por aplicação limpa no CI + revisão).
O que falta: tests/auction-warnings.sql com: subida de valor sem aviso, mesmo valor sem aviso, redução = 1 aviso, 3 reduções = 1 notificação, evento repetido = idempotente, limpeza 30d preserva participant_warnings.
Próximo passo: escrever o SQL test seguindo o padrão de tests/auction.sql.
```

```text
ID: P-11
Título: Vercel — RECOGNITION_SERVICE_SHARED_SECRET como env server-only
Prioridade: Alta para quem usa o painel publicado (senão pipeline do navegador no Vercel)
Status: Aguardando configuração do operador (feito localmente; falta na Vercel)
Arquivos relacionados: .env.local (valor de referência local), painel Vercel → Settings → Environment Variables
Descrição: sem o env na Vercel, o painel publicado não minta token e cai no pipeline do navegador (~47 MB WASM por visitante frio).
Próximo passo: operador copiar o valor do .env.local para a Vercel (server-only) e revalidar o wizard no domínio publicado.
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
